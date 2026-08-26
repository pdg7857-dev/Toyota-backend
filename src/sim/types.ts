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

/** What a potion or elixir does when it goes down. */
export interface ConsumableEffect {
  /** Fraction of maximum health restored instantly. */
  healPercent?: number;
  /** Health per second, and for how long. */
  regen?: { perSec: number; seconds: number };
  /** Multiplier on outgoing damage while it lasts. */
  damageMultiplier?: number;
  /** Flat defence added while it lasts. */
  defenseBonus?: number;
  /**
   * Which cooldown clock it runs on.
   *
   * Two clocks, not one per item: a consumable you can chain is not a decision,
   * it is a health bar with extra steps.
   */
  family: 'potion' | 'elixir';
}

export interface ItemDef {
  id: string;
  name: string;
  slot: EquipSlot | 'none' | null;
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
  /**
   * What drinking this does. Present only on potions and elixirs.
   *
   * A consumable is the answer to a fight going wrong, which is a thing that
   * only started happening when the creatures got dangerous. See
   * `content/consumables.ts` for why the two families work differently.
   */
  consumable?: ConsumableEffect;
  /** One line of colour, shown in the tooltip. */
  flavor?: string;
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
  /**
   * Attributes you must actually have to wear it.
   *
   * A level says *when* a piece is for you; this says *who* it is for. A
   * grimoire asking for Focus is the shortest way to say "this is a caster's",
   * and it is what stops a build from being a set of numbers nobody can feel:
   * spreading points across three attributes now means a rack of gear you
   * cannot put on.
   *
   * Deliberately set at a little over half what a committed build has at that
   * level — see `equipRequirements`. Committing to one attribute or splitting
   * two both clear it; spreading thin does not.
   */
  reqAttributes?: Partial<Attributes>;
}

export interface ItemStack {
  itemId: string;
  qty: number;
}

export type SkillEffectKind = 'damage' | 'heal' | 'dot' | 'buff' | 'interrupt';

/**
 * A condition that makes a skill worth *timing* rather than worth pressing.
 *
 * Bosses ask questions and every creature now has a trait, but the player's
 * side of twenty-eight thousand fights was "press whatever is off cooldown".
 * Cooldowns alone produce an order, not a decision: there was never a moment
 * where holding a button was better than pressing it.
 *
 * The rule is the one the boss kits and the creature traits already run under:
 * **each has to have a different answer.** Two conditions that both mean "use
 * it later" are one condition with two names.
 *
 * | Kind | Live when | The decision |
 * |---|---|---|
 * | `finisher` | the target is nearly dead | hold it for the kill |
 * | `opener` | the target is not fighting you yet | open with it, or lose it |
 * | `steady` | *you* are barely scratched | keep out of reach and it stays yours |
 * | `onDot` | the target carries a burn of yours | land the dot first |
 * | `desperate` | *you* are nearly dead | do not top yourself off |
 */
/**
 * Conditions come in two sorts, and only one of them is worth *waiting* for.
 *
 * `finisher`, `opener` and `onDot` are facts about the **target**, so a player
 * chooses when to spend the skill against them: that is a decision, and the
 * balance harness models it with `timeSkills`.
 *
 * `desperate` and `steady` are facts about **you**. Holding a heal until you
 * are nearly dead is not good play, it is worse play — the suite measured a
 * Priest ending fights on *less* health for doing it. They are a reward for
 * playing well earlier in the fight (not panicking; not getting hit), not a
 * button to sit on, and nothing should ever be held for them.
 */
export const HOLDABLE_CONDITIONS = ['finisher', 'opener', 'onDot'] as const;

export type SkillCondition =
  | { kind: 'finisher'; below: number; multiplier: number }
  | { kind: 'opener'; multiplier: number }
  | { kind: 'steady'; above: number; multiplier: number }
  | { kind: 'onDot'; dotId: string; multiplier: number }
  | { kind: 'desperate'; below: number; multiplier: number };

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
  /**
   * The attribute this skill draws on.
   *
   * What turns "which attribute" into a build rather than a formality: a Rogue
   * has skills on Dexterity *and* on Strength, so the points they spend decide
   * which half of their bar is worth pressing. Casters name Focus throughout —
   * a Druid is a Druid — and their choice is how much of it they trade for
   * Vitality.
   *
   * Undefined means the skill does not scale at all. An interrupt is an
   * interrupt at any Strength, and pretending otherwise would make one
   * attribute quietly better at everything.
   */
  scalesWith?: keyof Attributes;
  /**
   * What makes this one worth timing. See `SkillCondition`.
   *
   * One per class, on the skill whose *name* already promises it — a skill
   * called Assassinate that is worth no more on an unaware target than on one
   * already swinging at you is a skill with a lie for a name.
   */
  when?: SkillCondition;
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

/**
 * What a boss can do to you, and — the part that matters — what you do back.
 *
 * Every kind here exists because it has a *different answer*. A boss whose
 * whole kit is answered the same way is a boss with one mechanic and several
 * names for it, which is what six of the eight had before these were added.
 *
 * | Kind | The answer |
 * |---|---|
 * | `heavySlam` | Get out of the circle. Distance is safety. |
 * | `cleave` | Get out of the *arc*. Backing away does not help. |
 * | `fixate` | Keep moving. The circle lands where you were standing. |
 * | `hazard` | Move out, and stay out — this one does not end when it lands. |
 * | `mend` / `summon` | Interrupt it. |
 * | `enrage` | Nothing. It is the timer telling you to finish. |
 */
export type MobAbilityKind =
  /** Wind-up AoE centred on the caster. Escape the radius before it lands. */
  | 'heavySlam'
  /**
   * Wind-up cone in front of the caster, aimed when the cast begins.
   *
   * Deliberately long and narrow where a slam is short and round: running
   * *away* from a cleave keeps you in it, and the answer is to go round the
   * side. Two abilities that both say "move" but disagree about which way are
   * two mechanics; two that both say "move back" are one.
   */
  | 'cleave'
  /**
   * Marks where the target is standing, then lands there.
   *
   * The exact inverse of a slam: a slam punishes being near the boss, this
   * punishes standing still. Together they mean a fight has no safe spot to
   * park in, which is the whole reason to have both.
   */
  | 'fixate'
  /**
   * Leaves a patch of ground that keeps hurting after it lands.
   *
   * The only ability whose consequence outlives its cast. It is what turns an
   * arena from a circle you dodge inside into a space that gets smaller.
   */
  | 'hazard'
  /** One-shot self-buff below a health threshold. */
  | 'enrage'
  /** Calls in adds that despawn when the summoner resets or dies. */
  | 'summon'
  /** Instant heal on the caster; punishes slow damage. */
  | 'mend';

/**
 * What to do about each kind, in words.
 *
 * A `Record` over the union on purpose: adding a kind without deciding what
 * the player is supposed to do about it stops compiling, which is the rule
 * "it must have a different answer" enforced by the type system rather than by
 * somebody remembering. These are the words shown on the target frame once a
 * boss has actually used the thing on you — see `World.noteAbilitySeen`.
 */
export const ABILITY_ANSWERS: Record<MobAbilityKind, string> = {
  heavySlam: 'Get out of the circle.',
  cleave: 'Go round the side — backing away keeps you in it.',
  fixate: 'Keep moving. It lands where you were standing.',
  hazard: 'Move out, and stay out.',
  enrage: 'Nothing. It is the clock telling you to finish.',
  summon: 'Interrupt it.',
  mend: 'Interrupt it.',
};

export interface MobAbilityDef {
  id: string;
  name: string;
  kind: MobAbilityKind;
  cooldownMs: number;
  /** Telegraph window. 0 is instant and undodgeable — use sparingly. */
  castMs: number;
  /** heavySlam / cleave / fixate / hazard: damage radius in world units. */
  radius?: number;
  /** cleave: total width of the arc, in degrees. */
  arcDegrees?: number;
  /** hazard: how long the patch lingers after it lands, and how often it bites. */
  hazardMs?: number;
  hazardTickMs?: number;
  /** hazard: multiplier on the mob's damage, per tick. Much lower than a slam. */
  hazardMultiplier?: number;
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

/**
 * What the world did while nobody was looking.
 *
 * `World.catchUp` runs the elapsed hours and hands this back instead of the
 * event stream: net changes only, because a fortnight of drift is hundreds of
 * events and a log opening with forty lines of "the wyrm is moving" has buried
 * the one line that mattered.
 */
export interface AwayReport {
  /** How much time was actually simulated, after the cap. */
  awayMs: number;
  /** The cap, if the absence hit it. Null when the whole span was run. */
  cappedAt: number | null;
  /** Ground that ended up in different hands than you left it in. */
  fronts: Array<{ holdingId: string; name: string; from: FactionId; to: FactionId }>;
  /** Any dragon that is out on a holding right now, as you walk back in. */
  dragons: Array<{
    dragonId: string;
    name: string;
    zoneId: string;
    holdingId: string;
    holdingName: string;
  }>;
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
   * Set on a star variant: the ordinary creature it is a rating of.
   *
   * A camp spawns the same animal at ★1 to ★4 — a runt, four ordinary ones, a
   * scarred one, occasionally something much bigger. Everything else that cares
   * about "which creature is this" wants the base rather than the rating, so
   * quests, trophies and loot all resolve through this.
   */
  starOf?: string;
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
  /** Mount id this creature can be captured as. Wild horses only. */
  horse?: string;
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
  /** buff: health restored per tick, from a salve. */
  regenPerTick?: number;
  /** buff: multiplier on outgoing weapon damage while active. */
  damageMultiplier?: number;
  /** buff: units a second on top of your movement, from a blessing. */
  moveSpeedBonus?: number;
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
  /**
   * `npc` is another adventurer: seen, never interacted with. They are their
   * own kind rather than a flag on `player` so that nothing which loops over
   * players, mobs or vendors picks them up by accident — they must never take
   * a kill, a drop or a quest counter from the actual player.
   */
  kind: 'player' | 'mob' | 'vendor' | 'npc';
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
  /** Skill points banked, one per level, spent on ranking a skill up. */
  skillPoints?: number;
  /** Rank per skill id. Absent means rank 0 — the skill as it was taught. */
  skillRanks?: Record<string, number>;
  inventory?: ItemStack[];
  equipment?: Partial<Record<EquipSlot, string>>;
  skillCooldowns?: Record<string, number>;
  /**
   * Milliseconds left on each consumable family's cooldown.
   *
   * Per family rather than per item, so a bag full of different potions is
   * still one potion every eighteen seconds.
   */
  consumableCooldowns?: Partial<Record<'potion' | 'elixir', number>>;
  /** Skills learned from a tome. Level-granted skills are not listed here. */
  learnedSkills?: string[];
  /** What each faction makes of you. See `content/factions.ts`. */
  standing?: Partial<Record<FactionId, number>>;
  /**
   * Experience owed for dying. Kills pay it down; it is never subtracted from
   * a level you already have. See `deathDebt` in `sim/formulas.ts`.
   */
  xpDebt?: number;
  /** Where you fell, and in which zone. Walk back to it to clear the rest. */
  deathSpot?: { zoneId: string; pos: Vec2 } | null;
  /** Mounts captured, by id. Yours for good once you have one. */
  stable?: string[];
  /** The mount currently being ridden, or null. */
  mounted?: string | null;

  // --- other adventurers ---------------------------------------------------
  /** Where this one is headed, and how long until it gets bored of it. */
  npcGoal?: Vec2;
  npcUntilMs?: number;
  /** Fake health, so their fights read as fights without touching the world. */
  npcBusy?: boolean;
  /** Accepted quests and their per-objective counters. */
  quests?: QuestProgress[];
  /** Ids of quests already turned in; a quest is never repeatable. */
  questsDone?: string[];
  /**
   * What this character has done, kept per creature.
   *
   * A game whose whole design is "twenty-eight thousand kills" kept no record
   * of a single one of them. The grind is the game here, and a grind you
   * cannot see is a grind that feels like nothing is happening — this is what
   * makes the number the design is proud of visible to the person doing it.
   *
   * Keyed on the *base* creature, so a Gaunt Bog Wolf, a Snarling one and
   * `Mirefang the Bog Wolf` all count as Bog Wolves. That is the same
   * unwrapping quests use, and for the same reason: a player thinks in
   * creatures, not in ratings.
   */
  slain?: Record<string, number>;
  /** Named rares put down, by mob id. Each is a once-in-an-hour creature. */
  namedSlain?: string[];
  /** Deaths, and the worst single hit taken and dealt. */
  record?: { deaths: number; biggestHit: number; worstTaken: number };
  /**
   * Boss abilities that have been aimed at you at least once.
   *
   * Player knowledge, like `namedSlain` and `found`: it saves, it catches up,
   * and it is what the target frame reads to tell you what the thing in front
   * of you is going to do. See `World.noteAbilitySeen`.
   */
  seenAbilities?: string[];
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
  /**
   * This creature's spawn point never rolls a variant. See `SpawnPoint.plain`.
   *
   * Carried on the entity rather than looked up, because the respawn timer
   * re-rolls from the entity and has no way back to the point that made it.
   */
  plainSpawn?: boolean;
  /**
   * A skittish creature has already broken once this life. See
   * `content/traits.ts` — it runs once, because one that bolts every time it
   * dips below the line is one you can never finish.
   */
  fled?: boolean;
  /** Milliseconds left of running away. */
  fleeingMs?: number;
  /**
   * Packmates within reach, counted once a tick by `tickPacks`.
   *
   * Stored rather than derived because `statsOf` reads it and `statsOf` runs
   * many times per entity per tick — counting in there was a quarter of a
   * million distance checks a tick with six hundred creatures in a zone.
   */
  packAllies?: number;
  /**
   * This creature stepped up when its ground was farmed. See
   * `content/muster.ts` — it is a rating higher for as long as it lasts, and
   * it can never rouse a second time.
   */
  roused?: boolean;
  /** Milliseconds left of being roused, if you walk away rather than fight. */
  rousedMs?: number;
  /**
   * The creature an adventurer is currently fighting, and how long they will
   * stay on it. See `content/adventurers.ts` — they cannot ever finish one.
   */
  npcFoe?: EntityId;
  npcFightMs?: number;
  /** Set on the entity a dragon is currently being represented by. */
  dragonId?: string;
  aiState?: 'idle' | 'chasing' | 'attacking' | 'returning' | 'dead';
  /**
   * Where an idle creature is ambling to, null while it is standing about.
   *
   * Deliberately **not** drawn from `World.rng`: the destination is hashed from
   * the entity's id and how many times it has wandered, so a camp full of
   * animals milling around cannot shift a single number in a seeded fight. The
   * alternative — a `roaming: false` flag on every test arena, the way
   * `rareSpawns` and `adventurers` work — would have been a fourth switch to
   * forget, and this way there is nothing to forget.
   */
  roamGoal?: Vec2 | null;
  /** Milliseconds left standing still before choosing somewhere new. */
  roamWaitMs?: number;
  /** How many times it has wandered; the second half of the hash. */
  roamStep?: number;
  threat?: Record<EntityId, number>;
  abilityCooldowns?: Record<string, number>;
  /** Abilities locked out by a player interrupt, keyed to remaining ms. */
  abilityLockouts?: Record<string, number>;
  /** Health-threshold abilities that have already fired this life. */
  firedAbilities?: string[];
  /**
   * Where a ground-targeted ability is aimed, stamped when its cast began.
   *
   * A `fixate` or a `hazard` marks the spot the target was standing on and
   * lands *there*, not wherever they have got to by the time it resolves.
   * Landing it on the current position would make the telegraph decorative,
   * and a telegraph you cannot beat is the one thing this game says a boss
   * must never have.
   */
  castAt?: Vec2 | null;
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
  /** Open the landmark you are standing at. See `content/discoveries.ts`. */
  | { t: 'search' }
  | { t: 'equip'; itemId: string }
  /** Drink a potion or an elixir out of the bags. */
  | { t: 'use'; itemId: string }
  /** Spend a skill point to rank a skill up. */
  | { t: 'rankSkill'; skillId: string }
  | { t: 'learnSkill'; itemId: string }
  /** Try to take a weakened wild horse. */
  | { t: 'capture'; id: EntityId }
  /** Get on or off a horse you already own. */
  | { t: 'mount'; mountId: string | null }
  | { t: 'unequip'; slot: EquipSlot }
  | { t: 'spendPoint'; attr: keyof Attributes }
  | { t: 'sell'; vendorId: EntityId; itemId: string; qty: number }
  | { t: 'buy'; vendorId: EntityId; itemId: string }
  | { t: 'acceptQuest'; vendorId: EntityId; questId: string }
  | { t: 'turnInQuest'; vendorId: EntityId; questId: string }
  | { t: 'abandonQuest'; questId: string }
  | { t: 'travel'; toZoneId: string }
  /** Stand where you fell and take back what dying cost you. */
  | { t: 'reclaim' }
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
  /** A skittish creature broke and ran. See `content/traits.ts`. */
  | { t: 'flees'; mobId: EntityId; name: string }
  /** A camp noticed it was being farmed. See `content/muster.ts`. */
  | { t: 'muster'; name: string; count: number; at: Vec2 }
  /** A skill went off with its condition live. See `SkillCondition`. */
  | { t: 'wellTimed'; sourceId: EntityId; skillId: string }
  /** A landmark opened. Once per site, ever. See `content/discoveries.ts`. */
  | {
      t: 'discovered';
      entityId: EntityId;
      siteId: string;
      name: string;
      kind: 'boon' | 'cache';
      line: string;
      gold: number;
    }
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
      /**
       * What to draw. A circle sits on the caster unless `at` says otherwise;
       * a cone is drawn from the caster along `facing`.
       */
      shape?: 'circle' | 'cone';
      /** Where the danger is, when it is not on the caster. */
      at?: Vec2;
      /** cone: the direction it is aimed, fixed when the cast began. */
      facing?: number;
      /** cone: total width of the arc, in radians. */
      arc?: number;
    }
  /** A patch of dangerous ground appeared, or expired. */
  | { t: 'hazard'; id: number; sourceId: EntityId; at: Vec2; radius: number; durationMs: number }
  | { t: 'hazardGone'; id: number }
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
  /**
   * Dying opened a debt, or a kill paid some of it off, or you walked back and
   * cleared the rest. `remaining` is what is still owed either way.
   */
  | { t: 'debt'; entityId: EntityId; kind: 'incurred' | 'repaid' | 'reclaimed'; amount: number; remaining: number }
  | { t: 'levelUp'; entityId: EntityId; level: number }
  /** A skill went up a rank. */
  | { t: 'skillRanked'; entityId: EntityId; skillId: string; rank: number }
  /** A potion or elixir went down. */
  | { t: 'consumed'; entityId: EntityId; itemId: string; healed: number }
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
  /** Another adventurer said something. Chat, in a game with no chat. */
  | { t: 'chat'; entityId: EntityId; name: string; classId: ClassId; text: string }
  /** A capture attempt: `mountId` is null when the horse threw you off. */
  | { t: 'captured'; entityId: EntityId; mountId: string | null; name: string }
  /** Got on or off, including being thrown by a heavy hit. */
  | { t: 'mounted'; entityId: EntityId; mountId: string | null; unseated: boolean }
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
