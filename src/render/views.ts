import * as THREE from 'three';

import {
  BODY_PLANS,
  QUALITY_METAL,
  bodyPlanFor,
  bodyPlanForClass,
  offhandLookFor,
  offhandParts,
  weaponLookFor,
  weaponParts,
  type BodyPart,
  type BodyPlan,
  type Joint,
} from '../content/bodies.js';
import { heldGeometry, jointedBody, mergeBody } from './body.js';
import { AnimStateMachine } from './anim.js';
import { CLASSES } from '../content/zone.js';
import { getMount } from '../content/mounts.js';
import { getMob } from '../content/mobs.js';
import { getItem } from '../content/items.js';
import { DISCOVERY_SIGHT } from '../content/discoveries.js';
import { getVendor } from '../content/vendors.js';
import { TICK_MS } from '../sim/formulas.js';
import { clipFor, modelFor, setModelOverride, type ModelDef, type ModelState } from '../content/models.js';
import { ModelLibrary } from './models.js';
import type { DamageType, Entity, EntityId } from '../sim/types.js';
import type { World } from '../sim/world.js';

/**
 * One visual representation per sim entity.
 *
 * Views hold *no* gameplay state. They read the sim each frame and interpolate
 * between the last two tick positions, which is exactly what a network client
 * does with snapshots — so this loop already has the right shape for multiplayer.
 */
/**
 * One library for the whole game, so a camp of eight wolves fetches one file.
 *
 * Module-scoped rather than injected: it holds nothing but a cache, every
 * `EntityView` wants the same one, and threading it through four constructors
 * would be ceremony around a map.
 */
const MODELS_LIBRARY = new ModelLibrary();

/**
 * What a school of damage looks like when it lands.
 *
 * The same four the sim already distinguishes. Worth colouring because it is
 * free information: a Mage's frost bolt and a wolf's teeth arriving on the same
 * frame are two different events, and the log is too slow to say so.
 */
const DAMAGE_COLOURS: Record<DamageType, number> = {
  physical: 0xffd9a0,
  fire: 0xff7a33,
  frost: 0x8fd8ff,
  nature: 0x9de06a,
};

export class EntityView {
  readonly group = new THREE.Group();
  readonly anim: AnimStateMachine;
  /** Inner node the animator transforms, so group position stays authoritative. */
  private readonly body = new THREE.Group();
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly selectionRing: THREE.Mesh;

  prev = new THREE.Vector3();
  next = new THREE.Vector3();
  prevFacing = 0;
  nextFacing = 0;

  /**
   * Which mob definition this body was built from.
   *
   * A spawn point can change creature under an entity — that is exactly what a
   * rare spawn is — and the capsule is built once at construction. Without
   * this, a named rare took over the point and rendered at the camp mob's size:
   * the one thing that is meant to make it visible across a field.
   */
  readonly builtFrom: string | undefined;

  /** Seconds of red flash remaining after taking damage. */
  private flash = 0;
  /**
   * The real model's materials, once it has arrived.
   *
   * Kept as a list because the damage flash is the one thing that has to reach
   * into the art: tinting only the hidden capsule means a creature with a model
   * takes a hit and shows nothing, and "did that land?" is not a question a
   * combat game should make you ask.
   */
  private modelMaterials: THREE.MeshStandardMaterial[] = [];
  /** How long this body has been dying, for the fade. */
  private dyingMs = 0;
  private fading = false;
  /** The model currently on, so trying another one replaces rather than stacks. */
  private dressed: THREE.Object3D | null = null;
  /** Height this body was authored at, for re-fitting a swapped model. */
  private readonly builtHeight: number;
  /** True once real art is standing where the capsule was. */
  get hasModel(): boolean {
    return this.dressed !== null;
  }
  /**
   * Limbs that move on their own, for the few bodies built with joints.
   * Empty for an ordinary creature, whose body is one welded geometry.
   */
  readonly joints = new Map<Joint, THREE.Mesh>();
  /** What this body is shaped like — kept for re-gripping a new weapon. */
  private readonly plan: BodyPlan;
  /** What is in the hands right now, so an unchanged loadout rebuilds nothing. */
  private gearKey = '';
  private held: THREE.Mesh[] = [];
  /** Overhead "interact with me" marker; vendors only. */
  private marker: THREE.Mesh | null = null;
  /** A small gold mark over a corpse that still has something on it. */
  private lootMark: THREE.Mesh | null = null;
  /** The horse under the player, when they are riding one. */
  private mount: THREE.Group | null = null;
  private mountId: string | null = null;

  constructor(
    readonly id: EntityId,
    entity: Entity,
    /**
     * Ground height under a world position. The sim is flat — this is the only
     * thing that puts an entity on a hill rather than through it.
     */
    private readonly groundAt: (x: number, z: number) => number,
  ) {
    this.builtFrom = entity.defId;
    const view =
      entity.kind === 'mob'
        ? getMob(entity.defId!).view
        : entity.kind === 'vendor'
          ? getVendor(entity.vendorId!).view
          : { color: CLASSES[entity.classId ?? 'warrior'].color, height: 1.8, radius: 0.42 };

    this.builtHeight = view.height;

    // What this creature is shaped like. `content/bodies.ts` says; this file
    // only decides how much of that shape is allowed to move.
    const plan =
      entity.kind === 'mob'
        ? bodyPlanFor(getMob(entity.defId!))
        : entity.kind === 'vendor'
          ? BODY_PLANS.person
          : bodyPlanForClass(entity.classId ?? 'warrior');

    // Vertex colours carry the per-part shading — a tusk reads as bone, a
    // blade as steel — and the material colour multiplies them, so the damage
    // flash still reddens the whole body with one assignment.
    this.material = new THREE.MeshStandardMaterial({
      color: view.color,
      roughness: 0.7,
      metalness: 0.05,
      vertexColors: true,
    });

    // Six hundred creatures a zone can only afford one draw call each, so an
    // ordinary creature's whole body is welded into a single geometry and its
    // legs cannot move on their own. The handful of figures the player is
    // actually close to get real joints — a running figure with rigid legs is
    // a mannequin on a conveyor belt, and the player is looking at theirs the
    // entire game.
    const articulate = entity.kind !== 'mob';
    this.plan = plan;
    if (articulate) {
      const built = jointedBody(plan, view.height, view.radius);
      this.mesh = new THREE.Mesh(built.trunk, this.material);
      this.mesh.castShadow = true;
      this.body.add(this.mesh);
      for (const part of built.parts) {
        const limb = new THREE.Mesh(part.geometry, this.material);
        limb.castShadow = true;
        limb.position.copy(part.pivot);
        this.body.add(limb);
        this.joints.set(part.joint, limb);
      }
      // Whatever they are carrying right now, hung off the arm that swings it.
      this.setGear(entity);
    } else {
      // An ordinary creature's weapon is welded in with the rest of it: a camp
      // of outlaws is six hundred draw calls' worth of reasons not to give
      // each of them a sword of their own.
      const carried = plan.carries ? weaponParts(plan.carries) : [];
      this.mesh = new THREE.Mesh(mergeBody(plan, view.height, view.radius, carried), this.material);
      this.mesh.castShadow = true;
      this.body.add(this.mesh);
    }
    this.group.add(this.body);

    const ringGeo = new THREE.RingGeometry(view.radius * 1.3, view.radius * 1.6, 24);
    ringGeo.rotateX(-Math.PI / 2);
    this.selectionRing = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: 0xffcc44, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.selectionRing.position.y = 0.03;
    this.selectionRing.visible = false;
    this.group.add(this.selectionRing);

    if (entity.kind === 'vendor') {
      // A slowly turning gold marker overhead: the only thing on screen that
      // says "walk here and press E".
      const markerGeo = new THREE.OctahedronGeometry(0.28, 0);
      this.marker = new THREE.Mesh(
        markerGeo,
        new THREE.MeshBasicMaterial({ color: 0xf0c94c, transparent: true, opacity: 0.95 }),
      );
      this.marker.position.y = view.height + 0.9;
      this.group.add(this.marker);
    }

    this.anim = new AnimStateMachine(this.body, view.height, this.joints, plan.pivot);

    // And if somebody has made art for this thing, put it on. Asynchronous on
    // purpose: the capsule is built and standing before the fetch even starts,
    // so a slow or missing file costs nothing and a creature never fails to
    // exist because its model did.
    const kind = entity.kind === 'mob' ? 'mob' : entity.kind === 'vendor' ? 'vendor' : 'class';
    const modelId =
      entity.kind === 'mob'
        ? entity.defId!
        : entity.kind === 'vendor'
          ? entity.vendorId!
          : (entity.classId ?? 'warrior');
    const def = modelFor(kind, modelId);
    if (def) void this.dressIn(def, view.height);

    // Tag every descendant so a click raycast can resolve back to an entity.
    this.group.userData.entityId = id;
    this.group.traverse((o) => {
      o.userData.entityId = id;
    });

    this.prev.set(entity.pos.x, this.groundAt(entity.pos.x, entity.pos.z), entity.pos.z);
    this.next.copy(this.prev);
    this.group.position.copy(this.prev);
  }

  /** Called once per sim tick: last tick's target becomes this tick's origin. */
  pushTick(entity: Entity): void {
    this.prev.copy(this.next);
    this.next.set(entity.pos.x, this.groundAt(entity.pos.x, entity.pos.z), entity.pos.z);
    this.prevFacing = this.nextFacing;
    this.nextFacing = entity.facing;
    const dx = this.next.x - this.prev.x;
    const dz = this.next.z - this.prev.z;
    // One tick's ground covered, expressed as a speed: the gait is chosen from
    // how fast the thing is actually going, not from whether it moved at all.
    this.anim.setMoving(Math.hypot(dx, dz) / (TICK_MS / 1000));
  }

  /**
   * Swap the capsule for a real model, once it loads.
   *
   * The capsule is *hidden*, not removed. It still carries the entity-id tags
   * the click raycast resolves against and it is the thing every measurement in
   * this file was written against; a model with a hole in its silhouette would
   * otherwise become unclickable, which is a worse bug than an ugly wolf.
   */
  async dressIn(def: ModelDef, height = this.builtHeight): Promise<void> {
    const loaded = await MODELS_LIBRARY.get(def, height);
    if (!loaded) return;

    // Take the previous model off first, so trying a second file replaces the
    // wolf rather than standing a second wolf inside it.
    if (this.dressed) {
      this.body.remove(this.dressed);
      this.dressed = null;
      this.modelMaterials = [];
    }
    this.mesh.visible = false;
    for (const child of this.body.children) child.visible = false;
    this.body.add(loaded.root);
    this.dressed = loaded.root;

    loaded.root.traverse((o: THREE.Object3D) => {
      o.userData.entityId = this.id;
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Clone the material per entity: art files share one material across
      // every clone, so flashing one wolf red would flash the whole camp.
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mesh.material = Array.isArray(mesh.material)
        ? mats.map((m) => m.clone())
        : mats[0]!.clone();
      const mine = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mine) {
        if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
          this.modelMaterials.push(m as THREE.MeshStandardMaterial);
        }
      }
    });

    const names = loaded.clips.map((c) => c.name);
    const wanted: ModelState[] = ['idle', 'walk', 'run', 'attack', 'cast', 'hit', 'death'];
    const chosen = new Map<ModelState, THREE.AnimationClip>();
    for (const state of wanted) {
      const name = clipFor(state, names, def.clips);
      const clip = loaded.clips.find((c) => c.name === name);
      if (clip) chosen.set(state, clip);
    }
    this.anim.attachModel(loaded.root, chosen);
  }

  onDamaged(): void {
    this.flash = 0.18;
    this.anim.request('hit');
  }

  /**
   * Put a horse under the rider, or take it away.
   *
   * Built here rather than as its own entity because a mount is not one: the
   * sim has a string on the player and nothing else. This is the renderer's
   * whole share of the feature.
   */
  setMount(mountId: string | null): void {
    if (mountId === this.mountId) return;
    this.mountId = mountId;
    if (this.mount) {
      this.body.remove(this.mount);
      this.mount.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
      });
      this.mount = null;
    }
    if (!mountId) {
      this.body.position.y = 0;
      return;
    }
    const def = getMount(mountId);
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: def.view.color, roughness: 0.85 });
    const barrel = new THREE.Mesh(new THREE.CapsuleGeometry(def.view.radius * 0.55, 1.5, 4, 10), mat);
    barrel.rotation.z = Math.PI / 2;
    barrel.position.y = def.view.height * 0.55;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 0.9, 6), mat);
    neck.position.set(0, def.view.height * 0.85, def.view.radius * 0.75);
    neck.rotation.x = 0.5;
    group.add(barrel, neck);
    for (const [x, z] of [
      [-0.35, 0.5],
      [0.35, 0.5],
      [-0.35, -0.5],
      [0.35, -0.5],
    ] as Array<[number, number]>) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, def.view.height * 0.55, 5), mat);
      leg.position.set(x, def.view.height * 0.27, z);
      group.add(leg);
    }
    group.traverse((o) => {
      o.castShadow = true;
    });
    this.mount = group;
    this.body.add(group);
    // Sit the rider on its back.
    this.body.position.y = def.view.height * 0.62;
  }

  /** `alpha` is the fraction of the way through the current sim tick. */
  update(alpha: number, dtMs: number, selected: boolean, baseColor: number): void {
    this.group.position.lerpVectors(this.prev, this.next, alpha);
    this.group.rotation.y = lerpAngle(this.prevFacing, this.nextFacing, alpha);
    this.selectionRing.visible = selected;

    if (this.flash > 0) {
      // Clamped for the same reason the impact burst is: on a slow machine a
      // single frame is longer than the flash, and an unclamped subtraction
      // means the hit reaction never renders once.
      this.flash -= Math.min(dtMs, 60) / 1000;
      this.material.color.setHex(0xff5555);
      for (const m of this.modelMaterials) m.emissive.setHex(0x882222);
    } else {
      this.material.color.setHex(baseColor);
      for (const m of this.modelMaterials) m.emissive.setHex(0x000000);
    }

    // Dying is a topple and then a fade, not a topple and then a disappearance.
    // A corpse that vanishes between two frames is the moment a fight stops
    // feeling like it happened.
    const dying = this.anim.current === 'death';
    if (dying !== this.fading) {
      this.fading = dying;
      this.material.transparent = dying;
      for (const m of this.modelMaterials) m.transparent = dying;
    }
    if (dying) {
      this.dyingMs += dtMs;
      // Holds solid for the topple, then goes over the last third of it.
      const t = Math.max(0, Math.min(1, (this.dyingMs - 700) / 900));
      const alpha = 1 - t * 0.75;
      this.material.opacity = alpha;
      for (const m of this.modelMaterials) m.opacity = alpha;
    } else if (this.dyingMs !== 0) {
      this.dyingMs = 0;
      this.material.opacity = 1;
      for (const m of this.modelMaterials) m.opacity = 1;
    }
    if (this.marker) {
      this.marker.rotation.y += dtMs * 0.0022;
      this.marker.position.y += Math.sin(performance.now() * 0.0022) * 0.0025;
    }
    if (this.lootMark) {
      // Turning rather than bobbing: a corpse's own fade is already moving,
      // and two things drifting at once reads as a rendering fault.
      this.lootMark.rotation.y += dtMs * 0.003;
    }
    this.anim.update(dtMs);
  }

  /**
   * Mark a corpse that still has something on it.
   *
   * The nameplate already says "press F to loot" — from thirteen metres, in a
   * camp where you have just killed four things and the plates are stacked on
   * top of each other. What is needed is the opposite of a label: something
   * with no text that reads at any distance, so "there is loot over there" is
   * answered by looking rather than by walking back to check.
   */
  setLootMark(on: boolean, height: number): void {
    if (on === (this.lootMark !== null)) return;
    if (!on) {
      this.lootMark!.geometry.dispose();
      (this.lootMark!.material as THREE.Material).dispose();
      this.group.remove(this.lootMark!);
      this.lootMark = null;
      return;
    }
    const mark = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.2, 0),
      // Unlit and depth-written-through, so it is legible against a dark hill
      // and through the grass a corpse is lying in.
      new THREE.MeshBasicMaterial({
        color: 0xf0c94c,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      }),
    );
    mark.position.y = height + 0.7;
    mark.userData.entityId = this.id;
    this.group.add(mark);
    this.lootMark = mark;
  }

  /**
   * Put what they are actually carrying in their hands.
   *
   * Every other piece of gear in this game is a number in a panel. A weapon is
   * the one you are looking at for the whole game, and a character who picks
   * up a spear and goes on swinging the same abstract blade is a character
   * whose equipment screen might as well be a spreadsheet.
   *
   * Cheap to call every frame: it hashes the loadout and does nothing at all
   * unless something actually changed.
   */
  setGear(entity: Entity): void {
    if (!this.plan.hand || this.joints.size === 0) return;
    const mainId = entity.equipment?.weapon;
    const offId = entity.equipment?.offhand;
    const key = `${mainId ?? ''}|${offId ?? ''}`;
    if (key === this.gearKey) return;
    this.gearKey = key;

    for (const mesh of this.held) {
      mesh.parent?.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.held = [];

    const main = mainId ? getItem(mainId) : undefined;
    const off = offId ? getItem(offId) : undefined;
    const look = weaponLookFor(main?.name, entity.classId);
    // A bow is held across the body in the hand that is not drawing it, which
    // is the off hand — the same hand a shield goes in, so it takes priority.
    const bow = look === 'bow';
    this.grip(weaponParts(look), bow ? 'off' : 'main', main?.quality ?? 'common');
    if (!bow) {
      this.grip(offhandParts(offhandLookFor(off?.name)), 'off', off?.quality ?? 'common');
    }
  }

  /** Hang one weapon off the arm that swings it. */
  private grip(parts: BodyPart[], hand: 'main' | 'off', quality: string): void {
    const geo = heldGeometry(parts, this.builtHeight);
    if (!geo || !this.plan.hand) return;
    const limb = this.joints.get(hand === 'main' ? 'armR' : 'armL');
    if (!limb) {
      geo.dispose();
      return;
    }
    // Its own material, tinted by the item's quality: this is the one place
    // where the difference between a rusted blade and a Sovereign one is
    // visible from across a camp rather than only in a tooltip.
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: QUALITY_METAL[quality] ?? QUALITY_METAL.common,
        roughness: 0.45,
        metalness: 0.35,
        vertexColors: true,
      }),
    );
    mesh.castShadow = true;
    // The grip is in the creature's own space; the limb it hangs from has
    // already been re-origined onto its own hinge.
    const grip = this.plan.hand[hand];
    mesh.position.set(
      grip[0] * this.builtHeight - limb.position.x,
      grip[1] * this.builtHeight - limb.position.y,
      grip[2] * this.builtHeight - limb.position.z,
    );
    mesh.userData.entityId = this.id;
    limb.add(mesh);
    this.held.push(mesh);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    for (const limb of this.joints.values()) limb.geometry.dispose();
    for (const mesh of this.held) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    if (this.lootMark) {
      this.lootMark.geometry.dispose();
      (this.lootMark.material as THREE.Material).dispose();
    }
    this.material.dispose();
  }
}

/** Shortest-path angular interpolation, so facing never spins the long way. */
function lerpAngle(a: number, b: number, t: number): number {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * The danger circle drawn on the ground while a boss winds up an AoE.
 *
 * This is the entire point of telegraphed abilities: the player has to be able
 * to see the radius and judge whether they are clear of it. It fills from the
 * centre outwards over the cast so the remaining time is readable at a glance.
 */
/**
 * The flash where a hit lands.
 *
 * Combat's only feedback used to be a number floating up and the target
 * briefly turning red — which tells you a hit *happened* somewhere on that
 * creature, and nothing about where, how hard, or with what. In a game where
 * the whole loop is hitting things, that is the thing worth spending frames on.
 *
 * Deliberately built from two shapes rather than a particle system: a flat
 * expanding ring reads as impact from any camera angle, and a handful of
 * radiating spokes reads as force. A cloud of billboarded sprites costs more
 * and — at this art level, against capsules — looks like a bug.
 */
class ImpactBurst {
  readonly group = new THREE.Group();
  private readonly ring: THREE.Mesh;
  private readonly spokes: THREE.LineSegments | null;
  private elapsed = 0;
  private readonly life: number;

  constructor(
    at: THREE.Vector3,
    /** Bigger for a bigger hit — scaled off damage, not off the creature. */
    readonly scale: number,
    colour: number,
    crit: boolean,
  ) {
    this.life = crit ? 340 : 200;
    this.group.position.copy(at);

    const ringGeo = new THREE.RingGeometry(0.3, 0.44, 18);
    this.ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({
        color: colour,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.group.add(this.ring);

    if (crit) {
      // Spokes only on a crit. A burst that always has them stops meaning
      // anything, and "did that crit" is the one question the flash can answer
      // faster than the floating number can.
      const spokeCount = 7;
      const pos = new Float32Array(spokeCount * 6);
      for (let i = 0; i < spokeCount; i++) {
        const a = (i / spokeCount) * Math.PI * 2 + 0.3;
        const inner = 0.35;
        const outer = 0.95;
        pos[i * 6] = Math.cos(a) * inner;
        pos[i * 6 + 1] = Math.sin(a) * inner;
        pos[i * 6 + 3] = Math.cos(a) * outer;
        pos[i * 6 + 4] = Math.sin(a) * outer;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.spokes = new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 1, depthWrite: false }),
      );
      this.group.add(this.spokes);
    } else {
      this.spokes = null;
    }
  }

  /** Faces the camera, so a flat ring reads as impact from anywhere. */
  update(dtMs: number, camera: THREE.Camera): boolean {
    // Never advance more than a third of the effect's life in one frame.
    //
    // A frame can be 250ms on a machine drawing four of them a second, and a
    // 300ms flash timed against real elapsed time is then *skipped entirely* —
    // the player sees nothing at all, which is worse than seeing it slowly.
    // Every short effect in this renderer wants this: they are there to be
    // seen, and a frame is the smallest unit of being seen.
    this.elapsed += Math.min(dtMs, this.life / 3);
    const t = Math.min(1, this.elapsed / this.life);
    // Fast out, slow stop: a burst that expands linearly reads as a bubble.
    const eased = 1 - Math.pow(1 - t, 3);
    this.group.scale.setScalar(this.scale * (0.4 + eased * 1.3));
    this.group.quaternion.copy(camera.quaternion);
    const fade = 1 - t;
    (this.ring.material as THREE.MeshBasicMaterial).opacity = fade * 0.95;
    if (this.spokes) (this.spokes.material as THREE.LineBasicMaterial).opacity = fade;
    return t < 1;
  }

  dispose(): void {
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
    this.spokes?.geometry.dispose();
    if (this.spokes) (this.spokes.material as THREE.Material).dispose();
  }
}

/**
 * Dangerous ground, drawn as a slowly churning stain rather than a red circle.
 *
 * Deliberately unlike a telegraph: a telegraph is bright, growing and about to
 * happen, and this is dull, static and already happening. A player has to be
 * able to tell "get out of the way" from "do not stand there" without reading
 * anything.
 */
class HazardPatch {
  readonly group = new THREE.Group();
  private readonly fill: THREE.Mesh;
  private readonly rim: THREE.Mesh;
  private elapsed = 0;
  private ending = false;

  constructor(
    readonly id: number,
    radius: number,
    private readonly durationMs: number,
  ) {
    const fillGeo = new THREE.CircleGeometry(radius, 36);
    fillGeo.rotateX(-Math.PI / 2);
    this.fill = new THREE.Mesh(
      fillGeo,
      new THREE.MeshBasicMaterial({
        color: 0x3d1a2a,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    );

    const rimGeo = new THREE.RingGeometry(radius * 0.88, radius, 36);
    rimGeo.rotateX(-Math.PI / 2);
    this.rim = new THREE.Mesh(
      rimGeo,
      new THREE.MeshBasicMaterial({
        color: 0x9a4a3a,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
      }),
    );
    this.rim.position.y = 0.01;
    this.group.add(this.fill, this.rim);
  }

  /** The sim decides when it is gone; this just fades it out. */
  expire(): void {
    this.ending = true;
  }

  update(dtMs: number): boolean {
    this.elapsed += dtMs;
    this.group.rotation.y += dtMs * 0.00022;
    const life = this.ending ? 0 : 1 - Math.min(1, this.elapsed / this.durationMs);
    // Fades over the last fifth, so it stops being dangerous visibly rather
    // than vanishing between two frames.
    const fade = Math.min(1, life / 0.2);
    (this.fill.material as THREE.MeshBasicMaterial).opacity = 0.5 * fade;
    (this.rim.material as THREE.MeshBasicMaterial).opacity = 0.65 * fade;
    return fade > 0.01;
  }

  dispose(): void {
    this.fill.geometry.dispose();
    this.rim.geometry.dispose();
    (this.fill.material as THREE.Material).dispose();
    (this.rim.material as THREE.Material).dispose();
  }
}

/**
 * The mark over a landmark that still holds something.
 *
 * A landmark is how you navigate: you steer by the watchtower, you never go to
 * it. This is what turns one into a destination — a slow pale glimmer you can
 * pick out from ninety metres, which is well past nameplate range and short of
 * the fog, because a mark you can only see from on top of the thing does not
 * change how anybody walks.
 *
 * Deliberately not a map pin and not a quest arrow. Both of those turn a map
 * into a checklist, and walking a checklist is errand-running. This is only
 * ever visible when the place itself is.
 */
class SiteMark {
  readonly group = new THREE.Group();
  private readonly beam: THREE.Mesh;
  private readonly mote: THREE.Mesh;
  private phase = Math.random() * Math.PI * 2;

  constructor(readonly siteId: string, x: number, y: number, z: number, boon: boolean) {
    // Green for a blessing, gold for what somebody left behind — the same two
    // meanings the landmark's own shape already carries, said again in colour
    // for anyone reading it at distance.
    const colour = boon ? 0x9fd08a : 0xe0b95a;
    const shared = {
      color: colour,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    } as const;
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 1.1, 9, 7, 1, true),
      new THREE.MeshBasicMaterial({ ...shared, opacity: 0.16, side: THREE.DoubleSide }),
    );
    // Clear of the landmark itself. A cairn is a four-metre stack of stones
    // and the first version put the mote inside it, which is a light source
    // with a rock in front of it.
    this.beam.position.y = 8.5;
    this.mote = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.42, 0),
      new THREE.MeshBasicMaterial({ ...shared, opacity: 0.9 }),
    );
    this.mote.position.y = 5.2;
    this.group.add(this.beam, this.mote);
    this.group.position.set(x, y, z);
    // Tagged so `smoke` can count them without knowing what they are made of.
    this.group.userData.siteMark = siteId;
  }

  update(dtMs: number): void {
    this.phase += dtMs / 1000;
    this.mote.rotation.y += dtMs * 0.0016;
    this.mote.position.y = 5.2 + Math.sin(this.phase * 1.3) * 0.26;
    // Breathing rather than blinking. A blink at this size across a whole zone
    // reads as a rendering fault; a slow swell reads as something being there.
    const swell = 0.72 + Math.sin(this.phase * 0.9) * 0.28;
    (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.1 + swell * 0.1;
    (this.mote.material as THREE.MeshBasicMaterial).opacity = 0.55 + swell * 0.4;
  }

  dispose(): void {
    for (const m of [this.beam, this.mote]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}

class TelegraphRing {
  readonly group = new THREE.Group();
  private readonly fill: THREE.Mesh;
  private readonly rim: THREE.Mesh;
  /** The faint full-size wedge under a cone's fill. Circles use the rim instead. */
  private bounds: THREE.Mesh | null = null;
  private elapsed = 0;

  constructor(
    readonly sourceId: EntityId,
    readonly radius: number,
    readonly durationMs: number,
    /**
     * A cone rather than a circle, and where it is aimed.
     *
     * Drawn as a wedge because the answer to it is different: a circle says
     * "get further away", a wedge says "get round the side", and a player who
     * cannot tell them apart at a glance has been given one mechanic wearing
     * two hats.
     */
    readonly cone?: { facing: number; arc: number },
    /** Ground-anchored telegraphs sit here instead of on the caster. */
    readonly at?: { x: number; z: number },
  ) {
    const fillGeo = cone
      ? new THREE.CircleGeometry(1, 40, -cone.arc / 2 - Math.PI / 2, cone.arc)
      : new THREE.CircleGeometry(1, 40);
    fillGeo.rotateX(-Math.PI / 2);
    this.fill = new THREE.Mesh(
      fillGeo,
      new THREE.MeshBasicMaterial({
        color: 0xff3a24,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
      }),
    );
    this.fill.position.y = 0.05;

    const rimGeo = cone
      ? new THREE.RingGeometry(radius * 0.95, radius, 48, 1, -cone.arc / 2 - Math.PI / 2, cone.arc)
      : new THREE.RingGeometry(radius * 0.95, radius, 48);
    rimGeo.rotateX(-Math.PI / 2);
    this.rim = new THREE.Mesh(
      rimGeo,
      new THREE.MeshBasicMaterial({
        color: 0xff6a4a,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );
    this.rim.position.y = 0.06;

    this.group.add(this.fill, this.rim);

    // A faint full-size shape under the growing fill.
    //
    // A circle gets its extent from the rim: a bright ring at the edge, on
    // screen from the first frame. A cone's rim is a thin arc twelve metres
    // away, usually behind the camera — so with only a fill that grows from
    // the caster's feet, the first readable frame of a cleave is the one where
    // it is already too late to leave. The outline says how far it reaches
    // immediately; the fill still says when.
    if (cone) {
      const boundsGeo = new THREE.CircleGeometry(radius, 40, -cone.arc / 2 - Math.PI / 2, cone.arc);
      boundsGeo.rotateX(-Math.PI / 2);
      this.bounds = new THREE.Mesh(
        boundsGeo,
        new THREE.MeshBasicMaterial({
          color: 0xff7a4a,
          transparent: true,
          opacity: 0.3,
          depthWrite: false,
        }),
      );
      this.bounds.position.y = 0.04;
      this.group.add(this.bounds);
    }

    // A cone is aimed once, when the cast begins, and the mob is rooted for
    // the whole wind-up — so the wedge drawn is the wedge that lands. Rotating
    // it to follow the caster afterwards would make it a lie.
    if (cone) this.group.rotation.y = cone.facing;
  }

  /** Returns false once the telegraph has run its course and should be removed. */
  update(dtMs: number, center: THREE.Vector3): boolean {
    this.elapsed += dtMs;
    const t = Math.min(1, this.elapsed / this.durationMs);
    // Sit on the ground under the caster, unless this one was stamped onto a
    // spot — a `fixate` marks where you were standing and lands there, so
    // following the caster would put the circle somewhere it will not hit.
    // Boss arenas are levelled by the height field precisely so this reads as
    // a flat shape.
    this.group.position.set(center.x, center.y, center.z);
    this.fill.scale.setScalar(Math.max(0.001, this.radius * t));
    // Pulse faster as it approaches detonation.
    const pulse = 0.6 + 0.4 * Math.sin(this.elapsed * 0.012 * (1 + t * 2));
    (this.rim.material as THREE.MeshBasicMaterial).opacity = 0.5 + pulse * 0.45;
    // Linger briefly after resolution so the hit reads.
    return this.elapsed < this.durationMs + 160;
  }

  dispose(): void {
    this.fill.geometry.dispose();
    this.rim.geometry.dispose();
    (this.fill.material as THREE.Material).dispose();
    (this.rim.material as THREE.Material).dispose();
    this.bounds?.geometry.dispose();
    if (this.bounds) (this.bounds.material as THREE.Material).dispose();
    this.bounds?.geometry.dispose();
    if (this.bounds) (this.bounds.material as THREE.Material).dispose();
  }
}

/**
 * Owns the view collection and keeps it in sync with the sim's entity set.
 */
export class ViewManager {
  private views = new Map<EntityId, EntityView>();
  private telegraphs: TelegraphRing[] = [];
  private hazardPatches: HazardPatch[] = [];
  /** One per unopened landmark in this zone, built once and kept. */
  private siteMarks = new Map<string, SiteMark>();
  private bursts: ImpactBurst[] = [];
  /**
   * Camera shake left to spend, in world units.
   *
   * The renderer's share of "that hit hard". Deliberately tiny and short: a
   * shake big enough to notice consciously is a shake that makes a telegraph
   * harder to read, and this game asks you to read telegraphs.
   */
  private shake = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: World,
    private readonly groundAt: (x: number, z: number) => number = () => 0,
    /**
     * How far you can actually see, which is the fog and therefore the
     * weather. Read through a thunk rather than captured: mist cuts it to a
     * third, and a range that did not follow it would keep drawing a field of
     * creatures nobody can see.
     */
    private readonly visibleRange: () => number = () => 500,
    /** Needed only so an impact flash can face the viewer. */
    private readonly camera: THREE.Camera = new THREE.PerspectiveCamera(),
  ) {}

  /** Draw the danger zone for a winding-up AoE. */
  addTelegraph(
    sourceId: EntityId,
    radius: number,
    durationMs: number,
    cone?: { facing: number; arc: number },
    at?: { x: number; z: number },
  ): void {
    if (radius <= 0) return;
    const ring = new TelegraphRing(sourceId, radius, durationMs, cone, at);
    this.telegraphs.push(ring);
    this.scene.add(ring.group);
  }

  /**
   * A patch of ground that keeps hurting after the cast that made it.
   *
   * Drawn separately from the telegraphs because it outlives them: a telegraph
   * is a promise about the next two seconds, a hazard is a fact about the next
   * fourteen, and the two want to look different for the same reason they play
   * differently.
   */
  addHazard(id: number, at: { x: number; z: number }, radius: number, durationMs: number): void {
    const patch = new HazardPatch(id, radius, durationMs);
    patch.group.position.set(at.x, this.groundAt(at.x, at.z) + 0.04, at.z);
    this.hazardPatches.push(patch);
    this.scene.add(patch.group);
  }

  removeHazard(id: number): void {
    for (const patch of this.hazardPatches) if (patch.id === id) patch.expire();
  }

  /**
   * Flash where a hit landed.
   *
   * Sited on the *target*, at roughly chest height, rather than at the
   * attacker: the interesting fact is what got hit.
   */
  addImpact(targetId: EntityId, amount: number, crit: boolean, damageType: DamageType): void {
    const view = this.views.get(targetId);
    if (!view || !view.group.visible) return;
    const entity = this.world.entity(targetId);
    const height = entity?.kind === 'mob' ? getMob(entity.defId!).view.height : 1.8;

    const at = view.group.position.clone();
    at.y += height * 0.6;
    // Scaled off how big the hit was as a share of the victim's health, so a
    // scratch and a near-death blow do not look the same. Clamped, because a
    // one-shot on a level-1 hare should not fill the screen.
    const max = entity ? this.world.statsOf(entity).maxHealth : amount;
    const weight = Math.max(0.35, Math.min(1.4, (amount / Math.max(1, max)) * 4));
    const burst = new ImpactBurst(at, weight * (crit ? 1.5 : 1), DAMAGE_COLOURS[damageType], crit);
    this.bursts.push(burst);
    this.scene.add(burst.group);

    // Only the player's own beatings shake the camera. Everything else in the
    // zone is somebody else's fight.
    if (targetId === this.world.playerId) this.shake = Math.min(0.5, this.shake + weight * 0.18);
    else if (crit) this.shake = Math.min(0.25, this.shake + 0.09);
  }

  /** How far the camera should be nudged this frame, and it decays fast. */
  takeShake(dtMs: number): number {
    if (this.shake <= 0.0005) return 0;
    const amount = this.shake;
    this.shake = Math.max(0, this.shake - dtMs * 0.006);
    return amount;
  }

  get all(): IterableIterator<EntityView> {
    return this.views.values();
  }

  /**
   * Put a model on everything matching a key, right now.
   *
   * Iterating on art means looking at forty versions of a wolf, and a manifest
   * you have to rebuild to change is one nobody will experiment with. From the
   * console: `__game.tryModel('mob:bog_wolf', { file: 'models/mob/v7.glb' })`.
   * The override sticks, so anything that spawns afterwards wears it too.
   */
  tryModel(key: string, def: ModelDef | null): number {
    setModelOverride(key, def);
    const [kind, id] = key.split(':');
    let dressed = 0;
    for (const [entityId, view] of this.views) {
      const entity = this.world.entity(entityId);
      if (!entity) continue;
      const mine =
        kind === 'mob'
          ? entity.kind === 'mob' && entity.defId === id
          : kind === 'vendor'
            ? entity.kind === 'vendor' && entity.vendorId === id
            : entity.kind === 'player' && entity.classId === id;
      if (!mine || !def) continue;
      dressed++;
      void view.dressIn(def);
    }
    return dressed;
  }

  get(id: EntityId): EntityView | undefined {
    return this.views.get(id);
  }

  /**
   * Keep a mark on every landmark in the zone that still holds something.
   *
   * Rebuilt from the sim's list rather than from an event, so opening one
   * makes its mark disappear on the next frame with no bookkeeping — and so a
   * loaded save comes back with exactly the marks it should have.
   */
  private updateSiteMarks(dtMs: number, player: Entity): void {
    const open = this.world.openSites();
    const live = new Set<string>();
    const range = Math.min(DISCOVERY_SIGHT, this.visibleRange());
    for (const site of open) {
      live.add(site.id);
      let mark = this.siteMarks.get(site.id);
      if (!mark) {
        mark = new SiteMark(
          site.id,
          site.pos.x,
          this.groundAt(site.pos.x, site.pos.z),
          site.pos.z,
          site.kind === 'boon',
        );
        this.siteMarks.set(site.id, mark);
        this.scene.add(mark.group);
      }
      const far = Math.hypot(site.pos.x - player.pos.x, site.pos.z - player.pos.z) > range;
      mark.group.visible = !far;
      if (!far) mark.update(dtMs);
    }
    for (const [id, mark] of this.siteMarks) {
      if (live.has(id)) continue;
      this.scene.remove(mark.group);
      mark.dispose();
      this.siteMarks.delete(id);
    }
  }

  /**
   * Drop every view and telegraph. Called on zone change: the entities are all
   * new and the ground under them is a different shape, so interpolating from
   * where things were is meaningless — and looks like the whole zone sliding
   * into place.
   */
  reset(): void {
    for (const mark of this.siteMarks.values()) {
      this.scene.remove(mark.group);
      mark.dispose();
    }
    this.siteMarks.clear();
    for (const view of this.views.values()) {
      this.scene.remove(view.group);
      view.dispose();
    }
    this.views.clear();
    for (const burst of this.bursts) {
      this.scene.remove(burst.group);
      burst.dispose();
    }
    this.bursts = [];
    this.shake = 0;
    for (const patch of this.hazardPatches) {
      this.scene.remove(patch.group);
      patch.dispose();
    }
    this.hazardPatches = [];
    for (const ring of this.telegraphs) {
      this.scene.remove(ring.group);
      ring.dispose();
    }
    this.telegraphs = [];
  }

  /** Create views for new entities; drop views whose entity is gone. */
  sync(): void {
    for (const entity of this.world.entities.values()) {
      const existing = this.views.get(entity.id);
      if (existing) {
        // Same entity, different creature: rebuild rather than leave a rare
        // wearing the camp mob's body.
        if (existing.builtFrom === entity.defId) continue;
        this.scene.remove(existing.group);
        existing.dispose();
        this.views.delete(entity.id);
      }
      const view = new EntityView(entity.id, entity, this.groundAt);
      this.views.set(entity.id, view);
      this.scene.add(view.group);
    }
    for (const [id, view] of this.views) {
      if (this.world.entity(id)) continue;
      this.scene.remove(view.group);
      view.dispose();
      this.views.delete(id);
    }
  }

  pushTick(): void {
    for (const entity of this.world.entities.values()) {
      this.views.get(entity.id)?.pushTick(entity);
    }
  }

  private updateTelegraphs(dtMs: number): void {
    this.telegraphs = this.telegraphs.filter((ring) => {
      // A ground-anchored telegraph stays where it was stamped even if the
      // caster walks off — that stamp is the promise the mechanic is built on.
      // One that follows its caster has no anchor and needs the source view.
      const at = ring.at
        ? new THREE.Vector3(ring.at.x, this.groundAt(ring.at.x, ring.at.z) + 0.02, ring.at.z)
        : this.views.get(ring.sourceId)?.group.position;
      const alive = at ? ring.update(dtMs, at) : false;
      if (!alive) {
        this.scene.remove(ring.group);
        ring.dispose();
      }
      return alive;
    });
  }

  update(alpha: number, dtMs: number): void {
    const targetId = this.world.player.targetId;
    const player = this.world.player;
    // Beyond the fog nothing is visible, but three.js will happily keep drawing
    // it: the frustum culls what is off screen, not what is behind a wall of
    // grey. On a zone with six hundred creatures in it that is most of them.
    const range = this.visibleRange();
    for (const entity of this.world.entities.values()) {
      const view = this.views.get(entity.id);
      if (!view) continue;
      const far = Math.hypot(entity.pos.x - player.pos.x, entity.pos.z - player.pos.z) > range;
      if (far) {
        view.group.visible = false;
        continue;
      }
      const baseColor =
        entity.kind === 'mob'
          ? getMob(entity.defId!).view.color
          : entity.kind === 'vendor'
            ? getVendor(entity.vendorId!).view.color
            : CLASSES[entity.classId ?? 'warrior'].color;
      if (entity.kind === 'player') view.setMount(entity.mounted ?? null);
      view.setGear(entity);
      if (entity.kind === 'mob') {
        const carrying =
          entity.dead && ((entity.corpseLoot?.length ?? 0) > 0 || (entity.corpseGold ?? 0) > 0);
        view.setLootMark(carrying, getMob(entity.defId!).view.height);
      }
      view.update(alpha, dtMs, entity.id === targetId, baseColor);
      // Corpses stay visible but sink out of the way until they respawn.
      view.group.visible = !entity.dead || entity.kind === 'mob';
      if (entity.dead && entity.kind === 'mob') {
        const looted = (entity.corpseLoot?.length ?? 0) === 0 && (entity.corpseGold ?? 0) === 0;
        view.group.visible = !looted || entity.respawnInMs > 0;
      }
    }
    this.updateSiteMarks(dtMs, player);
    this.updateTelegraphs(dtMs);
    this.bursts = this.bursts.filter((burst) => {
      if (burst.update(dtMs, this.camera)) return true;
      this.scene.remove(burst.group);
      burst.dispose();
      return false;
    });
    this.hazardPatches = this.hazardPatches.filter((patch) => {
      if (patch.update(dtMs)) return true;
      this.scene.remove(patch.group);
      patch.dispose();
      return false;
    });
  }
}
