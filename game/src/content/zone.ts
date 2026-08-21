import type { Attributes, ClassId, Vec2 } from '../sim/types.js';

/**
 * Zone definition: static spawn points laid out by hand. When this grows past a
 * couple of hundred entries it wants an editor rather than a literal, but the
 * shape stays the same — the sim only ever reads `spawns`.
 */
export interface SpawnPoint {
  mobId: string;
  pos: Vec2;
}

export interface ZoneDef {
  id: string;
  name: string;
  /** Half-extent of the playable square, in world units. */
  halfSize: number;
  playerStart: Vec2;
  spawns: SpawnPoint[];
}

/** Ring of spawns around a centre, so camps read as camps rather than a grid. */
function ring(mobId: string, cx: number, cz: number, radius: number, count: number): SpawnPoint[] {
  const out: SpawnPoint[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    out.push({ mobId, pos: { x: cx + Math.cos(a) * radius, z: cz + Math.sin(a) * radius } });
  }
  return out;
}

export const FENMARCH: ZoneDef = {
  id: 'fenmarch',
  name: 'The Fenmarch',
  halfSize: 70,
  playerStart: { x: 0, z: 30 },
  spawns: [
    // Starter boars near the spawn point — safe, low pressure.
    ...ring('mossback_boar', 0, 12, 9, 5),
    ...ring('mossback_boar', -22, 6, 7, 3),
    // Wolves in the middle band.
    ...ring('bog_wolf', 20, -6, 8, 4),
    ...ring('bog_wolf', -18, -14, 8, 4),
    // Kobold camp guarding the approach to the boss.
    ...ring('fen_kobold', 0, -34, 10, 5),
    // The boss, alone at the far end.
    { mobId: 'grualach', pos: { x: 0, z: -55 } },
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
