import { expect, test, type Page } from '@playwright/test';

type Api = {
  state: string;
  mode: string;
  level: number;
  timeScale: number;
  kills: number;
  frame: number;
  presenting: boolean;
  panelText: string;
  enemies(): { kind: string; x: number; z: number; ready: boolean }[];
  bulletCount(): number;
  queued(): number;
  guns(): { desktop: number | null; hands: { handedness: string; ammo: number | null }[]; free: number };
  startDesktop(): void;
  startLevel(i: number): void;
  setTimeScale(v: number | null): void;
  setGodMode(on: boolean): void;
  aimAtEnemy(i?: number, part?: number): boolean;
  aimAtTarget(): void;
  fire(): void;
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

test('desktop: menu → level → kill an enemy', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__game && window.__game.frame > 5);
  expect(await page.evaluate(() => window.__game.state)).toBe('menu');

  await page.click('#play-desktop');
  await page.waitForFunction(() => window.__game.mode === 'desktop' && window.__game.guns().desktop === 6);

  // Shooting the red crystal starts level 1.
  await page.evaluate(() => {
    window.__game.aimAtTarget();
    window.__game.fire();
  });
  await page.waitForFunction(() => window.__game.state === 'playing' && window.__game.level === 0, null, { timeout: 15_000 });

  // Standing still, time is almost frozen.
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__game.timeScale)).toBeLessThan(0.1);

  // Let time run so enemies can spawn, then shoot one.
  await page.evaluate(() => {
    window.__game.setGodMode(true);
    window.__game.setTimeScale(1);
  });
  await page.waitForFunction(() => window.__game.enemies().some((e) => e.ready), null, { timeout: 20_000 });
  // An enemy may be behind a pillar, so keep shooting (cycling targets) until one shatters.
  const shots = await page.evaluate(async () => {
    const api = window.__game;
    let shots = 0;
    while (api.kills < 1 && shots < 6) {
      if (api.aimAtEnemy(shots % Math.max(1, api.enemies().length))) {
        api.fire();
        shots++;
      }
      await new Promise((r) => setTimeout(r, 700));
    }
    return shots;
  });
  await page.waitForFunction(() => window.__game.kills >= 1, null, { timeout: 5_000 });
  // Each level starts with a fresh 6-round pistol.
  expect(await page.evaluate(() => window.__game.guns().desktop)).toBe(6 - shots);

  await page.screenshot({ path: 'test-results/desktop.png' });
  expect(errors).toEqual([]);
});

test('desktop: clearing all levels wins the game', async ({ page }) => {
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
    const until = performance.now() + 60_000;
    let n = 0;
    while (api.state === 'playing' && performance.now() < until) {
      const count = Math.max(1, api.enemies().length);
      // Cycle through enemies and body parts: a pillar may hide a torso but not a head.
      if (api.aimAtEnemy(n % count, Math.floor(n / count) % 3)) {
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
  const snapshot = await page.evaluate(() => ({
    state: window.__game.state,
    queued: window.__game.queued(),
    enemies: window.__game.enemies(),
    kills: window.__game.kills,
  }));
  console.log('final-level snapshot', JSON.stringify(snapshot));
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

  // Start a level and hold still: time should crawl.
  await page.evaluate(() => window.__game.startLevel(0));
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__game.timeScale)).toBeLessThan(0.1);

  // Walk the headset sideways: time should speed up.
  const peak = await page.evaluate(async () => {
    const dev = window.__xrDevice;
    let best = 0;
    for (let i = 0; i < 40; i++) {
      dev.position.set(Math.sin(i / 6) * 0.6, 1.65, 0);
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
