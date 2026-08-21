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
}

export type EquipSlot = 'weapon' | 'head' | 'chest' | 'legs' | 'ring';

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
  attributes?: Partial<Attributes>;
  damageMin?: number;
  damageMax?: number;
  damageType?: DamageType;
  swingMs?: number;
  attackRange?: number;
  armor?: number;
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
  /** Global cooldown remaining; blocks every skill while > 0. */
  gcdMs?: number;
  /** Normalized movement intent, held until the client changes it. */
  moveDir?: Vec2;

  // --- vendor-only ---
  vendorId?: string;

  // --- mob-only ---
  defId?: string;
  spawnPos?: Vec2;
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
  | { t: 'unequip'; slot: EquipSlot }
  | { t: 'spendPoint'; attr: keyof Attributes }
  | { t: 'sell'; vendorId: EntityId; itemId: string; qty: number }
  | { t: 'buy'; vendorId: EntityId; itemId: string }
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
  | { t: 'sold'; entityId: EntityId; itemId: string; qty: number; gold: number }
  | { t: 'bought'; entityId: EntityId; itemId: string; gold: number }
  | { t: 'skillUnlocked'; entityId: EntityId; skillId: string }
  | { t: 'error'; entityId: EntityId; message: string };
