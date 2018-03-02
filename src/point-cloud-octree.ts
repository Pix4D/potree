import {
  Box3,
  BufferAttribute,
  Line3,
  LinearFilter,
  NearestFilter,
  NoBlending,
  Object3D,
  PerspectiveCamera,
  Points,
  Ray,
  RGBAFormat,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { PointColorType, PointSizeType } from './materials/enums';
import { PointCloudMaterial } from './materials/point-cloud-material';
import { PointCloudOctreeGeometry } from './point-cloud-octree-geometry';
import { PointCloudOctreeGeometryNode } from './point-cloud-octree-geometry-node';
import { PointCloudOctreeNode } from './point-cloud-octree-node';
import { PointCloudTree } from './point-cloud-tree';
import { IProfile, IProfileRequestCallbacks, ProfileRequest } from './profile';
import { IPointCloudTreeNode, IPotree } from './types';
import { computeTransformedBoundingBox } from './utils/bounds';
import { clamp } from './utils/math';
import { intersectSphereBack } from './utils/utils';

export interface PickParams {
  pickWindowSize: number;
}

export class PointCloudOctree extends PointCloudTree {
  pcoGeometry: PointCloudOctreeGeometry;
  boundingBox: Box3;
  boundingSphere: Sphere;
  material: PointCloudMaterial;
  level: number = 0;
  maxLevel: number = Infinity;
  visiblePointsTarget: number = 2_1000_1000;
  minimumNodePixelSize: number = 100;
  showBoundingBox: boolean = false;
  boundingBoxNodes: Object3D[] = [];
  loadQueue: any[] = [];
  visibleBounds: Box3 = new Box3();
  visibleNodes: PointCloudOctreeNode[] = [];
  numVisibleNodes: number = 0;
  numVisiblePoints: number = 0;
  deepestVisibleLevel: number = 0;
  visibleGeometry: PointCloudOctreeGeometry[] = [];
  profileRequests: ProfileRequest[] = [];
  pointBudget: number = Infinity;
  root: IPointCloudTreeNode | null = null;

  private pickState:
    | {
        renderTarget: WebGLRenderTarget;
        material: PointCloudMaterial;
        scene: Scene;
      }
    | undefined;

  constructor(
    public potree: IPotree,
    geometry: PointCloudOctreeGeometry,
    material?: PointCloudMaterial,
  ) {
    super();

    this.name = '';
    this.pcoGeometry = geometry;
    this.boundingBox = this.pcoGeometry.boundingBox;
    this.boundingSphere = this.boundingBox.getBoundingSphere();

    this.position.copy(geometry.offset);
    this.updateMatrix();

    this.material = material || new PointCloudMaterial();
    this.initMaterial(this.material);

    this.root = this.pcoGeometry.root;
  }

  private initMaterial(material: PointCloudMaterial): void {
    let box = [this.pcoGeometry.tightBoundingBox, this.getBoundingBoxWorld()].find(
      v => v !== undefined,
    );

    if (!box) {
      return;
    }

    this.updateMatrixWorld(true);
    box = computeTransformedBoundingBox(box, this.matrixWorld);
    material.heightMin = box.min.z;
    material.heightMax = box.max.z;
  }

  get pointSizeType(): PointSizeType {
    return this.material.pointSizeType;
  }

  set pointSizeType(value: PointSizeType) {
    this.material.pointSizeType = value;
  }

  setName(name: string): void {
    if (this.name !== name) {
      this.name = name;
    }
  }

  getName() {
    return this.name;
  }

  updateProfileRequests(): void {
    const start = performance.now();

    for (let i = 0; i < this.profileRequests.length; i++) {
      const profileRequest = this.profileRequests[i];

      profileRequest.update();

      const duration = performance.now() - start;
      if (duration > 5) {
        break;
      }
    }
  }

  nodeIntersectsProfile(node: IPointCloudTreeNode, profile: IProfile) {
    const bbWorld = node.boundingBox.clone().applyMatrix4(this.matrixWorld);
    const bsWorld = bbWorld.getBoundingSphere();

    let intersects = false;

    for (let i = 0; i < profile.points.length - 1; i++) {
      const start = new Vector3(profile.points[i + 0].x, profile.points[i + 0].y, bsWorld.center.z);
      const end = new Vector3(profile.points[i + 1].x, profile.points[i + 1].y, bsWorld.center.z);

      const closest = new Line3(start, end).closestPointToPoint(bsWorld.center, true);
      const distance = closest.distanceTo(bsWorld.center);

      intersects = intersects || distance < bsWorld.radius + profile.width;
    }

    return intersects;
  }

  toTreeNode(geometryNode: PointCloudOctreeGeometryNode, parent: any) {
    const node = new PointCloudOctreeNode(geometryNode);

    const sceneNode = new Points(geometryNode.geometry, this.material);
    sceneNode.name = geometryNode.name;
    sceneNode.position.copy(geometryNode.boundingBox.min);
    sceneNode.frustumCulled = false;

    const material: any = this.material;

    sceneNode.onBeforeRender = (renderer: WebGLRenderer) => {
      if (material.program) {
        renderer.getContext().useProgram(material.program.program);

        if (material.program.getUniforms().map.level) {
          const level = geometryNode.level;
          material.uniforms.level.value = level;
          material.program.getUniforms().map.level.setValue(renderer.getContext(), level);
        }

        if (material.visibleNodeTextureOffsets && material.program.getUniforms().map.vnStart) {
          const vnStart = material.visibleNodeTextureOffsets.get(node);
          material.uniforms.vnStart.value = vnStart;
          material.program.getUniforms().map.vnStart.setValue(renderer.getContext(), vnStart);
        }

        if (material.program.getUniforms().map.pcIndex) {
          const i = node.pcIndex ? node.pcIndex : this.visibleNodes.indexOf(node);
          material.uniforms.pcIndex.value = i;
          material.program.getUniforms().map.pcIndex.setValue(renderer.getContext(), i);
        }
      }
    };

    node.sceneNode = sceneNode;
    node.pointcloud = this;
    node.children = [];
    for (const key in geometryNode.children) {
      if (geometryNode.children[key]) {
        node.children[key] = geometryNode.children[key];
      }
    }

    if (!parent) {
      this.root = node;
      this.add(sceneNode);
    } else {
      const childIndex = parseInt(geometryNode.name[geometryNode.name.length - 1], 10);
      parent.sceneNode.add(sceneNode);
      parent.children[childIndex] = node;
    }

    const disposeListener = function() {
      const childIndex = parseInt(geometryNode.name[geometryNode.name.length - 1], 10);
      parent.sceneNode.remove(node.sceneNode);
      parent.children[childIndex] = geometryNode;
    };
    geometryNode.oneTimeDisposeHandlers.push(disposeListener);

    return node;
  }

  updateVisibleBounds() {
    const leafNodes = [];
    for (let i = 0; i < this.visibleNodes.length; i++) {
      const node = this.visibleNodes[i];
      let isLeaf = true;

      const children = node.getChildren();
      for (let j = 0; j < children.length; j++) {
        const child = children[j];
        if (child instanceof PointCloudOctreeNode) {
          isLeaf = Boolean(isLeaf && child.sceneNode && !child.sceneNode.visible);
        } else if (child instanceof PointCloudOctreeGeometryNode) {
          isLeaf = true;
        }
      }

      if (isLeaf) {
        leafNodes.push(node);
      }
    }

    this.visibleBounds.min = new Vector3(Infinity, Infinity, Infinity);
    this.visibleBounds.max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < leafNodes.length; i++) {
      const node = leafNodes[i];

      this.visibleBounds.expandByPoint(node.boundingBox.min);
      this.visibleBounds.expandByPoint(node.boundingBox.max);
    }
  }

  updateMaterial(material: PointCloudMaterial, camera: PerspectiveCamera, renderer: WebGLRenderer) {
    material.fov = camera.fov * (Math.PI / 180);
    material.screenWidth = renderer.domElement.clientWidth;
    material.screenHeight = renderer.domElement.clientHeight;
    material.spacing =
      this.pcoGeometry.spacing * Math.max(this.scale.x, this.scale.y, this.scale.z);
    material.near = camera.near;
    material.far = camera.far;
    material.uniforms.octreeSize.value = this.pcoGeometry.boundingBox.getSize().x;
  }

  computeVisibilityTextureData(nodes: PointCloudOctreeNode[], camera: PerspectiveCamera) {
    const data = new Uint8Array(nodes.length * 4);
    const visibleNodeTextureOffsets = new Map<PointCloudOctreeNode, number>();

    nodes = [...nodes];

    // sort by level and index, e.g. r, r0, r3, r4, r01, r07, r30, ...
    nodes.sort((a: PointCloudOctreeNode, b: PointCloudOctreeNode) => {
      const na = a.geometryNode.name;
      const nb = b.geometryNode.name;
      if (na.length !== nb.length) {
        return na.length - nb.length;
      }
      if (na < nb) {
        return -1;
      }
      if (na > nb) {
        return 1;
      }
      return 0;
    });

    const lodRanges = new Map<number, number>();
    const leafNodeLodRanges = new Map<PointCloudOctreeNode, { distance: number; i: number }>();

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];

      visibleNodeTextureOffsets.set(node, i);

      const children: PointCloudOctreeNode[] = [];
      for (let j = 0; j < 8; j++) {
        const child = node.children[j];

        if (child && child instanceof PointCloudOctreeNode && nodes.includes(child, i)) {
          children.push(child);
        }
      }

      data[i * 4 + 0] = 0;
      data[i * 4 + 1] = 0;
      data[i * 4 + 2] = 0;
      data[i * 4 + 3] = node.level;

      for (let j = 0; j < children.length; j++) {
        const child = children[j];
        const index = parseInt(child.geometryNode.name.substr(-1), 10);
        data[i * 4 + 0] += Math.pow(2, index);

        if (j === 0) {
          const vArrayIndex = nodes.indexOf(child, i);

          // tslint:disable-next-line:no-bitwise
          data[i * 4 + 1] = (vArrayIndex - i) >> 8;
          data[i * 4 + 2] = (vArrayIndex - i) % 256;
        }
      }

      {
        const bBox: Box3 = node.boundingBox.clone();
        bBox.applyMatrix4(camera.matrixWorldInverse);

        const bSphere = bBox.getBoundingSphere();

        // let distance = center.distanceTo(camera.position);
        const ray = new Ray(camera.position, camera.getWorldDirection());
        let distance = intersectSphereBack(ray, bSphere);
        const distance2: number = bSphere.center.distanceTo(camera.position) + bSphere.radius;
        if (distance === null) {
          distance = distance2;
        }

        distance = Math.max(distance, distance2);

        const prevDistance = lodRanges.get(node.level);
        lodRanges.set(
          node.level,
          prevDistance === undefined ? distance : Math.max(prevDistance, distance),
        );

        if (!node.geometryNode.hasChildren) {
          leafNodeLodRanges.set(node, { distance, i });
        }
      }
    }

    leafNodeLodRanges.forEach(value => {
      const distance = value.distance;
      const i = value.i;

      lodRanges.forEach((range, lod) => {
        if (distance < range * 1.2) {
          data[i * 4 + 3] = lod;
        }
      });
    });

    return {
      data: data,
      offsets: visibleNodeTextureOffsets,
    };
  }

  nodesOnRay(nodes: PointCloudOctreeNode[], ray: Ray): PointCloudOctreeNode[] {
    const nodesOnRay: PointCloudOctreeNode[] = [];

    const rayClone = ray.clone();
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      // let inverseWorld = new Matrix4().getInverse(node.matrixWorld);
      // let sphere = node.getBoundingSphere().clone().applyMatrix4(node.sceneNode.matrixWorld);
      const sphere = node.boundingSphere.clone().applyMatrix4(this.matrixWorld);

      if (rayClone.intersectsSphere(sphere)) {
        nodesOnRay.push(node);
      }
    }

    return nodesOnRay;
  }

  updateMatrixWorld(force: boolean): void {
    if (this.matrixAutoUpdate === true) {
      this.updateMatrix();
    }

    if (this.matrixWorldNeedsUpdate === true || force === true) {
      if (!this.parent) {
        this.matrixWorld.copy(this.matrix);
      } else {
        this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
      }

      this.matrixWorldNeedsUpdate = false;

      force = true;
    }
  }

  hideDescendants(object: Object3D): void {
    const toHide: Object3D[] = [];
    for (let i = 0; i < object.children.length; i++) {
      const child = object.children[i];
      if (child.visible) {
        toHide.push(child);
      }
    }

    let objToHide;
    while ((objToHide = toHide.shift())) {
      objToHide.visible = false;

      for (let i = 0; i < objToHide.children.length; i++) {
        const child = objToHide.children[i];
        if (child.visible) {
          toHide.push(child);
        }
      }
    }
  }

  moveToOrigin(): void {
    this.position.set(0, 0, 0);
    this.updateMatrixWorld(true);
    const box = this.boundingBox;
    const transform = this.matrixWorld;
    const tBox = computeTransformedBoundingBox(box, transform);
    this.position.set(0, 0, 0).sub(tBox.getCenter());
  }

  moveToGroundPlane(): void {
    this.updateMatrixWorld(true);
    const box = this.boundingBox;
    const transform = this.matrixWorld;
    const tBox = computeTransformedBoundingBox(box, transform);
    this.position.y += -tBox.min.y;
  }

  getBoundingBoxWorld(): Box3 {
    this.updateMatrixWorld(true);
    const box = this.boundingBox;
    const transform = this.matrixWorld;
    const tBox = computeTransformedBoundingBox(box, transform);

    return tBox;
  }

  getVisibleExtent() {
    return this.visibleBounds.applyMatrix4(this.matrixWorld);
  }

  pick(
    renderer: WebGLRenderer,
    camera: PerspectiveCamera,
    ray: Ray,
    params: Partial<PickParams> = {},
  ) {
    const pickWindowSize = params.pickWindowSize || 17;
    const width = Math.ceil(renderer.domElement.clientWidth);
    const height = Math.ceil(renderer.domElement.clientHeight);

    const nodes: PointCloudOctreeNode[] = this.nodesOnRay(this.visibleNodes, ray);

    if (nodes.length === 0) {
      return null;
    }

    const pickState = this.pickState ? this.pickState : (this.pickState = this.getPickState());
    const pickMaterial = pickState.material;

    {
      // update pick material
      pickMaterial.pointSizeType = this.material.pointSizeType;
      pickMaterial.shape = this.material.shape;

      pickMaterial.size = this.material.size;
      pickMaterial.minSize = this.material.minSize;
      pickMaterial.maxSize = this.material.maxSize;
      pickMaterial.classification = this.material.classification;

      this.updateMaterial(pickMaterial, camera, renderer);
    }

    if (pickState.renderTarget.width !== width || pickState.renderTarget.height !== height) {
      pickState.renderTarget.dispose();
      pickState.renderTarget = new WebGLRenderTarget(1, 1, {
        minFilter: LinearFilter,
        magFilter: NearestFilter,
        format: RGBAFormat,
      });
    }
    pickState.renderTarget.setSize(width, height);
    renderer.setRenderTarget(pickState.renderTarget);

    const pixelPos = new Vector3()
      .addVectors(camera.position, ray.direction)
      .project(camera)
      .addScalar(1)
      .multiplyScalar(0.5);
    pixelPos.x *= width;
    pixelPos.y *= height;

    renderer.setScissor(
      pixelPos.x - (pickWindowSize - 1) / 2,
      pixelPos.y - (pickWindowSize - 1) / 2,
      pickWindowSize,
      pickWindowSize,
    );
    renderer.setScissorTest(true);

    renderer.state.buffers.depth.setTest(pickMaterial.depthTest);
    (renderer.state.buffers.depth as any).setMask(pickMaterial.depthWrite);
    (renderer.state as any).setBlending(NoBlending);

    renderer.clearTarget(pickState.renderTarget, true, true, true);

    const tempNodes = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      node.pcIndex = i + 1;
      const sceneNode = node.sceneNode;
      if (!sceneNode) {
        continue;
      }

      const tempNode = new Points(sceneNode.geometry, pickMaterial);
      tempNode.matrix = sceneNode.matrix;
      tempNode.matrixWorld = sceneNode.matrixWorld;
      tempNode.matrixAutoUpdate = false;
      tempNode.frustumCulled = false;
      (tempNode as any).pcIndex = i + 1;

      const geometryNode = node.geometryNode;
      const material: any = pickMaterial;
      tempNode.onBeforeRender = () => {
        if (material.program) {
          renderer.getContext().useProgram(material.program.program);

          if (material.program.getUniforms().map.level) {
            const level = geometryNode.level;
            material.uniforms.level.value = level;
            material.program.getUniforms().map.level.setValue(renderer.getContext(), level);
          }

          if (material.visibleNodeTextureOffsets && material.program.getUniforms().map.vnStart) {
            const vnStart = material.visibleNodeTextureOffsets.get(node);
            material.uniforms.vnStart.value = vnStart;
            material.program.getUniforms().map.vnStart.setValue(renderer.getContext(), vnStart);
          }

          if (material.program.getUniforms().map.pcIndex) {
            material.uniforms.pcIndex.value = node.pcIndex;
            material.program
              .getUniforms()
              .map.pcIndex.setValue(renderer.getContext(), node.pcIndex);
          }
        }
      };
      tempNodes.push(tempNode);
    }

    pickState.scene.autoUpdate = false;
    pickState.scene.children = tempNodes;
    // pickState.scene.overrideMaterial = pickMaterial;

    (renderer.state as any).setBlending(NoBlending);

    // RENDER
    renderer.render(pickState.scene, camera, pickState.renderTarget);

    const x = clamp(pixelPos.x - (pickWindowSize - 1) / 2, 0, width);
    const y = clamp(pixelPos.y - (pickWindowSize - 1) / 2, 0, height);
    const w = Math.min(x + pickWindowSize, width) - x;
    const h = Math.min(y + pickWindowSize, height) - y;

    const pixelCount = w * h;
    const buffer = new Uint8Array(4 * pixelCount);
    renderer.readRenderTargetPixels(pickState.renderTarget, x, y, w, h, buffer);

    renderer.setScissorTest(false);

    renderer.setRenderTarget(null!);

    const pixels = buffer;
    const ibuffer = new Uint32Array(buffer.buffer);

    // find closest hit inside pixelWindow boundaries
    let min = Number.MAX_VALUE;
    let hit = null;
    for (let u = 0; u < pickWindowSize; u++) {
      for (let v = 0; v < pickWindowSize; v++) {
        const offset = u + v * pickWindowSize;
        const distance =
          Math.pow(u - (pickWindowSize - 1) / 2, 2) + Math.pow(v - (pickWindowSize - 1) / 2, 2);

        const pcIndex = pixels[4 * offset + 3];
        pixels[4 * offset + 3] = 0;
        const pIndex = ibuffer[offset];

        if (pcIndex > 0 && distance < min) {
          hit = {
            pIndex: pIndex,
            pcIndex: pcIndex - 1,
          };
          min = distance;
        }
      }
    }

    let point: any = null;

    if (hit) {
      point = {};

      const node = nodes[hit.pcIndex];
      const pc = node && node.sceneNode;
      if (!pc) {
        return null;
      }

      const attributes: BufferAttribute[] = (pc.geometry as any).attributes;

      for (const property in attributes) {
        if (attributes.hasOwnProperty(property)) {
          const values = attributes[property];

          if (property === 'position') {
            const positionArray = values.array;
            // tslint:disable-next-line:no-shadowed-variable
            const x = positionArray[3 * hit.pIndex + 0];
            // tslint:disable-next-line:no-shadowed-variable
            const y = positionArray[3 * hit.pIndex + 1];
            const z = positionArray[3 * hit.pIndex + 2];
            const position = new Vector3(x, y, z);
            position.applyMatrix4(pc.matrixWorld);

            point[property] = position;
          } else if (property === 'indices') {
          } else {
            if (values.itemSize === 1) {
              point[property] = values.array[hit.pIndex];
            } else {
              const value = [];
              for (let j = 0; j < values.itemSize; j++) {
                value.push(values.array[values.itemSize * hit.pIndex + j]);
              }
              point[property] = value;
            }
          }
        }
      }
    }

    return point;
  }

  /**
   * returns points inside the profile points
   *
   * maxDepth:		search points up to the given octree depth
   *
   *
   * The return value is an array with all segments of the profile path
   *  let segment = {
   * 		start: 	THREE.Vector3,
   * 		end: 	THREE.Vector3,
   * 		points: {}
   * 		project: function()
   *  };
   *
   * The project() function inside each segment can be used to transform
   * that segments point coordinates to line up along the x-axis.
   *
   *
   */
  getPointsInProfile(
    profile: IProfile,
    maxDepth: number,
    callback: IProfileRequestCallbacks,
  ): ProfileRequest {
    const request = new ProfileRequest(this, profile, maxDepth, callback);
    this.profileRequests.push(request);

    return request;
  }

  private getPickState() {
    const scene = new Scene();

    const material = new PointCloudMaterial();
    material.pointColorType = PointColorType.POINT_INDEX;

    const renderTarget = new WebGLRenderTarget(1, 1, {
      minFilter: LinearFilter,
      magFilter: NearestFilter,
      format: RGBAFormat,
    });

    return {
      renderTarget: renderTarget,
      material: material,
      scene: scene,
    };
  }

  get progress() {
    return this.visibleNodes.length / this.visibleGeometry.length;
  }
}
