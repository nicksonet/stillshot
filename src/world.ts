import * as THREE from 'three';
import { circleHitsBox, segmentBox } from './collide';
import type { LevelDef } from './levels';

export const ARENA_HALF = 18;

const obstacleMat = new THREE.MeshPhongMaterial({ color: 0xf4f5f7, flatShading: true, shininess: 5 });
const edgeMat = new THREE.LineBasicMaterial({ color: 0xa9b0ba });
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitEdges = new THREE.EdgesGeometry(unitBox);

function makeFloorTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#eceef1';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#c9ced6';
  g.lineWidth = 3;
  g.strokeRect(0, 0, 256, 256);
  g.strokeStyle = '#dde1e6';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(128, 0);
  g.lineTo(128, 256);
  g.moveTo(0, 128);
  g.lineTo(256, 128);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(ARENA_HALF, ARENA_HALF);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Static level geometry plus collision queries against it. */
export class World {
  readonly group = new THREE.Group();
  boxes: THREE.Box3[] = [];
  private levelGroup = new THREE.Group();

  constructor(scene: THREE.Scene) {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2),
      new THREE.MeshLambertMaterial({ map: makeFloorTexture() }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.group.add(floor);

    // Distant monoliths give the fog something to swallow and the eye a horizon.
    const ring = new THREE.Group();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const h = 6 + ((i * 7) % 5) * 2.5;
      const m = new THREE.Mesh(unitBox, obstacleMat);
      m.scale.set(3 + (i % 3), h, 3 + ((i + 1) % 3));
      m.position.set(Math.cos(a) * (ARENA_HALF + 6), h / 2, Math.sin(a) * (ARENA_HALF + 6));
      m.rotation.y = a;
      ring.add(m);
    }
    this.group.add(ring);
    this.group.add(this.levelGroup);
    scene.add(this.group);
  }

  load(level: LevelDef): void {
    this.levelGroup.clear();
    this.boxes = [];
    for (const [x, z, w, d, h] of level.obstacles) {
      const m = new THREE.Mesh(unitBox, obstacleMat);
      m.scale.set(w, h, d);
      m.position.set(x, h / 2, z);
      const e = new THREE.LineSegments(unitEdges, edgeMat);
      e.scale.copy(m.scale);
      e.position.copy(m.position);
      this.levelGroup.add(m, e);
      this.boxes.push(new THREE.Box3(new THREE.Vector3(x - w / 2, 0, z - d / 2), new THREE.Vector3(x + w / 2, h, z + d / 2)));
    }
  }

  /** First obstacle hit along the segment, as a fraction of it, or -1. Also hits the floor. */
  segmentHit(p0: THREE.Vector3, p1: THREE.Vector3): number {
    let best = -1;
    for (const b of this.boxes) {
      const t = segmentBox(p0, p1, b);
      if (t >= 0 && (best < 0 || t < best)) best = t;
    }
    if (p1.y < 0 && p0.y >= 0) {
      const t = p0.y / (p0.y - p1.y);
      if (best < 0 || t < best) best = t;
    }
    return best;
  }

  lineOfSight(a: THREE.Vector3, b: THREE.Vector3): boolean {
    for (const box of this.boxes) if (segmentBox(a, b, box) >= 0) return false;
    return true;
  }

  blocked(x: number, z: number, r: number): boolean {
    if (Math.abs(x) > ARENA_HALF - r || Math.abs(z) > ARENA_HALF - r) return true;
    for (const b of this.boxes) if (circleHitsBox(x, z, r, b)) return true;
    return false;
  }

  /** Move a circle by (dx, dz), sliding along obstacles. Mutates pos; returns distance moved. */
  moveCircle(pos: THREE.Vector3, dx: number, dz: number, r: number): number {
    const x0 = pos.x;
    const z0 = pos.z;
    if (!this.blocked(pos.x + dx, pos.z, r)) pos.x += dx;
    if (!this.blocked(pos.x, pos.z + dz, r)) pos.z += dz;
    return Math.hypot(pos.x - x0, pos.z - z0);
  }
}
