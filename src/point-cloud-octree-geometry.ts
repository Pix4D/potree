import { Observable } from 'rxjs/Observable';
import { S3UrlInfo } from 'shared/types';
import { Box3, Sphere, Vector3 } from 'three';
import { BinaryLoader } from './binary-loader';
import { PointAttributes } from './point-attributes';
import { PointCloudOctreeGeometryNode } from './point-cloud-octree-geometry-node';

export class PointCloudOctreeGeometry {
  root: PointCloudOctreeGeometryNode;
  octreeDir: string = '';
  hierarchyStepSize: number = -1;
  nodes: Record<string, PointCloudOctreeGeometryNode> = {};
  numNodesLoading: number = 0;
  spacing: number = 0;
  boundingSphere: Sphere;
  tightBoundingSphere: Sphere;
  pointAttributes: PointAttributes = new PointAttributes([]);
  projection: any = null;
  url: string | null = null;
  s3Bucket: string = '';
  s3Key: string = '';
  sign: ((url: S3UrlInfo) => Observable<string | undefined>) | undefined;
  needsUpdate: boolean = true;

  constructor(
    public loader: BinaryLoader,
    public boundingBox: Box3,
    public tightBoundingBox: Box3,
    public offset: Vector3,
  ) {
    this.boundingSphere = boundingBox.getBoundingSphere();
    this.tightBoundingSphere = tightBoundingBox.getBoundingSphere();
  }
}
