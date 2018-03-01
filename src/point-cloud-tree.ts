import { Object3D } from 'three';
import { IPointCloudTreeNode } from './point-cloud-tree-node';

export class PointCloudTree extends Object3D {
  root: IPointCloudTreeNode | null;

  initialized() {
    return this.root !== null;
  }
}
