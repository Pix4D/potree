import { Box3, Sphere } from 'three';

export interface IPointCloudTreeNode {
  needsTransformUpdate: boolean;
  spacing: number;
  level: number;
  boundingBox: Box3;
  boundingSphere: Sphere;
  loaded: boolean;
  numPoints: number;

  getChildren(): IPointCloudTreeNode[];
}
