/**
 * Adapted from Potree.js http://potree.org
 * Potree License: https://github.com/potree/potree/blob/1.5/LICENSE
 */

import { ajax } from 'rxjs/observable/dom/ajax';
import { switchMap, take } from 'rxjs/operators';
import { notNil } from 'shared/rx';
import { Box3, BufferGeometry, Sphere, Vector3 } from 'three';
import { createChildAABB } from './loadPOC';
import { PointCloudOctreeGeometry } from './point-cloud-octree-geometry';
import { PointCloudTreeNode } from './point-cloud-tree-node';

interface NodeData {
  children: number;
  numPoints: number;
  name: string;
}

const NODE_STRIDE = 5;

export class PointCloudOctreeGeometryNode extends PointCloudTreeNode {
  id: number = PointCloudOctreeGeometryNode.idCount++;
  name: string;
  pcoGeometry: PointCloudOctreeGeometry;
  index: number;
  level: number = 0;
  spacing: number = 0;
  hasChildren: boolean = false;
  boundingBox: Box3;
  tightBoundingBox: Box3;
  tightBoundingSphere: Sphere;
  mean: Vector3;
  numPoints: number = 0;
  geometry: BufferGeometry = new BufferGeometry();
  loaded: boolean = false;
  loading: boolean;
  boundingSphere: Sphere = this.boundingBox.getBoundingSphere();
  parent: PointCloudOctreeGeometryNode;
  children: (PointCloudOctreeGeometryNode | undefined)[] = [];
  oneTimeDisposeHandlers: (() => void)[] = [];

  private static idCount = 0;

  constructor(
    name: string,
    pcoGeometry: PointCloudOctreeGeometry,
    boundingBox: Box3,
  ) {
    super();

    this.name = name;
    this.pcoGeometry = pcoGeometry;
    this.boundingBox = boundingBox;
    this.index = parseInt(name.charAt(name.length - 1), 10);
  }

  isGeometryNode() {
    return true;
  }

  getLevel(): number {
    return this.level;
  }

  isTreeNode() {
    return false;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  getBoundingSphere(): Sphere {
    return this.boundingSphere;
  }

  getBoundingBox(): Box3 {
    return this.boundingBox;
  }

  getChildren(): PointCloudOctreeGeometryNode[] {
    const children: PointCloudOctreeGeometryNode[] = [];

    for (let i = 0; i < 8; i++) {
      const child = this.children[i];
      if (child) {
        children.push(child);
      }
    }

    return children;
  }

  getURL(): string {
    const geometry = this.pcoGeometry;
    const pathParts = [geometry.s3Key, geometry.octreeDir];

    if (geometry.loader && geometry.loader.version.equalOrHigher('1.5')) {
      pathParts.push(this.getHierarchyPath());
    }

    pathParts.push(this.name);

    return pathParts.join('/');
  }

  getHierarchyPath(): string {
    const hierarchyStepSize = this.pcoGeometry.hierarchyStepSize;
    const indices = this.name.substr(1);
    const numParts = Math.floor(indices.length / hierarchyStepSize);

    let path = 'r/';
    for (let i = 0; i < numParts; i++) {
      path += `${indices.substr(i * hierarchyStepSize, hierarchyStepSize)}/`;
    }

    return path.slice(0, -1);
  }

  addChild(child: PointCloudOctreeGeometryNode): void {
    this.children[child.index] = child;
    child.parent = this;
  }

  load(): void {
    if (this.loading === true || this.loaded === true || this.pcoGeometry.numNodesLoading > 3) {
      return;
    }

    this.loading = true;

    this.pcoGeometry.numNodesLoading++;
    this.pcoGeometry.needsUpdate = true;

    if (this.pcoGeometry.loader.version.equalOrHigher('1.5')) {
      if (this.level % this.pcoGeometry.hierarchyStepSize === 0 && this.hasChildren) {
        this.loadHierachyThenPoints();
      } else {
        this.loadPoints();
      }
    } else {
      this.loadPoints();
    }
  }

  loadPoints(): void {
    this.pcoGeometry.loader.load(this);
    this.pcoGeometry.needsUpdate = true;
  }

  loadHierachyThenPoints(): void {
    const geometry = this.pcoGeometry;
    if (!geometry.sign || this.level % this.pcoGeometry.hierarchyStepSize !== 0 || ) {
      return;
    }

    const s3Key = [
      geometry.s3Key,
      geometry.octreeDir,
      this.getHierarchyPath(),
      `${this.name}.hrc`,
    ].join('/');

    geometry.sign({ s3Bucket: this.pcoGeometry.s3Bucket, s3Key })
      .pipe(take(1), notNil(), switchMap(url => this.loadHierarchyData(url)))
      .subscribe(e => this.loadHierarchy(this, e.response));
  }

  private loadHierarchyData(url: string) {
    return ajax({
      url,
      responseType: 'arraybuffer',
      method: 'GET',
      async: true,
      crossDomain: true,
      createXHR: () => {
        const xhr = new XMLHttpRequest();
        xhr.overrideMimeType('text/plain; charset=x-user-defined');
        return xhr;
      },
    });
  }

  // tslint:disable:no-bitwise
  private loadHierarchy(node: PointCloudOctreeGeometryNode, buffer: ArrayBuffer) {
    const view = new DataView(buffer);

    // Nodes which need be visited.
    const stack: NodeData[] = [this.getNodeData(node.name, 0, view)];
    // Nodes which have already been decoded. We will take nodes from the stack and place them here.
    const decoded: NodeData[] = [];

    let offset = NODE_STRIDE;
    let stackNodeData;

    while (stackNodeData = stack.shift()) {
      // From the last bit, all the way to the 8th one from the right.
      let mask = 1;
      for (let i = 0; i < 8; i++) {
        if ((stackNodeData.children & mask) !== 0) {
          const nodeData = this.getNodeData(stackNodeData.name + i, offset, view);

          decoded.push(nodeData); // Node is decoded.
          stack.push(nodeData); // Need to check its children.

          offset += NODE_STRIDE; // Move over to the next node in the buffer.
        }

        mask = mask << 1;
      }

      if (offset === buffer.byteLength) {
        break;
      }
    }

    node.pcoGeometry.needsUpdate = true;

    // Map containing all the nodes.
    const nodes = new Map<string, PointCloudOctreeGeometryNode>();
    nodes.set(node.name, node);

    decoded.forEach(nodeData => this.addNode(nodeData, node.pcoGeometry, nodes));

    node.loadPoints();
  }

  // tslint:enable:no-bitwise

  private getNodeData(name: string, offset: number, view: DataView): NodeData {
    const children = view.getUint8(offset);
    const numPoints = view.getUint32(offset + 1, true);
    return { children: children, numPoints: numPoints, name };
  }

  private addNode(
    { name, numPoints, children }: NodeData,
    pco: PointCloudOctreeGeometry,
    nodes: Map<string, PointCloudOctreeGeometryNode>,
  ): void {
    const index = parseInt(name.charAt(name.length - 1), 10);
    const parentName = name.substring(0, name.length - 1);
    const parentNode = nodes.get(parentName);
    if (!parentNode) {
      return;
    }

    const boundingBox = createChildAABB(parentNode.boundingBox, index);

    const node = new PointCloudOctreeGeometryNode(name, pco, boundingBox);
    node.level = name.length - 1;
    node.numPoints = numPoints;
    node.hasChildren = children > 0;
    node.spacing = pco.spacing / Math.pow(2, node.level);

    parentNode.addChild(node);
  }

  getNumPoints(): number {
    return this.numPoints;
  }

  dispose(): void {
    if (!this.geometry || !this.parent) {
      return;
    }

    this.geometry.dispose();
    this.geometry = null;
    this.loaded = false;

    this.oneTimeDisposeHandlers.forEach(handler => handler());
    this.oneTimeDisposeHandlers = [];
  }
}
