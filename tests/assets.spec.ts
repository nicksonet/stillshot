import { test } from '@playwright/test';

declare const process: { env: Record<string, string | undefined> };
// Asset review: SHOTS=1 FILES=assets/glb/a.glb,assets/glb/b.glb npx playwright test tests/assets.spec.ts
// People and poses:  SHOTS=1 QUERY="people=gangster,boss&pose=seated" npx playwright test tests/assets.spec.ts
test.skip(!process.env.SHOTS || !(process.env.FILES || process.env.QUERY), 'set SHOTS=1 and FILES=... or QUERY=...');

test('asset lineup', async ({ page }) => {
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  const anim = process.env.ANIM ? `&anim=${process.env.ANIM}` : '';
  const query = process.env.QUERY ?? `files=${process.env.FILES}${anim}`;
  await page.goto(`/viewer.html?${query}`);
  await page.waitForFunction(() => (window as any).__viewer?.ready, null, { timeout: 60000 });
  await page.waitForTimeout(Number(process.env.WAIT ?? 300));
  console.log(JSON.stringify(await page.evaluate(() => (window as any).__viewer.report), null, 1));
  await page.screenshot({ path: `shots/${process.env.OUT ?? 'assets'}.png` });
});
