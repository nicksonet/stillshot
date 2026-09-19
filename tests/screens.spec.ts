import { test } from '@playwright/test';

declare const process: { env: Record<string, string | undefined> };

// Screenshot tour for visual review: `SHOTS=1 npx playwright test tests/screens.spec.ts` (skipped in the normal run).
test.skip(!process.env.SHOTS, 'set SHOTS=1 to capture screenshots');

test('screenshot tour', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__game?.frame > 5);
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/shot-overlay.png' });
  await page.evaluate(() => (window as any).__game.startDesktop());
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/shot-menu.png' });

  // Close-ups: a rifleman and a gunner standing in front of the player.
  await page.evaluate(() => {
    const g = (window as any).__game;
    g.setGodMode(true);
    g.startLevel(0);
    g.clearQueue();
    g.setTimeScale(0);
    g.spawnEnemy('rifleman', 0.7, -1.9);
    g.spawnEnemy('gunner', -0.8, -2.3);
    g.aimAtEnemy(0, 1);
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/shot-enemies.png' });
  await page.evaluate(() => (window as any).__game.aimAtVip());
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test-results/shot-vip.png' });

  // The level running for a few seconds: panic, hostages, cover.
  await page.evaluate(() => {
    const g = (window as any).__game;
    g.startLevel(0);
    g.setTimeScale(1);
  });
  await page.waitForTimeout(6000);
  await page.evaluate(() => (window as any).__game.setTimeScale(0.02));
  await page.screenshot({ path: 'test-results/shot-level.png' });
  await page.evaluate(() => {
    const g = (window as any).__game;
    const i = g.enemies().findIndex((e: any) => e.hostage >= 0);
    g.aimAtEnemy(Math.max(0, i), 1);
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test-results/shot-hostage.png' });

  for (const [i, name] of [
    [1, 'alley'],
    [4, 'club'],
  ] as const) {
    await page.evaluate((lvl) => {
      const g = (window as any).__game;
      g.startLevel(lvl);
      g.setTimeScale(1);
    }, i);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `test-results/shot-${name}.png` });
  }
  console.log('errors', JSON.stringify(errors));
});
