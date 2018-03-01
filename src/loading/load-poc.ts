// -------------------------------------------------------------------------------------------------
// Converted to Typescript and adapted from https://github.com/potree/potree
// -------------------------------------------------------------------------------------------------

import { Observable } from 'rxjs/Observable';
import { ajax } from 'rxjs/observable/dom/ajax';
import { flatMap, map, take } from 'rxjs/operators';
import { Box3, Vector3 } from 'three';
import { PointAttributeNameType, PointAttributes } from '../point-attributes';
import { PointCloudOctreeGeometry } from '../point-cloud-octree-geometry';
import { PointCloudOctreeGeometryNode } from '../point-cloud-octree-geometry-node';
import { createChildAABB } from '../utils/bounds';
import { notNil } from '../utils/rx';
import { Version } from '../version';
import { BinaryLoader } from './binary-loader';
import { GetUrlFn } from './types';

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

/**
 *
 * @param url$
 *    Observable which emits the url of the point cloud file (usually cloud.js).
 * @param signRelativeUrl
 *    Function which receives the relative URL of a point cloud chunk file which is to be loaded
 *    and shoud return an observable which emits the new url.
 *
 * @returns
 *    An observable which emits once when the first LOD of the point cloud is loaded.
 */
export function loadPOC(
  url$: Observable<string>,
  getUrl: GetUrlFn,
): Observable<PointCloudOctreeGeometry> {
  return url$.pipe(
    notNil(),
    take(1),
    flatMap(url => {
      return ajax({
        url,
        method: 'GET',
        responseType: 'text',
        async: true,
        crossDomain: true,
      }).pipe(map(e => JSON.parse(e.response)), map(parse(url, getUrl)));
    }),
  );
}

function parse(url: string, getUrl: GetUrlFn) {
  return (data: POCJson): PointCloudOctreeGeometry => {
    const { offset, boundingBox, tightBoundingBox } = getBoundingBoxes(data);

    const loader = new BinaryLoader({
      getUrl,
      version: data.version,
      boundingBox,
      scale: data.scale,
    });

    const pco = new PointCloudOctreeGeometry(loader, boundingBox, tightBoundingBox, offset);

    pco.url = url;
    pco.needsUpdate = true;
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
