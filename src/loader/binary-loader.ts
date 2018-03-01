// -------------------------------------------------------------------------------------------------
// Converted to Typescript and adapted from https://github.com/potree/potree
// -------------------------------------------------------------------------------------------------

import { Observable } from 'rxjs/Observable';
import { ajax } from 'rxjs/observable/dom/ajax';
import { empty } from 'rxjs/observable/empty';
import { flatMap, map, take } from 'rxjs/operators';
import { notNil } from 'shared/rx/nil';
import { Box3, BufferAttribute, BufferGeometry, Uint8BufferAttribute, Vector3 } from 'three';
import { PointAttributeName, PointAttributeType } from '../point-attributes';
import { PointCloudOctreeGeometryNode } from '../point-cloud-octree-geometry-node';
import { Version } from '../version';

interface AttributeData {
  attribute: {
    name: PointAttributeName;
    type: PointAttributeType;
    byteSize: number;
    numElements: number;
  };
  buffer: ArrayBuffer;
}

interface WorkerResponse {
  data: {
    attributeBuffers: { [name: string]: AttributeData };
    indices: ArrayBuffer;
    tightBoundingBox: { min: number[]; max: number[] };
    mean: number[];
  };
}

export class BinaryLoader {
  version: Version;
  boundingBox: Box3;
  scale: number;
  private workers: Worker[] = [];

  constructor(version: string, boundingBox: Box3, scale: number) {
    if (typeof version === 'string') {
      this.version = new Version(version);
    } else {
      this.version = version;
    }

    this.boundingBox = boundingBox;
    this.scale = scale;
  }

  load(node: PointCloudOctreeGeometryNode) {
    if (node.isLoaded() || !(node.pcoGeometry as any).sign) {
      return;
    }

    this.getSignedUrl(node)
      .pipe(take(1), notNil(), flatMap(url => this.fetchData(url)))
      .subscribe(buffer => {
        this.parse(node, buffer);
      });
  }

  private fetchData(url: string): Observable<ArrayBuffer> {
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
    }).pipe(map(e => e.response));
  }

  private getSignedUrl(node: PointCloudOctreeGeometryNode): Observable<string | undefined> {
    const { s3Bucket, sign } = node.pcoGeometry as any;
    if (!sign || !s3Bucket) {
      return empty<never>();
    }

    let unsignedUrl = node.getURL();
    if (this.version.equalOrHigher('1.4')) {
      unsignedUrl += '.bin';
    }

    return sign({ s3Key: unsignedUrl, s3Bucket });
  }

  private parse = (
    node: PointCloudOctreeGeometryNode,
    buffer: ArrayBuffer,
    worker?: Worker,
  ): void => {
    if (!worker) {
      this.getWorker().then(w => this.parse(node, buffer, w));
      return;
    }

    const pointAttributes = node.pcoGeometry.pointAttributes;
    const numPoints = buffer.byteLength / pointAttributes.byteSize;

    if (this.version.upTo('1.5')) {
      node.numPoints = numPoints;
    }

    worker.onmessage = (e: WorkerResponse) => {
      const data = e.data;

      this.addBufferAttributes(node.geometry, data.attributeBuffers);
      this.addNormalAttribute(node.geometry, numPoints);

      node.geometry.boundingBox = node.getBoundingBox();
      node.mean = new Vector3().fromArray(data.mean);
      node.tightBoundingBox = this.getTightBoundingBox(data.tightBoundingBox);
      node.loaded = true;
      node.loading = false;
      node.pcoGeometry.numNodesLoading--;
      node.pcoGeometry.needsUpdate = true;

      this.releaseWorker(worker);
    };

    const message = {
      buffer,
      pointAttributes,
      version: this.version.version,
      min: node.boundingBox.min.toArray(),
      offset: node.pcoGeometry.offset.toArray(),
      scale: this.scale,
    };

    worker.postMessage(message, [message.buffer]);
  };

  private getNewWorker(): Promise<Worker> {
    return new Promise<Worker>(resolve => {
      (require as any)(['worker-loader!./BinaryDecoderWorker.js'], (ctor: any) => {
        resolve(new ctor());
      });
    });
  }

  private getWorker(): Promise<Worker> {
    const worker = this.workers.pop();
    return worker ? Promise.resolve(worker) : this.getNewWorker();
  }

  private releaseWorker(worker: Worker): void {
    this.workers.push(worker);
    // worker.terminate();
  }

  private isAttribute(property: string, name: PointAttributeName): boolean {
    return parseInt(property, 10) === name;
  }

  private getTightBoundingBox({ min, max }: { min: number[]; max: number[] }): Box3 {
    const box = new Box3(new Vector3().fromArray(min), new Vector3().fromArray(max));
    box.max.sub(box.min);
    box.min.set(0, 0, 0);

    return box;
  }

  private addBufferAttributes(
    geometry: BufferGeometry,
    buffers: { [name: string]: { buffer: ArrayBuffer } },
  ): void {
    Object.keys(buffers).forEach(property => {
      const buffer = buffers[property].buffer;

      if (this.isAttribute(property, PointAttributeName.POSITION_CARTESIAN)) {
        geometry.addAttribute('position', new BufferAttribute(new Float32Array(buffer), 3));
      } else if (this.isAttribute(property, PointAttributeName.COLOR_PACKED)) {
        geometry.addAttribute('color', new BufferAttribute(new Uint8Array(buffer), 3, true));
      } else if (this.isAttribute(property, PointAttributeName.INTENSITY)) {
        geometry.addAttribute('intensity', new BufferAttribute(new Float32Array(buffer), 1));
      } else if (this.isAttribute(property, PointAttributeName.CLASSIFICATION)) {
        geometry.addAttribute('classification', new BufferAttribute(new Uint8Array(buffer), 1));
      } else if (this.isAttribute(property, PointAttributeName.NORMAL_SPHEREMAPPED)) {
        geometry.addAttribute('normal', new BufferAttribute(new Float32Array(buffer), 3));
      } else if (this.isAttribute(property, PointAttributeName.NORMAL_OCT16)) {
        geometry.addAttribute('normal', new BufferAttribute(new Float32Array(buffer), 3));
      } else if (this.isAttribute(property, PointAttributeName.NORMAL)) {
        geometry.addAttribute('normal', new BufferAttribute(new Float32Array(buffer), 3));
      } else if (this.isAttribute(property, PointAttributeName.INDICES)) {
        const bufferAttribute = new Uint8BufferAttribute(new Uint8Array(buffer), 4);
        bufferAttribute.normalized = true;
        geometry.addAttribute('indices', bufferAttribute);
      } else if (this.isAttribute(property, PointAttributeName.SPACING)) {
        geometry.addAttribute('spacing', new BufferAttribute(new Float32Array(buffer), 1));
      }
    });
  }

  private addNormalAttribute(geometry: BufferGeometry, numPoints: number): void {
    if (!geometry.getAttribute('normal')) {
      const buffer = new Float32Array(numPoints * 3);
      geometry.addAttribute('normal', new BufferAttribute(new Float32Array(buffer), 3));
    }
  }
}
