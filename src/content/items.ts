import type { Attributes, ClassId, DamageType, ItemDef, ItemQuality } from '../sim/types.js';

/**
 * Item registry. Data only — no behaviour. Adding gear should never require
 * touching sim code.
 *
 * Weapons are class-locked (`classes`); armour and rings are not, so the two
 * classes compete for the same defensive drops but each has its own weapon
 * ladder. The progression runs in roughly four-level steps so a player grinding
 * a band always has something to look forward to from the next one.
 */
export const ITEMS: Record<string, ItemDef> = {
  // === WARRIOR WEAPONS — Strength, fast, high sustained damage ==============
  rusted_blade: {
    id: 'rusted_blade',
    name: 'Rusted Blade',
    slot: 'weapon',
    quality: 'common',
    classes: ['warrior'],
    value: 4,
    damageMin: 3,
    damageMax: 6,
    damageType: 'physical',
    swingMs: 1800,
    attackRange: 2.4,
  },
  bronze_shortsword: {
    id: 'bronze_shortsword',
    name: 'Bronze Shortsword',
    slot: 'weapon',
    quality: 'common',
    classes: ['warrior'],
    value: 18,
    damageMin: 6,
    damageMax: 11,
    damageType: 'physical',
    swingMs: 1700,
    attackRange: 2.4,
    attributes: { strength: 2 },
  },
  ironbark_cudgel: {
    id: 'ironbark_cudgel',
    name: 'Ironbark Cudgel',
    slot: 'weapon',
    quality: 'uncommon',
    classes: ['warrior'],
    value: 55,
    damageMin: 11,
    damageMax: 19,
    damageType: 'physical',
    swingMs: 2100,
    attackRange: 2.6,
    attributes: { strength: 4, vitality: 2 },
  },
  iron_longsword: {
    id: 'iron_longsword',
    name: 'Iron Longsword',
    slot: 'weapon',
    quality: 'uncommon',
    classes: ['warrior'],
    value: 120,
    damageMin: 18,
    damageMax: 28,
    damageType: 'physical',
    swingMs: 1900,
    attackRange: 2.6,
    attributes: { strength: 7, vitality: 3 },
  },
  outlaw_saber: {
    id: 'outlaw_saber',
    name: 'Outlaw Saber',
    slot: 'weapon',
    quality: 'rare',
    classes: ['warrior'],
    value: 260,
    damageMin: 26,
    damageMax: 38,
    damageType: 'physical',
    swingMs: 1750,
    attackRange: 2.5,
    attributes: { strength: 10, dexterity: 6 },
  },
  boar_spear: {
    id: 'boar_spear',
    name: 'Boar Spear',
    slot: 'weapon',
    quality: 'rare',
    classes: ['warrior'],
    value: 380,
    damageMin: 35,
    damageMax: 50,
    damageType: 'physical',
    swingMs: 2000,
    attackRange: 3.1,
    attributes: { strength: 13, vitality: 5 },
  },
  cadfaels_cleaver: {
    id: 'cadfaels_cleaver',
    name: "Cadfael's Cleaver",
    slot: 'weapon',
    quality: 'epic',
    classes: ['warrior'],
    value: 900,
    damageMin: 44,
    damageMax: 62,
    damageType: 'physical',
    swingMs: 1900,
    attackRange: 2.7,
    attributes: { strength: 17, dexterity: 8, vitality: 7 },
  },
  scarred_fang: {
    id: 'scarred_fang',
    name: 'Scarred Fang',
    slot: 'weapon',
    quality: 'epic',
    classes: ['warrior'],
    value: 1800,
    damageMin: 56,
    damageMax: 78,
    damageType: 'physical',
    swingMs: 1850,
    attackRange: 2.7,
    attributes: { strength: 22, dexterity: 11, vitality: 10 },
  },

  // === PRIEST WEAPONS — Focus, slower, heavier per swing ====================
  oaken_walking_staff: {
    id: 'oaken_walking_staff',
    name: 'Oaken Walking Staff',
    slot: 'weapon',
    quality: 'common',
    classes: ['priest'],
    value: 4,
    damageMin: 3,
    damageMax: 5,
    damageType: 'nature',
    swingMs: 2200,
    attackRange: 2.6,
  },
  rowan_stave: {
    id: 'rowan_stave',
    name: 'Rowan Stave',
    slot: 'weapon',
    quality: 'common',
    classes: ['priest'],
    value: 18,
    damageMin: 8,
    damageMax: 13,
    damageType: 'nature',
    swingMs: 2000,
    attackRange: 2.6,
    attributes: { focus: 2 },
  },
  blessed_mace: {
    id: 'blessed_mace',
    name: 'Blessed Mace',
    slot: 'weapon',
    quality: 'uncommon',
    classes: ['priest'],
    value: 55,
    damageMin: 14,
    damageMax: 22,
    damageType: 'physical',
    swingMs: 2100,
    attackRange: 2.5,
    attributes: { focus: 4, vitality: 2 },
  },
  vigil_stave: {
    id: 'vigil_stave',
    name: 'Vigil Stave',
    slot: 'weapon',
    quality: 'uncommon',
    classes: ['priest'],
    value: 120,
    damageMin: 22,
    damageMax: 33,
    damageType: 'nature',
    swingMs: 2200,
    attackRange: 2.8,
    attributes: { focus: 7, vitality: 3 },
  },
  reliquary_mace: {
    id: 'reliquary_mace',
    name: 'Reliquary Mace',
    slot: 'weapon',
    quality: 'rare',
    classes: ['priest'],
    value: 260,
    damageMin: 31,
    damageMax: 45,
    damageType: 'physical',
    swingMs: 2050,
    attackRange: 2.6,
    attributes: { focus: 10, vitality: 5 },
  },
  prayerwood_stave: {
    id: 'prayerwood_stave',
    name: 'Prayerwood Stave',
    slot: 'weapon',
    quality: 'rare',
    classes: ['priest'],
    value: 380,
    damageMin: 42,
    damageMax: 59,
    damageType: 'nature',
    swingMs: 2200,
    attackRange: 2.9,
    attributes: { focus: 13, vitality: 6 },
  },
  chieftains_reliquary: {
    id: 'chieftains_reliquary',
    name: "Chieftain's Reliquary",
    slot: 'weapon',
    quality: 'epic',
    classes: ['priest'],
    value: 900,
    damageMin: 52,
    damageMax: 73,
    damageType: 'physical',
    swingMs: 2150,
    attackRange: 2.7,
    attributes: { focus: 17, vitality: 9, dexterity: 5 },
  },
  bonecarved_stave: {
    id: 'bonecarved_stave',
    name: 'Bonecarved Stave',
    slot: 'weapon',
    quality: 'epic',
    classes: ['priest'],
    value: 1800,
    damageMin: 66,
    damageMax: 92,
    damageType: 'nature',
    swingMs: 2100,
    attackRange: 2.9,
    attributes: { focus: 22, vitality: 12, dexterity: 7 },
  },

  // === ARMOUR — shared between classes ======================================
  tattered_hood: {
    id: 'tattered_hood',
    name: 'Tattered Hood',
    slot: 'head',
    quality: 'common',
    value: 5,
    armor: 3,
    attributes: { vitality: 1 },
  },
  leather_coif: {
    id: 'leather_coif',
    name: 'Leather Coif',
    slot: 'head',
    quality: 'common',
    value: 40,
    armor: 9,
    attributes: { vitality: 3 },
  },
  outlaw_hood: {
    id: 'outlaw_hood',
    name: 'Outlaw Hood',
    slot: 'head',
    quality: 'uncommon',
    value: 150,
    armor: 18,
    attributes: { vitality: 5, dexterity: 4 },
  },
  bearhide_helm: {
    id: 'bearhide_helm',
    name: 'Bearhide Helm',
    slot: 'head',
    quality: 'rare',
    value: 340,
    armor: 28,
    attributes: { vitality: 9, strength: 4, focus: 4 },
  },
  boiled_leather_vest: {
    id: 'boiled_leather_vest',
    name: 'Boiled Leather Vest',
    slot: 'chest',
    quality: 'common',
    value: 14,
    armor: 8,
    attributes: { vitality: 2 },
  },
  studded_jerkin: {
    id: 'studded_jerkin',
    name: 'Studded Jerkin',
    slot: 'chest',
    quality: 'uncommon',
    value: 90,
    armor: 20,
    attributes: { vitality: 5, strength: 2, focus: 2 },
  },
  outlaw_mail: {
    id: 'outlaw_mail',
    name: 'Outlaw Mail',
    slot: 'chest',
    quality: 'rare',
    value: 300,
    armor: 36,
    attributes: { vitality: 9, strength: 5, focus: 5 },
  },
  bearhide_cuirass: {
    id: 'bearhide_cuirass',
    name: 'Bearhide Cuirass',
    slot: 'chest',
    quality: 'epic',
    value: 750,
    armor: 52,
    attributes: { vitality: 14, strength: 7, focus: 7 },
  },
  bogstrider_greaves: {
    id: 'bogstrider_greaves',
    name: 'Bogstrider Greaves',
    slot: 'legs',
    quality: 'uncommon',
    value: 60,
    armor: 14,
    attributes: { vitality: 3, dexterity: 3 },
  },
  reaver_legguards: {
    id: 'reaver_legguards',
    name: 'Reaver Legguards',
    slot: 'legs',
    quality: 'uncommon',
    value: 190,
    armor: 26,
    attributes: { vitality: 6, dexterity: 4 },
  },
  fenhide_leggings: {
    id: 'fenhide_leggings',
    name: 'Fenhide Leggings',
    slot: 'legs',
    quality: 'rare',
    value: 480,
    armor: 40,
    attributes: { vitality: 10, dexterity: 6 },
  },
  ring_of_the_fen: {
    id: 'ring_of_the_fen',
    name: 'Ring of the Fen',
    slot: 'ring',
    quality: 'rare',
    value: 150,
    armor: 2,
    attributes: { focus: 5, dexterity: 3 },
  },
  outlaws_signet: {
    id: 'outlaws_signet',
    name: "Outlaw's Signet",
    slot: 'ring',
    quality: 'rare',
    value: 420,
    armor: 4,
    attributes: { strength: 6, focus: 6, dexterity: 5 },
  },
  scarred_band: {
    id: 'scarred_band',
    name: 'Scarred Band',
    slot: 'ring',
    quality: 'epic',
    value: 1100,
    armor: 6,
    attributes: { strength: 9, focus: 9, vitality: 8, dexterity: 5 },
  },

  // === MERCHANT GOODS ======================================================
  // Pure vendor value. These scale steeply with the difficulty of what drops
  // them, which is what makes grinding a harder camp pay off reliably even
  // when no equipment drops.
  hare_pelt: { id: 'hare_pelt', name: 'Hare Pelt', slot: null, quality: 'common', value: 2, stackable: true, merchantGood: true },
  boar_tusk: { id: 'boar_tusk', name: 'Boar Tusk', slot: null, quality: 'common', value: 5, stackable: true, merchantGood: true },
  adder_skin: { id: 'adder_skin', name: 'Adder Skin', slot: null, quality: 'common', value: 12, stackable: true, merchantGood: true },
  wolf_pelt: { id: 'wolf_pelt', name: 'Wolf Pelt', slot: null, quality: 'common', value: 24, stackable: true, merchantGood: true },
  stag_antler: { id: 'stag_antler', name: 'Stag Antler', slot: null, quality: 'uncommon', value: 45, stackable: true, merchantGood: true },
  outlaw_purse: { id: 'outlaw_purse', name: "Outlaw's Purse", slot: null, quality: 'uncommon', value: 80, stackable: true, merchantGood: true },
  bear_claw: { id: 'bear_claw', name: 'Bear Claw', slot: null, quality: 'uncommon', value: 140, stackable: true, merchantGood: true },
  lynx_fang: { id: 'lynx_fang', name: 'Lynx Fang', slot: null, quality: 'uncommon', value: 210, stackable: true, merchantGood: true },
  smugglers_ledger: { id: 'smugglers_ledger', name: "Smuggler's Ledger", slot: null, quality: 'rare', value: 420, stackable: true, merchantGood: true },
  chieftains_seal: { id: 'chieftains_seal', name: "Chieftain's Seal", slot: null, quality: 'rare', value: 900, stackable: true, merchantGood: true },
  ancient_bear_skull: { id: 'ancient_bear_skull', name: 'Ancient Bear Skull', slot: null, quality: 'epic', value: 2200, stackable: true, merchantGood: true },
};


// === GENERATED WEAPON LADDERS ============================================
//
// Warrior and Priest ladders above are hand-written and are the reference.
// The remaining three classes are generated against the same per-tier DPS
// budget so no class can silently end up ahead of the others: only the
// *feel* differs (a Rogue swings fast for little, a Ranger slowly from
// range), never the throughput. A test asserts the parity holds.

/** Per-tier DPS budget, read off the hand-tuned Warrior and Priest ladders. */
const WEAPON_TIERS: Array<{
  dps: number;
  quality: ItemQuality;
  value: number;
}> = [
  { dps: 2.2, quality: 'common', value: 4 },
  { dps: 5.1, quality: 'common', value: 18 },
  { dps: 7.9, quality: 'uncommon', value: 55 },
  { dps: 12.3, quality: 'uncommon', value: 120 },
  { dps: 18.4, quality: 'rare', value: 260 },
  { dps: 22.1, quality: 'rare', value: 380 },
  { dps: 28.5, quality: 'epic', value: 900 },
  { dps: 36.9, quality: 'epic', value: 1800 },
];

interface WeaponArchetype {
  classId: ClassId;
  /** Attribute the class scales off; weapons grant it. */
  primary: keyof Attributes;
  swingMs: number;
  attackRange: number;
  damageType: DamageType;
  /** Ids and display names, tier 1 to tier 8. */
  entries: Array<[id: string, name: string]>;
}

const ARCHETYPES: WeaponArchetype[] = [
  {
    classId: 'ranger',
    primary: 'dexterity',
    swingMs: 2400,
    attackRange: 12,
    damageType: 'physical',
    entries: [
      ['frayed_shortbow', 'Frayed Shortbow'],
      ['hunters_bow', "Hunter's Bow"],
      ['yew_longbow', 'Yew Longbow'],
      ['rangers_recurve', "Ranger's Recurve"],
      ['outlaw_crossbow', 'Outlaw Crossbow'],
      ['fenstalker_bow', 'Fenstalker Bow'],
      ['cadfaels_hunting_bow', "Cadfael's Hunting Bow"],
      ['scarred_longbow', 'Scarred Longbow'],
    ],
  },
  {
    classId: 'rogue',
    primary: 'dexterity',
    swingMs: 1400,
    attackRange: 2.3,
    damageType: 'physical',
    entries: [
      ['chipped_dirk', 'Chipped Dirk'],
      ['bronze_dagger', 'Bronze Dagger'],
      ['poachers_knife', "Poacher's Knife"],
      ['twin_fangs', 'Twin Fangs'],
      ['outlaw_stiletto', 'Outlaw Stiletto'],
      ['fenblade', 'Fenblade'],
      ['cadfaels_skinning_knife', "Cadfael's Skinning Knife"],
      ['scarred_kris', 'Scarred Kris'],
    ],
  },
  {
    classId: 'mage',
    primary: 'focus',
    swingMs: 2000,
    attackRange: 10,
    damageType: 'fire',
    entries: [
      ['cracked_wand', 'Cracked Wand'],
      ['rowan_wand', 'Rowan Wand'],
      ['emberwood_rod', 'Emberwood Rod'],
      ['stormcaller_rod', 'Stormcaller Rod'],
      ['outlaws_focus', "Outlaw's Focus"],
      ['fenlight_rod', 'Fenlight Rod'],
      ['cadfaels_talisman', "Cadfael's Talisman"],
      ['scarred_heartwood', 'Scarred Heartwood'],
    ],
  },
];

/** Attribute points a weapon of this tier grants, matching the hand-built ladders. */
const TIER_PRIMARY_BONUS = [0, 2, 4, 7, 10, 13, 17, 22];
const TIER_VITALITY_BONUS = [0, 0, 2, 3, 5, 6, 9, 12];

function buildWeaponLadders(): Record<string, ItemDef> {
  const out: Record<string, ItemDef> = {};
  for (const arch of ARCHETYPES) {
    arch.entries.forEach(([id, name], i) => {
      const tier = WEAPON_TIERS[i]!;
      // Convert the tier's DPS budget into a damage range for this swing speed.
      const avg = (tier.dps * arch.swingMs) / 1000;
      const attributes: Partial<Attributes> = {};
      if (TIER_PRIMARY_BONUS[i]!) attributes[arch.primary] = TIER_PRIMARY_BONUS[i]!;
      if (TIER_VITALITY_BONUS[i]!) attributes.vitality = TIER_VITALITY_BONUS[i]!;

      out[id] = {
        id,
        name,
        slot: 'weapon',
        quality: tier.quality,
        classes: [arch.classId],
        value: tier.value,
        damageMin: Math.round(avg * 0.78),
        damageMax: Math.round(avg * 1.22),
        damageType: arch.damageType,
        swingMs: arch.swingMs,
        attackRange: arch.attackRange,
        ...(Object.keys(attributes).length ? { attributes } : {}),
      };
    });
  }
  return out;
}

Object.assign(ITEMS, buildWeaponLadders());

export function getItem(id: string): ItemDef {
  const item = ITEMS[id];
  if (!item) throw new Error(`Unknown item: ${id}`);
  return item;
}

/** Whether `classId` is allowed to equip this item. */
export function canEquip(item: ItemDef, classId: string | undefined): boolean {
  if (!item.classes) return true;
  return classId !== undefined && item.classes.includes(classId as never);
}

export const QUALITY_COLORS: Record<ItemQuality, string> = {
  common: '#c8c8c8',
  uncommon: '#4ad66d',
  rare: '#4aa3ff',
  epic: '#c77dff',
};
