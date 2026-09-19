import * as THREE from 'three';
import { sfx } from './audio';
import { Bullets, type Bullet } from './bullets';
import type { Civilian } from './civilian';
import { segmentSphere } from './collide';
import { Debris } from './debris';
import type { Enemy, HitSphere } from './enemy';
import type { Game } from './game';
import { Shards } from './shards';
import type { Weapon } from './weapons';

const PLAYER_BULLET_SPEED = 45;
const ENEMY_BULLET_SPEED = 11;
export const RED = 0xff2a1a;
const CIV_SHARDS = 0xdfe8f5;
const SUIT_SHARDS = 0x1c1c22;
const VIP_SHARDS = 0xf0b73a;

interface Hit {
  t: number;
  apply: () => void;
}

/**
 * Everything that flies or breaks: bullets (both sides), guns in the air or on
 * the floor, and the people they hit.
 */
export class Combat {
  readonly bullets: Bullets;
  readonly shards: Shards;
  readonly debris: Debris;
  freeGuns: Weapon[] = [];
  kills = 0;

  constructor(private g: Game) {
    this.bullets = new Bullets(g.scene);
    this.shards = new Shards(g.scene);
    this.debris = new Debris(g.scene);
  }

  clear(): void {
    for (const w of this.freeGuns) w.mesh.removeFromParent();
    this.freeGuns = [];
    this.bullets.clear();
    this.shards.clear();
    this.debris.clear();
  }

  /** Advance everything in game time and resolve hits. */
  update(gdt: number, realDt: number): void {
    for (const w of this.g.heldWeapons()) {
      w.cooldown -= gdt;
      w.realCooldown -= realDt;
    }
    this.bullets.advance(gdt);
    this.resolveBullets();
    this.bullets.sync();
    this.updateFreeGuns(gdt);
    this.shards.update(gdt);
    this.debris.update(gdt);
  }

  // ---------------------------------------------------------------- shooting

  /** Automatic fire while the trigger is held: respects the weapon's cadence. */
  autoFire(w: Weapon, dir: () => THREE.Vector3, onFired?: (w: Weapon) => void, from?: () => THREE.Vector3): void {
    if (w.cooldown > 0 || w.realCooldown > 0) return;
    this.fire(w, dir(), onFired, from?.());
  }

  fire(w: Weapon, dir: THREE.Vector3, onFired?: (w: Weapon) => void, from?: THREE.Vector3): void {
    const state = this.g.state;
    if (state !== 'playing' && state !== 'menu') return;
    if (!w.fire()) {
      if (w.realCooldown <= 0) sfx.empty();
      w.realCooldown = 0.25;
      return;
    }
    w.cooldown = w.spec.interval;
    w.realCooldown = 0.06;
    const d = dir.clone();
    if (w.spec.spread) {
      d.x += (Math.random() - 0.5) * w.spec.spread;
      d.y += (Math.random() - 0.5) * w.spec.spread;
      d.z += (Math.random() - 0.5) * w.spec.spread;
    }
    const origin = from ?? w.muzzleWorld(new THREE.Vector3());
    this.bullets.spawn('player', origin, d.normalize(), PLAYER_BULLET_SPEED);
    if (w.kind === 'smg') sfx.smg();
    else if (w.kind === 'revolver') sfx.revolver();
    else sfx.shoot();
    this.g.time.kick(w.spec.kick);
    this.g.triggerPanic();
    onFired?.(w);
  }

  /** An enemy fires; his bullets pass through his own hostage. */
  enemyShoot(from: THREE.Vector3, dir: THREE.Vector3, w: Weapon, shooter: Enemy): void {
    const b = this.bullets.spawn('enemy', from, dir, ENEMY_BULLET_SPEED);
    b.ignore = shooter.hostage ?? undefined;
    if (w.kind === 'smg') sfx.smg();
    else sfx.enemyShoot(from.distanceTo(this.g.headPos));
    this.g.triggerPanic();
  }

  // ---------------------------------------------------------------- guns changing hands

  /** A gun leaves a hand (dropped, thrown, knocked loose) and becomes a physics object. */
  release(w: Weapon, vel: THREE.Vector3, thrown: boolean): void {
    this.g.scene.attach(w.mesh);
    w.held = false;
    w.thrown = thrown;
    w.resting = false;
    w.vel.copy(vel);
    w.spin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 6);
    this.freeGuns.push(w);
  }

  /** Remove a gun from the floor so someone can hold it. */
  takeFree(w: Weapon): void {
    this.freeGuns.splice(this.freeGuns.indexOf(w), 1);
  }

  /** Take an enemy's weapon; he lets go of any hostage and fights bare-handed. */
  disarm(e: Enemy): Weapon | null {
    const w = e.takeWeapon();
    if (!w) return null;
    this.freeHostage(e);
    e.stagger(0.8);
    w.mesh.removeFromParent();
    sfx.disarm();
    this.g.time.kick(0.15);
    return w;
  }

  /** Punch: an armed enemy loses his weapon and staggers; an unarmed one shatters. */
  punch(e: Enemy, dir: THREE.Vector3): void {
    sfx.punch();
    if (e.weapon) {
      const w = e.takeWeapon()!;
      this.freeHostage(e);
      this.release(w, dir.clone().multiplyScalar(2).setY(1.5), false);
      e.stagger(1.0);
      this.g.time.kick(0.2);
    } else this.killEnemy(e, dir);
  }

  private freeHostage(e: Enemy): void {
    const c = e.releaseHostage();
    if (c && c.alive) c.flee(this.g.exits);
  }

  // ---------------------------------------------------------------- deaths

  /** Shatter an enemy: his body breaks into its parts, the one that was hit flying hardest. */
  killEnemy(e: Enemy, push: THREE.Vector3, at?: THREE.Vector3): void {
    if (!e.alive) return;
    e.alive = false;
    this.kills++;
    this.freeHostage(e);
    const hit = (at ?? e.spheres[1].c).clone();
    const impulse = push.clone().setY(0).normalize().multiplyScalar(3);
    this.shards.burst(hit, 18, SUIT_SHARDS, 2.5, 0.05, 0.12, impulse);
    this.shards.burst(hit, 8, RED, 2.5, 0.04, 0.1, impulse);
    const w = e.takeWeapon();
    if (w) this.release(w, new THREE.Vector3((Math.random() - 0.5) * 1.5, 2, (Math.random() - 0.5) * 1.5), false);
    this.debris.explode(e.fig, impulse, hit);
    this.g.scene.remove(e.group);
    sfx.shatter();
    this.g.time.kick(0.2);
  }

  killCivilian(c: Civilian, push: THREE.Vector3, byPlayer: boolean, at?: THREE.Vector3): void {
    if (!c.alive) return;
    c.alive = false;
    const holder = this.g.enemies.find((e) => e.hostage === c);
    holder?.releaseHostage();
    const hit = (at ?? c.spheres[1].c).clone();
    const impulse = push.clone().setY(0).normalize().multiplyScalar(2.5);
    this.shards.burst(hit, 20, c.vip ? VIP_SHARDS : CIV_SHARDS, 2.2, 0.05, 0.12, impulse);
    this.debris.explode(c.fig, impulse, hit);
    this.g.scene.remove(c.fig.root);
    sfx.glass();
    if (c.vip) this.g.fail('vip');
    else if (byPlayer) this.g.fail('civilian');
  }

  // ---------------------------------------------------------------- collisions

  private resolveBullets(): void {
    const g = this.g;
    const list = this.bullets.list;
    const held = g.heldWeapons();
    for (const b of list) {
      if (b.dead) continue;
      let best: Hit | null = null;
      const consider = (t: number, apply: () => void) => {
        if (t >= 0 && (!best || t < best.t)) best = { t, apply };
      };
      // `at` is the centre of the sphere that was hit (head, chest or legs).
      const spheres = (ss: HitSphere[], apply: (at: THREE.Vector3) => void) => {
        for (const s of ss) consider(segmentSphere(b.prev, b.pos, s.c, s.r), () => apply(s.c));
      };

      consider(g.world.segmentHit(b.prev, b.pos), () => this.spark(b, 0x8a7ab0));

      for (const c of g.civilians) {
        if (!c.alive || c.gone || c === b.ignore) continue;
        spheres(c.spheres, (at) => this.killCivilian(c, b.dir, b.owner === 'player', at));
      }

      if (b.owner === 'player') {
        for (const e of g.enemies) if (e.alive && e.materialized) spheres(e.spheres, (at) => this.killEnemy(e, b.dir, at));
        if (g.state === 'menu' && g.menuTarget.visible)
          consider(segmentSphere(b.prev, b.pos, g.menuTarget.position, 0.25), () => g.hitMenuTarget(b.dir));
        for (const o of list) {
          if (o.owner !== 'enemy' || o.dead) continue;
          consider(segmentSphere(b.prev, b.pos, o.pos, 0.12), () => {
            o.dead = true;
            this.spark(o, 0xff3344);
            sfx.ricochet();
          });
        }
      } else if (g.state === 'playing') {
        consider(segmentSphere(b.prev, b.pos, g.headPos, 0.13), () => g.fail('dead'));
        const torso = g.headPos.clone();
        torso.y -= 0.45;
        consider(segmentSphere(b.prev, b.pos, torso, 0.2), () => g.fail('dead'));
        for (const w of held) {
          consider(segmentSphere(b.prev, b.pos, w.mesh.getWorldPosition(new THREE.Vector3()), 0.09), () => {
            this.spark(b, 0x19f0ff);
            sfx.ricochet();
          });
        }
      }

      const hit = best as Hit | null;
      if (hit) {
        b.pos.lerpVectors(b.prev, b.pos, hit.t);
        b.dead = true;
        hit.apply();
      }
    }
  }

  private spark(b: Bullet, color: number): void {
    this.shards.burst(b.pos, 6, color, 2, 0.02, 0.02, b.dir.clone().multiplyScalar(-1.5));
  }

  /** Guns in flight: gravity, bouncing, and a thrown gun kills whoever it hits. */
  private updateFreeGuns(gdt: number): void {
    const g = this.g;
    for (const w of this.freeGuns) {
      if (w.resting) continue;
      const p = w.mesh.position;
      const prev = p.clone();
      w.vel.y -= 9.8 * gdt;
      p.addScaledVector(w.vel, gdt);
      w.mesh.rotation.x += w.spin.x * gdt;
      w.mesh.rotation.y += w.spin.y * gdt;
      w.mesh.rotation.z += w.spin.z * gdt;

      if (w.thrown && w.vel.length() > 2) {
        const hits = (ss: HitSphere[]) => ss.some((s) => segmentSphere(prev, p, s.c, s.r + 0.05) >= 0);
        const e = g.enemies.find((x) => x.alive && x.materialized && hits(x.spheres));
        const c = e ? null : g.civilians.find((x) => x.alive && !x.gone && hits(x.spheres));
        if (e) this.killEnemy(e, w.vel.clone().normalize());
        else if (c) this.killCivilian(c, w.vel.clone().normalize(), true);
        else if (g.state === 'menu' && g.menuTarget.visible && segmentSphere(prev, p, g.menuTarget.position, 0.3) >= 0)
          g.hitMenuTarget(w.vel.clone().normalize());
        if (e || c) {
          w.vel.multiplyScalar(-0.25);
          w.thrown = false;
        }
      }
      const t = g.world.segmentHit(prev, p);
      if (t >= 0 && p.y > 0.05) {
        p.lerpVectors(prev, p, t * 0.9);
        w.vel.multiplyScalar(-0.3);
        w.thrown = false;
      }
      if (p.y < 0.03) {
        p.y = 0.03;
        w.vel.y = 0;
        w.vel.x *= 0.5;
        w.vel.z *= 0.5;
        w.spin.multiplyScalar(0.5);
        w.thrown = false;
        if (w.vel.length() < 0.15) {
          w.resting = true;
          w.mesh.rotation.set(0, w.mesh.rotation.y, Math.PI / 2);
        }
      }
    }
  }
}
