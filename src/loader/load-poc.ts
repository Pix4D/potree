// -------------------------------------------------------------------------------------------------
// Converted to Typescript and adapted from https://github.com/potree/potree
// -------------------------------------------------------------------------------------------------

import { ajax } from 'rxjs/observable/dom/ajax';
import { flatMap, map, take } from 'rxjs/operators';
import { notNil } from 'shared/rx';
import { S3UrlInfo } from 'shared/types';
import { Box3, Vector3 } from 'three';
import { Progress, SignFn } from '../loading/types';
import { BinaryLoader } from './binary-loader';
import { PointAttributeNameType, PointAttributes } from './point-attributes';
import { PointCloudOctreeGeometry } from './point-cloud-octree-geometry';
import { PointCloudOctreeGeometryNode } from './point-cloud-octree-geometry-node';
import { Version } from './version';

interface BoundingBoxData {
  lx: number;
  ly: number;
  lz: number;
  ux: number;
  uy: number;
  uz: number;
}

interface POCJson {
  version: string;
  octreeDir: string;
  projection: string;
  scale: number;
  spacing: number;
  hierarchyStepSize: number;
  hierarchy: [string, number][]; // [name, numPoints][]
  pointAttributes: PointAttributeNameType[];
  boundingBox: BoundingBoxData;
  tightBoundingBox?: BoundingBoxData;
}

export function loadPOC(
  s3UrlInfo: S3UrlInfo,
  sign: SignFn,
  onSuccess: (geometry: PointCloudOctreeGeometry) => void,
  _: (progress: Progress) => void,
  onError: (error: Error) => void,
) {
  sign(s3UrlInfo)
    .pipe(
      notNil(),
      take(1),
      flatMap(url => {
        return ajax({
          url,
          method: 'GET',
          responseType: 'text',
          async: true,
          crossDomain: true,
        }).pipe(map(e => JSON.parse(e.response)), map(parse(url, s3UrlInfo, sign)));
      }),
    )
    .subscribe(onSuccess, onError);
}

function parse(url: string, s3UrlInfo: S3UrlInfo, sign: SignFn) {
  return (data: POCJson): PointCloudOctreeGeometry => {
    const { offset, boundingBox, tightBoundingBox } = getBoundingBoxes(data);
    const loader = new BinaryLoader(data.version, boundingBox, data.scale);
    const pco = new PointCloudOctreeGeometry(loader, boundingBox, tightBoundingBox, offset);
    pco.url = url;
    pco.needsUpdate = true;

    // Store the necessary information for the modified PointCloudOctreeGeometryNode to be able to
    // sign urls and load tiles.
    pco.sign = sign;
    pco.s3Bucket = s3UrlInfo.s3Bucket;
    pco.s3Key = s3UrlInfo.s3Key
      .split('/')
      .slice(0, -1) // Exclude the name since we only want the base path
      .join('/');

    pco.octreeDir = data.octreeDir;
    pco.spacing = data.spacing;
    pco.hierarchyStepSize = data.hierarchyStepSize;
    pco.projection = data.projection;
    pco.offset = offset;
    pco.pointAttributes = new PointAttributes(data.pointAttributes);

    const nodes: Record<string, PointCloudOctreeGeometryNode> = {};

    const version = new Version(data.version);

    loadRoot(pco, data, nodes, version);

    if (version.upTo('1.4')) {
      loadRemainingHierarchy(pco, data, nodes);
    }

    pco.nodes = nodes;

    return pco;
  };
}

function getBoundingBoxes(
  data: POCJson,
): { offset: Vector3; boundingBox: Box3; tightBoundingBox: Box3 } {
  const min = new Vector3(data.boundingBox.lx, data.boundingBox.ly, data.boundingBox.lz);
  const max = new Vector3(data.boundingBox.ux, data.boundingBox.uy, data.boundingBox.uz);
  const boundingBox = new Box3(min, max);
  const tightBoundingBox = boundingBox.clone();

  const offset = min.clone();

  if (data.tightBoundingBox) {
    const { lx, ly, lz, ux, uy, uz } = data.tightBoundingBox;
    tightBoundingBox.min.set(lx, ly, lz);
    tightBoundingBox.max.set(ux, uy, uz);
  }

  boundingBox.min.sub(offset);
  boundingBox.max.sub(offset);
  tightBoundingBox.min.sub(offset);
  tightBoundingBox.max.sub(offset);

  return { offset, boundingBox, tightBoundingBox };
}

function loadRoot(
  pco: PointCloudOctreeGeometry,
  data: POCJson,
  nodes: Record<string, PointCloudOctreeGeometryNode>,
  version: Version,
): void {
  const name = 'r';

  const root = new PointCloudOctreeGeometryNode(name, pco, pco.boundingBox);
  root.level = 0;
  root.hasChildren = true;
  root.spacing = pco.spacing;

  if (version.upTo('1.5')) {
    root.numPoints = data.hierarchy[0][1];
  } else {
    root.numPoints = 0;
  }

  pco.root = root;
  pco.root.load();
  nodes[name] = root;
}

function loadRemainingHierarchy(
  pco: PointCloudOctreeGeometry,
  data: POCJson,
  nodes: Record<string, PointCloudOctreeGeometryNode>,
): void {
  for (let i = 1; i < data.hierarchy.length; i++) {
    const name = data.hierarchy[i][0];
    const numPoints = data.hierarchy[i][1];

    const { index, parentName, level } = parseName(name);
    const parentNode = nodes[parentName];

    const boundingBox = createChildAABB(parentNode.getBoundingBox(), index);
    const node = new PointCloudOctreeGeometryNode(name, pco, boundingBox);
    node.level = level;
    node.numPoints = numPoints;
    node.spacing = pco.spacing / Math.pow(2, node.level);

    nodes[name] = node;
    parentNode.addChild(node);
  }
}

function parseName(name: string): { index: number; parentName: string; level: number } {
  return {
    index: parseInt(name.charAt(name.length - 1), 10),
    parentName: name.substring(0, name.length - 1),
    level: name.length - 1,
  };
}

export function createChildAABB(aabb: Box3, index: number): Box3 {
  const min = aabb.min.clone();
  const max = aabb.max.clone();
  const size = new Vector3().subVectors(max, min);

  // tslint:disable-next-line:no-bitwise
  if ((index & 0b0001) > 0) {
    min.z += size.z / 2;
  } else {
    max.z -= size.z / 2;
  }

  // tslint:disable-next-line:no-bitwise
  if ((index & 0b0010) > 0) {
    min.y += size.y / 2;
  } else {
    max.y -= size.y / 2;
  }

  // tslint:disable-next-line:no-bitwise
  if ((index & 0b0100) > 0) {
    min.x += size.x / 2;
  } else {
    max.x -= size.x / 2;
  }

  return new Box3(min, max);
}
