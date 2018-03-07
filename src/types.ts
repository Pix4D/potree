import { Observable } from 'rxjs/Observable';
import { Box3, PerspectiveCamera, Sphere, WebGLRenderer } from 'three';
import { GetUrlFn } from './loading/types';
import { PointCloudOctree } from './point-cloud-octree';
import { LRU } from './utils/lru';

export interface IPointCloudTreeNode {
  name: string;
  level: number;
  index: number;
  spacing: number;
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
  maxNodesLoading: number;
  lru: LRU;

  loadPointCloud(url$: Observable<string>, getUrl: GetUrlFn): Observable<PointCloudOctree>;

  updatePointClouds(
    pointClouds: PointCloudOctree[],
    camera: PerspectiveCamera,
    renderer: WebGLRenderer,
  ): IVisibilityUpdateResult;
}
