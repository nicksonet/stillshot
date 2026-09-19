import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { initAudio, sfx } from './audio';
import { Bullets, type Bullet } from './bullets';
import { segmentSphere } from './collide';
import { Enemy, type EnemyContext } from './enemy';
import { Gun } from './gun';
import { LEVELS, type EnemyKind } from './levels';
import { Shards } from './shards';
import { TextPanel } from './text';
import { TimeController } from './time';
import { World } from './world';

type State = 'menu' | 'playing' | 'dead' | 'cleared' | 'won';
type Mode = 'none' | 'desktop' | 'vr';

const EYE_HEIGHT = 1.65;
const PLAYER_BULLET_SPEED = 45;
const ENEMY_BULLET_SPEED = 11;
const PUNCH_SPEED = 1.6;
const CHANT = ['STILL', 'SHOT', 'STILL', 'SHOT', 'STILL', 'SHOT'];
const CHANT_STEP = 0.55;
const MENU_TARGET_POS = new THREE.Vector3(0, 1.45, -2.2);

interface Hand {
  controller: THREE.Group;
  handedness: XRHandedness | 'none';
  source: XRInputSource | null;
  held: Gun | null;
  fist: THREE.Mesh;
  pos: THREE.Vector3;
  prevPos: THREE.Vector3;
  vel: THREE.Vector3;
  trigger: boolean;
  squeeze: boolean;
  punchCooldown: number;
}

interface Hit {
  t: number;
  apply: () => void;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly rig = new THREE.Group();

  private world: World;
  private bullets: Bullets;
  private shards: Shards;
  private panel: TextPanel;
  private time = new TimeController();
  private timer = new THREE.Timer();

  private state: State = 'menu';
  private mode: Mode = 'none';
  private paused = false;
  private levelIndex = 0;
  private enemies: Enemy[] = [];
  private freeGuns: Gun[] = [];
  private queue: EnemyKind[] = [];
  private spawnTimer = 0;
  private stateTimer = 0;
  private panelTimer = 0;
  private kills = 0;
  private frameCount = 0;
  private god = false;
  private pendingGun = true;

  private hands: Hand[] = [];
  private desktopGun: Gun | null = null;
  private yaw = 0;
  private pitch = 0;
  private lookAccum = 0;
  private keys = new Set<string>();
  private pointerLocked = false;
  private snapReady = true;

  private headPos = new THREE.Vector3();
  private headFwd = new THREE.Vector3();
  private prevHead = new THREE.Vector3();
  private prevHeadQ = new THREE.Quaternion();
  private motionPrimed = false;

  private menuTarget: THREE.Mesh;
  private deathShell: THREE.Mesh;
  private overlay = document.getElementById('overlay')!;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local-floor');
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0xdfe3e8);
    this.scene.fog = new THREE.Fog(0xdfe3e8, 14, 42);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a96a8, 1.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(4, 8, 3);
    this.scene.add(sun);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.03, 200);
    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(0, EYE_HEIGHT, 0);
    this.rig.add(this.camera);
    this.scene.add(this.rig);

    this.world = new World(this.scene);
    this.bullets = new Bullets(this.scene);
    this.shards = new Shards(this.scene);
    this.panel = new TextPanel(this.scene);

    this.menuTarget = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.22, 0),
      new THREE.MeshPhongMaterial({ color: 0xff2a1a, emissive: 0x6a0800, flatShading: true, shininess: 90 }),
    );
    this.scene.add(this.menuTarget);

    this.deathShell = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xff1a0a, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false }),
    );
    this.deathShell.renderOrder = 999;
    this.deathShell.visible = false;
    this.camera.add(this.deathShell);

    this.setupHands();
    this.setupVR();
    this.setupDesktop();
    this.enterMenu();

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------------------------------------------------------------- setup

  private setupHands(): void {
    const fistGeo = new THREE.IcosahedronGeometry(0.045, 0);
    const fistMat = new THREE.MeshPhongMaterial({ color: 0xf6f6f6, flatShading: true });
    for (let i = 0; i < 2; i++) {
      const controller = this.renderer.xr.getController(i);
      const fist = new THREE.Mesh(fistGeo, fistMat);
      fist.position.set(0, -0.02, 0.06);
      controller.add(fist);
      this.rig.add(controller);
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

  private setupVR(): void {
    const button = VRButton.createButton(this.renderer, { optionalFeatures: ['local-floor'] });
    document.getElementById('vr-slot')?.appendChild(button);
    this.renderer.xr.addEventListener('sessionstart', () => {
      initAudio();
      this.mode = 'vr';
      this.paused = false;
      this.overlay.classList.add('hidden');
      document.body.classList.remove('desktop');
      this.removeDesktopGun();
      this.motionPrimed = false;
      this.pendingGun = true;
      if (this.state !== 'playing') this.enterMenu();
    });
    this.renderer.xr.addEventListener('sessionend', () => {
      this.mode = 'none';
      for (const h of this.hands) this.dropHeld(h, false);
      this.camera.position.set(0, EYE_HEIGHT, 0);
      this.camera.quaternion.identity();
      this.camera.rotation.set(this.pitch, this.yaw, 0);
      this.overlay.classList.remove('hidden');
      this.enterMenu();
    });
  }

  private setupDesktop(): void {
    const canvas = this.renderer.domElement;
    document.getElementById('play-desktop')?.addEventListener('click', () => this.startDesktop(true));
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      if (this.pointerLocked && !locked && this.mode === 'desktop') {
        this.paused = true;
        this.overlay.classList.remove('hidden');
      }
      this.pointerLocked = locked;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked || this.mode !== 'desktop') return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0022, -1.45, 1.45);
      this.lookAccum += Math.hypot(e.movementX, e.movementY) * 0.0022;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (this.mode !== 'desktop' || this.paused) return;
      if (!this.pointerLocked) void canvas.requestPointerLock?.()?.catch?.(() => {});
      if (e.button === 0) this.desktopPrimary();
      if (e.button === 2) this.desktopThrow();
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (this.mode !== 'desktop' || this.paused) return;
      if (e.code === 'KeyE') this.desktopPickup(2.2);
      if (e.code === 'KeyF') this.desktopPunch();
      if (e.code === 'KeyR') this.startLevel(this.state === 'won' ? 0 : this.levelIndex);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  startDesktop(lock: boolean): void {
    initAudio();
    this.mode = 'desktop';
    this.paused = false;
    this.overlay.classList.add('hidden');
    document.body.classList.add('desktop');
    if (lock) {
      try {
        void this.renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
      } catch {
        /* pointer lock is optional */
      }
    }
    this.pendingGun = true;
  }

  // ---------------------------------------------------------------- state

  private enterMenu(): void {
    this.clearDynamic();
    this.state = 'menu';
    this.world.load(LEVELS[0]);
    this.resetPlayer();
    this.menuTarget.visible = true;
    this.menuTarget.position.copy(MENU_TARGET_POS);
    this.panel.show('STILL SHOT', 'Выстрели в красный кристалл');
    this.panelTimer = 0;
    this.pendingGun = true;
  }

  startLevel(i: number): void {
    this.clearDynamic();
    this.levelIndex = i;
    const level = LEVELS[i];
    this.world.load(level);
    this.resetPlayer();
    this.queue = [...level.waves];
    this.spawnTimer = 0.8;
    this.state = 'playing';
    this.stateTimer = 0;
    this.time.reset();
    this.menuTarget.visible = false;
    this.pendingGun = true;
    this.panel.show(`УРОВЕНЬ ${i + 1} / ${LEVELS.length}`, level.name);
    this.panelTimer = 2.5;
    this.snapPanel = true;
  }

  private snapPanel = true;

  private resetPlayer(): void {
    this.rig.position.set(0, 0, 0);
    this.rig.rotation.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.motionPrimed = false;
    this.deathShell.visible = false;
    this.snapPanel = true;
  }

  private clearDynamic(): void {
    for (const e of this.enemies) this.scene.remove(e.group);
    this.enemies = [];
    for (const g of this.freeGuns) g.mesh.removeFromParent();
    this.freeGuns = [];
    for (const h of this.hands) {
      h.held?.mesh.removeFromParent();
      h.held = null;
      h.fist.visible = true;
    }
    this.removeDesktopGun();
    this.bullets.clear();
    this.shards.clear();
    this.queue = [];
  }

  private removeDesktopGun(): void {
    this.desktopGun?.mesh.removeFromParent();
    this.desktopGun = null;
  }

  private giveStartGun(): boolean {
    if (this.mode === 'desktop') {
      if (!this.desktopGun) this.holdDesktop(new Gun());
      return true;
    }
    if (this.mode === 'vr') {
      const connected = this.hands.filter((h) => h.source);
      if (!connected.length) return false;
      const hand = connected.find((h) => h.handedness === 'right') ?? connected[0];
      if (!hand.held) this.holdInHand(hand, new Gun());
      return true;
    }
    return false;
  }

  private holdInHand(hand: Hand, gun: Gun): void {
    hand.held = gun;
    gun.held = true;
    gun.thrown = false;
    gun.resting = false;
    hand.controller.add(gun.mesh);
    gun.mesh.position.set(0, -0.01, 0.03);
    gun.mesh.rotation.set(0, 0, 0);
    hand.fist.visible = false;
  }

  private holdDesktop(gun: Gun): void {
    this.desktopGun = gun;
    gun.held = true;
    gun.thrown = false;
    gun.resting = false;
    this.camera.add(gun.mesh);
    gun.mesh.position.set(0.2, -0.19, -0.4);
    gun.mesh.rotation.set(0, 0, 0);
  }

  private release(gun: Gun, vel: THREE.Vector3, thrown: boolean): void {
    this.scene.attach(gun.mesh);
    gun.held = false;
    gun.thrown = thrown;
    gun.resting = false;
    gun.vel.copy(vel);
    gun.spin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 6);
    this.freeGuns.push(gun);
  }

  private dropHeld(hand: Hand, thrown: boolean): void {
    if (!hand.held) return;
    const gun = hand.held;
    hand.held = null;
    hand.fist.visible = true;
    const v = hand.vel.clone().multiplyScalar(1.3);
    if (thrown && v.length() < 2) v.copy(this.aimDir(hand.controller, _v1)).multiplyScalar(5);
    this.release(gun, v, thrown);
    if (thrown) sfx.throwGun();
  }

  // ---------------------------------------------------------------- loop

  private frame(): void {
    this.timer.update();
    const realDt = Math.max(1e-4, Math.min(this.timer.getDelta(), 0.05));
    this.frameCount++;

    if (!this.paused && this.mode !== 'none') {
      this.updateHead();
      if (this.pendingGun && this.giveStartGun()) this.pendingGun = false;
      const motion = this.mode === 'vr' ? this.updateVR(realDt) : this.updateDesktop(realDt);
      this.updateHead();

      if (this.state === 'playing') this.time.update(realDt, motion);
      else if (this.state === 'dead') this.time.scale = 0.12;
      else this.time.scale = 1;
      const gdt = realDt * this.time.scale;

      this.simulate(gdt, realDt);
    } else {
      this.updateHead();
      this.menuTarget.rotation.y += realDt * 0.8;
    }
    this.updatePanel(realDt);
    this.renderer.render(this.scene, this.camera);
  }

  private updateHead(): void {
    this.camera.getWorldPosition(this.headPos);
    this.camera.getWorldDirection(this.headFwd);
  }

  /** Returns a motion measure (m/s-ish) that drives the time scale. */
  private updateVR(realDt: number): number {
    const camQ = this.camera.getWorldQuaternion(_q1);
    let motion = 0;
    if (this.motionPrimed) {
      const headSpeed = this.headPos.distanceTo(this.prevHead) / realDt;
      const headAng = this.prevHeadQ.angleTo(camQ) / realDt;
      motion = headSpeed + headAng * 0.12;
    }

    for (const hand of this.hands) {
      hand.controller.getWorldPosition(hand.pos);
      if (this.motionPrimed && hand.source) {
        hand.vel.subVectors(hand.pos, hand.prevPos).divideScalar(realDt);
        motion = Math.max(motion, motion + hand.vel.length() * 0.35);
      } else hand.vel.set(0, 0, 0);
      hand.prevPos.copy(hand.pos);
      hand.punchCooldown = Math.max(0, hand.punchCooldown - realDt);
      hand.held?.animate(realDt);

      const gp = hand.source?.gamepad;
      if (!gp) continue;
      const trig = (gp.buttons[0]?.value ?? 0) > 0.6;
      const sq = (gp.buttons[1]?.value ?? 0) > 0.6;
      if (trig && !hand.trigger) this.onTrigger(hand);
      if (sq && !hand.squeeze) this.onSqueeze(hand);
      hand.trigger = trig;
      hand.squeeze = sq;

      const ax = gp.axes[2] ?? 0;
      const ay = gp.axes[3] ?? 0;
      if (hand.handedness === 'left' && Math.hypot(ax, ay) > 0.2) {
        const fwd = _v1.set(this.headFwd.x, 0, this.headFwd.z).normalize();
        const right = _v2.set(-fwd.z, 0, fwd.x);
        const dx = (fwd.x * -ay + right.x * ax) * 2.5 * realDt;
        const dz = (fwd.z * -ay + right.z * ax) * 2.5 * realDt;
        const head = this.headPos.clone();
        const moved = this.world.moveCircle(head, dx, dz, 0.25);
        this.rig.position.x += head.x - this.headPos.x;
        this.rig.position.z += head.z - this.headPos.z;
        motion += moved / realDt;
      }
      if (hand.handedness === 'right') {
        if (Math.abs(ax) > 0.7 && this.snapReady) {
          this.snapTurn(-Math.sign(ax) * (Math.PI / 6));
          this.snapReady = false;
        } else if (Math.abs(ax) < 0.3) this.snapReady = true;
      }
    }

    this.prevHead.copy(this.headPos);
    this.prevHeadQ.copy(camQ);
    this.motionPrimed = true;

    if (this.state === 'playing' || this.state === 'menu') this.checkPunches();
    return motion;
  }

  private snapTurn(angle: number): void {
    // Rotate the rig around the head so the player stays in place.
    const head = this.headPos.clone();
    this.rig.rotation.y += angle;
    this.rig.updateMatrixWorld(true);
    const after = this.camera.getWorldPosition(new THREE.Vector3());
    this.rig.position.x += head.x - after.x;
    this.rig.position.z += head.z - after.z;
    this.motionPrimed = false;
  }

  private onTrigger(hand: Hand): void {
    if (this.state === 'dead' && this.stateTimer > 1) return this.startLevel(this.levelIndex);
    if (this.state === 'won' && this.stateTimer > 1) return this.startLevel(0);
    if (hand.held) this.fire(hand.held, this.aimDir(hand.held.mesh, _v1), hand);
  }

  private onSqueeze(hand: Hand): void {
    if (hand.held) {
      this.dropHeld(hand, true);
      return;
    }
    let best: Gun | null = null;
    let bestD = 0.35;
    for (const g of this.freeGuns) {
      const d = g.mesh.position.distanceTo(hand.pos);
      if (d < bestD) {
        best = g;
        bestD = d;
      }
    }
    if (best) {
      this.freeGuns.splice(this.freeGuns.indexOf(best), 1);
      this.holdInHand(hand, best);
      sfx.pickup();
      this.haptic(hand, 0.4, 40);
    }
  }

  private checkPunches(): void {
    for (const hand of this.hands) {
      if (!hand.source || hand.punchCooldown > 0 || hand.vel.length() < PUNCH_SPEED) continue;
      const fist = hand.fist.getWorldPosition(_v1);
      if (this.state === 'menu' && this.menuTarget.visible && fist.distanceTo(this.menuTarget.position) < 0.3) {
        this.hitMenuTarget(hand.vel);
        hand.punchCooldown = 0.3;
        continue;
      }
      for (const e of this.enemies) {
        if (!e.alive || !e.materialized) continue;
        if (e.spheres.some((s) => fist.distanceTo(s.c) < s.r + 0.08)) {
          sfx.punch();
          this.killEnemy(e, hand.vel.clone().normalize());
          this.haptic(hand, 1, 80);
          hand.punchCooldown = 0.3;
          break;
        }
      }
    }
  }

  private updateDesktop(realDt: number): number {
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    const f = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const r = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    let moved = 0;
    if ((f || r) && (this.state === 'playing' || this.state === 'menu')) {
      const len = Math.hypot(f, r);
      const sx = -Math.sin(this.yaw);
      const sz = -Math.cos(this.yaw);
      const dx = ((sx * f + Math.cos(this.yaw) * r) / len) * 3.2 * realDt;
      const dz = ((sz * f - Math.sin(this.yaw) * r) / len) * 3.2 * realDt;
      moved = this.world.moveCircle(this.rig.position, dx, dz, 0.3);
    }
    const look = this.lookAccum / realDt;
    this.lookAccum = 0;
    this.desktopGun?.animate(realDt);
    if (!this.desktopGun && this.state === 'playing') this.desktopPickup(1.0);
    return moved / realDt + Math.min(look * 0.05, 0.25);
  }

  private desktopPrimary(): void {
    if (this.state === 'dead' && this.stateTimer > 1) return this.startLevel(this.levelIndex);
    if (this.state === 'won' && this.stateTimer > 1) return this.startLevel(0);
    if (!this.desktopGun) return this.desktopPunch();
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.camera.updateMatrixWorld(true);
    let from = this.desktopGun.muzzleWorld(new THREE.Vector3());
    const target = this.aimPoint();
    // The muzzle sits off-centre; if it can't see what the crosshair sees, shoot along the view ray.
    const wall = this.world.segmentHit(from, target);
    if (wall >= 0 && wall < 0.98) from = this.headPos.clone().addScaledVector(this.headFwd, 0.3);
    this.fire(this.desktopGun, target.sub(from).normalize(), null, from);
  }

  private desktopThrow(): void {
    if (!this.desktopGun) return;
    const gun = this.desktopGun;
    this.desktopGun = null;
    const v = this.headFwd.clone().multiplyScalar(14);
    v.y += 1.2;
    this.release(gun, v, true);
    sfx.throwGun();
  }

  private desktopPickup(radius: number): void {
    if (this.desktopGun) return;
    let best: Gun | null = null;
    let bestD = radius;
    for (const g of this.freeGuns) {
      const d = Math.hypot(g.mesh.position.x - this.headPos.x, g.mesh.position.z - this.headPos.z);
      if (d < bestD && !g.thrown) {
        best = g;
        bestD = d;
      }
    }
    if (best) {
      this.freeGuns.splice(this.freeGuns.indexOf(best), 1);
      this.holdDesktop(best);
      sfx.pickup();
    }
  }

  private desktopPunch(): void {
    if (this.state === 'menu' && this.headPos.distanceTo(this.menuTarget.position) < 2) {
      this.hitMenuTarget(this.headFwd);
      return;
    }
    for (const e of this.enemies) {
      if (!e.alive || !e.materialized) continue;
      const to = _v1.subVectors(e.spheres[1].c, this.headPos);
      const d = to.length();
      if (d < 1.9 && to.normalize().dot(this.headFwd) > 0.6) {
        sfx.punch();
        this.killEnemy(e, this.headFwd.clone());
        this.time.kick(0.25);
        return;
      }
    }
  }

  /** Where the crosshair points: first thing hit along the view ray. */
  private aimPoint(): THREE.Vector3 {
    const origin = this.headPos.clone();
    const far = origin.clone().addScaledVector(this.headFwd, 60);
    let best = this.world.segmentHit(origin, far);
    if (best < 0) best = 1;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      for (const s of e.spheres) {
        const t = segmentSphere(origin, far, s.c, s.r);
        if (t >= 0 && t < best) best = t;
      }
    }
    if (this.menuTarget.visible) {
      const t = segmentSphere(origin, far, this.menuTarget.position, 0.25);
      if (t >= 0 && t < best) best = t;
    }
    return origin.lerp(far, best);
  }

  private aimDir(obj: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 0, -1).applyQuaternion(obj.getWorldQuaternion(_q1)).normalize();
  }

  private fire(gun: Gun, dir: THREE.Vector3, hand: Hand | null, from?: THREE.Vector3): void {
    if (this.state !== 'playing' && this.state !== 'menu') return;
    if (!gun.fire()) {
      sfx.empty();
      return;
    }
    const origin = from ?? gun.muzzleWorld(new THREE.Vector3());
    this.bullets.spawn('player', origin, dir, PLAYER_BULLET_SPEED);
    sfx.shoot();
    this.time.kick();
    if (hand) this.haptic(hand, 0.8, 60);
  }

  private haptic(hand: Hand, intensity: number, ms: number): void {
    const act = hand.source?.gamepad?.hapticActuators?.[0] as unknown as { pulse?: (v: number, d: number) => void } | undefined;
    try {
      act?.pulse?.(intensity, ms);
    } catch {
      /* haptics are best-effort */
    }
  }

  // ---------------------------------------------------------------- simulation

  private simulate(gdt: number, realDt: number): void {
    this.stateTimer += realDt;
    this.menuTarget.rotation.y += realDt * 0.8;
    this.menuTarget.rotation.x += realDt * 0.3;

    if (this.state === 'playing') this.updateSpawning(gdt);

    const ctx: EnemyContext = {
      playerHead: this.headPos,
      world: this.world,
      others: this.enemies,
      shoot: (from, dir) => {
        this.bullets.spawn('enemy', from, dir, ENEMY_BULLET_SPEED);
        sfx.enemyShoot(from.distanceTo(this.headPos));
      },
      strike: () => this.killPlayer(),
    };
    if (this.state === 'playing' || this.state === 'dead') for (const e of this.enemies) e.update(gdt, ctx);

    this.bullets.advance(gdt);
    this.resolveBullets();
    this.bullets.sync();
    this.updateFreeGuns(gdt);
    this.shards.update(gdt);

    if (this.state === 'playing' && this.queue.length === 0 && this.enemies.every((e) => !e.alive)) {
      this.state = 'cleared';
      this.stateTimer = 0;
      sfx.clear();
    }
    if (this.state === 'cleared') {
      const step = Math.floor(this.stateTimer / CHANT_STEP);
      if (step < CHANT.length) {
        this.panel.show(CHANT[step], '', step % 2 ? '#1a1a1a' : '#e8281c');
        this.snapPanel = step === 0;
      } else if (this.levelIndex + 1 < LEVELS.length) this.startLevel(this.levelIndex + 1);
      else {
        this.state = 'won';
        this.stateTimer = 0;
        this.panel.show('ПОБЕДА', 'Курок / клик — сыграть ещё раз');
      }
    }
    if (this.state === 'dead') {
      const k = Math.min(1, this.stateTimer * 2);
      (this.deathShell.material as THREE.MeshBasicMaterial).opacity = 0.45 * k;
      if (this.stateTimer > 0.8) this.panel.show('ТЫ МЁРТВ', 'Курок / клик — заново');
    }
  }

  private updateSpawning(gdt: number): void {
    this.spawnTimer -= gdt;
    const alive = this.enemies.filter((e) => e.alive).length;
    const level = LEVELS[this.levelIndex];
    if (!this.queue.length || alive >= level.maxAlive || this.spawnTimer > 0) return;
    const candidates = level.spawns.filter(([x, z]) => {
      if (Math.hypot(x - this.headPos.x, z - this.headPos.z) < 6) return false;
      if (this.world.blocked(x, z, 0.4)) return false;
      return !this.enemies.some((e) => e.alive && Math.hypot(e.position.x - x, e.position.z - z) < 1);
    });
    if (!candidates.length) return;
    const [x, z] = candidates[Math.floor(Math.random() * candidates.length)];
    const enemy = new Enemy(this.queue.shift()!, x, z);
    enemy.group.rotation.y = Math.atan2(this.headPos.x - x, this.headPos.z - z);
    this.enemies.push(enemy);
    this.scene.add(enemy.group);
    this.spawnTimer = 1.5;
  }

  private resolveBullets(): void {
    const list = this.bullets.list;
    const heldGuns = [...this.hands.map((h) => h.held), this.desktopGun].filter((g): g is Gun => !!g);
    for (const b of list) {
      if (b.dead) continue;
      let best: Hit | null = null;
      const consider = (t: number, apply: () => void) => {
        if (t >= 0 && (!best || t < best.t)) best = { t, apply };
      };

      const wt = this.world.segmentHit(b.prev, b.pos);
      consider(wt, () => this.spark(b, 0xb8bec8));

      if (b.owner === 'player') {
        for (const e of this.enemies) {
          if (!e.alive || !e.materialized) continue;
          for (const s of e.spheres) consider(segmentSphere(b.prev, b.pos, s.c, s.r), () => this.killEnemy(e, b.dir));
        }
        if (this.state === 'menu' && this.menuTarget.visible)
          consider(segmentSphere(b.prev, b.pos, this.menuTarget.position, 0.25), () => this.hitMenuTarget(b.dir));
        for (const o of list) {
          if (o.owner !== 'enemy' || o.dead) continue;
          consider(segmentSphere(b.prev, b.pos, o.pos, 0.12), () => {
            o.dead = true;
            this.spark(o, 0x2a2a2a);
            sfx.ricochet();
          });
        }
      } else if (this.state === 'playing') {
        consider(segmentSphere(b.prev, b.pos, this.headPos, 0.13), () => this.killPlayer());
        const torso = _v2.copy(this.headPos);
        torso.y -= 0.45;
        consider(segmentSphere(b.prev, b.pos, torso.clone(), 0.2), () => this.killPlayer());
        for (const g of heldGuns) {
          consider(segmentSphere(b.prev, b.pos, g.mesh.getWorldPosition(new THREE.Vector3()), 0.08), () => {
            this.spark(b, 0x2a2a2a);
            sfx.ricochet();
          });
        }
      }

      const hit = best as Hit | null;
      if (hit) {
        b.pos.lerpVectors(b.prev, b.pos, hit.t);
        b.dead = true;
        hit.apply();
      }
    }
  }

  private spark(b: Bullet, color: number): void {
    this.shards.burst(b.pos, 6, color, 2, 0.02, 0.02, b.dir.clone().multiplyScalar(-1.5));
  }

  private updateFreeGuns(gdt: number): void {
    for (const g of this.freeGuns) {
      if (g.resting) continue;
      const p = g.mesh.position;
      const prev = p.clone();
      g.vel.y -= 9.8 * gdt;
      p.addScaledVector(g.vel, gdt);
      g.mesh.rotation.x += g.spin.x * gdt;
      g.mesh.rotation.y += g.spin.y * gdt;
      g.mesh.rotation.z += g.spin.z * gdt;

      if (g.thrown && g.vel.length() > 2) {
        for (const e of this.enemies) {
          if (!e.alive || !e.materialized) continue;
          if (e.spheres.some((s) => segmentSphere(prev, p, s.c, s.r + 0.05) >= 0)) {
            this.killEnemy(e, g.vel.clone().normalize());
            g.vel.multiplyScalar(-0.25);
            g.thrown = false;
            break;
          }
        }
        if (this.state === 'menu' && this.menuTarget.visible && segmentSphere(prev, p, this.menuTarget.position, 0.3) >= 0) {
          this.hitMenuTarget(g.vel.clone().normalize());
          g.vel.multiplyScalar(-0.25);
          g.thrown = false;
        }
      }
      const t = this.world.segmentHit(prev, p);
      if (t >= 0 && p.y > 0.05) {
        p.lerpVectors(prev, p, t * 0.9);
        g.vel.multiplyScalar(-0.3);
        g.thrown = false;
      }
      if (p.y < 0.03) {
        p.y = 0.03;
        g.vel.y = 0;
        g.vel.x *= 0.5;
        g.vel.z *= 0.5;
        g.spin.multiplyScalar(0.5);
        g.thrown = false;
        if (g.vel.length() < 0.15) {
          g.resting = true;
          g.mesh.rotation.set(0, g.mesh.rotation.y, Math.PI / 2);
        }
      }
    }
  }

  private killEnemy(e: Enemy, push: THREE.Vector3): void {
    if (!e.alive) return;
    e.alive = false;
    this.kills++;
    const impulse = push.clone().setY(0).normalize().multiplyScalar(3);
    this.shards.burst(e.spheres[1].c, 36, 0xff2a1a, 2.5, 0.07, 0.3, impulse);
    this.shards.burst(e.spheres[0].c, 10, 0xff2a1a, 2.5, 0.06, 0.12, impulse);
    this.shards.burst(e.spheres[2].c, 16, 0xff2a1a, 1.5, 0.07, 0.3, impulse);
    if (e.gun) {
      const gun = e.gun;
      e.gun = null;
      this.release(gun, new THREE.Vector3((Math.random() - 0.5) * 1.5, 2, (Math.random() - 0.5) * 1.5), false);
    }
    this.scene.remove(e.group);
    sfx.shatter();
    this.time.kick(0.2);
  }

  private hitMenuTarget(push: THREE.Vector3): void {
    this.menuTarget.visible = false;
    this.shards.burst(this.menuTarget.position, 40, 0xff2a1a, 3, 0.05, 0.1, push.clone().multiplyScalar(2));
    sfx.shatter();
    this.startLevelSoon();
  }

  private startLevelSoon(): void {
    // Let the shards fly for a moment before the level resets the scene.
    this.state = 'cleared';
    this.stateTimer = CHANT_STEP * CHANT.length - 0.6;
    this.levelIndex = -1;
    this.panel.hide();
  }

  private killPlayer(): void {
    if (this.god || this.state !== 'playing') return;
    this.state = 'dead';
    this.stateTimer = 0;
    this.deathShell.visible = true;
    (this.deathShell.material as THREE.MeshBasicMaterial).opacity = 0;
    this.panel.hide();
    sfx.death();
    for (const h of this.hands) this.haptic(h, 1, 300);
  }

  private updatePanel(realDt: number): void {
    if (this.panelTimer > 0) {
      this.panelTimer -= realDt;
      if (this.panelTimer <= 0 && this.state === 'playing') this.panel.hide();
    }
    if (this.panel.mesh.visible) {
      this.panel.follow(this.headPos, this.headFwd, realDt, this.snapPanel);
      this.snapPanel = false;
    }
  }

  // ---------------------------------------------------------------- debug / tests

  debugApi() {
    const g = this;
    const aimAt = (p: THREE.Vector3) => {
      const d = p.clone().sub(g.headPos);
      g.yaw = Math.atan2(-d.x, -d.z);
      g.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      g.camera.rotation.set(g.pitch, g.yaw, 0);
      g.camera.updateMatrixWorld(true);
      g.updateHead();
    };
    return {
      get state() {
        return g.state;
      },
      get mode() {
        return g.mode;
      },
      get level() {
        return g.levelIndex;
      },
      get timeScale() {
        return g.time.scale;
      },
      get kills() {
        return g.kills;
      },
      get frame() {
        return g.frameCount;
      },
      get presenting() {
        return g.renderer.xr.isPresenting;
      },
      get panelText() {
        return g.panel.text;
      },
      enemies: () =>
        g.enemies.filter((e) => e.alive).map((e) => ({ kind: e.kind, x: e.position.x, z: e.position.z, ready: e.materialized })),
      bulletCount: () => g.bullets.list.length,
      queued: () => g.queue.length,
      guns: () => ({
        desktop: g.desktopGun ? g.desktopGun.ammo : null,
        hands: g.hands.map((h) => ({ handedness: h.handedness, ammo: h.held ? h.held.ammo : null })),
        free: g.freeGuns.length,
      }),
      startDesktop: () => g.startDesktop(false),
      startLevel: (i: number) => g.startLevel(i),
      setTimeScale: (v: number | null) => (g.time.override = v),
      setGodMode: (on: boolean) => (g.god = on),
      /** part: 0 head, 1 torso, 2 legs. */
      aimAtEnemy: (i = 0, part = 1) => {
        const e = g.enemies.filter((x) => x.alive)[i];
        if (e) aimAt(e.spheres[part].c);
        return !!e;
      },
      aimAtTarget: () => aimAt(g.menuTarget.position),
      fire: () => g.desktopPrimary(),
      throwGun: () => g.desktopThrow(),
      giveGun: () => {
        if (!g.desktopGun) g.holdDesktop(new Gun());
      },
      punch: () => g.desktopPunch(),
    };
  }
}
