import { Observable } from 'rxjs/Observable';
import { map } from 'rxjs/operators';
import { Frustum, Matrix4, PerspectiveCamera, Vector3, WebGLRenderer } from 'three';
import { GetUrlFn, loadPOC } from './loading';
import { PointCloudOctree } from './point-cloud-octree';
import { PointCloudOctreeGeometryNode } from './point-cloud-octree-geometry-node';
import { PointCloudOctreeNode } from './point-cloud-octree-node';
import { IPointCloudTreeNode, IPotree, IVisibilityUpdateResult } from './types';
import { BinaryHeap } from './utils/binary-heap';
import { Box3Helper } from './utils/box3-helper';
import { LRU } from './utils/lru';

export interface QueueItem {
  weight: number;
  node: IPointCloudTreeNode;
  pointcloud: number;
  parent?: IPointCloudTreeNode | null;
}

export class Potree implements IPotree {
  pointBudget: number = 1_000_000;
  numNodesLoading: number = 0;
  maxNodesLoading: number = 4;
  private lru = new LRU(this.pointBudget);

  loadPointCloud(url$: Observable<string>, getUrl: GetUrlFn): Observable<PointCloudOctree> {
    return loadPOC(url$, getUrl).pipe(map(geometry => new PointCloudOctree(this, geometry)));
  }

  updatePointClouds(
    pointClouds: PointCloudOctree[],
    camera: PerspectiveCamera,
    renderer: WebGLRenderer,
  ): IVisibilityUpdateResult {
    pointClouds.forEach(pointCloud => pointCloud.updateProfileRequests());

    const result = this.updateVisibility(pointClouds, camera, renderer);

    pointClouds.forEach(pointCloud => {
      pointCloud.updateMaterial(pointCloud.material, camera, renderer);
      pointCloud.updateVisibleBounds();
    });

    this.getLRU().freeMemory();

    return result;
  }

  getLRU() {
    return this.lru;
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

    const numVisiblePointsInPointclouds = new Map<PointCloudOctree, number>();
    pointclouds.forEach(pc => numVisiblePointsInPointclouds.set(pc, 0));

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

    const pointcloudTransformChanged = new Map<PointCloudOctree, boolean>();

    let element: QueueItem | undefined;
    while ((element = priorityQueue.pop())) {
      let node = element.node;
      const parent = element.parent;
      const pointcloud = pointclouds[element.pointcloud];

      // { // restrict to certain nodes for debugging
      // 	let allowedNodes = ["r", "r0", "r4"];
      // 	if(!allowedNodes.includes(node.name)){
      // 		continue;
      // 	}
      // }

      const box = node.boundingBox;
      const frustum = frustums[element.pointcloud];
      const camObjPos = camObjPositions[element.pointcloud];

      const insideFrustum = frustum.intersectsBox(box);
      const maxLevel = pointcloud.maxLevel;
      const level = node.level;
      let visible = insideFrustum;

      visible = visible && !(numVisiblePoints + node.numPoints > this.pointBudget);

      const numPoints = numVisiblePointsInPointclouds.get(pointcloud) || 0;
      visible = visible && numPoints <= pointcloud.pointBudget;
      visible = visible && level < maxLevel;

      // visible = ["r", "r0", "r06", "r060"].includes(node.name);
      // visible = ["r"].includes(node.name);

      lowestSpacing = Math.min(lowestSpacing, node.spacing);

      if (numVisiblePoints + node.numPoints > this.pointBudget) {
        break;
      }

      if (!visible) {
        continue;
      }

      numVisiblePoints += node.numPoints;

      const numVisiblePointsInPointcloud = numVisiblePointsInPointclouds.get(pointcloud);
      numVisiblePointsInPointclouds.set(
        pointcloud,
        (numVisiblePointsInPointcloud || 0) + node.numPoints,
      );

      pointcloud.numVisibleNodes++;
      pointcloud.numVisiblePoints += node.numPoints;

      if (isGeometryNode(node) && (!parent || isTreeNode(parent))) {
        if (node.loaded && loadedToGPUThisFrame < 2) {
          node = pointcloud.toTreeNode(node as any, parent);
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

        if (!pointcloudTransformChanged.has(pointcloud)) {
          const originalMatrixWorld = node.sceneNode.matrixWorld.clone();

          node.sceneNode.updateMatrix();
          node.sceneNode.matrixWorld.multiplyMatrices(
            pointcloud.matrixWorld,
            node.sceneNode.matrix,
          );

          pointcloudTransformChanged.set(
            pointcloud,
            !originalMatrixWorld.equals(node.sceneNode.matrixWorld),
          );
        } else if (pointcloudTransformChanged.get(pointcloud) || node.needsTransformUpdate) {
          node.sceneNode.updateMatrix();
          node.sceneNode.matrixWorld.multiplyMatrices(
            pointcloud.matrixWorld,
            node.sceneNode.matrix,
          );
          node.needsTransformUpdate = false;
        }

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

        let weight = 0;

        const sphere = child.boundingSphere;
        const center = sphere.center;
        // let distance = sphere.center.distanceTo(camObjPos);

        const dx = camObjPos.x - center.x;
        const dy = camObjPos.y - center.y;
        const dz = camObjPos.z - center.z;

        const dd = dx * dx + dy * dy + dz * dz;
        const distance = Math.sqrt(dd);

        const radius = sphere.radius;

        const fov = camera.fov * Math.PI / 180;
        const slope = Math.tan(fov / 2);
        const projFactor = 0.5 * domHeight / (slope * distance);
        const screenPixelRadius = radius * projFactor;

        if (screenPixelRadius < pointcloud.minimumNodePixelSize) {
          continue;
        }

        weight = screenPixelRadius;

        if (distance - radius < 0) {
          weight = Number.MAX_VALUE;
        }

        priorityQueue.push({
          weight: weight,
          node: child,
          pointcloud: element.pointcloud,
          parent: node,
        });
      }
    } // end priority queue loop

    for (let i = 0; i < Math.min(this.maxNodesLoading, unloadedGeometry.length); i++) {
      unloadedGeometry[i].load();
    }

    return {
      visibleNodes: visibleNodes,
      numVisiblePoints: numVisiblePoints,
      lowestSpacing: lowestSpacing,
    };
  }

  private updateVisibilityStructures(
    pointclouds: PointCloudOctree[],
    camera: PerspectiveCamera,
  ): {
    frustums: Frustum[];
    camObjPositions: Vector3[];
    priorityQueue: BinaryHeap<QueueItem>;
  } {
    const frustums: Frustum[] = [];
    const camObjPositions = [];
    const priorityQueue = new BinaryHeap<QueueItem>(x => 1 / x.weight);

    for (let i = 0; i < pointclouds.length; i++) {
      const pointcloud = pointclouds[i];

      if (!pointcloud.initialized()) {
        continue;
      }

      pointcloud.numVisibleNodes = 0;
      pointcloud.numVisiblePoints = 0;
      pointcloud.deepestVisibleLevel = 0;
      pointcloud.visibleNodes = [];
      pointcloud.visibleGeometry = [];

      // frustum in object space
      camera.updateMatrixWorld(false);
      const frustum = new Frustum();
      const viewI = camera.matrixWorldInverse;
      const world = pointcloud.matrixWorld;

      // use close near plane for frustum intersection
      const frustumCam = camera.clone();
      frustumCam.near = Math.min(camera.near, 0.1);
      frustumCam.updateProjectionMatrix();
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
          parent: null,
        });
      }

      // hide all previously visible nodes
      // if(pointcloud.root instanceof Potree.PointCloudOctreeNode){
      // 	pointcloud.hideDescendants(pointcloud.root.sceneNode);
      // }
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

export function isGeometryNode(
  node?: IPointCloudTreeNode | null,
): node is PointCloudOctreeGeometryNode {
  return node instanceof PointCloudOctreeGeometryNode;
}

export function isTreeNode(node?: IPointCloudTreeNode | null): node is PointCloudOctreeNode {
  return node instanceof PointCloudOctreeNode;
}
