/**
 * What a creature is shaped like.
 *
 * Every living thing in this game was a capsule. A wolf, a stag, an outlaw, a
 * heron and a dragon were the same shape in five colours and five sizes, which
 * meant the only way to tell what was about to attack you was to read its
 * nameplate. A silhouette is the cheapest information in a 3D game and this
 * had none of it.
 *
 * This module is **pure data**, exactly like `terrain.ts`: it describes bodies
 * in primitives and knows nothing about three.js. `render/body.ts` is the
 * engine that turns a plan into geometry. A new creature's shape is therefore
 * a table entry rather than renderer work — the same split the zone themes use,
 * for the same reason.
 *
 * Two things make it affordable at six hundred creatures a zone:
 *
 * - **Everything is authored in units of the creature's own height**, so one
 *   plan fits a Moor Hare and Old Scar without a second table of sizes.
 * - **A plan is a list of parts, not a hierarchy.** The renderer merges the
 *   parts of an ordinary creature into a single geometry, so a wolf with a
 *   head, four legs and a tail costs exactly what the capsule did.
 */

/**
 * A part the animation can move on its own.
 *
 * Parts with no joint are the trunk and move with the body. Only the handful
 * of entities the player actually looks at are built with separate meshes and
 * animated limbs — see `render/body.ts` — so this is a hint, not a promise.
 */
export type Joint =
  | 'head'
  | 'armL'
  | 'armR'
  | 'legL'
  | 'legR'
  | 'legFL'
  | 'legFR'
  | 'legBL'
  | 'legBR'
  | 'tail'
  | 'wingL'
  | 'wingR';

export type PartShape = 'capsule' | 'box' | 'sphere' | 'cone';

export interface BodyPart {
  shape: PartShape;
  /**
   * Dimensions in units of the creature's height.
   *
   * - `capsule` — [radius, length, _], along Y before `rot`
   * - `box`     — [width, height, depth], full extents
   * - `sphere`  — [radius, yScale, zScale]
   * - `cone`    — [radius, height, _], apex towards +Y before `rot`
   */
  size: [number, number, number];
  /** Centre of the part. y is measured up from the ground, +z is forward. */
  at: [number, number, number];
  /** Euler XYZ, radians. */
  rot?: [number, number, number];
  /** Multiplier on the creature's colour. Below 1 is darker. */
  tone?: number;
  /** Which joint drives it, if any. */
  joint?: Joint;
  /**
   * Parts off the centre line are authored once and mirrored, so a plan can
   * never grow a left ear without a right one. The mirror takes the `joint`
   * named here.
   */
  mirror?: Joint;
}

export interface BodyPlan {
  id: string;
  /** What it should read as at forty metres. Printed by the test that walks them. */
  reads: string;
  /**
   * Where a weapon is gripped, in height units — main hand and off hand.
   *
   * Present only on plans that have hands. Weapons are deliberately *not* part
   * of the plan: what somebody is carrying changes while they are standing
   * there, and a plan is baked into geometry once.
   */
  hand?: { main: [number, number, number]; off: [number, number, number] };
  /** What this creature carries when nothing says otherwise. */
  carries?: WeaponLook;
  /**
   * How much of the creature's height is taken up by legs.
   *
   * The renderer needs this to know where a body pivots when it leans, and it
   * is the difference between a stag rocking about its shoulders and a stag
   * rocking about its hooves.
   */
  pivot: number;
  parts: BodyPart[];
}

/* ------------------------------------------------------------------ */
/* Builders                                                            */
/*                                                                     */
/* Fourteen plans hand-typed part by part is fourteen chances to put a  */
/* head where a tail goes. Every four-legged creature in the game comes */
/* out of one function with different knobs, the same way the late      */
/* weapon ladders come out of one DPS budget — and for the same reason: */
/* the ones that are hand-written are the reference, and everything     */
/* else has to stay in the same shape as them.                         */
/* ------------------------------------------------------------------ */

interface QuadrupedKnobs {
  /** Body length, height-units. */
  body: number;
  /** Body radius. */
  girth: number;
  /** Shoulder height as a fraction of total — the rest is head and ears. */
  back: number;
  /** Leg thickness. */
  shin: number;
  /** How far forward and up the neck reaches. */
  neck: [number, number];
  /** Head radius. */
  head: number;
  /** Tail length. 0 for none. */
  tail: number;
  /** Ear length. 0 for none. */
  ears?: number;
  /** Horns or antlers: [length, spread, branches]. */
  horns?: [number, number, number];
  /** Tusks, for a boar. */
  tusks?: number;
  /** A single horn on the centre line. There is exactly one creature. */
  horn?: number;
  /** A mane along the neck. */
  mane?: boolean;
}

function quadruped(k: QuadrupedKnobs): BodyPart[] {
  const backY = k.back;
  const parts: BodyPart[] = [];

  // Trunk, lying along Z.
  parts.push({
    shape: 'capsule',
    size: [k.girth, k.body, 0],
    at: [0, backY, 0],
    rot: [Math.PI / 2, 0, 0],
  });

  // Neck, reaching from the shoulder to where the head sits.
  const headAt: [number, number, number] = [0, backY + k.neck[1], k.body / 2 + k.neck[0]];
  parts.push({
    shape: 'capsule',
    size: [k.girth * 0.52, Math.hypot(k.neck[0], k.neck[1]) + k.girth * 0.4, 0],
    at: [0, backY + k.neck[1] / 2, k.body / 2 + k.neck[0] / 2],
    rot: [Math.PI / 2 - Math.atan2(k.neck[1], k.neck[0]), 0, 0],
    tone: 0.96,
  });
  if (k.mane) {
    parts.push({
      shape: 'box',
      size: [k.girth * 0.28, k.girth * 0.9, Math.hypot(k.neck[0], k.neck[1])],
      at: [0, backY + k.neck[1] * 0.7, k.body / 2 + k.neck[0] * 0.45],
      rot: [Math.PI / 2 - Math.atan2(k.neck[1], k.neck[0]), 0, 0],
      tone: 0.7,
    });
  }

  parts.push({ shape: 'sphere', size: [k.head, 0.95, 1.25], at: headAt, joint: 'head' });
  // A snout, which is most of what says wolf rather than sheep.
  parts.push({
    shape: 'cone',
    size: [k.head * 0.55, k.head * 1.5, 0],
    at: [0, headAt[1] - k.head * 0.18, headAt[2] + k.head * 1.05],
    rot: [Math.PI / 2, 0, 0],
    tone: 0.82,
    joint: 'head',
  });
  if (k.ears) {
    parts.push({
      shape: 'cone',
      size: [k.head * 0.3, k.ears, 0],
      at: [k.head * 0.52, headAt[1] + k.head * 0.75, headAt[2] - k.head * 0.15],
      rot: [0, 0, -0.25],
      tone: 0.85,
      joint: 'head',
      mirror: 'head',
    });
  }
  if (k.horns) {
    const [len, spread, branches] = k.horns;
    for (let b = 0; b < branches; b++) {
      const up = 0.35 + (b / Math.max(1, branches)) * 0.5;
      parts.push({
        shape: 'cone',
        size: [k.head * 0.16, len * (1 - b * 0.22), 0],
        at: [
          k.head * 0.45 + spread * up,
          headAt[1] + k.head * 0.7 + len * up * 0.7,
          headAt[2] - k.head * 0.25 - b * len * 0.32,
        ],
        rot: [0, 0, -0.5 - b * 0.15],
        tone: 0.62,
        joint: 'head',
        mirror: 'head',
      });
    }
  }
  if (k.horn) {
    parts.push({
      shape: 'cone',
      size: [k.head * 0.22, k.horn, 0],
      at: [0, headAt[1] + k.head * 0.6 + k.horn * 0.35, headAt[2] + k.head * 0.4],
      rot: [-0.5, 0, 0],
      tone: 2.6,
      joint: 'head',
    });
  }
  if (k.tusks) {
    parts.push({
      shape: 'cone',
      size: [k.head * 0.12, k.tusks, 0],
      at: [k.head * 0.42, headAt[1] - k.head * 0.1, headAt[2] + k.head * 0.9],
      rot: [-0.5, 0, 0.35],
      tone: 1.6,
      joint: 'head',
      mirror: 'head',
    });
  }

  // Four legs. Front pair carries the joint names the gait drives diagonally.
  const legLen = backY - k.girth * 0.35;
  const spread = k.girth * 0.72;
  const fore = k.body * 0.34;
  for (const [dz, jl, jr] of [
    [fore, 'legFL', 'legFR'],
    [-fore, 'legBL', 'legBR'],
  ] as const) {
    parts.push({
      shape: 'capsule',
      size: [k.shin, legLen, 0],
      at: [spread, legLen / 2, dz],
      tone: 0.88,
      joint: jr,
      mirror: jl,
    });
  }

  if (k.tail > 0) {
    parts.push({
      shape: 'capsule',
      size: [k.girth * 0.24, k.tail, 0],
      at: [0, backY + k.tail * 0.24, -k.body / 2 - k.tail * 0.32],
      rot: [Math.PI / 2 - 0.7, 0, 0],
      tone: 0.86,
      joint: 'tail',
    });
  }
  return parts;
}

interface HumanoidKnobs {
  /** Half the shoulder width. A person is about 0.12 of their own height. */
  half: number;
  /** Body depth front to back. */
  depth: number;
  /** Leg length — where the hips sit. */
  hip: number;
  /** Head radius. About 0.066 on a person; anything near 0.1 is a caricature. */
  head: number;
  /** A helmet or hood rather than a bare head. */
  helm?: boolean;
}

/**
 * A figure on two legs.
 *
 * Authored against real proportions rather than by eye, because by eye is how
 * the first pass ended up with a head a fifth of the body's height and
 * shoulders half its width — a snowman holding an axe. A person is roughly
 * seven and a half heads tall and about a quarter of their height across the
 * shoulders, and those two numbers are most of what makes a silhouette read as
 * a person at all.
 */
function humanoid(k: HumanoidKnobs): { parts: BodyPart[]; hand: BodyPlan['hand'] } {
  const parts: BodyPart[] = [];
  const hip = k.hip;
  const chest = hip + 0.2;
  const shoulder = hip + 0.31;

  // Legs, hanging from the hips.
  parts.push({
    shape: 'capsule',
    size: [k.depth * 0.4, hip, 0],
    at: [k.half * 0.45, hip / 2, 0],
    tone: 0.78,
    joint: 'legR',
    mirror: 'legL',
  });

  // Pelvis, chest and shoulders as three widths, so the trunk tapers rather
  // than being one slab. A slab is the difference between a figure and a door.
  parts.push({ shape: 'box', size: [k.half * 1.5, 0.1, k.depth], at: [0, hip + 0.04, 0], tone: 0.82 });
  parts.push({ shape: 'box', size: [k.half * 1.75, 0.22, k.depth * 1.05], at: [0, chest, 0] });
  parts.push({ shape: 'box', size: [k.half * 2, 0.09, k.depth], at: [0, shoulder, 0], tone: 0.92 });

  // Neck and head.
  const headY = shoulder + 0.05 + k.head;
  parts.push({
    shape: 'capsule',
    size: [k.head * 0.42, 0.09, 0],
    at: [0, shoulder + 0.05, 0],
    tone: 0.88,
  });
  parts.push({ shape: 'sphere', size: [k.head, 1.15, 1.1], at: [0, headY, 0], tone: 1.15 });
  if (k.helm) {
    parts.push({
      shape: 'sphere',
      size: [k.head * 1.15, 0.85, 1.05],
      at: [0, headY + k.head * 0.3, 0],
      tone: 0.5,
    });
  }

  // Arms, hanging from the shoulders.
  parts.push({
    shape: 'capsule',
    size: [k.depth * 0.3, 0.38, 0],
    at: [k.half * 1.15, shoulder - 0.2, 0],
    tone: 0.95,
    joint: 'armR',
    mirror: 'armL',
  });

  const handY = shoulder - 0.36;
  return { parts, hand: { main: [k.half * 1.35, handY, 0.06], off: [-k.half * 1.35, handY, 0.06] } };
}

/* ------------------------------------------------------------------ */
/* What is in the hands                                                */
/*                                                                     */
/* Deliberately not part of a `BodyPlan`. A plan is baked into geometry */
/* once, and what somebody is carrying changes while they are standing  */
/* there — you buy a spear and you are holding a spear. So a weapon is  */
/* its own small set of parts, gripped at a point the plan names.       */
/* ------------------------------------------------------------------ */

export type WeaponLook =
  | 'blade'
  | 'greatsword'
  | 'axe'
  | 'mace'
  | 'spear'
  | 'dagger'
  | 'bow'
  | 'staff'
  | 'none';

export type OffhandLook = 'blade' | 'bulwark' | 'grimoire' | 'none';

/**
 * What a weapon looks like, from its name.
 *
 * Matched on the item's own name rather than a field, for the same reason the
 * creature shapes are: five of the eight weapon ladders are *generated*, so a
 * per-item field would have to be generated from the name — which is this
 * table with an extra step.
 *
 * The class is the fallback and it does real work, because weapons are
 * class-locked: a Mage's `Blackstone Focus` and a Priest's `Chieftain's
 * Reliquary` name no object anybody would recognise, and the class is enough
 * to know one is a staff and the other is not. The printed table in the test
 * is what caught them sitting in the `blade` bucket with seventy-six others.
 */
const WEAPON_WORDS: [string, WeaponLook][] = [
  ['greatsword', 'greatsword'],
  ['claymore', 'greatsword'],
  ['longsword', 'greatsword'],
  ['warblade', 'greatsword'],
  ['sword', 'blade'],
  ['blade', 'blade'],
  ['sabre', 'blade'],
  ['saber', 'blade'],
  ['falchion', 'blade'],
  ['axe', 'axe'],
  ['cleaver', 'axe'],
  ['hatchet', 'axe'],
  ['mace', 'mace'],
  ['hammer', 'mace'],
  ['maul', 'mace'],
  ['club', 'mace'],
  ['cudgel', 'mace'],
  ['flail', 'mace'],
  ['reliquary', 'mace'],
  ['scepter', 'mace'],
  ['sceptre', 'mace'],
  ['spear', 'spear'],
  ['pike', 'spear'],
  ['lance', 'spear'],
  ['glaive', 'spear'],
  ['halberd', 'spear'],
  ['dagger', 'dagger'],
  ['knife', 'dagger'],
  ['dirk', 'dagger'],
  ['shiv', 'dagger'],
  ['stiletto', 'dagger'],
  ['kris', 'dagger'],
  ['fang', 'dagger'],
  ['bow', 'bow'],
  ['recurve', 'bow'],
  ['sling', 'bow'],
  ['stave', 'staff'],
  ['staff', 'staff'],
  ['rod', 'staff'],
  ['wand', 'staff'],
  ['branch', 'staff'],
  ['crook', 'staff'],
  ['crozier', 'staff'],
  ['focus', 'staff'],
  ['talisman', 'staff'],
  ['heartwood', 'staff'],
];

const WEAPON_SORTED = [...WEAPON_WORDS].sort((a, b) => b[0].length - a[0].length);

/** What this class carries when its weapon's name says nothing useful. */
const CLASS_WEAPON: Record<string, WeaponLook> = {
  warrior: 'axe',
  priest: 'mace',
  ranger: 'bow',
  rogue: 'dagger',
  mage: 'staff',
};

export function weaponLookFor(name: string | undefined, classId: string | undefined): WeaponLook {
  if (name) {
    const key = name.toLowerCase();
    // Whole words first, then anywhere in the name.
    //
    // `Mirefang Bow` is a bow. Matching anywhere and taking the longest word
    // made it a dagger, because a rare spawn's epithet is a made-up word glued
    // onto a real one and `fang` is longer than `bow`. A whole word beats a
    // fragment; `Fenblade`, which is one word, still finds its blade on the
    // second pass.
    const words = key.split(/[^a-z]+/).filter(Boolean);
    for (const [word, look] of WEAPON_SORTED) {
      if (words.includes(word)) return look;
    }
    for (const [word, look] of WEAPON_SORTED) {
      if (key.includes(word)) return look;
    }
  }
  return CLASS_WEAPON[classId ?? ''] ?? 'blade';
}

/**
 * The offhand is the one slot in the game that is a build decision, so it is
 * the one that most has to be visible: a bulwark, a second blade and a
 * grimoire are three different characters and they should not look alike.
 */
export function offhandLookFor(name: string | undefined): OffhandLook {
  if (!name) return 'none';
  const key = name.toLowerCase();
  if (key.includes('bulwark') || key.includes('shield') || key.includes('targe')) return 'bulwark';
  if (key.includes('grimoire') || key.includes('tome') || key.includes('codex')) return 'grimoire';
  return 'blade';
}

/**
 * The weapon itself, in height units, gripped at the origin.
 *
 * `tone` is left at 1 throughout: a held weapon gets its own material, tinted
 * by the item's quality, so a rusted blade and a Sovereign one are visibly
 * different objects rather than the same object in the body's colour.
 */
export function weaponParts(look: WeaponLook): BodyPart[] {
  switch (look) {
    case 'blade':
      return [
        { shape: 'box', size: [0.022, 0.36, 0.05], at: [0, 0.14, 0.02], rot: [-0.35, 0, 0] },
        { shape: 'box', size: [0.07, 0.02, 0.03], at: [0, -0.02, 0], tone: 0.5 },
      ];
    case 'greatsword':
      return [
        { shape: 'box', size: [0.03, 0.62, 0.06], at: [0, 0.3, 0.04], rot: [-0.3, 0, 0] },
        { shape: 'box', size: [0.11, 0.025, 0.035], at: [0, -0.01, 0], tone: 0.5 },
      ];
    case 'axe':
      return [
        { shape: 'capsule', size: [0.014, 0.34, 0], at: [0, 0.14, 0.02], rot: [-0.35, 0, 0], tone: 0.45 },
        { shape: 'box', size: [0.03, 0.12, 0.15], at: [0, 0.28, 0.09], rot: [-0.35, 0, 0] },
      ];
    case 'mace':
      return [
        { shape: 'capsule', size: [0.014, 0.3, 0], at: [0, 0.12, 0.02], rot: [-0.35, 0, 0], tone: 0.45 },
        { shape: 'sphere', size: [0.055, 1, 1], at: [0, 0.28, 0.08] },
      ];
    case 'spear':
      return [
        { shape: 'capsule', size: [0.013, 0.9, 0], at: [0, 0.24, 0.06], rot: [-0.2, 0, 0], tone: 0.45 },
        { shape: 'cone', size: [0.032, 0.16, 0], at: [0, 0.68, 0.15], rot: [-0.2, 0, 0] },
      ];
    case 'dagger':
      return [
        { shape: 'box', size: [0.018, 0.18, 0.035], at: [0, 0.08, 0.01], rot: [-0.35, 0, 0] },
        { shape: 'box', size: [0.05, 0.015, 0.025], at: [0, -0.01, 0], tone: 0.5 },
      ];
    case 'bow':
      // Held across the body in the off hand, so it reads as a bow rather than
      // as a stick: the string is what makes the shape, and it is one box.
      return [
        { shape: 'box', size: [0.018, 0.52, 0.03], at: [0, 0.1, 0.02], rot: [0, 0, 0.1], tone: 0.5 },
        { shape: 'box', size: [0.006, 0.5, 0.006], at: [0, 0.1, -0.05], rot: [0, 0, 0.1], tone: 1.6 },
      ];
    case 'staff':
      return [
        { shape: 'capsule', size: [0.014, 0.78, 0], at: [0, 0.24, 0.02], rot: [-0.08, 0, 0], tone: 0.5 },
        { shape: 'sphere', size: [0.04, 1.1, 1.1], at: [0, 0.62, 0.05], tone: 1.8 },
      ];
    case 'none':
      return [];
  }
}

export function offhandParts(look: OffhandLook): BodyPart[] {
  switch (look) {
    case 'bulwark':
      return [
        { shape: 'box', size: [0.03, 0.34, 0.28], at: [-0.04, 0.06, 0.02], rot: [0, 0, 0.08] },
        { shape: 'sphere', size: [0.05, 0.7, 0.7], at: [-0.06, 0.06, 0.02], tone: 1.5 },
      ];
    case 'grimoire':
      return [
        { shape: 'box', size: [0.05, 0.18, 0.14], at: [-0.03, 0.04, 0.03], rot: [0, 0, 0.25] },
        { shape: 'box', size: [0.02, 0.16, 0.12], at: [-0.06, 0.04, 0.03], rot: [0, 0, 0.25], tone: 1.8 },
      ];
    case 'blade':
      return [
        { shape: 'box', size: [0.02, 0.28, 0.045], at: [0, 0.11, 0.02], rot: [-0.35, 0, 0] },
        { shape: 'box', size: [0.06, 0.018, 0.028], at: [0, -0.02, 0], tone: 0.5 },
      ];
    case 'none':
      return [];
  }
}

/**
 * What a held weapon is made of, by the item's quality.
 *
 * The one place gear becomes visible without a wardrobe system: a rusted blade
 * is dull iron and a Sovereign one is bright, and you can see across a camp
 * which of the two somebody is carrying.
 */
export const QUALITY_METAL: Record<string, number> = {
  common: 0x8b8b86,
  uncommon: 0x9fb08a,
  rare: 0x8fa8d8,
  epic: 0xd9b25c,
};

/* ------------------------------------------------------------------ */
/* The plans                                                           */
/* ------------------------------------------------------------------ */

function plan(
  id: string,
  reads: string,
  pivot: number,
  built: BodyPart[] | { parts: BodyPart[]; hand: BodyPlan['hand'] },
  carries?: WeaponLook,
): BodyPlan {
  const parts = Array.isArray(built) ? built : built.parts;
  const hand = Array.isArray(built) ? undefined : built.hand;
  return { id, reads, pivot, parts, hand, carries };
}

const PLANS = {
  /**
   * The fallback, and deliberately the old capsule exactly.
   *
   * A summon, an ability marker and anything a future zone adds before it has
   * a silhouette still has to stand somewhere and be clickable. What it must
   * never be is *invisible*, which is what a missing plan would otherwise mean.
   */
  blob: plan('blob', 'a capsule with a nose — no shape authored yet', 0.5, [
    { shape: 'capsule', size: [0.34, 1, 0], at: [0, 0.5, 0] },
    { shape: 'cone', size: [0.14, 0.45, 0], at: [0, 0.62, 0.4], rot: [Math.PI / 2, 0, 0], tone: 0.8 },
  ]),

  person: plan('person', 'someone on two legs, carrying something', 0.55,
    humanoid({ half: 0.115, depth: 0.11, hip: 0.5, head: 0.066 }), 'blade'),

  archer: plan('archer', 'a lighter figure with a longbow', 0.55,
    humanoid({ half: 0.105, depth: 0.1, hip: 0.51, head: 0.064 }), 'bow'),

  warrior: plan('warrior', 'a helmed, heavy-shouldered figure with an axe', 0.55,
    humanoid({ half: 0.135, depth: 0.13, hip: 0.48, head: 0.068, helm: true }), 'axe'),

  caster: plan('caster', 'a hooded figure leaning on a staff', 0.55,
    humanoid({ half: 0.105, depth: 0.105, hip: 0.5, head: 0.065, helm: true }), 'staff'),

  wolf: plan('wolf', 'low, long-backed, pricked ears, brush of a tail', 0.62,
    quadruped({ body: 1.15, girth: 0.17, back: 0.66, shin: 0.06, neck: [0.28, 0.06], head: 0.15, tail: 0.5, ears: 0.16 })),

  bear: plan('bear', 'heavy shoulders, short legs, no tail to speak of', 0.6,
    quadruped({ body: 1.2, girth: 0.27, back: 0.62, shin: 0.1, neck: [0.28, -0.02], head: 0.2, tail: 0.1, ears: 0.09 })),

  boar: plan('boar', 'hunched at the shoulder, snout down, tusks', 0.6,
    quadruped({ body: 1.05, girth: 0.24, back: 0.62, shin: 0.06, neck: [0.26, -0.14], head: 0.17, tail: 0.2, ears: 0.1, tusks: 0.16, mane: true })),

  stag: plan('stag', 'long legs, head up, antlers', 0.68,
    quadruped({ body: 1.05, girth: 0.15, back: 0.7, shin: 0.045, neck: [0.26, 0.3], head: 0.12, tail: 0.14, ears: 0.12, horns: [0.34, 0.07, 3] })),

  goat: plan('goat', 'stocky, low head, swept-back horns', 0.62,
    quadruped({ body: 0.95, girth: 0.16, back: 0.64, shin: 0.045, neck: [0.24, 0.08], head: 0.12, tail: 0.12, ears: 0.11, horns: [0.28, 0.04, 1] })),

  hare: plan('hare', 'small, crouched, ears longer than its head', 0.55,
    quadruped({ body: 0.8, girth: 0.2, back: 0.58, shin: 0.05, neck: [0.18, 0.14], head: 0.15, tail: 0.12, ears: 0.45 })),

  horse: plan('horse', 'long legs, long neck, mane and a full tail', 0.7,
    quadruped({ body: 1.15, girth: 0.17, back: 0.72, shin: 0.05, neck: [0.3, 0.32], head: 0.13, tail: 0.45, ears: 0.1, mane: true })),

  unicorn: plan('unicorn', 'a horse, and then the horn', 0.7,
    quadruped({ body: 1.15, girth: 0.17, back: 0.74, shin: 0.05, neck: [0.3, 0.34], head: 0.13, tail: 0.45, ears: 0.1, mane: true, horn: 0.36 })),

  bird: plan('bird', 'a long neck, a beak, and wings that are the whole width of it', 0.45, [
    { shape: 'sphere', size: [0.26, 1.0, 1.5], at: [0, 0.52, 0] },
    { shape: 'capsule', size: [0.09, 0.34, 0], at: [0, 0.72, 0.2], rot: [-0.5, 0, 0], tone: 0.95 },
    { shape: 'sphere', size: [0.12, 1.0, 1.1], at: [0, 0.88, 0.34], joint: 'head' },
    { shape: 'cone', size: [0.05, 0.3, 0], at: [0, 0.86, 0.55], rot: [Math.PI / 2, 0, 0], tone: 2.2, joint: 'head' },
    // Wings, swept back so the silhouette reads even at rest.
    { shape: 'box', size: [0.62, 0.05, 0.42], at: [0.42, 0.6, -0.04], rot: [0, 0.3, 0.18], tone: 0.78, joint: 'wingR', mirror: 'wingL' },
    { shape: 'capsule', size: [0.04, 0.28, 0], at: [0.11, 0.2, -0.02], tone: 2.0, joint: 'legR', mirror: 'legL' },
    { shape: 'box', size: [0.16, 0.05, 0.5], at: [0, 0.5, -0.42], rot: [0.2, 0, 0], tone: 0.8, joint: 'tail' },
  ]),

  serpent: plan('serpent', 'no legs at all — a line on the ground with a wedge for a head', 0.3, [
    { shape: 'capsule', size: [0.2, 0.5, 0], at: [0, 0.2, 0.3], rot: [Math.PI / 2, 0, 0] },
    { shape: 'capsule', size: [0.17, 0.5, 0], at: [0.08, 0.18, -0.2], rot: [Math.PI / 2, 0.4, 0], tone: 0.9 },
    { shape: 'capsule', size: [0.12, 0.5, 0], at: [-0.06, 0.16, -0.68], rot: [Math.PI / 2, -0.5, 0], tone: 0.82, joint: 'tail' },
    { shape: 'capsule', size: [0.07, 0.4, 0], at: [0.06, 0.14, -1.08], rot: [Math.PI / 2, 0.4, 0], tone: 0.75, joint: 'tail' },
    { shape: 'sphere', size: [0.19, 0.62, 1.3], at: [0, 0.22, 0.66], joint: 'head' },
    { shape: 'cone', size: [0.1, 0.22, 0], at: [0, 0.2, 0.88], rot: [Math.PI / 2, 0, 0], tone: 0.7, joint: 'head' },
  ]),

  fish: plan('fish', 'a body that tapers into a fin, and no way to stand up', 0.4, [
    { shape: 'sphere', size: [0.3, 0.95, 2.1], at: [0, 0.42, 0.1] },
    { shape: 'cone', size: [0.16, 0.4, 0], at: [0, 0.42, 0.72], rot: [Math.PI / 2, 0, 0], tone: 0.85, joint: 'head' },
    { shape: 'box', size: [0.04, 0.44, 0.32], at: [0, 0.42, -0.66], rot: [0, 0, 0], tone: 0.8, joint: 'tail' },
    { shape: 'box', size: [0.05, 0.3, 0.34], at: [0, 0.68, -0.05], tone: 0.78 },
    { shape: 'box', size: [0.34, 0.04, 0.2], at: [0, 0.3, 0.2], tone: 0.9 },
  ]),

  seal: plan('seal', 'a barrel with flippers, lying more than standing', 0.4, [
    { shape: 'sphere', size: [0.36, 0.9, 1.9], at: [0, 0.4, 0] },
    { shape: 'sphere', size: [0.2, 1.0, 1.15], at: [0, 0.56, 0.6], joint: 'head' },
    { shape: 'cone', size: [0.08, 0.16, 0], at: [0, 0.52, 0.78], rot: [Math.PI / 2, 0, 0], tone: 0.7, joint: 'head' },
    { shape: 'box', size: [0.34, 0.07, 0.26], at: [0.3, 0.24, 0.18], rot: [0, -0.3, 0.2], tone: 0.85, joint: 'legFR', mirror: 'legFL' },
    { shape: 'box', size: [0.2, 0.06, 0.34], at: [0.14, 0.2, -0.62], rot: [0, 0.4, 0], tone: 0.8, joint: 'tail' },
  ]),

  wyrm: plan('wyrm', 'the only impossible thing in Dal Riata, and it has wings', 0.55, [
    { shape: 'capsule', size: [0.24, 0.8, 0], at: [0, 0.6, 0], rot: [Math.PI / 2, 0, 0] },
    // Neck and head, carried high.
    { shape: 'capsule', size: [0.13, 0.6, 0], at: [0, 0.82, 0.5], rot: [Math.PI / 2 - 0.7, 0, 0], tone: 0.95 },
    { shape: 'sphere', size: [0.17, 0.9, 1.5], at: [0, 1.08, 0.82], joint: 'head' },
    { shape: 'cone', size: [0.09, 0.28, 0], at: [0, 1.04, 1.06], rot: [Math.PI / 2, 0, 0], tone: 0.75, joint: 'head' },
    { shape: 'cone', size: [0.05, 0.26, 0], at: [0.1, 1.22, 0.72], rot: [-0.5, 0, -0.35], tone: 0.5, joint: 'head', mirror: 'head' },
    // Wings — the whole reason it is not a big lizard. Two panels a side that
    // continue each other's sweep rather than crossing: the first pass set
    // them at very different angles and the silhouette read as four spikes.
    { shape: 'box', size: [1.3, 0.05, 0.95], at: [0.78, 0.92, -0.12], rot: [0, 0.34, 0.3], tone: 0.62, joint: 'wingR', mirror: 'wingL' },
    { shape: 'box', size: [0.9, 0.045, 0.6], at: [1.36, 1.14, -0.52], rot: [0, 0.55, 0.38], tone: 0.55, joint: 'wingR', mirror: 'wingL' },
    // Legs and a long tail that carries past the body.
    { shape: 'capsule', size: [0.09, 0.44, 0], at: [0.26, 0.24, 0.28], tone: 0.88, joint: 'legFR', mirror: 'legFL' },
    { shape: 'capsule', size: [0.11, 0.44, 0], at: [0.28, 0.24, -0.3], tone: 0.88, joint: 'legBR', mirror: 'legBL' },
    { shape: 'capsule', size: [0.13, 0.6, 0], at: [0, 0.58, -0.68], rot: [Math.PI / 2 - 0.25, 0, 0], tone: 0.9, joint: 'tail' },
    { shape: 'capsule', size: [0.07, 0.5, 0], at: [0, 0.46, -1.16], rot: [Math.PI / 2 - 0.45, 0, 0], tone: 0.85, joint: 'tail' },
  ]),
};

export type BodyPlanId = keyof typeof PLANS;

export const BODY_PLANS: Record<BodyPlanId, BodyPlan> = PLANS;

/* ------------------------------------------------------------------ */
/* Which creature is which                                             */
/* ------------------------------------------------------------------ */

/**
 * Matched on the creature's id, longest key first.
 *
 * Keyword matching rather than a field on every `MobDef` because most of the
 * bestiary south of the Fenmarch is *generated* — a per-mob field would have
 * to be generated too, from the creature's name, which is this table with an
 * extra step. A test walks every spawn in every zone and fails if one falls
 * through to `blob`, so a new creature without a shape is caught the same day
 * it is added.
 */
const BY_WORD: [string, BodyPlanId][] = [
  // People. The weapon in their hands is the class they fight like.
  ['bowman', 'archer'],
  ['archer', 'archer'],
  ['engineer', 'caster'],
  ['berserker', 'warrior'],
  ['champion', 'warrior'],
  ['spearman', 'warrior'],
  ['axeman', 'warrior'],
  ['blackshield', 'warrior'],
  ['warden', 'warrior'],
  ['levy', 'person'],
  ['raider', 'person'],
  ['reaver', 'person'],
  ['marauder', 'person'],
  ['enforcer', 'person'],
  ['scavenger', 'person'],
  ['smuggler', 'person'],
  ['outlaw', 'person'],
  ['cadfael', 'person'],
  ['aonghus', 'warrior'],
  ['muireann', 'warrior'],
  ['fiachra', 'person'],
  ['ruadhan', 'warrior'],
  ['ruadhán', 'warrior'],
  ['donnchadh', 'warrior'],

  // The one impossible thing.
  ['dragon', 'wyrm'],
  ['wyrm', 'wyrm'],
  ['drake', 'wyrm'],

  // Animals.
  ['warhound', 'wolf'],
  ['mastiff', 'wolf'],
  ['hound', 'wolf'],
  ['wolf', 'wolf'],
  ['lynx', 'wolf'],
  ['bear', 'bear'],
  ['old_scar', 'bear'],
  ['boar', 'boar'],
  ['stag', 'stag'],
  ['deer', 'stag'],
  ['goat', 'goat'],
  ['hare', 'hare'],
  ['rabbit', 'hare'],
  ['eagle', 'bird'],
  ['heron', 'bird'],
  ['hawk', 'bird'],
  ['crow', 'bird'],
  ['raven', 'bird'],
  ['adder', 'serpent'],
  ['eel', 'serpent'],
  ['serpent', 'serpent'],
  ['snake', 'serpent'],
  ['pike', 'fish'],
  ['cauldron', 'fish'],
  ['salmon', 'fish'],
  ['seal', 'seal'],

  // Mounts.
  ['cob', 'horse'],
  ['courser', 'horse'],
  ['destrier', 'horse'],
  ['garron', 'horse'],
  ['horse', 'horse'],
  ['pony', 'horse'],
  ['mare', 'horse'],
  ['unicorn', 'unicorn'],
  ['ashen_grey', 'unicorn'],
];

// Longest first, so `warhound` never loses to `hound` and `old_scar` never
// loses to a shorter word that happens to be inside it.
const SORTED = [...BY_WORD].sort((a, b) => b[0].length - a[0].length);

/**
 * The plan for a creature, falling back to the capsule.
 *
 * Takes the definition rather than the id so `rareOf` is unwrapped here and
 * cannot be forgotten by a caller: a rare spawn is the *same creature* as the
 * camp mob it replaces, and its own id says nothing about its shape. The first
 * pass matched on the id alone and put `Mirefang the Bog Wolf` on screen as a
 * capsule standing in a camp of wolves — which is the one creature in the zone
 * that most needs to be recognisable.
 */
export function bodyPlanFor(mob: { id: string; rareOf?: string }): BodyPlan {
  const key = (mob.rareOf ?? mob.id).toLowerCase();
  for (const [word, planId] of SORTED) {
    if (key.includes(word)) return BODY_PLANS[planId];
  }
  return BODY_PLANS.blob;
}

/**
 * A player or an adventurer, by class.
 *
 * Separate from the creature table because a class is not a keyword match —
 * it is a five-way enum the game already has, and there is no reason to go
 * through a string.
 */
export function bodyPlanForClass(classId: string): BodyPlan {
  switch (classId) {
    case 'warrior':
      return BODY_PLANS.warrior;
    case 'ranger':
      return BODY_PLANS.archer;
    case 'mage':
    case 'priest':
      return BODY_PLANS.caster;
    default:
      return BODY_PLANS.person;
  }
}
