---
name: asset-gen
description: |
  Generate game assets for Still Shot: PNG images (textures, posters, signage, style references, character references)
  via OpenRouter Gemini image models, and GLB 3D models, rigs and animations via Tripo3D. Paid APIs — confirm spend first.
---

# Asset Generator (Still Shot)

Adapted from godogen's `asset-gen` skill. Tool: `node tools/asset-gen.mjs`, keys from `.env.local`
(`OPENROUTER_API_KEY`, `TRIPO3D_API_KEY`). Every call costs real money: **confirm with the user before the first paid
generation**, state the expected price, and add each result to the asset table in `README.md`.

Check money first (free): `node tools/asset-gen.mjs balance`.

## Images (OpenRouter)

```bash
node tools/asset-gen.mjs image --prompt "the full prompt" -o assets/img/name.png [--model flash|lite|pro] [--aspect 16:9] [--image ref.png]
```

| Model | Flag | ~Cost | Use for |
|---|---|---|---|
| Gemini 3.1 Flash Image | `--model flash` (default) | 8¢ | precise prompts: references, signage, layouts |
| Gemini 3.1 Flash Lite Image | `--model lite` | 4¢ | drafts, simple textures |
| Gemini 3 Pro Image | `--model pro` | 15¢ | hero images, final references |

- `--image ref.png` = image-to-image: describe only what changes (angle, pose, recolour).
- Never ask for a "transparent background" (you get a baked checkerboard); ask for a solid colour and matte it.
- Review every PNG before spending on a 3D model from it.

## 3D (Tripo3D)

```bash
node tools/asset-gen.mjs glb  --image ref.png -o assets/glb/name.glb [--hd]        # ~30¢ (HD ~60¢)
node tools/asset-gen.mjs rig  --from assets/glb/name.glb -o assets/glb/name-rig.glb   # ~25¢, biped only
node tools/asset-gen.mjs anim --from assets/glb/name-rig.glb --animation preset:biped:walk -o assets/glb/name-walk.glb  # ~10¢/clip
node tools/asset-gen.mjs resume -o assets/glb/name.glb                               # free: finish a timed-out task
```

- Source image for `glb`: 3/4 elevated view, solid white/grey background, matte, single centred subject.
- A timeout is **not** a failure: the task id is in `<out>.tripo.json`. Run `resume`, never resubmit (that pays twice).
- Biped presets for `anim`: idle, walk, run, shoot, hurt, fall, dive, jump, fire, standing_relax, frightened, scared_01/02, flee_01/02, look_around, …
- Style fit: the game's people are faceted low-poly (see `src/body.ts`). Generated models must be decimated / flat-shaded to match,
  and stay within the Quest draw-call budget (one mesh per body part or a single skinned mesh).

## Output

One JSON line on stdout: `{"ok":true,"path":"...","cost_usd":0.07}` (images) or `{"ok":true,"path":"...","task_id":"...","credits":..}` (3D).
Progress goes to stderr.

## Asset table (README.md)

Track every asset with its **in-game size** (metres for models, tile size for textures, px for UI):

| Name | Description | Size | Path | Cost |
|---|---|---|---|---|
