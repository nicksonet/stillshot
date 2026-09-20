// Dev-only asset viewer: /viewer.html?files=assets/glb/a.glb,assets/glb/b.glb[&anim=walk]
// Lays the models out in a row on the clay floor, prints triangle counts, sizes and clip names,
// and exposes them as window.__viewer for screenshots from tests.
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Person, loadPeople, motionFixes, stretchedTriangles, type Motion, type PersonModel, type Pose } from './person';

const params = new URLSearchParams(location.search);
const files = (params.get('files') ?? '').split(',').filter(Boolean);
const clip = params.get('anim');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf3efe9);
scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d1c6, 2.1));
const sun = new THREE.DirectionalLight(0xfff3e6, 1.25);
sun.position.set(3, 6, 4);
scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshLambertMaterial({ color: 0xe3ddd4 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.05, 100);
let paused = false;

const mixers: THREE.AnimationMixer[] = [];
const tickers: ((dt: number) => void)[] = [];
const report: Record<string, unknown>[] = [];
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const spacing = 1.4;

/** ?people=gangster,boss&pose=seated&anim=walk&aim=1 — check Person poses and clips. */
async function people(names: PersonModel[]) {
  await loadPeople('/');
  const pose = (params.get('pose') ?? 'stand') as Pose;
  const persons = names.map((n, i) => {
    const p = new Person(n);
    p.root.position.set((i - (names.length - 1) / 2) * spacing, 0, 0);
    p.pose = pose;
    if (pose === 'prone') {
      p.root.rotation.order = 'YXZ';
      p.root.rotation.x = -Math.PI / 2;
      p.root.position.y = 0.13;
    }
    p.play((params.get('anim') as Motion) ?? 'idle');
    if (params.get('aim')) {
      p.aimAt = new THREE.Vector3(p.root.position.x + 0.6, 1.5, 4);
      p.twoHanded = params.get('aim') === '2';
    }
    scene.add(p.root);
    return p;
  });
  const gun = await loader.loadAsync('/models/revolver.glb');
  const guns = persons.map(() => {
    const g = gun.scene.clone();
    const box = new THREE.Box3().setFromObject(g);
    g.scale.setScalar(0.24 / Math.max(...box.getSize(new THREE.Vector3()).toArray()));
    const holder = new THREE.Group();
    g.rotation.y = Math.PI / 2; // model barrel along +X → -Z
    holder.add(g);
    scene.add(holder);
    return holder;
  });
  tickers.push((dt) =>
    persons.forEach((p, i) => {
      p.update(dt);
      p.gunTransform(guns[i].position, guns[i].quaternion);
    }),
  );
  camera.position.set(1.2, 1.5, Math.max(3.5, names.length * spacing * 1.1));
  camera.lookAt(0, 0.9, 0);
  const viewer = { ready: true, report: names as unknown };
  (window as unknown as { __viewer: unknown }).__viewer = viewer;
  // After a few frames of the pose, list skinning slivers: triangles stretched over 25 cm.
  setTimeout(() => (viewer.report = persons.map((p, i) => ({ name: names[i], stretched: stretched(p.mesh, 0.25) }))), 200);
}

/** Skinning slivers left after the load-time clean-up, named by their vertices' main bones. */
function stretched(mesh: THREE.SkinnedMesh, min: number): string[] {
  const geo = mesh.geometry;
  const idx = geo.getAttribute('skinIndex');
  const wt = geo.getAttribute('skinWeight');
  const main = (v: number) => {
    let best = 0;
    for (let k = 1; k < 4; k++) if (wt.getComponent(v, k) > wt.getComponent(v, best)) best = k;
    return mesh.skeleton.bones[idx.getComponent(v, best)].name;
  };
  const index = geo.index!;
  return [...new Set(stretchedTriangles(mesh, min).map((t) => [0, 1, 2].map((k) => main(index.getX(t + k))).join(' / ')))];
}

/**
 * ?drive=gangster,diner-woman&speed=1.4&motion=walk&drift=0 — locomotion test bench: the people
 * are pushed across an empty floor exactly as the game moves them, so the step cycle, the stride
 * speed and the foot sliding can be judged on their own. `drift` turns the travel away from the
 * facing (π means walking backwards), which is what enemies do when they reposition while aiming.
 */
async function drive(names: PersonModel[]) {
  await loadPeople('/');
  const speed = Number(params.get('speed') ?? 1.4);
  const drift = Number(params.get('drift') ?? 0);
  const motion = (params.get('motion') ?? 'walk') as Motion;
  // ?raw=1 turns the motion fixes off, for before-and-after captures.
  if (params.get('raw')) motionFixes.stride = motionFixes.plant = motionFixes.turn = false;
  const people = names.map((n, i) => {
    const p = new Person(n);
    p.root.position.set((i - (names.length - 1) / 2) * spacing, 0, 0);
    p.play(motion);
    scene.add(p.root);
    return p;
  });
  // Poles on the floor every 2 m, so travel and any foot sliding are visible against something.
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.05), new THREE.MeshLambertMaterial({ color: 0xb9ae9e }));
  for (let i = -10; i <= 10; i++) {
    const p = post.clone();
    p.position.set(-1.6, 0.25, i * 2);
    scene.add(p);
  }
  tickers.push((dt) => {
    for (const p of people) {
      p.root.position.x += Math.sin(drift) * speed * dt;
      p.root.position.z += Math.cos(drift) * speed * dt;
      p.play(motion);
      p.update(dt);
    }
    // The camera rides along beside them.
    const mid = people.reduce((s, p) => s + p.root.position.z, 0) / people.length;
    camera.position.set(4.6, 1.15, mid + 0.5);
    camera.lookAt(0, 0.95, mid);
  });
  const viewer = {
    ready: true,
    report: null as unknown,
    step: (dt: number) => tick(dt),
    pause: (on: boolean) => (paused = on),
  };
  Object.defineProperty(viewer, 'report', {
    get: () => people.map((p, i) => ({ name: names[i], clip: p.motion, speed: +p.groundSpeed.toFixed(2), slip: +p.footSlip.toFixed(2), steps: p.steps, ik: +p.ikError.toFixed(3) })),
  });
  (window as unknown as { __viewer: unknown }).__viewer = viewer;
}

async function main() {
  const driven = params.get('drive');
  if (driven) return drive(driven.split(',') as PersonModel[]);
  const names = params.get('people');
  if (names) return people(names.split(',') as PersonModel[]);
  for (const [i, file] of files.entries()) {
    const gltf = await loader.loadAsync('/' + file);
    const root = gltf.scene;
    let tris = 0;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        const g = m.geometry;
        tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      }
    });
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    // Stand it on the floor at 1.8 m for people (or its own size for props), in a row.
    const scale = size.y > 0.5 ? 1.8 / size.y : 1;
    root.scale.setScalar(scale);
    const b2 = new THREE.Box3().setFromObject(root);
    root.position.set((i - (files.length - 1) / 2) * spacing - (b2.min.x + b2.max.x) / 2, -b2.min.y, -(b2.min.z + b2.max.z) / 2);
    scene.add(root);
    if (gltf.animations.length) {
      const mixer = new THREE.AnimationMixer(root);
      const a = gltf.animations.find((c) => !clip || c.name.toLowerCase().includes(clip)) ?? gltf.animations[0];
      mixer.clipAction(a).play();
      mixers.push(mixer);
    }
    report.push({ file, tris: Math.round(tris), size: size.toArray().map((v) => +v.toFixed(3)), clips: gltf.animations.map((c) => c.name) });
  }
  const w = files.length * spacing;
  camera.position.set(0, 1.4, Math.max(3.2, w * 1.25));
  camera.lookAt(0, 0.95, 0);
  document.getElementById('info')!.textContent = report.map((r) => JSON.stringify(r)).join('\n');
  (window as unknown as { __viewer: unknown }).__viewer = { ready: true, report };
}

const timer = new THREE.Timer();
const tick = (dt: number) => {
  for (const m of mixers) m.update(dt);
  for (const t of tickers) t(dt);
  renderer.render(scene, camera);
};
renderer.setAnimationLoop(() => {
  timer.update();
  tick(paused ? 0 : timer.getDelta());
});
void main();
