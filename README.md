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
- People are generated with Tripo3D (image → 3D → auto-rig → preset clips): gangsters, diners, the boss and his guards.
  `person.ts` finds each skeleton by shape, plays clips in game time and bends bones for sitting, cowering, kneeling,
  hands up, lying down and aiming; a shot body is baked in its pose and breaks into head, torso and limbs.
- Movement is corrected as it plays: the step cycle is retimed to the speed the body travels (and walk swaps
  for run), the legs turn towards where it is going while the torso twists back to its target, and the standing
  foot is pinned to the floor with two-bone IK. `npm run motion` measures what sliding is left.
- Enemies: gunner, rifleman (SMG bursts), brawler, hostage-taker; bladed shooting stance, side-steps, cover behind civilians,
  and they target you, the boss and his guards.
- Weapons: revolver (start), pistol, SMG; disarm, throw, punch, block bullets with your gun, shoot bullets out of the air.
- Fail rules: you are hit, you hit a civilian, or the boss dies. Procedural sound and a lounge groove that slows with time.
- Tooling: Playwright tests (incl. emulated Quest 3), screenshot tour, godogen-style proof recorder, asset generator.

**Left / next**
- Play-test on a real Quest: gun grip angle, time-scale feel, comfort, frame rate.
- More generated assets while credits last (565 left): enemy variants, a bodyguard model, restaurant props; trim if the Quest frame rate suffers.
- The boss's generated clips are unusable (bad retarget); he is posed from the bind pose. Re-rig if he ever needs to move.
- Neon levels: same care as the restaurant (layouts, props, lighting).
- Hand tracking, more enemy behaviours (flanking, grenades), difficulty curve.

## Assets

Generated with `tools/asset-gen.mjs` (see `.claude/skills/asset-gen/SKILL.md`), optimized for the Quest with
`tools/optimize-models.mjs` (simplify, matte material, meshopt compression). Sources in `assets/`, game files in `public/models/`.
Reference images: OpenRouter `gemini-3.1-flash-image`, about 7¢ each. Tripo3D: model 30, rig 25, clip 10 credits (100 credits = $1).
The rest of the game (restaurant, neon levels, guns, props) is procedural.

| Name | Description | Size | Path | Cost |
|---|---|---|---|---|
| gangster | enemy: black suit, white shirt, red tie, sunglasses; clips idle, walk, run, shoot, hurt | 1.8 m, 8.9k tris, 561 KB | `public/models/gangster.glb` | 7¢ + 105 cr |
| boss | the boss: mustard double-breasted suit, gold chain; posed only (clips unusable) | 1.8 m, 8.7k tris, 473 KB | `public/models/boss.glb` | 7¢ + 85 cr |
| diner-man | diner and bodyguard: brown three-piece suit; clips idle, walk, run, hurt | 1.8 m, 8.6k tris, 486 KB | `public/models/diner-man.glb` | 7¢ + 95 cr |
| diner-woman | diner: burgundy trouser suit; clips idle, walk, run, hurt (source `diner-woman2`) | 1.75 m, 12.7k tris, 584 KB | `public/models/diner-woman.glb` | 7¢ + 95 cr |
| diner-woman (v1) | discarded: the dress broke the auto-rig (one arm, two-bone legs) | — | deleted | 7¢ + 95 cr |
| revolver | revolver reference model (viewer only; the in-game guns are procedural) | 0.24 m, 2.3k tris, 236 KB | `public/models/revolver.glb` | 7¢ + 30 cr |
| lost task | a model generated while the tool could not save the task id | — | — | 30 cr |

Spent so far: about $0.40 on OpenRouter and 535 Tripo3D credits.

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
npm run motion     # frame-by-frame animation review into motion/ (contact sheets, video, slip numbers)
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
| `person.ts` | generated people: skeleton by shape, stride matched to speed, planted feet, poses, aiming, break-apart |
| `enemy.ts`, `civilian.ts` | gangsters (AI, stances, hostages); diners, the boss and his guards |
| `weapons.ts`, `pieces.ts` | revolver, pistol, SMG built from baked pieces |
| `levels.ts`, `props.ts`, `world.ts`, `theme.ts` | level data; geometry merged per material in two styles (clay, neon); baked shadows |
| `bullets.ts`, `shards.ts`, `debris.ts`, `shadows.ts` | bullets, shatter shards, body-part debris, blob shadows |
| `audio.ts`, `music.ts`, `text.ts` | procedural sound and music, 3D text |
| `emulator.ts` | emulated Quest (`?emu`) |
