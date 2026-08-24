import type { Vec2 } from '../sim/types.js';
import { SHORE_CLEARANCE, getTheme, terrainHeight } from './terrain.js';

/**
 * Structures: the things on the map that somebody built.
 *
 * The world already had scenery — trees, rocks, standing stones scattered by
 * the thousand — and scenery is not the same as landmarks. Scatter tells you
 * what a place is made of; a watchtower on a ridge tells you *where you are*,
 * and on a map three kilometres across that is the difference between exploring
 * and being lost.
 *
 * Three rules, and each of them is about the map being readable:
 *
 *  - **A structure means something.** A watchtower stands on a holding, a ruin
 *    marks a boss's ground, a wreck is on the shore of a lake, a farmstead is
 *    where a trader has set up. Nothing is placed decoratively, so seeing one
 *    from a distance is information rather than dressing.
 *  - **They are unique enough to navigate by.** Deterministic per zone and
 *    never repeated within sight of each other, because two identical towers on
 *    two different ridges is worse than none — a landmark you can confuse with
 *    another landmark is an anti-landmark.
 *  - **Nothing fights inside one.** They are levelled with the ground under
 *    them and kept clear of camp centres, so a structure never becomes a place
 *    where a telegraph circle clips through a wall.
 *
 * Renderer-only, like the terrain: `render/scene.ts` knows how to build a
 * tower, and this file knows there is one on the Road Watch. The sim has no
 * idea any of it exists.
 */

export type StructureKind =
  | 'watchtower'
  | 'ruin'
  | 'stoneCircle'
  | 'wreck'
  | 'farmstead'
  | 'cairn'
  | 'camp'
  | 'bridge';

export interface StructureDef {
  kind: StructureKind;
  pos: Vec2;
  /** Rotation in radians, so a row of them does not read as a grid. */
  facing: number;
  /** Size multiplier. */
  scale: number;
  /** How much flat ground it needs, for the height field. */
  clearing: number;
}

/** How far a structure keeps away from anything a player fights in. */
export const STRUCTURE_CLEARANCE = 34;

/**
 * What each kind needs around it.
 *
 * A tower is tall and narrow and can sit almost anywhere; a stone circle is
 * forty metres of level ground and has to be sited like a building.
 */
const FOOTPRINT: Record<StructureKind, number> = {
  watchtower: 11,
  ruin: 17,
  stoneCircle: 21,
  wreck: 13,
  farmstead: 15,
  cairn: 6,
  camp: 13,
  bridge: 12,
};

/**
 * Which structures suit which zone.
 *
 * The Fenmarch has farmsteads and cairns because people live there; Caer Dubh
 * has ruins and stone circles because whatever lived there is gone. This is the
 * cheapest characterisation in the game — the same four kinds arranged
 * differently read as four different histories.
 */
const ZONE_KINDS: Record<string, StructureKind[]> = {
  fenmarch: ['farmstead', 'cairn', 'stoneCircle', 'ruin', 'camp'],
  ardmoor: ['watchtower', 'cairn', 'stoneCircle', 'ruin', 'camp'],
  reach: ['wreck', 'ruin', 'bridge', 'camp', 'cairn'],
  caer_dubh: ['ruin', 'stoneCircle', 'watchtower', 'cairn'],
};

/** Deterministic hash, so a zone's landmarks are where they were last time. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface StructureSite {
  /** Where a landmark belongs, and why. */
  pos: Vec2;
  kind: StructureKind;
  scale: number;
}

/**
 * Lay a zone's landmarks out.
 *
 * `anchors` are the places that already mean something — guard posts, boss
 * arenas, shopfronts — and get the structure that explains them. The rest fill
 * the empty quarters of the map, spaced far enough apart that two are never in
 * sight of each other.
 */
export function structuresFor(
  zoneId: string,
  themeId: string | undefined,
  anchors: Array<{ pos: Vec2; kind: StructureKind; scale?: number }>,
  halfSize: number,
  /** Places nothing may be built on: camps, arenas, shopfronts. */
  keepClear: Vec2[],
  count = 14,
): StructureDef[] {
  const spec = getTheme(themeId).terrain;
  const water = spec.waterLevel;
  const kinds = ZONE_KINDS[zoneId] ?? ZONE_KINDS.fenmarch!;
  const random = rng(hash(`${zoneId}:structures`));
  const out: StructureDef[] = [];

  const fits = (pos: Vec2, footprint: number): boolean => {
    if (Math.abs(pos.x) > halfSize * 0.94 || Math.abs(pos.z) > halfSize * 0.94) return false;
    // Never underwater, and never on the shoreline where the carve begins —
    // a farmstead half in a lake reads as a bug, not as atmosphere.
    if (water !== undefined && terrainHeight(pos.x, pos.z, spec) < water + SHORE_CLEARANCE) {
      return false;
    }
    for (const clear of keepClear) {
      if (Math.hypot(pos.x - clear.x, pos.z - clear.z) < STRUCTURE_CLEARANCE + footprint) return false;
    }
    // And far enough from another landmark to be a landmark.
    for (const other of out) {
      if (Math.hypot(pos.x - other.pos.x, pos.z - other.pos.z) < 260) return false;
    }
    return true;
  };

  // The anchored ones first: these are the landmarks that explain something.
  for (const anchor of anchors) {
    out.push({
      kind: anchor.kind,
      pos: anchor.pos,
      facing: random() * Math.PI * 2,
      scale: anchor.scale ?? 1,
      clearing: FOOTPRINT[anchor.kind],
    });
  }

  // Then fill the empty country.
  let attempts = 0;
  while (out.length < count && attempts < count * 60) {
    attempts++;
    const kind = kinds[Math.floor(random() * kinds.length)]!;
    const pos = {
      x: (random() * 2 - 1) * halfSize * 0.9,
      z: (random() * 2 - 1) * halfSize * 0.9,
    };
    if (!fits(pos, FOOTPRINT[kind])) continue;
    out.push({
      kind,
      pos,
      facing: random() * Math.PI * 2,
      scale: 0.85 + random() * 0.4,
      clearing: FOOTPRINT[kind],
    });
  }
  return out;
}

/**
 * The structure that belongs at a holding's guard post.
 *
 * A front is an abstraction — a number in a panel and a banner colour — until
 * there is something standing on it. This is what makes "the Road Watch" a
 * place rather than a word.
 */
export function holdingStructure(zoneId: string): StructureKind {
  return zoneId === 'reach' ? 'camp' : zoneId === 'fenmarch' ? 'camp' : 'watchtower';
}
