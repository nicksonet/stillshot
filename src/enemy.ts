import * as THREE from 'three';
import type { Civilian } from './civilian';
import type { EnemyKind } from './levels';
import { Person } from './person';
import { Weapon } from './weapons';
import type { World } from './world';

export const ENEMY_RADIUS = 0.35;
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

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _t = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qr = new THREE.Quaternion();

/** A gangster: generated rigged model (Tripo3D) driven by the AI below. */
export class Enemy {
  readonly kind: EnemyKind;
  readonly body: Person;
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
  private target = new THREE.Vector3();

  constructor(kind: EnemyKind, x: number, z: number) {
    this.kind = kind;
    this.body = new Person('gangster');
    this.cooldown = 1.2 + Math.random() * 1.5;
    this.preferred = kind === 'rifleman' ? 6 + Math.random() * 3 : 4 + Math.random() * 3;
    this.peekT = 1.5 + Math.random() * 1.5;
    if (kind === 'gunner' || kind === 'hostage') this.arm(new Weapon('pistol', 3 + Math.floor(Math.random() * 4)));
    if (kind === 'rifleman') this.arm(new Weapon('smg', 12 + Math.floor(Math.random() * 13)));
    this.body.root.position.set(x, 0, z);
    this.body.root.scale.set(1, 0.01, 1);
    this.body.update(0);
    this.updateSpheres();
  }

  get group(): THREE.Group {
    return this.body.root;
  }

  get position(): THREE.Vector3 {
    return this.body.root.position;
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
    this.body.root.add(w.mesh);
  }

  /** Put the held gun in the right hand (the hand moves with the clip and the aim). */
  private syncWeapon(): void {
    const w = this.weapon;
    if (!w) return;
    this.body.gunTransform(_v, _q);
    this.body.root.worldToLocal(_v);
    w.mesh.position.copy(_v);
    this.body.root.getWorldQuaternion(_qr).invert();
    w.mesh.quaternion.copy(_qr.multiply(_q));
  }

  /** Hands over the weapon (disarm / knocked loose). The enemy fights bare-handed after. */
  takeWeapon(): Weapon | null {
    const w = this.weapon;
    if (!w) return null;
    this.weapon = null;
    this.burstLeft = 0;
    this.body.aimAt = null;
    this.body.twoHanded = false;
    return w;
  }

  /** Release the hostage (disarmed or killed). */
  releaseHostage(): Civilian | null {
    const c = this.hostage;
    this.hostage = null;
    if (c) c.heldBy = null;
    this.body.lean = 0;
    this.body.crouch = 0;
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
    this.body.root.scale.setScalar(1);
    this.body.update(0);
    this.updateSpheres();
  }

  stagger(seconds: number): void {
    this.staggerT = seconds;
    this.aimT = 0;
    this.burstLeft = 0;
    this.body.play('hurt', 0.1);
  }

  updateSpheres(): void {
    this.body.headPos(this.spheres[0].c);
    this.body.chestPos(this.spheres[1].c);
    this.body.pelvisPos(this.spheres[2].c);
  }

  headPos(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.spheres[0].c);
  }

  update(gdt: number, ctx: EnemyContext): void {
    if (!this.alive) return;
    if (this.spawnT < MATERIALIZE) {
      this.spawnT += gdt;
      const k = Math.min(1, this.spawnT / MATERIALIZE);
      this.body.root.scale.set(1, Math.max(0.01, k * k * (3 - 2 * k)), 1);
      if (this.hostage) this.holdHostage(ctx);
      this.finish(gdt);
      return;
    }
    this.body.root.scale.setScalar(1);
    this.weapon?.animate(gdt * 3);

    if (this.hostage && !this.hostage.alive) this.releaseHostage();

    if (this.staggerT > 0) {
      this.staggerT -= gdt;
      this.body.aimAt = null;
      if (this.hostage) this.holdHostage(ctx);
      this.finish(gdt);
      return;
    }

    this.faceTarget(ctx.playerHead, gdt);
    if (this.hostage && this.weapon) this.updateHostageTaker(gdt, ctx);
    else if (this.weapon) this.updateShooter(gdt, ctx);
    else this.updateMelee(gdt, ctx);
    this.finish(gdt);
  }

  /** Clip + pose, then gun and hit spheres follow the body. */
  private finish(gdt: number): void {
    this.body.update(gdt);
    this.syncWeapon();
    this.updateSpheres();
  }

  private faceTarget(p: THREE.Vector3, gdt: number): void {
    const pos = this.position;
    const targetYaw = Math.atan2(p.x - pos.x, p.z - pos.z);
    let dy = targetYaw - this.body.root.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.body.root.rotation.y += dy * Math.min(1, gdt * 6);
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
    this.body.play(moving ? 'walk' : 'idle');
    const aiming = !moving || this.aimT > 0;
    this.body.crouch = aiming && !moving ? 0.05 : 0;
    this.aim(aiming ? ctx.playerHead : null);
  }

  /** Point the gun arm (both arms for an SMG) at the target, or relax. */
  private aim(target: THREE.Vector3 | null): void {
    if (!target) {
      this.body.aimAt = null;
      return;
    }
    this.body.aimAt = this.target.copy(target).setY(target.y - 0.1);
    this.body.twoHanded = this.weapon?.kind === 'smg' && !this.hostage;
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
    this.body.play(moved > 0 ? 'walk' : 'idle');

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
    this.body.lean = this.lean * this.leanSide;
    this.body.crouch = this.peekState === 'out' ? 0 : 0.04;
    this.aim(ctx.playerHead);
    this.holdHostage(ctx);
  }

  private holdHostage(ctx: EnemyContext): void {
    const c = this.hostage;
    if (!c) return;
    const toP = _v.set(ctx.playerHead.x - this.position.x, 0, ctx.playerHead.z - this.position.z);
    if (toP.lengthSq() < 1e-6) toP.set(0, 0, 1);
    toP.normalize();
    c.position.set(this.position.x + toP.x * 0.42, 0, this.position.z + toP.z * 0.42);
    c.body.root.rotation.y = Math.atan2(toP.x, toP.z);
    c.updateSpheres();
  }

  /** Bare hands: run at the player and grab. */
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
    this.body.play(moving ? 'run' : 'idle');
    // Reach out with both arms when close.
    if (dist < 2.5) {
      this.body.aimAt = this.target.copy(ctx.playerHead).setY(ctx.playerHead.y - 0.35);
      this.body.twoHanded = true;
    } else this.body.aimAt = null;
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
