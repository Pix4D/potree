import { Box3, Matrix4, Object3D, Sphere, Vector3, Vector4 } from 'three';
import { PointCloudMaterial, PointSizeType } from './materials';
import { PointCloudOctreeGeometry } from './point-cloud-octree-geometry';
import { PointCloudOctreeGeometryNode } from './point-cloud-octree-geometry-node';
import { PointCloudTreeNode } from './point-cloud-tree-node';

interface IPointCloudOctree {}

export class PointCloudOctreeNode extends PointCloudTreeNode {
  sceneNode: Object3D | null = null;
  children: (PointCloudOctreeNode | undefined)[] = [];
  pcoGeometry: PointCloudOctreeGeometry;
  boundingBox: Box3;
  boundingSphere: Sphere;
  material: PointCloudMaterial;
  visiblePointsTarget: number;
  minimumNodePixelSize: number;
  showBoundingBox: boolean;
  boundingBoxNodes: any[];
  loadQueue: any[];
  visibleBounds: Box3;
  visibleNodes: PointCloudOctreeNode;
  visibleGeometry: PointCloudOctreeGeometry[];
  generateDEM: boolean;
  profileRequests: any[];
  pointSizeType: PointSizeType;
  pointcloud: IPointCloudOctree;

  constructor(public geometryNode: PointCloudOctreeGeometryNode) {
    super();
  }

  getNumPoints(): number {
    return this.geometryNode.numPoints;
  }

  isLoaded(): boolean {
    return true;
  }

  isTreeNode(): boolean {
    return true;
  }

  isGeometryNode(): boolean {
    return false;
  }

  getLevel(): number {
    return this.geometryNode.level;
  }

  getBoundingSphere() {
    return this.geometryNode.getBoundingSphere();
  }

  getBoundingBox() {
    return this.geometryNode.getBoundingBox();
  }

  getChildren(): PointCloudOctreeNode[] {
    const children: PointCloudOctreeNode[] = [];

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

  get name() {
    return this.geometryNode.name;
  }
}
