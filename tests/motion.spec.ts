import { expect, test } from '@playwright/test';

type Bench = {
  ready: boolean;
  report: { name: string; clip: string; speed: number; slip: number; steps: number }[];
  step(dt: number): void;
  pause(on: boolean): void;
};

declare global {
  interface Window {
    __viewer: Bench;
  }
}

/** Walk or run a model across the locomotion bench and report how much the standing foot slid. */
async function bench(page: import('@playwright/test').Page, query: string) {
  await page.goto(`/viewer.html?${query}`);
  await page.waitForFunction(() => window.__viewer?.ready, null, { timeout: 60000 });
  return page.evaluate(() => {
    window.__viewer.pause(true);
    for (let i = 0; i < 40; i++) window.__viewer.step(1 / 30);
    const slips: number[] = [];
    const before = window.__viewer.report[0].steps;
    for (let i = 0; i < 60; i++) {
      window.__viewer.step(1 / 30);
      slips.push(window.__viewer.report[0].slip);
    }
    return {
      clip: window.__viewer.report[0].clip,
      steps: window.__viewer.report[0].steps - before,
      slip: slips.reduce((a, b) => a + b, 0) / slips.length,
    };
  });
}

// The generated clips drift badly on their own; Person retimes the stride and pins the standing
// foot. Without that the foot slides at roughly the speed the body travels.
test('the standing foot stays put while walking and running', async ({ page }) => {
  const walk = await bench(page, 'drive=gangster&speed=1.4&motion=walk');
  expect(walk.clip).toBe('walk');
  expect(walk.steps).toBeGreaterThan(2);
  expect(walk.slip).toBeLessThan(1.1);

  const run = await bench(page, 'drive=diner-man&speed=2.4&motion=run');
  expect(run.steps).toBeGreaterThan(2);
  expect(run.slip).toBeLessThan(1.4);

  const raw = await bench(page, 'drive=gangster&speed=1.4&motion=walk&raw=1');
  expect(raw.slip).toBeGreaterThan(walk.slip);
});

// Slow walkers must not run and sprinters must not stroll: the clip follows the travel speed.
test('the step cycle follows the speed the body travels', async ({ page }) => {
  const amble = await bench(page, 'drive=diner-man&speed=0.8&motion=run');
  expect(amble.clip).toBe('walk');
  const dash = await bench(page, 'drive=diner-man&speed=3.2&motion=walk');
  expect(dash.clip).toBe('run');
});
