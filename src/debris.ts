import * as THREE from 'three';

interface Chunk {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

const _p = new THREE.Vector3();

/** Body parts of a shattered person tumbling away. Moves in game time. */
export class Debris {
  private list: Chunk[] = [];

  constructor(private scene: THREE.Scene) {}

  get count(): number {
    return this.list.length;
  }

  /** Send the parts flying from `center`; parts closest to the hit point fly hardest. */
  explode(parts: THREE.Object3D[], center: THREE.Vector3, push: THREE.Vector3, hit: THREE.Vector3): void {
    for (const obj of parts) {
      obj.getWorldPosition(_p);
      const out = _p.clone().sub(center).setY(0);
      if (out.lengthSq() < 1e-4) out.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      out.normalize();
      const near = 1 / (0.35 + _p.distanceTo(hit));
      const vel = push
        .clone()
        .multiplyScalar(1.2 + near * 1.6)
        .addScaledVector(out, 0.6 + Math.random() * 1.2)
        .add(new THREE.Vector3(0, 0.8 + Math.random() * 1.6, 0));
      const spin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(4 + near * 6);
      this.list.push({ obj, vel, spin, life: 2.5 + Math.random() });
    }
  }

  update(gdt: number): void {
    let w = 0;
    for (const c of this.list) {
      c.life -= gdt;
      if (c.life <= 0) {
        this.scene.remove(c.obj);
        continue;
      }
      c.vel.y -= 9.8 * gdt;
      c.obj.position.addScaledVector(c.vel, gdt);
      c.obj.rotation.x += c.spin.x * gdt;
      c.obj.rotation.y += c.spin.y * gdt;
      c.obj.rotation.z += c.spin.z * gdt;
      if (c.obj.position.y < 0.08) {
        c.obj.position.y = 0.08;
        c.vel.y *= -0.3;
        c.vel.x *= 0.6;
        c.vel.z *= 0.6;
        c.spin.multiplyScalar(0.6);
      }
      if (c.life < 0.5) c.obj.scale.setScalar(Math.max(0.01, c.life / 0.5));
      this.list[w++] = c;
    }
    this.list.length = w;
  }

  clear(): void {
    for (const c of this.list) this.scene.remove(c.obj);
    this.list = [];
  }
}
