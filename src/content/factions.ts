import type { FactionId, Vec2 } from '../sim/types.js';

/**
 * Factions, territory, and the politics of Dal Riata's poor cousin.
 *
 * Everything else in this game answers "how strong is my character". This
 * layer answers a different question: **what did I change?**
 *
 * The rules it runs on:
 *
 *  - **People have politics. Animals do not.** A Bog Wolf belongs to no one and
 *    holds nothing. Only the human factions garrison ground, which keeps the
 *    world grounded — this is a map of who controls a road, not a bestiary
 *    with flags on it.
 *  - **Ground changes hands. Towns do not.** Every holding can flip; no
 *    trader's ground is ever contested. A world where everything can be lost
 *    is a world where nothing feels stable, and a player who logs back in to
 *    find the shop gone has been punished for leaving. The politics move; the
 *    places you keep your things do not.
 *  - **The map moves without you.** Each holding drifts on its own, slowly, so
 *    the war is a thing happening in the world rather than a thing waiting for
 *    the player to press start. Pushing back is what your kills are *for*.
 *  - **Standing is memory.** Factions remember what you did to them, and the
 *    most legible consequence in a single-player game is a camp that stops
 *    swinging at you — or starts.
 */

export interface FactionDef {
  id: FactionId;
  name: string;
  /** One line, shown wherever the faction is named. */
  blurb: string;
  /** Faction this one is trying to take ground from. */
  rival: FactionId;
  /** Renderer hint: the colour this faction's holdings are drawn in. */
  color: number;
}

export const FACTIONS: Record<FactionId, FactionDef> = {
  freeholders: {
    id: 'freeholders',
    name: 'The Freeholders',
    blurb: 'Farmers, drovers and traders. They hold ground by being on it.',
    rival: 'outlaws',
    color: 0x8fc16a,
  },
  outlaws: {
    id: 'outlaws',
    name: "Cadfael's Outlaws",
    blurb: 'The road is theirs and they charge for it.',
    rival: 'freeholders',
    color: 0xc9784a,
  },
  clans: {
    id: 'clans',
    name: 'The Hill Clans',
    blurb: 'Cattle, grudges and a very long memory.',
    rival: 'freeholders',
    color: 0x9a8fd0,
  },
  wreckers: {
    id: 'wreckers',
    name: 'The Wreckers',
    blurb: 'Everything the flood took, they consider theirs.',
    rival: 'freeholders',
    color: 0x54b39a,
  },
  blackshields: {
    id: 'blackshields',
    name: 'The Blackshield Warband',
    blurb: 'A standing army with nowhere left to go home to.',
    rival: 'freeholders',
    color: 0x8d8fa8,
  },
};

/**
 * A stretch of ground that can change hands.
 *
 * `spawns` are the guard posts that garrison it: their mob is decided by
 * whoever holds the holding right now, not by the zone layout. Everything else
 * in the zone — the wildlife, the camps, the traders — is untouched by
 * politics, which is what keeps a flip legible rather than total.
 */
export interface HoldingDef {
  id: string;
  name: string;
  zoneId: string;
  /** Where the banner sits, for the map panel and the renderer. */
  pos: Vec2;
  /** Who holds it when a fresh world is built. */
  initialController: FactionId;
  /** The two powers contesting it. Control only ever moves between these. */
  claimants: [FactionId, FactionId];
  /** What garrisons the guard posts, per faction. */
  garrison: Record<string, string>;
  /**
   * Which way this holding drifts when nobody interferes, and how fast, in
   * pressure per real minute. Positive favours `claimants[1]`.
   *
   * This is what makes the map a living thing rather than a scoreboard. Set
   * per holding so a zone has fronts that are quietly losing and fronts that
   * are quietly winning, rather than one uniform tide.
   */
  drift: number;
}

/**
 * Pressure needed to flip a holding, measured from dead centre.
 *
 * Control is one number per holding in [-CONTROL_LIMIT, +CONTROL_LIMIT]:
 * negative is `claimants[0]`, positive is `claimants[1]`. Flipping requires
 * crossing the far threshold rather than the midpoint, so a contested front
 * does not thrash back and forth every time you kill two people.
 */
export const CONTROL_LIMIT = 100;

/** How far past centre control has to travel before the banner changes. */
export const FLIP_THRESHOLD = 60;

/** Pressure one kill applies against the victim's faction. */
export const PRESSURE_PER_KILL = 1.4;

/** Pressure a boss kill applies. Bosses are the hinge of their front. */
export const PRESSURE_PER_BOSS = 30;

/** Pressure finishing a quest applies for the faction that asked. */
export const PRESSURE_PER_QUEST = 12;

export const HOLDINGS: HoldingDef[] = [
  // --- The Fenmarch: the road, and who is allowed to use it ---------------
  {
    id: 'road_watch',
    name: 'The Road Watch',
    zoneId: 'fenmarch',
    pos: { x: 0, z: -20 },
    initialController: 'outlaws',
    claimants: ['freeholders', 'outlaws'],
    garrison: { freeholders: 'moor_stag', outlaws: 'outlaw_bowman' },
    drift: 0.35,
  },
  {
    id: 'southern_marsh',
    name: 'The Southern Marsh',
    zoneId: 'fenmarch',
    pos: { x: 0, z: -86 },
    initialController: 'outlaws',
    claimants: ['freeholders', 'outlaws'],
    garrison: { freeholders: 'fen_lynx', outlaws: 'outlaw_marauder' },
    drift: 0.2,
  },

  // --- Ardmoor: the cattle roads ------------------------------------------
  {
    id: 'cattle_road',
    name: 'The Cattle Road',
    zoneId: 'ardmoor',
    pos: { x: 0, z: 40 },
    initialController: 'clans',
    claimants: ['freeholders', 'clans'],
    garrison: { freeholders: 'crag_goat', clans: 'cattle_raider' },
    drift: 0.3,
  },
  {
    id: 'high_shelves',
    name: 'The High Shelves',
    zoneId: 'ardmoor',
    pos: { x: 0, z: -34 },
    initialController: 'clans',
    claimants: ['freeholders', 'clans'],
    garrison: { freeholders: 'highland_bear', clans: 'clan_axeman' },
    drift: -0.15,
  },

  // --- The Sunken Wood: the salvage --------------------------------------
  {
    id: 'drowned_causeway',
    name: 'The Drowned Causeway',
    zoneId: 'reach',
    pos: { x: 0, z: 16 },
    initialController: 'wreckers',
    claimants: ['freeholders', 'wreckers'],
    garrison: { freeholders: 'marsh_heron', wreckers: 'smuggler_enforcer' },
    drift: 0.25,
  },
  {
    id: 'deepwood',
    name: 'The Deepwood',
    zoneId: 'reach',
    pos: { x: 0, z: -34 },
    initialController: 'wreckers',
    claimants: ['freeholders', 'wreckers'],
    garrison: { freeholders: 'great_pike', wreckers: 'tidewatch_marauder' },
    drift: -0.2,
  },

  // --- Caer Dubh: the warband's ground ------------------------------------
  {
    id: 'black_road',
    name: 'The Black Road',
    zoneId: 'caer_dubh',
    pos: { x: 0, z: 40 },
    initialController: 'blackshields',
    claimants: ['freeholders', 'blackshields'],
    garrison: { freeholders: 'fort_mastiff', blackshields: 'blackshield_spearman' },
    drift: 0.4,
  },
  {
    id: 'gatehouse',
    name: 'The Gatehouse',
    zoneId: 'caer_dubh',
    pos: { x: 0, z: -34 },
    initialController: 'blackshields',
    claimants: ['freeholders', 'blackshields'],
    garrison: { freeholders: 'warhound_alpha', blackshields: 'blackshield_champion' },
    drift: 0.15,
  },
];

export function getFaction(id: FactionId): FactionDef {
  const faction = FACTIONS[id];
  if (!faction) throw new Error(`Unknown faction: ${id}`);
  return faction;
}

export function getHolding(id: string): HoldingDef {
  const holding = HOLDINGS.find((h) => h.id === id);
  if (!holding) throw new Error(`Unknown holding: ${id}`);
  return holding;
}

export function holdingsIn(zoneId: string): HoldingDef[] {
  return HOLDINGS.filter((h) => h.zoneId === zoneId);
}

/**
 * Standing bands.
 *
 * The one that matters mechanically is `hostile`: a faction that hates you
 * sends its guards after you on sight, and one that has come to terms leaves
 * you alone. That is the most legible consequence available in a game with no
 * other players in it — the world visibly reacting to what you have done.
 */
export const STANDING_LIMIT = 1000;

export type StandingBand = 'hated' | 'hostile' | 'wary' | 'neutral' | 'accepted' | 'trusted';

export function standingBand(value: number): StandingBand {
  if (value <= -600) return 'hated';
  if (value <= -200) return 'hostile';
  if (value < 0) return 'wary';
  if (value < 200) return 'neutral';
  if (value < 600) return 'accepted';
  return 'trusted';
}

/** Below this, a faction's people attack on sight regardless of provocation. */
export const HOSTILE_AT = -200;

/** At or above this, a faction's people will not start a fight with you. */
export const TRUCE_AT = 200;

/** Standing lost for killing one of a faction's people. */
export const STANDING_PER_KILL = 6;

/** Standing gained with the rival of whoever you just killed. */
export const STANDING_RIVAL_SHARE = 0.5;

/** Standing granted by a quest turned in for a faction. */
export const STANDING_PER_QUEST = 90;

/** Discount a trusted faction's traders give, and the markup a wary one adds. */
export const STANDING_PRICE_SWING = 0.25;
