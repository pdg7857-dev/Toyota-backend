import type { LootTable, MobDef } from '../sim/types.js';

export const LOOT_TABLES: Record<string, LootTable> = {
  boar: {
    id: 'boar',
    goldMin: 1,
    goldMax: 4,
    entries: [
      { itemId: 'boar_tusk', chance: 0.55, min: 1, max: 2 },
      { itemId: 'rusted_blade', chance: 0.06, min: 1, max: 1 },
      { itemId: 'tattered_hood', chance: 0.08, min: 1, max: 1 },
    ],
  },
  wolf: {
    id: 'wolf',
    goldMin: 3,
    goldMax: 9,
    entries: [
      { itemId: 'wolf_pelt', chance: 0.6, min: 1, max: 2 },
      { itemId: 'bronze_shortsword', chance: 0.09, min: 1, max: 1 },
      { itemId: 'boiled_leather_vest', chance: 0.1, min: 1, max: 1 },
    ],
  },
  kobold: {
    id: 'kobold',
    goldMin: 8,
    goldMax: 20,
    entries: [
      { itemId: 'kobold_fetish', chance: 0.5, min: 1, max: 1 },
      { itemId: 'ironbark_cudgel', chance: 0.07, min: 1, max: 1 },
      { itemId: 'kobold_scale_mail', chance: 0.06, min: 1, max: 1 },
      { itemId: 'bogstrider_greaves', chance: 0.07, min: 1, max: 1 },
    ],
  },
  fenwarden: {
    id: 'fenwarden',
    goldMin: 120,
    goldMax: 260,
    entries: [
      { itemId: 'fenwardens_cleaver', chance: 0.35, min: 1, max: 1 },
      { itemId: 'ring_of_the_fen', chance: 0.45, min: 1, max: 1 },
      { itemId: 'kobold_scale_mail', chance: 0.6, min: 1, max: 1 },
      { itemId: 'kobold_fetish', chance: 1, min: 3, max: 5 },
    ],
  },
};

export const MOBS: Record<string, MobDef> = {
  mossback_boar: {
    id: 'mossback_boar',
    name: 'Mossback Boar',
    level: 2,
    rank: 'normal',
    attributes: { strength: 4, dexterity: 3, focus: 1, vitality: 5 },
    baseHealth: 110,
    damageMin: 3,
    damageMax: 6,
    damageType: 'physical',
    swingMs: 2200,
    attackRange: 2.2,
    moveSpeed: 3.6,
    aggroRadius: 7,
    leashRadius: 22,
    xp: 22,
    lootTableId: 'boar',
    respawnMs: 20000,
    view: { color: 0x8a6b4f, height: 1.1, radius: 0.55 },
  },
  bog_wolf: {
    id: 'bog_wolf',
    name: 'Bog Wolf',
    level: 5,
    rank: 'normal',
    attributes: { strength: 9, dexterity: 8, focus: 2, vitality: 7 },
    baseHealth: 245,
    damageMin: 8,
    damageMax: 14,
    damageType: 'physical',
    swingMs: 1600,
    attackRange: 2.2,
    moveSpeed: 5.0,
    aggroRadius: 10,
    leashRadius: 28,
    xp: 60,
    lootTableId: 'wolf',
    respawnMs: 25000,
    view: { color: 0x5a5f68, height: 1.2, radius: 0.5 },
  },
  fen_kobold: {
    id: 'fen_kobold',
    name: 'Fen Kobold',
    level: 8,
    rank: 'elite',
    attributes: { strength: 14, dexterity: 10, focus: 6, vitality: 12 },
    baseHealth: 460,
    damageMin: 13,
    damageMax: 22,
    damageType: 'physical',
    swingMs: 1800,
    attackRange: 2.4,
    moveSpeed: 4.4,
    aggroRadius: 11,
    leashRadius: 30,
    xp: 165,
    lootTableId: 'kobold',
    respawnMs: 40000,
    view: { color: 0x6b8f47, height: 1.7, radius: 0.5 },
  },
  grualach: {
    id: 'grualach',
    name: 'Grualach, the Fenwarden',
    level: 12,
    rank: 'boss',
    attributes: { strength: 26, dexterity: 14, focus: 12, vitality: 30 },
    baseHealth: 1400,
    damageMin: 34,
    damageMax: 52,
    damageType: 'physical',
    swingMs: 2000,
    attackRange: 3.0,
    moveSpeed: 4.2,
    aggroRadius: 14,
    leashRadius: 45,
    xp: 900,
    lootTableId: 'fenwarden',
    respawnMs: 120000,
    view: { color: 0x3f6d3a, height: 2.9, radius: 0.95 },
  },
};

export function getMob(id: string): MobDef {
  const mob = MOBS[id];
  if (!mob) throw new Error(`Unknown mob: ${id}`);
  return mob;
}

export function getLootTable(id: string): LootTable {
  const table = LOOT_TABLES[id];
  if (!table) throw new Error(`Unknown loot table: ${id}`);
  return table;
}
