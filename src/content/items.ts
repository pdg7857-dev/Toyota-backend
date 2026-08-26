import { ARMOR_SLOT_SHARE, curveArmorTotal, curveWeaponDps } from './curves.js';
import { expectedPrimary } from '../sim/formulas.js';
import { buildDragonItems } from './dragons.js';
import { buildLuxuryGoods } from './luxury.js';
import { buildConsumables } from './consumables.js';
import { buildQuestGear } from './questgear.js';
import { buildSignatureItems } from './rares.js';
import { CLASS_ATTRIBUTES, skillsTaughtBy, tomeNoun } from './skills.js';
import { TIERS, splitTier, tieredId, type ItemTier } from './tiers.js';
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
  // --- Ardmoor, the Sunken Wood and Caer Dubh ---
  goat_horn: { id: 'goat_horn', name: 'Crag Goat Horn', slot: null, quality: 'common', value: 207, stackable: true, merchantGood: true },
  clan_torc: { id: 'clan_torc', name: 'Clan Torc', slot: null, quality: 'uncommon', value: 345, stackable: true, merchantGood: true },
  eagle_feather: { id: 'eagle_feather', name: 'Moor Eagle Feather', slot: null, quality: 'uncommon', value: 517, stackable: true, merchantGood: true },
  cattle_lords_ring: { id: 'cattle_lords_ring', name: 'Cattle-Lord\'s Ring', slot: null, quality: 'rare', value: 722, stackable: true, merchantGood: true },
  eel_skin: { id: 'eel_skin', name: 'Blackwater Eel Skin', slot: null, quality: 'uncommon', value: 961, stackable: true, merchantGood: true },
  wreckers_salvage: { id: 'wreckers_salvage', name: 'Wrecker\'s Salvage', slot: null, quality: 'uncommon', value: 1332, stackable: true, merchantGood: true },
  pike_jaw: { id: 'pike_jaw', name: 'Great Pike Jaw', slot: null, quality: 'rare', value: 1760, stackable: true, merchantGood: true },
  tidewatch_seal: { id: 'tidewatch_seal', name: 'Tidewatch Seal', slot: null, quality: 'rare', value: 2247, stackable: true, merchantGood: true },
  mastiff_fang: { id: 'mastiff_fang', name: 'Fort Mastiff Fang', slot: null, quality: 'uncommon', value: 2649, stackable: true, merchantGood: true },
  blackshield_boss: { id: 'blackshield_boss', name: 'Blackshield Boss', slot: null, quality: 'rare', value: 3237, stackable: true, merchantGood: true },
  warden_signet: { id: 'warden_signet', name: 'Warden\'s Signet', slot: null, quality: 'rare', value: 4051, stackable: true, merchantGood: true },
  caer_dubh_crown: { id: 'caer_dubh_crown', name: 'Crown of Caer Dubh', slot: null, quality: 'epic', value: 4766, stackable: true, merchantGood: true },
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


// === LATE-GAME LADDERS (levels 26-100) ===================================
//
// Zones 2-4 span 75 levels. Hand-writing five weapon ladders and four armour
// slots across that range would be hundreds of literals, every one a chance to
// mistype a number that a player only notices as "this zone feels wrong".
//
// So the late tiers are generated from curves fitted to the hand-tuned 1-25
// gear, which stays the reference. Twelve tiers, grouped four to a zone, so
// each zone has its own uncommon -> rare -> epic arc rather than one flat climb.

/** Level each late tier is built for. Four per zone: Ardmoor, the Sunken Wood, Caer Dubh. */
const LATE_TIER_LEVELS = [28, 32, 36, 40, 48, 56, 63, 70, 78, 86, 93, 100];

/** Escalating names, one per late tier. */
const LATE_TIER_ADJECTIVES = [
  'Honed', 'Bloodiron', 'Stormforged', 'Gravebound',
  'Sunken', 'Tidewrought', 'Duskforged', 'Wraithbound',
  'Blackstone', 'Dread', 'Sovereign', 'Godsbane',
];

/** Weapon noun per class, changing every four tiers so a zone feels distinct. */
const LATE_WEAPON_NOUNS: Record<ClassId, [string, string, string]> = {
  warrior: ['Blade', 'Warblade', 'Greatsword'],
  priest: ['Stave', 'Crozier', 'Reliquary'],
  ranger: ['Bow', 'Longbow', 'Warbow'],
  rogue: ['Dagger', 'Kris', 'Fang'],
  mage: ['Rod', 'Scepter', 'Focus'],
};

const LATE_ARMOR_NOUNS: Record<'head' | 'chest' | 'legs' | 'ring', [string, string, string]> = {
  head: ['Helm', 'Greathelm', 'Crown'],
  chest: ['Hauberk', 'Cuirass', 'Aegis'],
  legs: ['Greaves', 'Legguards', 'Warplate'],
  ring: ['Band', 'Signet', 'Seal'],
};

/** Within a zone's four tiers: uncommon, uncommon, rare, epic. */
function lateTierQuality(indexInZone: number): ItemQuality {
  return (['uncommon', 'uncommon', 'rare', 'epic'] as const)[indexInZone]!;
}

function lateTierValue(level: number, quality: ItemQuality): number {
  const qualityMultiplier = { common: 1, uncommon: 1.4, rare: 2.4, epic: 4.2 }[quality];
  return Math.round(Math.pow(level, 1.9) * 0.9 * qualityMultiplier);
}

/**
 * Weapon feel per class for the late tiers.
 *
 * Separate from ARCHETYPES because that table only covers the three classes
 * whose EARLY ladders are generated — Warrior and Priest are hand-written down
 * there and would otherwise silently have no gear past level 25.
 */
const LATE_WEAPON_FEEL: Record<
  ClassId,
  { primary: keyof Attributes; swingMs: number; attackRange: number; damageType: DamageType }
> = {
  warrior: { primary: 'strength', swingMs: 1850, attackRange: 2.7, damageType: 'physical' },
  priest: { primary: 'focus', swingMs: 2100, attackRange: 2.9, damageType: 'nature' },
  ranger: { primary: 'dexterity', swingMs: 2400, attackRange: 12, damageType: 'physical' },
  rogue: { primary: 'dexterity', swingMs: 1400, attackRange: 2.3, damageType: 'physical' },
  mage: { primary: 'focus', swingMs: 2000, attackRange: 10, damageType: 'fire' },
};

function buildLateLadders(): Record<string, ItemDef> {
  const out: Record<string, ItemDef> = {};

  LATE_TIER_LEVELS.forEach((level, i) => {
    const adjective = LATE_TIER_ADJECTIVES[i]!;
    const slug = adjective.toLowerCase();
    const zoneIndex = Math.floor(i / 4);
    const quality = lateTierQuality(i % 4);
    const value = lateTierValue(level, quality);
    // Attribute budget grows with the tier, split primary-heavy.
    const primaryBonus = Math.round(level * 0.9);
    const vitalityBonus = Math.round(level * 0.5);

    // --- weapons, one per class ---
    for (const classId of Object.keys(LATE_WEAPON_FEEL) as ClassId[]) {
      const feel = LATE_WEAPON_FEEL[classId];
      const noun = LATE_WEAPON_NOUNS[classId][zoneIndex]!;
      const avg = (curveWeaponDps(level) * feel.swingMs) / 1000;
      out[`${slug}_${classId}_weapon`] = {
        id: `${slug}_${classId}_weapon`,
        name: `${adjective} ${noun}`,
        slot: 'weapon',
        quality,
        classes: [classId],
        value,
        damageMin: Math.round(avg * 0.78),
        damageMax: Math.round(avg * 1.22),
        damageType: feel.damageType,
        swingMs: feel.swingMs,
        attackRange: feel.attackRange,
        attributes: { [feel.primary]: primaryBonus, vitality: vitalityBonus },
      };
    }

    // --- armour, one per slot, usable by any class ---
    for (const slot of ['head', 'chest', 'legs', 'ring'] as const) {
      const noun = LATE_ARMOR_NOUNS[slot][zoneIndex]!;
      out[`${slug}_${slot}`] = {
        id: `${slug}_${slot}`,
        name: `${adjective} ${noun}`,
        slot,
        quality,
        value: Math.round(value * 0.8),
        armor: Math.max(1, Math.round(curveArmorTotal(level) * ARMOR_SLOT_SHARE[slot])),
        attributes: {
          vitality: Math.round(level * 0.4),
          strength: Math.round(level * 0.18),
          focus: Math.round(level * 0.18),
          dexterity: Math.round(level * 0.18),
        },
      };
    }
  });

  return out;
}

Object.assign(ITEMS, buildLateLadders());

/** The late-tier item id for a class weapon at a given tier index (0-11). */
export function lateWeaponId(classId: ClassId, tierIndex: number): string {
  return `${LATE_TIER_ADJECTIVES[tierIndex]!.toLowerCase()}_${classId}_weapon`;
}

/** The late-tier armour id for a slot at a given tier index (0-11). */
export function lateArmorId(slot: 'head' | 'chest' | 'legs' | 'ring', tierIndex: number): string {
  return `${LATE_TIER_ADJECTIVES[tierIndex]!.toLowerCase()}_${slot}`;
}

/** Every late tier's level, for content that needs to pick one. */
export const LATE_TIERS = LATE_TIER_LEVELS;


// === CANONICAL LADDERS ===================================================
//
// The explicit progression order for every class and armour slot, early tiers
// then late. Content and tests read these rather than inferring order from
// price — vendor value is a flavour number and does not sort reliably once
// four zones' worth of gear share one registry.

/** Hand-written early weapons (tiers 1-8), in progression order. */
const EARLY_WEAPONS: Record<ClassId, string[]> = {
  warrior: [
    'rusted_blade', 'bronze_shortsword', 'ironbark_cudgel', 'iron_longsword',
    'outlaw_saber', 'boar_spear', 'cadfaels_cleaver', 'scarred_fang',
  ],
  priest: [
    'oaken_walking_staff', 'rowan_stave', 'blessed_mace', 'vigil_stave',
    'reliquary_mace', 'prayerwood_stave', 'chieftains_reliquary', 'bonecarved_stave',
  ],
  ranger: ARCHETYPES.find((a) => a.classId === 'ranger')!.entries.map(([id]) => id),
  rogue: ARCHETYPES.find((a) => a.classId === 'rogue')!.entries.map(([id]) => id),
  mage: ARCHETYPES.find((a) => a.classId === 'mage')!.entries.map(([id]) => id),
};

/** Full 20-tier weapon progression per class. */
export const WEAPON_LADDER: Record<ClassId, string[]> = {
  warrior: [...EARLY_WEAPONS.warrior, ...LATE_TIER_ADJECTIVES.map((a) => `${a.toLowerCase()}_warrior_weapon`)],
  priest: [...EARLY_WEAPONS.priest, ...LATE_TIER_ADJECTIVES.map((a) => `${a.toLowerCase()}_priest_weapon`)],
  ranger: [...EARLY_WEAPONS.ranger, ...LATE_TIER_ADJECTIVES.map((a) => `${a.toLowerCase()}_ranger_weapon`)],
  rogue: [...EARLY_WEAPONS.rogue, ...LATE_TIER_ADJECTIVES.map((a) => `${a.toLowerCase()}_rogue_weapon`)],
  mage: [...EARLY_WEAPONS.mage, ...LATE_TIER_ADJECTIVES.map((a) => `${a.toLowerCase()}_mage_weapon`)],
};

/** Full armour progression per slot. */
export const ARMOR_LADDER: Record<'head' | 'chest' | 'legs' | 'ring', string[]> = {
  head: ['tattered_hood', 'leather_coif', 'outlaw_hood', 'bearhide_helm',
    ...LATE_TIER_ADJECTIVES.map((a) => `${a.toLowerCase()}_head`)],
  chest: ['boiled_leather_vest', 'studded_jerkin', 'outlaw_mail', 'bearhide_cuirass',
    ...LATE_TIER_ADJECTIVES.map((a) => `${a.toLowerCase()}_chest`)],
  legs: ['bogstrider_greaves', 'reaver_legguards', 'fenhide_leggings',
    ...LATE_TIER_ADJECTIVES.map((a) => `${a.toLowerCase()}_legs`)],
  ring: ['ring_of_the_fen', 'outlaws_signet', 'scarred_band',
    ...LATE_TIER_ADJECTIVES.map((a) => `${a.toLowerCase()}_ring`)],
};

/**
 * What a piece asks of you, beyond a level.
 *
 * A weapon asks for the attribute its class fights with; armour asks for
 * Vitality. Both at **62% of what a committed build has** at that level, which
 * is the number that makes this a decision rather than a tax: committing to
 * one attribute clears it comfortably, splitting two clears it, and spreading
 * across three does not. A player who ignores the character sheet entirely
 * ends up unable to put their drops on, which is the game saying "spend your
 * points" in the only language it has.
 *
 * Set centrally rather than in each generator. There are four ladders and two
 * of them are generated from curves; a requirement typed into three of the
 * four is a fourth that quietly asks for nothing.
 */
export const WEAPON_REQUIREMENT_SHARE = 0.6;

/**
 * Armour asks for less, because nobody builds Vitality as a primary.
 *
 * A standard build carries about two thirds of `expectedPrimary` in Vitality,
 * so a share fitted to a weapon's would have every piece of plate in the game
 * sitting one bad level-up away from unwearable. What armour is asking is "do
 * you have some constitution", not "did you commit to this".
 */
export const ARMOUR_REQUIREMENT_SHARE = 0.4;

function requirementFor(
  level: number,
  attr: keyof Attributes,
  share: number,
): Partial<Attributes> {
  return { [attr]: Math.max(1, Math.round(expectedPrimary(level) * share)) };
}

/** The level each rung of a ladder is meant for. */
function ladderLevels(ladder: string[]): number[] {
  const earlyCount = ladder.length - LATE_TIER_LEVELS.length;
  // `i` rather than `i + 1`: a rung is for the level you can *first* plausibly
  // be carrying it, not the level you have outgrown it at. The strict version
  // put the tier-3 sword at 13 and made the hand-authored level-12 encounter
  // in the balance suite unwearable, which is the suite saying the mapping is
  // a band too mean rather than the encounter being wrong.
  return ladder.map((_, i) =>
    i < earlyCount
      ? Math.max(1, Math.round((i / earlyCount) * 25))
      : LATE_TIER_LEVELS[i - earlyCount]!,
  );
}

function assignRequirements(): void {
  for (const [classId, ladder] of Object.entries(WEAPON_LADDER) as [ClassId, string[]][]) {
    const levels = ladderLevels(ladder);
    ladder.forEach((id, i) => {
      const item = ITEMS[id];
      if (!item) return;
      const level = levels[i]!;
      // The first two rungs ask for nothing. A character who cannot equip the
      // weapon they were handed at creation, or the first one they find, has
      // been told to go and fix a build before they have played the game.
      if (i <= 1) return;
      item.reqLevel = level;
      item.reqAttributes = requirementFor(
        level,
        CLASS_ATTRIBUTES[classId].power,
        WEAPON_REQUIREMENT_SHARE,
      );
    });
  }
  for (const ladder of Object.values(ARMOR_LADDER)) {
    const levels = ladderLevels(ladder);
    ladder.forEach((id, i) => {
      const item = ITEMS[id];
      if (!item || i === 0) return;
      item.reqLevel = levels[i]!;
      item.reqAttributes = requirementFor(levels[i]!, 'vitality', ARMOUR_REQUIREMENT_SHARE);
    });
  }
}

/** A full gear set appropriate to `level`, for tests and vendor stocking. */
export function gearSetFor(classId: ClassId, level: number): string[] {
  const pick = (ladder: string[]): string => {
    // Walked back down to something the character can actually put on.
    //
    // The index maths below rounds to the *nearest* rung, which for levels 26
    // and 27 hands back the first late-ladder piece — and that one is meant
    // for 28. Harmless while gear asked for nothing; the moment it asked for a
    // level it meant the balance harness fought Old Scar naked and reported
    // the fight as unwinnable played well.
    const wearable = (id: string): string => {
      let at = ladder.indexOf(id);
      while (at > 0 && (ITEMS[ladder[at]!]?.reqLevel ?? 0) > level) at--;
      return ladder[at]!;
    };
    // Early tiers cover 1-25 in eight steps; late tiers are LATE_TIER_LEVELS.
    const earlyCount = ladder.length - LATE_TIER_LEVELS.length;
    if (level <= 25) {
      const i = Math.min(earlyCount - 1, Math.max(0, Math.floor((level / 25) * earlyCount) - 1));
      return wearable(ladder[Math.max(0, i)]!);
    }
    let lateIndex = 0;
    for (let i = 0; i < LATE_TIER_LEVELS.length; i++) {
      if (level >= LATE_TIER_LEVELS[i]!) lateIndex = i;
    }
    return wearable(ladder[earlyCount + lateIndex]!);
  };
  return [
    pick(WEAPON_LADDER[classId]),
    pick(ARMOR_LADDER.head),
    pick(ARMOR_LADDER.chest),
    pick(ARMOR_LADDER.legs),
    pick(ARMOR_LADDER.ring),
  ];
}

// === SKILL TOMES ==========================================================
//
// One item per taught skill, generated from the skill itself so a skill can
// never exist with no way to learn it (a test asserts exactly that).
//
// Price is what makes the uncommon tier a real decision rather than a
// formality: a zone's first skill costs roughly a band's worth of pocket
// change, which is finally something to spend gold ON at level 70. The rare
// and epic tomes are not stocked by anyone — they are killed for.

/** Value of a tome by quality, scaled by the level it unlocks at. */
function tomeValue(level: number, quality: ItemQuality): number {
  const qualityMultiplier = { common: 1, uncommon: 1.6, rare: 3, epic: 5 }[quality];
  return Math.round(Math.pow(level, 1.85) * 1.1 * qualityMultiplier);
}

/** Which tier a taught skill sits at within its zone, by unlock order. */
function buildTomes(): Record<string, ItemDef> {
  const out: Record<string, ItemDef> = {};
  const qualities: ItemQuality[] = ['uncommon', 'rare', 'epic'];

  for (const zoneId of TAUGHT_ZONE_IDS) {
    const taught = skillsTaughtBy(zoneId);
    for (const classId of PLAYABLE_CLASS_IDS) {
      const forClass = taught.filter((s) => s.classId === classId);
      forClass.forEach((skill, tier) => {
        const quality = qualities[tier] ?? 'epic';
        out[skill.taughtBy!] = {
          id: skill.taughtBy!,
          name: `${tomeNoun(classId)}: ${skill.name}`,
          slot: null,
          quality,
          classes: [classId],
          value: tomeValue(skill.reqLevel, quality),
          teaches: skill.id,
        };
      });
    }
  }
  return out;
}

/** Zones that teach skills. The Fenmarch grants its kit by level instead. */
const TAUGHT_ZONE_IDS = ['ardmoor', 'reach', 'caer_dubh'];

const PLAYABLE_CLASS_IDS: ClassId[] = ['warrior', 'priest', 'ranger', 'rogue', 'mage'];

Object.assign(ITEMS, buildTomes());

// Signature gear from rare spawns. Generated in `rares.ts` because the
// creature and its item are one piece of content — see the note there.
Object.assign(ITEMS, buildSignatureItems());

// Trophies, armour sets and capstone weapons from the zones' armour lines.
Object.assign(ITEMS, buildQuestGear());

// And the four things you cannot plan for.
Object.assign(ITEMS, buildDragonItems());

// The one thing you can only buy.
Object.assign(ITEMS, buildLuxuryGoods());
Object.assign(ITEMS, buildConsumables());

// Last, because it reads the ladders back: every rung has to exist before it
// can be told what it asks for.
assignRequirements();

/**
 * Whether a piece can carry a grade at all.
 *
 * Everything a camp or a boss can hand you does. What does not: the signature
 * pieces a named creature carries, a dragon's weapon, the luxury shop's
 * offhands, and the quest sets. Those are already *one specific thing* — a
 * Godly Mirefang Blade would turn "the only one of these in the game" into a
 * ladder, which is the opposite of what a signature piece is for.
 */
export function canBeGraded(item: ItemDef): boolean {
  if (!item.slot || item.slot === 'none') return false;
  if (item.merchantGood || item.consumable || item.teaches) return false;
  // Anything carrying an affix is a signature, a dragon's or a luxury piece.
  if (item.critBonus || item.healthBonus || item.moveSpeedBonus) return false;
  if (item.damageBonus || item.skillPower || item.regenBonus) return false;
  return true;
}

/**
 * One grade of one piece, built the first time anybody asks for it.
 *
 * Built on demand rather than generated up front because the alternative is
 * two thousand three hundred extra entries in a table that a dozen tests walk,
 * to cover the handful any one character will ever actually see. `getItem`
 * materialises whatever a save or a loot roll hands it, so a tiered id is
 * always resolvable and nothing has to be told about them in advance.
 */
function buildGraded(tier: ItemTier, base: ItemDef): ItemDef {
  const t = TIERS[tier];
  const scale = (n: number | undefined): number | undefined =>
    n === undefined ? undefined : Math.max(1, Math.round(n * t.power));
  const attrs = base.attributes
    ? Object.fromEntries(
        Object.entries(base.attributes).map(([k, v]) => [k, Math.round((v ?? 0) * t.power)]),
      )
    : undefined;
  return {
    ...base,
    id: tieredId(base.id, tier),
    name: `${t.prefix} ${base.name}`,
    quality: t.quality,
    // Worth what it does, so a Godly piece is a Godly price and the trader
    // maths that the whole economy rests on keeps holding.
    value: Math.max(1, Math.round(base.value * t.power * t.power)),
    damageMin: scale(base.damageMin),
    damageMax: scale(base.damageMax),
    armor: scale(base.armor),
    // A better grade asks more of you. The level is unchanged — a Godly piece
    // of a level-20 item is still a level-20 item — but a Godly one wants a
    // character actually built for it, which is what keeps the boss grades
    // from being a free upgrade you stumble into at twelve.
    ...(base.reqAttributes
      ? {
          reqAttributes: Object.fromEntries(
            Object.entries(base.reqAttributes).map(([k, v]) => [
              k,
              Math.max(1, Math.round((v ?? 0) * t.power)),
            ]),
          ) as ItemDef['reqAttributes'],
        }
      : {}),
    ...(attrs ? { attributes: attrs as ItemDef['attributes'] } : {}),
  };
}

export function getItem(id: string): ItemDef {
  const item = ITEMS[id];
  if (item) return item;
  const graded = splitTier(id);
  if (graded) {
    const base = ITEMS[graded.baseId];
    if (base) {
      const made = buildGraded(graded.tier, base);
      ITEMS[id] = made;
      return made;
    }
  }
  throw new Error(`Unknown item: ${id}`);
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

/**
 * The best thing of its family in somebody's bag, by what it is worth.
 *
 * "Best" is deliberately the item's own value rather than its healing or its
 * buff: value is the one number every consumable has, it already tracks tier,
 * and it means a belt never has to know what a new kind of draught does.
 *
 * Lives here rather than in the input handler because the sim will want it too
 * the day anything drinks on its own — and because a belt that picks a
 * different item from the one the tooltip describes is a belt nobody trusts.
 * On this side of the pair because `items.ts` already imports `consumables.ts`
 * and the reverse would be a cycle.
 */
export function bestDrink(
  entity: { level?: number; inventory?: Array<{ itemId: string; qty: number }> },
  family: 'potion' | 'elixir',
): string | null {
  let best: string | null = null;
  let worth = -1;
  for (const stack of entity.inventory ?? []) {
    if (stack.qty <= 0) continue;
    const item = ITEMS[stack.itemId];
    if (item?.consumable?.family !== family) continue;
    // Only what they can actually drink. Without this the belt offered a
    // level-66 salve to a level-24 character and the key refused it — and a
    // belt that shows you something and then will not use it is worse than an
    // empty one, because the empty one at least tells the truth.
    if ((item.reqLevel ?? 1) > (entity.level ?? 1)) continue;
    if (item.value > worth) {
      worth = item.value;
      best = item.id;
    }
  }
  return best;
}

