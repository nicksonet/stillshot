import * as THREE from 'three';
import { Figure, G, bakeFigure, type BakedFigure, type FigureParts, type Piece } from './figure';
import type { HitSphere } from './enemy';
import type { World } from './world';

export type CivState = 'seated' | 'standing' | 'cower' | 'flee' | 'held' | 'prone';

export interface Palette {
  jacket: number;
  lapel: number;
  pants: number;
  shirt: number;
  tie: number;
  skin: number;
  hair: number;
  shoe: number;
  /** Dark glasses (the boss). */
  shades?: boolean;
}

// Period suits: tweed, charcoal, navy, camel, bottle green, burgundy.
const PALETTES: Palette[] = [
  { jacket: 0x6e5a44, lapel: 0x5a4836, pants: 0x5e4c3a, shirt: 0xf4efe4, tie: 0x7a2432, skin: 0xf0cfb4, hair: 0x3a2a1e, shoe: 0x2a1a12 },
  { jacket: 0x3a3d44, lapel: 0x2e3036, pants: 0x34373e, shirt: 0xffffff, tie: 0x2e5a8a, skin: 0xe2b08c, hair: 0x1a1614, shoe: 0x121214 },
  { jacket: 0x2a3552, lapel: 0x222b44, pants: 0x28324c, shirt: 0xe8eef6, tie: 0xc9a456, skin: 0x9c6a48, hair: 0x14100c, shoe: 0x1a1410 },
  { jacket: 0xb8946a, lapel: 0xa0805a, pants: 0x8a7050, shirt: 0xfaf4e8, tie: 0x2f5a44, skin: 0xf4d8c0, hair: 0x8a5a2a, shoe: 0x4a2a18 },
  { jacket: 0x2f4a3a, lapel: 0x263e30, pants: 0x2a3a30, shirt: 0xf6f0e0, tie: 0xa04a2a, skin: 0xd8a482, hair: 0x5a4a3a, shoe: 0x201810 },
  { jacket: 0x6a2232, lapel: 0x561a28, pants: 0x3a1c22, shirt: 0xf8ece8, tie: 0x1a1a1a, skin: 0xf2d2be, hair: 0xa0703a, shoe: 0x1a0e10 },
];
const VIP_PALETTE: Palette = {
  jacket: 0xe8b04a,
  lapel: 0xc98d1c,
  pants: 0x3a2c18,
  shirt: 0x1a1a1a,
  tie: 0xe8b04a,
  skin: 0xf0d2b8,
  hair: 0xd8d0c4,
  shoe: 0x6a3a1c,
  shades: true,
};

type V3 = [number, number, number];
type Add = (geo: THREE.BufferGeometry, color: number, at: V3, rot?: V3, scale?: V3) => void;
type Both = (geo: () => THREE.BufferGeometry, color: number, at: V3, rot?: V3) => void;

/** Extra torso pieces and hand pieces on top of the base suit (hats, coats, knuckles...). */
export interface SuitExtras {
  torso?: (add: Add, both: Both) => void;
  hand?: Piece[];
  noTie?: boolean;
  bald?: boolean;
}

/** A person in a suit: shared by diners, the boss and the gangsters. */
export function suitParts(p: Palette, extras: SuitExtras = {}): FigureParts {
  const torso: Piece[] = [];
  const add: Add = (geo, color, at, rot, scale) => torso.push({ geo, color, at, rot, scale });
  const both: Both = (geo, color, [x, y, z], rot) => {
    add(geo(), color, [x, y, z], rot);
    add(geo(), color, [-x, y, z], rot ? [rot[0], -rot[1], -rot[2]] : undefined);
  };
  const hair = extras.bald ? p.skin : p.hair;
  // Hips, belt, jacket.
  add(G.box(0.3, 0.14, 0.2), p.pants, [0, 0.03, 0]);
  add(G.box(0.31, 0.035, 0.21), 0x1e1612, [0, 0.085, 0]);
  add(G.box(0.04, 0.03, 0.01), 0xc9a456, [0, 0.085, 0.107]);
  add(G.cyl(0.21, 0.18, 0.5), p.jacket, [0, 0.3, 0]);
  add(G.box(0.3, 0.1, 0.18), p.jacket, [0, 0.1, 0.02]); // jacket skirt
  // Shirt front, tie, lapels, collar.
  add(G.box(0.09, 0.28, 0.02), p.shirt, [0, 0.42, 0.095]);
  if (!extras.noTie) {
    add(G.box(0.035, 0.24, 0.012), p.tie, [0, 0.4, 0.106]);
    add(G.box(0.045, 0.035, 0.014), p.tie, [0, 0.54, 0.106]); // knot
  } else add(G.box(0.05, 0.08, 0.012), p.skin, [0, 0.53, 0.1]); // open collar
  both(() => G.box(0.07, 0.3, 0.02), p.lapel, [0.06, 0.42, 0.1], [0, 0, -0.2]);
  both(() => G.box(0.05, 0.04, 0.02), p.shirt, [0.035, 0.585, 0.105], [0, 0, -0.5]);
  // Buttons, pocket flaps, pocket square.
  for (const y of [0.22, 0.3]) add(G.box(0.016, 0.016, 0.01), 0x1a1410, [0, y, 0.19]);
  both(() => G.box(0.08, 0.02, 0.012), p.lapel, [0.1, 0.18, 0.18]);
  add(G.box(0.045, 0.03, 0.01), p.tie, [-0.1, 0.46, 0.185]);
  // Shoulders.
  both(() => G.box(0.14, 0.06, 0.2), p.jacket, [0.23, 0.58, 0], [0, 0, -0.25]);
  // Neck and head.
  add(G.cyl(0.055, 0.06, 0.1, 6), p.skin, [0, 0.62, 0]);
  add(G.ico(0.12), p.skin, [0, 0.78, 0], undefined, [0.9, 1.1, 0.95]);
  add(G.box(0.028, 0.045, 0.03), p.skin, [0, 0.77, 0.115]); // nose
  both(() => G.box(0.02, 0.05, 0.035), p.skin, [0.112, 0.78, 0]); // ears
  both(() => G.box(0.06, 0.012, 0.012), p.hair, [0.04, 0.825, 0.104]); // brows
  both(() => G.box(0.022, 0.01, 0.006), 0x1a1410, [0.04, 0.8, 0.108]); // eyes
  add(G.box(0.045, 0.009, 0.006), 0x8a4a44, [0, 0.738, 0.106]); // mouth
  add(G.box(0.2, 0.07, 0.22), hair, [0, 0.87, -0.015]);
  add(G.box(0.18, 0.13, 0.05), hair, [0, 0.8, -0.1]);
  both(() => G.box(0.02, 0.07, 0.08), hair, [0.1, 0.81, -0.01]); // sideburns
  if (p.shades) add(G.box(0.15, 0.035, 0.02), 0x0a0a0c, [0, 0.8, 0.113]);
  extras.torso?.(add, both);

  return {
    torso: { solid: torso },
    upperArm: {
      solid: [
        { geo: G.box(0.08, 0.3, 0.09), color: p.jacket, at: [0, -0.15, 0] },
        { geo: G.box(0.085, 0.06, 0.095), color: p.jacket, at: [0, -0.02, 0] },
      ],
    },
    foreArm: {
      solid: [
        { geo: G.box(0.075, 0.26, 0.08), color: p.jacket, at: [0, -0.13, 0] },
        { geo: G.box(0.08, 0.02, 0.085), color: p.lapel, at: [0, -0.24, 0] },
        { geo: G.box(0.07, 0.03, 0.075), color: p.shirt, at: [0, -0.265, 0] },
        { geo: G.box(0.012, 0.012, 0.012), color: 0xc9a456, at: [0.036, -0.265, 0] }, // cufflink
        { geo: G.box(0.06, 0.07, 0.07), color: p.skin, at: [0, -0.31, 0] },
        { geo: G.box(0.02, 0.045, 0.025), color: p.skin, at: [0.035, -0.3, 0.03] }, // thumb
        ...(extras.hand ?? []),
      ],
    },
    thigh: {
      solid: [
        { geo: G.box(0.13, 0.42, 0.14), color: p.pants, at: [0, -0.21, 0] },
        { geo: G.box(0.01, 0.4, 0.01), color: p.lapel, at: [0, -0.21, 0.071] }, // crease
      ],
    },
    shin: {
      solid: [
        { geo: G.box(0.11, 0.4, 0.12), color: p.pants, at: [0, -0.2, 0] },
        { geo: G.box(0.01, 0.38, 0.01), color: p.lapel, at: [0, -0.2, 0.061] },
        { geo: G.box(0.1, 0.04, 0.1), color: 0x1a1a1e, at: [0, -0.41, 0] }, // sock
        { geo: G.box(0.12, 0.07, 0.22), color: p.shoe, at: [0, -0.465, 0.04] },
        { geo: G.box(0.125, 0.015, 0.23), color: 0x0e0a08, at: [0, -0.495, 0.04] }, // sole
        { geo: G.box(0.1, 0.03, 0.04), color: p.shoe, at: [0, -0.43, 0.13] }, // toe
      ],
    },
  };
}

const solidMat = new THREE.MeshPhongMaterial({ vertexColors: true, flatShading: true, shininess: 30, emissive: 0x0e0c0a });
const vipMat = new THREE.MeshPhongMaterial({ vertexColors: true, flatShading: true, shininess: 90, specular: 0xffe0a0, emissive: 0x2a1a04 });
const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
const bakedCache = new Map<Palette, BakedFigure>();

function baked(p: Palette): BakedFigure {
  let b = bakedCache.get(p);
  if (!b) {
    b = bakeFigure(
      suitParts(p, {
        // The boss wears a gold chain.
        torso: p.shades ? (add) => add(G.cyl(0.02, 0.025, 0.012, 8), 0xc9a456, [0, 0.62, 0.06], [Math.PI / 2, 0, 0]) : undefined,
      }),
    );
    bakedCache.set(p, b);
  }
  return b;
}

export class Civilian {
  readonly fig: Figure;
  readonly vip: boolean;
  state: CivState;
  alive = true;
  /** Set once the civilian leaves through an exit. */
  gone = false;
  /** The enemy holding this civilian, if any. */
  heldBy: object | null = null;
  readonly spheres: HitSphere[] = [
    { c: new THREE.Vector3(), r: 0.15 },
    { c: new THREE.Vector3(), r: 0.24 },
    { c: new THREE.Vector3(), r: 0.2 },
  ];
  private exit: THREE.Vector3 | null = null;
  /** Seconds (game time) until this person reacts to gunfire; null until shots are fired. */
  private panicT: number | null = null;
  private panicExits: THREE.Vector3[] = [];
  private phase = Math.random() * 6;
  private steerT = 0;
  private steerSign = Math.random() < 0.5 ? -1 : 1;
  private sway = Math.random() * 6;

  constructor(x: number, z: number, rotY: number, state: CivState, vip = false) {
    this.vip = vip;
    const palette = vip ? VIP_PALETTE : PALETTES[Math.floor(Math.random() * PALETTES.length)];
    this.fig = new Figure(baked(palette), vip ? vipMat : solidMat, glowMat);
    this.fig.root.rotation.order = 'YXZ';
    this.fig.root.position.set(x, 0, z);
    this.fig.root.rotation.y = rotY;
    this.state = state;
    this.applyPose();
    this.updateSpheres();
  }

  get position(): THREE.Vector3 {
    return this.fig.root.position;
  }

  get free(): boolean {
    return this.alive && !this.gone && !this.vip && this.state !== 'held';
  }

  setState(s: CivState): void {
    this.state = s;
    this.applyPose();
  }

  private applyPose(): void {
    const f = this.fig;
    f.stand();
    f.root.rotation.x = 0;
    f.root.position.y = 0;
    const [armL, armR] = f.arms;
    const [legL, legR] = f.legs;
    switch (this.state) {
      case 'seated':
        f.hips.position.y = 0.5;
        for (const l of [legL, legR]) {
          l.upper.rotation.x = -Math.PI / 2;
          l.lower.rotation.x = Math.PI / 2;
        }
        armL.upper.rotation.x = armR.upper.rotation.x = -0.35;
        armL.lower.rotation.x = armR.lower.rotation.x = -1.1;
        break;
      case 'cower':
        f.hips.position.y = 0.42;
        f.torso.rotation.x = 0.6;
        for (const l of [legL, legR]) {
          l.upper.rotation.x = -2.0;
          l.lower.rotation.x = 2.2;
        }
        armL.upper.rotation.x = armR.upper.rotation.x = -2.6;
        armL.lower.rotation.x = armR.lower.rotation.x = -0.9;
        break;
      case 'held':
        // Hands up.
        armL.upper.rotation.set(-2.6, 0, 0.35);
        armR.upper.rotation.set(-2.6, 0, -0.35);
        armL.lower.rotation.x = armR.lower.rotation.x = -0.35;
        f.torso.rotation.x = -0.12;
        break;
      case 'prone':
        f.root.rotation.x = -Math.PI / 2;
        f.root.position.y = 0.13;
        armL.upper.rotation.z = -0.25;
        armR.upper.rotation.set(-0.6, 0, 0.3);
        legL.upper.rotation.x = -0.5;
        legL.lower.rotation.x = 0.9;
        break;
      default:
        break;
    }
  }

  /** Gunfire starts: after a moment of shock, diners either duck or run for the nearest exit. */
  panic(exits: THREE.Vector3[]): void {
    if (!this.alive || this.vip || this.state === 'held' || this.state === 'flee' || this.panicT !== null) return;
    this.panicExits = exits;
    this.panicT = 0.25 + Math.random() * 0.5;
  }

  private react(): void {
    if (this.state !== 'seated' && this.state !== 'standing') return;
    if (this.panicExits.length && Math.random() < 0.5) this.flee(this.panicExits);
    else this.setState('cower');
  }

  flee(exits: THREE.Vector3[]): void {
    if (!exits.length) return this.setState('cower');
    let best = exits[0];
    for (const e of exits) if (e.distanceTo(this.position) < best.distanceTo(this.position)) best = e;
    this.exit = best;
    this.setState('flee');
  }

  update(gdt: number, world: World): void {
    if (!this.alive || this.gone) return;
    if (this.panicT !== null && this.panicT > 0) {
      this.panicT -= gdt;
      if (this.panicT <= 0) this.react();
    }
    if (this.state === 'flee' && this.exit) {
      const dx = this.exit.x - this.position.x;
      const dz = this.exit.z - this.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.6) {
        this.gone = true;
        return;
      }
      let ang = Math.atan2(dx, dz);
      if (this.steerT > 0) {
        this.steerT -= gdt;
        ang += this.steerSign * 1.2;
      }
      const step = 1.9 * gdt;
      const moved = world.moveCircle(this.position, Math.sin(ang) * step, Math.cos(ang) * step, 0.16);
      if (step > 0.0005 && moved < step * 0.3) {
        if (this.steerT > 0) this.steerSign *= -1;
        this.steerT = 0.8;
      }
      this.fig.root.rotation.y = ang;
      this.phase += gdt * 10;
      this.fig.walk(this.phase, 1.2);
      this.fig.arms[0].upper.rotation.x = Math.sin(this.phase) * 0.8;
      this.fig.arms[1].upper.rotation.x = -Math.sin(this.phase) * 0.8;
    } else if (this.state === 'cower' || this.state === 'held') {
      // Trembling.
      this.sway += gdt * 30;
      this.fig.torso.rotation.z = Math.sin(this.sway) * 0.03;
    }
    this.updateSpheres();
  }

  updateSpheres(): void {
    this.fig.root.updateMatrixWorld(true);
    this.fig.headMark.getWorldPosition(this.spheres[0].c);
    this.fig.chestMark.getWorldPosition(this.spheres[1].c);
    this.fig.pelvisMark.getWorldPosition(this.spheres[2].c);
  }

  /** Direction the civilian is facing (xz). */
  facing(out: THREE.Vector3): THREE.Vector3 {
    const y = this.fig.root.rotation.y;
    return out.set(Math.sin(y), 0, Math.cos(y));
  }

  headWorld(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.spheres[0].c);
  }
}
