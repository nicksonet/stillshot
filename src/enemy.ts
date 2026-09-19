import * as THREE from 'three';
import { Gun } from './gun';
import type { EnemyKind } from './levels';
import type { World } from './world';

const bodyMat = new THREE.MeshPhongMaterial({ color: 0xff2a1a, emissive: 0x5a0600, flatShading: true, shininess: 80, specular: 0xffb0a0 });
const torsoGeo = new THREE.CylinderGeometry(0.25, 0.17, 0.62, 5);
const hipsGeo = new THREE.CylinderGeometry(0.17, 0.15, 0.16, 5);
const headGeo = new THREE.IcosahedronGeometry(0.14, 0);
const limbGeo = new THREE.BoxGeometry(1, 1, 1);

export const ENEMY_RADIUS = 0.35;
const SHOULDER_Y = 1.52;

export interface HitSphere {
  c: THREE.Vector3;
  r: number;
}

export interface EnemyContext {
  playerHead: THREE.Vector3;
  world: World;
  others: Enemy[];
  shoot(from: THREE.Vector3, dir: THREE.Vector3): void;
  strike(enemy: Enemy): void;
}

function limb(w: number, h: number, d: number, pivot: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  g.position.copy(pivot);
  const m = new THREE.Mesh(limbGeo, bodyMat);
  m.scale.set(w, h, d);
  m.position.y = -h / 2;
  g.add(m);
  return g;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class Enemy {
  readonly group = new THREE.Group();
  readonly kind: EnemyKind;
  alive = true;
  gun: Gun | null = null;
  readonly spheres: HitSphere[] = [
    { c: new THREE.Vector3(), r: 0.16 }, // head
    { c: new THREE.Vector3(), r: 0.28 }, // torso
    { c: new THREE.Vector3(), r: 0.22 }, // legs
  ];

  private spawnT = 0;
  private cooldown: number;
  private aimT = 0;
  private phase = Math.random() * 6;
  private preferred: number;
  private steerSign = Math.random() < 0.5 ? -1 : 1;
  private steerT = 0;
  private windup = 0;
  private legL: THREE.Group;
  private legR: THREE.Group;
  private armL: THREE.Group;
  private armR: THREE.Group;

  constructor(kind: EnemyKind, x: number, z: number) {
    this.kind = kind;
    this.cooldown = 1.2 + Math.random() * 1.5;
    this.preferred = 4 + Math.random() * 4;

    const torso = new THREE.Mesh(torsoGeo, bodyMat);
    torso.position.y = 1.26;
    const hips = new THREE.Mesh(hipsGeo, bodyMat);
    hips.position.y = 0.94;
    const head = new THREE.Mesh(headGeo, bodyMat);
    head.position.y = 1.72;
    this.legL = limb(0.13, 0.88, 0.14, new THREE.Vector3(-0.1, 0.9, 0));
    this.legR = limb(0.13, 0.88, 0.14, new THREE.Vector3(0.1, 0.9, 0));
    this.armL = limb(0.09, 0.6, 0.09, new THREE.Vector3(-0.3, SHOULDER_Y, 0));
    this.armR = limb(0.09, 0.6, 0.09, new THREE.Vector3(0.3, SHOULDER_Y, 0));
    this.group.add(torso, hips, head, this.legL, this.legR, this.armL, this.armR);

    if (kind === 'gunner') {
      this.gun = new Gun(2 + Math.floor(Math.random() * 3));
      this.gun.mesh.position.set(0, -0.62, 0.02);
      // Barrel along the arm, grip facing the arm's back (down once the arm is raised).
      this.gun.mesh.rotation.set(Math.PI / 2, Math.PI, 0);
      this.armR.add(this.gun.mesh);
    }

    this.group.position.set(x, 0, z);
    this.group.scale.setScalar(0.01);
    this.updateSpheres();
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  get materialized(): boolean {
    return this.spawnT >= 0.6;
  }

  updateSpheres(): void {
    const p = this.group.position;
    this.spheres[0].c.set(p.x, 1.72, p.z);
    this.spheres[1].c.set(p.x, 1.25, p.z);
    this.spheres[2].c.set(p.x, 0.55, p.z);
  }

  headPos(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.group.position.x, 1.72, this.group.position.z);
  }

  update(gdt: number, ctx: EnemyContext): void {
    if (!this.alive) return;
    if (this.spawnT < 0.6) {
      this.spawnT += gdt;
      const k = Math.min(1, this.spawnT / 0.6);
      this.group.scale.set(1, k * k * (3 - 2 * k), 1);
      return;
    }
    this.group.scale.setScalar(1);

    const pos = this.group.position;
    const dx = ctx.playerHead.x - pos.x;
    const dz = ctx.playerHead.z - pos.z;
    const dist = Math.hypot(dx, dz);

    // Turn to face the player.
    const targetYaw = Math.atan2(dx, dz);
    let dy = targetYaw - this.group.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.group.rotation.y += dy * Math.min(1, gdt * 6);

    let moving = false;
    if (this.kind === 'gunner') {
      const los = ctx.world.lineOfSight(this.headPos(_v), ctx.playerHead);
      if (dist > this.preferred || !los) {
        moving = this.walk(gdt, dx / dist, dz / dist, 1.3, ctx);
        this.aimT = 0;
      } else {
        this.aimT += gdt;
        this.cooldown -= gdt;
        if (this.aimT > 0.7 && this.cooldown <= 0 && this.gun) {
          this.cooldown = 2.0 + Math.random() * 1.4;
          const from = this.gun.muzzleWorld(new THREE.Vector3());
          const target = _w.copy(ctx.playerHead);
          target.y -= Math.random() * 0.35;
          target.x += (Math.random() - 0.5) * 0.25;
          target.z += (Math.random() - 0.5) * 0.25;
          ctx.shoot(from, target.sub(from).normalize());
          this.gun.kick = 1;
        }
      }
      if (this.aimT > 0) {
        const pitch = Math.atan2(ctx.playerHead.y - 0.1 - SHOULDER_Y, Math.max(0.5, dist));
        this.armR.rotation.x = THREE.MathUtils.lerp(this.armR.rotation.x, -Math.PI / 2 - pitch, Math.min(1, gdt * 8));
      }
    } else {
      if (dist > 0.75) {
        moving = this.walk(gdt, dx / dist, dz / dist, 2.4, ctx);
        this.windup = Math.max(0, this.windup - gdt);
      } else {
        this.windup += gdt;
        if (this.windup > 0.45) ctx.strike(this);
      }
      const reach = dist < 2.5 ? -Math.PI / 2 : 0;
      this.armL.rotation.x = THREE.MathUtils.lerp(this.armL.rotation.x, reach, Math.min(1, gdt * 5));
      this.armR.rotation.x = THREE.MathUtils.lerp(this.armR.rotation.x, reach - this.windup * 1.5, Math.min(1, gdt * 5));
    }

    if (moving) {
      this.phase += gdt * (this.kind === 'brawler' ? 11 : 7);
      const s = Math.sin(this.phase);
      this.legL.rotation.x = s * 0.7;
      this.legR.rotation.x = -s * 0.7;
      if (this.kind === 'gunner' && this.aimT === 0) {
        this.armL.rotation.x = -s * 0.5;
        this.armR.rotation.x = s * 0.5;
      }
    } else {
      this.legL.rotation.x *= 0.9;
      this.legR.rotation.x *= 0.9;
    }
    if (this.gun) this.gun.animate(gdt * 3);
    this.updateSpheres();
  }

  private walk(gdt: number, nx: number, nz: number, speed: number, ctx: EnemyContext): boolean {
    const step = speed * gdt;
    let ang = Math.atan2(nx, nz);
    if (this.steerT > 0) {
      this.steerT -= gdt;
      ang += this.steerSign * 1.3;
    }
    let mx = Math.sin(ang) * step;
    let mz = Math.cos(ang) * step;

    // Keep a little space from other enemies.
    for (const o of ctx.others) {
      if (o === this || !o.alive) continue;
      const ox = this.position.x - o.position.x;
      const oz = this.position.z - o.position.z;
      const d = Math.hypot(ox, oz);
      if (d > 0.001 && d < 0.8) {
        mx += (ox / d) * (0.8 - d) * 0.5;
        mz += (oz / d) * (0.8 - d) * 0.5;
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
