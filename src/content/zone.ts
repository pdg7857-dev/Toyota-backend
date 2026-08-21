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
}

export interface ZoneDef {
  id: string;
  name: string;
  /** Half-extent of the playable square, in world units. */
  halfSize: number;
  playerStart: Vec2;
  spawns: SpawnPoint[];
}

/**
 * A camp: `count` mobs scattered in a ring around a centre.
 *
 * The angular offset is derived from the centre rather than random, so the zone
 * layout is identical on every load — spawn positions are content, not
 * simulation, and must not depend on the sim's Rng.
 */
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
    ...camp('outlaw_bowman', -26, -18, 9, 6),
    ...camp('outlaw_bowman', 24, -20, 9, 6),

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

    // --- lv23 marauders ----------------------------------------------------
    ...camp('outlaw_marauder', -26, -86, 9, 5),
    ...camp('outlaw_marauder', 26, -88, 9, 5),

    // --- lv25 elite boss: the southern marsh, genuinely alone ---------------
    // No guards and a wide empty approach: Old Scar is meant to be fought with
    // nothing else on the screen.
    { mobId: 'old_scar', pos: { x: 0, z: -118 } },
  ],
};

export interface ClassDef {
  id: ClassId;
  name: string;
  description: string;
  baseAttributes: Attributes;
  startingWeapon: string;
  /** Renderer hint. */
  color: number;
}

export const CLASSES: Record<ClassId, ClassDef> = {
  warrior: {
    id: 'warrior',
    name: 'Warrior',
    description: 'Holds the line. High health, steady melee damage, hard to kill.',
    baseAttributes: { strength: 8, dexterity: 4, focus: 2, vitality: 8 },
    startingWeapon: 'rusted_blade',
    color: 0xd9c27a,
  },
  ranger: {
    id: 'ranger',
    name: 'Ranger',
    description: 'Kills at range before it reaches you. Not yet implemented.',
    baseAttributes: { strength: 5, dexterity: 9, focus: 4, vitality: 5 },
    startingWeapon: 'rusted_blade',
    color: 0x7ab87a,
  },
  rogue: {
    id: 'rogue',
    name: 'Rogue',
    description: 'Bursts a target down fast. Not yet implemented.',
    baseAttributes: { strength: 6, dexterity: 10, focus: 3, vitality: 4 },
    startingWeapon: 'rusted_blade',
    color: 0x9a7ab8,
  },
  mage: {
    id: 'mage',
    name: 'Mage',
    description: 'Heavy elemental damage, fragile. Not yet implemented.',
    baseAttributes: { strength: 2, dexterity: 4, focus: 12, vitality: 4 },
    startingWeapon: 'rusted_blade',
    color: 0x7a9ad9,
  },
  druid: {
    id: 'druid',
    name: 'Druid',
    description: 'Sustains through damage with nature magic. Not yet implemented.',
    baseAttributes: { strength: 3, dexterity: 4, focus: 10, vitality: 6 },
    startingWeapon: 'rusted_blade',
    color: 0x9ad97a,
  },
};
