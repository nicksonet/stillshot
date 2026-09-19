import * as THREE from 'three';
import type { Figure } from './figure';

const MAX = 48;

function blobTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.42)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.2)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _h = new THREE.Vector3();

/** Soft contact shadows under people (one draw call for everyone). */
export class BlobShadows {
  private mesh: THREE.InstancedMesh;

  constructor(scene: THREE.Scene, color = 0x2a2018) {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color,
      map: blobTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  setColor(color: number): void {
    (this.mesh.material as THREE.MeshBasicMaterial).color.set(color);
  }

  /** Standing people get a round shadow; someone lying down gets one stretched along the body. */
  update(figures: { fig: Figure; lying?: boolean }[]): void {
    let n = 0;
    for (const { fig, lying } of figures) {
      if (n >= MAX) break;
      fig.pelvisMark.getWorldPosition(_p);
      _p.y = 0.012;
      if (lying) {
        // Centred between feet and head, stretched along the body.
        fig.headMark.getWorldPosition(_h);
        _p.set((_h.x + fig.root.position.x) / 2, 0.012, (_h.z + fig.root.position.z) / 2);
        _e.set(0, fig.root.rotation.y, 0);
        _s.set(0.75, 1, 2.0);
      } else {
        _e.set(0, 0, 0);
        _s.set(0.85, 1, 0.85);
      }
      _q.setFromEuler(_e);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(n++, _m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
