import { LRU } from './utils/lru';

export interface IPointCloudOctree {}

export interface IPotree {
  getLRU(): LRU;
}
