import * as THREE from 'three';
import { G, type FigureParts, type Piece } from './figure';

/** One cross-section of a lofted body part: an ellipse at height y, optionally offset. */
export interface Ring {
  y: number;
  rx: number;
  rz: number;
  x?: number;
  z?: number;
}

/** Colour of a facet from its centroid: height y and angle a around the axis (0 = front, +Z). */
export type ColorFn = (y: number, a: number) => number;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _c = new THREE.Color();

/**
 * Loft a closed, capped tube through the rings. Vertices get a little jitter so
 * flat shading breaks the surface into crystal-like facets; every triangle gets
 * one colour (from `color`) with a small brightness variation.
 */
export function loft(rings: Ring[], seg: number, color: ColorFn, seed = 1, jitter = 0.002): THREE.BufferGeometry {
  const rnd = rng(seed);
  const pts = rings.map((r) =>
    Array.from({ length: seg }, (_, i) => {
      const a = (i / seg) * Math.PI * 2;
      const j = () => (rnd() - 0.5) * 2 * jitter;
      return new THREE.Vector3((r.x ?? 0) + Math.sin(a) * r.rx + j(), r.y + j() * 0.5, (r.z ?? 0) + Math.cos(a) * r.rz + j());
    }),
  );
  const pos: number[] = [];
  const col: number[] = [];
  const tri = (p: THREE.Vector3, q: THREE.Vector3, s: THREE.Vector3) => {
    const cx = (p.x + q.x + s.x) / 3;
    const cy = (p.y + q.y + s.y) / 3;
    const cz = (p.z + q.z + s.z) / 3;
    _c.set(color(cy, Math.atan2(cx, cz)));
    // A whisper of variation per facet; the faceting itself should come from light, not noise.
    const k = 0.975 + rnd() * 0.05;
    for (const v of [p, q, s]) {
      pos.push(v.x, v.y, v.z);
      col.push(_c.r * k, _c.g * k, _c.b * k);
    }
  };
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < seg; i++) {
      const i2 = (i + 1) % seg;
      const a = pts[k][i];
      const b = pts[k][i2];
      const c = pts[k + 1][i];
      const d = pts[k + 1][i2];
      tri(a, b, d);
      tri(a, d, c);
    }
  }
  const capCenter = (r: Ring) => new THREE.Vector3(r.x ?? 0, r.y, r.z ?? 0);
  const bottom = capCenter(rings[0]);
  const top = capCenter(rings[rings.length - 1]);
  for (let i = 0; i < seg; i++) {
    const i2 = (i + 1) % seg;
    tri(bottom, pts[0][i2], pts[0][i]);
    tri(top, pts[rings.length - 1][i], pts[rings.length - 1][i2]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export interface Palette {
  jacket: number;
  lapel: number;
  pants: number;
  shirt: number;
  tie: number;
  skin: number;
  hair: number;
  shoe: number;
  /** Dark glasses. */
  shades?: boolean;
}

type V3 = [number, number, number];
export type Add = (geo: THREE.BufferGeometry, color: number, at: V3, rot?: V3, scale?: V3) => void;
export type Both = (geo: () => THREE.BufferGeometry, color: number, at: V3, rot?: V3) => void;

/** Extra pieces on top of the base body (hats, coats, knuckles...). */
export interface SuitExtras {
  torso?: (add: Add, both: Both) => void;
  hand?: Piece[];
  noTie?: boolean;
  bald?: boolean;
}

// Colour boundaries sit exactly on rings (y = 0 trousers/jacket, 0.662 collar/neck) so they run straight.
const TORSO: Ring[] = [
  { y: -0.09, rx: 0.12, rz: 0.09 },
  { y: -0.04, rx: 0.165, rz: 0.115, z: -0.01 },
  { y: 0.0, rx: 0.171, rz: 0.118, z: -0.008 },
  { y: 0.04, rx: 0.175, rz: 0.12, z: -0.005 },
  { y: 0.14, rx: 0.16, rz: 0.11 },
  { y: 0.24, rx: 0.15, rz: 0.105, z: 0.005 },
  { y: 0.34, rx: 0.175, rz: 0.12, z: 0.012 },
  { y: 0.45, rx: 0.2, rz: 0.13, z: 0.015 },
  { y: 0.54, rx: 0.235, rz: 0.12, z: 0.005 },
  { y: 0.6, rx: 0.21, rz: 0.1 },
  { y: 0.645, rx: 0.1, rz: 0.08 },
  { y: 0.662, rx: 0.064, rz: 0.062, z: 0.004 },
  { y: 0.68, rx: 0.055, rz: 0.055, z: 0.005 },
  { y: 0.73, rx: 0.052, rz: 0.052, z: 0.008 },
];

const HEAD: Ring[] = [
  { y: 0.71, rx: 0.05, rz: 0.05, z: 0.01 },
  { y: 0.735, rx: 0.07, rz: 0.075, z: 0.02 },
  { y: 0.77, rx: 0.085, rz: 0.1, z: 0.012 },
  { y: 0.81, rx: 0.092, rz: 0.108 },
  { y: 0.86, rx: 0.094, rz: 0.108, z: -0.005 },
  { y: 0.9, rx: 0.085, rz: 0.098, z: -0.008 },
  { y: 0.935, rx: 0.06, rz: 0.07, z: -0.01 },
  { y: 0.955, rx: 0.02, rz: 0.025, z: -0.01 },
];

const UPPER_ARM: Ring[] = [
  { y: 0.03, rx: 0.05, rz: 0.05 },
  { y: 0, rx: 0.075, rz: 0.07 },
  { y: -0.06, rx: 0.07, rz: 0.065 },
  { y: -0.15, rx: 0.058, rz: 0.062, z: 0.004 },
  { y: -0.26, rx: 0.048, rz: 0.05 },
  { y: -0.31, rx: 0.045, rz: 0.047 },
];

const FOREARM: Ring[] = [
  { y: 0.01, rx: 0.046, rz: 0.046 },
  { y: -0.06, rx: 0.05, rz: 0.047 },
  { y: -0.16, rx: 0.04, rz: 0.036 },
  { y: -0.225, rx: 0.035, rz: 0.031 }, // cuff line
  { y: -0.25, rx: 0.032, rz: 0.028 },
  { y: -0.27, rx: 0.03, rz: 0.026 },
];

const HAND: Ring[] = [
  { y: -0.26, rx: 0.025, rz: 0.018 },
  { y: -0.29, rx: 0.032, rz: 0.016, z: 0.003 },
  { y: -0.33, rx: 0.034, rz: 0.014, z: 0.005 },
  { y: -0.36, rx: 0.029, rz: 0.012, z: 0.004 },
  { y: -0.375, rx: 0.012, rz: 0.008 },
];

const THUMB: Ring[] = [
  { y: 0, rx: 0.013, rz: 0.012 },
  { y: -0.045, rx: 0.012, rz: 0.01 },
  { y: -0.056, rx: 0.004, rz: 0.004 },
];

const THIGH: Ring[] = [
  { y: 0.04, rx: 0.08, rz: 0.09 },
  { y: -0.04, rx: 0.095, rz: 0.1 },
  { y: -0.15, rx: 0.088, rz: 0.092, z: 0.006 },
  { y: -0.3, rx: 0.07, rz: 0.075 },
  { y: -0.4, rx: 0.058, rz: 0.062 },
  { y: -0.44, rx: 0.055, rz: 0.058 },
];

const SHIN: Ring[] = [
  { y: 0.02, rx: 0.056, rz: 0.06 },
  { y: -0.04, rx: 0.058, rz: 0.06, z: 0.004 },
  { y: -0.12, rx: 0.06, rz: 0.065, z: -0.012 },
  { y: -0.26, rx: 0.045, rz: 0.048 },
  { y: -0.4, rx: 0.035, rz: 0.037 },
  { y: -0.44, rx: 0.034, rz: 0.036 },
];

/** Heel-to-toe sections; rotated to point forward. rz becomes half the height. */
const FOOT: Ring[] = [
  { y: 0, rx: 0.035, rz: 0.03 },
  { y: 0.02, rx: 0.05, rz: 0.035 },
  { y: 0.12, rx: 0.055, rz: 0.03 },
  { y: 0.2, rx: 0.052, rz: 0.022, z: 0.006 },
  { y: 0.25, rx: 0.035, rz: 0.016, z: 0.01 },
  { y: 0.265, rx: 0.01, rz: 0.01, z: 0.01 },
];

let seedCounter = 1;

/** The ellipse of a lofted part at height y (linear between rings). */
function sectionAt(rings: Ring[], y: number): { rx: number; rz: number; z: number } {
  let i = 0;
  while (i < rings.length - 2 && rings[i + 1].y < y) i++;
  const a = rings[i];
  const b = rings[i + 1];
  const t = THREE.MathUtils.clamp((y - a.y) / (b.y - a.y), 0, 1);
  return { rx: a.rx + (b.rx - a.rx) * t, rz: a.rz + (b.rz - a.rz) * t, z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * t };
}

/**
 * A thin panel that hugs the front (side 1) or back (side -1) of a lofted part between y0 and y1:
 * shirt fronts, ties, hair. Clean edges, unlike colouring facets of the body itself.
 */
function overlay(rings: Ring[], y0: number, y1: number, halfW: (y: number) => number, lift: number, color: number, side = 1, rows = 8, cols = 4): THREE.BufferGeometry {
  const grid: THREE.Vector3[][] = [];
  for (let r = 0; r <= rows; r++) {
    const y = y0 + ((y1 - y0) * r) / rows;
    const s = sectionAt(rings, y);
    const w = Math.min(halfW(y), s.rx * 0.98);
    const row: THREE.Vector3[] = [];
    for (let c = 0; c <= cols; c++) {
      const x = -w + (2 * w * c) / cols;
      const depth = s.rz * Math.sqrt(Math.max(0, 1 - (x / s.rx) ** 2));
      row.push(new THREE.Vector3(x, y, s.z + side * (depth + lift)));
    }
    grid.push(row);
  }
  const pos: number[] = [];
  const push = (...vs: THREE.Vector3[]) => vs.forEach((v) => pos.push(v.x, v.y, v.z));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = grid[r][c];
      const b = grid[r][c + 1];
      const d = grid[r + 1][c + 1];
      const e = grid[r + 1][c];
      // Wind towards the outside of the body.
      if (side > 0) push(a, b, d, a, d, e);
      else push(a, d, b, a, e, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const n = pos.length / 3;
  const col = new Float32Array(n * 3);
  const cc = new THREE.Color(color);
  for (let i = 0; i < n; i++) col.set([cc.r, cc.g, cc.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** A hair cap: the top of the head, slightly larger, with a straight hairline. */
const HAIR_CAP: Ring[] = [
  { y: 0.852, rx: 0.1, rz: 0.114, z: -0.01 },
  { y: 0.9, rx: 0.093, rz: 0.106, z: -0.011 },
  { y: 0.936, rx: 0.068, rz: 0.078, z: -0.012 },
  { y: 0.965, rx: 0.02, rz: 0.026, z: -0.012 },
];

/** A faceted, anatomically shaped person in a suit: diners, the boss and the gangsters. */
export function suitParts(p: Palette, extras: SuitExtras = {}): FigureParts {
  const seed = () => seedCounter++ * 7919;
  const tie = !extras.noTie;

  // Solid colours on the body; straight boundaries lie on rings.
  const torsoColor: ColorFn = (y) => (y < 0 ? p.pants : y > 0.662 ? p.skin : p.jacket);
  const pre = (geo: THREE.BufferGeometry): Piece => ({ geo, color: -1, at: [0, 0, 0] });

  const headPieces: Piece[] = [pre(loft(HEAD, 12, () => p.skin, seed()))];
  const torso: Piece[] = [pre(loft(TORSO, 16, torsoColor, seed()))];

  // Shirt front in the V of the jacket, tie (or open collar) on top of it.
  torso.push(pre(overlay(TORSO, 0.3, 0.63, (y) => 0.012 + ((y - 0.3) / 0.33) * 0.062, 0.002, p.shirt)));
  if (tie) {
    torso.push(pre(overlay(TORSO, 0.33, 0.565, (y) => 0.014 + ((0.565 - y) / 0.235) * 0.012, 0.006, p.tie, 1, 6, 2)));
    torso.push(pre(overlay(TORSO, 0.565, 0.6, () => 0.022, 0.009, p.tie, 1, 2, 2)));
  } else {
    torso.push(pre(overlay(TORSO, 0.47, 0.64, (y) => ((y - 0.47) / 0.17) * 0.045, 0.004, p.skin, 1, 4, 2)));
  }
  // Jacket buttons, sitting on the surface.
  for (const y of [0.17, 0.25]) {
    const s = sectionAt(TORSO, y);
    torso.push({ geo: G.box(0.016, 0.016, 0.008), color: 0x14100c, at: [0, y, s.z + s.rz + 0.002] });
  }

  // Hair: a cap on top and a panel down the back of the head.
  if (!extras.bald) {
    headPieces.push(pre(loft(HAIR_CAP, 12, () => p.hair, seed(), 0.001)));
    headPieces.push(pre(overlay(HEAD, 0.76, 0.87, (y) => sectionAt(HEAD, y).rx * 0.95, 0.004, p.hair, -1, 5, 6)));
  }

  const add: Add = (geo, color, at, rot, scale) => (at[1] >= 0.69 ? headPieces : torso).push({ geo, color, at, rot, scale });
  const both: Both = (geo, color, [x, y, z], rot) => {
    add(geo(), color, [x, y, z], rot);
    add(geo(), color, [-x, y, z], rot ? [rot[0], -rot[1], -rot[2]] : undefined);
  };
  // Face: nose and ears only (the SUPERHOT look), dark glasses when worn.
  add(new THREE.ConeGeometry(0.018, 0.045, 4), p.skin, [0, 0.79, 0.118], [1.25, Math.PI / 4, 0]);
  both(() => G.box(0.018, 0.045, 0.03), p.skin, [0.093, 0.8, -0.005]);
  if (p.shades) {
    add(G.box(0.1, 0.03, 0.016), 0x0a0a0c, [0, 0.808, 0.108]);
    both(() => G.box(0.04, 0.028, 0.016), 0x0a0a0c, [0.06, 0.808, 0.094], [0, 0.55, 0]);
  }
  extras.torso?.(add, both);

  const sleeve: ColorFn = (y) => (y < -0.225 ? p.shirt : p.jacket);
  return {
    torso: { solid: torso },
    head: { solid: headPieces },
    upperArm: { solid: [{ geo: loft(UPPER_ARM, 10, () => p.jacket, seed()), color: -1, at: [0, 0, 0] }] },
    foreArm: {
      solid: [
        { geo: loft(FOREARM, 10, sleeve, seed()), color: -1, at: [0, 0, 0] },
        { geo: loft(HAND, 6, () => p.skin, seed(), 0.002), color: -1, at: [0, 0, 0] },
        { geo: loft(THUMB, 5, () => p.skin, seed(), 0.001), color: -1, at: [0.03, -0.28, 0.012], rot: [0.2, 0, -0.5] },
        ...(extras.hand ?? []),
      ],
    },
    thigh: { solid: [{ geo: loft(THIGH, 10, () => p.pants, seed()), color: -1, at: [0, 0, 0] }] },
    shin: {
      solid: [
        { geo: loft(SHIN, 10, () => p.pants, seed()), color: -1, at: [0, 0, 0] },
        { geo: loft(FOOT, 6, () => p.shoe, seed(), 0.002), color: -1, at: [0, -0.465, -0.06], rot: [Math.PI / 2, 0, 0] },
      ],
    },
  };
}
