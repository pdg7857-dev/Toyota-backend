import { STAR_MODIFIERS, baseMobXp, curveMobDamageRange, curveMobHealth } from '../sim/formulas.js';
import { zoneTomes } from './skills.js';
import {
  DRAGONS,
  dragonLootTableId,
  dragonMobId,
  dragonWeapons,
  type DragonDef,
} from './dragons.js';
import { MOUNTS, type MountDef } from './mounts.js';
import { TROPHY_DROP_CHANCE, trophiesByMob } from './questgear.js';
import {
  BOUNTIES,
  BOUNTY_MULTIPLIER,
  RARES,
  bountyLootTableId,
  bountyMobId,
  rareLevel,
  rareLootTableId,
  rareMobId,
  rareMobName,
  rareStars,
  signatureRelicId,
  signatureTomes,
  signatureWeapons,
  type BountySpec,
  type RareSpec,
} from './rares.js';
import { BOSS_STARS } from '../sim/types.js';
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

/**
 * How long an ordinary creature takes to come back: five minutes.
 *
 * Ten times what it was, and the reason it works is the map. A long timer on a
 * small map is a player standing in an empty clearing watching the ground —
 * which is queueing, not grinding. On a map with somewhere else to go it is the
 * rule that makes you go there: `balance.test.ts` measures what fraction of the
 * game is spent waiting on a timer and fails if this becomes that.
 */
export const RESPAWN_MS = 300000;

/** Bosses. Long enough that finding one up is luck as well as travel. */
export const BOSS_RESPAWN_MS = 15 * 60000;

/** Elite bosses, which are the reason to come back to a zone at all. */
export const ELITE_RESPAWN_MS = 25 * 60000;

// --------------------------------------------------------------------------
// Loot.
//
// The rule is "harder mobs drop BETTER things, not MORE things":
//
//  - Gold is derived from level and stars (`goldForKill`) and scales steeply.
//    It is the reliable reward, and it is why the grind still pays when no
//    equipment drops.
//  - Merchant goods drop often and climb sharply in value with difficulty.
//    Same purpose: dependable income that respects what you can kill.
//  - Equipment stays RARE at every tier. Total equipment chance per ordinary
//    mob is held under `MAX_EQUIPMENT_DROP_CHANCE`, enforced by a test. What
//    improves with difficulty is the QUALITY of the piece, not the odds.
//  - Bosses are exempt from that ceiling: they are on multi-minute respawns and
//    are the designed source of epics.
// --------------------------------------------------------------------------

export const LOOT_TABLES: Record<string, LootTable> = {
  hare: {
    id: 'hare',
    entries: [{ itemId: 'hare_pelt', chance: 0.6, min: 1, max: 1 }],
  },
  boar: {
    id: 'boar',
    entries: [
      { itemId: 'boar_tusk', chance: 0.55, min: 1, max: 2 },
      { itemId: 'rusted_blade', chance: 0.04, min: 1, max: 1 },
      { itemId: 'oaken_walking_staff', chance: 0.04, min: 1, max: 1 },
      { itemId: 'tattered_hood', chance: 0.06, min: 1, max: 1 },
    ],
  },
  adder: {
    id: 'adder',
    entries: [
      { itemId: 'adder_skin', chance: 0.55, min: 1, max: 2 },
      { itemId: 'bronze_shortsword', chance: 0.04, min: 1, max: 1 },
      { itemId: 'rowan_stave', chance: 0.04, min: 1, max: 1 },
      { itemId: 'boiled_leather_vest', chance: 0.07, min: 1, max: 1 },
    ],
  },
  wolf: {
    id: 'wolf',
    entries: [
      { itemId: 'wolf_pelt', chance: 0.6, min: 1, max: 2 },
      { itemId: 'ironbark_cudgel', chance: 0.04, min: 1, max: 1 },
      { itemId: 'blessed_mace', chance: 0.04, min: 1, max: 1 },
      { itemId: 'leather_coif', chance: 0.07, min: 1, max: 1 },
      { itemId: 'bogstrider_greaves', chance: 0.05, min: 1, max: 1 },
    ],
  },
  stag: {
    id: 'stag',
    entries: [
      { itemId: 'stag_antler', chance: 0.55, min: 1, max: 2 },
      { itemId: 'iron_longsword', chance: 0.04, min: 1, max: 1 },
      { itemId: 'vigil_stave', chance: 0.04, min: 1, max: 1 },
      { itemId: 'studded_jerkin', chance: 0.06, min: 1, max: 1 },
    ],
  },
  outlaw_common: {
    id: 'outlaw_common',
    // Outlaws carry coin — that is the point of robbing them. Kept modest:
    // a flavour bonus must never let an easier mob out-earn a harder one.
    goldMultiplier: 1.15,
    entries: [
      { itemId: 'outlaw_purse', chance: 0.5, min: 1, max: 1 },
      { itemId: 'iron_longsword', chance: 0.05, min: 1, max: 1 },
      { itemId: 'vigil_stave', chance: 0.05, min: 1, max: 1 },
      { itemId: 'studded_jerkin', chance: 0.06, min: 1, max: 1 },
      { itemId: 'outlaw_hood', chance: 0.04, min: 1, max: 1 },
    ],
  },
  outlaw_reaver: {
    id: 'outlaw_reaver',
    goldMultiplier: 1.15,
    entries: [
      { itemId: 'outlaw_purse', chance: 0.5, min: 1, max: 2 },
      { itemId: 'smugglers_ledger', chance: 0.08, min: 1, max: 1 },
      { itemId: 'outlaw_saber', chance: 0.04, min: 1, max: 1 },
      { itemId: 'reliquary_mace', chance: 0.04, min: 1, max: 1 },
      { itemId: 'outlaw_hood', chance: 0.06, min: 1, max: 1 },
      { itemId: 'reaver_legguards', chance: 0.06, min: 1, max: 1 },
    ],
  },
  bear: {
    id: 'bear',
    entries: [
      { itemId: 'bear_claw', chance: 0.5, min: 1, max: 2 },
      { itemId: 'smugglers_ledger', chance: 0.05, min: 1, max: 1 },
      { itemId: 'boar_spear', chance: 0.035, min: 1, max: 1 },
      { itemId: 'prayerwood_stave', chance: 0.035, min: 1, max: 1 },
      { itemId: 'outlaw_mail', chance: 0.05, min: 1, max: 1 },
      { itemId: 'bearhide_helm', chance: 0.05, min: 1, max: 1 },
    ],
  },
  lynx: {
    id: 'lynx',
    entries: [
      { itemId: 'lynx_fang', chance: 0.5, min: 1, max: 2 },
      { itemId: 'smugglers_ledger', chance: 0.07, min: 1, max: 1 },
      { itemId: 'reaver_legguards', chance: 0.06, min: 1, max: 1 },
      { itemId: 'fenhide_leggings', chance: 0.04, min: 1, max: 1 },
    ],
  },
  marauder: {
    id: 'marauder',
    goldMultiplier: 1.4,
    entries: [
      { itemId: 'outlaw_purse', chance: 0.55, min: 2, max: 3 },
      { itemId: 'smugglers_ledger', chance: 0.12, min: 1, max: 1 },
      { itemId: 'outlaw_saber', chance: 0.05, min: 1, max: 1 },
      { itemId: 'reliquary_mace', chance: 0.05, min: 1, max: 1 },
      { itemId: 'outlaw_mail', chance: 0.06, min: 1, max: 1 },
      { itemId: 'outlaws_signet', chance: 0.04, min: 1, max: 1 },
    ],
  },

  // --- Ardmoor, the Sunken Wood and Caer Dubh ---
  crag_goat_loot: generatedLoot('crag_goat_loot', 'goat_horn', ['honed_head', 'honed_chest', 'honed_legs', 'honed_ring']),
  hill_wolf_loot: generatedLoot('hill_wolf_loot', 'clan_torc', ['honed_head', 'honed_chest', 'honed_legs', 'honed_ring']),
  cattle_raider_loot: generatedLoot('cattle_raider_loot', 'clan_torc', ['bloodiron_head', 'bloodiron_chest', 'bloodiron_legs', 'bloodiron_ring']),
  moor_eagle_loot: generatedLoot('moor_eagle_loot', 'clan_torc', ['bloodiron_head', 'bloodiron_chest', 'bloodiron_legs', 'bloodiron_ring'], undefined, 'ardmoor'),
  clan_axeman_loot: generatedLoot('clan_axeman_loot', 'eagle_feather', ['stormforged_head', 'stormforged_chest', 'stormforged_legs', 'stormforged_ring'], undefined, 'ardmoor'),
  highland_bear_loot: generatedLoot('highland_bear_loot', 'eagle_feather', ['stormforged_head', 'stormforged_chest', 'stormforged_legs', 'stormforged_ring'], undefined, 'ardmoor'),
  clan_berserker_loot: generatedLoot('clan_berserker_loot', 'cattle_lords_ring', ['stormforged_head', 'stormforged_chest', 'stormforged_legs', 'stormforged_ring'], undefined, 'ardmoor'),
  reach_eel_loot: generatedLoot('reach_eel_loot', 'eel_skin', ['sunken_head', 'sunken_chest', 'sunken_legs', 'sunken_ring']),
  wrecker_scavenger_loot: generatedLoot('wrecker_scavenger_loot', 'eel_skin', ['sunken_head', 'sunken_chest', 'sunken_legs', 'sunken_ring']),
  marsh_heron_loot: generatedLoot('marsh_heron_loot', 'wreckers_salvage', ['tidewrought_head', 'tidewrought_chest', 'tidewrought_legs', 'tidewrought_ring'], undefined, 'reach'),
  smuggler_enforcer_loot: generatedLoot('smuggler_enforcer_loot', 'wreckers_salvage', ['tidewrought_head', 'tidewrought_chest', 'tidewrought_legs', 'tidewrought_ring'], undefined, 'reach'),
  tidewatch_marauder_loot: generatedLoot('tidewatch_marauder_loot', 'pike_jaw', ['duskforged_head', 'duskforged_chest', 'duskforged_legs', 'duskforged_ring'], undefined, 'reach'),
  great_pike_loot: generatedLoot('great_pike_loot', 'pike_jaw', ['duskforged_head', 'duskforged_chest', 'duskforged_legs', 'duskforged_ring'], undefined, 'reach'),
  grey_seal_bull_loot: generatedLoot('grey_seal_bull_loot', 'tidewatch_seal', ['duskforged_head', 'duskforged_chest', 'duskforged_legs', 'duskforged_ring'], undefined, 'reach'),
  fort_mastiff_loot: generatedLoot('fort_mastiff_loot', 'mastiff_fang', ['blackstone_head', 'blackstone_chest', 'blackstone_legs', 'blackstone_ring']),
  warband_levy_loot: generatedLoot('warband_levy_loot', 'mastiff_fang', ['blackstone_head', 'blackstone_chest', 'blackstone_legs', 'blackstone_ring']),
  blackshield_spearman_loot: generatedLoot('blackshield_spearman_loot', 'blackshield_boss', ['dread_head', 'dread_chest', 'dread_legs', 'dread_ring'], undefined, 'caer_dubh'),
  siege_engineer_loot: generatedLoot('siege_engineer_loot', 'blackshield_boss', ['dread_head', 'dread_chest', 'dread_legs', 'dread_ring'], undefined, 'caer_dubh'),
  warhound_alpha_loot: generatedLoot('warhound_alpha_loot', 'blackshield_boss', ['sovereign_head', 'sovereign_chest', 'sovereign_legs', 'sovereign_ring'], undefined, 'caer_dubh'),
  blackshield_champion_loot: generatedLoot('blackshield_champion_loot', 'warden_signet', ['sovereign_head', 'sovereign_chest', 'sovereign_legs', 'sovereign_ring'], undefined, 'caer_dubh'),
  fort_warden_loot: generatedLoot('fort_warden_loot', 'warden_signet', ['sovereign_head', 'sovereign_chest', 'sovereign_legs', 'sovereign_ring'], undefined, 'caer_dubh'),
  aonghus_loot: {
    id: 'aonghus_loot',
    goldMultiplier: 1.2,
    classTomes: zoneTomes('ardmoor', 'rare'),
    classWeapons: {
      warrior: 'stormforged_warrior_weapon',
      priest: 'stormforged_priest_weapon',
      ranger: 'stormforged_ranger_weapon',
      rogue: 'stormforged_rogue_weapon',
      mage: 'stormforged_mage_weapon',
    },
    entries: [
      { itemId: 'eagle_feather', chance: 1, min: 1, max: 2 },
      { itemId: 'stormforged_head', chance: 0.5, min: 1, max: 1 },
      { itemId: 'stormforged_chest', chance: 0.5, min: 1, max: 1 },
      { itemId: 'stormforged_legs', chance: 0.5, min: 1, max: 1 },
      { itemId: 'stormforged_ring', chance: 0.5, min: 1, max: 1 },
    ],
  },
  muireann_loot: {
    id: 'muireann_loot',
    goldMultiplier: 1.2,
    classTomes: zoneTomes('ardmoor', 'epic'),
    classWeapons: {
      warrior: 'gravebound_warrior_weapon',
      priest: 'gravebound_priest_weapon',
      ranger: 'gravebound_ranger_weapon',
      rogue: 'gravebound_rogue_weapon',
      mage: 'gravebound_mage_weapon',
    },
    entries: [
      { itemId: 'cattle_lords_ring', chance: 1, min: 1, max: 2 },
      { itemId: 'gravebound_head', chance: 0.5, min: 1, max: 1 },
      { itemId: 'gravebound_chest', chance: 0.5, min: 1, max: 1 },
      { itemId: 'gravebound_legs', chance: 0.5, min: 1, max: 1 },
      { itemId: 'gravebound_ring', chance: 0.5, min: 1, max: 1 },
    ],
  },
  fiachra_loot: {
    id: 'fiachra_loot',
    goldMultiplier: 1.2,
    classTomes: zoneTomes('reach', 'rare'),
    classWeapons: {
      warrior: 'tidewrought_warrior_weapon',
      priest: 'tidewrought_priest_weapon',
      ranger: 'tidewrought_ranger_weapon',
      rogue: 'tidewrought_rogue_weapon',
      mage: 'tidewrought_mage_weapon',
    },
    entries: [
      { itemId: 'wreckers_salvage', chance: 1, min: 1, max: 2 },
      { itemId: 'tidewrought_head', chance: 0.5, min: 1, max: 1 },
      { itemId: 'tidewrought_chest', chance: 0.5, min: 1, max: 1 },
      { itemId: 'tidewrought_legs', chance: 0.5, min: 1, max: 1 },
      { itemId: 'tidewrought_ring', chance: 0.5, min: 1, max: 1 },
    ],
  },
  old_cauldron_loot: {
    id: 'old_cauldron_loot',
    goldMultiplier: 1.2,
    classTomes: zoneTomes('reach', 'epic'),
    classWeapons: {
      warrior: 'wraithbound_warrior_weapon',
      priest: 'wraithbound_priest_weapon',
      ranger: 'wraithbound_ranger_weapon',
      rogue: 'wraithbound_rogue_weapon',
      mage: 'wraithbound_mage_weapon',
    },
    entries: [
      { itemId: 'tidewatch_seal', chance: 1, min: 1, max: 2 },
      { itemId: 'wraithbound_head', chance: 0.5, min: 1, max: 1 },
      { itemId: 'wraithbound_chest', chance: 0.5, min: 1, max: 1 },
      { itemId: 'wraithbound_legs', chance: 0.5, min: 1, max: 1 },
      { itemId: 'wraithbound_ring', chance: 0.5, min: 1, max: 1 },
    ],
  },
  ruadhan_loot: {
    id: 'ruadhan_loot',
    goldMultiplier: 1.2,
    classTomes: zoneTomes('caer_dubh', 'rare'),
    classWeapons: {
      warrior: 'dread_warrior_weapon',
      priest: 'dread_priest_weapon',
      ranger: 'dread_ranger_weapon',
      rogue: 'dread_rogue_weapon',
      mage: 'dread_mage_weapon',
    },
    entries: [
      { itemId: 'blackshield_boss', chance: 1, min: 1, max: 2 },
      { itemId: 'dread_head', chance: 0.5, min: 1, max: 1 },
      { itemId: 'dread_chest', chance: 0.5, min: 1, max: 1 },
      { itemId: 'dread_legs', chance: 0.5, min: 1, max: 1 },
      { itemId: 'dread_ring', chance: 0.5, min: 1, max: 1 },
    ],
  },
  donnchadh_loot: {
    id: 'donnchadh_loot',
    goldMultiplier: 1.2,
    classTomes: zoneTomes('caer_dubh', 'epic'),
    classWeapons: {
      warrior: 'godsbane_warrior_weapon',
      priest: 'godsbane_priest_weapon',
      ranger: 'godsbane_ranger_weapon',
      rogue: 'godsbane_rogue_weapon',
      mage: 'godsbane_mage_weapon',
    },
    entries: [
      { itemId: 'caer_dubh_crown', chance: 1, min: 1, max: 2 },
      { itemId: 'godsbane_head', chance: 0.5, min: 1, max: 1 },
      { itemId: 'godsbane_chest', chance: 0.5, min: 1, max: 1 },
      { itemId: 'godsbane_legs', chance: 0.5, min: 1, max: 1 },
      { itemId: 'godsbane_ring', chance: 0.5, min: 1, max: 1 },
    ],
  },

  // --- bosses: guaranteed class weapon, guaranteed high-value merchant good ---
  cadfael: {
    id: 'cadfael',
    goldMultiplier: 1.2,
    classWeapons: {
      warrior: 'cadfaels_cleaver',
      priest: 'chieftains_reliquary',
      ranger: 'cadfaels_hunting_bow',
      rogue: 'cadfaels_skinning_knife',
      mage: 'cadfaels_talisman',
    },
    entries: [
      { itemId: 'chieftains_seal', chance: 1, min: 1, max: 1 },
      { itemId: 'outlaws_signet', chance: 0.45, min: 1, max: 1 },
      { itemId: 'outlaw_mail', chance: 0.55, min: 1, max: 1 },
      { itemId: 'bearhide_helm', chance: 0.35, min: 1, max: 1 },
      { itemId: 'outlaw_purse', chance: 1, min: 4, max: 7 },
    ],
  },
  old_scar: {
    id: 'old_scar',
    classWeapons: {
      warrior: 'scarred_fang',
      priest: 'bonecarved_stave',
      ranger: 'scarred_longbow',
      rogue: 'scarred_kris',
      mage: 'scarred_heartwood',
    },
    entries: [
      { itemId: 'ancient_bear_skull', chance: 1, min: 1, max: 1 },
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
//
// Note the split in `interruptible`: the heavy AoEs are answered by MOVING and
// cannot be interrupted, while heals and summons are answered by INTERRUPTING.
// Two mechanics, two answers — if everything were interruptible the interrupt
// would just be a strictly better dodge.
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
    interruptible: false,
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
    interruptible: true,
    telegraphText: 'Cadfael whistles for his men — cut him off!',
  },
  {
    id: 'bind_wounds',
    name: 'Bind Wounds',
    kind: 'mend',
    cooldownMs: 30000,
    castMs: 2500,
    healFraction: 0.12,
    interruptible: true,
    telegraphText: 'Cadfael is binding his wounds — interrupt him!',
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
    interruptible: false,
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
    interruptible: false,
    telegraphText: 'Old Scar lunges into a savage maul!',
  },
  {
    id: 'lick_wounds',
    name: 'Lick Wounds',
    kind: 'mend',
    cooldownMs: 34000,
    castMs: 2800,
    healFraction: 0.1,
    interruptible: true,
    telegraphText: 'Old Scar is licking its wounds — interrupt it!',
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


// === ZONES 2-4: GENERATED BESTIARY (levels 20-100) ========================
//
// The Fenmarch above is hand-tuned and stays the reference. Everything from
// Ardmoor south is generated from the curves in `formulas.ts`, so forty more
// creatures across seventy-five levels cannot drift out of balance one typo at
// a time. A definition here says what a thing IS — name, level, stars, how it
// fights, what it drops — and the numbers follow from that.

type Archetype = 'beast' | 'brute' | 'skirmisher' | 'archer';

/** How an archetype fights. Flavour only; damage budget is identical. */
const ARCHETYPE_PROFILE: Record<
  Archetype,
  { swingMs: number; attackRange: number; moveSpeed: number; aggroRadius: number }
> = {
  beast: { swingMs: 1600, attackRange: 2.3, moveSpeed: 5.2, aggroRadius: 10 },
  brute: { swingMs: 2100, attackRange: 2.9, moveSpeed: 4.4, aggroRadius: 12 },
  skirmisher: { swingMs: 1750, attackRange: 2.5, moveSpeed: 4.8, aggroRadius: 12 },
  archer: { swingMs: 2100, attackRange: 8, moveSpeed: 4.4, aggroRadius: 13 },
};

interface GeneratedMobSpec {
  id: string;
  name: string;
  level: number;
  stars: StarRating;
  archetype: Archetype;
  lootTableId: string;
  view: { color: number; height: number; radius: number };
  abilities?: MobAbilityDef[];
  /** Bosses respawn slowly; ordinary mobs keep a camp populated. */
  respawnMs?: number;
}

/** Build a mob from its identity, taking every number from the shared curves. */
function generated(spec: GeneratedMobSpec): MobDef {
  const profile = ARCHETYPE_PROFILE[spec.archetype];
  const damage = curveMobDamageRange(spec.level);
  const boss = spec.stars >= 5;
  return {
    id: spec.id,
    name: spec.name,
    level: spec.level,
    stars: spec.stars,
    attributes: {
      strength: Math.round(spec.level * 1.1),
      dexterity: Math.round(spec.level * 0.7),
      focus: Math.round(spec.level * 0.4),
      vitality: Math.round(spec.level * 1.0),
    },
    // Bosses carry far less base health than their star multiplier implies —
    // ★5/★6 already multiply by 9x/15x, and stacking a full health curve on
    // top of that produced the 200-second slogs the Fenmarch tuning removed.
    baseHealth: boss ? Math.round(curveMobHealth(spec.level) * 0.42) : curveMobHealth(spec.level),
    // Bosses hit near their full curve value: they are meant to be survived
    // by playing well, and a discount here just made them long normal mobs.
    damageMin: boss ? Math.round(damage.min * 0.95) : damage.min,
    damageMax: boss ? Math.round(damage.max * 0.95) : damage.max,
    damageType: 'physical',
    swingMs: profile.swingMs,
    attackRange: boss ? profile.attackRange + 0.5 : profile.attackRange,
    moveSpeed: profile.moveSpeed,
    aggroRadius: boss ? profile.aggroRadius + 3 : profile.aggroRadius,
    leashRadius: boss ? 48 : 32,
    xp: baseMobXp(spec.level, spec.stars),
    lootTableId: spec.lootTableId,
    respawnMs: spec.respawnMs ?? (boss ? BOSS_RESPAWN_MS : RESPAWN_MS),
    ...(spec.abilities ? { abilities: spec.abilities } : {}),
    view: spec.view,
  };
}

/** A boss kit: one telegraphed AoE, one interruptible heal, one enrage. */
function bossKit(name: string, radius: number, slamText: string, healText: string): MobAbilityDef[] {
  return [
    {
      id: `${name}_slam`,
      name: 'Crushing Blow',
      kind: 'heavySlam',
      cooldownMs: 19000,
      castMs: 2100,
      radius,
      damageMultiplier: 3.4,
      interruptible: false,
      telegraphText: slamText,
    },
    {
      id: `${name}_mend`,
      name: 'Second Wind',
      kind: 'mend',
      cooldownMs: 32000,
      castMs: 2600,
      healFraction: 0.11,
      interruptible: true,
      telegraphText: healText,
    },
    {
      id: `${name}_enrage`,
      name: 'Last Stand',
      kind: 'enrage',
      cooldownMs: 0,
      castMs: 0,
      healthThreshold: 0.3,
      enrageDamageMultiplier: 1.45,
      telegraphText: `${slamText.split(' ')[0]} fights with everything left!`,
    },
  ];
}

/**
 * Loot for a generated mob: one merchant good, a couple of tier-appropriate
 * pieces at low odds, holding to the same "better, not more" rule as zone 1.
 */
function generatedLoot(
  id: string,
  merchantGoodId: string,
  gear: string[],
  goldMultiplier?: number,
  /**
   * Zone whose RARE skill tome this mob can drop, at long odds.
   *
   * Only ★3 and ★4 camps carry one. The zone's ★5 boss guarantees the same
   * tome, so this is the grinder's path to it rather than a second source of
   * something new — a skill gated behind exactly one kill is a skill a player
   * can get permanently stuck without.
   */
  tomeZoneId?: string,
): LootTable {
  return {
    id,
    ...(goldMultiplier ? { goldMultiplier } : {}),
    ...(tomeZoneId ? { classTomes: zoneTomes(tomeZoneId, 'rare'), classTomeChance: 0.02 } : {}),
    entries: [
      { itemId: merchantGoodId, chance: 0.55, min: 1, max: 2 },
      // Four pieces at 4.5% each keeps total gear chance at 18%, comfortably
      // inside the cap and in the same band as the hand-tuned zone-1 tables.
      ...gear.map((itemId) => ({ itemId, chance: 0.045, min: 1, max: 1 })),
    ],
  };
}

export const MOBS: Record<string, MobDef> = {
  moor_hare: mob({
    id: 'moor_hare',
    name: 'Moor Hare',
    level: 1,
    stars: 1,
    attributes: { strength: 2, dexterity: 5, focus: 1, vitality: 2 },
    baseHealth: 78,
    damageMin: 2,
    damageMax: 4,
    damageType: 'physical',
    swingMs: 1900,
    attackRange: 2.0,
    moveSpeed: 4.6,
    aggroRadius: 5,
    leashRadius: 18,
    lootTableId: 'hare',
    respawnMs: RESPAWN_MS,
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
    respawnMs: RESPAWN_MS,
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
    respawnMs: RESPAWN_MS,
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
    respawnMs: RESPAWN_MS,
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
    respawnMs: RESPAWN_MS,
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
    respawnMs: RESPAWN_MS,
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
    respawnMs: RESPAWN_MS,
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
    respawnMs: RESPAWN_MS,
    view: { color: 0x4a3728, height: 2.2, radius: 0.8 },
  }),
  cadfael: mob({
    id: 'cadfael',
    name: 'Cadfael, the Outlaw Chief',
    level: 20,
    stars: 5,
    attributes: { strength: 32, dexterity: 18, focus: 12, vitality: 30 },
    baseHealth: 275,
    damageMin: 47,
    damageMax: 66,
    damageType: 'physical',
    swingMs: 1900,
    attackRange: 3.0,
    moveSpeed: 4.6,
    aggroRadius: 14,
    leashRadius: 45,
    lootTableId: 'cadfael',
    respawnMs: BOSS_RESPAWN_MS,
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
    respawnMs: RESPAWN_MS,
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
    respawnMs: RESPAWN_MS,
    view: { color: 0x6e4436, height: 1.95, radius: 0.52 },
  }),
  old_scar: mob({
    id: 'old_scar',
    name: 'Old Scar',
    level: 25,
    stars: 6,
    attributes: { strength: 40, dexterity: 16, focus: 8, vitality: 40 },
    baseHealth: 170,
    damageMin: 48,
    damageMax: 67,
    damageType: 'physical',
    swingMs: 2050,
    attackRange: 3.4,
    moveSpeed: 4.8,
    aggroRadius: 16,
    leashRadius: 50,
    lootTableId: 'old_scar',
    respawnMs: ELITE_RESPAWN_MS,
    abilities: OLD_SCAR_ABILITIES,
    view: { color: 0x33251a, height: 3.2, radius: 1.15 },
  }),
};

Object.assign(MOBS, {
  crag_goat: generated({
    id: 'crag_goat',
    name: 'Crag Goat',
    level: 20,
    stars: 1,
    archetype: 'beast',
    lootTableId: 'crag_goat_loot',
    view: { color: 0x9c8f7a, height: 1.1, radius: 0.5 },
  }),
  hill_wolf: generated({
    id: 'hill_wolf',
    name: 'Hill Wolf',
    level: 23,
    stars: 2,
    archetype: 'beast',
    lootTableId: 'hill_wolf_loot',
    view: { color: 0x6b6f78, height: 1.2, radius: 0.5 },
  }),
  cattle_raider: generated({
    id: 'cattle_raider',
    name: 'Cattle Raider',
    level: 26,
    stars: 2,
    archetype: 'skirmisher',
    lootTableId: 'cattle_raider_loot',
    view: { color: 0x7a6350, height: 1.85, radius: 0.48 },
  }),
  moor_eagle: generated({
    id: 'moor_eagle',
    name: 'Moor Eagle',
    level: 29,
    stars: 3,
    archetype: 'beast',
    lootTableId: 'moor_eagle_loot',
    view: { color: 0x8a7654, height: 1, radius: 0.6 },
  }),
  clan_axeman: generated({
    id: 'clan_axeman',
    name: 'Clan Axeman',
    level: 32,
    stars: 3,
    archetype: 'brute',
    lootTableId: 'clan_axeman_loot',
    view: { color: 0x8c5f42, height: 1.95, radius: 0.55 },
  }),
  highland_bear: generated({
    id: 'highland_bear',
    name: 'Highland Bear',
    level: 35,
    stars: 4,
    archetype: 'brute',
    lootTableId: 'highland_bear_loot',
    view: { color: 0x4f3b2a, height: 2.3, radius: 0.85 },
  }),
  clan_berserker: generated({
    id: 'clan_berserker',
    name: 'Clan Berserker',
    level: 38,
    stars: 4,
    archetype: 'skirmisher',
    lootTableId: 'clan_berserker_loot',
    view: { color: 0x9c4a38, height: 2, radius: 0.55 },
  }),
  reach_eel: generated({
    id: 'reach_eel',
    name: 'Blackwater Eel',
    level: 42,
    stars: 2,
    archetype: 'beast',
    lootTableId: 'reach_eel_loot',
    view: { color: 0x4a6b5c, height: 0.7, radius: 0.5 },
  }),
  wrecker_scavenger: generated({
    id: 'wrecker_scavenger',
    name: 'Wrecker Scavenger',
    level: 46,
    stars: 2,
    archetype: 'skirmisher',
    lootTableId: 'wrecker_scavenger_loot',
    view: { color: 0x6d6455, height: 1.85, radius: 0.48 },
  }),
  marsh_heron: generated({
    id: 'marsh_heron',
    name: 'Marsh Heron',
    level: 50,
    stars: 3,
    archetype: 'beast',
    lootTableId: 'marsh_heron_loot',
    view: { color: 0xa8a294, height: 2.1, radius: 0.45 },
  }),
  smuggler_enforcer: generated({
    id: 'smuggler_enforcer',
    name: 'Smuggler Enforcer',
    level: 54,
    stars: 3,
    archetype: 'brute',
    lootTableId: 'smuggler_enforcer_loot',
    view: { color: 0x5f5344, height: 1.95, radius: 0.55 },
  }),
  tidewatch_marauder: generated({
    id: 'tidewatch_marauder',
    name: 'Tidewatch Marauder',
    level: 58,
    stars: 3,
    archetype: 'archer',
    lootTableId: 'tidewatch_marauder_loot',
    view: { color: 0x4f5f6b, height: 1.85, radius: 0.48 },
  }),
  great_pike: generated({
    id: 'great_pike',
    name: 'Great Pike',
    level: 62,
    stars: 4,
    archetype: 'beast',
    lootTableId: 'great_pike_loot',
    view: { color: 0x3f5a4a, height: 1.3, radius: 0.75 },
  }),
  grey_seal_bull: generated({
    id: 'grey_seal_bull',
    name: 'Grey Seal Bull',
    level: 66,
    stars: 4,
    archetype: 'brute',
    lootTableId: 'grey_seal_bull_loot',
    view: { color: 0x6b6d70, height: 1.9, radius: 0.9 },
  }),
  fort_mastiff: generated({
    id: 'fort_mastiff',
    name: 'Fort Mastiff',
    level: 72,
    stars: 2,
    archetype: 'beast',
    lootTableId: 'fort_mastiff_loot',
    view: { color: 0x51453a, height: 1.25, radius: 0.55 },
  }),
  warband_levy: generated({
    id: 'warband_levy',
    name: 'Warband Levy',
    level: 76,
    stars: 2,
    archetype: 'skirmisher',
    lootTableId: 'warband_levy_loot',
    view: { color: 0x6b6152, height: 1.85, radius: 0.5 },
  }),
  blackshield_spearman: generated({
    id: 'blackshield_spearman',
    name: 'Blackshield Spearman',
    level: 80,
    stars: 3,
    archetype: 'brute',
    lootTableId: 'blackshield_spearman_loot',
    view: { color: 0x3d4148, height: 1.95, radius: 0.55 },
  }),
  siege_engineer: generated({
    id: 'siege_engineer',
    name: 'Siege Engineer',
    level: 84,
    stars: 3,
    archetype: 'archer',
    lootTableId: 'siege_engineer_loot',
    view: { color: 0x6d5f4a, height: 1.85, radius: 0.5 },
  }),
  warhound_alpha: generated({
    id: 'warhound_alpha',
    name: 'Warhound Alpha',
    level: 88,
    stars: 4,
    archetype: 'beast',
    lootTableId: 'warhound_alpha_loot',
    view: { color: 0x453a30, height: 1.4, radius: 0.62 },
  }),
  blackshield_champion: generated({
    id: 'blackshield_champion',
    name: 'Blackshield Champion',
    level: 93,
    stars: 4,
    archetype: 'brute',
    lootTableId: 'blackshield_champion_loot',
    view: { color: 0x33373d, height: 2.05, radius: 0.6 },
  }),
  fort_warden: generated({
    id: 'fort_warden',
    name: 'Fort Warden',
    level: 97,
    stars: 4,
    archetype: 'skirmisher',
    lootTableId: 'fort_warden_loot',
    view: { color: 0x2b2f35, height: 2, radius: 0.58 },
  }),
  aonghus: generated({
    id: 'aonghus',
    name: 'Aonghus the Cattle-Lord',
    level: 30,
    stars: 5,
    archetype: 'brute',
    lootTableId: 'aonghus_loot',
    abilities: bossKit('aonghus', 6, 'Aonghus swings his great axe in a wide arc!', 'Aonghus is catching his breath — cut him off!'),
    view: { color: 0xa5623f, height: 2.2, radius: 0.65 },
  }),
  muireann: generated({
    id: 'muireann',
    name: 'Muireann of the Nine Scars',
    level: 40,
    stars: 6,
    archetype: 'skirmisher',
    lootTableId: 'muireann_loot',
    abilities: bossKit('muireann', 7, 'Muireann winds up a killing sweep!', 'Muireann is binding her wounds — stop her!'),
    view: { color: 0xb04a4a, height: 2.15, radius: 0.6 },
  }),
  fiachra: generated({
    id: 'fiachra',
    name: 'Fiachra the Wrecker',
    level: 55,
    stars: 5,
    archetype: 'brute',
    lootTableId: 'fiachra_loot',
    abilities: bossKit('fiachra', 7, 'Fiachra heaves his anchor overhead!', 'Fiachra is patching himself up — interrupt him!'),
    view: { color: 0x4a6b7a, height: 2.25, radius: 0.68 },
  }),
  old_cauldron: generated({
    id: 'old_cauldron',
    name: 'Old Cauldron, the Drowned Pike',
    level: 70,
    stars: 6,
    archetype: 'beast',
    lootTableId: 'old_cauldron_loot',
    abilities: bossKit('old_cauldron', 8, 'Old Cauldron thrashes the shallows!', 'Old Cauldron sinks to mend — cut it off!'),
    view: { color: 0x2f4a3d, height: 2.4, radius: 1.1 },
  }),
  ruadhan: generated({
    id: 'ruadhan',
    name: 'Ruadhán the Blackshield',
    level: 85,
    stars: 5,
    archetype: 'brute',
    lootTableId: 'ruadhan_loot',
    abilities: bossKit('ruadhan', 7, 'Ruadhán raises his shield to crush the ground!', 'Ruadhán is being tended — stop it!'),
    view: { color: 0x3a3f4a, height: 2.3, radius: 0.7 },
  }),
  donnchadh: generated({
    id: 'donnchadh',
    name: 'Donnchadh, Lord of Caer Dubh',
    level: 100,
    stars: 6,
    archetype: 'brute',
    lootTableId: 'donnchadh_loot',
    abilities: bossKit('donnchadh', 8, 'Donnchadh brings his greatsword down like a falling tower!', 'Donnchadh is drawing on his last reserves — interrupt him!'),
    view: { color: 0x1f2228, height: 2.6, radius: 0.9 },
  }),
} satisfies Record<string, MobDef>);

export function getMob(id: string): MobDef {
  const mobDef = MOBS[id];
  if (!mobDef) throw new Error(`Unknown mob: ${id}`);
  return mobDef;
}

// --------------------------------------------------------------------------
// Rare spawns.
//
// Built from the roster in `rares.ts` so the creature, its name and its item
// are one piece of content. Each is a harder version of the camp mob it hides
// among — two levels up, one star up (capped at ★4, because ★5 means boss
// everywhere else) — and each carries exactly one signature drop.
//
// The signature is GUARANTEED, and resolved against the killer's class where
// it can be. Finding the creature is the grind; failing a loot roll on top of
// that would just be the same bad luck charged twice.
// --------------------------------------------------------------------------

/** How much tougher a rare is than the camp mob it replaces, effective. */
const RARE_TOUGHNESS = 1.55;

/**
 * Toughness for a rare whose host is already ★4.
 *
 * A rare normally gains a star, and the multiple is expressed against the
 * host's effective numbers and divided back out through the star modifiers so
 * every rare lands on the same multiple whatever its host. But ★4 has nowhere
 * to climb — ★5 means boss — so those rares take the whole multiple on top of
 * the hardest ordinary stat block in the game, and measured as the two that
 * cloth classes simply cannot beat. Same idea, one notch down.
 */
const RARE_TOUGHNESS_TOPPED = 1.24;

/** And how much harder it hits. Kept well under the health bump: a rare should
 * take a while, not delete a player who found one at the right level. */
// Re-cut once the ordinary creature it hides among became able to kill you.
// A named rare was 1.2x the damage of a camp mob back when a camp mob cost you
// a tenth of your health; 1.2x of the new number is 1.2x of a fight you can
// already lose, and the suite duly reported a warrior beating Mirefang zero
// times out of twenty. Being *tougher* is what a rare is for — being deadlier
// on top of that is what made it unfightable.
const RARE_MENACE = 1.05;

function rareMob(spec: RareSpec): MobDef {
  const host = MOBS[spec.hostMobId];
  if (!host) throw new Error(`Rare ${spec.epithet} hides among an unknown mob: ${spec.hostMobId}`);
  const level = rareLevel(spec);
  const stars = rareStars(spec);
  // Scaled from the HOST rather than re-derived from the curves. The Fenmarch's
  // bestiary is hand-authored and does not follow them, so a curve-built rare
  // in the starting zone would be a different creature from the camp it hides
  // in.
  //
  // The scaling is expressed as a target multiple of the host's EFFECTIVE
  // numbers, then divided back out through the star modifiers. A rare gains a
  // star where it can, but a ★4 host has nowhere to go — ★5 means boss — and a
  // flat base-health bonus left those rares no tougher than the camp around
  // them. This way every rare lands on the same multiple either way.
  const starHealth = STAR_MODIFIERS[host.stars].health / STAR_MODIFIERS[stars].health;
  const starDamage = STAR_MODIFIERS[host.stars].damage / STAR_MODIFIERS[stars].damage;
  return {
    ...host,
    id: rareMobId(spec),
    name: rareMobName(spec, host.name),
    level,
    stars,
    baseHealth: Math.round(
      host.baseHealth * (stars === host.stars ? RARE_TOUGHNESS_TOPPED : RARE_TOUGHNESS) * starHealth,
    ),
    damageMin: Math.round(host.damageMin * RARE_MENACE * starDamage),
    damageMax: Math.round(host.damageMax * RARE_MENACE * starDamage),
    xp: baseMobXp(level, stars),
    lootTableId: rareLootTableId(spec),
    // Long enough that killing one clears the camp of it for a while, short
    // enough that a farmer is not punished for finding it early.
    respawnMs: RESPAWN_MS,
    aggroRadius: host.aggroRadius + 2,
    rareOf: spec.hostMobId,
    sighting: spec.sighting,
    // Visibly not one of the others: bigger, and lit in gold.
    view: { ...host.view, color: 0xf0c94c, height: host.view.height * 1.25, radius: host.view.radius * 1.2 },
  };
}

function rareLoot(spec: RareSpec): LootTable {
  const hostTable = getLootTable(getMob(spec.hostMobId).lootTableId);
  return {
    id: rareLootTableId(spec),
    // Named creatures carry a purse to match.
    goldMultiplier: 2.5,
    ...(spec.carries === 'weapon' ? { classWeapons: signatureWeapons(spec) } : {}),
    ...(spec.carries === 'lore' ? { classTomes: signatureTomes(spec) } : {}),
    entries: [
      ...hostTable.entries,
      // A relic is class-neutral, so it needs no resolution — just a certainty.
      ...(spec.carries === 'relic'
        ? [{ itemId: signatureRelicId(spec), chance: 1, min: 1, max: 1 }]
        : []),
    ],
  };
}

// --------------------------------------------------------------------------
// Armour-line trophies.
//
// One per step, dropping from the camp that step names at a KNOWN rate. That
// is the whole point of the armour line: every other piece of gear in the game
// is a drop rate you fight and hope against, and a trophy turns hope into a
// number of kills you can decide to do.
//
// They are added here rather than written into each table by hand so the item,
// the drop and the quest that wants it cannot drift apart.
// --------------------------------------------------------------------------

for (const [mobId, itemId] of Object.entries(trophiesByMob())) {
  const mob = MOBS[mobId];
  if (!mob) throw new Error(`An armour line asks for a trophy from unknown mob ${mobId}`);
  const table = LOOT_TABLES[mob.lootTableId]!;
  LOOT_TABLES[table.id] = {
    ...table,
    entries: [...table.entries, { itemId, chance: TROPHY_DROP_CHANCE, min: 1, max: 1 }],
  };
}

for (const spec of RARES) {
  const mob = rareMob(spec);
  MOBS[mob.id] = mob;
  MOBS[spec.hostMobId] = { ...MOBS[spec.hostMobId]!, rareVariant: mob.id };
  LOOT_TABLES[mob.lootTableId] = rareLoot(spec);
}

// --------------------------------------------------------------------------
// Bounty spawns: the same creature, carrying a windfall.
//
// Not a harder fight — deliberately a slightly SOFTER one. The reward is the
// event itself, and a jackpot you cannot cash because it hits like a ★4 two
// levels up is just a worse version of no jackpot.
// --------------------------------------------------------------------------

function bountyMob(spec: BountySpec): MobDef {
  const host = MOBS[spec.hostMobId];
  if (!host) throw new Error(`Bounty ${spec.epithet} hides among an unknown mob: ${spec.hostMobId}`);
  return {
    ...host,
    id: bountyMobId(spec),
    name: `${spec.epithet} the ${host.name}`,
    baseHealth: Math.round(host.baseHealth * 0.8),
    xp: spec.kind === 'xp' ? host.xp * BOUNTY_MULTIPLIER : host.xp,
    lootTableId: bountyLootTableId(spec),
    // Long enough that one is an event rather than a rotation.
    respawnMs: RESPAWN_MS,
    rareOf: spec.hostMobId,
    bounty: spec.kind,
    sighting: spec.sighting,
    view: {
      ...host.view,
      // Gold for coin, pale blue for the old and knowing.
      color: spec.kind === 'gold' ? 0xffd25e : 0x9fd8ff,
      height: host.view.height * 1.15,
      radius: host.view.radius * 1.1,
    },
  };
}

function bountyLoot(spec: BountySpec): LootTable {
  const hostTable = getLootTable(getMob(spec.hostMobId).lootTableId);
  return {
    id: bountyLootTableId(spec),
    ...(spec.kind === 'gold' ? { goldMultiplier: BOUNTY_MULTIPLIER } : {}),
    // An xp bounty pays in experience only; it carries the camp's ordinary
    // drops and nothing more, so the two kinds stay distinguishable.
    entries: hostTable.entries,
  };
}

for (const spec of BOUNTIES) {
  const mob = bountyMob(spec);
  MOBS[mob.id] = mob;
  MOBS[spec.hostMobId] = { ...MOBS[spec.hostMobId]!, rareVariant: mob.id };
  LOOT_TABLES[mob.lootTableId] = bountyLoot(spec);
}


// --------------------------------------------------------------------------
// Who answers to whom.
//
// Applied here rather than written into each definition so the roster is one
// readable list. Wildlife is absent on purpose: a Bog Wolf holds no ground and
// takes no side, and a territory map with animals on it stops being a map of
// roads and starts being a bestiary with flags.
// --------------------------------------------------------------------------

const FACTION_ROSTER: Record<string, string[]> = {
  outlaws: ['outlaw_bowman', 'outlaw_reaver', 'outlaw_marauder', 'cadfael', 'old_scar'],
  clans: ['cattle_raider', 'clan_axeman', 'clan_berserker', 'aonghus', 'muireann'],
  wreckers: [
    'wrecker_scavenger',
    'smuggler_enforcer',
    'tidewatch_marauder',
    'fiachra',
    'old_cauldron',
  ],
  blackshields: [
    'warband_levy',
    'blackshield_spearman',
    'siege_engineer',
    'blackshield_champion',
    'fort_warden',
    'ruadhan',
    'donnchadh',
  ],
};

for (const [factionId, members] of Object.entries(FACTION_ROSTER)) {
  for (const mobId of members) {
    const mob = MOBS[mobId];
    if (!mob) throw new Error(`${factionId} claims an unknown member: ${mobId}`);
    MOBS[mobId] = { ...mob, factionId: factionId as MobDef['factionId'] };
  }
}

// Named variants inherit the allegiance of the creature they replace: a rare
// outlaw is still an outlaw, and killing one should move the same front.
for (const mob of Object.values(MOBS)) {
  if (!mob.rareOf) continue;
  const host = MOBS[mob.rareOf]!;
  if (host.factionId) MOBS[mob.id] = { ...mob, factionId: host.factionId };
}

// --------------------------------------------------------------------------
// Wild mounts: horses, dire wolves, and the one unicorn.
//
// Deliberately soft and worth almost nothing dead: no gear, barely any gold,
// a fraction of the experience their level implies. Everything about the stat
// block is trying to say "this is not what you are here for". What you are
// here for is `capture`.
//
// All three families run on the same generator. A dire wolf is not a different
// mechanic from a horse, it is a rarer one with better numbers — and one
// generator is what stops the rarest family quietly ending up the softest to
// fight because nobody re-checked its stat block.
// --------------------------------------------------------------------------

function wildMount(def: MountDef): MobDef {
  const damage = curveMobDamageRange(def.level);
  return {
    id: def.mobId,
    // "Wild The Pale of Caer Dubh" is not a name. Anything already named with
    // an article is already wild enough.
    name: def.name.startsWith('The ') ? def.name : `Wild ${def.name}`,
    level: def.level,
    stars: 2,
    attributes: {
      strength: Math.round(def.level * 0.8),
      dexterity: Math.round(def.level * 1.1),
      focus: Math.round(def.level * 0.3),
      vitality: Math.round(def.level * 0.9),
    },
    baseHealth: Math.round(curveMobHealth(def.level) * 0.85),
    // It kicks, or it snaps. It is not trying to kill you.
    damageMin: Math.round(damage.min * 0.5),
    damageMax: Math.round(damage.max * 0.5),
    damageType: 'physical',
    swingMs: 2000,
    attackRange: 2.4,
    moveSpeed: def.speed,
    // Nothing in a herd picks fights — a wolf included. A herd is a place you
    // go, not a thing that happens to you: being ambushed by the mount you were
    // hoping to find is the opposite of noticing something.
    aggroRadius: 0,
    leashRadius: 40,
    xp: Math.round(baseMobXp(def.level, 2) * 0.25),
    lootTableId: 'wild_horse',
    respawnMs: RESPAWN_MS,
    horse: def.id,
    view: def.view,
  };
}

LOOT_TABLES.wild_horse = { id: 'wild_horse', goldMultiplier: 0.15, entries: [] };

for (const def of MOUNTS) MOBS[def.mobId] = wildMount(def);

/** Every wild mount, for content that needs to walk them. */
export const HORSE_MOBS: MobDef[] = MOUNTS.map((m) => MOBS[m.mobId]!);

// --------------------------------------------------------------------------
// Dragons.
//
// Built here so combat, loot and the renderer treat them like any other
// creature — but nothing puts them in a zone's spawn list. `World` owns where
// they are and what they are doing; see `tickDragons`.
//
// ★6 with a multiplier rather than a seventh star: adding ★7 would mean
// re-fitting STAR_MODIFIERS and every rule keyed to "★5 is a boss, ★6 is an
// elite boss" for the sake of four creatures.
// --------------------------------------------------------------------------

function dragonMob(def: DragonDef): MobDef {
  const elite = MOBS[def.eliteId];
  if (!elite) throw new Error(`${def.name} is anchored to an unknown boss: ${def.eliteId}`);
  return {
    id: dragonMobId(def),
    name: def.title,
    level: def.level,
    stars: 6,
    attributes: {
      strength: Math.round(def.level * 1.2),
      dexterity: Math.round(def.level * 0.7),
      focus: Math.round(def.level * 0.8),
      vitality: Math.round(def.level * 1.1),
    },
    baseHealth: Math.round(elite.baseHealth * def.toughness),
    damageMin: Math.round(elite.damageMin * def.menace),
    damageMax: Math.round(elite.damageMax * def.menace),
    damageType: 'fire',
    swingMs: 2400,
    attackRange: 4.5,
    moveSpeed: 4.2,
    aggroRadius: 16,
    // It does not go home. There is nowhere to leash it to — it is already
    // exactly where it means to be.
    leashRadius: 90,
    xp: baseMobXp(def.level, 6),
    lootTableId: dragonLootTableId(def),
    respawnMs: 0,
    abilities: [
      {
        id: `${def.id}_breath`,
        name: 'Breath',
        kind: 'heavySlam',
        cooldownMs: 16000,
        castMs: 2400,
        radius: 9,
        damageMultiplier: 3.8,
        interruptible: false,
        telegraphText: `${def.name} draws breath!`,
      },
      {
        id: `${def.id}_rage`,
        name: 'Old Fury',
        kind: 'enrage',
        cooldownMs: 0,
        castMs: 0,
        healthThreshold: 0.35,
        enrageDamageMultiplier: 1.5,
        telegraphText: `${def.name} stops playing with you.`,
      },
    ],
    dragon: true,
    view: def.view,
  };
}

for (const def of DRAGONS) {
  MOBS[dragonMobId(def)] = dragonMob(def);
  LOOT_TABLES[dragonLootTableId(def)] = {
    id: dragonLootTableId(def),
    goldMultiplier: 4,
    classWeapons: dragonWeapons(def),
    entries: [],
  };
}

/** Every dragon's combat definition. */
export const DRAGON_MOBS: MobDef[] = DRAGONS.map((d) => MOBS[dragonMobId(d)]!);

// Both lists are built AFTER the allegiances above: the loop replaces each
// entry in MOBS with a new object, so a list captured earlier would hold the
// pre-faction copies and quietly report every named creature as unaligned.

/** Every rare spawn, for content that needs to walk them. */
export const RARE_MOBS: MobDef[] = RARES.map((spec) => MOBS[rareMobId(spec)]!);

/** Every bounty spawn, for content that needs to walk them. */
export const BOUNTY_MOBS: MobDef[] = BOUNTIES.map((spec) => MOBS[bountyMobId(spec)]!);

export function getLootTable(id: string): LootTable {
  const table = LOOT_TABLES[id];
  if (!table) throw new Error(`Unknown loot table: ${id}`);
  return table;
}

/**
 * A creature that drops a given item, for pointing a player at one.
 *
 * The quest tracker needs to answer "where do I get eight wolf pelts", and the
 * only honest source for that is the loot tables themselves — a hand-written
 * map of item to creature is a second copy of the truth, and it goes stale the
 * first time a loot table changes.
 */
export function mobDropping(itemId: string): string | undefined {
  for (const mob of Object.values(MOBS)) {
    if (mob.rareOf || mob.dragon || mob.horse) continue;
    const table = LOOT_TABLES[mob.lootTableId];
    if (table?.entries.some((e) => e.itemId === itemId)) return mob.id;
  }
  return undefined;
}

// --------------------------------------------------------------------------
// Star variants.
//
// The same creature at a different rating. A camp of Bog Wolves is not eight
// identical Bog Wolves any more: it is a scrawny one, four ordinary ones, a
// snarling one and, if the roll goes that way, an alpha — and the player can
// see which is which from the nameplate and, once there is art, from the
// silhouette.
//
// This is the cheapest variety in the game. Fifty-one creatures times four
// ratings is two hundred distinct things to meet, and not one of them needed a
// new stat block: `STAR_MODIFIERS` already turns a rating into health, damage
// and defence, and `baseMobXp` and `goldForKill` already pay by rating. All
// that was missing was the roll and the name.
// --------------------------------------------------------------------------

/**
 * What a creature is called at each rating.
 *
 * Adjectives rather than numbers, because a player reads "Gaunt Bog Wolf" and
 * knows what it means without being told, and reads "Bog Wolf (1)" and knows
 * only that a programmer was here.
 *
 * A creature keeps its plain name at the rating it was authored with — that is
 * the one the bestiary describes and the one the level band is fitted to — and
 * takes a word at every other.
 */
const STAR_PREFIX: Record<number, string[]> = {
  1: ['Gaunt', 'Scrawny', 'Half-Grown', 'Starveling'],
  // ★2 carries a word too, even though it is the ordinary rating. A creature
  // whose base rating is ★1 or ★3 still needs a ★2 name, and leaving this
  // empty gave the Moor Hare two ratings both called "Moor Hare".
  2: ['Full-Grown', 'Wary', 'Lean', 'Common'],
  3: ['Snarling', 'Rangy', 'Scarred', 'Hard-Bitten'],
  4: ['Great', 'Elder', 'Black', 'Storm-Fed'],
};

/**
 * How often each rating turns up on a camp spawn point.
 *
 * Weighted toward the middle, so a camp reads as a population rather than a
 * lottery: mostly ordinary animals, a few runts, a few big ones, and the ★4 is
 * rare enough that finding one is a decision about whether to take it. That
 * decision is the point — the lethality suite measures a ★4 at your own level
 * killing a fifth of the characters that pull one.
 */
export const STAR_SPREAD: Array<{ stars: StarRating; weight: number }> = [
  { stars: 1, weight: 0.22 },
  { stars: 2, weight: 0.46 },
  { stars: 3, weight: 0.24 },
  { stars: 4, weight: 0.08 },
];

/** Id of a creature's variant at a given rating. */
export function starVariantId(baseId: string, stars: StarRating): string {
  return `${baseId}__s${stars}`;
}

/** The name a creature carries at a given rating. */
function starVariantName(base: MobDef, stars: StarRating): string {
  const options = STAR_PREFIX[stars] ?? [];
  if (options.length === 0) return base.name;
  // Chosen from the id rather than rolled, so a creature's ★3 is always called
  // the same thing — a name that changes between spawns is not a name.
  let hash = 0;
  for (const ch of base.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `${options[hash % options.length]} ${base.name}`;
}

/**
 * Every ordinary creature, at every rating it does not already have.
 *
 * Bosses, elites, dragons, mounts and named rares are all excluded: each of
 * those means something specific, and a "Gaunt Cadfael" would be a joke at the
 * expense of the one thing in the zone that is supposed to land.
 */
function buildStarVariants(): Record<string, MobDef> {
  const out: Record<string, MobDef> = {};
  for (const base of Object.values(MOBS)) {
    if (base.stars >= BOSS_STARS || base.horse || base.rareOf || base.dragon) continue;
    if (base.starOf) continue;
    for (const { stars } of STAR_SPREAD) {
      if (stars === base.stars) continue;
      const id = starVariantId(base.id, stars);
      const { rareVariant: _drop, ...rest } = base;
      out[id] = {
        ...rest,
        id,
        name: starVariantName(base, stars),
        stars,
        // Experience and gold follow the rating, exactly as they do for any
        // other creature — that is what makes hunting the big one worth it.
        xp: baseMobXp(base.level, stars),
        starOf: base.id,
        // A rating does not host the camp's rare. The rare roll happens first
        // and against the plain creature — leaving `rareVariant` on a variant
        // would mean a host with four of them, and the test that asserts one
        // variant per host is the reason that matters.
        // A ★4 is visibly bigger than a runt of the same animal. Modest, so
        // the rating is read from the nameplate first and the size second.
        view: { ...base.view, height: base.view.height * (0.86 + stars * 0.05) },
      };
    }
  }
  return out;
}

Object.assign(MOBS, buildStarVariants());

/** Every rating a creature comes in, commonest first. Includes itself. */
export function starVariantsOf(baseId: string): MobDef[] {
  const base = MOBS[baseId];
  if (!base) return [];
  return STAR_SPREAD.map(({ stars }) =>
    stars === base.stars ? base : MOBS[starVariantId(baseId, stars)],
  ).filter((m): m is MobDef => !!m);
}

/**
 * The creature behind a definition, whatever rating it turned up at.
 *
 * A Snarling Bog Wolf is a Bog Wolf. Everything that asks "which creature is
 * this" — a quest counting kills, a garrison checking who is standing at a
 * post, a bounty checking which camp it hides in — wants this and not the id,
 * or a player who kills eight wolves of assorted sizes has killed eight of
 * nothing.
 */
export function baseMobId(mobId: string): string {
  return MOBS[mobId]?.starOf ?? mobId;
}
