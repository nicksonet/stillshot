# Still Shot

A WebXR shooter for Meta Quest in the spirit of SUPERHOT: **time moves only when you move.**
It runs straight in the headset browser, nothing to install, and on desktop with mouse and keyboard.

**Play:** https://nicksonet.github.io/stillshot/ — open it in the Quest browser and press ENTER VR.
Every push to `main` is deployed there automatically (GitHub Actions → Pages).

## The game

- **Level 1, The Restaurant:** a pastel, period dining room. Your boss has been knocked to the floor at your feet.
  Gangsters in black suits come in from the kitchen, the street door and the back; some grab diners and hide behind them.
- You start with a **revolver**. Enemies carry pistols and **SMGs you can take off them**.
- **Fail conditions:** you get hit, you hit a civilian ("CIVILIAN DOWN"), or the boss is shot ("THE BOSS IS DEAD").
- Levels 2–5 are cyberpunk: Neon Alley, Rooftop, Data Center, Nightclub.

Enemy types: **gunner** (pistol, earpiece), **rifleman** (SMG bursts, long coat), **brawler** (bare-knuckle, brass knuckles),
**hostage-taker** (fedora; holds a diner as a shield and leans out to shoot).

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
Your bullet can knock an enemy bullet out of the air; a gun in your hand blocks bullets.

## Local development

```
npm install
npm run dev
```

Vite serves HTTPS on port 5173 (WebXR needs HTTPS) and prints the LAN addresses. On the Quest, on the same network,
open `https://<pc-ip>:5173`, accept the self-signed certificate, and press ENTER VR.

- `npm run typecheck` — type check
- `npm test` — Playwright: desktop gameplay, disarming, civilians, the boss, hostages, draw-call budget,
  and VR through an emulated Quest 3 (IWER), no headset needed
- `SHOTS=1 npx playwright test tests/screens.spec.ts` — screenshot tour into `test-results/`
- `https://localhost:5173/?emu` — emulated Quest 3 in a desktop browser, with a control panel for headset and controllers

## Code map (`src/`)

| File | What it does |
|---|---|
| `game.ts` | game loop, states, VR/desktop input, shooting, disarming, collisions, fail rules |
| `time.ts` | time scale driven by head and hand motion |
| `figure.ts` | articulated low-poly humans; pieces baked into one mesh per limb |
| `enemy.ts` | gangsters: models per type, AI (cover behind civilians, bursts, hostage peeking, melee) |
| `civilian.ts` | diners and the boss: suits, poses (seated, cowering, fleeing, held, prone), panic |
| `weapons.ts` | revolver, pistol, SMG: models, ammo indicators, fire specs |
| `levels.ts` | level layouts: props, spawns, exits, civilians, waves |
| `props.ts`, `world.ts`, `theme.ts` | level geometry in two styles (pastel, neon), merged per material; lighting; collisions |
| `bullets.ts`, `shards.ts`, `audio.ts`, `text.ts` | bullets, shatter effects, procedural sound, 3D text |
| `emulator.ts` | emulated Quest (`?emu`) |

`window.__game` is a debug API used by the tests (state, aiming, firing, spawning, time control).
