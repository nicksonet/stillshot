# three.js + WebXR engine guide

Stack: **three.js** (`three`, addons from `three/addons/...`), **Vite**, **TypeScript**, Node 22+, Playwright, IWER (emulated Quest).

## Project shape

- `index.html` — overlay (ENTER VR / desktop play) and the canvas; `src/main.ts` boots `Game` and exposes `window.__game` (debug API).
- `src/game.ts` — session: state machine (menu → playing → failed/cleared → won), frame loop, level loading.
  Subsystems: `combat.ts` (bullets, hits, deaths, loose guns), `input/vr.ts`, `input/desktop.ts`, `spawner.ts`, `debug.ts`.
- Content: `levels.ts` (data), `props.ts` + `world.ts` (static geometry merged per material, colliders), `person.ts`
  (generated rigged people from `public/models/`, loaded once by `loadPeople()` before the game starts), `enemy.ts`, `civilian.ts`, `weapons.ts`, `theme.ts` (styles: `clay`, `neon`).
- Time: game systems move by `gdt = realDt * timeScale`; the player moves in real time. `time.ts` maps motion to time scale.

## Run

`npm run dev` serves **HTTPS** on `0.0.0.0:5173` (WebXR requires HTTPS off localhost). On the Quest: `https://<pc-ip>:5173`,
accept the self-signed certificate, ENTER VR. `npm run build` is a compile gate only — the running page is the proof.

## Capture and self-check

- `npm run proof [-- --level N --seconds S]` — Playwright drives the real game with a bot (strafe + aim + fire via `window.__game`),
  records video, encodes `proof/proof.mp4` and a 1 fps contact sheet `proof/sheet.png` with ffmpeg, writes `proof/report.json`.
- It launches Chromium with `--use-angle=d3d11` to get the **real GPU**. Check `report.gpu`: `SwiftShader`/`llvmpipe` means software
  rendering — slow and not representative of the look.
- The Playwright **test suite** deliberately runs on SwiftShader (`playwright.config.ts`) for determinism; keep tests frame-rate
  tolerant (drive time with `setTimeScale`, wait on state, not on frame counts).

## Quest budget and traps

- **Draw calls**: keep the restaurant under ~150 (`tests/game.spec.ts` guards it). Static geometry is merged per material;
  each body part is one baked mesh with vertex colours; blob shadows are one InstancedMesh. Add detail as geometry, not meshes.
- **No post-processing in XR**: EffectComposer/SSAO/bloom don't play well with WebXR on Quest. Fake it:
  baked floor occlusion (`world.ts bakeFloor`), gradient AO strips at wall bases, additive halo cards for neon glow.
- **Canvas filters are expensive**: blur whole layers once, never shape by shape (it stalled level loads at 0 fps once).
- `mergeGeometries` needs matching attributes: all indexed or all non-indexed, same attribute set. Figure pieces are
  converted with `toNonIndexed()` and lose `uv`; lofted pieces arrive pre-coloured and keep their colours in `bake()`.
- WebXR camera pose is applied by three during `render()`; read the head from `camera.getWorldPosition` after the frame.
- Bullets use swept segments (prev→pos) against spheres/boxes, so fast shots at low frame rates don't tunnel.

## Generated characters (Tripo3D)

- Bone names are not reliable: `Head_0` is the neck in one rig and the head in another, and legs hang off the root or the
  hips. `Person` finds head, chest, arms, legs and hips by shape (highest chain, branch points, lowest leaves).
- The auto-rigger sometimes weights hip skin to a finger where the hand rests. `Person` poses each model once at load and
  drops triangles that stretch past 22 cm; `viewer.html?people=...` reports any that remain (`stretched`).
- Dresses and long coats break the rig (one arm chain, two-bone legs): generate trousers. Check the bone tree before paying for clips.
- Retargeted clips can be broken (the boss bends double): look at them in the viewer; list such models in `NO_CLIPS`.
- Models are meshopt-compressed: every `GLTFLoader` needs `setMeshoptDecoder(MeshoptDecoder)`.

## Judging motion (frame by frame)

`npm run motion` steps the game by exactly 1/30 s and screenshots every step, so animation is judged
on frames and numbers rather than by eye. It writes `motion/<scene>.png` (contact sheet with frame
numbers), `motion/<scene>.mp4` and `motion/report.json`:

- `bench-*` scenes use the asset viewer (`viewer.html?drive=gangster&speed=1.4&motion=walk`): an empty
  floor with markers, a side camera, and the game's own `Person` code. `&raw=1` switches the motion
  fixes off for a before-and-after, `&drift=3.14` walks the body backwards while it faces the camera.
- The other scenes play the real level; each waits for the movement it is about (`until`) so captures
  are not a matter of luck.
- Numbers per frame: the clip playing, ground speed, `drift` (travel versus facing), `footSlip` (how
  fast the standing foot slides: 0 is a foot that stays put) and the step count.

Traps this caught: enemies face the player while walking sideways or backwards, so a forward walk clip
turned into a moonwalk; clips played at their own tempo regardless of speed; and the generated clips
never plant a foot (`clipSpeeds()` shows the foot-speed spread — a real step cycle has p10 near zero).

## The walk is built, not played

The Tripo clips are not usable as locomotion: the planted foot never stops ( shows p10 far
from zero), the arms hang still, and the body neither dips nor turns.  replaces them
while anyone is moving: step length and cadence follow the travel speed (capped by leg length, or the foot
cannot reach), each foot is set down and left in world space for its stance, the swing arcs it to the next
footfall, arms swing against the legs, pelvis and shoulders counter-rotate, the body dips twice a cycle and
leans into a run. Idle and hurt still come from the clips.  switches each piece off for
before-and-after captures, and  shows the clips on their own.
