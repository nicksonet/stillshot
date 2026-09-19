import * as THREE from 'three';
import { sfx } from '../audio';
import type { HitSphere } from '../enemy';
import type { Game } from '../game';
import { Weapon } from '../weapons';

const PUNCH_SPEED = 1.6;

export interface Hand {
  controller: THREE.Group;
  handedness: XRHandedness | 'none';
  source: XRInputSource | null;
  held: Weapon | null;
  fist: THREE.Mesh;
  pos: THREE.Vector3;
  prevPos: THREE.Vector3;
  vel: THREE.Vector3;
  trigger: boolean;
  squeeze: boolean;
  punchCooldown: number;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();

/** Forward (-Z) of an object in world space. */
export function aimDir(obj: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
  return out.set(0, 0, -1).applyQuaternion(obj.getWorldQuaternion(_q1)).normalize();
}

/** Quest controllers: guns in hand, trigger/grip, punches, stick locomotion and snap turn. */
export class VRInput {
  readonly hands: Hand[] = [];
  private prevHead = new THREE.Vector3();
  private prevHeadQ = new THREE.Quaternion();
  private motionPrimed = false;
  private snapReady = true;

  constructor(private g: Game) {
    const fistGeo = new THREE.IcosahedronGeometry(0.045, 0);
    const fistMat = new THREE.MeshPhongMaterial({ color: 0x2a2d3a, emissive: 0x0a3a44, flatShading: true, shininess: 80 });
    for (let i = 0; i < 2; i++) {
      const controller = g.renderer.xr.getController(i);
      const fist = new THREE.Mesh(fistGeo, fistMat);
      fist.position.set(0, -0.02, 0.06);
      controller.add(fist);
      g.rig.add(controller);
      const hand: Hand = {
        controller,
        handedness: 'none',
        source: null,
        held: null,
        fist,
        pos: new THREE.Vector3(),
        prevPos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        trigger: false,
        squeeze: false,
        punchCooldown: 0,
      };
      controller.addEventListener('connected', (e) => {
        const src = (e as unknown as { data: XRInputSource }).data;
        hand.source = src;
        hand.handedness = src.handedness;
      });
      controller.addEventListener('disconnected', () => {
        hand.source = null;
        hand.handedness = 'none';
      });
      this.hands.push(hand);
    }
  }

  /** Forget the last head pose (teleports, snap turns, level resets) so time doesn't lurch. */
  resetMotion(): void {
    this.motionPrimed = false;
  }

  heldWeapons(): Weapon[] {
    return this.hands.map((h) => h.held).filter((w): w is Weapon => !!w);
  }

  /** Put the starting revolver in the right hand once controllers are connected. */
  giveStartGun(): boolean {
    const connected = this.hands.filter((h) => h.source);
    if (!connected.length) return false;
    const hand = connected.find((h) => h.handedness === 'right') ?? connected[0];
    if (!hand.held) this.hold(hand, new Weapon('revolver'));
    return true;
  }

  hold(hand: Hand, w: Weapon): void {
    hand.held = w;
    hand.controller.add(w.mesh);
    w.prepareHeld();
    w.mesh.position.set(0, -0.01, w.kind === 'smg' ? 0.06 : 0.03);
    hand.fist.visible = false;
  }

  /** Empty both hands (level reset). */
  clear(): void {
    for (const h of this.hands) {
      h.held?.mesh.removeFromParent();
      h.held = null;
      h.fist.visible = true;
    }
  }

  drop(hand: Hand, thrown: boolean): void {
    if (!hand.held) return;
    const w = hand.held;
    hand.held = null;
    hand.fist.visible = true;
    const v = hand.vel.clone().multiplyScalar(1.3);
    if (thrown && v.length() < 2) v.copy(aimDir(hand.controller, _v1)).multiplyScalar(5);
    this.g.combat.release(w, v, thrown);
    if (thrown) sfx.throwGun();
  }

  dropAll(): void {
    for (const h of this.hands) this.drop(h, false);
  }

  haptic(hand: Hand, intensity: number, ms: number): void {
    const act = hand.source?.gamepad?.hapticActuators?.[0] as unknown as { pulse?: (v: number, d: number) => void } | undefined;
    try {
      act?.pulse?.(intensity, ms);
    } catch {
      /* haptics are best-effort */
    }
  }

  hapticAll(intensity: number, ms: number): void {
    for (const h of this.hands) this.haptic(h, intensity, ms);
  }

  /** Read controllers; returns a motion measure (m/s-ish) that drives the time scale. */
  update(realDt: number): number {
    const g = this.g;
    const camQ = g.camera.getWorldQuaternion(_q1);
    let motion = 0;
    if (this.motionPrimed) {
      const headSpeed = g.headPos.distanceTo(this.prevHead) / realDt;
      const headAng = this.prevHeadQ.angleTo(camQ) / realDt;
      motion = headSpeed + headAng * 0.12;
    }

    for (const hand of this.hands) {
      hand.controller.getWorldPosition(hand.pos);
      if (this.motionPrimed && hand.source) {
        hand.vel.subVectors(hand.pos, hand.prevPos).divideScalar(realDt);
        motion += hand.vel.length() * 0.35;
      } else hand.vel.set(0, 0, 0);
      hand.prevPos.copy(hand.pos);
      hand.punchCooldown = Math.max(0, hand.punchCooldown - realDt);
      hand.held?.animate(realDt);

      const gp = hand.source?.gamepad;
      if (!gp) continue;
      const trig = (gp.buttons[0]?.value ?? 0) > 0.6;
      const sq = (gp.buttons[1]?.value ?? 0) > 0.6;
      if (trig && !hand.trigger) this.onTrigger(hand);
      else if (trig && hand.held?.spec.auto) {
        const w = hand.held;
        g.combat.autoFire(w, () => aimDir(w.mesh, _v1), (fw) => this.recoil(hand, fw));
      }
      if (sq && !hand.squeeze) this.onSqueeze(hand);
      hand.trigger = trig;
      hand.squeeze = sq;

      const ax = gp.axes[2] ?? 0;
      const ay = gp.axes[3] ?? 0;
      if (hand.handedness === 'left' && Math.hypot(ax, ay) > 0.2) motion += this.walk(ax, ay, realDt);
      if (hand.handedness === 'right') {
        if (Math.abs(ax) > 0.7 && this.snapReady) {
          this.snapTurn(-Math.sign(ax) * (Math.PI / 6));
          this.snapReady = false;
        } else if (Math.abs(ax) < 0.3) this.snapReady = true;
      }
    }

    this.prevHead.copy(g.headPos);
    this.prevHeadQ.copy(camQ);
    this.motionPrimed = true;

    if (g.state === 'playing' || g.state === 'menu') this.checkPunches();
    return motion;
  }

  /** Left stick: smooth locomotion relative to where the head looks. */
  private walk(ax: number, ay: number, realDt: number): number {
    const g = this.g;
    const fwd = _v1.set(g.headFwd.x, 0, g.headFwd.z).normalize();
    const right = _v2.set(-fwd.z, 0, fwd.x);
    const dx = (fwd.x * -ay + right.x * ax) * 2.5 * realDt;
    const dz = (fwd.z * -ay + right.z * ax) * 2.5 * realDt;
    const head = g.headPos.clone();
    const moved = g.world.moveCircle(head, dx, dz, 0.25);
    g.rig.position.x += head.x - g.headPos.x;
    g.rig.position.z += head.z - g.headPos.z;
    return moved / realDt;
  }

  private snapTurn(angle: number): void {
    // Rotate the rig around the head so the player stays in place.
    const g = this.g;
    const head = g.headPos.clone();
    g.rig.rotation.y += angle;
    g.rig.updateMatrixWorld(true);
    const after = g.camera.getWorldPosition(new THREE.Vector3());
    g.rig.position.x += head.x - after.x;
    g.rig.position.z += head.z - after.z;
    this.motionPrimed = false;
  }

  private recoil(hand: Hand, w: Weapon): void {
    this.haptic(hand, w.kind === 'smg' ? 0.5 : 0.8, w.kind === 'smg' ? 30 : 60);
  }

  private onTrigger(hand: Hand): void {
    if (this.g.restartIfOver()) return;
    const w = hand.held;
    if (w) this.g.combat.fire(w, aimDir(w.mesh, _v1), (fw) => this.recoil(hand, fw));
  }

  /** Grip: throw what you hold, snatch a gun out of an enemy's hand, or pick one up. */
  private onSqueeze(hand: Hand): void {
    const g = this.g;
    if (hand.held) {
      this.drop(hand, true);
      return;
    }
    for (const e of g.enemies) {
      if (!e.alive || !e.materialized || !e.weapon) continue;
      if (e.weapon.mesh.getWorldPosition(_v1).distanceTo(hand.pos) < 0.32) {
        const w = g.combat.disarm(e);
        if (w) {
          this.hold(hand, w);
          this.haptic(hand, 0.8, 80);
        }
        return;
      }
    }
    let best: Weapon | null = null;
    let bestD = 0.35;
    for (const w of g.combat.freeGuns) {
      const d = w.mesh.position.distanceTo(hand.pos);
      if (d < bestD) {
        best = w;
        bestD = d;
      }
    }
    if (best) {
      g.combat.takeFree(best);
      this.hold(hand, best);
      sfx.pickup();
      this.haptic(hand, 0.4, 40);
    }
  }

  /** A fast fist into someone: disarms or shatters an enemy, kills a civilian. */
  private checkPunches(): void {
    const g = this.g;
    for (const hand of this.hands) {
      if (!hand.source || hand.punchCooldown > 0 || hand.vel.length() < PUNCH_SPEED) continue;
      const fist = hand.fist.getWorldPosition(_v2);
      if (g.state === 'menu' && g.menuTarget.visible && fist.distanceTo(g.menuTarget.position) < 0.3) {
        g.hitMenuTarget(hand.vel);
        hand.punchCooldown = 0.3;
        continue;
      }
      const hit = (spheres: HitSphere[]) => spheres.some((s) => fist.distanceTo(s.c) < s.r + 0.08);
      const e = g.enemies.find((x) => x.alive && x.materialized && hit(x.spheres));
      if (e) {
        g.combat.punch(e, hand.vel.clone().normalize());
        this.haptic(hand, 1, 80);
        hand.punchCooldown = 0.3;
        continue;
      }
      const c = g.civilians.find((x) => x.alive && !x.gone && hit(x.spheres));
      if (c) {
        g.combat.killCivilian(c, hand.vel.clone().normalize(), true);
        hand.punchCooldown = 0.3;
      }
    }
  }
}
