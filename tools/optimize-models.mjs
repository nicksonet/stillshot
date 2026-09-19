#!/usr/bin/env node
// Make generated GLBs fit the Quest: weld + simplify the mesh (skin weights kept), drop PBR maps
// the game doesn't use (normal, metal/roughness, occlusion), prune, drop redundant keyframes, and write to
// public/models/ with meshopt compression (quantized, about 5x smaller; the loaders set MeshoptDecoder).
// --ratio 1 skips simplification (recompress an already optimized model).
//
//   node tools/optimize-models.mjs [--ratio 0.3] assets/glb/gangster-anim.glb:gangster ...
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample, simplify, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { mkdirSync, statSync } from 'node:fs';

const argv = process.argv.slice(2);
let ratio = 0.3;
const jobs = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--ratio') ratio = Number(argv[++i]);
  else jobs.push(argv[i]);
}

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
mkdirSync('public/models', { recursive: true });

const triangles = (doc) =>
  doc
    .getRoot()
    .listMeshes()
    .flatMap((m) => m.listPrimitives())
    .reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);

for (const job of jobs) {
  const [src, name] = job.split(':');
  const doc = await io.read(src);
  const before = triangles(doc);
  for (const mat of doc.getRoot().listMaterials()) {
    mat.setNormalTexture(null);
    mat.setMetallicRoughnessTexture(null);
    mat.setOcclusionTexture(null);
    mat.setEmissiveTexture(null);
    // Without its metal/roughness map a material falls back to factors; make it plain matte cloth.
    mat.setMetallicFactor(0);
    mat.setRoughnessFactor(1);
  }
  const reduce = ratio < 1 ? [simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.004, lockBorder: false })] : [];
  await doc.transform(weld(), ...reduce, resample(), dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const out = `public/models/${name}.glb`;
  await io.write(out, doc);
  console.log(JSON.stringify({ src, out, trisBefore: Math.round(before), tris: Math.round(triangles(doc)), kb: Math.round(statSync(out).size / 1024) }));
}
