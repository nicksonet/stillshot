#!/usr/bin/env node
// Proof of play (godogen loop): run the real game, let a bot play it, record video.
//
//   npm run proof                       -> level 1 (restaurant), 18 s
//   npm run proof -- --level 4 --seconds 20 --url https://localhost:5173
//
// Writes proof/proof.mp4, proof/sheet.png (one frame per second, for review) and
// proof/report.json (GPU string, kills, state, draw calls, console errors).
import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const URL_ = args.url ?? 'https://localhost:5173';
const LEVEL = Number(args.level ?? 0);
const SECONDS = Number(args.seconds ?? 18);
const OUT = resolve('proof');

async function reachable(url) {
  try {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    const r = await fetch(url);
    return r.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await reachable(URL_)) return null;
  console.error(`[proof] starting dev server for ${URL_}`);
  const child = spawn('npx', ['vite'], { shell: true, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await reachable(URL_)) return child;
  }
  child.kill();
  throw new Error('dev server did not start');
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, 'raw'), { recursive: true });
  const server = await ensureServer();

  // Ask for the real GPU: headless Chrome otherwise falls back to SwiftShader.
  const browser = await chromium.launch({
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: join(OUT, 'raw'), size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(URL_);
  await page.waitForFunction(() => window.__game && window.__game.frame > 10, null, { timeout: 30000 });
  const gpu = await page.evaluate(() => window.__game.gpu);
  if (/swiftshader|llvmpipe|lavapipe/i.test(gpu)) console.error(`[proof] WARNING: software rendering (${gpu})`);

  await page.evaluate((lvl) => {
    const g = window.__game;
    g.startDesktop();
    g.setGodMode(true);
    g.startLevel(lvl);
  }, LEVEL);

  // The bot: strafe (which makes time run), turn to the nearest enemy, shoot; keep a gun in hand.
  const until = Date.now() + SECONDS * 1000;
  let step = 0;
  while (Date.now() < until) {
    const key = step % 4 < 2 ? 'KeyA' : 'KeyD';
    await page.keyboard.down(key);
    await page.evaluate((s) => {
      const g = window.__game;
      const n = g.enemies().length;
      if (n && g.aimAtEnemy(s % n, s % 5 === 0 ? 1 : 0)) {
        if (g.guns().desktop === 0) {
          g.throwGun();
          g.giveGun();
        }
        g.fire();
      } else if (s % 6 === 0) g.aimAtVip();
    }, step);
    await page.waitForTimeout(450);
    await page.keyboard.up(key);
    await page.waitForTimeout(150);
    step++;
  }

  const report = await page.evaluate(() => {
    const g = window.__game;
    return { state: g.state, level: g.level, kills: g.kills, drawCalls: g.drawCalls, civilians: g.civilians().length, vip: g.vip() };
  });
  const video = page.video();
  await context.close();
  await browser.close();
  server?.kill();

  const webm = await video.path();
  const raw = join(OUT, 'raw.webm');
  renameSync(webm, raw);
  const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', raw, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-vf', 'fps=30', join(OUT, 'proof.mp4')]);
  // One frame per second, 5 per row, for a quick look at the whole run.
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', raw, '-vf', 'fps=1,scale=384:-1,tile=5x4', '-frames:v', '1', join(OUT, 'sheet.png')]);
  rmSync(join(OUT, 'raw'), { recursive: true, force: true });

  const out = { url: URL_, gpu, seconds: SECONDS, ...report, errors };
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  if (!existsSync(join(OUT, 'proof.mp4'))) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
