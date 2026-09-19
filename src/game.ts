import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { ambience, initAudio, sfx } from './audio';
import { Bullets, type Bullet } from './bullets';
import { Civilian } from './civilian';
import { Debris } from './debris';
import { Music } from './music';
import { segmentSphere } from './collide';
import { Enemy, type EnemyContext, type HitSphere } from './enemy';
import { LEVELS, type EnemyKind, type LevelDef } from './levels';
import { Shards } from './shards';
import { TextPanel } from './text';
import { TimeController } from './time';
import { Weapon, type WeaponKind } from './weapons';
import { World } from './world';

type State = 'menu' | 'playing' | 'failed' | 'cleared' | 'won';
type Mode = 'none' | 'desktop' | 'vr';
export type FailReason = 'dead' | 'civilian' | 'vip';

const EYE_HEIGHT = 1.65;
const PLAYER_BULLET_SPEED = 45;
const ENEMY_BULLET_SPEED = 11;
const PUNCH_SPEED = 1.6;
const CHANT = ['STILL', 'SHOT', 'STILL', 'SHOT', 'STILL', 'SHOT'];
const CHANT_STEP = 0.55;
const RED = 0xff2a1a;
const CIV_SHARDS = 0xdfe8f5;
const SUIT_SHARDS = 0x1c1c22;
const VIP_SHARDS = 0xf0b73a;

const FAIL_TEXT: Record<FailReason, string> = {
  dead: 'YOU DIED',
  civilian: 'CIVILIAN DOWN',
  vip: 'THE BOSS IS DEAD',
};

interface Hand {
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

interface Hit {
  t: number;
  apply: () => void;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();

/** Distance from point p to segment a-b. */
function pointSegmentDistance(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = _v1.subVectors(b, a);
  const t = THREE.MathUtils.clamp(_v2.subVectors(p, a).dot(ab) / Math.max(1e-9, ab.lengthSq()), 0, 1);
  return _v2.copy(a).addScaledVector(ab, t).distanceTo(p);
}

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly rig = new THREE.Group();

  private world: World;
  private bullets: Bullets;
  private shards: Shards;
  private debris: Debris;
  private music = new Music();
  private panel: TextPanel;
  private time = new TimeController();
  private timer = new THREE.Timer();

  private state: State = 'menu';
  private failReason: FailReason | null = null;
  private mode: Mode = 'none';
  private paused = false;
  private levelIndex = 0;
  private enemies: Enemy[] = [];
  private civilians: Civilian[] = [];
  private vip: Civilian | null = null;
  /** How many of the level's scripted intro spawns have been used. */
  private introIndex = 0;
  private exits: THREE.Vector3[] = [];
  private freeGuns: Weapon[] = [];
  private queue: EnemyKind[] = [];
  private spawnTimer = 0;
  private stateTimer = 0;
  private panelTimer = 0;
  private kills = 0;
  /** Debug: keep the level running with no waves left (scripted tests). */
  private holdOpen = false;
  private frameCount = 0;
  private god = false;
  private pendingGun = true;
  private panicked = false;
  private snapPanel = true;

  private hands: Hand[] = [];
  private desktopGun: Weapon | null = null;
  private yaw = 0;
  private pitch = 0;
  private lookAccum = 0;
  private keys = new Set<string>();
  private mouseHeld = false;
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

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.03, 200);
    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(0, EYE_HEIGHT, 0);
    this.rig.add(this.camera);
    this.scene.add(this.rig);

    this.world = new World(this.scene);
    this.bullets = new Bullets(this.scene);
    this.shards = new Shards(this.scene);
    this.debris = new Debris(this.scene);
    this.panel = new TextPanel(this.scene);

    this.menuTarget = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.22, 0),
      new THREE.MeshPhongMaterial({ color: RED, emissive: 0x8a0a00, flatShading: true, shininess: 90 }),
    );
    this.scene.add(this.menuTarget);

    this.deathShell = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xff1a3a, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, fog: false }),
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
    const fistMat = new THREE.MeshPhongMaterial({ color: 0x2a2d3a, emissive: 0x0a3a44, flatShading: true, shininess: 80 });
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
    const button = VRButton.createButton(this.renderer);
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
        this.mouseHeld = false;
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
      if (e.button === 0) {
        this.mouseHeld = true;
        this.desktopPrimary();
      }
      if (e.button === 2) this.desktopThrow();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseHeld = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (this.mode !== 'desktop' || this.paused) return;
      if (e.code === 'KeyE') this.desktopTake();
      if (e.code === 'KeyF') this.desktopPunch();
      if (e.code === 'KeyR') this.startLevel(this.state === 'won' ? 0 : Math.max(0, this.levelIndex));
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

  private get level(): LevelDef {
    return LEVELS[Math.max(0, this.levelIndex)];
  }

  private enterMenu(): void {
    this.levelIndex = 0;
    this.loadLevel(LEVELS[0]);
    this.state = 'menu';
    this.menuTarget.visible = true;
    const [px, pz] = LEVELS[0].playerStart;
    this.menuTarget.position.set(px, 1.5, pz - 2.6);
    this.panel.show('STILL SHOT', 'Shoot the red crystal to start');
    this.panelTimer = 0;
  }

  startLevel(i: number): void {
    this.levelIndex = i;
    this.loadLevel(LEVELS[i]);
    this.queue = [...LEVELS[i].waves];
    this.spawnTimer = 0.8;
    this.state = 'playing';
    this.stateTimer = 0;
    this.time.reset();
    this.menuTarget.visible = false;
    const { name, brief } = LEVELS[i];
    this.panel.show(`LEVEL ${i + 1} / ${LEVELS.length}`, brief ? `${name} — ${brief}` : name);
    this.panelTimer = 2.5;
    ambience(LEVELS[i].theme === 'restaurant' ? 1 : 0.5);
  }

  /** Reset everything dynamic and build the level's static scene, diners and boss. */
  private loadLevel(level: LevelDef): void {
    this.clearDynamic();
    this.world.load(level);
    this.exits = level.exits.map(([x, z]) => new THREE.Vector3(x, 0, z));
    for (const [x, z, rot, pose] of level.civilians) this.addCivilian(new Civilian(x, z, rot, pose));
    if (level.vip) {
      const [x, z, rot] = level.vip;
      this.vip = new Civilian(x, z, rot, 'prone', 'vip');
      this.addCivilian(this.vip);
    }
    for (const [x, z, rot] of level.guards ?? []) this.addCivilian(new Civilian(x, z, rot, 'kneel', 'guard'));
    this.introIndex = 0;
    this.panicked = false;
    this.failReason = null;
    this.holdOpen = false;
    this.resetPlayer(level);
    this.pendingGun = true;
  }

  private addCivilian(c: Civilian): void {
    this.civilians.push(c);
    this.scene.add(c.fig.root);
  }

  private resetPlayer(level: LevelDef): void {
    this.rig.position.set(level.playerStart[0], 0, level.playerStart[1]);
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
    for (const c of this.civilians) this.scene.remove(c.fig.root);
    this.civilians = [];
    this.vip = null;
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
    this.debris.clear();
    this.queue = [];
    this.mouseHeld = false;
  }

  private removeDesktopGun(): void {
    this.desktopGun?.mesh.removeFromParent();
    this.desktopGun = null;
  }

  private giveStartGun(): boolean {
    if (this.mode === 'desktop') {
      if (!this.desktopGun) this.holdDesktop(new Weapon('revolver'));
      return true;
    }
    if (this.mode === 'vr') {
      const connected = this.hands.filter((h) => h.source);
      if (!connected.length) return false;
      const hand = connected.find((h) => h.handedness === 'right') ?? connected[0];
      if (!hand.held) this.holdInHand(hand, new Weapon('revolver'));
      return true;
    }
    return false;
  }

  private prepareHeld(w: Weapon): void {
    w.held = true;
    w.thrown = false;
    w.resting = false;
    w.cooldown = 0;
    w.realCooldown = 0;
    w.mesh.position.set(0, 0, 0);
    w.mesh.rotation.set(0, 0, 0);
  }

  private holdInHand(hand: Hand, w: Weapon): void {
    hand.held = w;
    hand.controller.add(w.mesh);
    this.prepareHeld(w);
    w.mesh.position.set(0, -0.01, w.kind === 'smg' ? 0.06 : 0.03);
    hand.fist.visible = false;
  }

  private holdDesktop(w: Weapon): void {
    this.desktopGun = w;
    this.camera.add(w.mesh);
    this.prepareHeld(w);
    w.mesh.position.set(0.2, -0.19, w.kind === 'smg' ? -0.36 : -0.4);
  }

  private release(w: Weapon, vel: THREE.Vector3, thrown: boolean): void {
    this.scene.attach(w.mesh);
    w.held = false;
    w.thrown = thrown;
    w.resting = false;
    w.vel.copy(vel);
    w.spin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 6);
    this.freeGuns.push(w);
  }

  private dropHeld(hand: Hand, thrown: boolean): void {
    if (!hand.held) return;
    const w = hand.held;
    hand.held = null;
    hand.fist.visible = true;
    const v = hand.vel.clone().multiplyScalar(1.3);
    if (thrown && v.length() < 2) v.copy(this.aimDir(hand.controller, _v1)).multiplyScalar(5);
    this.release(w, v, thrown);
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
      else if (this.state === 'failed') this.time.scale = 0.12;
      else this.time.scale = 1;
      const gdt = realDt * this.time.scale;

      this.simulate(gdt, realDt);
      // The groove follows time: it drags when you stand still.
      const rate = this.state === 'playing' ? 0.25 + 0.75 * this.time.scale : this.state === 'failed' ? 0.2 : 0.85;
      this.music.update(realDt, rate);
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

  private heldWeapons(): Weapon[] {
    return [...this.hands.map((h) => h.held), this.desktopGun].filter((w): w is Weapon => !!w);
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
      else if (trig && hand.held?.spec.auto) this.autoFire(hand.held, () => this.aimDir(hand.held!.mesh, _v1), hand);
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
    if (this.state === 'failed' && this.stateTimer > 1) return this.startLevel(this.levelIndex);
    if (this.state === 'won' && this.stateTimer > 1) return this.startLevel(0);
    if (hand.held) this.fire(hand.held, this.aimDir(hand.held.mesh, _v1), hand);
  }

  private onSqueeze(hand: Hand): void {
    if (hand.held) {
      this.dropHeld(hand, true);
      return;
    }
    // Snatch a weapon out of an enemy's hand.
    for (const e of this.enemies) {
      if (!e.alive || !e.materialized || !e.weapon) continue;
      if (e.weapon.mesh.getWorldPosition(_v1).distanceTo(hand.pos) < 0.32) {
        const w = this.disarm(e);
        if (w) {
          this.holdInHand(hand, w);
          this.haptic(hand, 0.8, 80);
        }
        return;
      }
    }
    let best: Weapon | null = null;
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

  /** Take an enemy's weapon; he lets go of any hostage and fights bare-handed. */
  private disarm(e: Enemy): Weapon | null {
    const w = e.takeWeapon();
    if (!w) return null;
    this.freeHostage(e);
    e.stagger(0.8);
    w.mesh.removeFromParent();
    sfx.disarm();
    this.time.kick(0.15);
    return w;
  }

  private freeHostage(e: Enemy): void {
    const c = e.releaseHostage();
    if (c && c.alive) c.flee(this.exits);
  }

  private checkPunches(): void {
    for (const hand of this.hands) {
      if (!hand.source || hand.punchCooldown > 0 || hand.vel.length() < PUNCH_SPEED) continue;
      const fist = hand.fist.getWorldPosition(_v2);
      if (this.state === 'menu' && this.menuTarget.visible && fist.distanceTo(this.menuTarget.position) < 0.3) {
        this.hitMenuTarget(hand.vel);
        hand.punchCooldown = 0.3;
        continue;
      }
      const hit = (spheres: HitSphere[]) => spheres.some((s) => fist.distanceTo(s.c) < s.r + 0.08);
      const e = this.enemies.find((x) => x.alive && x.materialized && hit(x.spheres));
      if (e) {
        this.punch(e, hand.vel.clone().normalize());
        this.haptic(hand, 1, 80);
        hand.punchCooldown = 0.3;
        continue;
      }
      const c = this.civilians.find((x) => x.alive && !x.gone && hit(x.spheres));
      if (c) {
        this.killCivilian(c, hand.vel.clone().normalize(), true);
        hand.punchCooldown = 0.3;
      }
    }
  }

  /** Punch: an armed enemy loses his weapon and staggers; an unarmed one shatters. */
  private punch(e: Enemy, dir: THREE.Vector3): void {
    sfx.punch();
    if (e.weapon) {
      const w = e.takeWeapon()!;
      this.freeHostage(e);
      this.release(w, dir.clone().multiplyScalar(2).setY(1.5), false);
      e.stagger(1.0);
      this.time.kick(0.2);
    } else this.killEnemy(e, dir);
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
    if (this.mouseHeld && this.desktopGun?.spec.auto) this.autoFire(this.desktopGun, () => this.desktopAim().dir, null, () => this.desktopAim().from);
    if (!this.desktopGun && this.state === 'playing') this.desktopPickup(1.0);
    return moved / realDt + Math.min(look * 0.05, 0.25);
  }

  private desktopAim(): { from: THREE.Vector3; dir: THREE.Vector3 } {
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.camera.updateMatrixWorld(true);
    let from = this.desktopGun!.muzzleWorld(new THREE.Vector3());
    const target = this.aimPoint();
    // The muzzle sits off-centre; if it can't see what the crosshair sees, shoot along the view ray.
    const wall = this.world.segmentHit(from, target);
    if (wall >= 0 && wall < 0.98) from = this.headPos.clone().addScaledVector(this.headFwd, 0.3);
    return { from, dir: target.sub(from).normalize() };
  }

  private desktopPrimary(): void {
    if (this.state === 'failed' && this.stateTimer > 1) return this.startLevel(this.levelIndex);
    if (this.state === 'won' && this.stateTimer > 1) return this.startLevel(0);
    if (!this.desktopGun) return this.desktopPunch();
    const { from, dir } = this.desktopAim();
    this.fire(this.desktopGun, dir, null, from);
  }

  private desktopThrow(): void {
    if (!this.desktopGun) return;
    const w = this.desktopGun;
    this.desktopGun = null;
    const v = this.headFwd.clone().multiplyScalar(14);
    v.y += 1.2;
    this.release(w, v, true);
    sfx.throwGun();
  }

  /** E: snatch the weapon of an enemy in reach, else pick one up from the floor. */
  private desktopTake(): void {
    const e = this.enemyInReach(1.8);
    if (e?.weapon) {
      const w = this.disarm(e);
      if (w) {
        if (this.desktopGun) {
          const old = this.desktopGun;
          this.desktopGun = null;
          this.release(old, new THREE.Vector3(0, 1, 0), false);
        }
        this.holdDesktop(w);
      }
      return;
    }
    this.desktopPickup(2.2);
  }

  private enemyInReach(range: number): Enemy | null {
    for (const e of this.enemies) {
      if (!e.alive || !e.materialized) continue;
      const to = _v1.subVectors(e.spheres[1].c, this.headPos);
      if (to.length() < range && to.normalize().dot(this.headFwd) > 0.5) return e;
    }
    return null;
  }

  private desktopPickup(radius: number): void {
    if (this.desktopGun) return;
    let best: Weapon | null = null;
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
    const e = this.enemyInReach(1.9);
    if (e) this.punch(e, this.headFwd.clone());
  }

  /** Where the crosshair points: first thing hit along the view ray. */
  private aimPoint(): THREE.Vector3 {
    const origin = this.headPos.clone();
    const far = origin.clone().addScaledVector(this.headFwd, 60);
    let best = this.world.segmentHit(origin, far);
    if (best < 0) best = 1;
    const test = (spheres: HitSphere[]) => {
      for (const s of spheres) {
        const t = segmentSphere(origin, far, s.c, s.r);
        if (t >= 0 && t < best) best = t;
      }
    };
    for (const e of this.enemies) if (e.alive) test(e.spheres);
    for (const c of this.civilians) if (c.alive && !c.gone) test(c.spheres);
    if (this.menuTarget.visible) test([{ c: this.menuTarget.position, r: 0.25 }]);
    return origin.lerp(far, best);
  }

  private aimDir(obj: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 0, -1).applyQuaternion(obj.getWorldQuaternion(_q1)).normalize();
  }

  private autoFire(w: Weapon, dir: () => THREE.Vector3, hand: Hand | null, from?: () => THREE.Vector3): void {
    if (w.cooldown > 0 || w.realCooldown > 0) return;
    this.fire(w, dir(), hand, from?.());
  }

  private fire(w: Weapon, dir: THREE.Vector3, hand: Hand | null, from?: THREE.Vector3): void {
    if (this.state !== 'playing' && this.state !== 'menu') return;
    if (!w.fire()) {
      if (w.realCooldown <= 0) sfx.empty();
      w.realCooldown = 0.25;
      return;
    }
    w.cooldown = w.spec.interval;
    w.realCooldown = 0.06;
    const d = dir.clone();
    if (w.spec.spread) {
      d.x += (Math.random() - 0.5) * w.spec.spread;
      d.y += (Math.random() - 0.5) * w.spec.spread;
      d.z += (Math.random() - 0.5) * w.spec.spread;
    }
    const origin = from ?? w.muzzleWorld(new THREE.Vector3());
    this.bullets.spawn('player', origin, d.normalize(), PLAYER_BULLET_SPEED);
    if (w.kind === 'smg') sfx.smg();
    else if (w.kind === 'revolver') sfx.revolver();
    else sfx.shoot();
    this.time.kick(w.spec.kick);
    this.triggerPanic();
    if (hand) this.haptic(hand, w.kind === 'smg' ? 0.5 : 0.8, w.kind === 'smg' ? 30 : 60);
  }

  private haptic(hand: Hand, intensity: number, ms: number): void {
    const act = hand.source?.gamepad?.hapticActuators?.[0] as unknown as { pulse?: (v: number, d: number) => void } | undefined;
    try {
      act?.pulse?.(intensity, ms);
    } catch {
      /* haptics are best-effort */
    }
  }

  private triggerPanic(): void {
    if (this.panicked || this.state !== 'playing') return;
    this.panicked = true;
    for (const c of this.civilians) c.panic(this.exits);
  }

  // ---------------------------------------------------------------- simulation

  private simulate(gdt: number, realDt: number): void {
    this.stateTimer += realDt;
    this.menuTarget.rotation.y += realDt * 0.8;
    this.menuTarget.rotation.x += realDt * 0.3;
    for (const w of this.heldWeapons()) {
      w.cooldown -= gdt;
      w.realCooldown -= realDt;
    }

    if (this.state === 'playing') {
      this.updateSpawning(gdt);
      if (this.stateTimer > 2.5) this.triggerPanic();
    }

    const ctx: EnemyContext = {
      playerHead: this.headPos,
      protectees: this.civilians.filter((c) => c.vip || c.guard),
      world: this.world,
      others: this.enemies,
      shoot: (from, dir, _w, shooter) => {
        const b = this.bullets.spawn('enemy', from, dir, ENEMY_BULLET_SPEED);
        b.ignore = shooter.hostage ?? undefined;
        if (_w.kind === 'smg') sfx.smg();
        else sfx.enemyShoot(from.distanceTo(this.headPos));
        this.triggerPanic();
      },
      strike: () => this.fail('dead'),
      coverScore: (spot) => this.coverScore(spot),
    };
    if (this.state === 'playing' || this.state === 'failed') for (const e of this.enemies) e.update(gdt, ctx);
    for (const c of this.civilians) {
      c.update(gdt, this.world);
      if (c.gone && c.fig.root.parent) this.scene.remove(c.fig.root);
    }

    this.bullets.advance(gdt);
    this.resolveBullets();
    this.bullets.sync();
    this.updateFreeGuns(gdt);
    this.shards.update(gdt);
    this.debris.update(gdt);

    if (this.state === 'playing' && !this.holdOpen && this.queue.length === 0 && this.enemies.every((e) => !e.alive)) {
      this.state = 'cleared';
      this.stateTimer = 0;
      sfx.clear();
    }
    if (this.state === 'cleared') {
      const step = Math.floor(this.stateTimer / CHANT_STEP);
      if (step < CHANT.length) {
        this.panel.show(CHANT[step], '', step % 2 ? '#19f0ff' : '#ff2bd6');
        this.snapPanel = step === 0;
      } else if (this.levelIndex + 1 < LEVELS.length) this.startLevel(this.levelIndex + 1);
      else {
        this.state = 'won';
        this.stateTimer = 0;
        this.panel.show('VICTORY', 'Pull trigger / click to play again');
      }
    }
    if (this.state === 'failed') {
      const k = Math.min(1, this.stateTimer * 2);
      (this.deathShell.material as THREE.MeshBasicMaterial).opacity = 0.45 * k;
      if (this.stateTimer > 0.8) this.panel.show(FAIL_TEXT[this.failReason ?? 'dead'], 'Pull trigger / click to retry');
    }
  }

  /** Civilians standing between this spot and the player make it attractive cover. */
  private coverScore(spot: THREE.Vector3): number {
    const from = _v1.set(spot.x, 1.45, spot.z).clone();
    let score = 0;
    for (const c of this.civilians) {
      if (!c.alive || c.gone || c.vip) continue;
      if (pointSegmentDistance(c.spheres[1].c, from, this.headPos) < 0.35) score++;
    }
    return score;
  }

  private updateSpawning(gdt: number): void {
    this.spawnTimer -= gdt;
    const alive = this.enemies.filter((e) => e.alive).length;
    if (!this.queue.length || alive >= this.level.maxAlive || this.spawnTimer > 0) return;
    const kind = this.queue[0];
    const enemy = kind === 'hostage' ? this.spawnHostageTaker() : this.spawnAtPoint(kind);
    if (!enemy) return;
    this.queue.shift();
    this.spawnTimer = 1.5;
  }

  private spawnAtPoint(kind: EnemyKind): Enemy | null {
    const candidates = this.level.spawns.filter(([x, z]) => {
      if (Math.hypot(x - this.headPos.x, z - this.headPos.z) < 5) return false;
      if (this.world.blocked(x, z, 0.4)) return false;
      return !this.enemies.some((e) => e.alive && Math.hypot(e.position.x - x, e.position.z - z) < 1);
    });
    if (!candidates.length) return null;
    // Scripted entrances first (e.g. through the kitchen), then random spawn points.
    const intro = this.level.introSpawns?.[this.introIndex];
    const scripted = intro && candidates.find(([x, z]) => x === intro[0] && z === intro[1]);
    if (intro) this.introIndex++;
    const [x, z] = scripted ?? candidates[Math.floor(Math.random() * candidates.length)];
    return this.addEnemy(kind, x, z);
  }

  /** Materialise right behind a diner and take them hostage. */
  private spawnHostageTaker(): Enemy | null {
    const options = this.civilians.filter((c) => c.free && c.state !== 'flee' && Math.hypot(c.position.x - this.headPos.x, c.position.z - this.headPos.z) > 3);
    for (const c of options.sort(() => Math.random() - 0.5)) {
      const away = _v1.set(c.position.x - this.headPos.x, 0, c.position.z - this.headPos.z).normalize();
      const x = c.position.x + away.x * 0.42;
      const z = c.position.z + away.z * 0.42;
      if (this.world.blocked(x, z, 0.3)) continue;
      const e = this.addEnemy('hostage', x, z);
      e.grab(c);
      return e;
    }
    return this.spawnAtPoint('hostage');
  }

  private addEnemy(kind: EnemyKind, x: number, z: number): Enemy {
    const e = new Enemy(kind, x, z);
    e.group.rotation.y = Math.atan2(this.headPos.x - x, this.headPos.z - z);
    this.enemies.push(e);
    this.scene.add(e.group);
    return e;
  }

  private resolveBullets(): void {
    const list = this.bullets.list;
    const held = this.heldWeapons();
    for (const b of list) {
      if (b.dead) continue;
      let best: Hit | null = null;
      const consider = (t: number, apply: () => void) => {
        if (t >= 0 && (!best || t < best.t)) best = { t, apply };
      };
      // `at` is the centre of the sphere that was hit (head, chest or legs).
      const spheres = (ss: HitSphere[], apply: (at: THREE.Vector3) => void) => {
        for (const s of ss) consider(segmentSphere(b.prev, b.pos, s.c, s.r), () => apply(s.c));
      };

      consider(this.world.segmentHit(b.prev, b.pos), () => this.spark(b, 0x8a7ab0));

      for (const c of this.civilians) {
        if (!c.alive || c.gone || c === b.ignore) continue;
        spheres(c.spheres, (at) => this.killCivilian(c, b.dir, b.owner === 'player', at));
      }

      if (b.owner === 'player') {
        for (const e of this.enemies) if (e.alive && e.materialized) spheres(e.spheres, (at) => this.killEnemy(e, b.dir, at));
        if (this.state === 'menu' && this.menuTarget.visible)
          consider(segmentSphere(b.prev, b.pos, this.menuTarget.position, 0.25), () => this.hitMenuTarget(b.dir));
        for (const o of list) {
          if (o.owner !== 'enemy' || o.dead) continue;
          consider(segmentSphere(b.prev, b.pos, o.pos, 0.12), () => {
            o.dead = true;
            this.spark(o, 0xff3344);
            sfx.ricochet();
          });
        }
      } else if (this.state === 'playing') {
        consider(segmentSphere(b.prev, b.pos, this.headPos, 0.13), () => this.fail('dead'));
        const torso = this.headPos.clone();
        torso.y -= 0.45;
        consider(segmentSphere(b.prev, b.pos, torso, 0.2), () => this.fail('dead'));
        for (const w of held) {
          consider(segmentSphere(b.prev, b.pos, w.mesh.getWorldPosition(new THREE.Vector3()), 0.09), () => {
            this.spark(b, 0x19f0ff);
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
        const hits = (ss: HitSphere[]) => ss.some((s) => segmentSphere(prev, p, s.c, s.r + 0.05) >= 0);
        const e = this.enemies.find((x) => x.alive && x.materialized && hits(x.spheres));
        const c = e ? null : this.civilians.find((x) => x.alive && !x.gone && hits(x.spheres));
        if (e) this.killEnemy(e, g.vel.clone().normalize());
        else if (c) this.killCivilian(c, g.vel.clone().normalize(), true);
        else if (this.state === 'menu' && this.menuTarget.visible && segmentSphere(prev, p, this.menuTarget.position, 0.3) >= 0)
          this.hitMenuTarget(g.vel.clone().normalize());
        if (e || c) {
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

  /** Shatter an enemy: his body breaks into its parts, the one that was hit flying hardest. */
  private killEnemy(e: Enemy, push: THREE.Vector3, at?: THREE.Vector3): void {
    if (!e.alive) return;
    e.alive = false;
    this.kills++;
    this.freeHostage(e);
    const hit = (at ?? e.spheres[1].c).clone();
    const impulse = push.clone().setY(0).normalize().multiplyScalar(3);
    this.shards.burst(hit, 18, SUIT_SHARDS, 2.5, 0.05, 0.12, impulse);
    this.shards.burst(hit, 8, RED, 2.5, 0.04, 0.1, impulse);
    const w = e.takeWeapon();
    if (w) this.release(w, new THREE.Vector3((Math.random() - 0.5) * 1.5, 2, (Math.random() - 0.5) * 1.5), false);
    this.debris.explode(e.fig, impulse, hit);
    this.scene.remove(e.group);
    sfx.shatter();
    this.time.kick(0.2);
  }

  private killCivilian(c: Civilian, push: THREE.Vector3, byPlayer: boolean, at?: THREE.Vector3): void {
    if (!c.alive) return;
    c.alive = false;
    const holder = this.enemies.find((e) => e.hostage === c);
    holder?.releaseHostage();
    const hit = (at ?? c.spheres[1].c).clone();
    const impulse = push.clone().setY(0).normalize().multiplyScalar(2.5);
    this.shards.burst(hit, 20, c.vip ? VIP_SHARDS : CIV_SHARDS, 2.2, 0.05, 0.12, impulse);
    this.debris.explode(c.fig, impulse, hit);
    this.scene.remove(c.fig.root);
    sfx.glass();
    if (c.vip) this.fail('vip');
    else if (byPlayer) this.fail('civilian');
  }

  private hitMenuTarget(push: THREE.Vector3): void {
    this.menuTarget.visible = false;
    this.shards.burst(this.menuTarget.position, 40, RED, 3, 0.05, 0.1, push.clone().multiplyScalar(2));
    sfx.shatter();
    // Let the shards fly for a moment before the level resets the scene.
    this.state = 'cleared';
    this.stateTimer = CHANT_STEP * CHANT.length - 0.6;
    this.levelIndex = -1;
    this.panel.hide();
  }

  private fail(reason: FailReason): void {
    if (this.god || this.state !== 'playing') return;
    this.state = 'failed';
    this.failReason = reason;
    this.stateTimer = 0;
    this.mouseHeld = false;
    this.deathShell.visible = true;
    const mat = this.deathShell.material as THREE.MeshBasicMaterial;
    mat.color.set(reason === 'dead' ? 0xff1a3a : reason === 'vip' ? 0xffb020 : 0x9fd8ff);
    mat.opacity = 0;
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
      return g.world.lineOfSight(g.headPos, p);
    };
    const aliveEnemies = () => g.enemies.filter((e) => e.alive);
    const liveCivilians = () => g.civilians.filter((c) => c.alive && !c.gone && !c.vip && !c.guard);
    return {
      get state() {
        return g.state;
      },
      get failReason() {
        return g.failReason;
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
      get drawCalls() {
        return g.renderer.info.render.calls;
      },
      enemies: () =>
        aliveEnemies().map((e) => ({
          kind: e.kind,
          x: e.position.x,
          z: e.position.z,
          ready: e.materialized,
          weapon: e.weapon?.kind ?? null,
          hostage: e.hostage ? liveCivilians().indexOf(e.hostage) : -1,
          staggered: e.staggered,
        })),
      civilians: () => liveCivilians().map((c) => ({ state: c.state, x: c.position.x, z: c.position.z })),
      vip: () => (g.vip ? { alive: g.vip.alive } : null),
      guards: () => g.civilians.filter((c) => c.guard).map((c) => ({ alive: c.alive, state: c.state })),
      debrisCount: () => g.debris.count,
      bulletCount: () => g.bullets.list.length,
      queued: () => g.queue.length,
      guns: () => ({
        desktop: g.desktopGun ? g.desktopGun.ammo : null,
        desktopKind: (g.desktopGun?.kind ?? null) as WeaponKind | null,
        hands: g.hands.map((h) => ({ handedness: h.handedness, ammo: h.held ? h.held.ammo : null })),
        free: g.freeGuns.length,
      }),
      startDesktop: () => g.startDesktop(false),
      startLevel: (i: number) => g.startLevel(i),
      /** Drop the scripted waves and keep the level open for hand-placed enemies. */
      clearQueue: () => {
        g.queue = [];
        g.holdOpen = true;
      },
      spawnEnemy: (kind: EnemyKind, x: number, z: number) => {
        const e = kind === 'hostage' ? g.spawnHostageTaker() : g.addEnemy(kind, x, z);
        e?.materializeNow();
        return !!e;
      },
      killEnemy: (i = 0) => {
        const e = aliveEnemies()[i];
        if (e) g.killEnemy(e, new THREE.Vector3(0, 0, -1));
      },
      setTimeScale: (v: number | null) => (g.time.override = v),
      setGodMode: (on: boolean) => (g.god = on),
      /** part: 0 head, 1 torso, 2 legs. Returns whether the view ray is clear of walls. */
      aimAtEnemy: (i = 0, part = 1) => {
        const e = aliveEnemies()[i];
        return e ? aimAt(e.spheres[part].c) : false;
      },
      aimAtCivilian: (i = 0, part = 0) => {
        const c = liveCivilians()[i];
        return c ? aimAt(c.spheres[part].c) : false;
      },
      aimAtVip: () => (g.vip ? aimAt(g.vip.spheres[1].c) : false),
      aimAtTarget: () => aimAt(g.menuTarget.position),
      fire: () => g.desktopPrimary(),
      setFiring: (on: boolean) => {
        if (on && !g.mouseHeld) g.desktopPrimary();
        g.mouseHeld = on;
      },
      takeWeapon: () => g.desktopTake(),
      throwGun: () => g.desktopThrow(),
      giveGun: () => {
        if (!g.desktopGun) g.holdDesktop(new Weapon('revolver'));
      },
      punch: () => g.desktopPunch(),
    };
  }
}
