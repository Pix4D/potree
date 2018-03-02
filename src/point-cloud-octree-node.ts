import { Box3, EventDispatcher, Object3D, Points, Sphere } from 'three';
import { PointCloudOctree } from './point-cloud-octree';
import { PointCloudOctreeGeometryNode } from './point-cloud-octree-geometry-node';
import { IPointCloudTreeNode } from './types';

export class PointCloudOctreeNode extends EventDispatcher implements IPointCloudTreeNode {
  needsTransformUpdate: boolean = true;
  sceneNode: Points | null = null;
  children: (IPointCloudTreeNode | undefined)[] = [];
  boundingBoxNode: Object3D | null = null;
  pointcloud!: PointCloudOctree;
  pcIndex?: number;
  readonly loaded = true;

  isTreeNode: boolean = true;
  isGeometryNode: boolean = false;

  constructor(public geometryNode: PointCloudOctreeGeometryNode) {
    super();
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

  get numPoints(): number {
    return this.geometryNode.numPoints;
  }

  get level(): number {
    return this.geometryNode.level;
  }

  get boundingSphere(): Sphere {
    return this.geometryNode.boundingSphere;
  }

  get boundingBox(): Box3 {
    return this.geometryNode.boundingBox;
  }

  get spacing() {
    return this.geometryNode.spacing;
  }

  get name() {
    return this.geometryNode.name;
  }
}
