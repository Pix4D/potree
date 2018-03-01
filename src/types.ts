import { Box3, PerspectiveCamera, Sphere, WebGLRenderer } from 'three';
import { LRU } from './utils/lru';

export interface IPointCloudOctree {}

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

export interface IVisibilityUpdateResult {
  visibleNodes: IPointCloudTreeNode[];
  numVisiblePoints: number;
  lowestSpacing: number;
}

export interface IPotree {
  pointBudget: number;
  numNodesLoading: number;
  maxNodesLoading: number;

  getLRU(): LRU;
  updatePointClouds(
    pointClouds: IPointCloudOctree[],
    camera: PerspectiveCamera,
    renderer: WebGLRenderer,
  ): IVisibilityUpdateResult;
}
