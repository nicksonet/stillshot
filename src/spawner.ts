import * as THREE from 'three';
import { Enemy } from './enemy';
import type { Game } from './game';
import type { EnemyKind } from './levels';

const _v = new THREE.Vector3();

/** Brings a level's waves in: scripted entrances first, then free spawn points; hostage-takers grab a diner. */
export class Spawner {
  queue: EnemyKind[] = [];
  /** Debug: keep the level running with no waves left (scripted tests). */
  holdOpen = false;
  private timer = 0;
  private introIndex = 0;

  constructor(private g: Game) {}

  reset(waves: EnemyKind[]): void {
    this.queue = [...waves];
    this.timer = 0.8;
    this.introIndex = 0;
    this.holdOpen = false;
  }

  /** No waves left and nobody standing. */
  get done(): boolean {
    return !this.holdOpen && this.queue.length === 0 && this.g.enemies.every((e) => !e.alive);
  }

  update(gdt: number): void {
    this.timer -= gdt;
    const alive = this.g.enemies.filter((e) => e.alive).length;
    if (!this.queue.length || alive >= this.g.level.maxAlive || this.timer > 0) return;
    const kind = this.queue[0];
    const enemy = kind === 'hostage' ? this.spawnHostageTaker() : this.spawnAtPoint(kind);
    if (!enemy) return;
    this.queue.shift();
    this.timer = 1.5;
  }

  private spawnAtPoint(kind: EnemyKind): Enemy | null {
    const g = this.g;
    const level = g.level;
    const candidates = level.spawns.filter(([x, z]) => {
      if (Math.hypot(x - g.headPos.x, z - g.headPos.z) < 5) return false;
      if (g.world.blocked(x, z, 0.4)) return false;
      return !g.enemies.some((e) => e.alive && Math.hypot(e.position.x - x, e.position.z - z) < 1);
    });
    if (!candidates.length) return null;
    // Scripted entrances first (e.g. through the kitchen), then random spawn points.
    const intro = level.introSpawns?.[this.introIndex];
    const scripted = intro && candidates.find(([x, z]) => x === intro[0] && z === intro[1]);
    if (intro) this.introIndex++;
    const [x, z] = scripted ?? candidates[Math.floor(Math.random() * candidates.length)];
    return this.add(kind, x, z);
  }

  /** Materialise right behind a diner and take them hostage. */
  spawnHostageTaker(): Enemy | null {
    const g = this.g;
    const options = g.civilians.filter((c) => c.free && c.state !== 'flee' && Math.hypot(c.position.x - g.headPos.x, c.position.z - g.headPos.z) > 3);
    for (const c of options.sort(() => Math.random() - 0.5)) {
      const away = _v.set(c.position.x - g.headPos.x, 0, c.position.z - g.headPos.z).normalize();
      const x = c.position.x + away.x * 0.42;
      const z = c.position.z + away.z * 0.42;
      if (g.world.blocked(x, z, 0.3)) continue;
      const e = this.add('hostage', x, z);
      e.grab(c);
      return e;
    }
    return this.spawnAtPoint('hostage');
  }

  add(kind: EnemyKind, x: number, z: number): Enemy {
    const g = this.g;
    const e = new Enemy(kind, x, z);
    e.group.rotation.y = Math.atan2(g.headPos.x - x, g.headPos.z - z);
    g.enemies.push(e);
    g.scene.add(e.group);
    return e;
  }
}
