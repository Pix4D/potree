import { Ray, Sphere, Vector3 } from 'three';

// code sample taken from three.js src/math/Ray.js
export const intersectSphereBack = (() => {
  const v1 = new Vector3();
  return (ray: Ray, sphere: Sphere) => {
    v1.subVectors(sphere.center, ray.origin);
    const tca = v1.dot(ray.direction);
    const d2 = v1.dot(v1) - tca * tca;
    const radius2 = sphere.radius * sphere.radius;

    if (d2 > radius2) {
      return null;
    }

    const thc = Math.sqrt(radius2 - d2);

    // t1 = second intersect point - exit point on back of sphere
    const t1 = tca + thc;

    if (t1 < 0) {
      return null;
    }

    return t1;
  };
})();

export function getIndexFromName(name: string) {
  return parseInt(name.charAt(name.length - 1), 10);
}
