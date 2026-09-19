import * as THREE from 'three';
import { sfx } from '../audio';
import { segmentSphere } from '../collide';
import type { Enemy, HitSphere } from '../enemy';
import type { Game } from '../game';
import { Weapon } from '../weapons';

const _v1 = new THREE.Vector3();

/** Mouse and keyboard: pointer-locked look, WASD, hold-to-fire, throw, grab, punch. */
export class DesktopInput {
  gun: Weapon | null = null;
  yaw = 0;
  pitch = 0;
  /** Left mouse button held (full-auto). */
  firing = false;
  private lookAccum = 0;
  private keys = new Set<string>();
  private pointerLocked = false;

  constructor(private g: Game) {
    const canvas = g.renderer.domElement;
    document.getElementById('play-desktop')?.addEventListener('click', () => g.startDesktop(true));
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      if (this.pointerLocked && !locked && g.mode === 'desktop') {
        g.pause();
        this.firing = false;
      }
      this.pointerLocked = locked;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked || g.mode !== 'desktop') return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0022, -1.45, 1.45);
      this.lookAccum += Math.hypot(e.movementX, e.movementY) * 0.0022;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (g.mode !== 'desktop' || g.paused) return;
      if (!this.pointerLocked) void canvas.requestPointerLock?.()?.catch?.(() => {});
      if (e.button === 0) {
        this.firing = true;
        this.primary();
      }
      if (e.button === 2) this.throwGun();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (g.mode !== 'desktop' || g.paused) return;
      if (e.code === 'KeyE') this.take();
      if (e.code === 'KeyF') this.punch();
      if (e.code === 'KeyR') g.startLevel(g.state === 'won' ? 0 : Math.max(0, g.levelIndex));
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  lockPointer(): void {
    try {
      void this.g.renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
    } catch {
      /* pointer lock is optional */
    }
  }

  /** Face straight ahead (level start). */
  resetView(): void {
    this.yaw = 0;
    this.pitch = 0;
    this.firing = false;
  }

  applyView(): void {
    this.g.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  hold(w: Weapon): void {
    this.gun = w;
    this.g.camera.add(w.mesh);
    w.prepareHeld();
    w.mesh.position.set(0.2, -0.19, w.kind === 'smg' ? -0.36 : -0.4);
  }

  removeGun(): void {
    this.gun?.mesh.removeFromParent();
    this.gun = null;
  }

  /** WASD and look; returns a motion measure that drives the time scale. */
  update(realDt: number): number {
    const g = this.g;
    this.applyView();
    const f = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const r = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    let moved = 0;
    if ((f || r) && (g.state === 'playing' || g.state === 'menu')) {
      const len = Math.hypot(f, r);
      const sx = -Math.sin(this.yaw);
      const sz = -Math.cos(this.yaw);
      const dx = ((sx * f + Math.cos(this.yaw) * r) / len) * 3.2 * realDt;
      const dz = ((sz * f - Math.sin(this.yaw) * r) / len) * 3.2 * realDt;
      moved = g.world.moveCircle(g.rig.position, dx, dz, 0.3);
    }
    const look = this.lookAccum / realDt;
    this.lookAccum = 0;
    this.gun?.animate(realDt);
    if (this.firing && this.gun?.spec.auto) {
      const gun = this.gun;
      g.combat.autoFire(gun, () => this.aim(gun).dir, undefined, () => this.aim(gun).from);
    }
    if (!this.gun && g.state === 'playing') this.pickup(1.0);
    return moved / realDt + Math.min(look * 0.05, 0.25);
  }

  /** Bullet origin and direction for the crosshair. */
  private aim(gun: Weapon): { from: THREE.Vector3; dir: THREE.Vector3 } {
    const g = this.g;
    this.applyView();
    g.camera.updateMatrixWorld(true);
    let from = gun.muzzleWorld(new THREE.Vector3());
    const target = this.aimPoint();
    // The muzzle sits off-centre; if it can't see what the crosshair sees, shoot along the view ray.
    const wall = g.world.segmentHit(from, target);
    if (wall >= 0 && wall < 0.98) from = g.headPos.clone().addScaledVector(g.headFwd, 0.3);
    return { from, dir: target.sub(from).normalize() };
  }

  /** Where the crosshair points: first thing hit along the view ray. */
  private aimPoint(): THREE.Vector3 {
    const g = this.g;
    const origin = g.headPos.clone();
    const far = origin.clone().addScaledVector(g.headFwd, 60);
    let best = g.world.segmentHit(origin, far);
    if (best < 0) best = 1;
    const test = (spheres: HitSphere[]) => {
      for (const s of spheres) {
        const t = segmentSphere(origin, far, s.c, s.r);
        if (t >= 0 && t < best) best = t;
      }
    };
    for (const e of g.enemies) if (e.alive) test(e.spheres);
    for (const c of g.civilians) if (c.alive && !c.gone) test(c.spheres);
    if (g.menuTarget.visible) test([{ c: g.menuTarget.position, r: 0.25 }]);
    return origin.lerp(far, best);
  }

  /** Left click: fire, or punch bare-handed, or restart after the end. */
  primary(): void {
    if (this.g.restartIfOver()) return;
    if (!this.gun) return this.punch();
    const { from, dir } = this.aim(this.gun);
    this.g.combat.fire(this.gun, dir, undefined, from);
  }

  throwGun(): void {
    if (!this.gun) return;
    const w = this.gun;
    this.gun = null;
    const v = this.g.headFwd.clone().multiplyScalar(14);
    v.y += 1.2;
    this.g.combat.release(w, v, true);
    sfx.throwGun();
  }

  /** E: snatch the weapon of an enemy in reach, else pick one up from the floor. */
  take(): void {
    const e = this.enemyInReach(1.8);
    if (e?.weapon) {
      const w = this.g.combat.disarm(e);
      if (w) {
        if (this.gun) {
          const old = this.gun;
          this.gun = null;
          this.g.combat.release(old, new THREE.Vector3(0, 1, 0), false);
        }
        this.hold(w);
      }
      return;
    }
    this.pickup(2.2);
  }

  private pickup(radius: number): void {
    if (this.gun) return;
    const g = this.g;
    let best: Weapon | null = null;
    let bestD = radius;
    for (const w of g.combat.freeGuns) {
      const d = Math.hypot(w.mesh.position.x - g.headPos.x, w.mesh.position.z - g.headPos.z);
      if (d < bestD && !w.thrown) {
        best = w;
        bestD = d;
      }
    }
    if (best) {
      g.combat.takeFree(best);
      this.hold(best);
      sfx.pickup();
    }
  }

  punch(): void {
    const g = this.g;
    if (g.state === 'menu' && g.headPos.distanceTo(g.menuTarget.position) < 2) {
      g.hitMenuTarget(g.headFwd);
      return;
    }
    const e = this.enemyInReach(1.9);
    if (e) g.combat.punch(e, g.headFwd.clone());
  }

  private enemyInReach(range: number): Enemy | null {
    const g = this.g;
    for (const e of g.enemies) {
      if (!e.alive || !e.materialized) continue;
      const to = _v1.subVectors(e.spheres[1].c, g.headPos);
      if (to.length() < range && to.normalize().dot(g.headFwd) > 0.5) return e;
    }
    return null;
  }

  /** Turn the view to look at a point (tests / demo bot). */
  lookAt(p: THREE.Vector3): void {
    const d = p.clone().sub(this.g.headPos);
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    this.applyView();
    this.g.camera.updateMatrixWorld(true);
  }

  /** Give a fresh revolver if empty-handed (tests). */
  ensureGun(): void {
    if (!this.gun) this.hold(new Weapon('revolver'));
  }
}
