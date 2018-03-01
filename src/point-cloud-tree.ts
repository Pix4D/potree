import { Object3D } from 'three';
import { PointCloudTreeNode } from './point-cloud-tree-node';

export class PointCloudTree extends Object3D {
  root: PointCloudTreeNode;

  initialized() {
    return this.root !== null;
  }
}
