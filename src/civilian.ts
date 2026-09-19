import * as THREE from 'three';
import type { HitSphere } from './enemy';
import { Person, type PersonModel, type Pose } from './person';
import type { World } from './world';

export type CivState = 'seated' | 'standing' | 'cower' | 'flee' | 'held' | 'prone' | 'kneel';
export type CivRole = 'diner' | 'vip' | 'guard';

/** Diners cycle through the generated diner models; the boss and his guards have their own looks. */
let dinerCount = 0;
const dinerModels: PersonModel[] = ['diner-man', 'diner-woman'];

const POSE: Record<CivState, Pose> = {
  seated: 'seated',
  standing: 'stand',
  cower: 'cower',
  flee: 'stand',
  held: 'held',
  prone: 'prone',
  kneel: 'kneel',
};

export class Civilian {
  readonly body: Person;
  readonly vip: boolean;
  /** One of the boss's own bodyguards: stays over him instead of panicking. */
  readonly guard: boolean;
  state: CivState;
  alive = true;
  /** Set once the civilian leaves through an exit. */
  gone = false;
  /** The enemy holding this civilian, if any. */
  heldBy: object | null = null;
  readonly spheres: HitSphere[] = [
    { c: new THREE.Vector3(), r: 0.15 },
    { c: new THREE.Vector3(), r: 0.24 },
    { c: new THREE.Vector3(), r: 0.2 },
  ];
  private exit: THREE.Vector3 | null = null;
  /** Seconds (game time) until this person reacts to gunfire; null until shots are fired. */
  private panicT: number | null = null;
  private panicExits: THREE.Vector3[] = [];
  private steerT = 0;
  private steerSign = Math.random() < 0.5 ? -1 : 1;

  constructor(x: number, z: number, rotY: number, state: CivState, role: CivRole = 'diner') {
    this.vip = role === 'vip';
    this.guard = role === 'guard';
    const model: PersonModel = this.vip ? 'boss' : this.guard ? 'diner-man' : dinerModels[dinerCount++ % dinerModels.length];
    this.body = new Person(model);
    this.body.root.rotation.order = 'YXZ';
    this.body.root.position.set(x, 0, z);
    this.body.root.rotation.y = rotY;
    this.state = state;
    this.applyPose();
    this.body.update(Math.random() * 2); // desynchronise idle clips
    this.updateSpheres();
  }

  get position(): THREE.Vector3 {
    return this.body.root.position;
  }

  get free(): boolean {
    return this.alive && !this.gone && !this.vip && !this.guard && this.state !== 'held';
  }

  setState(s: CivState): void {
    this.state = s;
    this.applyPose();
  }

  private applyPose(): void {
    const root = this.body.root;
    this.body.pose = POSE[this.state];
    // Lying down: tip the whole body onto its back.
    root.rotation.x = this.state === 'prone' ? -Math.PI / 2 : 0;
    root.position.y = this.state === 'prone' ? 0.13 : 0;
    this.body.play(this.state === 'flee' ? 'run' : 'idle');
  }

  /** Gunfire starts: after a moment of shock, diners either duck or run for the nearest exit. */
  panic(exits: THREE.Vector3[]): void {
    if (!this.alive || this.vip || this.guard || this.state === 'held' || this.state === 'flee' || this.panicT !== null) return;
    this.panicExits = exits;
    this.panicT = 0.25 + Math.random() * 0.5;
  }

  private react(): void {
    if (this.state !== 'seated' && this.state !== 'standing') return;
    if (this.panicExits.length && Math.random() < 0.5) this.flee(this.panicExits);
    else this.setState('cower');
  }

  flee(exits: THREE.Vector3[]): void {
    if (!exits.length) return this.setState('cower');
    let best = exits[0];
    for (const e of exits) if (e.distanceTo(this.position) < best.distanceTo(this.position)) best = e;
    this.exit = best;
    this.setState('flee');
  }

  update(gdt: number, world: World): void {
    if (!this.alive || this.gone) return;
    if (this.panicT !== null && this.panicT > 0) {
      this.panicT -= gdt;
      if (this.panicT <= 0) this.react();
    }
    if (this.state === 'flee' && this.exit) {
      const dx = this.exit.x - this.position.x;
      const dz = this.exit.z - this.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.6) {
        this.gone = true;
        return;
      }
      let ang = Math.atan2(dx, dz);
      if (this.steerT > 0) {
        this.steerT -= gdt;
        ang += this.steerSign * 1.2;
      }
      const step = 1.9 * gdt;
      const moved = world.moveCircle(this.position, Math.sin(ang) * step, Math.cos(ang) * step, 0.16);
      if (step > 0.0005 && moved < step * 0.3) {
        if (this.steerT > 0) this.steerSign *= -1;
        this.steerT = 0.8;
      }
      this.body.root.rotation.y = ang;
    }
    this.body.update(gdt);
    this.updateSpheres();
  }

  updateSpheres(): void {
    this.body.headPos(this.spheres[0].c);
    this.body.chestPos(this.spheres[1].c);
    this.body.pelvisPos(this.spheres[2].c);
  }
}
