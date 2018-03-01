import { Box3, EventDispatcher, Sphere } from 'three';

export class PointCloudTreeNode extends EventDispatcher {
  needsTransformUpdate = true;

  getChildren(): PointCloudTreeNode[] {
    throw new Error('override function');
  }

  getBoundingBox(): Box3 {
    throw new Error('override function');
  }

  isLoaded(): boolean {
    throw new Error('override function');
  }

  isGeometryNode(): boolean {
    throw new Error('override function');
  }

  isTreeNode(): boolean {
    throw new Error('override function');
  }

  getLevel(): number {
    throw new Error('override function');
  }

  getBoundingSphere(): Sphere {
    throw new Error('override function');
  }
}
