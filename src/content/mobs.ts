import { baseMobXp } from '../sim/formulas.js';
import type { LootTable, MobAbilityDef, MobDef, StarRating } from '../sim/types.js';

/**
 * The Fenmarch bestiary: levels 1–25, deliberately grounded. Wildlife and
 * outlaws, no mythical creatures — the danger comes from bears and bandits,
 * not monsters.
 *
 * Star rating (★1–★4 ordinary, ★5 boss, ★6 elite boss) scales health, damage
 * and defence via `STAR_MODIFIERS`, so a ★4 is a genuine threat without needing
 * a higher level than the band it sits in.
 */

export const LOOT_TABLES: Record<string, LootTable> = {
  hare: {
    id: 'hare',
    goldMin: 0,
    goldMax: 2,
    entries: [{ itemId: 'hare_pelt', chance: 0.6, min: 1, max: 1 }],
  },
  boar: {
    id: 'boar',
    goldMin: 1,
    goldMax: 4,
    entries: [
      { itemId: 'boar_tusk', chance: 0.55, min: 1, max: 2 },
      { itemId: 'rusted_blade', chance: 0.05, min: 1, max: 1 },
      { itemId: 'tattered_hood', chance: 0.07, min: 1, max: 1 },
    ],
  },
  adder: {
    id: 'adder',
    goldMin: 2,
    goldMax: 7,
    entries: [
      { itemId: 'adder_skin', chance: 0.55, min: 1, max: 2 },
      { itemId: 'bronze_shortsword', chance: 0.06, min: 1, max: 1 },
      { itemId: 'boiled_leather_vest', chance: 0.08, min: 1, max: 1 },
    ],
  },
  wolf: {
    id: 'wolf',
    goldMin: 5,
    goldMax: 14,
    entries: [
      { itemId: 'wolf_pelt', chance: 0.6, min: 1, max: 2 },
      { itemId: 'ironbark_cudgel', chance: 0.05, min: 1, max: 1 },
      { itemId: 'leather_coif', chance: 0.08, min: 1, max: 1 },
      { itemId: 'bogstrider_greaves', chance: 0.05, min: 1, max: 1 },
    ],
  },
  stag: {
    id: 'stag',
    goldMin: 12,
    goldMax: 28,
    entries: [
      { itemId: 'stag_antler', chance: 0.55, min: 1, max: 2 },
      { itemId: 'iron_longsword', chance: 0.05, min: 1, max: 1 },
      { itemId: 'studded_jerkin', chance: 0.07, min: 1, max: 1 },
    ],
  },
  outlaw_common: {
    id: 'outlaw_common',
    goldMin: 20,
    goldMax: 48,
    entries: [
      { itemId: 'outlaw_purse', chance: 0.45, min: 1, max: 1 },
      { itemId: 'iron_longsword', chance: 0.06, min: 1, max: 1 },
      { itemId: 'studded_jerkin', chance: 0.07, min: 1, max: 1 },
      { itemId: 'outlaw_hood', chance: 0.05, min: 1, max: 1 },
    ],
  },
  outlaw_reaver: {
    id: 'outlaw_reaver',
    goldMin: 35,
    goldMax: 80,
    entries: [
      { itemId: 'outlaw_purse', chance: 0.5, min: 1, max: 2 },
      { itemId: 'outlaw_saber', chance: 0.05, min: 1, max: 1 },
      { itemId: 'outlaw_hood', chance: 0.08, min: 1, max: 1 },
      { itemId: 'reaver_legguards', chance: 0.07, min: 1, max: 1 },
    ],
  },
  bear: {
    id: 'bear',
    goldMin: 55,
    goldMax: 120,
    entries: [
      { itemId: 'bear_claw', chance: 0.5, min: 1, max: 2 },
      { itemId: 'boar_spear', chance: 0.04, min: 1, max: 1 },
      { itemId: 'outlaw_mail', chance: 0.06, min: 1, max: 1 },
      { itemId: 'bearhide_helm', chance: 0.05, min: 1, max: 1 },
    ],
  },
  lynx: {
    id: 'lynx',
    goldMin: 70,
    goldMax: 150,
    entries: [
      { itemId: 'lynx_fang', chance: 0.5, min: 1, max: 2 },
      { itemId: 'reaver_legguards', chance: 0.07, min: 1, max: 1 },
      { itemId: 'fenhide_leggings', chance: 0.05, min: 1, max: 1 },
    ],
  },
  marauder: {
    id: 'marauder',
    goldMin: 90,
    goldMax: 190,
    entries: [
      { itemId: 'outlaw_purse', chance: 0.55, min: 2, max: 3 },
      { itemId: 'outlaw_saber', chance: 0.07, min: 1, max: 1 },
      { itemId: 'outlaw_mail', chance: 0.07, min: 1, max: 1 },
      { itemId: 'outlaws_signet', chance: 0.05, min: 1, max: 1 },
    ],
  },
  cadfael: {
    id: 'cadfael',
    goldMin: 600,
    goldMax: 1100,
    entries: [
      { itemId: 'cadfaels_cleaver', chance: 0.3, min: 1, max: 1 },
      { itemId: 'outlaws_signet', chance: 0.45, min: 1, max: 1 },
      { itemId: 'outlaw_mail', chance: 0.55, min: 1, max: 1 },
      { itemId: 'boar_spear', chance: 0.35, min: 1, max: 1 },
      { itemId: 'outlaw_purse', chance: 1, min: 4, max: 7 },
    ],
  },
  old_scar: {
    id: 'old_scar',
    goldMin: 1400,
    goldMax: 2600,
    entries: [
      { itemId: 'scarred_fang', chance: 0.28, min: 1, max: 1 },
      { itemId: 'scarred_band', chance: 0.4, min: 1, max: 1 },
      { itemId: 'bearhide_cuirass', chance: 0.5, min: 1, max: 1 },
      { itemId: 'fenhide_leggings', chance: 0.5, min: 1, max: 1 },
      { itemId: 'bearhide_helm', chance: 0.55, min: 1, max: 1 },
      { itemId: 'bear_claw', chance: 1, min: 4, max: 8 },
    ],
  },
};

// --------------------------------------------------------------------------
// Boss ability kits.
//
// Every boss gets at least one telegraphed, dodgeable ability. That is what
// gives the fight outcome variance: without it the result is decided by the
// stat spread before the first swing, and the "boss" is just a long normal mob.
// --------------------------------------------------------------------------

const CADFAEL_ABILITIES: MobAbilityDef[] = [
  {
    id: 'cleaving_blow',
    name: 'Cleaving Blow',
    kind: 'heavySlam',
    cooldownMs: 18000,
    castMs: 2000,
    radius: 6,
    damageMultiplier: 3.4,
    telegraphText: 'Cadfael raises his cleaver for a wide swing!',
  },
  {
    id: 'rally_outlaws',
    name: 'Rally the Band',
    kind: 'summon',
    cooldownMs: 38000,
    castMs: 1500,
    summonMobId: 'outlaw_bowman',
    summonCount: 2,
    telegraphText: 'Cadfael whistles for his men!',
  },
  {
    id: 'bind_wounds',
    name: 'Bind Wounds',
    kind: 'mend',
    cooldownMs: 30000,
    castMs: 2500,
    healFraction: 0.1,
    // No interrupt skill exists yet, so this is a soft DPS check rather than
    // something to react to. Revisit the wording if interrupts get added.
    telegraphText: 'Cadfael binds his wounds!',
  },
  {
    id: 'cornered',
    name: 'Cornered',
    kind: 'enrage',
    cooldownMs: 0,
    castMs: 0,
    healthThreshold: 0.25,
    enrageDamageMultiplier: 1.4,
    telegraphText: 'Cadfael fights like a cornered animal!',
  },
];

const OLD_SCAR_ABILITIES: MobAbilityDef[] = [
  {
    id: 'ground_shake',
    name: 'Ground Shake',
    kind: 'heavySlam',
    cooldownMs: 22000,
    castMs: 2200,
    radius: 7,
    damageMultiplier: 3.6,
    telegraphText: 'Old Scar rears up to slam the ground!',
  },
  {
    id: 'savage_maul',
    name: 'Savage Maul',
    kind: 'heavySlam',
    cooldownMs: 15000,
    castMs: 1300,
    radius: 4.5,
    damageMultiplier: 2.6,
    telegraphText: 'Old Scar lunges into a savage maul!',
  },
  {
    id: 'wounded_fury',
    name: 'Wounded Fury',
    kind: 'enrage',
    cooldownMs: 0,
    castMs: 0,
    healthThreshold: 0.35,
    enrageDamageMultiplier: 1.5,
    telegraphText: 'Old Scar roars, maddened by its wounds!',
  },
];

interface MobSpec extends Omit<MobDef, 'xp'> {
  xp?: number;
}

/** Fill in xp from level and stars so the two can never drift apart. */
function mob(spec: MobSpec): MobDef {
  return { ...spec, xp: spec.xp ?? baseMobXp(spec.level, spec.stars as StarRating) };
}

export const MOBS: Record<string, MobDef> = {
  moor_hare: mob({
    id: 'moor_hare',
    name: 'Moor Hare',
    level: 1,
    stars: 1,
    attributes: { strength: 2, dexterity: 5, focus: 1, vitality: 2 },
    baseHealth: 60,
    damageMin: 2,
    damageMax: 4,
    damageType: 'physical',
    swingMs: 1900,
    attackRange: 2.0,
    moveSpeed: 4.6,
    aggroRadius: 5,
    leashRadius: 18,
    lootTableId: 'hare',
    respawnMs: 18000,
    view: { color: 0xa08a6a, height: 0.7, radius: 0.36 },
  }),
  mossback_boar: mob({
    id: 'mossback_boar',
    name: 'Mossback Boar',
    level: 3,
    stars: 1,
    attributes: { strength: 5, dexterity: 3, focus: 1, vitality: 6 },
    baseHealth: 150,
    damageMin: 4,
    damageMax: 7,
    damageType: 'physical',
    swingMs: 2200,
    attackRange: 2.2,
    moveSpeed: 3.8,
    aggroRadius: 7,
    leashRadius: 22,
    lootTableId: 'boar',
    respawnMs: 20000,
    view: { color: 0x8a6b4f, height: 1.1, radius: 0.55 },
  }),
  fen_adder: mob({
    id: 'fen_adder',
    name: 'Fen Adder',
    level: 5,
    stars: 2,
    attributes: { strength: 6, dexterity: 9, focus: 2, vitality: 5 },
    baseHealth: 120,
    damageMin: 8,
    damageMax: 13,
    damageType: 'nature',
    swingMs: 1500,
    attackRange: 2.1,
    moveSpeed: 4.2,
    aggroRadius: 8,
    leashRadius: 22,
    lootTableId: 'adder',
    respawnMs: 22000,
    view: { color: 0x5c7a3f, height: 0.55, radius: 0.42 },
  }),
  bog_wolf: mob({
    id: 'bog_wolf',
    name: 'Bog Wolf',
    level: 8,
    stars: 2,
    attributes: { strength: 11, dexterity: 9, focus: 2, vitality: 9 },
    baseHealth: 185,
    damageMin: 13,
    damageMax: 20,
    damageType: 'physical',
    swingMs: 1600,
    attackRange: 2.2,
    moveSpeed: 5.0,
    aggroRadius: 10,
    leashRadius: 28,
    lootTableId: 'wolf',
    respawnMs: 24000,
    view: { color: 0x5a5f68, height: 1.2, radius: 0.5 },
  }),
  moor_stag: mob({
    id: 'moor_stag',
    name: 'Moor Stag',
    level: 11,
    stars: 3,
    attributes: { strength: 15, dexterity: 8, focus: 3, vitality: 13 },
    baseHealth: 215,
    damageMin: 21,
    damageMax: 32,
    damageType: 'physical',
    swingMs: 2000,
    attackRange: 2.6,
    moveSpeed: 5.2,
    aggroRadius: 9,
    leashRadius: 30,
    lootTableId: 'stag',
    respawnMs: 28000,
    view: { color: 0x7a5b3a, height: 1.9, radius: 0.55 },
  }),
  outlaw_bowman: mob({
    id: 'outlaw_bowman',
    name: 'Outlaw Bowman',
    level: 13,
    stars: 2,
    attributes: { strength: 13, dexterity: 16, focus: 6, vitality: 11 },
    baseHealth: 260,
    damageMin: 25,
    damageMax: 37,
    damageType: 'physical',
    // Longer reach stands in for a bow until ranged attacks exist properly.
    swingMs: 2100,
    attackRange: 8.0,
    moveSpeed: 4.4,
    aggroRadius: 12,
    leashRadius: 30,
    lootTableId: 'outlaw_common',
    respawnMs: 26000,
    view: { color: 0x6b6152, height: 1.75, radius: 0.44 },
  }),
  outlaw_reaver: mob({
    id: 'outlaw_reaver',
    name: 'Outlaw Reaver',
    level: 16,
    stars: 3,
    attributes: { strength: 20, dexterity: 13, focus: 6, vitality: 17 },
    baseHealth: 300,
    damageMin: 34,
    damageMax: 50,
    damageType: 'physical',
    swingMs: 1800,
    attackRange: 2.5,
    moveSpeed: 4.6,
    aggroRadius: 12,
    leashRadius: 32,
    lootTableId: 'outlaw_reaver',
    respawnMs: 30000,
    view: { color: 0x7d5b45, height: 1.85, radius: 0.48 },
  }),
  marsh_bear: mob({
    id: 'marsh_bear',
    name: 'Marsh Bear',
    level: 19,
    stars: 4,
    attributes: { strength: 26, dexterity: 10, focus: 4, vitality: 24 },
    baseHealth: 300,
    damageMin: 46,
    damageMax: 68,
    damageType: 'physical',
    swingMs: 2100,
    attackRange: 2.8,
    moveSpeed: 4.5,
    aggroRadius: 12,
    leashRadius: 34,
    lootTableId: 'bear',
    respawnMs: 38000,
    view: { color: 0x4a3728, height: 2.2, radius: 0.8 },
  }),
  cadfael: mob({
    id: 'cadfael',
    name: 'Cadfael, the Outlaw Chief',
    level: 20,
    stars: 5,
    attributes: { strength: 32, dexterity: 18, focus: 12, vitality: 30 },
    baseHealth: 275,
    damageMin: 35,
    damageMax: 49,
    damageType: 'physical',
    swingMs: 1900,
    attackRange: 3.0,
    moveSpeed: 4.6,
    aggroRadius: 14,
    leashRadius: 45,
    lootTableId: 'cadfael',
    respawnMs: 240000,
    abilities: CADFAEL_ABILITIES,
    view: { color: 0x8c4a3a, height: 2.1, radius: 0.6 },
  }),
  fen_lynx: mob({
    id: 'fen_lynx',
    name: 'Fen Lynx',
    level: 21,
    stars: 3,
    attributes: { strength: 26, dexterity: 22, focus: 5, vitality: 20 },
    baseHealth: 360,
    damageMin: 54,
    damageMax: 78,
    damageType: 'physical',
    swingMs: 1500,
    attackRange: 2.3,
    moveSpeed: 5.6,
    aggroRadius: 12,
    leashRadius: 32,
    lootTableId: 'lynx',
    respawnMs: 32000,
    view: { color: 0x9a8258, height: 1.15, radius: 0.5 },
  }),
  outlaw_marauder: mob({
    id: 'outlaw_marauder',
    name: 'Outlaw Marauder',
    level: 23,
    stars: 4,
    attributes: { strength: 31, dexterity: 18, focus: 8, vitality: 28 },
    baseHealth: 360,
    damageMin: 64,
    damageMax: 92,
    damageType: 'physical',
    swingMs: 1850,
    attackRange: 2.6,
    moveSpeed: 4.7,
    aggroRadius: 13,
    leashRadius: 34,
    lootTableId: 'marauder',
    respawnMs: 40000,
    view: { color: 0x6e4436, height: 1.95, radius: 0.52 },
  }),
  old_scar: mob({
    id: 'old_scar',
    name: 'Old Scar',
    level: 25,
    stars: 6,
    attributes: { strength: 40, dexterity: 16, focus: 8, vitality: 40 },
    baseHealth: 170,
    damageMin: 36,
    damageMax: 50,
    damageType: 'physical',
    swingMs: 2050,
    attackRange: 3.4,
    moveSpeed: 4.8,
    aggroRadius: 16,
    leashRadius: 50,
    lootTableId: 'old_scar',
    respawnMs: 420000,
    abilities: OLD_SCAR_ABILITIES,
    view: { color: 0x33251a, height: 3.2, radius: 1.15 },
  }),
};

export function getMob(id: string): MobDef {
  const mobDef = MOBS[id];
  if (!mobDef) throw new Error(`Unknown mob: ${id}`);
  return mobDef;
}

export function getLootTable(id: string): LootTable {
  const table = LOOT_TABLES[id];
  if (!table) throw new Error(`Unknown loot table: ${id}`);
  return table;
}
