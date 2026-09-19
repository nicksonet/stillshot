# Still Shot — working rules

WebXR shooter for Meta Quest (three.js + Vite + TypeScript). Adapted from the godogen runtime:
the game is judged from the running build, never from a clean compile.

- **Durable status lives in `README.md`**: what is built, what is left, and the asset table. Update it when either changes.
- **Engine guide**: read `docs/engine-threejs.md` for stack, layout, run/capture recipes and the traps that compile fine but break at runtime.
- **Assets**: generate with the `asset-gen` skill (`.claude/skills/asset-gen/SKILL.md`, tool `tools/asset-gen.mjs`).
  These are paid APIs — confirm the spend with the user before the first paid generation, and log every asset in the README table.
- Keys live in `.env.local` (gitignored). Never prefix them with `VITE_` (that would bundle them into the public site) and never print them.

## Loop

1. Change the code.
2. `npm run typecheck` and `npm test` (Playwright: desktop gameplay, disarm, civilians, boss, hostages, draw-call budget, emulated Quest 3).
3. `npm run proof` — the bot plays the real game on the real GPU for ~18 s; read `proof/sheet.png` (one frame per second) and `proof/report.json`, and fix what looks wrong before calling it done.
4. For look changes, also `SHOTS=1 npx playwright test tests/screens.spec.ts` and review `test-results/shot-*.png`.
5. Push to `main` → GitHub Actions deploys https://nicksonet.github.io/stillshot/ ; smoke-test the published URL.

Finish user-facing work with proof: the published link and a look at the proof sheet (or `proof/proof.mp4`).
