import * as THREE from 'three';
import { suitParts, type Palette } from './body';
import { Figure, G, bakeFigure, type BakedFigure } from './figure';
import type { HitSphere } from './enemy';
import type { World } from './world';

export type CivState = 'seated' | 'standing' | 'cower' | 'flee' | 'held' | 'prone' | 'kneel';
export type CivRole = 'diner' | 'vip' | 'guard';

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


const GUARD_PALETTE: Palette = {
  jacket: 0x3e4048,
  lapel: 0x32343b,
  pants: 0x3a3c44,
  shirt: 0xf2f2f2,
  tie: 0x24345a,
  skin: 0xe6bc9a,
  hair: 0x2a2018,
  shoe: 0x141414,
};

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
  /** One of the boss's own bodyguards: stays over him instead of panicking. */
  readonly guard: boolean;
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

  constructor(x: number, z: number, rotY: number, state: CivState, role: CivRole = 'diner') {
    this.vip = role === 'vip';
    this.guard = role === 'guard';
    const vip = this.vip;
    const palette = vip ? VIP_PALETTE : this.guard ? GUARD_PALETTE : PALETTES[Math.floor(Math.random() * PALETTES.length)];
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
    return this.alive && !this.gone && !this.vip && !this.guard && this.state !== 'held';
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
      case 'kneel':
        // One knee down, leaning over the boss, arms reaching to cover him.
        f.hips.position.y = 0.5;
        f.torso.rotation.x = 0.55;
        legL.upper.rotation.x = 0.15;
        legL.lower.rotation.x = 1.45;
        legR.upper.rotation.x = -1.4;
        legR.lower.rotation.x = 1.4;
        armL.upper.rotation.x = armR.upper.rotation.x = -0.75;
        armL.lower.rotation.x = armR.lower.rotation.x = -0.35;
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
    if (!this.alive || this.vip || this.guard || this.state === 'held' || this.state === 'flee' || this.panicT !== null) return;
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
