import * as THREE from 'three';

const _d = new THREE.Vector3();
const _m = new THREE.Vector3();

/** Fraction t in [0,1] where segment p0→p1 first touches the sphere, or -1. */
export function segmentSphere(p0: THREE.Vector3, p1: THREE.Vector3, c: THREE.Vector3, r: number): number {
  _d.subVectors(p1, p0);
  _m.subVectors(p0, c);
  const a = _d.dot(_d);
  const cc = _m.dot(_m) - r * r;
  if (cc <= 0) return 0; // starts inside
  if (a < 1e-12) return -1;
  const b = _m.dot(_d);
  const disc = b * b - a * cc;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / a;
  return t >= 0 && t <= 1 ? t : -1;
}

/** Fraction t in [0,1] where segment p0→p1 enters the box, or -1 (slab method). */
export function segmentBox(p0: THREE.Vector3, p1: THREE.Vector3, box: THREE.Box3): number {
  let tmin = 0;
  let tmax = 1;
  for (const axis of ['x', 'y', 'z'] as const) {
    const d = p1[axis] - p0[axis];
    const lo = box.min[axis];
    const hi = box.max[axis];
    if (Math.abs(d) < 1e-9) {
      if (p0[axis] < lo || p0[axis] > hi) return -1;
      continue;
    }
    let t1 = (lo - p0[axis]) / d;
    let t2 = (hi - p0[axis]) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}

/** Does a vertical circle (xz) at pos with radius overlap the box footprint? */
export function circleHitsBox(x: number, z: number, r: number, box: THREE.Box3): boolean {
  const cx = Math.max(box.min.x, Math.min(x, box.max.x));
  const cz = Math.max(box.min.z, Math.min(z, box.max.z));
  const dx = x - cx;
  const dz = z - cz;
  return dx * dx + dz * dz < r * r;
}
