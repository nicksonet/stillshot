#!/usr/bin/env node
// Asset generation (adapted from godogen's asset-gen skill) for Still Shot.
// Images via OpenRouter (Gemini image models), 3D models / rigs / animations via Tripo3D.
// Keys come from .env.local (OPENROUTER_API_KEY, TRIPO3D_API_KEY). Every call costs money:
// agents must confirm the spend with the user first.
//
//   node tools/asset-gen.mjs balance
//   node tools/asset-gen.mjs image --prompt "..." -o assets/img/x.png [--model flash|lite|pro] [--image ref.png] [--aspect 16:9]
//   node tools/asset-gen.mjs glb   --image ref.png -o assets/glb/x.glb [--hd]
//   node tools/asset-gen.mjs rig   --from assets/glb/x.glb -o assets/glb/x-rig.glb
//   node tools/asset-gen.mjs anim  --from assets/glb/x-rig.glb --animation preset:biped:walk -o assets/glb/x-walk.glb
//   node tools/asset-gen.mjs resume -o assets/glb/x.glb
//
// Prints one JSON line to stdout: {"ok":true,"path":"...","cost_usd":0.07}. Progress goes to stderr.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const MODELS = {
  flash: 'google/gemini-3.1-flash-image', // ~8¢, follows prompts precisely
  lite: 'google/gemini-3.1-flash-lite-image', // ~4¢, cheap drafts and textures
  pro: 'google/gemini-3-pro-image', // ~15¢, best quality
};
const TRIPO = 'https://api.tripo3d.ai/v2/openapi';
const TRIPO_MODEL = 'v3.1-20260211';

function env() {
  const file = resolve('.env.local');
  const vars = { ...process.env };
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && m[2]) vars[m[1]] = m[2];
    }
  }
  return vars;
}

function parse(argv) {
  const [cmd, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '-o') opts.out = rest[++i];
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next === undefined || next.startsWith('-')) opts[key] = true;
      else opts[key] = rest[++i];
    }
  }
  return { cmd, opts };
}

const log = (...a) => console.error('[asset-gen]', ...a);
const done = (o) => console.log(JSON.stringify({ ok: true, ...o }));
const fail = (msg) => {
  console.log(JSON.stringify({ ok: false, error: msg }));
  process.exit(1);
};

function ensureDir(path) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
}

// ---------------------------------------------------------------- images (OpenRouter)

async function image(opts, keys) {
  if (!keys.OPENROUTER_API_KEY) fail('OPENROUTER_API_KEY missing in .env.local');
  if (!opts.prompt || !opts.out) fail('usage: image --prompt "..." -o out.png');
  const model = MODELS[opts.model ?? 'flash'] ?? opts.model;
  const content = [{ type: 'text', text: opts.prompt }];
  if (opts.image) {
    const b64 = readFileSync(opts.image).toString('base64');
    content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } });
  }
  log(`image via ${model}`);
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${keys.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content }],
      modalities: ['image', 'text'],
      ...(opts.aspect ? { image_config: { aspect_ratio: opts.aspect } } : {}),
      usage: { include: true },
    }),
  });
  const json = await res.json();
  if (!res.ok) fail(`OpenRouter HTTP ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  const url = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) fail(`no image in response: ${JSON.stringify(json).slice(0, 400)}`);
  const data = url.startsWith('data:') ? Buffer.from(url.split(',')[1], 'base64') : Buffer.from(await (await fetch(url)).arrayBuffer());
  ensureDir(opts.out);
  writeFileSync(opts.out, data);
  done({ path: opts.out, model, cost_usd: json.usage?.cost ?? null });
}

// ---------------------------------------------------------------- 3D (Tripo3D)

async function tripo(keys, path, init = {}) {
  const res = await fetch(`${TRIPO}${path}`, { ...init, headers: { Authorization: `Bearer ${keys.TRIPO3D_API_KEY}`, ...(init.headers ?? {}) } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.code !== 0) fail(`Tripo3D ${path} HTTP ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  return json.data;
}

async function submit(keys, payload) {
  const data = await tripo(keys, '/task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  return data.task_id;
}

const sidecar = (out) => `${out}.tripo.json`;

/** Poll a task and download its model. Safe to repeat: the task id lives in the sidecar. */
async function finish(keys, taskId, out, kind) {
  const started = Date.now();
  for (;;) {
    const d = await tripo(keys, `/task/${taskId}`);
    if (d.status === 'success') {
      const o = d.output ?? {};
      const url = o.pbr_model ?? o.model ?? o.base_model;
      if (!url) fail(`no model url in output: ${Object.keys(o)}`);
      ensureDir(out);
      writeFileSync(out, Buffer.from(await (await fetch(url)).arrayBuffer()));
      done({ path: out, task_id: taskId, kind, credits: d.consumed_credit ?? null });
      return;
    }
    if (['failed', 'cancelled', 'unknown', 'banned', 'expired'].includes(d.status)) fail(`task ${taskId} ${d.status}`);
    if (Date.now() - started > 15 * 60 * 1000) fail(`task ${taskId} still ${d.status} after 15 min; run "resume -o ${out}" later (no new charge)`);
    log(`${kind} ${taskId}: ${d.status} ${d.progress ?? ''}%`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}

function startTask(out, kind, taskId) {
  writeFileSync(sidecar(out), JSON.stringify({ task_id: taskId, kind }, null, 2));
  log(`${kind} submitted: ${taskId} (sidecar ${basename(sidecar(out))})`);
}

function taskOf(file) {
  if (!file || !existsSync(sidecar(file))) fail(`no sidecar for ${file}; generate it with this tool first`);
  return JSON.parse(readFileSync(sidecar(file), 'utf8')).task_id;
}

async function glb(opts, keys) {
  if (!keys.TRIPO3D_API_KEY) fail('TRIPO3D_API_KEY missing in .env.local');
  if (!opts.image || !opts.out) fail('usage: glb --image ref.png -o out.glb [--hd]');
  if (existsSync(sidecar(opts.out))) return finish(keys, taskOf(opts.out), opts.out, 'glb');
  const form = new FormData();
  form.append('file', new Blob([readFileSync(opts.image)], { type: 'image/png' }), basename(opts.image));
  const up = await tripo(keys, '/upload', { method: 'POST', body: form });
  const taskId = await submit(keys, {
    type: 'image_to_model',
    model_version: TRIPO_MODEL,
    file: { type: 'png', file_token: up.image_token },
    texture: true,
    pbr: true,
    auto_size: true,
    orientation: 'default',
    enable_image_autofix: true,
    geometry_quality: opts.hd ? 'detailed' : 'standard',
    texture_quality: opts.hd ? 'detailed' : 'standard',
    ...(opts.hd ? {} : { face_limit: 30000 }),
  });
  startTask(opts.out, 'glb', taskId);
  return finish(keys, taskId, opts.out, 'glb');
}

async function rig(opts, keys) {
  if (!opts.from || !opts.out) fail('usage: rig --from model.glb -o rigged.glb');
  if (existsSync(sidecar(opts.out))) return finish(keys, taskOf(opts.out), opts.out, 'rig');
  const taskId = await submit(keys, {
    type: 'animate_rig',
    original_model_task_id: taskOf(opts.from),
    out_format: 'glb',
    rig_type: opts.type ?? 'biped',
    spec: 'tripo',
  });
  startTask(opts.out, 'rig', taskId);
  return finish(keys, taskId, opts.out, 'rig');
}

async function anim(opts, keys) {
  if (!opts.from || !opts.animation || !opts.out) fail('usage: anim --from rigged.glb --animation preset:biped:walk -o walk.glb');
  if (existsSync(sidecar(opts.out))) return finish(keys, taskOf(opts.out), opts.out, 'anim');
  const taskId = await submit(keys, {
    type: 'animate_retarget',
    original_model_task_id: taskOf(opts.from),
    out_format: 'glb',
    animation: opts.animation,
    bake_animation: true,
  });
  startTask(opts.out, 'anim', taskId);
  return finish(keys, taskId, opts.out, 'anim');
}

async function balance(keys) {
  const out = {};
  if (keys.OPENROUTER_API_KEY) {
    const r = await (await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${keys.OPENROUTER_API_KEY}` } })).json();
    out.openrouter = { limit_usd: r.data?.limit ?? null, used_usd: r.data?.usage ?? null };
  }
  if (keys.TRIPO3D_API_KEY) out.tripo3d = await tripo(keys, '/user/balance');
  done(out);
}

const { cmd, opts } = parse(process.argv.slice(2));
const keys = env();
const run = { image, glb, rig, anim, resume: (o, k) => finish(k, taskOf(o.out), o.out, 'resume'), balance: (_o, k) => balance(k) }[cmd];
if (!run) fail('commands: balance | image | glb | rig | anim | resume');
run(opts, keys).catch((e) => fail(String(e?.message ?? e)));
