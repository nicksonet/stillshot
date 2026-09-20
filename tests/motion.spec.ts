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

/** Walk or run a model across the locomotion bench and report the stepping and the sliding. */
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

// The walk is built from the speed, not played back: whoever is moving takes real steps and the
// foot they stand on stays where it landed. The generated clips slide instead (`raw=1`).
test('walking and running take steps without sliding', async ({ page }) => {
  const walk = await bench(page, 'drive=gangster&speed=1.4&motion=walk');
  expect(walk.steps).toBeGreaterThan(2);
  expect(walk.slip).toBeLessThan(0.6);

  const run = await bench(page, 'drive=diner-man&speed=2.6&motion=run');
  expect(run.steps).toBeGreaterThan(3);
  expect(run.slip).toBeLessThan(0.6);

  const raw = await bench(page, 'drive=gangster&speed=1.4&motion=walk&raw=1');
  expect(raw.slip).toBeGreaterThan(walk.slip * 2);
});

// Faster feet: a walk at speed takes more steps in the same time than a stroll.
test('the step cycle keeps up with the speed', async ({ page }) => {
  const stroll = await bench(page, 'drive=diner-man&speed=0.9&motion=walk');
  const hurry = await bench(page, 'drive=diner-man&speed=2.8&motion=run');
  expect(hurry.steps).toBeGreaterThan(stroll.steps);
});

// With the built walk switched off, the clips are at least picked by speed (walk under, run over).
test('the clip fallback picks walk or run by speed', async ({ page }) => {
  const amble = await bench(page, 'drive=diner-man&speed=0.8&motion=run&gait=0');
  expect(amble.clip).toBe('walk');
  const dash = await bench(page, 'drive=diner-man&speed=3.2&motion=walk&gait=0');
  expect(dash.clip).toBe('run');
});
