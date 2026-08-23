/**
 * Core sim types. This file must never import anything from `render/`.
 *
 * The renderer is a *subscriber*: it reads state snapshots and reacts to the
 * SimEvent stream. Animation, VFX, sound and floating combat text all hang off
 * these events, which is why the event list is deliberately richer than what
 * the current placeholder renderer consumes.
 */

export type EntityId = number;

/** Ground-plane position. Y is derived from terrain, so the sim stays 2D. */
export interface Vec2 {
  x: number;
  z: number;
}

export type ClassId = 'warrior' | 'priest' | 'ranger' | 'rogue' | 'mage';

export type DamageType = 'physical' | 'fire' | 'frost' | 'nature';

/**
 * Difficulty rating, shown to the player as stars.
 *
 *   ★1–★4  ordinary mobs of increasing danger
 *   ★5      boss
 *   ★6      elite boss
 *
 * Stars scale health, damage and defence (see `STAR_MODIFIERS`) and are the
 * main lever for making an encounter hard *without* inflating its level — which
 * matters because level gap drives xp rewards.
 */
export type StarRating = 1 | 2 | 3 | 4 | 5 | 6;

export const BOSS_STARS = 5;
export const ELITE_BOSS_STARS = 6;

export function isBoss(stars: StarRating): boolean {
  return stars >= BOSS_STARS;
}

/** The four primary attributes players spend points into on level up. */
export interface Attributes {
  strength: number;
  dexterity: number;
  focus: number;
  vitality: number;
}

/** Everything combat math actually reads, after gear and buffs are folded in. */
export interface DerivedStats {
  maxHealth: number;
  maxEnergy: number;
  attack: number;
  defense: number;
  critChance: number;
  /** Milliseconds between auto-attack swings. */
  swingMs: number;
  damageMin: number;
  damageMax: number;
  damageType: DamageType;
  /** Melee reach / weapon range, in world units. */
  attackRange: number;
  moveSpeed: number;
  /** Multiplier on skill damage and healing. 1 for anyone without a grimoire. */
  skillPower: number;
  /** Flat health per second on top of the percentage regen. */
  regenPerSec: number;
}

/**
 * The powers that hold ground. Wildlife belongs to none of them — see
 * `content/factions.ts` for why that matters.
 */
export type FactionId = 'freeholders' | 'outlaws' | 'clans' | 'wreckers' | 'blackshields';

/** The four armour slots the ladders and quest sets are built around. */
export type ArmorSlot = 'head' | 'chest' | 'legs' | 'ring';

/**
 * Everything you can wear.
 *
 * `offhand`, `amulet` and `bracelet` exist for the luxury goods — see
 * `content/luxury.ts`. They are deliberately NOT part of any ladder: no mob
 * drops one, no quest pays one out. They are bought, and the price is the
 * content.
 */
export type EquipSlot = 'weapon' | ArmorSlot | 'offhand' | 'amulet' | 'bracelet';

export type ItemQuality = 'common' | 'uncommon' | 'rare' | 'epic';

export interface ItemDef {
  id: string;
  name: string;
  slot: EquipSlot | null;
  /** Rough tier for colouring and vendor value. */
  quality: ItemQuality;
  value: number;
  stackable?: boolean;
  /**
   * Classes allowed to equip this. Undefined means anyone can.
   *
   * Weapons are class-locked so "a weapon for your class" is a meaningful
   * reward — a Priest cannot swing a Warrior's greatsword to get its raw
   * damage, and vice versa.
   */
  classes?: ClassId[];
  /** Marks an item whose only purpose is to be sold. */
  merchantGood?: boolean;
  /**
   * Skill this item teaches when used. Consumed on learning.
   *
   * Tomes are class-locked through `classes` for the same reason weapons are:
   * a reward you cannot use is not a reward.
   */
  teaches?: string;
  attributes?: Partial<Attributes>;
  damageMin?: number;
  damageMax?: number;
  damageType?: DamageType;
  swingMs?: number;
  attackRange?: number;
  armor?: number;

  // --- signature affixes ---------------------------------------------------
  // Carried only by the pieces rare spawns drop. No ladder item has one, which
  // is the point: a signature piece is not "the next tier early", it does
  // something the tiers never do.
  /** Added to crit chance, 0-1. */
  critBonus?: number;
  /** Flat maximum health. */
  healthBonus?: number;
  /** Flat movement speed, in world units per second. */
  moveSpeedBonus?: number;

  // --- luxury affixes ------------------------------------------------------
  // The offhand slots. Bought, never dropped.
  /** Flat damage added to every weapon swing — an offhand blade. */
  damageBonus?: number;
  /** Multiplier on everything a skill does: damage, ticks and heals. */
  skillPower?: number;
  /** Flat health per second, in and out of combat — an amulet or bracelet. */
  regenBonus?: number;

  /**
   * Level needed to equip it.
   *
   * Only the luxury goods use this. Gold can be earned at any level — a
   * bounty spawn at level 12 pays a level-12 purse, but nothing stops a
   * patient player hoarding — and a level cap is what keeps the best gear in
   * the game from being a shortcut past eighty levels of it.
   */
  reqLevel?: number;
}

export interface ItemStack {
  itemId: string;
  qty: number;
}

export type SkillEffectKind = 'damage' | 'heal' | 'dot' | 'buff' | 'interrupt';

export interface SkillDef {
  id: string;
  name: string;
  classId: ClassId;
  /** Level at which the skill unlocks. */
  reqLevel: number;
  energyCost: number;
  cooldownMs: number;
  /** 0 for instant. Casting is interrupted by taking damage when true. */
  castMs: number;
  interruptible: boolean;
  range: number;
  kind: SkillEffectKind;
  /** Multiplier applied to rolled weapon damage, for `damage` skills. */
  weaponMultiplier?: number;
  /** Flat addition before mitigation. */
  flatPower?: number;
  damageType?: DamageType;
  /** Extra threat added on top of damage-derived threat. */
  threatBonus?: number;
  /** For dot/buff: total duration and tick spacing. */
  durationMs?: number;
  tickMs?: number;
  /** For buff: what it actually does. */
  defenseBonus?: number;
  damageMultiplier?: number;
  /**
   * For `interrupt`: how long the interrupted ability is locked out afterwards.
   * Without a lockout the boss simply re-casts next tick and the interrupt is
   * a wasted global cooldown.
   */
  lockoutMs?: number;
  /**
   * Item that teaches this skill, if it is not simply granted by level.
   *
   * A skill with `taughtBy` is invisible until you find or buy the item and
   * learn it — that is how a zone gives you something no earlier zone could.
   * Reaching the level is necessary but no longer sufficient.
   */
  taughtBy?: string;
  /** Zone that teaches it. Undefined for the level-granted starting kit. */
  zoneId?: string;
  description: string;
}

// --------------------------------------------------------------------------
// Mob abilities.
//
// These exist to solve a specific problem: a boss whose only mechanic is a
// bigger stat block has no outcome variance — the fight is decided before it
// starts. Telegraphed, dodgeable abilities make the same fight winnable or
// losable based on what the player does, which is the whole point of a boss.
// --------------------------------------------------------------------------

export type MobAbilityKind =
  /** Wind-up AoE centred on the caster. Escape the radius before it lands. */
  | 'heavySlam'
  /** One-shot self-buff below a health threshold. */
  | 'enrage'
  /** Calls in adds that despawn when the summoner resets or dies. */
  | 'summon'
  /** Instant heal on the caster; punishes slow damage. */
  | 'mend';

export interface MobAbilityDef {
  id: string;
  name: string;
  kind: MobAbilityKind;
  cooldownMs: number;
  /** Telegraph window. 0 is instant and undodgeable — use sparingly. */
  castMs: number;
  /** heavySlam: damage radius in world units. */
  radius?: number;
  /** heavySlam: multiplier on the mob's normal weapon damage. */
  damageMultiplier?: number;
  /** enrage: fires once when health drops below this fraction (0–1). */
  healthThreshold?: number;
  /** enrage: what the buff does, and for how long (omit for permanent). */
  enrageDamageMultiplier?: number;
  enrageDurationMs?: number;
  /** summon: what and how many. */
  summonMobId?: string;
  summonCount?: number;
  /** mend: fraction of max health restored. */
  healFraction?: number;
  /**
   * Whether a player interrupt can stop this mid-cast.
   *
   * Deliberately split by role: a big telegraphed AoE is answered by *moving*,
   * a heal or a summon is answered by *interrupting*. Making everything
   * interruptible would collapse both answers into one button.
   */
  interruptible?: boolean;
  /** Shown in the combat log when the ability starts. */
  telegraphText: string;
}

export interface LootEntry {
  itemId: string;
  chance: number;
  min: number;
  max: number;
}

export interface LootTable {
  id: string;
  /** Rolled independently — every entry gets its own chance check. */
  entries: LootEntry[];
  /**
   * Multiplier on the gold this mob's level and stars would normally yield.
   * Gold itself is derived (see `goldForKill`) so that harder mobs always pay
   * better without every table hand-setting a range that can drift.
   */
  goldMultiplier?: number;
  /**
   * A weapon matched to the looting player's class, resolved at kill time.
   *
   * This is how a boss guarantees a reward that is actually useful to you
   * rather than a class-locked item you have to vendor.
   */
  classWeapons?: Partial<Record<ClassId, string>>;
  /**
   * A skill tome matched to the looting player's class, same resolution as
   * `classWeapons`. Suppressed if that player already knows the skill, so
   * farming a boss for its gear never buries you in tomes you cannot use.
   */
  classTomes?: Partial<Record<ClassId, string>>;
  /** Odds the class tome drops at all. Omitted means guaranteed — bosses. */
  classTomeChance?: number;
}

// --------------------------------------------------------------------------
// Quests.
//
// Quests exist to give a zone DIRECTION. Without them the Fenmarch is a field
// of camps and nothing tells you the interesting thing is south. A chain of
// objectives, each pointing one band further on, is the cheapest way to turn a
// layout into a route.
// --------------------------------------------------------------------------

export type QuestObjective =
  | { kind: 'kill'; mobId: string; count: number; text: string }
  | { kind: 'collect'; itemId: string; count: number; text: string }
  | { kind: 'reach'; zoneId: string; text: string }
  | { kind: 'level'; level: number; text: string };

export interface QuestDef {
  id: string;
  name: string;
  /** Zone the quest is given in, and the vendor who gives and takes it. */
  zoneId: string;
  giverVendorId: string;
  minLevel: number;
  /**
   * Which chain this belongs to.
   *
   * A zone runs more than one: the story chain that walks you through its
   * bands, and the armour line that outfits you as you go. Grouping by zone
   * alone would read the two as one broken chain.
   */
  chain: string;
  /** Quest that must be finished first, if any — this is how chains are built. */
  requires?: string;
  summary: string;
  objectives: QuestObjective[];
  rewards: {
    xp: number;
    gold: number;
    items?: string[];
    /** A reward matched to the player's class, resolved on turn-in. */
    classItems?: Partial<Record<ClassId, string>>;
  };
}

/**
 * Where a dragon is in its life, as authoritative sim state.
 *
 * The entity only exists while the player is in its zone AND it is out of its
 * lair — but the phase runs whatever zone you are in, which is what makes
 * coming back to a zone feel like coming back to somewhere that carried on.
 */
export interface DragonState {
  phase: 'dormant' | 'hunting' | 'roosting' | 'slain';
  /** Milliseconds left in the current phase. */
  remainingMs: number;
  /** Index into the dragon's territory: where it is, or is heading. */
  stop: number;
  /** Holding it is currently sitting on, if roosting. */
  holdingId: string | null;
}

/** Live progress for one accepted quest: one counter per objective. */
export interface QuestProgress {
  questId: string;
  counts: number[];
}

/**
 * A trader. Vendors are the sink for gold and the buyer for merchant goods,
 * which is what makes those two reward streams mean anything.
 */
export interface VendorDef {
  id: string;
  name: string;
  greeting: string;
  /** Item ids this vendor keeps in stock, in the order they are listed. */
  stock: string[];
  /** Renderer hint. */
  view: { color: number; height: number; radius: number };
}

export interface MobDef {
  id: string;
  name: string;
  level: number;
  stars: StarRating;
  attributes: Attributes;
  baseHealth: number;
  damageMin: number;
  damageMax: number;
  damageType: DamageType;
  swingMs: number;
  attackRange: number;
  moveSpeed: number;
  aggroRadius: number;
  leashRadius: number;
  /** Base xp before star and level-gap scaling. */
  xp: number;
  lootTableId: string;
  respawnMs: number;
  abilities?: MobAbilityDef[];
  /**
   * Rare-spawn linkage, generated in pairs so neither half can go stale.
   *
   * `rareVariant` on an ordinary mob names the creature its spawn points can
   * come back as; `rareOf` on that creature names the mob it replaces, which
   * is how the world puts the camp back to normal afterwards.
   */
  rareVariant?: string;
  rareOf?: string;
  /**
   * Marks a rare that carries a windfall rather than an item.
   *
   * A `gold` or `xp` bounty is not a harder fight — it is the same creature
   * with a purse. Making it tougher would turn a piece of luck into a wall,
   * and a windfall you cannot collect is worse than no windfall.
   */
  bounty?: 'gold' | 'xp';
  /** Rares only: the line shown when one turns up. */
  sighting?: string;
  /**
   * Which power this creature answers to, if any.
   *
   * Only people have one. A Bog Wolf holds no ground and takes no side, which
   * is what keeps the territory layer a map of roads rather than a bestiary
   * with flags on it.
   */
  factionId?: FactionId;
  /**
   * Marks a dragon: a creature the world moves around rather than one a zone
   * spawns. Content and tests that mean "a zone's boss" must exclude these.
   */
  dragon?: boolean;
  /** Renderer hints only — the sim never reads these. */
  view: { color: number; height: number; radius: number };
}

export type ActiveEffectKind = 'dot' | 'buff';

export interface ActiveEffect {
  id: string;
  kind: ActiveEffectKind;
  sourceId: EntityId;
  /** Skill or ability id that applied this. */
  sourceAbilityId: string;
  remainingMs: number;
  tickMs: number;
  sinceTickMs: number;
  damageType: DamageType;
  /** dot: damage per tick, applied without mitigation. */
  dotPower?: number;
  /** buff: flat defence added while active. */
  defenseBonus?: number;
  /** buff: multiplier on outgoing weapon damage while active. */
  damageMultiplier?: number;
}

/** An in-progress cast, for player skills and mob abilities alike. */
export interface CastState {
  kind: 'skill' | 'ability';
  id: string;
  remainingMs: number;
  totalMs: number;
  targetId: EntityId | null;
  /** Delay already added by incoming damage; capped so a cast cannot stall out. */
  pushbackMs?: number;
}

export interface Entity {
  id: EntityId;
  kind: 'player' | 'mob' | 'vendor';
  name: string;
  level: number;
  pos: Vec2;
  /** Facing in radians; presentation reads it, AI writes it. */
  facing: number;
  health: number;
  energy: number;
  dead: boolean;
  /** Set on death; counts down to respawn for mobs. */
  respawnInMs: number;
  targetId: EntityId | null;
  autoAttack: boolean;
  swingCooldownMs: number;
  effects: ActiveEffect[];
  cast?: CastState | null;

  // --- player-only ---
  classId?: ClassId;
  xp?: number;
  gold?: number;
  attributes?: Attributes;
  unspentPoints?: number;
  inventory?: ItemStack[];
  equipment?: Partial<Record<EquipSlot, string>>;
  skillCooldowns?: Record<string, number>;
  /** Skills learned from a tome. Level-granted skills are not listed here. */
  learnedSkills?: string[];
  /** What each faction makes of you. See `content/factions.ts`. */
  standing?: Partial<Record<FactionId, number>>;
  /** Accepted quests and their per-objective counters. */
  quests?: QuestProgress[];
  /** Ids of quests already turned in; a quest is never repeatable. */
  questsDone?: string[];
  /** Global cooldown remaining; blocks every skill while > 0. */
  gcdMs?: number;
  /** Normalized movement intent, held until the client changes it. */
  moveDir?: Vec2;

  // --- vendor-only ---
  vendorId?: string;

  // --- mob-only ---
  defId?: string;
  spawnPos?: Vec2;
  /** Guard post this mob stands at, if any — see `SpawnPoint.holding`. */
  holding?: string;
  /** Set on the entity a dragon is currently being represented by. */
  dragonId?: string;
  aiState?: 'idle' | 'chasing' | 'attacking' | 'returning' | 'dead';
  threat?: Record<EntityId, number>;
  abilityCooldowns?: Record<string, number>;
  /** Abilities locked out by a player interrupt, keyed to remaining ms. */
  abilityLockouts?: Record<string, number>;
  /** Health-threshold abilities that have already fired this life. */
  firedAbilities?: string[];
  /** Set on adds; they are removed when their summoner dies or resets. */
  summonedBy?: EntityId;
  /** Corpse loot, generated at death, claimed by `loot` command. */
  corpseLoot?: ItemStack[];
  corpseGold?: number;
}

// --------------------------------------------------------------------------
// Commands: the ONLY way the outside world mutates the sim.
//
// Single-player runs these in-process. A future server would receive the exact
// same objects over the wire and validate them the exact same way. Do not add
// a code path that mutates entities directly from the renderer.
// --------------------------------------------------------------------------

export type Command =
  | { t: 'move'; dir: Vec2 }
  | { t: 'face'; facing: number }
  | { t: 'target'; id: EntityId | null }
  | { t: 'autoAttack'; on: boolean }
  | { t: 'useSkill'; skillId: string }
  | { t: 'loot'; id: EntityId }
  | { t: 'equip'; itemId: string }
  | { t: 'learnSkill'; itemId: string }
  | { t: 'unequip'; slot: EquipSlot }
  | { t: 'spendPoint'; attr: keyof Attributes }
  | { t: 'sell'; vendorId: EntityId; itemId: string; qty: number }
  | { t: 'buy'; vendorId: EntityId; itemId: string }
  | { t: 'acceptQuest'; vendorId: EntityId; questId: string }
  | { t: 'turnInQuest'; vendorId: EntityId; questId: string }
  | { t: 'abandonQuest'; questId: string }
  | { t: 'travel'; toZoneId: string }
  | { t: 'respawn' };

/** A command paired with the actor issuing it. Server-side, actorId is trusted. */
export interface ActorCommand {
  actorId: EntityId;
  cmd: Command;
}

// --------------------------------------------------------------------------
// Events: the sim's outbound stream. Presentation subscribes; sim never reads.
// --------------------------------------------------------------------------

export type SimEvent =
  | { t: 'swing'; sourceId: EntityId; targetId: EntityId }
  | { t: 'castBegin'; sourceId: EntityId; kind: 'skill' | 'ability'; id: string; durationMs: number }
  | { t: 'castInterrupted'; sourceId: EntityId; kind: 'skill' | 'ability'; id: string }
  | { t: 'castComplete'; sourceId: EntityId; kind: 'skill' | 'ability'; id: string }
  /** Damage delayed a cast rather than cancelling it. */
  | { t: 'castPushback'; sourceId: EntityId; id: string; delayMs: number }
  /** A dodgeable AoE is winding up. The renderer draws the danger zone from this. */
  | {
      t: 'telegraph';
      sourceId: EntityId;
      abilityId: string;
      name: string;
      radius: number;
      durationMs: number;
      text: string;
    }
  /** The player was outside the radius when a telegraphed ability landed. */
  | { t: 'dodged'; sourceId: EntityId; targetId: EntityId; abilityId: string }
  | { t: 'enraged'; entityId: EntityId; abilityId: string }
  /** A player interrupt landed and locked the ability out. */
  | {
      t: 'interrupted';
      sourceId: EntityId;
      targetId: EntityId;
      abilityId: string;
      abilityName: string;
      lockoutMs: number;
    }
  /** An interrupt was used but the target was not casting anything stoppable. */
  | { t: 'interruptWasted'; sourceId: EntityId; targetId: EntityId }
  | { t: 'summoned'; sourceId: EntityId; spawnedIds: EntityId[] }
  | {
      t: 'damage';
      sourceId: EntityId;
      targetId: EntityId;
      amount: number;
      crit: boolean;
      damageType: DamageType;
      /** Skill or ability id, or null for an auto-attack. */
      abilityId: string | null;
    }
  | { t: 'miss'; sourceId: EntityId; targetId: EntityId }
  | { t: 'heal'; sourceId: EntityId; targetId: EntityId; amount: number }
  | { t: 'death'; entityId: EntityId; killerId: EntityId | null }
  | { t: 'spawn'; entityId: EntityId }
  | { t: 'despawn'; entityId: EntityId }
  | { t: 'aggro'; mobId: EntityId; targetId: EntityId }
  | { t: 'leash'; mobId: EntityId }
  | { t: 'xpGained'; entityId: EntityId; amount: number }
  | { t: 'levelUp'; entityId: EntityId; level: number }
  | { t: 'lootGained'; entityId: EntityId; items: ItemStack[]; gold: number }
  | { t: 'questAccepted'; entityId: EntityId; questId: string }
  | { t: 'questProgress'; entityId: EntityId; questId: string; objectiveIndex: number; count: number; needed: number }
  | { t: 'questReady'; entityId: EntityId; questId: string }
  | { t: 'questCompleted'; entityId: EntityId; questId: string; xp: number; gold: number; items: string[] }
  | { t: 'questAbandoned'; entityId: EntityId; questId: string }
  | { t: 'zoneChanged'; entityId: EntityId; zoneId: string; zoneName: string }
  | { t: 'sold'; entityId: EntityId; itemId: string; qty: number; gold: number }
  | { t: 'bought'; entityId: EntityId; itemId: string; gold: number }
  | { t: 'skillUnlocked'; entityId: EntityId; skillId: string }
  /** A dragon woke, moved, settled, left or died. */
  | {
      t: 'dragon';
      dragonId: string;
      name: string;
      phase: 'dormant' | 'hunting' | 'roosting' | 'slain';
      zoneId: string;
      holdingId: string | null;
      text: string;
    }
  /** A holding changed hands. The one event the whole territory layer exists for. */
  | {
      t: 'holdingChanged';
      holdingId: string;
      name: string;
      from: FactionId;
      to: FactionId;
      /** Whether the player's own actions pushed it over. */
      byPlayer: boolean;
    }
  /** Standing with a faction moved across a band boundary. */
  | { t: 'standingChanged'; entityId: EntityId; factionId: FactionId; value: number; band: string }
  /** A named rare spawn has taken over a camp spawn point. */
  | { t: 'rareSpawn'; entityId: EntityId; mobId: string; name: string; sighting: string }
  | { t: 'error'; entityId: EntityId; message: string };
