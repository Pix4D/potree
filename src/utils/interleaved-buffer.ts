export class InterleavedBufferAttribute {
  constructor(
    public name: string,
    public bytes: number,
    public numElements: number,
    public type: string,
    public normalized: boolean,
  ) {}
}

export class InterleavedBuffer {
  stride: number;

  constructor(
    public data: any,
    public attributes: InterleavedBufferAttribute[],
    public numElements: number,
  ) {
    this.stride = attributes.reduce((a, att) => a + att.bytes, 0);
    this.stride = Math.ceil(this.stride / 4) * 4;
  }

  offset(name: string): number | undefined {
    let offset = 0;

    for (let i = 0; i < this.attributes.length; i++) {
      const attribute = this.attributes[i];
      if (attribute.name === name) {
        return offset;
      }

      offset += attribute.bytes;
    }

    return undefined;
  }
}
