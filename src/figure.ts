import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** One faceted piece of a body part, positioned relative to the part's pivot. */
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

/** Solid and glowing pieces for each articulated part. */
export interface PartSet {
  solid: Piece[];
  glow?: Piece[];
}

export interface FigureParts {
  torso: PartSet;
  upperArm: PartSet;
  foreArm: PartSet;
  thigh: PartSet;
  shin: PartSet;
}

export interface BakedFigure {
  torso: [THREE.BufferGeometry | null, THREE.BufferGeometry | null];
  upperArm: [THREE.BufferGeometry | null, THREE.BufferGeometry | null];
  foreArm: [THREE.BufferGeometry | null, THREE.BufferGeometry | null];
  thigh: [THREE.BufferGeometry | null, THREE.BufferGeometry | null];
  shin: [THREE.BufferGeometry | null, THREE.BufferGeometry | null];
}

export function bakeFigure(parts: FigureParts): BakedFigure {
  const b = (s: PartSet): [THREE.BufferGeometry | null, THREE.BufferGeometry | null] => [bake(s.solid), bake(s.glow ?? [])];
  return { torso: b(parts.torso), upperArm: b(parts.upperArm), foreArm: b(parts.foreArm), thigh: b(parts.thigh), shin: b(parts.shin) };
}

export const HIP_Y = 0.92;
export const SHOULDER = new THREE.Vector3(0.3, 0.6, 0);
export const ELBOW_Y = -0.3;
export const HIP_X = 0.1;
export const KNEE_Y = -0.42;

export interface Limb {
  upper: THREE.Group;
  lower: THREE.Group;
  end: THREE.Object3D;
}

/**
 * Articulated humanoid: root at the feet, hips → torso (head baked in) → arms,
 * hips → legs. Markers give world positions for hit spheres in any pose.
 */
export class Figure {
  readonly root = new THREE.Group();
  readonly hips = new THREE.Group();
  readonly torso = new THREE.Group();
  readonly arms: [Limb, Limb];
  readonly legs: [Limb, Limb];
  readonly headMark = new THREE.Object3D();
  readonly chestMark = new THREE.Object3D();
  readonly pelvisMark = new THREE.Object3D();

  constructor(baked: BakedFigure, solid: THREE.Material, glow: THREE.Material) {
    const mesh = (pair: [THREE.BufferGeometry | null, THREE.BufferGeometry | null], parent: THREE.Object3D) => {
      if (pair[0]) parent.add(new THREE.Mesh(pair[0], solid));
      if (pair[1]) parent.add(new THREE.Mesh(pair[1], glow));
    };
    this.hips.position.y = HIP_Y;
    this.root.add(this.hips);
    this.hips.add(this.torso);
    mesh(baked.torso, this.torso);

    const limb = (side: number, arm: boolean): Limb => {
      const upper = new THREE.Group();
      const lower = new THREE.Group();
      const end = new THREE.Object3D();
      if (arm) {
        upper.position.set(side * SHOULDER.x, SHOULDER.y, 0);
        lower.position.y = ELBOW_Y;
        end.position.y = -0.33;
        mesh(baked.upperArm, upper);
        mesh(baked.foreArm, lower);
        this.torso.add(upper);
      } else {
        upper.position.set(side * HIP_X, 0, 0);
        lower.position.y = KNEE_Y;
        end.position.y = -0.45;
        mesh(baked.thigh, upper);
        mesh(baked.shin, lower);
        this.hips.add(upper);
      }
      upper.add(lower);
      lower.add(end);
      return { upper, lower, end };
    };
    this.arms = [limb(-1, true), limb(1, true)];
    this.legs = [limb(-1, false), limb(1, false)];

    this.headMark.position.y = 0.82;
    this.chestMark.position.y = 0.38;
    this.pelvisMark.position.y = -0.3;
    this.torso.add(this.headMark, this.chestMark);
    this.hips.add(this.pelvisMark);
  }

  /** Reset every joint to a neutral standing pose. */
  stand(): void {
    this.hips.position.y = HIP_Y;
    this.hips.rotation.set(0, 0, 0);
    this.torso.rotation.set(0, 0, 0);
    for (const l of [...this.arms, ...this.legs]) {
      l.upper.rotation.set(0, 0, 0);
      l.lower.rotation.set(0, 0, 0);
    }
  }

  walk(phase: number, amount = 1): void {
    const s = Math.sin(phase) * amount;
    this.legs[0].upper.rotation.x = s * 0.7;
    this.legs[1].upper.rotation.x = -s * 0.7;
    this.legs[0].lower.rotation.x = Math.max(0, -s) * 0.8;
    this.legs[1].lower.rotation.x = Math.max(0, s) * 0.8;
    this.hips.position.y = HIP_Y - Math.abs(Math.cos(phase)) * 0.03 * amount;
  }

  settleLegs(k: number): void {
    for (const l of this.legs) {
      l.upper.rotation.x *= k;
      l.lower.rotation.x *= k;
    }
  }
}
