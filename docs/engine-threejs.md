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
