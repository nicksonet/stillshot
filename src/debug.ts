import * as THREE from 'three';
import type { Game } from './game';
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
