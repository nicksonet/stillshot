import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { ambience, initAudio, sfx } from './audio';
import { Civilian } from './civilian';
import { Combat, RED } from './combat';
import { createDebugApi } from './debug';
import type { Enemy, EnemyContext } from './enemy';
import { DesktopInput } from './input/desktop';
import { VRInput } from './input/vr';
import { LEVELS, type LevelDef } from './levels';
import { Music } from './music';
import { BlobShadows } from './shadows';
import { Spawner } from './spawner';
import { TextPanel } from './text';
import { THEMES } from './theme';
import { TimeController } from './time';
import { Weapon } from './weapons';
import { World } from './world';

export type State = 'menu' | 'playing' | 'failed' | 'cleared' | 'won';
export type Mode = 'none' | 'desktop' | 'vr';
export type FailReason = 'dead' | 'civilian' | 'vip';

const EYE_HEIGHT = 1.65;
const CHANT = ['STILL', 'SHOT', 'STILL', 'SHOT', 'STILL', 'SHOT'];
const CHANT_STEP = 0.55;

const FAIL_TEXT: Record<FailReason, string> = {
  dead: 'YOU DIED',
  civilian: 'CIVILIAN DOWN',
  vip: 'THE BOSS IS DEAD',
};

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/** Distance from point p to segment a-b. */
function pointSegmentDistance(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = _v1.subVectors(b, a);
  const t = THREE.MathUtils.clamp(_v2.subVectors(p, a).dot(ab) / Math.max(1e-9, ab.lengthSq()), 0, 1);
  return _v2.copy(a).addScaledVector(ab, t).distanceTo(p);
}

/**
 * The game session: owns the scene, the level state machine and the frame loop.
 * Shooting and deaths live in Combat, controls in VRInput / DesktopInput, waves in Spawner.
 */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly rig = new THREE.Group();
  readonly world: World;
  readonly panel: TextPanel;
  readonly time = new TimeController();
  readonly combat: Combat;
  readonly spawner: Spawner;
  readonly vr: VRInput;
  readonly desktop: DesktopInput;
  readonly menuTarget: THREE.Mesh;

  state: State = 'menu';
  failReason: FailReason | null = null;
  mode: Mode = 'none';
  paused = false;
  levelIndex = 0;
  enemies: Enemy[] = [];
  civilians: Civilian[] = [];
  vip: Civilian | null = null;
  exits: THREE.Vector3[] = [];
  frameCount = 0;
  /** Debug: nothing can fail the level. */
  god = false;
  readonly headPos = new THREE.Vector3();
  readonly headFwd = new THREE.Vector3();

  private music = new Music();
  private shadows: BlobShadows;
  private timer = new THREE.Timer();
  private stateTimer = 0;
  private panelTimer = 0;
  private pendingGun = true;
  private panicked = false;
  private snapPanel = true;
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
    this.panel = new TextPanel(this.scene);
    this.combat = new Combat(this);
    this.shadows = new BlobShadows(this.scene);
    this.spawner = new Spawner(this);
    this.vr = new VRInput(this);
    this.desktop = new DesktopInput(this);

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

    this.setupVR();
    this.enterMenu();

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
    this.renderer.setAnimationLoop(() => this.frame());
  }

  debugApi() {
    return createDebugApi(this);
  }

  // ---------------------------------------------------------------- modes

  private setupVR(): void {
    const button = VRButton.createButton(this.renderer);
    document.getElementById('vr-slot')?.appendChild(button);
    this.renderer.xr.addEventListener('sessionstart', () => {
      initAudio();
      this.mode = 'vr';
      this.paused = false;
      this.overlay.classList.add('hidden');
      document.body.classList.remove('desktop');
      this.desktop.removeGun();
      this.vr.resetMotion();
      this.pendingGun = true;
      if (this.state !== 'playing') this.enterMenu();
    });
    this.renderer.xr.addEventListener('sessionend', () => {
      this.mode = 'none';
      this.vr.dropAll();
      this.camera.position.set(0, EYE_HEIGHT, 0);
      this.camera.quaternion.identity();
      this.desktop.applyView();
      this.overlay.classList.remove('hidden');
      this.enterMenu();
    });
  }

  startDesktop(lock: boolean): void {
    initAudio();
    this.mode = 'desktop';
    this.paused = false;
    this.overlay.classList.add('hidden');
    document.body.classList.add('desktop');
    if (lock) this.desktop.lockPointer();
    this.pendingGun = true;
  }

  /** Desktop lost pointer lock: show the overlay and freeze. */
  pause(): void {
    this.paused = true;
    this.overlay.classList.remove('hidden');
  }

  // ---------------------------------------------------------------- level state

  get level(): LevelDef {
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
    this.spawner.reset(LEVELS[i].waves);
    this.state = 'playing';
    this.stateTimer = 0;
    this.time.reset();
    this.menuTarget.visible = false;
    const { name, brief } = LEVELS[i];
    this.panel.show(`LEVEL ${i + 1} / ${LEVELS.length}`, brief ? `${name} — ${brief}` : name);
    this.panelTimer = 2.5;
    ambience(LEVELS[i].theme === 'restaurant' ? 1 : 0.5);
  }

  /** After a fail or a win, the trigger / click starts again. Returns true if it did. */
  restartIfOver(): boolean {
    if (this.stateTimer <= 1) return false;
    if (this.state === 'failed') this.startLevel(this.levelIndex);
    else if (this.state === 'won') this.startLevel(0);
    else return false;
    return true;
  }

  /** Reset everything dynamic and build the level's static scene, diners, boss and guards. */
  private loadLevel(level: LevelDef): void {
    this.clearDynamic();
    this.world.load(level);
    this.panel.style = THEMES[level.theme].style === 'clay' ? 'flat' : 'neon';
    this.exits = level.exits.map(([x, z]) => new THREE.Vector3(x, 0, z));
    for (const [x, z, rot, pose] of level.civilians) this.addCivilian(new Civilian(x, z, rot, pose));
    if (level.vip) {
      const [x, z, rot] = level.vip;
      this.vip = new Civilian(x, z, rot, 'prone', 'vip');
      this.addCivilian(this.vip);
    }
    for (const [x, z, rot] of level.guards ?? []) this.addCivilian(new Civilian(x, z, rot, 'kneel', 'guard'));
    this.spawner.reset([]);
    this.panicked = false;
    this.failReason = null;
    this.rig.position.set(level.playerStart[0], 0, level.playerStart[1]);
    this.rig.rotation.set(0, 0, 0);
    this.desktop.resetView();
    this.vr.resetMotion();
    this.deathShell.visible = false;
    this.snapPanel = true;
    this.pendingGun = true;
  }

  private addCivilian(c: Civilian): void {
    this.civilians.push(c);
    this.scene.add(c.fig.root);
  }

  private clearDynamic(): void {
    for (const e of this.enemies) this.scene.remove(e.group);
    this.enemies = [];
    for (const c of this.civilians) this.scene.remove(c.fig.root);
    this.civilians = [];
    this.vip = null;
    this.vr.clear();
    this.desktop.removeGun();
    this.desktop.firing = false;
    this.combat.clear();
  }

  private giveStartGun(): boolean {
    if (this.mode === 'desktop') {
      this.desktop.ensureGun();
      return true;
    }
    return this.mode === 'vr' && this.vr.giveStartGun();
  }

  heldWeapons(): Weapon[] {
    const guns = this.vr.heldWeapons();
    if (this.desktop.gun) guns.push(this.desktop.gun);
    return guns;
  }

  // ---------------------------------------------------------------- loop

  private frame(): void {
    this.timer.update();
    const realDt = Math.max(1e-4, Math.min(this.timer.getDelta(), 0.05));
    this.frameCount++;

    if (!this.paused && this.mode !== 'none') {
      this.updateHead();
      if (this.pendingGun && this.giveStartGun()) this.pendingGun = false;
      const motion = this.mode === 'vr' ? this.vr.update(realDt) : this.desktop.update(realDt);
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

  updateHead(): void {
    this.camera.getWorldPosition(this.headPos);
    this.camera.getWorldDirection(this.headFwd);
  }

  private simulate(gdt: number, realDt: number): void {
    this.stateTimer += realDt;
    this.menuTarget.rotation.y += realDt * 0.8;
    this.menuTarget.rotation.x += realDt * 0.3;

    if (this.state === 'playing') {
      this.spawner.update(gdt);
      if (this.stateTimer > 2.5) this.triggerPanic();
    }

    const ctx: EnemyContext = {
      playerHead: this.headPos,
      protectees: this.civilians.filter((c) => c.vip || c.guard),
      world: this.world,
      others: this.enemies,
      shoot: (from, dir, w, shooter) => this.combat.enemyShoot(from, dir, w, shooter),
      strike: () => this.fail('dead'),
      coverScore: (spot) => this.coverScore(spot),
    };
    if (this.state === 'playing' || this.state === 'failed') for (const e of this.enemies) e.update(gdt, ctx);
    for (const c of this.civilians) {
      c.update(gdt, this.world);
      if (c.gone && c.fig.root.parent) this.scene.remove(c.fig.root);
    }
    this.combat.update(gdt, realDt);
    this.shadows.update([
      ...this.enemies.filter((e) => e.alive).map((e) => ({ fig: e.fig })),
      ...this.civilians.filter((c) => c.alive && !c.gone).map((c) => ({ fig: c.fig, lying: c.state === 'prone' })),
    ]);

    if (this.state === 'playing' && this.spawner.done) {
      this.state = 'cleared';
      this.stateTimer = 0;
      sfx.clear();
    }
    if (this.state === 'cleared') this.chant();
    if (this.state === 'failed') {
      const k = Math.min(1, this.stateTimer * 2);
      (this.deathShell.material as THREE.MeshBasicMaterial).opacity = 0.45 * k;
      if (this.stateTimer > 0.8) this.panel.show(FAIL_TEXT[this.failReason ?? 'dead'], 'Pull trigger / click to retry');
    }
  }

  /** "STILL. SHOT." between levels, then the next level or victory. */
  private chant(): void {
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

  /** Civilians standing between this spot and the player make it attractive cover. */
  private coverScore(spot: THREE.Vector3): number {
    const from = new THREE.Vector3(spot.x, 1.45, spot.z);
    let score = 0;
    for (const c of this.civilians) {
      if (!c.alive || c.gone || c.vip) continue;
      if (pointSegmentDistance(c.spheres[1].c, from, this.headPos) < 0.35) score++;
    }
    return score;
  }

  /** First gunfire: diners duck or run. */
  triggerPanic(): void {
    if (this.panicked || this.state !== 'playing') return;
    this.panicked = true;
    for (const c of this.civilians) c.panic(this.exits);
  }

  hitMenuTarget(push: THREE.Vector3): void {
    this.menuTarget.visible = false;
    this.combat.shards.burst(this.menuTarget.position, 40, RED, 3, 0.05, 0.1, push.clone().multiplyScalar(2));
    sfx.shatter();
    // Let the shards fly for a moment before the level resets the scene.
    this.state = 'cleared';
    this.stateTimer = CHANT_STEP * CHANT.length - 0.6;
    this.levelIndex = -1;
    this.panel.hide();
  }

  fail(reason: FailReason): void {
    if (this.god || this.state !== 'playing') return;
    this.state = 'failed';
    this.failReason = reason;
    this.stateTimer = 0;
    this.desktop.firing = false;
    this.deathShell.visible = true;
    const mat = this.deathShell.material as THREE.MeshBasicMaterial;
    mat.color.set(reason === 'dead' ? 0xff1a3a : reason === 'vip' ? 0xffb020 : 0x9fd8ff);
    mat.opacity = 0;
    this.panel.hide();
    sfx.death();
    this.vr.hapticAll(1, 300);
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
}
