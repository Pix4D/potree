import { Box3, Matrix4, Vector3 } from 'three';

/**
 * adapted from mhluska at https://github.com/mrdoob/three.js/issues/1561
 */
export function computeTransformedBoundingBox(box: Box3, transform: Matrix4): Box3 {
  return new Box3().setFromPoints([
    new Vector3(box.min.x, box.min.y, box.min.z).applyMatrix4(transform),
    new Vector3(box.min.x, box.min.y, box.min.z).applyMatrix4(transform),
    new Vector3(box.max.x, box.min.y, box.min.z).applyMatrix4(transform),
    new Vector3(box.min.x, box.max.y, box.min.z).applyMatrix4(transform),
    new Vector3(box.min.x, box.min.y, box.max.z).applyMatrix4(transform),
    new Vector3(box.min.x, box.max.y, box.max.z).applyMatrix4(transform),
    new Vector3(box.max.x, box.max.y, box.min.z).applyMatrix4(transform),
    new Vector3(box.max.x, box.min.y, box.max.z).applyMatrix4(transform),
    new Vector3(box.max.x, box.max.y, box.max.z).applyMatrix4(transform),
  ]);
}
