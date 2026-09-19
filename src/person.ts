import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

/** Generated characters (Tripo3D, rigged and animated), see README asset table. */
export type PersonModel = 'gangster' | 'boss' | 'diner-man' | 'diner-woman';
export type Pose = 'stand' | 'seated' | 'cower' | 'held' | 'kneel' | 'prone';
export type Motion = 'idle' | 'walk' | 'run' | 'hurt' | 'none';

const MODELS: PersonModel[] = ['gangster', 'boss', 'diner-man', 'diner-woman'];
/** Tripo retargeted these rigs badly (the boss bends double); they are posed from the bind pose only. */
const NO_CLIPS = new Set<PersonModel>(['boss']);
const cache = new Map<PersonModel, GLTF>();

/** Load every character once before the game starts. */
export async function loadPeople(base = import.meta.env.BASE_URL): Promise<void> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  await Promise.all(
    MODELS.map(async (name) => {
      const gltf = await loader.loadAsync(`${base}models/${name}.glb`);
      // Matte, faceted look (and cheaper than PBR on Quest): keep only the colour map.
      gltf.scene.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isMesh) return;
        const src = m.material as THREE.MeshStandardMaterial;
        m.material = new THREE.MeshLambertMaterial({ map: src.map, color: src.color, flatShading: true });
        m.frustumCulled = false;
      });
      cache.set(name, gltf);
    }),
  );
}

interface Chain {
  root: THREE.Bone;
  a: THREE.Bone;
  b: THREE.Bone;
  c: THREE.Bone;
}

const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qw = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

function firstBoneChild(b: THREE.Object3D): THREE.Bone {
  const c = b.children.find((x) => (x as THREE.Bone).isBone) as THREE.Bone | undefined;
  if (!c) throw new Error(`bone ${b.name} has no child bone`);
  return c;
}

/** Descendant count, to follow the main line of a limb rather than a finger. */
function weight(b: THREE.Object3D): number {
  let n = 0;
  b.traverse(() => n++);
  return n;
}

function chainFrom(root: THREE.Bone, skipRoot: boolean): Chain {
  const heaviest = (b: THREE.Object3D) =>
    b.children.filter((x) => (x as THREE.Bone).isBone).sort((x, y) => weight(y) - weight(x))[0] as THREE.Bone;
  const a = skipRoot ? heaviest(root) : root;
  const b = heaviest(a) ?? firstBoneChild(a);
  const c = heaviest(b) ?? b;
  return { root, a, b, c };
}

/** The bone with the largest skin weight for vertex `v`. */
function dominantBone(geo: THREE.BufferGeometry, v: number): number {
  const idx = geo.getAttribute('skinIndex');
  const wt = geo.getAttribute('skinWeight');
  let best = 0;
  let w = -1;
  for (let k = 0; k < 4; k++) {
    const wk = wt.getComponent(v, k);
    if (wk > w) {
      w = wk;
      best = idx.getComponent(v, k);
    }
  }
  return best;
}

/** Triangles (first-index offsets) of the posed mesh with an edge longer than `min` metres. */
export function stretchedTriangles(mesh: THREE.SkinnedMesh, min: number): number[] {
  const index = mesh.geometry.index!;
  const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const out: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    for (let k = 0; k < 3; k++) mesh.getVertexPosition(index.getX(t + k), p[k]).applyMatrix4(mesh.matrixWorld);
    if (Math.max(p[0].distanceTo(p[1]), p[1].distanceTo(p[2]), p[2].distanceTo(p[0])) > min) out.push(t);
  }
  return out;
}

const cleaned = new WeakSet<THREE.BufferGeometry>();

/**
 * A rigged person: plays the generated clips (in game time) and bends bones towards
 * target directions for poses the clips don't cover (aiming, sitting, kneeling, hands up).
 * Root sits at the feet and faces +Z.
 */
export class Person {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly mesh: THREE.SkinnedMesh;
  pose: Pose = 'stand';
  /** World point the gun arm points at, or null. */
  aimAt: THREE.Vector3 | null = null;
  twoHanded = false;
  /** Sideways lean (hostage-takers peeking) and crouch, in metres. */
  lean = 0;
  crouch = 0;

  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private motion: Motion = 'none';
  private hips: THREE.Bone;
  private spine: THREE.Bone;
  private chest: THREE.Bone;
  private head: THREE.Bone;
  private armR: Chain;
  private armL: Chain;
  private legR: Chain;
  private legL: Chain;
  /** Bind-pose rotations, restored every frame when no clip drives the bones. */
  private rest: [THREE.Bone, THREE.Quaternion][] = [];

  constructor(name: PersonModel) {
    const gltf = cache.get(name);
    if (!gltf) throw new Error(`model ${name} not loaded`);
    this.model = SkeletonUtils.clone(gltf.scene);
    // Generated models face +X; turn them to face +Z like the rest of the game.
    this.model.rotation.y = -Math.PI / 2;
    this.root.add(this.model);
    let mesh: THREE.SkinnedMesh | null = null;
    this.model.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
    });
    if (!mesh) throw new Error(`model ${name} has no skinned mesh`);
    this.mesh = mesh;

    this.mixer = new THREE.AnimationMixer(this.model);
    if (!NO_CLIPS.has(name)) for (const clip of gltf.animations) this.actions.set(clip.name.replace('preset:', ''), this.mixer.clipAction(clip));

    // Find the skeleton by shape, not by name: Tripo's bone names mean different things from rig
    // to rig. The head is the unbranched chain ending in the highest bone, the chest is where
    // that chain branches off into the arms, and the legs are the chains ending lowest.
    this.root.updateMatrixWorld(true);
    const isBone = (x: THREE.Object3D | null): x is THREE.Bone => !!x && (x as THREE.Bone).isBone;
    const kids = (b: THREE.Object3D) => b.children.filter(isBone);
    const y = (b: THREE.Object3D) => b.getWorldPosition(_p0).y;
    const bones: THREE.Bone[] = [];
    this.model.traverse((o) => isBone(o) && bones.push(o));
    if (!bones.length) throw new Error(`model ${name} has no bones`);
    let head = bones.reduce((a, b) => (y(b) > y(a) ? b : a));
    while (isBone(head.parent) && kids(head.parent).length === 1) head = head.parent;
    if (!isBone(head.parent)) throw new Error(`model ${name}: no chest bone`);
    this.head = head;
    this.chest = head.parent;
    const torso = new Set<THREE.Object3D>();
    for (let b: THREE.Object3D | null = this.chest; b; b = b.parent) torso.add(b);
    // Each leaf outside the arms and head leads back to a limb root hanging off the torso.
    const lowest = new Map<THREE.Bone, number>();
    for (const leaf of bones) {
      if (kids(leaf).length) continue;
      let b: THREE.Bone = leaf;
      while (isBone(b.parent) && !torso.has(b.parent)) b = b.parent;
      if (b.parent === this.chest || torso.has(b)) continue;
      lowest.set(b, Math.min(lowest.get(b) ?? Infinity, y(leaf)));
    }
    const legRoots = [...lowest.keys()].sort((a, b) => lowest.get(a)! - lowest.get(b)!).slice(0, 2);
    if (legRoots.length < 2) throw new Error(`model ${name}: legs not found`);
    // Hips: the torso bone nearest the height where the legs attach; the spine is the next one up.
    const path: THREE.Bone[] = [];
    for (let b: THREE.Object3D | null = this.chest; isBone(b) && b !== legRoots[0].parent; b = b.parent) path.unshift(b);
    if (isBone(legRoots[0].parent)) path.unshift(legRoots[0].parent);
    const legY = y(legRoots[0]);
    this.hips = path.reduce((a, b) => (Math.abs(y(b) - legY) < Math.abs(y(a) - legY) ? b : a));
    const next = path[path.indexOf(this.hips) + 1];
    this.spine = next && next !== this.chest ? next : this.hips;
    const armRoots = kids(this.chest).filter((x) => x !== this.head);
    // The character faces +Z, so its right side is -X.
    const bySide = (roots: THREE.Bone[], skip: boolean) => {
      const chains = roots.map((r) => chainFrom(r, skip));
      chains.sort((x, y) => x.a.getWorldPosition(_p0).x - y.a.getWorldPosition(_p1).x);
      return { right: chains[0], left: chains[chains.length - 1] };
    };
    const arms = bySide(armRoots, true);
    const legs = bySide(legRoots, false);
    this.armR = arms.right;
    this.armL = arms.left;
    this.legR = legs.right;
    this.legL = legs.left;
    this.model.traverse((o) => isBone(o) && this.rest.push([o, o.quaternion.clone()]));
    this.dropSlivers();
    this.play('idle');
  }

  /**
   * The auto-rigger sometimes weights a few vertices to the wrong bone (typically hip skin to a
   * finger where the hand rests against it), and their triangles stretch into long slivers once
   * the limb moves. Pose the model a few ways and drop every triangle that stretches (once per model).
   */
  private dropSlivers(): void {
    const geo = this.mesh.geometry;
    if (cleaned.has(geo) || !geo.index) return;
    cleaned.add(geo);
    const bad = new Set<number>();
    const probes: [Pose, Motion, number][] = [
      ['held', 'idle', 0],
      ['stand', 'walk', 0.25],
      ['stand', 'walk', 0.75],
      ['stand', 'run', 0.3],
    ];
    for (const [pose, motion, t] of probes) {
      this.pose = pose;
      this.mixer.stopAllAction();
      this.current = null;
      this.motion = 'none';
      this.play(motion, 0);
      this.update(t);
      for (const tri of stretchedTriangles(this.mesh, 0.22)) bad.add(tri);
    }
    this.pose = 'stand';
    this.resetBones();
    this.mixer.stopAllAction();
    this.current = null;
    this.motion = 'none';
    if (!bad.size) return;
    const index = geo.index;
    const kept: number[] = [];
    for (let t = 0; t < index.count; t += 3) if (!bad.has(t)) kept.push(index.getX(t), index.getX(t + 1), index.getX(t + 2));
    geo.setIndex(kept);
  }

  play(m: Motion, fade = 0.2): void {
    if (m === this.motion) return;
    this.motion = m;
    const next = m === 'none' ? null : (this.actions.get(m) ?? this.actions.get('idle') ?? null);
    if (next === this.current) return;
    if (next) {
      next.reset();
      next.setLoop(m === 'hurt' ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      next.clampWhenFinished = true;
      next.play();
      if (this.current) next.crossFadeFrom(this.current, fade, false);
    } else this.current?.fadeOut(fade);
    this.current = next;
  }

  /** Advance the clip (game time) and apply the pose on top. */
  private resetBones(): void {
    for (const [b, q] of this.rest) b.quaternion.copy(q);
  }

  update(dt: number, speed = 1): void {
    this.mixer.timeScale = speed;
    if (this.actions.size) this.mixer.update(dt);
    else this.resetBones();
    this.model.position.set(this.lean, -this.crouch, 0);
    this.root.updateMatrixWorld(true);
    this.applyPose();
    if (this.aimAt) this.applyAim(this.aimAt);
  }

  /** Direction given in the character's own frame (+Z forward, +Y up) → world. */
  private dir(x: number, y: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(x, y, z).normalize().applyQuaternion(this.root.getWorldQuaternion(_qw));
  }

  /** Rotate a bone (in world space) so that the segment towards `child` points along `dir`. */
  private point(bone: THREE.Bone, child: THREE.Bone, dir: THREE.Vector3, amount = 1): void {
    bone.getWorldPosition(_p0);
    child.getWorldPosition(_p1);
    _d.subVectors(_p1, _p0);
    if (_d.lengthSq() < 1e-8) return;
    _d.normalize();
    _q.setFromUnitVectors(_d, dir);
    if (amount < 1) _q.slerp(new THREE.Quaternion(), 1 - amount);
    bone.getWorldQuaternion(_qw).premultiply(_q);
    (bone.parent as THREE.Object3D).getWorldQuaternion(_qp).invert();
    bone.quaternion.copy(_qp.multiply(_qw));
    bone.updateMatrixWorld(true);
  }

  private limb(c: Chain, upper: THREE.Vector3, lower: THREE.Vector3): void {
    this.point(c.a, c.b, upper);
    this.point(c.b, c.c, lower);
  }

  private applyPose(): void {
    const d = (x: number, y: number, z: number) => this.dir(x, y, z);
    switch (this.pose) {
      case 'seated':
        this.model.position.y = -0.42;
        this.root.updateMatrixWorld(true);
        this.limb(this.legR, d(0, -0.15, 1), d(0, -1, 0.05));
        this.limb(this.legL, d(0, -0.15, 1), d(0, -1, 0.05));
        this.limb(this.armR, d(-0.15, -0.55, 1), d(0.1, -0.1, 1));
        this.limb(this.armL, d(0.15, -0.55, 1), d(-0.1, -0.1, 1));
        break;
      case 'cower':
        this.model.position.y = -0.5;
        this.root.updateMatrixWorld(true);
        this.point(this.spine, this.chest, d(0, 0.6, 0.8));
        this.limb(this.legR, d(-0.1, 0.35, 1), d(0, -1, -0.25));
        this.limb(this.legL, d(0.1, 0.35, 1), d(0, -1, -0.25));
        this.limb(this.armR, d(-0.3, 0.8, 0.5), d(0.5, 0.3, -0.2));
        this.limb(this.armL, d(0.3, 0.8, 0.5), d(-0.5, 0.3, -0.2));
        break;
      case 'held':
        this.limb(this.armR, d(-0.35, 1, 0.15), d(0, 1, 0));
        this.limb(this.armL, d(0.35, 1, 0.15), d(0, 1, 0));
        break;
      case 'kneel':
        this.model.position.y = -0.4;
        this.root.updateMatrixWorld(true);
        this.point(this.spine, this.chest, d(0, 0.75, 0.65));
        this.limb(this.legR, d(0, -0.1, 1), d(0, -1, 0));
        this.limb(this.legL, d(0, -1, 0.1), d(0, -0.05, -1));
        this.limb(this.armR, d(-0.1, -0.7, 0.7), d(0, -0.6, 0.8));
        this.limb(this.armL, d(0.1, -0.7, 0.7), d(0, -0.6, 0.8));
        break;
      case 'prone':
        // The root is laid down by the owner; keep the arms along the body.
        this.limb(this.armR, d(-0.15, -1, 0), d(-0.05, -1, 0.1));
        this.limb(this.armL, d(0.3, -1, 0.1), d(0.4, -0.6, 0.6));
        break;
      default:
        break;
    }
  }

  /** Straight gun arm towards the target; the other hand supports an SMG. */
  private applyAim(target: THREE.Vector3): void {
    this.armR.a.getWorldPosition(_p0);
    const dir = new THREE.Vector3().subVectors(target, _p0).normalize();
    this.limb(this.armR, dir, dir);
    if (this.twoHanded) {
      this.armL.a.getWorldPosition(_p1);
      const hand = this.armR.c.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, 0.12);
      const d2 = hand.sub(_p1).normalize();
      this.limb(this.armL, d2, d2);
    }
  }

  /** Where a held gun goes: at the right hand, barrel along the aim (or the forearm). */
  gunTransform(outPos: THREE.Vector3, outQuat: THREE.Quaternion): void {
    const hand = this.armR.c.getWorldPosition(outPos);
    const fore = this.armR.b.getWorldPosition(_p1);
    const dir = this.aimAt ? _d.subVectors(this.aimAt, hand).normalize() : _d.subVectors(hand, fore).normalize();
    hand.addScaledVector(dir, 0.05);
    // Matrix4.lookAt points local -Z from eye to target: the barrel.
    _m.lookAt(hand, _p0.copy(hand).add(dir), UP);
    outQuat.setFromRotationMatrix(_m);
  }

  headPos(out: THREE.Vector3): THREE.Vector3 {
    this.head.getWorldPosition(out);
    return out.addScaledVector(UP.clone().applyQuaternion(this.root.getWorldQuaternion(_qw)), 0.09);
  }

  chestPos(out: THREE.Vector3): THREE.Vector3 {
    return this.chest.getWorldPosition(out);
  }

  pelvisPos(out: THREE.Vector3): THREE.Vector3 {
    this.hips.getWorldPosition(out);
    return out.addScaledVector(UP.clone().applyQuaternion(this.root.getWorldQuaternion(_qw)), -0.25);
  }

  /**
   * Freeze the current pose into static meshes, one per body part (head, torso, arms, legs),
   * moved into `scene` for the shatter effect.
   */
  breakApart(scene: THREE.Object3D): THREE.Object3D[] {
    this.root.updateMatrixWorld(true);
    const mesh = this.mesh;
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position');
    const uv = geo.getAttribute('uv');
    const bones = mesh.skeleton.bones;
    const partOfBone = new Map<THREE.Bone, number>();
    const tag = (b: THREE.Object3D, part: number) => b.traverse((x) => (x as THREE.Bone).isBone && partOfBone.set(x as THREE.Bone, part));
    tag(this.hips.parent ?? this.hips, 0); // torso by default
    tag(this.head, 1);
    tag(this.armR.root, 2);
    tag(this.armL.root, 3);
    tag(this.legR.root, 4);
    tag(this.legL.root, 5);

    const index = geo.index;
    const triCount = (index ? index.count : pos.count) / 3;
    const vtx = (i: number) => (index ? index.getX(i) : i);
    const dominant = (v: number) => partOfBone.get(bones[dominantBone(geo, v)]) ?? 0;
    const parts: { pos: number[]; uv: number[] }[] = Array.from({ length: 6 }, () => ({ pos: [], uv: [] }));
    const p = new THREE.Vector3();
    for (let t = 0; t < triCount; t++) {
      const a = vtx(t * 3);
      const part = parts[dominant(a)];
      for (let k = 0; k < 3; k++) {
        const v = vtx(t * 3 + k);
        mesh.getVertexPosition(v, p);
        p.applyMatrix4(mesh.matrixWorld);
        part.pos.push(p.x, p.y, p.z);
        if (uv) part.uv.push(uv.getX(v), uv.getY(v));
      }
    }
    const out: THREE.Object3D[] = [];
    for (const part of parts) {
      if (!part.pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(part.pos, 3));
      if (part.uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(part.uv, 2));
      g.computeBoundingBox();
      const center = g.boundingBox!.getCenter(new THREE.Vector3());
      g.translate(-center.x, -center.y, -center.z);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mesh.material as THREE.Material);
      m.position.copy(center);
      scene.add(m);
      out.push(m);
    }
    this.root.removeFromParent();
    return out;
  }
}
