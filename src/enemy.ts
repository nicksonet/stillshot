import * as THREE from 'three';
import { loft, suitParts, type Palette, type SuitExtras } from './body';
import type { Civilian } from './civilian';
import { Figure, G, HIP_Y, bakeFigure, type BakedFigure, type FigureParts } from './figure';
import type { EnemyKind } from './levels';
import { Weapon } from './weapons';
import type { World } from './world';

export const ENEMY_RADIUS = 0.35;
const SHOULDER_Y = 1.52;
const MATERIALIZE = 0.6;

export interface HitSphere {
  c: THREE.Vector3;
  r: number;
}

export interface EnemyContext {
  playerHead: THREE.Vector3;
  /** People the player must protect (the boss and his bodyguards); enemies shoot at them too. */
  protectees: Civilian[];
  world: World;
  others: Enemy[];
  shoot(from: THREE.Vector3, dir: THREE.Vector3, weapon: Weapon, shooter: Enemy): void;
  strike(enemy: Enemy): void;
  /** How well a spot is screened from the player by civilians (bigger = better cover). */
  coverScore(spot: THREE.Vector3): number;
}

const SUIT = 0x24252c;
const SUIT_DARK = 0x18191e;
const SHIRT = 0xf0efec;
const TIE = 0xb3161b;
const SKINS = [0xf0cfb4, 0xd9a582, 0xa06c4a, 0x6e4630];
const HAIRS = [0x1a1512, 0x2a2018, 0x0e0c0a, 0x4a3a2a];

/** Gangsters in black suits; each kind is told apart by a detail. */
function enemyParts(kind: EnemyKind, look: number): FigureParts {
  const palette: Palette = {
    jacket: SUIT,
    lapel: SUIT_DARK,
    pants: SUIT,
    shirt: SHIRT,
    tie: TIE,
    skin: SKINS[look % SKINS.length],
    hair: HAIRS[look % HAIRS.length],
    shoe: 0x0a0a0a,
    shades: true,
  };
  const extras: SuitExtras = {};
  if (kind === 'gunner') {
    // Earpiece with a coiled wire into the collar.
    extras.torso = (add) => {
      add(G.box(0.018, 0.028, 0.02), 0x0a0a0a, [-0.1, 0.795, 0.0]);
      add(G.box(0.006, 0.12, 0.006), 0x2a2a2a, [-0.085, 0.69, -0.03], [0.25, 0, 0.2]);
    };
  } else if (kind === 'rifleman') {
    // Long black overcoat with a turned-up collar.
    extras.torso = (add, both) => {
      const coat = loft(
        [
          { y: 0.08, rx: 0.18, rz: 0.125 },
          { y: -0.1, rx: 0.19, rz: 0.135, z: -0.005 },
          { y: -0.3, rx: 0.205, rz: 0.15, z: -0.01 },
          { y: -0.52, rx: 0.22, rz: 0.16, z: -0.015 },
        ],
        10,
        (_y, a) => (Math.abs(a) < 0.08 ? 0x050506 : SUIT_DARK),
        kind.length * 31,
      );
      add(coat, SUIT_DARK, [0, 0, 0]);
      both(() => G.box(0.1, 0.13, 0.04), SUIT_DARK, [0.09, 0.63, 0.05], [0.25, 0, -0.35]);
      add(G.box(0.26, 0.13, 0.04), SUIT_DARK, [0, 0.66, -0.085], [-0.2, 0, 0]);
    };
  } else if (kind === 'brawler') {
    // Shaved head, open collar, brass knuckles.
    extras.bald = true;
    extras.noTie = true;
    extras.hand = [{ geo: G.box(0.075, 0.022, 0.03), color: 0xc9a456, at: [0, -0.33, 0.022] }];
  } else {
    // Hostage-taker: a fedora.
    extras.torso = (add) => {
      add(G.cyl(0.19, 0.19, 0.015, 16), SUIT, [0, 0.885, 0]);
      add(G.cyl(0.11, 0.13, 0.12, 12), SUIT, [0, 0.95, 0]);
      add(G.cyl(0.132, 0.132, 0.03, 12), TIE, [0, 0.905, 0]);
    };
  }
  return suitParts(palette, extras);
}

// Satin black cloth: a strong specular makes the facets catch the light.
const solidMat = new THREE.MeshPhongMaterial({ vertexColors: true, flatShading: true, shininess: 70, specular: 0x8a8a9a, emissive: 0x060606 });
const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
const bakedCache = new Map<string, BakedFigure>();

function baked(kind: EnemyKind, look: number): BakedFigure {
  const key = `${kind}:${look}`;
  let b = bakedCache.get(key);
  if (!b) {
    b = bakeFigure(enemyParts(kind, look));
    bakedCache.set(key, b);
  }
  return b;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _t = new THREE.Vector3();

export class Enemy {
  readonly kind: EnemyKind;
  readonly fig: Figure;
  alive = true;
  weapon: Weapon | null = null;
  /** Civilian held as a human shield (hostage kind only). */
  hostage: Civilian | null = null;
  readonly spheres: HitSphere[] = [
    { c: new THREE.Vector3(), r: 0.16 },
    { c: new THREE.Vector3(), r: 0.28 },
    { c: new THREE.Vector3(), r: 0.22 },
  ];

  private spawnT = 0;
  private cooldown: number;
  private aimT = 0;
  private burstLeft = 0;
  private burstT = 0;
  private phase = Math.random() * 6;
  private preferred: number;
  private steerSign = Math.random() < 0.5 ? -1 : 1;
  private steerT = 0;
  private windup = 0;
  private staggerT = 0;
  private spot: THREE.Vector3 | null = null;
  private spotT = 0;
  private peekT: number;
  private peekState: 'hide' | 'out' = 'hide';
  private lean = 0.14;
  private leanSide = Math.random() < 0.5 ? -1 : 1;
  private sideT = 2;
  private strafeT = 1.5 + Math.random() * 2;
  private strafeLeft = 0;
  private strafeSign = 1;

  constructor(kind: EnemyKind, x: number, z: number) {
    this.kind = kind;
    this.fig = new Figure(baked(kind, Math.floor(Math.random() * 4)), solidMat, glowMat);
    // Raise first, then yaw: lets the stance twist the hips while the arm stays on target.
    for (const a of this.fig.arms) a.upper.rotation.order = 'YXZ';
    this.cooldown = 1.2 + Math.random() * 1.5;
    this.preferred = kind === 'rifleman' ? 6 + Math.random() * 3 : 4 + Math.random() * 3;
    this.peekT = 1.5 + Math.random() * 1.5;
    if (kind === 'gunner' || kind === 'hostage') this.arm(new Weapon('pistol', 3 + Math.floor(Math.random() * 4)));
    if (kind === 'rifleman') this.arm(new Weapon('smg', 12 + Math.floor(Math.random() * 13)));
    this.fig.root.position.set(x, 0, z);
    this.fig.root.scale.set(1, 0.01, 1);
    this.updateSpheres();
  }

  get group(): THREE.Group {
    return this.fig.root;
  }

  get position(): THREE.Vector3 {
    return this.fig.root.position;
  }

  get materialized(): boolean {
    return this.spawnT >= MATERIALIZE;
  }

  get staggered(): boolean {
    return this.staggerT > 0;
  }

  private arm(w: Weapon): void {
    this.weapon = w;
    w.held = true;
    const hand = this.fig.arms[1].end;
    hand.add(w.mesh);
    w.mesh.position.set(0, 0.02, 0.02);
    // Barrel along the forearm, grip facing the back of the arm (down once the arm is raised).
    w.mesh.rotation.set(Math.PI / 2, Math.PI, 0);
  }

  /** Hands over the weapon (disarm / knocked loose). The enemy fights bare-handed after. */
  takeWeapon(): Weapon | null {
    const w = this.weapon;
    if (!w) return null;
    this.weapon = null;
    this.burstLeft = 0;
    // Drop the shooting stance.
    for (const a of this.fig.arms) a.upper.rotation.set(0, 0, 0);
    this.fig.hips.rotation.y = 0;
    this.fig.head.rotation.y = 0;
    return w;
  }

  /** Release the hostage (disarmed or killed). */
  releaseHostage(): Civilian | null {
    const c = this.hostage;
    this.hostage = null;
    if (c) c.heldBy = null;
    this.fig.hips.position.x = 0;
    return c;
  }

  grab(c: Civilian): void {
    this.hostage = c;
    c.heldBy = this;
    c.setState('held');
  }

  /** Skip the spawn-in effect (tests / scripted placement). */
  materializeNow(): void {
    this.spawnT = MATERIALIZE;
    this.fig.root.scale.setScalar(1);
    this.updateSpheres();
  }

  stagger(seconds: number): void {
    this.staggerT = seconds;
    this.aimT = 0;
    this.burstLeft = 0;
  }

  updateSpheres(): void {
    this.fig.root.updateMatrixWorld(true);
    this.fig.headMark.getWorldPosition(this.spheres[0].c);
    this.fig.chestMark.getWorldPosition(this.spheres[1].c);
    this.fig.pelvisMark.getWorldPosition(this.spheres[2].c);
  }

  headPos(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.spheres[0].c);
  }

  update(gdt: number, ctx: EnemyContext): void {
    if (!this.alive) return;
    if (this.spawnT < MATERIALIZE) {
      this.spawnT += gdt;
      const k = Math.min(1, this.spawnT / MATERIALIZE);
      this.fig.root.scale.set(1, Math.max(0.01, k * k * (3 - 2 * k)), 1);
      if (this.hostage) this.holdHostage(ctx);
      this.updateSpheres();
      return;
    }
    this.fig.root.scale.setScalar(1);
    this.weapon?.animate(gdt * 3);

    if (this.hostage && !this.hostage.alive) this.releaseHostage();

    if (this.staggerT > 0) {
      this.staggerT -= gdt;
      this.fig.torso.rotation.x = -0.35 * Math.min(1, this.staggerT * 3);
      this.fig.arms.forEach((a) => (a.upper.rotation.x *= 0.9));
      if (this.hostage) this.holdHostage(ctx);
      this.updateSpheres();
      return;
    }
    this.fig.torso.rotation.x *= 0.85;

    this.faceTarget(ctx.playerHead, gdt);
    if (this.hostage && this.weapon) this.updateHostageTaker(gdt, ctx);
    else if (this.weapon) this.updateShooter(gdt, ctx);
    else this.updateMelee(gdt, ctx);
    this.updateSpheres();
  }

  private faceTarget(p: THREE.Vector3, gdt: number): void {
    const pos = this.position;
    const targetYaw = Math.atan2(p.x - pos.x, p.z - pos.z);
    let dy = targetYaw - this.fig.root.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.fig.root.rotation.y += dy * Math.min(1, gdt * 6);
  }

  private distTo(p: THREE.Vector3): number {
    return Math.hypot(p.x - this.position.x, p.z - this.position.z);
  }

  private updateShooter(gdt: number, ctx: EnemyContext): void {
    const dist = this.distTo(ctx.playerHead);
    const los = ctx.world.lineOfSight(this.headPos(_v), ctx.playerHead);

    // Re-evaluate a firing spot every few seconds, preferring civilians between us and the player.
    this.spotT -= gdt;
    if (this.spotT <= 0) {
      this.spotT = 3 + Math.random() * 2;
      this.spot = this.pickSpot(ctx);
    }

    let moving = false;
    if (!los) {
      moving = this.walkToward(ctx.playerHead, gdt, 1.3, ctx);
      this.aimT = 0;
    } else if (this.spot && this.distTo(this.spot) > 0.3) {
      moving = this.walkToward(this.spot, gdt, 1.4, ctx);
      this.aimT = Math.max(0, this.aimT - gdt);
    } else if (dist > this.preferred + 2) {
      moving = this.walkToward(ctx.playerHead, gdt, 1.3, ctx);
    } else {
      moving = this.strafe(gdt, ctx);
      this.aimAndFire(gdt, ctx);
    }
    this.animateWalk(moving, gdt, 7);
    const aiming = !moving || this.aimT > 0;
    this.stance(aiming, moving, gdt);
    if (aiming) this.poseAim(ctx.playerHead, dist, gdt);
  }

  /** Every few seconds, side-step while keeping the gun on the player. */
  private strafe(gdt: number, ctx: EnemyContext): boolean {
    this.strafeT -= gdt;
    if (this.strafeT <= 0 && this.strafeLeft <= 0) {
      this.strafeLeft = 0.5 + Math.random() * 0.5;
      this.strafeSign = Math.random() < 0.5 ? -1 : 1;
      this.strafeT = 2.5 + Math.random() * 2;
    }
    if (this.strafeLeft <= 0) return false;
    this.strafeLeft -= gdt;
    const toP = _v.set(ctx.playerHead.x - this.position.x, 0, ctx.playerHead.z - this.position.z).normalize();
    const step = 1.3 * gdt * this.strafeSign;
    const moved = ctx.world.moveCircle(this.position, -toP.z * step, toP.x * step, ENEMY_RADIUS);
    if (moved < Math.abs(step) * 0.3) this.strafeSign *= -1;
    return moved > 0;
  }

  /**
   * Shooting stance: body bladed to the target, gun arm straight out, knees bent.
   * The hip twist is cancelled on the gun arm so it still points at the target.
   */
  private stance(on: boolean, moving: boolean, gdt: number): void {
    const k = Math.min(1, gdt * 6);
    const f = this.fig;
    const lerp = (v: number, t: number) => v + (t - v) * k;
    const twist = on ? -0.4 : 0;
    f.hips.rotation.y = lerp(f.hips.rotation.y, twist);
    f.arms[1].upper.rotation.y = lerp(f.arms[1].upper.rotation.y, -twist);
    const support = on && this.weapon?.kind === 'smg';
    f.arms[0].upper.rotation.y = lerp(f.arms[0].upper.rotation.y, support ? -twist + 0.55 : 0);
    f.head.rotation.y = lerp(f.head.rotation.y, -twist * 0.8);
    f.torso.rotation.x = lerp(f.torso.rotation.x, on ? 0.1 : 0);
    if (moving) return;
    const [front, back] = f.legs;
    front.upper.rotation.x = lerp(front.upper.rotation.x, on ? -0.3 : 0);
    front.lower.rotation.x = lerp(front.lower.rotation.x, on ? 0.45 : 0);
    back.upper.rotation.x = lerp(back.upper.rotation.x, on ? 0.2 : 0);
    back.lower.rotation.x = lerp(back.lower.rotation.x, on ? 0.35 : 0);
    f.hips.position.y = lerp(f.hips.position.y, on ? HIP_Y - 0.05 : HIP_Y);
  }

  private pickSpot(ctx: EnemyContext): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < 9; i++) {
      const cand =
        i === 0
          ? this.position.clone()
          : this.position.clone().add(_t.set(Math.cos(i * 0.7 + Math.random()), 0, Math.sin(i * 0.7 + Math.random())).multiplyScalar(1 + Math.random() * 2.5));
      if (i > 0 && ctx.world.blocked(cand.x, cand.z, ENEMY_RADIUS)) continue;
      const head = _w.set(cand.x, 1.74, cand.z);
      if (!ctx.world.lineOfSight(head, ctx.playerHead)) continue;
      const d = Math.hypot(cand.x - ctx.playerHead.x, cand.z - ctx.playerHead.z);
      if (d < 3) continue;
      const score = ctx.coverScore(cand) * 3 - Math.abs(d - this.preferred) * 0.4 - cand.distanceTo(this.position) * 0.25;
      if (score > bestScore) {
        bestScore = score;
        best = cand;
      }
    }
    return best;
  }

  private chooseTarget(ctx: EnemyContext, from: THREE.Vector3): THREE.Vector3 {
    const alive = ctx.protectees.filter((c) => c.alive);
    if (alive.length && Math.random() < 0.35) {
      const c = alive[Math.floor(Math.random() * alive.length)];
      if (ctx.world.lineOfSight(from, c.spheres[1].c)) return _t.copy(c.spheres[1].c);
    }
    _t.copy(ctx.playerHead);
    _t.y -= Math.random() * 0.4;
    return _t;
  }

  private aimAndFire(gdt: number, ctx: EnemyContext): void {
    const w = this.weapon!;
    this.aimT += gdt;
    this.cooldown -= gdt;
    if (this.burstLeft === 0 && this.aimT > 0.6 && this.cooldown <= 0) {
      this.burstLeft = w.kind === 'smg' ? 3 + Math.floor(Math.random() * 3) : 1;
      this.burstT = 0;
    }
    if (this.burstLeft > 0) {
      this.burstT -= gdt;
      if (this.burstT <= 0) {
        this.burstT = w.spec.interval * 1.4;
        this.burstLeft--;
        this.fireAt(ctx, w.kind === 'smg' ? 0.07 : 0.03);
        if (this.burstLeft === 0) this.cooldown = (w.kind === 'smg' ? 2.4 : 2.0) + Math.random() * 1.4;
      }
    }
  }

  private fireAt(ctx: EnemyContext, spread: number): void {
    const w = this.weapon!;
    const from = w.muzzleWorld(new THREE.Vector3());
    const target = this.chooseTarget(ctx, from).clone();
    const dir = target.sub(from).normalize();
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    w.showFlash();
    ctx.shoot(from, dir.normalize(), w, this);
  }

  private poseAim(target: THREE.Vector3, dist: number, gdt: number): void {
    const pitch = Math.atan2(target.y - 0.1 - SHOULDER_Y, Math.max(0.5, dist));
    const k = Math.min(1, gdt * 8);
    const [armL, armR] = this.fig.arms;
    armR.upper.rotation.x = THREE.MathUtils.lerp(armR.upper.rotation.x, -Math.PI / 2 - pitch, k);
    armR.lower.rotation.x *= 1 - k;
    if (this.weapon?.kind === 'smg' && !this.hostage) {
      // Support hand on the SMG.
      armL.upper.rotation.x = THREE.MathUtils.lerp(armL.upper.rotation.x, -Math.PI / 2 - pitch + 0.25, k);
      armL.upper.rotation.z = THREE.MathUtils.lerp(armL.upper.rotation.z, -0.45, k);
    }
  }

  /** Hide behind the hostage, shuffle sideways, and lean out now and then to shoot. */
  private updateHostageTaker(gdt: number, ctx: EnemyContext): void {
    const dist = this.distTo(ctx.playerHead);
    this.sideT -= gdt;
    if (this.sideT <= 0) {
      this.sideT = 2 + Math.random() * 2;
      if (Math.random() < 0.5) this.leanSide *= -1;
    }
    // Keep a stand-off distance, drifting sideways.
    const toP = _v.set(ctx.playerHead.x - this.position.x, 0, ctx.playerHead.z - this.position.z).normalize();
    const side = _w.set(-toP.z, 0, toP.x);
    let mx = side.x * this.leanSide * 0.35 * gdt;
    let mz = side.z * this.leanSide * 0.35 * gdt;
    if (dist < 4) {
      mx -= toP.x * 0.5 * gdt;
      mz -= toP.z * 0.5 * gdt;
    } else if (dist > 8) {
      mx += toP.x * 0.5 * gdt;
      mz += toP.z * 0.5 * gdt;
    }
    const moved = ctx.world.moveCircle(this.position, mx, mz, ENEMY_RADIUS + 0.2);
    if (moved < 0.1 * Math.hypot(mx, mz)) this.leanSide *= -1;
    this.animateWalk(moved > 0, gdt, 5);

    this.peekT -= gdt;
    if (this.peekState === 'hide' && this.peekT <= 0) {
      this.peekState = 'out';
      this.peekT = 0.8;
      this.aimT = 0;
      this.burstLeft = 0;
      this.cooldown = 0;
    } else if (this.peekState === 'out') {
      this.aimT += gdt;
      if (this.aimT > 0.35 && this.burstLeft === 0 && this.cooldown <= 0) {
        this.fireAt(ctx, 0.05);
        this.cooldown = 99;
      }
      if (this.peekT <= 0) {
        this.peekState = 'hide';
        this.peekT = 1.8 + Math.random() * 1.4;
      }
    }
    const targetLean = this.peekState === 'out' ? 0.5 : 0.14;
    this.lean += (targetLean - this.lean) * Math.min(1, gdt * 10);
    // Local +x is the enemy's left when facing the player; lean towards leanSide.
    this.fig.hips.position.x = this.lean * this.leanSide;
    this.fig.hips.position.y = HIP_Y - (this.peekState === 'out' ? 0 : 0.04);
    this.poseAim(ctx.playerHead, dist, gdt);
    this.holdHostage(ctx);
  }

  private holdHostage(ctx: EnemyContext): void {
    const c = this.hostage;
    if (!c) return;
    const toP = _v.set(ctx.playerHead.x - this.position.x, 0, ctx.playerHead.z - this.position.z);
    if (toP.lengthSq() < 1e-6) toP.set(0, 0, 1);
    toP.normalize();
    c.position.set(this.position.x + toP.x * 0.42, 0, this.position.z + toP.z * 0.42);
    c.fig.root.rotation.y = Math.atan2(toP.x, toP.z);
    c.updateSpheres();
  }

  private updateMelee(gdt: number, ctx: EnemyContext): void {
    const dist = this.distTo(ctx.playerHead);
    let moving = false;
    if (dist > 0.75) {
      moving = this.walkToward(ctx.playerHead, gdt, 2.4, ctx);
      this.windup = Math.max(0, this.windup - gdt);
    } else {
      this.windup += gdt;
      if (this.windup > 0.45) ctx.strike(this);
    }
    this.animateWalk(moving, gdt, 11);
    const reach = dist < 2.5 ? -Math.PI / 2 : 0;
    const [armL, armR] = this.fig.arms;
    const k = Math.min(1, gdt * 5);
    armL.upper.rotation.x = THREE.MathUtils.lerp(armL.upper.rotation.x, reach, k);
    armR.upper.rotation.x = THREE.MathUtils.lerp(armR.upper.rotation.x, reach - this.windup * 1.5, k);
    armL.upper.rotation.z *= 0.9;
  }

  private animateWalk(moving: boolean, gdt: number, speed: number): void {
    if (moving) {
      this.phase += gdt * speed;
      this.fig.walk(this.phase);
      if (!this.weapon && this.windup === 0) {
        this.fig.arms[0].upper.rotation.x = -Math.sin(this.phase) * 0.5;
        this.fig.arms[1].upper.rotation.x = Math.sin(this.phase) * 0.5;
      }
    } else this.fig.settleLegs(0.9);
  }

  private walkToward(target: THREE.Vector3, gdt: number, speed: number, ctx: EnemyContext): boolean {
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) return false;
    const step = Math.min(d, speed * gdt);
    let ang = Math.atan2(dx, dz);
    if (this.steerT > 0) {
      this.steerT -= gdt;
      ang += this.steerSign * 1.3;
    }
    let mx = Math.sin(ang) * step;
    let mz = Math.cos(ang) * step;

    for (const o of ctx.others) {
      if (o === this || !o.alive) continue;
      const ox = this.position.x - o.position.x;
      const oz = this.position.z - o.position.z;
      const od = Math.hypot(ox, oz);
      if (od > 0.001 && od < 0.8) {
        mx += (ox / od) * (0.8 - od) * 0.5;
        mz += (oz / od) * (0.8 - od) * 0.5;
      }
    }

    const moved = ctx.world.moveCircle(this.position, mx, mz, ENEMY_RADIUS);
    if (step > 0.0005 && moved < step * 0.3) {
      if (this.steerT > 0) this.steerSign *= -1;
      this.steerT = 0.9;
    }
    return moved > 0;
  }
}
