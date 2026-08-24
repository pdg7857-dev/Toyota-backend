import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BodyPart, BodyPlan, Joint } from '../content/bodies.js';

/**
 * The engine for `content/bodies.ts`.
 *
 * A plan is a list of primitives in units of the creature's height. This turns
 * one into three.js geometry and knows nothing about which creature it is
 * building — the same split `render/scene.ts` has with the zone themes.
 *
 * Two ways out, and which one an entity gets is a budget decision:
 *
 * - `mergeBody` welds the whole plan into **one** geometry with the part
 *   shading baked into vertex colours. Six hundred creatures a zone can only
 *   ever afford this: a wolf with a head, four legs and a tail costs precisely
 *   what the capsule it replaced did.
 * - `jointedBody` returns the trunk plus one mesh per moving joint, so the
 *   limbs can actually swing. Reserved for the handful of figures the player
 *   looks at closely — see `ARTICULATE` in `views.ts`.
 */

/** Geometry for one part, already positioned in the creature's own space. */
function partGeometry(part: BodyPart, s: number, girth: number): THREE.BufferGeometry {
  const [a, b] = part.size;
  let geo: THREE.BufferGeometry;
  switch (part.shape) {
    case 'capsule': {
      // `size[1]` is the capsule's TOTAL length, caps included, which is not
      // what three.js takes. The first pass passed it straight through, so
      // every body was two cap-radii longer than its plan said — and a goat's
      // head, placed at the end of a body that had quietly grown, sat entirely
      // inside its own ribcage.
      //
      // Segment counts are deliberately low. These are read at ten to eighty
      // metres through fog, and the triangle budget is a zone-wide number.
      const r = a * s * girth;
      geo = new THREE.CapsuleGeometry(r, Math.max(0.001, b * s - r * 2), 3, 8);
      break;
    }
    case 'box':
      geo = new THREE.BoxGeometry(a * s * girth, b * s, part.size[2] * s * girth);
      break;
    case 'sphere':
      geo = new THREE.SphereGeometry(a * s * girth, 10, 7);
      geo.scale(1, b, part.size[2]);
      break;
    case 'cone':
      geo = new THREE.ConeGeometry(a * s * girth, b * s, 7);
      break;
  }
  if (part.rot) geo.rotateX(part.rot[0]);
  if (part.rot?.[1]) geo.rotateY(part.rot[1]);
  if (part.rot?.[2]) geo.rotateZ(part.rot[2]);
  return geo;
}

/** Bake a part's tone into vertex colours so a merged body still has shading. */
function tint(geo: THREE.BufferGeometry, tone: number): void {
  const count = geo.attributes.position!.count;
  const colours = new Float32Array(count * 3);
  // Clamped above 0 and allowed past 1: a tusk or a blade is meant to read as
  // bone and steel against the creature's own colour, and the material colour
  // it multiplies against is what the damage flash drives.
  const t = Math.max(0.05, tone);
  for (let i = 0; i < count; i++) {
    colours[i * 3] = t;
    colours[i * 3 + 1] = t;
    colours[i * 3 + 2] = t;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
}

/**
 * Parts off the centre line are authored once and mirrored.
 *
 * A plan therefore cannot grow a left ear without a right one, which is the
 * kind of mistake that is obvious in a screenshot and invisible in a diff.
 */
function expand(plan: BodyPlan): { part: BodyPart; flip: boolean }[] {
  const out: { part: BodyPart; flip: boolean }[] = [];
  for (const part of plan.parts) {
    out.push({ part, flip: false });
    if (part.mirror) out.push({ part: { ...part, joint: part.mirror }, flip: true });
  }
  return out;
}

function place(geo: THREE.BufferGeometry, part: BodyPart, s: number, girth: number, flip: boolean): void {
  const x = part.at[0] * s * girth * (flip ? -1 : 1);
  geo.translate(x, part.at[1] * s, part.at[2] * s);
}

/**
 * Girth from the creature's own stat block.
 *
 * `view.radius` was already hand-tuned per creature and, with everything a
 * capsule, it was the *only* thing separating a stocky boar from a lean wolf.
 * Reading it here means that tuning keeps working rather than being thrown
 * away the moment the creature grew legs.
 *
 * It is deliberately a *nudge* and not the width itself. The old radius had to
 * stand for the whole animal, so on a long-bodied creature it reads far too
 * fat — taking it literally turned the Ardmoor goats into barrels on legs. The
 * plan says how wide a wolf is; this only says which wolf.
 */
export function girthOf(height: number, radius: number): number {
  const ratio = radius / (height * 0.3);
  return Math.max(0.85, Math.min(1.25, 1 + (ratio - 1) * 0.35));
}

/** The whole plan as one geometry. Nothing on it can move independently. */
export function mergeBody(plan: BodyPlan, height: number, radius: number): THREE.BufferGeometry {
  const girth = girthOf(height, radius);
  const pieces: THREE.BufferGeometry[] = [];
  for (const { part, flip } of expand(plan)) {
    const geo = partGeometry(part, height, girth);
    if (flip) geo.scale(-1, 1, 1);
    place(geo, part, height, girth, flip);
    tint(geo, part.tone ?? 1);
    pieces.push(geo);
  }
  const merged = mergeGeometries(pieces);
  if (!merged) return pieces[0]!;
  for (const p of pieces) p.dispose();
  merged.computeVertexNormals();
  return merged;
}

/** A joint's pivot and the geometry hanging off it. */
export interface JointedPart {
  joint: Joint;
  geometry: THREE.BufferGeometry;
  /** Where the joint hinges, in the creature's own space. */
  pivot: THREE.Vector3;
}

export interface JointedBody {
  /** Everything with no joint, merged. */
  trunk: THREE.BufferGeometry;
  parts: JointedPart[];
}

/**
 * Where a joint hinges.
 *
 * A leg swings from the hip, not from its middle, and an arm from the
 * shoulder. Getting this wrong is the difference between walking and
 * levitating, and it is not something a part can say for itself — the plan
 * describes where a part *is*, and the hinge is a fact about the joint.
 */
function pivotFor(joint: Joint, part: BodyPart, height: number, girth: number, flip: boolean): THREE.Vector3 {
  const x = part.at[0] * height * girth * (flip ? -1 : 1);
  const y = part.at[1] * height;
  const z = part.at[2] * height;
  switch (joint) {
    case 'legL':
    case 'legR':
    case 'legFL':
    case 'legFR':
    case 'legBL':
    case 'legBR':
      // The top of the limb.
      return new THREE.Vector3(x, y + (part.size[1] * height) / 2, z);
    case 'armL':
    case 'armR':
      return new THREE.Vector3(x, y + (part.size[1] * height) / 2, z);
    case 'wingL':
    case 'wingR':
      // At the shoulder, on the centre line, so a wing beats rather than slides.
      return new THREE.Vector3(0, y, z);
    case 'tail':
      return new THREE.Vector3(x, y, z + (part.size[1] * height) / 2);
    case 'head':
    default:
      return new THREE.Vector3(x, y, z);
  }
}

/**
 * Trunk plus a mesh per joint.
 *
 * Parts sharing a joint are merged together — a head, its snout, its ears and
 * its antlers are one mesh that turns as a unit, not six.
 */
export function jointedBody(plan: BodyPlan, height: number, radius: number): JointedBody {
  const girth = girthOf(height, radius);
  const trunkPieces: THREE.BufferGeometry[] = [];
  const byJoint = new Map<Joint, { geos: THREE.BufferGeometry[]; pivot: THREE.Vector3 }>();

  for (const { part, flip } of expand(plan)) {
    const geo = partGeometry(part, height, girth);
    if (flip) geo.scale(-1, 1, 1);
    place(geo, part, height, girth, flip);
    tint(geo, part.tone ?? 1);

    if (!part.joint) {
      trunkPieces.push(geo);
      continue;
    }
    let slot = byJoint.get(part.joint);
    if (!slot) {
      slot = { geos: [], pivot: pivotFor(part.joint, part, height, girth, flip) };
      byJoint.set(part.joint, slot);
    }
    slot.geos.push(geo);
  }

  const parts: JointedPart[] = [];
  for (const [joint, slot] of byJoint) {
    const merged = mergeGeometries(slot.geos) ?? slot.geos[0]!;
    if (merged !== slot.geos[0]) for (const g of slot.geos) g.dispose();
    // Re-origin onto the hinge, so a rotation on the mesh is a rotation about
    // the joint rather than about the creature's feet.
    merged.translate(-slot.pivot.x, -slot.pivot.y, -slot.pivot.z);
    merged.computeVertexNormals();
    parts.push({ joint, geometry: merged, pivot: slot.pivot });
  }

  // A trunk can legitimately be empty — a serpent is all joints — and an empty
  // merge returns null rather than an empty geometry.
  const trunk = trunkPieces.length ? (mergeGeometries(trunkPieces) ?? trunkPieces[0]!) : new THREE.BufferGeometry();
  if (trunkPieces.length && trunk !== trunkPieces[0]) for (const g of trunkPieces) g.dispose();
  trunk.computeVertexNormals();
  return { trunk, parts };
}
