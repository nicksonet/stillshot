#!/usr/bin/env node
// Frame-by-frame motion review: step the game by exactly 1/30 s and screenshot every step,
// so animation can be judged frame by frame instead of by eye.
//
//   npm run motion                      -> every scenario
//   npm run motion -- --only walk --frames 24 --fps 30
//
// Writes motion/<scenario>/f##.png, motion/<scenario>.png (contact sheet, frame numbers burnt in),
// motion/<scenario>.mp4 (slowed to 6 fps) and motion/report.json (per-frame clip, speed, drift).
import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const URL_ = args.url ?? 'https://localhost:5173';
const FRAMES = Number(args.frames ?? 24);
const FPS = Number(args.fps ?? 30);
const OUT = resolve('motion');

/**
 * Each scenario places the camera, sets the scene up and warms it up, then the tool steps and shoots.
 * `setup` and `warmup` run inside the page against window.__game.
 */
const SCENARIOS = [
  {
    name: 'bench-walk-before',
    note: 'locomotion bench with the motion fixes off: the old look',
    bench: 'drive=gangster&speed=1.4&motion=walk&raw=1',
  },
  {
    name: 'bench-run-before',
    note: 'locomotion bench, running, fixes off',
    bench: 'drive=gangster&speed=2.4&motion=run&raw=1',
  },
  {
    name: 'bench-walk',
    note: 'locomotion bench: walking at 1.4 m/s, side view',
    bench: 'drive=gangster&speed=1.4&motion=walk',
  },
  {
    name: 'bench-run',
    note: 'locomotion bench: running at 2.4 m/s',
    bench: 'drive=gangster&speed=2.4&motion=run',
  },
  {
    name: 'bench-back',
    note: 'locomotion bench: walking backwards while facing the camera',
    bench: 'drive=gangster&speed=1.2&motion=walk&drift=3.14159',
  },
  {
    name: 'walk',
    note: 'gunner walking towards the player, side view',
    setup: `g.spawnEnemy('gunner', -2.2, -6.2);`,
    follow: `g.follow('enemy', 0, 1.7, 1.2, 1.1)`,
    until: `const e = g.motion().enemies[0]; return e && e.speed > 0.5 && Math.abs(e.drift) < 0.6;`,
    warmup: 8,
  },
  {
    name: 'sidestep',
    note: 'gunner repositioning sideways or backwards while facing the player',
    setup: `g.spawnEnemy('gunner', -1.0, -3.0);`,
    follow: `g.follow('enemy', 0, 1.8, 1.2, 1.0)`,
    until: `const e = g.motion().enemies[0]; return e && e.speed > 0.5 && Math.abs(e.drift) > 1.2;`,
    warmup: 4,
  },
  {
    name: 'charge',
    note: 'brawler running at the player, side view',
    setup: `g.spawnEnemy('brawler', -1.2, -5.5);`,
    follow: `g.follow('enemy', 0, 1.8, 1.2, 1.2)`,
    until: `const e = g.motion().enemies[0]; return e && e.speed > 1.5;`,
    warmup: 4,
  },
  {
    name: 'flee',
    note: 'a diner panicking and running for an exit',
    setup: `g.panic();`,
    follow: `g.follow('civilian', 0, 1.8, 1.2, 1.2)`,
    until: `const c = g.motion().civilians[0]; return c && c.speed > 1.0;`,
    warmup: 4,
  },
  {
    name: 'player',
    note: 'what the player actually sees: gunner closing in',
    setup: `g.spawnEnemy('gunner', -1.0, -6.0); g.setCamera(0, 1.65, 1.3, -1.0, 1.2, -6.0);`,
    warmup: 12,
  },
];

async function reachable(url) {
  try {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await reachable(URL_)) return null;
  console.error(`[motion] starting dev server for ${URL_}`);
  const child = spawn('npx', ['vite'], { shell: true, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await reachable(URL_)) return child;
  }
  child.kill();
  throw new Error('dev server did not start');
}

// ffmpeg on Windows has no fontconfig, and a drive letter inside a filter needs escaping,
// so the font is copied next to the frames and ffmpeg runs from there.
const FONT = 'font.ttf';
const ffmpeg = (...a) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...a], { cwd: OUT });

async function capture(page, sc) {
  if (sc.bench) return captureBench(page, sc);
  const dir = join(OUT, sc.name);
  mkdirSync(dir, { recursive: true });
  await page.goto(URL_);
  await page.waitForFunction(() => window.__game && window.__game.frame > 5, null, { timeout: 60000 });
  const ready = await page.evaluate(
    ({ setup, follow, until, warmup, fps }) => {
      const g = window.__game;
      g.startDesktop();
      g.startLevel(0);
      g.clearQueue();
      g.setGodMode(true);
      g.setTimeScale(1);
      g.setPaused(true);
      new Function('g', setup)(g);
      const aim = follow ? new Function('g', follow) : null;
      for (let i = 0; i < warmup; i++) {
        aim?.(g);
        g.step(1 / fps);
      }
      // Wait for the movement the scenario is about, so captures are not a matter of luck.
      if (until) {
        const ready = new Function('g', until);
        for (let i = 0; i < 900 && !ready(g); i++) {
          aim?.(g);
          g.step(1 / fps);
        }
        return ready(g);
      }
      return true;
    },
    { setup: sc.setup, follow: sc.follow ?? null, until: sc.until ?? null, warmup: sc.warmup, fps: FPS },
  );

  const frames = [];
  if (!ready) console.error(`[motion] ${sc.name}: the movement never started, frames may be idle`);
  for (let i = 0; i < FRAMES; i++) {
    const info = await page.evaluate(
      ({ fps, follow }) => {
        const g = window.__game;
        if (follow) new Function('g', follow)(g);
        g.step(1 / fps);
        return g.motion();
      },
      { fps: FPS, follow: sc.follow ?? null },
    );
    const file = join(dir, `f${String(i).padStart(2, '0')}.png`);
    await page.screenshot({ path: file });
    frames.push({ frame: i, t: +(i / FPS).toFixed(3), ...info });
  }

  sheet(dir, sc.name);
  return { name: sc.name, note: sc.note, ready, frames };
}

/** Contact sheet with the frame number burnt into each tile, plus a slowed-down video. */
function sheet(dir, name) {
  const cols = 6;
  ffmpeg(
    '-framerate', '1', '-i', join(dir, 'f%02d.png'),
    '-vf', `scale=426:-1,drawtext=fontfile=${FONT}:text='%{n}':x=6:y=4:fontsize=22:fontcolor=red,tile=${cols}x${Math.ceil(FRAMES / cols)}`,
    '-frames:v', '1', join(OUT, `${name}.png`),
  );
  ffmpeg('-framerate', '6', '-i', join(dir, 'f%02d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(OUT, `${name}.mp4`));
}

/** Locomotion bench in the asset viewer: empty floor, side camera, the game's own Person code. */
async function captureBench(page, sc) {
  const dir = join(OUT, sc.name);
  mkdirSync(dir, { recursive: true });
  await page.goto(`${URL_}/viewer.html?${sc.bench}`);
  await page.waitForFunction(() => window.__viewer?.ready, null, { timeout: 60000 });
  await page.evaluate((fps) => {
    window.__viewer.pause(true);
    for (let i = 0; i < 40; i++) window.__viewer.step(1 / fps);
  }, FPS);
  const frames = [];
  for (let i = 0; i < FRAMES; i++) {
    const people = await page.evaluate((fps) => {
      window.__viewer.step(1 / fps);
      return window.__viewer.report;
    }, FPS);
    await page.screenshot({ path: join(dir, `f${String(i).padStart(2, '0')}.png`) });
    frames.push({ frame: i, t: +(i / FPS).toFixed(3), people });
  }
  sheet(dir, sc.name);
  return { name: sc.name, note: sc.note, ready: true, frames };
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  copyFileSync('C:/Windows/Fonts/consola.ttf', join(OUT, FONT));
  const server = await ensureServer();
  const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 852, height: 480 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(URL_);
  await page.waitForFunction(() => window.__game && window.__game.frame > 5, null, { timeout: 60000 });

  const only = args.only ? args.only.split(',') : null;
  const report = [];
  for (const sc of SCENARIOS) {
    if (only && !only.includes(sc.name)) continue;
    report.push(await capture(page, sc));
  }
  writeFileSync(join(OUT, 'report.json'), JSON.stringify({ fps: FPS, frames: FRAMES, errors, scenarios: report }, null, 1));
  console.log(JSON.stringify({ out: OUT, scenarios: report.map((r) => r.name), errors }, null, 1));
  await browser.close();
  server?.kill();
}

await main();
