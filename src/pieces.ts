import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** One faceted piece of a procedural model (the guns), positioned relative to its origin. */
export interface Piece {
  geo: THREE.BufferGeometry;
  color: number;
  at: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number];
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/** Bake pieces into one non-indexed geometry with per-vertex colours (one draw call). */
export function bake(pieces: Piece[]): THREE.BufferGeometry | null {
  if (!pieces.length) return null;
  const list = pieces.map((p) => {
    let g = p.geo.clone();
    if (g.index) g = g.toNonIndexed();
    g.deleteAttribute('uv');
    _e.set(...(p.rot ?? [0, 0, 0]));
    _q.setFromEuler(_e);
    _p.set(...p.at);
    _s.set(...(p.scale ?? [1, 1, 1]));
    g.applyMatrix4(_m.compose(_p, _q, _s));
    // Pre-coloured geometry keeps its own per-vertex colours.
    if (g.getAttribute('color')) return g;
    _c.set(p.color);
    const n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = _c.r;
      colors[i * 3 + 1] = _c.g;
      colors[i * 3 + 2] = _c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  });
  return mergeGeometries(list, false);
}

export const G = {
  box: (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d),
  cyl: (rt: number, rb: number, h: number, seg = 6) => new THREE.CylinderGeometry(rt, rb, h, seg),
  ico: (r: number) => new THREE.IcosahedronGeometry(r, 0),
};
