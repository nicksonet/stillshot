import * as THREE from 'three';

export const MAX_AMMO = 6;

const gunMat = new THREE.MeshPhongMaterial({ color: 0x1b1d20, flatShading: true, shininess: 30 });
const pipOn = new THREE.MeshBasicMaterial({ color: 0xff3b2e });
const pipOff = new THREE.MeshBasicMaterial({ color: 0x3a3d42 });
const slideGeo = new THREE.BoxGeometry(0.034, 0.042, 0.2);
const barrelGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.03, 8).rotateX(Math.PI / 2);
const gripGeo = new THREE.BoxGeometry(0.03, 0.1, 0.045);
const guardGeo = new THREE.BoxGeometry(0.012, 0.03, 0.05);
const pipGeo = new THREE.BoxGeometry(0.008, 0.006, 0.014);

/** A pistol. Barrel points along local -Z, grip hangs down (-Y). */
export class Gun {
  readonly mesh = new THREE.Group();
  readonly muzzle = new THREE.Object3D();
  ammo: number;
  held = false;
  vel = new THREE.Vector3();
  spin = new THREE.Vector3();
  /** True while flying after a throw; a thrown gun kills whoever it hits. */
  thrown = false;
  resting = false;
  kick = 0;
  private pips: THREE.Mesh[] = [];
  private body = new THREE.Group();

  constructor(ammo = MAX_AMMO) {
    this.ammo = ammo;
    const slide = new THREE.Mesh(slideGeo, gunMat);
    slide.position.set(0, 0.02, -0.03);
    const barrel = new THREE.Mesh(barrelGeo, gunMat);
    barrel.position.set(0, 0.022, -0.14);
    const grip = new THREE.Mesh(gripGeo, gunMat);
    grip.position.set(0, -0.045, 0.045);
    grip.rotation.x = -0.25;
    const guard = new THREE.Mesh(guardGeo, gunMat);
    guard.position.set(0, -0.012, 0.0);
    this.body.add(slide, barrel, grip, guard);
    for (let i = 0; i < MAX_AMMO; i++) {
      const p = new THREE.Mesh(pipGeo, pipOff);
      p.position.set(0, 0.044, 0.05 - i * 0.02);
      this.pips.push(p);
      this.body.add(p);
    }
    this.muzzle.position.set(0, 0.022, -0.16);
    this.body.add(this.muzzle);
    this.mesh.add(this.body);
    this.updatePips();
  }

  updatePips(): void {
    this.pips.forEach((p, i) => (p.material = i < this.ammo ? pipOn : pipOff));
  }

  fire(): boolean {
    if (this.ammo <= 0) return false;
    this.ammo--;
    this.kick = 1;
    this.updatePips();
    return true;
  }

  /** Recoil animation in real time. */
  animate(realDt: number): void {
    this.kick = Math.max(0, this.kick - realDt * 8);
    this.body.rotation.x = this.kick * 0.35;
    this.body.position.z = this.kick * 0.03;
  }

  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.muzzle.getWorldPosition(out);
  }

  forwardWorld(out: THREE.Vector3): THREE.Vector3 {
    const q = new THREE.Quaternion();
    this.mesh.getWorldQuaternion(q);
    return out.set(0, 0, -1).applyQuaternion(q);
  }
}
