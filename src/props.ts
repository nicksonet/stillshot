import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Prop } from './levels';
import { NEON, PASTEL, halo, haloMat, neonMat, signTexture, type Style } from './theme';

const phong = (color: number, shininess = 40, extra: THREE.MeshPhongMaterialParameters = {}) =>
  new THREE.MeshPhongMaterial({ color, flatShading: true, shininess, ...extra });

/** Material set for one visual style. */
interface Kit {
  style: Style;
  wall: THREE.Material;
  trim: THREE.Material;
  wood: THREE.Material;
  metal: THREE.Material;
  cushion: THREE.Material;
  glass: THREE.Material;
  server: THREE.Material;
  cloths: THREE.Material[];
  /** Accent for a given neon colour: the tube itself, or its pastel counterpart. */
  accent(color: number): THREE.Material;
}

const NEON_KIT: Kit = {
  style: 'neon',
  wall: new THREE.MeshLambertMaterial({ color: 0x241c3a }),
  trim: phong(0x1c1828, 50, { specular: 0x6a5a90 }),
  wood: phong(0x2e2444, 80, { specular: 0x8070b0 }),
  metal: phong(0x4a4f68, 100, { specular: 0xb0c0ff }),
  cushion: phong(0x5c1a4e, 30),
  glass: new THREE.MeshPhongMaterial({ color: 0x6fd6ff, transparent: true, opacity: 0.12, shininess: 120, depthWrite: false }),
  server: phong(0x10181c, 70, { specular: 0x60ffc0 }),
  cloths: [phong(0x2e2444, 80)],
  accent: neonMat,
};

const PASTEL_OF: Record<number, number> = {
  [NEON.cyan]: PASTEL.mint,
  [NEON.magenta]: PASTEL.pink,
  [NEON.violet]: PASTEL.lavender,
  [NEON.amber]: PASTEL.butter,
  [NEON.green]: PASTEL.sage,
  [NEON.red]: PASTEL.salmon,
  [NEON.white]: PASTEL.linen,
};
const pastelCache = new Map<number, THREE.Material>();

const PASTEL_KIT: Kit = {
  style: 'pastel',
  wall: new THREE.MeshLambertMaterial({ color: PASTEL.cream }),
  trim: phong(PASTEL.woodDark, 60, { specular: 0x806050 }),
  wood: phong(PASTEL.wood, 70, { specular: 0x9a7a60 }),
  metal: phong(PASTEL.brass, 110, { specular: 0xfff0c0, emissive: 0x2a1c00 }),
  cushion: phong(PASTEL.mint, 20),
  glass: new THREE.MeshPhongMaterial({ color: 0xe8f6ff, transparent: true, opacity: 0.18, shininess: 120, depthWrite: false }),
  server: phong(0x5a5a60, 40),
  cloths: [phong(PASTEL.linen, 10), phong(PASTEL.pink, 10), phong(PASTEL.powder, 10)],
  accent(color: number) {
    const c = PASTEL_OF[color] ?? color;
    let m = pastelCache.get(c);
    if (!m) pastelCache.set(c, (m = phong(c, 25)));
    return m;
  },
};

export function kitFor(style: Style): Kit {
  return style === 'pastel' ? PASTEL_KIT : NEON_KIT;
}

const _o = new THREE.Object3D();

/**
 * Collects static level geometry per material and merges it, so a whole room
 * costs a handful of draw calls. Also records axis-aligned colliders.
 */
export class Builder {
  readonly boxes: THREE.Box3[] = [];
  readonly objects: THREE.Object3D[] = [];
  private groups = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(mat: THREE.Material, geo: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0): void {
    _o.position.set(x, y, z);
    _o.rotation.set(rx, ry, rz, 'YXZ');
    _o.scale.set(1, 1, 1);
    _o.updateMatrix();
    const g = geo.clone().applyMatrix4(_o.matrix);
    let list = this.groups.get(mat);
    if (!list) this.groups.set(mat, (list = []));
    list.push(g);
  }

  box(mat: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, ry = 0): void {
    this.add(mat, new THREE.BoxGeometry(w, h, d), x, y, z, ry);
  }

  cyl(mat: THREE.Material, x: number, y: number, z: number, rt: number, rb: number, h: number, seg = 12): void {
    this.add(mat, new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z);
  }

  collide(x0: number, z0: number, x1: number, z1: number, h: number): void {
    this.boxes.push(
      new THREE.Box3(new THREE.Vector3(Math.min(x0, x1), 0, Math.min(z0, z1)), new THREE.Vector3(Math.max(x0, x1), h, Math.max(z0, z1))),
    );
  }

  object(o: THREE.Object3D): void {
    this.objects.push(o);
  }

  build(): THREE.Group {
    const group = new THREE.Group();
    for (const [mat, list] of this.groups) {
      const merged = mergeGeometries(list, false);
      if (merged) group.add(new THREE.Mesh(merged, mat));
      list.forEach((g) => g.dispose());
    }
    for (const o of this.objects) group.add(o);
    return group;
  }
}

/** Local (lx, lz) offset rotated by ry around (x, z). */
function local(x: number, z: number, ry: number, lx: number, lz: number): [number, number] {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  return [x + lx * c + lz * s, z - lx * s + lz * c];
}

/** Footprint half-extents of a w×d rectangle after rotating by rot (axis-aligned approximation). */
function footprint(w: number, d: number, rot: number): [number, number] {
  const c = Math.abs(Math.cos(rot));
  const s = Math.abs(Math.sin(rot));
  return [(w / 2) * c + (d / 2) * s, (w / 2) * s + (d / 2) * c];
}

/** Stable pseudo-random from a position, so layouts look varied but never flicker between loads. */
function hash(x: number, z: number): number {
  const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

export function buildProp(b: Builder, p: Prop, k: Kit): void {
  const pastel = k.style === 'pastel';
  switch (p.t) {
    case 'room': {
      const w = p.x1 - p.x0;
      const d = p.z1 - p.z0;
      const cx = (p.x0 + p.x1) / 2;
      const cz = (p.z0 + p.z1) / 2;
      b.box(pastel ? k.wall : k.trim, cx, p.h + 0.05, cz, w, 0.1, d);
      if (pastel) {
        // Coffered ceiling beams.
        for (let x = p.x0 + 2; x < p.x1 - 0.5; x += 2.7) b.box(k.wood, x, p.h - 0.06, cz, 0.16, 0.12, d);
        for (let z = p.z0 + 2; z < p.z1 - 0.5; z += 2.7) b.box(k.wood, cx, p.h - 0.08, z, w, 0.1, 0.12);
      } else {
        for (let x = p.x0 + 2; x < p.x1 - 1; x += 3) {
          b.box(neonMat(((x - p.x0) / 3) % 2 < 1 ? NEON.cyan : NEON.magenta), x, p.h - 0.02, cz, 0.05, 0.03, d * 0.85);
        }
      }
      break;
    }
    case 'wall': {
      const alongX = Math.abs(p.z1 - p.z0) < 1e-3;
      const len = alongX ? Math.abs(p.x1 - p.x0) : Math.abs(p.z1 - p.z0);
      const cx = (p.x0 + p.x1) / 2;
      const cz = (p.z0 + p.z1) / 2;
      const t = 0.25;
      const color = p.color ?? NEON.violet;
      // A strip running along the wall on both faces.
      const strip = (mat: THREE.Material, y: number, h: number, depth: number) => {
        for (const side of [-1, 1]) {
          if (alongX) b.box(mat, cx, y, cz + side * (t / 2 + depth / 2), len, h, depth);
          else b.box(mat, cx + side * (t / 2 + depth / 2), y, cz, depth, h, len);
        }
      };
      if (alongX) b.box(k.wall, cx, p.h / 2, cz, len, p.h, t);
      else b.box(k.wall, cx, p.h / 2, cz, t, p.h, len);
      if (pastel) {
        strip(k.accent(color), 0.55, 1.1, 0.02); // wainscot panelling
        strip(k.trim, 1.12, 0.06, 0.05); // chair rail
        strip(k.trim, 0.07, 0.14, 0.04); // skirting
        strip(k.wood, p.h - 0.08, 0.12, 0.06); // cornice
        // Panel mouldings on the wainscot.
        for (let i = 0.6; i < len - 0.3; i += 1.2) {
          const o = -len / 2 + i;
          for (const side of [-1, 1]) {
            if (alongX) b.box(k.trim, cx + o, 0.55, cz + side * (t / 2 + 0.03), 0.03, 0.8, 0.015);
            else b.box(k.trim, cx + side * (t / 2 + 0.03), 0.55, cz + o, 0.015, 0.8, 0.03);
          }
        }
      } else {
        strip(neonMat(color), 0.08, 0.04, 0.01);
        strip(neonMat(color), p.h - 0.25, 0.03, 0.01);
      }
      if (alongX) b.collide(p.x0, cz - t / 2, p.x1, cz + t / 2, p.h);
      else b.collide(cx - t / 2, p.z0, cx + t / 2, p.z1, p.h);
      break;
    }
    case 'window': {
      const len = p.x1 - p.x0;
      const cx = (p.x0 + p.x1) / 2;
      const frame = pastel ? k.accent(NEON.white) : k.metal;
      b.box(k.wall, cx, 0.4, p.z, len, 0.8, 0.25);
      if (pastel) {
        b.box(k.accent(NEON.cyan), cx, 0.4, p.z - 0.135, len, 0.8, 0.02);
        b.box(k.wood, cx, 0.82, p.z - 0.05, len, 0.05, 0.4); // sill
      } else b.box(neonMat(NEON.cyan), cx, 0.81, p.z - 0.13, len, 0.02, 0.02);
      b.box(k.glass, cx, (p.h + 0.8) / 2, p.z, len, p.h - 0.8, 0.02);
      b.box(frame, cx, p.h - 0.05, p.z, len, 0.1, 0.12);
      b.box(frame, cx, 2.2, p.z, len, 0.05, 0.08); // transom bar
      for (let x = p.x0; x <= p.x1 + 1e-3; x += 2) b.box(frame, x, (p.h + 0.8) / 2, p.z, 0.08, p.h - 0.8, 0.1);
      b.collide(p.x0, p.z - 0.13, p.x1, p.z + 0.13, p.h);
      break;
    }
    case 'table': {
      b.cyl(k.metal, p.x, 0.02, p.z, 0.3, 0.3, 0.04, 16);
      b.cyl(k.metal, p.x, 0.38, p.z, 0.05, 0.08, 0.72, 8);
      if (pastel) {
        const cloth = k.cloths[Math.floor(hash(p.x, p.z) * k.cloths.length)];
        b.add(cloth, new THREE.CylinderGeometry(0.47, 0.53, 0.34, 20, 1, true), p.x, 0.6, p.z);
        b.cyl(cloth, p.x, 0.765, p.z, 0.47, 0.47, 0.02, 20);
        // Vase with a flower, two plates, a glass.
        b.cyl(k.accent(NEON.cyan), p.x, 0.83, p.z, 0.03, 0.04, 0.11, 8);
        b.add(k.accent(NEON.magenta), new THREE.SphereGeometry(0.045, 6, 4), p.x, 0.9, p.z);
        for (const s of [-1, 1]) b.cyl(k.accent(NEON.white), p.x + s * 0.24, 0.78, p.z, 0.11, 0.09, 0.015, 16);
        b.cyl(k.glass, p.x + 0.12, 0.83, p.z + 0.2, 0.03, 0.025, 0.1, 8);
      } else {
        b.cyl(k.wood, p.x, 0.75, p.z, 0.45, 0.45, 0.04, 20);
        b.add(neonMat(NEON.cyan), new THREE.TorusGeometry(0.45, 0.01, 4, 32), p.x, 0.75, p.z, 0, Math.PI / 2);
        b.cyl(neonMat(NEON.amber), p.x + 0.12, 0.81, p.z - 0.08, 0.03, 0.025, 0.08, 8);
        b.cyl(k.metal, p.x - 0.1, 0.775, p.z + 0.1, 0.12, 0.1, 0.015, 16);
      }
      b.collide(p.x - 0.45, p.z - 0.45, p.x + 0.45, p.z + 0.45, 0.77);
      break;
    }
    case 'tableSide': {
      // Knocked over: the top stands on its edge as cover.
      b.add(k.wood, new THREE.CylinderGeometry(0.45, 0.45, 0.04, 20), p.x, 0.45, p.z, p.rot, Math.PI / 2);
      b.add(pastel ? k.metal : neonMat(NEON.cyan), new THREE.TorusGeometry(0.45, 0.012, 4, 32), p.x, 0.45, p.z, p.rot);
      const [bx, bz] = local(p.x, p.z, p.rot, 0, 0.4);
      b.add(k.metal, new THREE.CylinderGeometry(0.05, 0.08, 0.72, 8), bx, 0.08, bz, p.rot, Math.PI / 2);
      if (pastel) {
        // The tablecloth slid off onto the floor.
        const [cx, cz] = local(p.x, p.z, p.rot, 0.2, 0.55);
        b.add(k.cloths[0], new THREE.BoxGeometry(0.9, 0.02, 0.7), cx, 0.01, cz, p.rot + 0.3);
      }
      const [hw, hd] = footprint(0.9, 0.1, p.rot);
      b.collide(p.x - hw, p.z - hd, p.x + hw, p.z + hd, 0.9);
      break;
    }
    case 'chair': {
      // The sitter faces +z local (towards the table); the back is at -z.
      const at = (lx: number, lz: number) => local(p.x, p.z, p.rot, lx, lz);
      const seat = pastel ? k.accent(hash(p.x, p.z) < 0.5 ? NEON.magenta : NEON.cyan) : k.cushion;
      const frame = pastel ? k.wood : k.metal;
      let [x, z] = at(0, 0);
      b.box(seat, x, 0.46, z, 0.42, 0.06, 0.42, p.rot);
      b.box(frame, x, 0.425, z, 0.44, 0.03, 0.44, p.rot);
      [x, z] = at(0, -0.2);
      b.box(pastel ? k.wood : k.trim, x, 0.75, z, 0.42, 0.5, 0.04, p.rot);
      b.box(pastel ? k.trim : neonMat(NEON.magenta), x, 1.01, z, 0.44, 0.03, 0.06, p.rot);
      for (const [lx, lz] of [
        [-0.18, -0.18],
        [0.18, -0.18],
        [-0.18, 0.18],
        [0.18, 0.18],
      ]) {
        [x, z] = at(lx, lz);
        b.cyl(frame, x, 0.21, z, 0.015, 0.018, 0.42, 6);
      }
      break;
    }
    case 'booth': {
      const at = (lx: number, lz: number) => local(p.x, p.z, p.rot, lx, lz);
      const leather = pastel ? k.accent(NEON.cyan) : k.cushion;
      let [x, z] = at(0, 0.05);
      b.box(k.wood, x, 0.12, z, p.w, 0.24, 0.52, p.rot);
      b.box(leather, x, 0.32, z, p.w, 0.14, 0.55, p.rot);
      [x, z] = at(0, -0.26);
      b.box(leather, x, 0.8, z, p.w, 0.8, 0.14, p.rot);
      // Tufted back: rows of buttons.
      for (let i = -p.w / 2 + 0.2; i < p.w / 2 - 0.1; i += 0.25) {
        for (const y of [0.65, 0.95]) {
          const [bx, bz] = local(p.x, p.z, p.rot, i, -0.185);
          b.box(k.trim, bx, y, bz, 0.03, 0.03, 0.02, p.rot);
        }
      }
      b.box(pastel ? k.wood : neonMat(NEON.magenta), x, 1.21, z, p.w, 0.03, 0.16, p.rot);
      const [hw, hd] = footprint(p.w, 0.66, p.rot);
      b.collide(p.x - hw, p.z - hd, p.x + hw, p.z + hd, 1.2);
      break;
    }
    case 'bar': {
      const len = p.x1 - p.x0;
      const cx = (p.x0 + p.x1) / 2;
      b.box(pastel ? k.wood : k.trim, cx, 0.52, p.z, len, 1.04, 0.6);
      b.box(pastel ? k.trim : k.metal, cx, 1.07, p.z, len + 0.1, 0.05, 0.72);
      if (pastel) {
        b.add(k.metal, new THREE.CylinderGeometry(0.02, 0.02, len, 8), cx, 0.18, p.z + 0.4, 0, 0, Math.PI / 2); // foot rail
        for (let x = p.x0 + 0.5; x < p.x1; x += 1.0) b.box(k.accent(NEON.cyan), x, 0.55, p.z + 0.305, 0.8, 0.75, 0.015);
        b.box(k.metal, cx, 1.1, p.z + 0.36, len, 0.02, 0.02);
      } else {
        b.box(neonMat(NEON.magenta), cx, 1.0, p.z + 0.305, len, 0.03, 0.01);
        b.box(neonMat(NEON.cyan), cx, 0.06, p.z + 0.305, len, 0.02, 0.01);
        for (let x = p.x0 + 0.5; x < p.x1; x += 1.0) b.box(neonMat(NEON.violet), x, 0.55, p.z + 0.305, 0.015, 0.8, 0.01);
      }
      // Back bar: mirror or glow panel, shelves, bottles.
      const sz = p.z - 1.55;
      b.box(pastel ? k.wood : k.trim, cx, 1.6, sz - 0.12, len, 1.6, 0.06);
      b.box(pastel ? phongMirror : neonMat(0x3a1a60), cx, 1.6, sz - 0.085, len - 0.2, 1.4, 0.01);
      const bottleColors = pastel ? [0x8a6a2a, 0x5a7a4a, 0xd8e8e0, 0xa05a3a, 0x40604a] : [NEON.cyan, NEON.magenta, NEON.amber, NEON.green, NEON.violet];
      for (const y of [1.0, 1.45, 1.9]) {
        b.box(pastel ? k.wood : k.metal, cx, y, sz, len, 0.03, 0.26);
        for (let x = p.x0 + 0.15; x < p.x1 - 0.1; x += 0.16 + hash(x, y) * 0.1) {
          const h = 0.18 + hash(y, x) * 0.14;
          const c = bottleColors[Math.floor(hash(x * 3, y) * bottleColors.length)];
          b.cyl(pastel ? bottleMat(c) : neonMat(c), x, y + 0.015 + h / 2, sz, 0.03, 0.035, h, 6);
          if (pastel) b.cyl(bottleMat(c), x, y + 0.015 + h + 0.04, sz, 0.01, 0.015, 0.08, 6);
        }
      }
      b.collide(p.x0, p.z - 0.3, p.x1, p.z + 0.3, 1.1);
      break;
    }
    case 'pillar': {
      b.box(pastel ? k.wall : k.trim, p.x, p.h / 2, p.z, p.s, p.h, p.s);
      if (pastel) {
        b.box(k.accent(p.color), p.x, 0.55, p.z, p.s + 0.04, 1.1, p.s + 0.04);
        b.box(k.trim, p.x, 1.12, p.z, p.s + 0.08, 0.06, p.s + 0.08);
        b.box(k.wood, p.x, p.h - 0.15, p.z, p.s + 0.12, 0.2, p.s + 0.12);
        b.box(k.trim, p.x, 0.06, p.z, p.s + 0.1, 0.12, p.s + 0.1);
      } else for (const y of [0.35, p.h * 0.55, p.h - 0.35]) b.box(neonMat(p.color), p.x, y, p.z, p.s + 0.03, 0.04, p.s + 0.03);
      b.collide(p.x - p.s / 2, p.z - p.s / 2, p.x + p.s / 2, p.z + p.s / 2, p.h);
      break;
    }
    case 'block': {
      b.box(k.trim, p.x, p.h / 2, p.z, p.w, p.h, p.d);
      const n = k.accent(p.color);
      const e = 0.03;
      b.box(n, p.x, p.h, p.z - p.d / 2, p.w + e, e, e);
      b.box(n, p.x, p.h, p.z + p.d / 2, p.w + e, e, e);
      b.box(n, p.x - p.w / 2, p.h, p.z, e, e, p.d + e);
      b.box(n, p.x + p.w / 2, p.h, p.z, e, e, p.d + e);
      b.box(n, p.x, 0.05, p.z, p.w + e, e, p.d + e);
      b.collide(p.x - p.w / 2, p.z - p.d / 2, p.x + p.w / 2, p.z + p.d / 2, p.h);
      break;
    }
    case 'server': {
      b.box(k.server, p.x, p.h / 2, p.z, p.w, p.h, p.d);
      const alongX = p.w > p.d;
      const len = alongX ? p.w : p.d;
      for (let i = 0.15; i < len - 0.1; i += 0.12) {
        for (let y = 0.3; y < p.h - 0.2; y += 0.22) {
          const r = hash(i + p.x, y + p.z);
          const c = r < 0.8 ? NEON.green : r < 0.9 ? NEON.cyan : NEON.amber;
          const o = -len / 2 + i;
          for (const side of [-1, 1]) {
            if (alongX) b.box(k.accent(c), p.x + o, y, p.z + side * (p.d / 2 + 0.005), 0.05, 0.015, 0.01);
            else b.box(k.accent(c), p.x + side * (p.w / 2 + 0.005), y, p.z + o, 0.01, 0.015, 0.05);
          }
        }
      }
      b.box(k.accent(NEON.cyan), p.x, p.h + 0.01, p.z, p.w, 0.02, p.d);
      b.collide(p.x - p.w / 2, p.z - p.d / 2, p.x + p.w / 2, p.z + p.d / 2, p.h);
      break;
    }
    case 'sign': {
      const hex = pastel ? '#d9b35a' : '#' + p.color.toString(16).padStart(6, '0');
      const { tex, aspect } = signTexture(p.text, hex, pastel);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(p.h * aspect, p.h), mat);
      m.position.set(p.x, p.y, p.z);
      m.rotation.y = p.rot;
      m.renderOrder = 6;
      if (pastel) {
        // Painted signboard behind the gilded letters.
        const [bx, bz] = local(p.x, p.z, p.rot, 0, -0.03);
        b.box(signBoard, bx, p.y, bz, p.h * aspect * 0.9, p.h * 1.15, 0.04, p.rot);
        m.translateZ(0.001);
      } else {
        const g = halo(p.color, p.h * aspect * 1.4, p.h * 3.2, 0.45);
        g.position.set(p.x, p.y, p.z);
        g.rotation.y = p.rot;
        g.translateZ(-0.01);
        b.object(g);
      }
      b.object(m);
      break;
    }
    case 'lamp': {
      b.cyl(k.metal, p.x, (p.y + 3.3) / 2 + 0.1, p.z, 0.006, 0.006, 3.3 - p.y, 4);
      const shade = pastel ? k.accent(p.color) : k.trim;
      b.add(shade, new THREE.CylinderGeometry(0.05, 0.22, 0.18, 12, 1, true), p.x, p.y, p.z);
      b.cyl(pastel ? warmBulb : neonMat(p.color), p.x, p.y - 0.08, p.z, 0.16, 0.16, 0.01, 12);
      const light = pastel ? 0xffd9a0 : p.color;
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), haloMat(light, pastel ? 0.22 : 0.35));
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(p.x, pastel ? 0.79 : 0.785, p.z);
      pool.renderOrder = 4;
      b.object(pool);
      const glow = halo(light, 0.6, 0.35, pastel ? 0.35 : 0.5);
      glow.position.set(p.x, p.y - 0.12, p.z);
      b.object(glow);
      break;
    }
    case 'door': {
      const at = (lx: number) => local(p.x, p.z, p.rot, lx, 0);
      const frame = pastel ? k.trim : neonMat(p.color);
      for (const lx of [-0.8, 0.8]) {
        const [x, z] = at(lx);
        b.box(frame, x, 1.15, z, pastel ? 0.12 : 0.05, 2.3, 0.3, p.rot);
      }
      const [x, z] = at(0);
      b.box(frame, x, 2.32, z, 1.72, pastel ? 0.14 : 0.05, 0.3, p.rot);
      if (!pastel) {
        const g = halo(p.color, 2.4, 3.0, 0.25);
        g.position.set(x, 1.2, z);
        g.rotation.y = p.rot;
        b.object(g);
      }
      break;
    }
    case 'dancefloor': {
      const colors = [NEON.magenta, NEON.cyan, NEON.violet, NEON.amber];
      let i = 0;
      for (let x = p.x - p.w / 2 + 0.5; x < p.x + p.w / 2; x += 1) {
        for (let z = p.z - p.d / 2 + 0.5; z < p.z + p.d / 2; z += 1) {
          const dim = new THREE.Color(colors[(i++ * 7) % colors.length]).multiplyScalar(0.35).getHex();
          b.box(neonMat(dim), x, 0.005, z, 0.94, 0.01, 0.94);
        }
      }
      break;
    }
    case 'helipad': {
      b.add(neonMat(NEON.amber), new THREE.TorusGeometry(p.r, 0.05, 4, 48), p.x, 0.02, p.z, 0, Math.PI / 2);
      b.add(neonMat(NEON.amber), new THREE.TorusGeometry(p.r * 0.85, 0.02, 4, 48), p.x, 0.02, p.z, 0, Math.PI / 2);
      const s = p.r * 0.35;
      b.box(neonMat(NEON.white), p.x - s * 0.5, 0.015, p.z, 0.12, 0.01, s * 1.6);
      b.box(neonMat(NEON.white), p.x + s * 0.5, 0.015, p.z, 0.12, 0.01, s * 1.6);
      b.box(neonMat(NEON.white), p.x, 0.015, p.z, s, 0.01, 0.12);
      break;
    }
  }
}

const phongMirror = new THREE.MeshPhongMaterial({ color: 0xd8dde0, shininess: 150, specular: 0xffffff });
const signBoard = new THREE.MeshPhongMaterial({ color: 0x24493c, shininess: 30 });
const warmBulb = new THREE.MeshBasicMaterial({ color: 0xfff0c8 });
const bottleCache = new Map<number, THREE.Material>();
function bottleMat(color: number): THREE.Material {
  let m = bottleCache.get(color);
  if (!m) bottleCache.set(color, (m = new THREE.MeshPhongMaterial({ color, shininess: 120, specular: 0xffffff })));
  return m;
}
