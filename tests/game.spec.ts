import { expect, test, type Page } from '@playwright/test';

type Api = {
  state: string;
  failReason: string | null;
  mode: string;
  level: number;
  timeScale: number;
  kills: number;
  frame: number;
  presenting: boolean;
  panelText: string;
  drawCalls: number;
  enemies(): { kind: string; x: number; z: number; ready: boolean; weapon: string | null; hostage: number; staggered: boolean }[];
  civilians(): { state: string; x: number; z: number }[];
  vip(): { alive: boolean } | null;
  bulletCount(): number;
  queued(): number;
  guns(): { desktop: number | null; desktopKind: string | null; hands: { handedness: string; ammo: number | null }[]; free: number };
  startDesktop(): void;
  startLevel(i: number): void;
  clearQueue(): void;
  spawnEnemy(kind: string, x?: number, z?: number): boolean;
  killEnemy(i?: number): void;
  setTimeScale(v: number | null): void;
  setGodMode(on: boolean): void;
  aimAtEnemy(i?: number, part?: number): boolean;
  aimAtCivilian(i?: number, part?: number): boolean;
  aimAtVip(): boolean;
  aimAtTarget(): void;
  fire(): void;
  setFiring(on: boolean): void;
  takeWeapon(): void;
  throwGun(): void;
  giveGun(): void;
  punch(): void;
};

declare global {
  interface Window {
    __game: Api;
    __xrDevice: {
      position: { x: number; y: number; z: number; set(x: number, y: number, z: number): void };
      controllers: Record<string, { position: { set(x: number, y: number, z: number): void }; updateButtonValue(id: string, v: number): void }>;
    };
  }
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

/** Load the page, switch to desktop mode and start the restaurant with no scripted waves. */
async function restaurant(page: Page, opts: { god?: boolean; timeScale?: number | null } = {}): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__game && window.__game.frame > 5);
  await page.evaluate(({ god, timeScale }) => {
    const g = window.__game;
    g.startDesktop();
    g.startLevel(0);
    g.clearQueue();
    g.setGodMode(!!god);
    g.setTimeScale(timeScale ?? null);
  }, opts);
  await page.waitForFunction(() => window.__game.guns().desktop === 6);
}

test('desktop: menu → restaurant → kill an enemy', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__game && window.__game.frame > 5);
  expect(await page.evaluate(() => window.__game.state)).toBe('menu');

  await page.click('#play-desktop');
  await page.waitForFunction(() => window.__game.mode === 'desktop' && window.__game.guns().desktop === 6);

  // Shooting the red crystal starts level 1: the restaurant.
  await page.evaluate(() => {
    window.__game.aimAtTarget();
    window.__game.fire();
  });
  await page.waitForFunction(() => window.__game.state === 'playing' && window.__game.level === 0, null, { timeout: 15_000 });
  expect(await page.evaluate(() => window.__game.vip()?.alive)).toBe(true);
  expect(await page.evaluate(() => window.__game.civilians().length)).toBe(8);

  // Standing still, time is almost frozen.
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__game.timeScale)).toBeLessThan(0.1);

  // A gunner in the clear, straight ahead: one headshot.
  await page.evaluate(() => {
    const g = window.__game;
    g.clearQueue();
    g.setTimeScale(1);
    g.spawnEnemy('gunner', 0, -4.8);
    g.aimAtEnemy(0, 0);
    g.fire();
  });
  await page.waitForFunction(() => window.__game.kills >= 1, null, { timeout: 5_000 });
  expect(await page.evaluate(() => window.__game.guns().desktop)).toBe(5);
  expect(await page.evaluate(() => window.__game.state)).toBe('playing');

  await page.screenshot({ path: 'test-results/desktop.png' });
  expect(errors).toEqual([]);
});

test('desktop: snatch an SMG from an enemy and fire full-auto', async ({ page }) => {
  const errors = collectErrors(page);
  await restaurant(page, { god: true, timeScale: 1 });
  await page.evaluate(() => {
    const g = window.__game;
    g.spawnEnemy('rifleman', -1.2, 0.6);
    g.aimAtEnemy(0, 1);
    g.takeWeapon();
  });
  const after = await page.evaluate(() => ({ gun: window.__game.guns(), enemy: window.__game.enemies()[0] }));
  expect(after.gun.desktopKind).toBe('smg');
  expect(after.enemy.weapon).toBeNull();

  const before = after.gun.desktop!;
  await page.evaluate(() => window.__game.setFiring(true));
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__game.setFiring(false));
  const left = await page.evaluate(() => window.__game.guns().desktop!);
  expect(before - left).toBeGreaterThanOrEqual(Math.min(5, before));
  expect(errors).toEqual([]);
});

test('shooting a civilian fails the level', async ({ page }) => {
  await restaurant(page, { timeScale: 1 });
  const aimed = await page.evaluate(() => {
    const g = window.__game;
    for (let i = 0; i < g.civilians().length; i++) {
      if (g.aimAtCivilian(i, 0)) {
        g.fire();
        return true;
      }
    }
    return false;
  });
  expect(aimed).toBe(true);
  await page.waitForFunction(() => window.__game.state === 'failed', null, { timeout: 5_000 });
  expect(await page.evaluate(() => window.__game.failReason)).toBe('civilian');
  await page.waitForFunction(() => window.__game.panelText.includes('CIVILIAN DOWN'), null, { timeout: 5_000 });
});

test('the boss lies on the floor, and hitting him fails the level', async ({ page }) => {
  await restaurant(page, { timeScale: 1 });
  expect(await page.evaluate(() => window.__game.aimAtVip())).toBe(true);
  await page.evaluate(() => window.__game.fire());
  await page.waitForFunction(() => window.__game.state === 'failed', null, { timeout: 5_000 });
  expect(await page.evaluate(() => window.__game.failReason)).toBe('vip');
  expect(await page.evaluate(() => window.__game.vip()?.alive)).toBe(false);
});

test('a hostage-taker hides behind a diner; killing him frees them', async ({ page }) => {
  await restaurant(page, { god: true, timeScale: 1 });
  await page.evaluate(() => window.__game.spawnEnemy('hostage'));
  const held = await page.evaluate(() => ({ enemy: window.__game.enemies()[0], civ: window.__game.civilians() }));
  expect(held.enemy.kind).toBe('hostage');
  expect(held.enemy.hostage).toBeGreaterThanOrEqual(0);
  expect(held.civ[held.enemy.hostage].state).toBe('held');

  await page.evaluate(() => window.__game.killEnemy(0));
  const freed = await page.evaluate(() => window.__game.civilians());
  expect(freed.some((c) => c.state === 'held')).toBe(false);
  expect(freed[held.enemy.hostage].state).toBe('flee');
});

test('restaurant stays under the Quest draw-call budget', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__game && window.__game.frame > 5);
  await page.evaluate(() => {
    const g = window.__game;
    g.startDesktop();
    g.setGodMode(true);
    g.startLevel(0);
    g.setTimeScale(1);
  });
  await page.waitForFunction(() => window.__game.enemies().filter((e) => e.ready).length >= 3, null, { timeout: 20_000 });
  await page.waitForTimeout(300);
  const calls = await page.evaluate(() => window.__game.drawCalls);
  console.log('restaurant draw calls:', calls);
  expect(calls).toBeLessThan(150);
});

test('desktop: the final level can be won', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__game && window.__game.frame > 5);
  await page.evaluate(() => {
    window.__game.startDesktop();
    window.__game.setGodMode(true);
    window.__game.setTimeScale(1);
    window.__game.startLevel(4);
  });
  // Auto-aim and shoot through the final level; an empty gun gets thrown and replaced.
  await page.evaluate(async () => {
    const api = window.__game;
    const until = performance.now() + 70_000;
    let n = 0;
    while (api.state === 'playing' && performance.now() < until) {
      const count = Math.max(1, api.enemies().length);
      // Cycle through enemies and body parts: a pillar or a hostage may hide a torso but not a head.
      if (api.aimAtEnemy(n % count, Math.floor(n / count) % 3) || api.enemies().length) {
        n++;
        if (api.guns().desktop === 0) {
          api.throwGun();
          api.giveGun();
        }
        api.fire();
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  });
  await page.waitForFunction(() => window.__game.state === 'won', null, { timeout: 15_000 });
  expect(errors).toEqual([]);
});

test('vr (emulated Quest 3): enter VR, gun in right hand, time follows head movement', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?emu&noui');
  await page.waitForFunction(() => window.__game && window.__game.frame > 5);
  const button = page.locator('#VRButton');
  await expect(button).toHaveText(/ENTER VR/i, { timeout: 10_000 });
  await button.click();
  await page.waitForFunction(() => window.__game.presenting && window.__game.mode === 'vr', null, { timeout: 10_000 });
  await page.waitForFunction(() => window.__game.guns().hands.some((h) => h.handedness === 'right' && h.ammo === 6), null, {
    timeout: 10_000,
  });

  // Start the restaurant and hold still: time should crawl.
  await page.evaluate(() => {
    window.__game.startLevel(0);
    window.__game.setGodMode(true);
  });
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__game.timeScale)).toBeLessThan(0.1);

  // Sway the headset: time should speed up.
  const peak = await page.evaluate(async () => {
    const dev = window.__xrDevice;
    let best = 0;
    for (let i = 0; i < 40; i++) {
      dev.position.set(Math.sin(i / 6) * 0.6, 1.65, 1.3);
      await new Promise((r) => requestAnimationFrame(r));
      best = Math.max(best, window.__game.timeScale);
    }
    return best;
  });
  expect(peak).toBeGreaterThan(0.5);

  // Right trigger fires a bullet.
  await page.evaluate(async () => {
    const r = window.__xrDevice.controllers.right;
    r.updateButtonValue('trigger', 1);
    for (let i = 0; i < 3; i++) await new Promise((res) => requestAnimationFrame(res));
    r.updateButtonValue('trigger', 0);
    for (let i = 0; i < 3; i++) await new Promise((res) => requestAnimationFrame(res));
  });
  await page.waitForFunction(() => window.__game.guns().hands.some((h) => h.ammo === 5), null, { timeout: 5_000 });

  await page.screenshot({ path: 'test-results/vr.png' });
  expect(errors).toEqual([]);
});
