import * as THREE from 'three';
import type { Game } from './game';
import { personClipSpeeds } from './person';
import type { EnemyKind } from './levels';
import type { WeaponKind } from './weapons';

/** window.__game: read game state and drive it from tests, the proof-video bot and the console. */
export function createDebugApi(g: Game) {
  const aimAt = (p: THREE.Vector3) => {
    g.desktop.lookAt(p);
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
      return g.combat.kills;
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
    /** WebGL renderer string (to spot software rendering in captures). */
    get gpu() {
      const gl = g.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
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
    debrisCount: () => g.combat.debris.count,
    bulletCount: () => g.combat.bullets.list.length,
    queued: () => g.spawner.queue.length,
    guns: () => ({
      desktop: g.desktop.gun ? g.desktop.gun.ammo : null,
      desktopKind: (g.desktop.gun?.kind ?? null) as WeaponKind | null,
      hands: g.vr.hands.map((h) => ({ handedness: h.handedness, ammo: h.held ? h.held.ammo : null })),
      free: g.combat.freeGuns.length,
    }),
    startDesktop: () => g.startDesktop(false),
    startLevel: (i: number) => g.startLevel(i),
    /** Drop the scripted waves and keep the level open for hand-placed enemies. */
    clearQueue: () => {
      g.spawner.queue = [];
      g.spawner.holdOpen = true;
    },
    spawnEnemy: (kind: EnemyKind, x: number, z: number) => {
      const e = kind === 'hostage' ? g.spawner.spawnHostageTaker() : g.spawner.add(kind, x, z);
      e?.materializeNow();
      return !!e;
    },
    killEnemy: (i = 0) => {
      const e = aliveEnemies()[i];
      if (e) g.combat.killEnemy(e, new THREE.Vector3(0, 0, -1));
    },
    /** Measured stride speeds of every loaded clip (m/s). */
    clipSpeeds: () => personClipSpeeds(),
    /** Per-person motion telemetry, to read frame captures against numbers. */
    motion: () => ({
      enemies: aliveEnemies().map((e) => ({
        kind: e.kind,
        clip: e.body.motion,
        speed: +e.body.groundSpeed.toFixed(2),
        drift: +e.body.driftAngle.toFixed(2),
        slip: +e.body.footSlip.toFixed(2),
        steps: e.body.steps,
        drive: +e.body.swingDrive.toFixed(2),
        turn: +e.body.turn.toFixed(2),
        yaw: +e.body.root.rotation.y.toFixed(2),
      })),
      civilians: liveCivilians().map((c) => ({
        state: c.state,
        clip: c.body.motion,
        speed: +c.body.groundSpeed.toFixed(2),
        drift: +c.body.driftAngle.toFixed(2),
        slip: +c.body.footSlip.toFixed(2),
        drive: +c.body.swingDrive.toFixed(2),
      })),
    }),
    /** Put the viewpoint somewhere and look at a point (motion capture, demo shots). */
    setCamera: (x: number, y: number, z: number, tx: number, ty: number, tz: number) => {
      g.rig.position.set(x, y - 1.65, z);
      g.updateHead();
      g.desktop.lookAt(new THREE.Vector3(tx, ty, tz));
      g.updateHead();
    },
    /** Camera parked at a spot, keeping its eye on a person (motion capture). */
    watch: (who: 'enemy' | 'civilian', i: number, x: number, y: number, z: number) => {
      const p = who === 'enemy' ? aliveEnemies()[i]?.spheres[1].c : liveCivilians()[i]?.spheres[1].c;
      if (!p) return false;
      g.rig.position.set(x, y - 1.65, z);
      g.updateHead();
      g.desktop.lookAt(p.clone());
      g.updateHead();
      return true;
    },
    /** Camera at a fixed offset from a person, looking at their chest (motion capture). */
    follow: (who: 'enemy' | 'civilian', i: number, dx: number, dy: number, dz: number) => {
      const p = who === 'enemy' ? aliveEnemies()[i]?.spheres[1].c : liveCivilians()[i]?.spheres[1].c;
      if (!p) return false;
      g.rig.position.set(p.x + dx, dy - 1.65, p.z + dz);
      g.updateHead();
      g.desktop.lookAt(p.clone());
      g.updateHead();
      return true;
    },
    setTimeScale: (v: number | null) => (g.time.override = v),
    /** Step every frame by a fixed amount of seconds, so captures sample even slices of motion. */
    setFixedDt: (v: number | null) => (g.fixedDt = v),
    setPaused: (on: boolean) => (g.paused = on),
    panic: () => g.triggerPanic(),
    step: (dt: number) => g.stepOnce(dt),
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
    fire: () => g.desktop.primary(),
    setFiring: (on: boolean) => {
      if (on && !g.desktop.firing) g.desktop.primary();
      g.desktop.firing = on;
    },
    takeWeapon: () => g.desktop.take(),
    throwGun: () => g.desktop.throwGun(),
    giveGun: () => g.desktop.ensureGun(),
    punch: () => g.desktop.punch(),
  };
}
