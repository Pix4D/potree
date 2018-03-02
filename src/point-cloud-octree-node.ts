import { Box3, EventDispatcher, Matrix4, Object3D, Points, Sphere, Vector3, Vector4 } from 'three';
import { PointSizeType } from './materials/enums';
import { PointCloudMaterial } from './materials/point-cloud-material';
import { PointCloudOctree } from './point-cloud-octree';
import { PointCloudOctreeGeometry } from './point-cloud-octree-geometry';
import { PointCloudOctreeGeometryNode } from './point-cloud-octree-geometry-node';
import { ProfileRequest } from './profile';
import { IPointCloudTreeNode } from './types';

export class PointCloudOctreeNode extends EventDispatcher implements IPointCloudTreeNode {
  needsTransformUpdate: boolean = true;
  sceneNode: Points | null = null;
  children: (IPointCloudTreeNode | undefined)[] = [];
  pcoGeometry!: PointCloudOctreeGeometry;
  material!: PointCloudMaterial;
  visiblePointsTarget: number = 0;
  minimumNodePixelSize: number = 0;
  showBoundingBox: boolean = false;
  boundingBoxNode: Object3D | null = null;
  loadQueue: any[] = [];
  visibleBounds: Box3 = new Box3();
  visibleNodes: PointCloudOctreeNode[] = [];
  visibleGeometry: PointCloudOctreeGeometry[] = [];
  profileRequests: ProfileRequest[] = [];
  pointSizeType: PointSizeType = PointSizeType.ADAPTIVE;
  pointcloud!: PointCloudOctree;
  pcIndex?: number;
  readonly loaded = true;

  constructor(public geometryNode: PointCloudOctreeGeometryNode) {
    super();
  }

  get numPoints(): number {
    return this.geometryNode.numPoints;
  }

  get level(): number {
    return this.geometryNode.level;
  }

  get boundingSphere(): Sphere {
    return this.geometryNode.getBoundingSphere();
  }

  get boundingBox() {
    return this.geometryNode.getBoundingBox();
  }

  getChildren(): IPointCloudTreeNode[] {
    const children: IPointCloudTreeNode[] = [];

    for (let i = 0; i < 8; i++) {
      const child = this.children[i];
      if (child) {
        children.push(child);
      }
    }

    return children;
  }

  getPointsInBox(boxNode: Object3D) {
    if (!this.sceneNode) {
      return null;
    }

    // TODO: wtf... buffer doesn't exist
    const buffer = (this.geometryNode as any).buffer;

    const posOffset = buffer.offset('position');
    const stride = buffer.stride;
    const view = new DataView(buffer.data);

    const worldToBox = new Matrix4().getInverse(boxNode.matrixWorld);
    const objectToBox = new Matrix4().multiplyMatrices(worldToBox, this.sceneNode.matrixWorld);

    const inBox: Vector3[] = [];

    const pos = new Vector4();
    for (let i = 0; i < buffer.numElements; i++) {
      const x = view.getFloat32(i * stride + posOffset + 0, true);
      const y = view.getFloat32(i * stride + posOffset + 4, true);
      const z = view.getFloat32(i * stride + posOffset + 8, true);

      pos.set(x, y, z, 1);
      pos.applyMatrix4(objectToBox);

      if (-0.5 < pos.x && pos.x < 0.5) {
        if (-0.5 < pos.y && pos.y < 0.5) {
          if (-0.5 < pos.z && pos.z < 0.5) {
            pos.set(x, y, z, 1).applyMatrix4(this.sceneNode.matrixWorld);
            inBox.push(new Vector3(pos.x, pos.y, pos.z));
          }
        }
      }
    }

    return inBox;
  }

  get spacing() {
    return this.geometryNode.spacing;
  }

  get name() {
    return this.geometryNode.name;
  }
}
