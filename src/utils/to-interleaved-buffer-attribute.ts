import { IPointAttribute, PointAttributeName } from '../point-attributes';
import { InterleavedBufferAttribute } from './interleaved-buffer';

export function toInterleavedBufferAttribute(
  pointAttribute: IPointAttribute,
): InterleavedBufferAttribute | null {
  let att: InterleavedBufferAttribute | null = null;

  // tslint:disable:prefer-switch
  if (pointAttribute.name === PointAttributeName.POSITION_CARTESIAN) {
    att = new InterleavedBufferAttribute('position', 12, 3, 'FLOAT', false);
  } else if (pointAttribute.name === PointAttributeName.COLOR_PACKED) {
    att = new InterleavedBufferAttribute('color', 4, 4, 'UNSIGNED_BYTE', true);
  } else if (pointAttribute.name === PointAttributeName.INTENSITY) {
    att = new InterleavedBufferAttribute('intensity', 4, 1, 'FLOAT', false);
  } else if (pointAttribute.name === PointAttributeName.CLASSIFICATION) {
    att = new InterleavedBufferAttribute('classification', 4, 1, 'FLOAT', false);
  } else if (pointAttribute.name === PointAttributeName.RETURN_NUMBER) {
    att = new InterleavedBufferAttribute('returnNumber', 4, 1, 'FLOAT', false);
  } else if (pointAttribute.name === PointAttributeName.NUMBER_OF_RETURNS) {
    att = new InterleavedBufferAttribute('numberOfReturns', 4, 1, 'FLOAT', false);
  } else if (pointAttribute.name === PointAttributeName.SOURCE_ID) {
    att = new InterleavedBufferAttribute('pointSourceID', 4, 1, 'FLOAT', false);
  } else if (pointAttribute.name === PointAttributeName.NORMAL_SPHEREMAPPED) {
    att = new InterleavedBufferAttribute('normal', 12, 3, 'FLOAT', false);
  } else if (pointAttribute.name === PointAttributeName.NORMAL_OCT16) {
    att = new InterleavedBufferAttribute('normal', 12, 3, 'FLOAT', false);
  } else if (pointAttribute.name === PointAttributeName.NORMAL) {
    att = new InterleavedBufferAttribute('normal', 12, 3, 'FLOAT', false);
  }

  return att;
}
