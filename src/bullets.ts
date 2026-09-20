import * as THREE from 'three';

export type Owner = 'player' | 'enemy';

export interface Bullet {
  owner: Owner;
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  travelled: number;
  mesh: THREE.Group;
  trail: THREE.Mesh;
  dead: boolean;
  /** Something this bullet passes through (the shooter's own hostage). */
  ignore?: object;
}

const TRAIL_MAX = 2.2;
const MAX_RANGE = 70;

const headGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.07, 6).rotateX(Math.PI / 2);
// Trail spans z = 0..1 behind the bullet (bullets fly along local -Z).
const trailGeo = new THREE.CylinderGeometry(0.003, 0.014, 1, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
// Bullets read as black ink against the clay room, so the trail is drawn dark instead of glowing.
const headMat = new THREE.MeshBasicMaterial({ color: 0x0b0b0c, fog: false });
const trail = (color: number, opacity: number) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, fog: false });
const enemyTrailMat = trail(0x14110f, 0.75);
const playerTrailMat = trail(0x1b1a18, 0.55);
const FORWARD = new THREE.Vector3(0, 0, -1);

export class Bullets {
  list: Bullet[] = [];
  private group = new THREE.Group();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  spawn(owner: Owner, pos: THREE.Vector3, dir: THREE.Vector3, speed: number): Bullet {
    const mesh = new THREE.Group();
    const head = new THREE.Mesh(headGeo, headMat);
    const trail = new THREE.Mesh(trailGeo, owner === 'enemy' ? enemyTrailMat : playerTrailMat);
    trail.scale.z = 0.001;
    mesh.add(head, trail);
    mesh.position.copy(pos);
    mesh.quaternion.setFromUnitVectors(FORWARD, dir);
    this.group.add(mesh);
    const b: Bullet = {
      owner,
      pos: pos.clone(),
      prev: pos.clone(),
      dir: dir.clone().normalize(),
      speed,
      travelled: 0,
      mesh,
      trail,
      dead: false,
    };
    this.list.push(b);
    return b;
  }

  /** Advance every bullet; collision is resolved by the caller between prev and pos. */
  advance(gdt: number): void {
    for (const b of this.list) {
      b.prev.copy(b.pos);
      const step = b.speed * gdt;
      b.pos.addScaledVector(b.dir, step);
      b.travelled += step;
      if (b.travelled > MAX_RANGE) b.dead = true;
    }
  }

  /** Sync meshes and drop dead bullets. */
  sync(): void {
    let w = 0;
    for (const b of this.list) {
      if (b.dead) {
        this.group.remove(b.mesh);
        continue;
      }
      b.mesh.position.copy(b.pos);
      b.trail.scale.z = Math.max(0.001, Math.min(TRAIL_MAX, b.travelled));
      this.list[w++] = b;
    }
    this.list.length = w;
  }

  clear(): void {
    for (const b of this.list) this.group.remove(b.mesh);
    this.list = [];
  }
}
