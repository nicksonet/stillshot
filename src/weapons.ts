import * as THREE from 'three';
import { G, bake } from './figure';
import { NEON, halo, neonMat } from './theme';

export type WeaponKind = 'revolver' | 'pistol' | 'smg';

export interface WeaponSpec {
  maxAmmo: number;
  auto: boolean;
  /** Seconds of game time between automatic shots. */
  interval: number;
  /** Radians of random spread per shot. */
  spread: number;
  /** How long a shot lets time lurch forward (real seconds). */
  kick: number;
}

export const SPECS: Record<WeaponKind, WeaponSpec> = {
  revolver: { maxAmmo: 6, auto: false, interval: 0.25, spread: 0, kick: 0.15 },
  pistol: { maxAmmo: 6, auto: false, interval: 0.2, spread: 0, kick: 0.12 },
  smg: { maxAmmo: 24, auto: true, interval: 0.09, spread: 0.018, kick: 0.08 },
};

const BODY = 0x15161c;
const ACCENT = 0x2c2f3c;
const NICKEL = 0x9aa1aa;
const STEEL = 0x3a3e46;
const WALNUT = 0x6b3f24;
const BRASS = 0xc9a456;
const PIP_OFF = new THREE.Color(0x2a2d38);
const PIP_ON: Record<WeaponKind, THREE.Color> = {
  revolver: new THREE.Color(0xe8b85a),
  pistol: new THREE.Color(NEON.red),
  smg: new THREE.Color(NEON.red),
};

const solidMat = new THREE.MeshPhongMaterial({ vertexColors: true, flatShading: true, shininess: 60, specular: 0x6a7aa0 });
const shinyMat = new THREE.MeshPhongMaterial({ vertexColors: true, flatShading: true, shininess: 140, specular: 0xffffff });
const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
const barGeo = new THREE.BoxGeometry(0.006, 0.01, 1).translate(0, 0, -0.5);
const barrel = (r: number, seg = 8) => G.cyl(r, r, 1, seg);
const ALONG_Z: [number, number, number] = [Math.PI / 2, 0, 0];

interface BakedWeapon {
  solid: THREE.BufferGeometry;
  shiny?: boolean;
  glow: THREE.BufferGeometry | null;
  pips: THREE.BufferGeometry | null;
}

// Each weapon kind is baked once into a solid mesh, an optional glow mesh and ammo pips.
const BAKED: Record<WeaponKind, BakedWeapon> = {
  revolver: {
    shiny: true,
    solid: bake([
      { geo: G.box(0.03, 0.05, 0.11), color: NICKEL, at: [0, 0.022, 0.0] },
      { geo: barrel(0.011, 10), color: NICKEL, at: [0, 0.036, -0.13], rot: ALONG_Z, scale: [1, 0.17, 1] },
      { geo: G.box(0.01, 0.012, 0.17), color: NICKEL, at: [0, 0.05, -0.13] },
      { geo: G.box(0.004, 0.01, 0.006), color: STEEL, at: [0, 0.06, -0.21] },
      { geo: barrel(0.006), color: STEEL, at: [0, 0.018, -0.1], rot: ALONG_Z, scale: [1, 0.09, 1] },
      { geo: barrel(0.024, 12), color: STEEL, at: [0, 0.03, -0.03], rot: ALONG_Z, scale: [1, 0.05, 1] },
      { geo: barrel(0.013, 8), color: NICKEL, at: [0, 0.03, -0.058], rot: ALONG_Z, scale: [1, 0.006, 1] },
      { geo: G.box(0.01, 0.028, 0.022), color: STEEL, at: [0, 0.058, 0.045], rot: [0.55, 0, 0] },
      { geo: G.box(0.008, 0.03, 0.05), color: NICKEL, at: [0, -0.014, -0.005] },
      { geo: G.box(0.004, 0.022, 0.006), color: STEEL, at: [0, -0.008, 0.0], rot: [0.3, 0, 0] },
      { geo: G.box(0.032, 0.105, 0.044), color: WALNUT, at: [0, -0.048, 0.055], rot: [-0.38, 0, 0] },
      { geo: G.box(0.034, 0.012, 0.046), color: NICKEL, at: [0, -0.098, 0.074], rot: [-0.38, 0, 0] },
      { geo: barrel(0.007, 8), color: BRASS, at: [0.017, -0.045, 0.055], rot: [0, 0, Math.PI / 2], scale: [1, 0.004, 1] },
      { geo: barrel(0.007, 8), color: BRASS, at: [-0.017, -0.045, 0.055], rot: [0, 0, Math.PI / 2], scale: [1, 0.004, 1] },
    ])!,
    glow: null,
    // Cartridge rims visible at the back of the cylinder.
    pips: bake(
      Array.from({ length: SPECS.revolver.maxAmmo }, (_, i) => {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 2;
        return {
          geo: G.cyl(0.0065, 0.0065, 0.008, 8),
          color: 0xffffff,
          at: [Math.cos(a) * 0.014, 0.03 + Math.sin(a) * 0.014, -0.002] as [number, number, number],
          rot: ALONG_Z,
        };
      }),
    ),
  },
  pistol: {
    solid: bake([
      { geo: G.box(0.034, 0.042, 0.2), color: BODY, at: [0, 0.02, -0.03] },
      { geo: barrel(0.009), color: BODY, at: [0, 0.022, -0.14], rot: [Math.PI / 2, 0, 0], scale: [1, 0.03, 1] },
      { geo: G.box(0.03, 0.1, 0.045), color: ACCENT, at: [0, -0.045, 0.045], rot: [-0.25, 0, 0] },
      { geo: G.box(0.012, 0.03, 0.05), color: BODY, at: [0, -0.012, 0] },
    ])!,
    glow: bake([{ geo: G.box(0.036, 0.004, 0.16), color: NEON.cyan, at: [0, 0, -0.03] }])!,
    pips: bake(
      Array.from({ length: SPECS.pistol.maxAmmo }, (_, i) => ({
        geo: G.box(0.008, 0.006, 0.014),
        color: 0xffffff,
        at: [0, 0.044, 0.05 - i * 0.02] as [number, number, number],
      })),
    ),
  },
  smg: {
    solid: bake([
      { geo: G.box(0.046, 0.07, 0.3), color: BODY, at: [0, 0.02, -0.04] },
      { geo: G.box(0.05, 0.03, 0.12), color: ACCENT, at: [0, 0.05, 0.04] },
      { geo: barrel(0.011), color: BODY, at: [0, 0.025, -0.23], rot: [Math.PI / 2, 0, 0], scale: [1, 0.1, 1] },
      { geo: G.box(0.034, 0.11, 0.045), color: ACCENT, at: [0, -0.06, 0.07], rot: [-0.25, 0, 0] },
      { geo: G.box(0.03, 0.15, 0.04), color: ACCENT, at: [0, -0.08, -0.08], rot: [0.15, 0, 0] },
      { geo: G.box(0.03, 0.045, 0.12), color: ACCENT, at: [0, 0.015, 0.17] },
      { geo: G.box(0.008, 0.012, 0.2), color: 0x2a2d38, at: [0.026, 0.035, -0.05] },
    ])!,
    glow: bake([{ geo: G.box(0.048, 0.006, 0.26), color: NEON.magenta, at: [0, -0.012, -0.04] }])!,
    pips: null,
  },
};

/** A gun. Barrel points along local -Z, grip hangs down (-Y). */
export class Weapon {
  readonly kind: WeaponKind;
  readonly spec: WeaponSpec;
  readonly mesh = new THREE.Group();
  readonly muzzle = new THREE.Object3D();
  ammo: number;
  held = false;
  vel = new THREE.Vector3();
  spin = new THREE.Vector3();
  /** True while flying after a throw; a thrown weapon kills whoever it hits. */
  thrown = false;
  resting = false;
  kick = 0;
  /** Game-time cooldown for automatic fire. */
  cooldown = 0;
  /** Real-time floor for automatic fire. */
  realCooldown = 0;
  private body = new THREE.Group();
  private pips: THREE.Mesh | null = null;
  private bar: THREE.Mesh | null = null;
  private flash: THREE.Mesh;
  private flashT = 0;

  constructor(kind: WeaponKind, ammo?: number) {
    this.kind = kind;
    this.spec = SPECS[kind];
    this.ammo = ammo ?? this.spec.maxAmmo;
    const baked = BAKED[kind];
    this.body.add(new THREE.Mesh(baked.solid, baked.shiny ? shinyMat : solidMat));
    if (baked.glow) this.body.add(new THREE.Mesh(baked.glow, glowMat));
    if (baked.pips) {
      // Own copy: pip colours change with this weapon's ammo.
      this.pips = new THREE.Mesh(baked.pips.clone(), glowMat);
      this.body.add(this.pips);
    }
    if (kind === 'smg') {
      this.bar = new THREE.Mesh(barGeo, neonMat(NEON.cyan));
      this.bar.position.set(0.027, 0.035, 0.05);
      this.body.add(this.bar);
    }
    const muzzle: Record<WeaponKind, [number, number]> = { revolver: [0.036, -0.225], pistol: [0.022, -0.16], smg: [0.025, -0.29] };
    this.muzzle.position.set(0, ...muzzle[kind]);

    this.flash = halo(NEON.amber, 0.16, 0.16, 0.9);
    this.flash.visible = false;
    this.muzzle.add(this.flash);
    this.body.add(this.muzzle);
    this.mesh.add(this.body);
    this.updateAmmo();
  }

  updateAmmo(): void {
    if (this.pips) {
      const colors = this.pips.geometry.getAttribute('color') as THREE.BufferAttribute;
      const per = colors.count / this.spec.maxAmmo;
      for (let i = 0; i < this.spec.maxAmmo; i++) {
        const c = i < this.ammo ? PIP_ON[this.kind] : PIP_OFF;
        for (let v = i * per; v < (i + 1) * per; v++) colors.setXYZ(v, c.r, c.g, c.b);
      }
      colors.needsUpdate = true;
    }
    if (this.bar) {
      this.bar.scale.z = Math.max(0.001, (this.ammo / this.spec.maxAmmo) * 0.2);
      this.bar.visible = this.ammo > 0;
    }
  }

  /** Consumes a round; returns false when empty. */
  fire(): boolean {
    if (this.ammo <= 0) return false;
    this.ammo--;
    this.showFlash();
    this.updateAmmo();
    return true;
  }

  showFlash(): void {
    this.kick = 1;
    this.flashT = 0.05;
    this.flash.visible = true;
    this.flash.rotation.z = Math.random() * Math.PI;
  }

  /** Recoil and muzzle flash, in real time. */
  animate(realDt: number): void {
    this.kick = Math.max(0, this.kick - realDt * 8);
    this.body.rotation.x = this.kick * (this.kind === 'smg' ? 0.12 : this.kind === 'revolver' ? 0.5 : 0.35);
    this.body.position.z = this.kick * 0.03;
    if (this.flashT > 0) {
      this.flashT -= realDt;
      if (this.flashT <= 0) this.flash.visible = false;
    }
  }

  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.muzzle.getWorldPosition(out);
  }
}
