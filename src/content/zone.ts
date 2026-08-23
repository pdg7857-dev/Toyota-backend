import type { Attributes, ClassId, Vec2 } from '../sim/types.js';

/**
 * Zone definition: static spawn points laid out by hand. When this grows past a
 * couple of hundred entries it wants an editor rather than a literal, but the
 * shape stays the same — the sim only ever reads `spawns`.
 */
export interface SpawnPoint {
  mobId: string;
  pos: Vec2;
  /**
   * Marks this spawn as a deliberate guard for the named boss.
   *
   * Guards are *meant* to sit inside the boss's approach — you clear them, then
   * pull the boss. Everything else must stay far enough away that meleeing the
   * boss cannot drag an unrelated camp into the fight, which `balance.test.ts`
   * enforces. Without this flag the check cannot tell a designed gauntlet from
   * a levelling camp that drifted too close.
   */
  guardOf?: string;
  /**
   * Marks this as a guard post for a holding.
   *
   * A post's `mobId` is a fallback: what actually stands here is decided by
   * whoever holds the ground right now. Take the Road Watch off the outlaws
   * and the bowmen are replaced by whatever the Freeholders keep there —
   * which is the whole point of the territory layer being visible at all.
   */
  holding?: string;
}

export interface VendorPlacement {
  vendorId: string;
  pos: Vec2;
}

/**
 * A road out of the zone.
 *
 * Zone bands deliberately overlap (1-25, 20-40, 40-70, 70-100), so `minLevel`
 * is set at the bottom of the destination's band: you may leave as soon as the
 * next zone has anything you can fight, not once you have exhausted this one.
 */
export interface ZoneExit {
  toZoneId: string;
  pos: Vec2;
  label: string;
  minLevel: number;
}

export interface ZoneDef {
  id: string;
  name: string;
  /** Half-extent of the playable square, in world units. */
  halfSize: number;
  playerStart: Vec2;
  spawns: SpawnPoint[];
  /**
   * Traders. Placed clear of every camp's aggro radius — a vendor you have to
   * fight your way to and then get pulled off is not a shop, and a test
   * enforces the clearance.
   */
  vendors: VendorPlacement[];
  exits: ZoneExit[];
  /** Level band this zone is built for, shown in the UI and used by tests. */
  levelRange: [number, number];
  /**
   * Which entry in `content/terrain.ts` decides how this place looks: ground
   * shape, palette, light, fog and scatter. Renderer-only — the sim never reads
   * it. Omitted means the default plains theme, which is what test arenas want.
   */
  theme?: string;
  /**
   * Whether this zone's camps can turn up rare spawns. Defaults to true.
   *
   * Test arenas set it false. A duel against a named mob you did not ask for
   * is a test measuring the wrong creature, and even the roll itself is not
   * free: it draws from the same `Rng` as combat, so leaving it on would shift
   * every seeded fight in the balance corpus.
   */
  rareSpawns?: boolean;
}

/**
 * A camp: `count` mobs scattered in a ring around a centre.
 *
 * The angular offset is derived from the centre rather than random, so the zone
 * layout is identical on every load — spawn positions are content, not
 * simulation, and must not depend on the sim's Rng.
 */
/** Mark a camp's spawn points as the guard posts of a holding. */
function post(holding: string, spawns: SpawnPoint[]): SpawnPoint[] {
  return spawns.map((sp) => ({ ...sp, holding }));
}

function camp(mobId: string, cx: number, cz: number, radius: number, count: number): SpawnPoint[] {
  const out: SpawnPoint[] = [];
  const offset = (Math.abs(cx * 7 + cz * 13) % 100) / 100;
  for (let i = 0; i < count; i++) {
    const a = ((i / count) + offset) * Math.PI * 2;
    // Alternate between the ring and a tighter inner ring so camps don't read
    // as perfect circles.
    const r = radius * (i % 2 === 0 ? 1 : 0.55);
    out.push({ mobId, pos: { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r } });
  }
  return out;
}

/**
 * The Fenmarch — the levels 1–25 starting region.
 *
 * Laid out as bands running north to south: you spawn at the standing stones on
 * the northern moor and the danger rises the further down you push. Cadfael's
 * outlaw camp sits at the two-thirds mark, and Old Scar holds the southern
 * marsh alone.
 */
export const FENMARCH: ZoneDef = {
  id: 'fenmarch',
  name: 'The Fenmarch',
  halfSize: 145,
  playerStart: { x: 0, z: 88 },
  spawns: [
    // --- lv1 hares: the northern moor, right on top of the spawn point ------
    ...camp('moor_hare', -14, 76, 8, 5),
    ...camp('moor_hare', 14, 74, 8, 5),
    ...camp('moor_hare', 0, 64, 10, 6),

    // --- lv3 boars ---------------------------------------------------------
    ...camp('mossback_boar', -22, 56, 9, 6),
    ...camp('mossback_boar', 20, 54, 9, 6),
    ...camp('mossback_boar', -2, 46, 10, 6),

    // --- lv5 adders: the first wet ground ----------------------------------
    ...camp('fen_adder', -26, 38, 9, 6),
    ...camp('fen_adder', 24, 36, 9, 6),
    ...camp('fen_adder', 0, 28, 10, 6),

    // --- lv8 wolves --------------------------------------------------------
    ...camp('bog_wolf', -28, 20, 9, 6),
    ...camp('bog_wolf', 26, 18, 9, 6),
    ...camp('bog_wolf', -4, 10, 10, 6),

    // --- lv11 stags --------------------------------------------------------
    ...camp('moor_stag', -30, 0, 10, 6),
    ...camp('moor_stag', 28, -2, 10, 6),
    ...camp('moor_stag', 0, -10, 10, 5),

    // --- lv13 outlaw bowmen: the road watch --------------------------------
    // These are guard POSTS, not a camp: what stands here follows whoever
    // holds the Road Watch. Take it off the outlaws and the bowmen go.
    ...post('road_watch', camp('outlaw_bowman', -26, -18, 9, 6)),
    ...post('road_watch', camp('outlaw_bowman', 24, -20, 9, 6)),

    // --- lv16 outlaw reavers -----------------------------------------------
    ...camp('outlaw_reaver', -28, -32, 9, 6),
    ...camp('outlaw_reaver', 26, -34, 9, 6),
    ...camp('outlaw_reaver', 0, -34, 8, 5),

    // --- lv19 marsh bears --------------------------------------------------
    ...camp('marsh_bear', -26, -46, 9, 5),
    ...camp('marsh_bear', 26, -48, 9, 5),

    // --- lv20 boss: Cadfael's camp, deliberately guarded ---------------------
    ...camp('outlaw_reaver', 0, -62, 13, 4).map((s) => ({ ...s, guardOf: 'cadfael' })),
    { mobId: 'cadfael', pos: { x: 0, z: -64 } },

    // --- lv21 lynxes -------------------------------------------------------
    ...camp('fen_lynx', -30, -74, 9, 6),
    ...camp('fen_lynx', 28, -76, 9, 6),

    // --- lv23 marauders: the southern marsh's guard posts -------------------
    ...post('southern_marsh', camp('outlaw_marauder', -26, -86, 9, 5)),
    ...post('southern_marsh', camp('outlaw_marauder', 26, -88, 9, 5)),

    // --- lv25 elite boss: the southern marsh, genuinely alone ---------------
    // No guards and a wide empty approach: Old Scar is meant to be fought with
    // nothing else on the screen.
    { mobId: 'old_scar', pos: { x: 0, z: -118 } },
  ],
  vendors: [
    // At the standing stones, where you start and where you come back to.
    { vendorId: 'maeve', pos: { x: 0, z: 96 } },
    // Off the road east of the outlaw watch, for the second half of the zone.
    { vendorId: 'bryn', pos: { x: 52, z: -30 } },
  ],
  exits: [
    { toZoneId: 'ardmoor', pos: { x: 78, z: -60 }, label: 'The Hill Road to Ardmoor', minLevel: 20 },
  ],
  levelRange: [1, 25],
  theme: 'plains',
};

// --------------------------------------------------------------------------
// Zones 2-4.
//
// Same shape as the Fenmarch — difficulty rising north to south in bands, a
// trader near the arrival point, a boss at the two-thirds mark and another at
// the far end. Built from a helper because four hand-written zone literals is
// four chances for a camp to end up somewhere it should not be.
// --------------------------------------------------------------------------

interface BandSpec {
  mobId: string;
  z: number;
  /** Camp centres are mirrored either side of the road plus one on it. */
  wide?: boolean;
  /** Makes this band the guard posts of a holding rather than a plain camp. */
  holding?: string;
}

function bands(specs: BandSpec[]): SpawnPoint[] {
  const out: SpawnPoint[] = [];
  for (const { mobId, z, wide, holding } of specs) {
    const band: SpawnPoint[] = [];
    band.push(...camp(mobId, -27, z, 9, 6));
    band.push(...camp(mobId, 27, z - 2, 9, 6));
    if (wide) band.push(...camp(mobId, 0, z - 9, 9, 5));
    out.push(...(holding ? post(holding, band) : band));
  }
  return out;
}

export const ARDMOOR: ZoneDef = {
  id: 'ardmoor',
  name: 'Ardmoor',
  halfSize: 140,
  playerStart: { x: 0, z: 104 },
  levelRange: [20, 40],
  theme: 'crags',
  spawns: [
    ...bands([
      { mobId: 'crag_goat', z: 88, wide: true },
      { mobId: 'hill_wolf', z: 64, wide: true },
      { mobId: 'cattle_raider', z: 40, wide: true, holding: 'cattle_road' },
      { mobId: 'moor_eagle', z: 16 },
    ]),
    // Aonghus holds the cattle-fold, with his axemen posted around it.
    ...camp('clan_axeman', 0, -6, 13, 4).map((sp) => ({ ...sp, guardOf: 'aonghus' })),
    { mobId: 'aonghus', pos: { x: 0, z: -8 } },
    ...bands([
      { mobId: 'clan_axeman', z: -34, holding: 'high_shelves' },
      { mobId: 'highland_bear', z: -58 },
      { mobId: 'clan_berserker', z: -82 },
    ]),
    { mobId: 'muireann', pos: { x: 0, z: -116 } },
  ],
  vendors: [{ vendorId: 'sorcha', pos: { x: 0, z: 112 } }],
  exits: [
    { toZoneId: 'fenmarch', pos: { x: -58, z: 112 }, label: 'The Hill Road to the Fenmarch', minLevel: 1 },
    { toZoneId: 'reach', pos: { x: 80, z: -60 }, label: 'The Drowned Causeway', minLevel: 38 },
  ],
};

export const SUNKEN_REACH: ZoneDef = {
  id: 'reach',
  name: 'The Sunken Wood',
  halfSize: 140,
  playerStart: { x: 0, z: 104 },
  levelRange: [38, 70],
  theme: 'wyldwood',
  spawns: [
    ...bands([
      { mobId: 'reach_eel', z: 88, wide: true },
      { mobId: 'wrecker_scavenger', z: 64, wide: true },
      { mobId: 'marsh_heron', z: 40, wide: true },
      { mobId: 'smuggler_enforcer', z: 16, holding: 'drowned_causeway' },
    ]),
    ...camp('smuggler_enforcer', 0, -6, 13, 4).map((sp) => ({ ...sp, guardOf: 'fiachra' })),
    { mobId: 'fiachra', pos: { x: 0, z: -8 } },
    ...bands([
      { mobId: 'tidewatch_marauder', z: -34, holding: 'deepwood' },
      { mobId: 'great_pike', z: -58 },
      { mobId: 'grey_seal_bull', z: -82 },
    ]),
    { mobId: 'old_cauldron', pos: { x: 0, z: -116 } },
  ],
  vendors: [{ vendorId: 'odhran', pos: { x: 0, z: 112 } }],
  exits: [
    { toZoneId: 'ardmoor', pos: { x: -58, z: 112 }, label: 'The Causeway to Ardmoor', minLevel: 1 },
    { toZoneId: 'caer_dubh', pos: { x: 80, z: -60 }, label: 'The Black Road to Caer Dubh', minLevel: 66 },
  ],
};

export const CAER_DUBH: ZoneDef = {
  id: 'caer_dubh',
  name: 'Caer Dubh',
  halfSize: 140,
  playerStart: { x: 0, z: 104 },
  levelRange: [66, 100],
  theme: 'otherworld',
  spawns: [
    ...bands([
      { mobId: 'fort_mastiff', z: 88, wide: true },
      { mobId: 'warband_levy', z: 64, wide: true },
      { mobId: 'blackshield_spearman', z: 40, wide: true, holding: 'black_road' },
      { mobId: 'siege_engineer', z: 16 },
    ]),
    ...camp('blackshield_spearman', 0, -6, 13, 4).map((sp) => ({ ...sp, guardOf: 'ruadhan' })),
    { mobId: 'ruadhan', pos: { x: 0, z: -8 } },
    ...bands([
      { mobId: 'warhound_alpha', z: -34 },
      { mobId: 'blackshield_champion', z: -58, holding: 'gatehouse' },
      { mobId: 'fort_warden', z: -82 },
    ]),
    { mobId: 'donnchadh', pos: { x: 0, z: -116 } },
  ],
  vendors: [{ vendorId: 'aoife', pos: { x: 0, z: 112 } }],
  exits: [
    { toZoneId: 'reach', pos: { x: -58, z: 112 }, label: 'The Black Road to the Sunken Wood', minLevel: 1 },
  ],
};

/** Every zone, keyed by id. Save files store a zone id, not a zone. */
export const ZONES: Record<string, ZoneDef> = {
  fenmarch: FENMARCH,
  ardmoor: ARDMOOR,
  reach: SUNKEN_REACH,
  caer_dubh: CAER_DUBH,
};

export function getZone(id: string): ZoneDef {
  const zone = ZONES[id];
  if (!zone) throw new Error(`Unknown zone: ${id}`);
  return zone;
}

export const STARTING_ZONE_ID = 'fenmarch';

export interface ClassDef {
  id: ClassId;
  name: string;
  description: string;
  baseAttributes: Attributes;
  startingWeapon: string;
  /** Whether the class is actually playable yet. */
  implemented: boolean;
  /** One-line hint shown on the class-select screen. */
  playstyle: string;
  /** Renderer hint. */
  color: number;
}

export const CLASSES: Record<ClassId, ClassDef> = {
  warrior: {
    id: 'warrior',
    name: 'Warrior',
    description: 'Holds the line. High health, steady melee damage, hard to kill.',
    playstyle: 'Strength · melee · durable',
    implemented: true,
    baseAttributes: { strength: 8, dexterity: 4, focus: 2, vitality: 8 },
    startingWeapon: 'rusted_blade',
    color: 0xd9c27a,
  },
  priest: {
    id: 'priest',
    name: 'Priest',
    description:
      'Outlasts what it cannot outhit. Sustains through damage with healing, ' +
      'and is the surest hand at cutting a spell short.',
    playstyle: 'Focus · caster · sustain & interrupts',
    implemented: true,
    baseAttributes: { strength: 3, dexterity: 4, focus: 10, vitality: 6 },
    startingWeapon: 'oaken_walking_staff',
    color: 0xbfd4e8,
  },
  ranger: {
    id: 'ranger',
    name: 'Ranger',
    description:
      'Kills at range before it reaches you. Trades armour for distance and ' +
      'the longest reach of any class.',
    playstyle: 'Dexterity · ranged · steady pressure',
    implemented: true,
    baseAttributes: { strength: 5, dexterity: 9, focus: 4, vitality: 6 },
    startingWeapon: 'frayed_shortbow',
    color: 0x7ab87a,
  },
  rogue: {
    id: 'rogue',
    name: 'Rogue',
    description:
      'Bursts a target down before it can answer. Fast blades, thin margins, ' +
      'and the best evasion in the game when it matters.',
    playstyle: 'Dexterity · melee · burst',
    implemented: true,
    baseAttributes: { strength: 6, dexterity: 10, focus: 3, vitality: 5 },
    startingWeapon: 'chipped_dirk',
    color: 0x9a7ab8,
  },
  mage: {
    id: 'mage',
    name: 'Mage',
    description:
      'The heaviest damage in the game and the least health to survive a ' +
      'mistake. Kill it before it reaches you.',
    playstyle: 'Focus · caster · burst',
    implemented: true,
    baseAttributes: { strength: 2, dexterity: 4, focus: 12, vitality: 5 },
    startingWeapon: 'cracked_wand',
    color: 0x7a9ad9,
  },
};

/** Classes a player can actually pick right now. */
export const PLAYABLE_CLASSES: ClassDef[] = Object.values(CLASSES).filter((c) => c.implemented);
