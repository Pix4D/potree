import { Observable } from 'rxjs/Observable';
import { map } from 'rxjs/operators';
import { Box3, Frustum, Matrix4, PerspectiveCamera, Vector3, WebGLRenderer } from 'three';
import { GetUrlFn, loadPOC } from './loading';
import { ClipMode } from './materials/clipping';
import { PointCloudOctree } from './point-cloud-octree';
import { PointCloudOctreeGeometryNode } from './point-cloud-octree-geometry-node';
import { PointCloudOctreeNode } from './point-cloud-octree-node';
import { isGeometryNode, isTreeNode } from './type-predicates';
import { IPointCloudTreeNode, IPotree, IVisibilityUpdateResult } from './types';
import { BinaryHeap } from './utils/binary-heap';
import { Box3Helper } from './utils/box3-helper';
import { LRU } from './utils/lru';

export interface IQueueItem {
  weight: number;
  node: IPointCloudTreeNode;
  pointcloud: number;
  parent?: IPointCloudTreeNode | null;
}

export class Potree implements IPotree {
  maxNodesLoading: number = 5;

  private _pointBudget: number = 1_000_000;
  private _lru = new LRU(this._pointBudget);

  loadPointCloud(url$: Observable<string>, getUrl: GetUrlFn): Observable<PointCloudOctree> {
    return loadPOC(url$, getUrl).pipe(map(geometry => new PointCloudOctree(this, geometry)));
  }

  updatePointClouds(
    pointClouds: PointCloudOctree[],
    camera: PerspectiveCamera,
    renderer: WebGLRenderer,
  ): IVisibilityUpdateResult {
    for (let i = 0; i < pointClouds.length; i++) {
      pointClouds[i].updateProfileRequests();
    }

    const result = this.updateVisibility(pointClouds, camera, renderer);

    for (let i = 0; i < pointClouds.length; i++) {
      const pointCloud = pointClouds[i];
      pointCloud.updateMaterial(pointCloud.material, pointCloud.visibleNodes, camera, renderer);
      pointCloud.updateVisibleBounds();
    }

    this.getLRU().freeMemory();

    return result;
  }

  get pointBudget(): number {
    return this._pointBudget;
  }

  set pointBudget(value: number) {
    if (value !== this._pointBudget) {
      this._pointBudget = value;
      this._lru.pointBudget = value;
      this._lru.freeMemory();
    }
  }

  getLRU() {
    return this._lru;
  }

  // getDEMWorkerInstance() {
  //   if (!Potree.DEMWorkerInstance) {
  //     const workerPath = Potree.scriptPath + '/workers/DEMWorker.js';
  //     Potree.DEMWorkerInstance = Potree.workerPool.getWorker(workerPath);
  //   }

  //   return Potree.DEMWorkerInstance;
  // }

  private updateVisibility(
    pointclouds: PointCloudOctree[],
    camera: PerspectiveCamera,
    renderer: WebGLRenderer,
  ): IVisibilityUpdateResult {
    let numVisiblePoints = 0;

    const visibleNodes: PointCloudOctreeNode[] = [];
    const visibleGeometry: PointCloudOctreeGeometryNode[] = [];
    const unloadedGeometry: PointCloudOctreeGeometryNode[] = [];

    let lowestSpacing = Infinity;

    // calculate object space frustum and cam pos and setup priority queue
    const { frustums, camObjPositions, priorityQueue } = this.updateVisibilityStructures(
      pointclouds,
      camera,
    );

    let loadedToGPUThisFrame = 0;
    const domHeight = renderer.domElement.clientHeight;

    while (priorityQueue.size() > 0) {
      const element = priorityQueue.pop()!;

      let node = element.node;
      const parent = element.parent;
      const pointcloud = pointclouds[element.pointcloud];

      {
        // restrict to certain nodes for debugging
        const allowedNodes = ['r'];
        if (!allowedNodes.includes(node.name)) {
          continue;
        }
      }

      const box = node.boundingBox;
      const frustum = frustums[element.pointcloud];
      const camObjPos = camObjPositions[element.pointcloud];

      let visible = frustum.intersectsBox(box);
      visible = visible && !(numVisiblePoints + node.numPoints > this.pointBudget);
      visible = visible && node.level < pointcloud.maxLevel;

      if (
        pointcloud.material.numClipBoxes > 0 &&
        visible &&
        pointcloud.material.clipMode === ClipMode.CLIP_OUTSIDE
      ) {
        visible = visible && this.intersectsClipBoxes(pointcloud, box);
      }

      lowestSpacing = Math.min(lowestSpacing, node.spacing);

      if (numVisiblePoints + node.numPoints > this.pointBudget) {
        break;
      }

      if (!visible) {
        continue;
      }

      numVisiblePoints += node.numPoints;
      pointcloud.numVisiblePoints += node.numPoints;

      if (isGeometryNode(node) && (!parent || isTreeNode(parent))) {
        if (node.loaded && loadedToGPUThisFrame < 2) {
          node = pointcloud.toTreeNode(node, parent);
          loadedToGPUThisFrame++;
        } else {
          unloadedGeometry.push(node);
          visibleGeometry.push(node);
        }
      }

      if (isTreeNode(node) && node.sceneNode) {
        this.getLRU().touch(node.geometryNode);

        node.sceneNode.visible = true;
        node.sceneNode.material = pointcloud.material;

        visibleNodes.push(node);
        pointcloud.visibleNodes.push(node);

        node.sceneNode.updateMatrix();
        node.sceneNode.matrixWorld.multiplyMatrices(pointcloud.matrixWorld, node.sceneNode.matrix);

        if (pointcloud.showBoundingBox && !node.boundingBoxNode) {
          const boxHelper = new Box3Helper(node.boundingBox);
          boxHelper.matrixAutoUpdate = false;
          pointcloud.boundingBoxNodes.push(boxHelper);
          node.boundingBoxNode = boxHelper;
          node.boundingBoxNode.matrix.copy(pointcloud.matrixWorld);
        } else if (pointcloud.showBoundingBox && node.boundingBoxNode) {
          node.boundingBoxNode.visible = true;
          node.boundingBoxNode.matrix.copy(pointcloud.matrixWorld);
        } else if (!pointcloud.showBoundingBox && node.boundingBoxNode) {
          node.boundingBoxNode.visible = false;
        }
      }

      // add child nodes to priorityQueue
      const children = node.getChildren();
      for (let i = 0; i < children.length; i++) {
        const child = children[i];

        const sphere = child.boundingSphere;
        const distance = sphere.center.distanceTo(camObjPos);
        const radius = sphere.radius;

        const fov = camera.fov * Math.PI / 180;
        const slope = Math.tan(fov / 2);
        const projFactor = 0.5 * domHeight / (slope * distance);
        const screenPixelRadius = radius * projFactor;

        if (screenPixelRadius < pointcloud.minimumNodePixelSize) {
          continue;
        }

        let weight = screenPixelRadius;

        if (distance - radius < 0) {
          weight = Number.MAX_VALUE;
        }

        priorityQueue.push({
          pointcloud: element.pointcloud,
          node: child,
          parent: node,
          weight,
        });
      }
    } // end priority queue loop

    const numNodesToLoad = Math.min(this.maxNodesLoading, unloadedGeometry.length);
    for (let i = 0; i < numNodesToLoad; i++) {
      unloadedGeometry[i].load();
    }

    return {
      visibleNodes: visibleNodes,
      numVisiblePoints: numVisiblePoints,
      lowestSpacing: lowestSpacing,
    };
  }

  private intersectsClipBoxes(pointcloud: PointCloudOctree, boundingBox: Box3): boolean {
    const box2 = boundingBox.clone();
    pointcloud.updateMatrixWorld(true);
    box2.applyMatrix4(pointcloud.matrixWorld);

    const clipBoxes = pointcloud.material.clipBoxes;
    for (let i = 0; i < clipBoxes.length; i++) {
      const clipMatrixWorld = clipBoxes[i].matrix;
      const clipBoxWorld = new Box3(
        new Vector3(-0.5, -0.5, -0.5),
        new Vector3(0.5, 0.5, 0.5),
      ).applyMatrix4(clipMatrixWorld);
      if (box2.intersectsBox(clipBoxWorld)) {
        return true;
      }
    }

    return false;
  }

  private updateVisibilityStructures(
    pointclouds: PointCloudOctree[],
    camera: PerspectiveCamera,
  ): {
    frustums: Frustum[];
    camObjPositions: Vector3[];
    priorityQueue: BinaryHeap<IQueueItem>;
  } {
    const frustums: Frustum[] = [];
    const camObjPositions = [];
    const priorityQueue = new BinaryHeap<IQueueItem>(x => 1 / x.weight);

    for (let i = 0; i < pointclouds.length; i++) {
      const pointcloud = pointclouds[i];

      if (!pointcloud.initialized()) {
        continue;
      }

      pointcloud.numVisiblePoints = 0;
      pointcloud.deepestVisibleLevel = 0;
      pointcloud.visibleNodes = [];
      pointcloud.visibleGeometry = [];

      // frustum in object space
      camera.updateMatrixWorld(true);
      const frustum = new Frustum();
      const viewI = camera.matrixWorldInverse;
      const world = pointcloud.matrixWorld;
      const proj = camera.projectionMatrix;
      const fm = new Matrix4()
        .multiply(proj)
        .multiply(viewI)
        .multiply(world);
      frustum.setFromMatrix(fm);
      frustums.push(frustum);

      // camera position in object space
      const view = camera.matrixWorld;
      const worldI = new Matrix4().getInverse(world);
      const camMatrixObject = new Matrix4().multiply(worldI).multiply(view);
      const camObjPos = new Vector3().setFromMatrixPosition(camMatrixObject);
      camObjPositions.push(camObjPos);

      if (pointcloud.visible && pointcloud.root !== null) {
        priorityQueue.push({
          weight: Number.MAX_VALUE,
          node: pointcloud.root,
          pointcloud: i,
        });
      }

      if (isTreeNode(pointcloud.root) && pointcloud.root.sceneNode) {
        pointcloud.hideDescendants(pointcloud.root.sceneNode);
      }

      for (let j = 0; j < pointcloud.boundingBoxNodes.length; j++) {
        pointcloud.boundingBoxNodes[j].visible = false;
      }
    }

    return {
      frustums: frustums,
      camObjPositions: camObjPositions,
      priorityQueue: priorityQueue,
    };
  }
}
