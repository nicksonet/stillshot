# Still Shot

A WebXR shooter for Meta Quest in the spirit of SUPERHOT: **time moves only when you move.**
It runs straight in the headset browser, nothing to install, and on desktop with mouse and keyboard.

**Play:** https://nicksonet.github.io/stillshot/ — open it in the Quest browser and press ENTER VR.
Every push to `main` is deployed there automatically (GitHub Actions → Pages).

## Status

**Built**
- Level 1, The Restaurant: monochrome "clay" dining room (one warm off-white tone, baked floor and wall occlusion).
  The boss lies at your feet, two bodyguards kneel at his head and feet; gangsters burst in through the kitchen, then the street door.
  Diners panic (duck or flee); hostage-takers grab a diner and lean out to shoot.
- Levels 2–5 in neon cyberpunk: Neon Alley, Rooftop, Data Center, Nightclub.
- Faceted, volumetric low-poly people (suits, faces, hats); shot bodies break into head, torso and limbs.
- Enemies: gunner, rifleman (SMG bursts), brawler, hostage-taker; bladed shooting stance, side-steps, cover behind civilians,
  and they target you, the boss and his guards.
- Weapons: revolver (start), pistol, SMG; disarm, throw, punch, block bullets with your gun, shoot bullets out of the air.
- Fail rules: you are hit, you hit a civilian, or the boss dies. Procedural sound and a lounge groove that slows with time.
- Tooling: Playwright tests (incl. emulated Quest 3), screenshot tour, godogen-style proof recorder, asset generator.

**Left / next**
- Play-test on a real Quest: gun grip angle, time-scale feel, comfort, frame rate.
- Restaurant art pass with generated assets (style references, signage) — Tripo3D needs credits.
- Neon levels: same care as the restaurant (layouts, props, lighting).
- Hand tracking, more enemy behaviours (flanking, grenades), difficulty curve.

## Assets

Generated with `tools/asset-gen.mjs` (see `.claude/skills/asset-gen/SKILL.md`). Everything in the game today is procedural.

| Name | Description | Size | Path | Cost |
|---|---|---|---|---|
| — | none yet | — | — | — |

## Controls

| | VR (Quest) | Desktop |
|---|---|---|
| Shoot | trigger (hold for full-auto) | LMB (hold for full-auto) |
| Throw your gun | grip, while holding a gun | RMB |
| Grab a gun / **disarm** an enemy | grip next to the gun (on the floor or in his hand) | E |
| Punch | swing your fist into him | F |
| Move | left stick (or walk) | WASD |
| Turn | right stick (30° snap) | mouse |
| Retry | trigger after failing | R / click |

Punching an armed enemy knocks his gun loose; punching an unarmed one shatters him. A thrown gun kills.

## Development

```
npm install
npm run dev        # HTTPS on :5173 (WebXR needs HTTPS); on the Quest open https://<pc-ip>:5173
npm run typecheck
npm test           # Playwright: gameplay, disarm, civilians, boss, hostages, draw calls, emulated Quest 3
npm run proof      # bot plays on the real GPU; review proof/sheet.png, proof/proof.mp4, proof/report.json
```

- `SHOTS=1 npx playwright test tests/screens.spec.ts` — screenshot tour into `test-results/`
- `https://localhost:5173/?emu` — emulated Quest 3 in a desktop browser
- Working rules for agents: `CLAUDE.md`; engine notes and traps: `docs/engine-threejs.md`

## Code map (`src/`)

| File | What it does |
|---|---|
| `game.ts` | session: state machine, frame loop, level loading, fail rules |
| `combat.ts` | bullets, hits, deaths, loose and thrown guns, disarming, punches |
| `input/vr.ts`, `input/desktop.ts` | Quest controllers; mouse and keyboard |
| `spawner.ts` | waves, scripted entrances, hostage-takers |
| `debug.ts` | `window.__game` for tests, the proof bot and the console |
| `time.ts` | time scale driven by head and hand motion |
| `body.ts`, `figure.ts` | faceted lofted people on an articulated rig, baked one mesh per part |
| `enemy.ts`, `civilian.ts` | gangsters (AI, stances, hostages); diners, the boss and his guards |
| `weapons.ts` | revolver, pistol, SMG |
| `levels.ts`, `props.ts`, `world.ts`, `theme.ts` | level data; geometry merged per material in two styles (clay, neon); baked shadows |
| `bullets.ts`, `shards.ts`, `debris.ts`, `shadows.ts` | bullets, shatter shards, body-part debris, blob shadows |
| `audio.ts`, `music.ts`, `text.ts` | procedural sound and music, 3D text |
| `emulator.ts` | emulated Quest (`?emu`) |
