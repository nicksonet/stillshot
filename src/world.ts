import * as THREE from 'three';
import { circleHitsBox, segmentBox } from './collide';
import type { LevelDef } from './levels';
import { Builder, buildProp, kitFor } from './props';
import { NEON, THEMES, floorTexture, halo, signTexture, windowTexture } from './theme';

const BILLBOARDS: [string, number][] = [
  ['NEON DREAMS', NEON.magenta],
  ['KAIROS BANK', NEON.cyan],
  ['SYNTHWAVE', NEON.violet],
  ['ZERO HOUR', NEON.amber],
  ['HYPERION', NEON.green],
];

/** Static level geometry, lighting and collision queries. */
export class World {
  readonly group = new THREE.Group();
  boxes: THREE.Box3[] = [];
  bounds: [number, number, number, number] = [-18, -18, 18, 18];
  private levelGroup = new THREE.Group();
  private skyline = new THREE.Group();
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private floor: THREE.Mesh;

  constructor(private scene: THREE.Scene) {
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x222244, 1.5);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.0);
    this.sun.position.set(4, 8, 3);
    this.group.add(this.hemi, this.sun);

    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial());
    this.floor.rotation.x = -Math.PI / 2;
    this.group.add(this.floor);

    this.buildSkyline();
    this.group.add(this.skyline, this.levelGroup);
    scene.add(this.group);
  }

  private buildSkyline(): void {
    const tex = windowTexture();
    const mat = new THREE.MeshBasicMaterial({ map: tex, fog: false });
    const count = 46;
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.08;
      const r = 34 + Math.random() * 16;
      const h = 12 + Math.random() * 38;
      const w = 4 + Math.random() * 6;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
      m.compose(new THREE.Vector3(Math.cos(a) * r, h / 2 - 6, Math.sin(a) * r), q, new THREE.Vector3(w, h, w));
      inst.setMatrixAt(i, m);
    }
    this.skyline.add(inst);

    BILLBOARDS.forEach(([text, color], i) => {
      const { tex: t, aspect } = signTexture(text, '#' + color.toString(16).padStart(6, '0'));
      const a = (i / BILLBOARDS.length) * Math.PI * 2 + 0.4;
      const r = 31;
      const h = 2.2;
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(h * aspect, h),
        new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, fog: false }),
      );
      sign.position.set(Math.cos(a) * r, 9 + (i % 3) * 4, Math.sin(a) * r);
      sign.lookAt(0, sign.position.y, 0);
      const g = halo(color, h * aspect * 1.5, h * 4, 0.35);
      g.position.copy(sign.position);
      g.quaternion.copy(sign.quaternion);
      g.translateZ(-0.05);
      this.skyline.add(g, sign);
    });
  }

  load(level: LevelDef): void {
    const theme = THEMES[level.theme];
    this.scene.background = new THREE.Color(theme.background);
    this.scene.fog = new THREE.Fog(theme.background, theme.fogNear, theme.fogFar);
    this.hemi.color.set(theme.hemiSky);
    this.hemi.groundColor.set(theme.hemiGround);
    this.hemi.intensity = theme.hemiIntensity;
    this.sun.color.set(theme.sunColor);
    this.sun.intensity = theme.sunIntensity;
    this.skyline.visible = theme.skyline;

    this.bounds = level.bounds;
    const [x0, z0, x1, z1] = level.bounds;
    const size = Math.max(x1 - x0, z1 - z0) + 4;
    const fm = this.floor.material as THREE.MeshLambertMaterial;
    fm.map?.dispose();
    fm.map = floorTexture(theme, Math.round(size / 1.2));
    fm.needsUpdate = true;
    this.floor.scale.set(size, size, 1);
    this.floor.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);

    this.levelGroup.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.levelGroup.clear();
    const b = new Builder();
    const kit = kitFor(theme.style);
    for (const p of level.props) buildProp(b, p, kit);
    this.levelGroup.add(b.build());
    this.boxes = b.boxes;
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
    const [x0, z0, x1, z1] = this.bounds;
    if (x < x0 + r || x > x1 - r || z < z0 + r || z > z1 - r) return true;
    for (const b of this.boxes) if (circleHitsBox(x, z, r, b)) return true;
    return false;
  }

  /** Move a circle by (dx, dz), sliding along obstacles. Mutates pos; returns distance moved. */
  moveCircle(pos: THREE.Vector3, dx: number, dz: number, r: number): number {
    const x0 = pos.x;
    const z0 = pos.z;
    if (this.blocked(pos.x, pos.z, r)) {
      // Already overlapping (e.g. seated between chair and table): let it walk out.
      pos.x += dx;
      pos.z += dz;
      return Math.hypot(dx, dz);
    }
    if (!this.blocked(pos.x + dx, pos.z, r)) pos.x += dx;
    if (!this.blocked(pos.x, pos.z + dz, r)) pos.z += dz;
    return Math.hypot(pos.x - x0, pos.z - z0);
  }
}
