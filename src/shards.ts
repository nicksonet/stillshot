import * as THREE from 'three';

const CAPACITY = 700;

interface Shard {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  axis: THREE.Vector3;
  spin: number;
  angle: number;
  size: number;
  life: number;
  maxLife: number;
  color: THREE.Color;
}

const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();

/** Crystal fragments for shattering enemies and bullet sparks. Moves in game time. */
export class Shards {
  readonly mesh: THREE.InstancedMesh;
  private shards: Shard[] = [];

  constructor(scene: THREE.Scene) {
    const geo = new THREE.TetrahedronGeometry(1, 0);
    const mat = new THREE.MeshPhongMaterial({ color: 0xffffff, flatShading: true, shininess: 60 });
    this.mesh = new THREE.InstancedMesh(geo, mat, CAPACITY);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, new THREE.Color());
    scene.add(this.mesh);
  }

  get count(): number {
    return this.shards.length;
  }

  burst(center: THREE.Vector3, count: number, color: number, speed: number, size: number, spread: number, push?: THREE.Vector3): void {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      if (this.shards.length >= CAPACITY) this.shards.shift();
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize();
      const pos = center.clone().addScaledVector(dir, Math.random() * spread);
      const vel = dir.multiplyScalar(speed * (0.3 + Math.random()));
      if (push) vel.addScaledVector(push, 0.5 + Math.random() * 0.5);
      const life = 1.2 + Math.random() * 1.2;
      this.shards.push({
        pos,
        vel,
        axis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
        spin: (Math.random() - 0.5) * 20,
        angle: Math.random() * 6,
        size: size * (0.4 + Math.random() * 0.8),
        life,
        maxLife: life,
        color: c.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.15),
      });
    }
  }

  clear(): void {
    this.shards = [];
    this.mesh.count = 0;
  }

  update(gdt: number): void {
    const list = this.shards;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      s.life -= gdt;
      if (s.life <= 0) continue;
      s.vel.y -= 9.8 * gdt;
      s.pos.addScaledVector(s.vel, gdt);
      if (s.pos.y < s.size * 0.5) {
        s.pos.y = s.size * 0.5;
        s.vel.y *= -0.3;
        s.vel.x *= 0.6;
        s.vel.z *= 0.6;
        s.spin *= 0.6;
      }
      s.angle += s.spin * gdt;
      list[w++] = s;
    }
    list.length = w;

    for (let i = 0; i < w; i++) {
      const s = list[i];
      const k = Math.min(1, s.life / (s.maxLife * 0.4));
      _q.setFromAxisAngle(s.axis, s.angle);
      _s.setScalar(s.size * k);
      _m.compose(s.pos, _q, _s);
      this.mesh.setMatrixAt(i, _m);
      this.mesh.setColorAt(i, s.color);
    }
    this.mesh.count = w;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
