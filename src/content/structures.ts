import { isBoss, type Vec2 } from '../sim/types.js';
import { getMob } from './mobs.js';
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
  | 'bridge'
  | 'leystone';

export interface StructureDef {
  kind: StructureKind;
  pos: Vec2;
  /** Rotation in radians, so a row of them does not read as a grid. */
  facing: number;
  /** Size multiplier. */
  scale: number;
  /** How much flat ground it needs, for the height field. */
  clearing: number;
  /**
   * Placed to explain something that is already there — a boss's ground, a
   * holding's post, a trader's shopfront — rather than to fill empty country.
   *
   * Anchored ones deliberately sit *inside* the thing they explain, which is
   * right for a landmark and wrong for anything you have to stand still at:
   * see `content/discoveries.ts`.
   */
  anchored?: boolean;
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
  leystone: 9,
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

/**
 * Every landmark in a zone, from the zone alone.
 *
 * Lived in `render/scene.ts` until the sim needed to know where the cairns
 * were. It is pure — it reads a `ZoneDef` and returns data — so moving it here
 * costs nothing and buys the thing that matters: **the sim and the renderer
 * cannot disagree about where a landmark is**, because they call the same
 * function rather than each deriving it. The alternative was passing the
 * renderer's list into the sim, which would make a headless world's structures
 * depend on whether anybody had drawn them.
 *
 * Anchored ones first — a tower on every guard post, a ruin over every boss, a
 * farmstead at every shopfront — then the rest fill the empty country. The
 * anchors are what make a landmark information rather than decoration.
 */
export function zoneStructures(zone: StructureZone, country = 20): StructureDef[] {
  const anchors: Array<{ pos: Vec2; kind: StructureKind; scale?: number }> = [];
  const keepClear: Vec2[] = [];
  const seenHoldings = new Set<string>();

  for (const spawn of zone.spawns) {
    keepClear.push(spawn.pos);
    if (isBoss(getMob(spawn.mobId).stars)) {
      anchors.push({ pos: { x: spawn.pos.x, z: spawn.pos.z - 26 }, kind: 'ruin', scale: 1.3 });
    } else if (spawn.holding && !seenHoldings.has(spawn.holding)) {
      seenHoldings.add(spawn.holding);
      anchors.push({
        pos: { x: spawn.pos.x + 22, z: spawn.pos.z - 18 },
        kind: holdingStructure(zone.id),
        scale: 1.15,
      });
    }
  }
  for (const vendor of zone.vendors ?? []) {
    anchors.push({ pos: { x: vendor.pos.x + 17, z: vendor.pos.z + 5 }, kind: 'farmstead' });
    keepClear.push(vendor.pos);
  }
  // A town: its stone in the middle, and a couple of buildings round it.
  //
  // The stone is anchored, so it never holds a discovery and never counts as
  // one of the landmarks that fill the empty country — a leystone is somewhere
  // you come back to, and something you can only find once is the opposite of
  // that.
  //
  // The buildings are what make it read as a *place* from four hundred metres
  // rather than as a trader standing beside a rock. A vendor already brings one
  // building with them, so this adds the rest of the hamlet; which kinds come
  // from the zone, so the Fenmarch's towns are farms and Caer Dubh's are things
  // somebody abandoned.
  const TOWN_RADIUS = 23;
  for (const town of zone.settlements ?? []) {
    anchors.push({ pos: town.pos, kind: 'leystone', scale: 1 });
    keepClear.push(town.pos);
    const kinds = TOWN_KINDS[zone.id] ?? TOWN_KINDS.fenmarch!;
    for (let i = 0; i < kinds.length; i++) {
      // Deterministic angles off the town's own position, so a town is the
      // same town every time you walk into it and no two are laid out alike.
      const a = ((hash(`${town.id}:${i}`) % 360) / 360) * Math.PI * 2;
      anchors.push({
        pos: {
          x: town.pos.x + Math.cos(a) * TOWN_RADIUS,
          z: town.pos.z + Math.sin(a) * TOWN_RADIUS,
        },
        kind: kinds[i]!,
        scale: 0.9,
      });
    }
  }
  keepClear.push(zone.playerStart);
  for (const exit of zone.exits ?? []) keepClear.push(exit.pos);

  return structuresFor(zone.id, zone.theme, anchors, zone.halfSize, keepClear, country);
}

/**
 * What a town in each zone is built out of.
 *
 * Two buildings beside the trader's one. Deliberately the same table shape as
 * `ZONE_KINDS` and deliberately different from it: the country around a zone
 * says what happened there, and a town says who is still living in it.
 */
const TOWN_KINDS: Record<string, StructureKind[]> = {
  fenmarch: ['farmstead', 'camp'],
  ardmoor: ['farmstead', 'watchtower'],
  reach: ['bridge', 'camp'],
  caer_dubh: ['ruin', 'watchtower'],
};

/**
 * What this module needs of a zone.
 *
 * Structural rather than a `ZoneDef` import, so `content/zone.ts` can go on
 * importing this file for the clearances without the two forming a cycle. It
 * resolves which spawns are bosses *itself* rather than taking a flag: the sim
 * and the renderer both call this, and a caller-supplied flag is a caller that
 * can get it wrong — which is precisely the disagreement moving this here was
 * meant to make impossible.
 */
export interface StructureZone {
  id: string;
  theme?: string;
  halfSize: number;
  playerStart: Vec2;
  spawns: Array<{ mobId: string; pos: Vec2; holding?: string }>;
  vendors?: Array<{ pos: Vec2 }>;
  settlements?: Array<{ id: string; pos: Vec2 }>;
  exits?: Array<{ pos: Vec2 }>;
}

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
  /**
   * How many landmarks to scatter across the **empty country**, not counting
   * the anchored ones.
   *
   * It used to be a total, which quietly worked while a zone had four or five
   * anchors and broke the moment every zone grew six towns: the anchors ate
   * the budget, the wilds got nothing, and the discovery count — which only
   * ever counts unanchored landmarks — fell from nine to one in the Sunken
   * Wood. A number that means "and some others" cannot also mean "in total".
   */
  country = 14,
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
      anchored: true,
    });
  }

  // Then fill the empty country.
  let attempts = 0;
  let filled = 0;
  while (filled < country && attempts < country * 60) {
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
    filled++;
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
