/**
 * All balance math lives here, isolated and pure, so `test/balance.test.ts` can
 * hammer it without standing up a World. If a number feels wrong in play, this
 * is the only file that should need editing.
 */
import type {
  Attributes,
  ClassId,
  DamageType,
  DerivedStats,
  ItemDef,
  MobDef,
  StarRating,
} from './types.js';
import { BOSS_STARS } from './types.js';
import type { Rng } from './rng.js';

export const TICK_MS = 50;
export const TICKS_PER_SECOND = 1000 / TICK_MS;

/**
 * Global cooldown: using any skill locks every other skill briefly.
 *
 * Without this, the optimal opener is "press everything on the same frame",
 * which collapses every fight into a single burst and makes skill choice
 * meaningless. Every tab-target game has one for this reason.
 */
export const GCD_MS = 1500;

/** Attribute points granted per level up, spent on Strength/Dexterity/Focus/Vitality. */
export const POINTS_PER_LEVEL = 5;

/**
 * Skill points granted per level up.
 *
 * A second, much scarcer currency, and the scarcity is the design. Attribute
 * points are the dial you turn every level without thinking; you get a hundred
 * of them and they all go the same place. A skill point is one per level for
 * the whole game, so ranking a skill to the cap costs a tenth of everything you
 * will ever earn — which makes "which of my sixteen skills is my best one" a
 * question with an answer you have to live with.
 */
export const SKILL_POINTS_PER_LEVEL = 1;

/** How far a single skill can be ranked up. */
export const MAX_SKILL_RANK = 10;

/**
 * What each rank adds to a skill's damage or healing.
 *
 * Ten ranks is +65% on the number, and about double once the crit rate below
 * is folded in — measured, and printed by `sim.test.ts`. That is worth roughly
 * a gear tier and a half on one skill: enough that specialising is a real
 * choice, not enough that a maxed skill makes the other fifteen decoration.
 */
export const SKILL_RANK_POWER = 0.065;

/**
 * What each rank adds to a skill's chance of landing double.
 *
 * A skill can crit for twice its damage or healing, the same way a swing can.
 * At rank 0 that is your ordinary crit chance; at rank 10 it is that plus a
 * fifth — noticeably more often, still never routine. A rank you can feel
 * without being able to rely on is the one that stays exciting.
 */
export const SKILL_RANK_CRIT = 0.02;

/** Damage or healing multiplier for a skill at a given rank. */
export function skillRankPower(rank: number): number {
  return 1 + Math.min(MAX_SKILL_RANK, Math.max(0, rank)) * SKILL_RANK_POWER;
}

/** Crit chance for a skill, from the character's own chance and the skill's rank. */
export function skillCritChance(base: number, rank: number): number {
  return Math.min(0.75, base + Math.min(MAX_SKILL_RANK, Math.max(0, rank)) * SKILL_RANK_CRIT);
}

/** What a skill crit multiplies by. Same as a weapon crit: it lands double. */
export const SKILL_CRIT_MULTIPLIER = 2;

/**
 * Level cap for the current content release.
 *
 * Four zones cover it, and their bands deliberately OVERLAP so you are never
 * forced out of a zone the moment you outgrow one camp — you choose whether to
 * finish the old zone or push into the new one:
 *
 *   The Fenmarch      1–25
 *   Ardmoor           20–40
 *   The Sunken Wood   40–70
 *   Caer Dubh         70–100
 *
 * Never raise this above what the zones actually cover; a cap beyond the
 * content just strands players with nothing level-appropriate to fight.
 */
export const MAX_LEVEL = 100;

// --------------------------------------------------------------------------
// The grind dials.
//
// This game is deliberately grind-heavy: kills-per-level should be high and
// should keep climbing all the way to the cap. That happens because the xp
// requirement grows superlinearly (exponent > 1) while a level-appropriate
// mob's xp reward grows roughly linearly with its level.
//
// To make the whole game shorter or longer, change XP_CURVE_BASE.
// To change how *steeply* the grind ramps, change XP_CURVE_EXPONENT.
// `test/balance.test.ts` prints the resulting kills-per-level table.
//
// The exponent was eased from 2.15 to 1.92 when the cap moved from 25 to 100.
// At 2.15 the curve was fine to 25 but demanded ~1,800 kills for a single level
// in the nineties, which is not a grind, it is a wall. 1.92 keeps kills-per-
// level climbing the whole way while landing the last levels in the hundreds.
// --------------------------------------------------------------------------

export const XP_CURVE_BASE = 48;
export const XP_CURVE_EXPONENT = 1.92;

/** XP required to go from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  return Math.round(XP_CURVE_BASE * Math.pow(level, XP_CURVE_EXPONENT));
}

/** Total XP required to reach `level` from level 1. */
export function xpTotalForLevel(level: number): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += xpToNext(l);
  return total;
}

/**
 * How much a mob's star rating multiplies its combat stats.
 *
 * This is the lever that lets level scaling stay gentle (so encounters have a
 * "close fight" band rather than flipping from impossible to trivial in a few
 * levels) while a ★4 still meaningfully outclasses a ★1 of the same level.
 */
export const STAR_MODIFIERS: Record<StarRating, { health: number; damage: number; defense: number }> = {
  1: { health: 1.0, damage: 1.0, defense: 1.0 },
  2: { health: 1.4, damage: 1.08, defense: 1.12 },
  3: { health: 1.85, damage: 1.18, defense: 1.26 },
  // Compressed hard at the top rather than stretched. Once every creature in
  // the world hits enough to kill you, a ★4 does not also need half again as
  // much of it — that measured as two thirds of fights lost, which is not "play
  // this one well", it is "do not pull this one". What separates the ratings
  // now is mostly how long the thing stays up while it does it.
  4: { health: 2.3, damage: 1.3, defense: 1.42 },
  // Bosses are exempt from the ordinary-creature dials, which means they are
  // the one thing in the game that does NOT move when the world is re-tuned —
  // so when attribute points per level went from three to five, every boss
  // quietly became a formality. Both numbers carry that third back.
  5: { health: 12.5, damage: 2.5, defense: 1.6 },
  6: { health: 21.0, damage: 2.85, defense: 1.75 },
};

/**
 * How hard an ordinary creature hits, over the curve fitted to the Fenmarch.
 *
 * The Fenmarch bestiary was hand-tuned to be *survivable*, and the balance
 * suite duly reported that a level-appropriate fight cost between five and
 * twenty percent of your health. That is not a fight, it is a toll: nothing in
 * the world could kill a player who was paying attention, so no gear decision,
 * no cooldown and no consumable mattered.
 *
 * Re-cut twice as the player got stronger, and both times because a
 * measurement said so rather than because anyone reasoned about it. Attribute
 * points per level went from three to five; then the harness started spending
 * skill points the way a player actually does, which is worth another half a
 * gear tier on every skill they cast. Each time, the whole world quietly went
 * back to being scenery, and each time the printed lethality table said so on
 * the next run.
 *
 * This is the dial that fixes it. A ★1 at your level is now a real fight you
 * can lose to a bad streak; a ★4 will kill you unless you use everything you
 * have. `balance.test.ts` asserts both as *death rates*, which is the only
 * honest way to measure "can this kill me".
 *
 * Applied in `deriveMobStats` rather than in `curveMobDamage`, and that is not
 * a detail: the twelve Fenmarch creatures are hand-authored and never read the
 * curve, so scaling the curve made every zone dangerous except the one every
 * player learns the game in. The measurement said so — ★1 sat at 79% health
 * left through three rounds of raising a number that could not reach it.
 *
 * Ordinary creatures only. Bosses were already the one thing in the game that
 * could kill you, and they are tuned fight by fight against printed win rates;
 * multiplying them by this as well made every dragon unbeatable at any level.
 * The first attempt compensated by cutting the ★5 and ★6 damage multipliers
 * below ★4's, which quietly broke the one thing the star ladder promises — that
 * more stars is strictly worse news.
 */
export const MOB_DAMAGE_SCALE = 4.4;

/**
 * How much longer an ordinary creature lives than the Fenmarch fit gave it.
 *
 * Damage alone could not make a fight dangerous, and the measurement is what
 * showed why: an even fight was over in three seconds, so a mob got one or two
 * swings in however hard it hit. Danger needs an exchange, and an exchange
 * needs the thing to still be standing. Bosses are exempt — they already have
 * a ★5/★6 health multiplier doing this job.
 */
export const MOB_HEALTH_SCALE = 2.6;

/**
 * The level by which an ordinary creature is as dangerous as it is going to get.
 *
 * Both dials phase in rather than landing at level 1, for the same reason
 * mitigation and defensive buffs already scale by level: the player's health,
 * armour and kit all climb steeply out of nothing, so a flat multiplier bites
 * hardest exactly where they have least to answer it with. Measured, not
 * guessed — at full strength from level 1, the suite reported a clean band
 * either side and a trough at 8-11 where a Bog Wolf beat four classes out of
 * five and a Moor Stag beat all of them.
 *
 * By the time a player has the level-granted kit, the world is at full
 * strength and stays there for ninety levels.
 */
const DANGER_FROM = 12;

/** Share of the ordinary-creature dials in effect at level 1. */
const DANGER_AT_ONE = 0.52;

/** How much of `MOB_DAMAGE_SCALE` and `MOB_HEALTH_SCALE` applies at a level. */
export function dangerRamp(level: number): number {
  const t = Math.max(0, Math.min(1, (level - 1) / (DANGER_FROM - 1)));
  return DANGER_AT_ONE + (1 - DANGER_AT_ONE) * t;
}

/**
 * Undo the ordinary-creature dials for one stat block.
 *
 * For a boss's summoned adds. An add is a creature of the world by definition —
 * Cadfael whistles up two Outlaw Bowmen, and an Outlaw Bowman in a camp is
 * meant to be able to kill you. But a boss fight is tuned as a *unit* against a
 * printed win rate, and scaling its adds scaled the fight: Cadfael went from
 * "36% standing in it, 100% dodging" to "0% and 15%" without a single number on
 * Cadfael changing. The boss is the encounter; its adds are part of the boss.
 */
export function unscaleAdd(stats: DerivedStats, level: number): DerivedStats {
  const { bite, bulk } = ordinaryScales(level);
  return {
    ...stats,
    maxHealth: Math.round(stats.maxHealth / bulk),
    damageMin: stats.damageMin / bite,
    damageMax: stats.damageMax / bite,
  };
}

/** Both ordinary-creature dials, at the level they are being applied to. */
function ordinaryScales(level: number): { bite: number; bulk: number } {
  const ramp = dangerRamp(level);
  return {
    bite: 1 + (MOB_DAMAGE_SCALE - 1) * ramp,
    bulk: 1 + (MOB_HEALTH_SCALE - 1) * ramp,
  };
}

/**
 * Gold multiplier per star.
 *
 * Harder mobs pay better. Gold is the *reliable* reward — it scales hard and
 * drops every kill — which is what lets equipment drops stay genuinely rare
 * without the grind feeling unrewarding. Vendor trash works the same way.
 */
export const STAR_GOLD_MULTIPLIER: Record<StarRating, number> = {
  1: 1.0,
  2: 1.6,
  3: 2.6,
  4: 4.2,
  5: 26,
  6: 55,
};

/**
 * Gold dropped by a mob of the given level and stars.
 *
 * Derived rather than hand-set per table so a new mob can never accidentally
 * pay less than something easier. `goldMultiplier` on a loot table is the
 * deliberate override.
 */
export function goldForKill(
  level: number,
  stars: StarRating,
  multiplier = 1,
): { min: number; max: number } {
  const base = (2 + level * 1.9) * STAR_GOLD_MULTIPLIER[stars] * multiplier;
  return { min: Math.max(1, Math.round(base * 0.7)), max: Math.max(2, Math.round(base * 1.35)) };
}

/**
 * Ceiling on how often a mob may drop *any* equipment.
 *
 * The design rule is "harder mobs drop better things, not more things". Gear
 * stays rare at every tier; what improves with difficulty is the quality of
 * what you get and the gold alongside it. `balance.test.ts` enforces this.
 */
export const MAX_EQUIPMENT_DROP_CHANCE = 0.3;

/**
 * How much likelier a harder creature is to be carrying something.
 *
 * The original rule was "harder mobs drop better things, not more things" —
 * quality climbed with difficulty and the odds did not. That is a clean rule
 * and it was half right: it means a ★4 that takes four times as long and kills
 * a quarter of the players who pull it pays out no more often than the ★1 next
 * to it, which reads as the game not noticing what you just did.
 *
 * So the odds climb too, and `MAX_EQUIPMENT_DROP_CHANCE` still caps the total —
 * a ★4 is roughly twice as likely to be carrying gear as a ★1, and still far
 * more likely to be carrying nothing at all.
 */
export const STAR_LOOT_MULTIPLIER: Record<StarRating, number> = {
  1: 1.0,
  2: 1.3,
  3: 1.6,
  4: 2.0,
  // Bosses and elites hand out guaranteed class weapons and tomes; scaling
  // their table on top of that would just be noise.
  5: 1.0,
  6: 1.0,
};

/** XP multiplier per star. Bosses are worth a real dent in the bar. */
export const STAR_XP_MULTIPLIER: Record<StarRating, number> = {
  1: 1.0,
  2: 1.5,
  3: 2.2,
  4: 3.3,
  5: 14,
  6: 30,
};

/** Base xp for a mob of the given level and stars, before level-gap scaling. */
export function baseMobXp(level: number, stars: StarRating): number {
  return Math.round((5 + level * 3.4) * STAR_XP_MULTIPLIER[stars]);
}

/**
 * XP awarded for a kill, scaled by level gap. Grey mobs give almost nothing so
 * players are pushed forward instead of farming a safe camp forever.
 */
export function xpForKill(mobXp: number, mobLevel: number, playerLevel: number): number {
  const diff = mobLevel - playerLevel;
  let mult: number;
  if (diff >= 0) {
    // Fighting up pays, and keeps paying. Capped, or the optimal play is to
    // find the highest thing you can barely beat and never move again.
    mult = Math.min(1.6, 1 + diff * 0.13);
  } else {
    // And fighting down decays smoothly toward nothing.
    //
    // This used to be a two-piece line with a cliff in it: -4 was worth 28% and
    // -5 was worth 5%, so a camp went from "still worth clearing" to "worthless"
    // between one creature and the next one two metres away. A geometric decay
    // says the same thing — go and find something your own size — without the
    // step, and it keeps falling forever instead of bottoming out.
    mult = Math.pow(0.72, -diff);
  }
  return Math.max(1, Math.round(mobXp * Math.max(0.02, mult)));
}

export function emptyAttributes(): Attributes {
  return { strength: 0, dexterity: 0, focus: 0, vitality: 0 };
}

export function addAttributes(a: Attributes, b: Partial<Attributes>): Attributes {
  return {
    strength: a.strength + (b.strength ?? 0),
    dexterity: a.dexterity + (b.dexterity ?? 0),
    focus: a.focus + (b.focus ?? 0),
    vitality: a.vitality + (b.vitality ?? 0),
  };
}

/**
 * Which attribute drives a class's attack rating.
 *
 * Melee classes scale off Strength, casters off Focus. Keeping this as a
 * mapping rather than branching inside `deriveStats` means the combat maths
 * stays identical for every class — only the input attribute changes — so a
 * Priest and a Warrior are balanced against the same formula.
 */
export const PRIMARY_ATTRIBUTE: Record<ClassId, keyof Attributes> = {
  warrior: 'strength',
  priest: 'focus',
  ranger: 'dexterity',
  rogue: 'dexterity',
  mage: 'focus',
};

export interface DeriveInput {
  level: number;
  attributes: Attributes;
  /** Attribute driving attack rating — see `PRIMARY_ATTRIBUTE`. */
  primaryAttribute: keyof Attributes;
  /** Summed armor from equipped gear. */
  armor: number;
  /** Summed signature affixes. Absent for anyone wearing only ladder gear. */
  affix?: Affixes;
  weapon: {
    damageMin: number;
    damageMax: number;
    damageType: DamageType;
    swingMs: number;
    attackRange: number;
  };
}

/**
 * How fast a character walks, before anything they are riding.
 *
 * Exported because the map is sized against it: a zone is authored to take ten
 * minutes to cross on foot, and that sentence is only checkable if the number
 * lives in one place.
 */
export const BASE_MOVE_SPEED = 5.2;

/**
 * How far an idle creature wanders from where it spawned.
 *
 * A camp used to be eight animals standing on eight marks, which is legible
 * and completely dead: you learn a camp's shape once and every visit after
 * that is the same eight pulls from the same eight angles. Letting them amble
 * costs nothing and changes the fight — the one you wanted is sometimes on the
 * far side, and the pull you thought was clean sometimes is not.
 *
 * It has to stay small for three reasons, and each of them is load-bearing:
 *
 *  - A roaming mob still leashes to its **spawn point**, so anything it
 *    wanders is chase distance it no longer has. Roam radius is capped against
 *    `leashRadius` for that reason.
 *  - Aggro is measured from where a creature *is*, so a camp that wanders is a
 *    camp whose aggro footprint is this much wider. Boss arenas and shopfronts
 *    are cleared against `aggroRadius + ROAM_RADIUS`, and a test enforces it —
 *    otherwise "the camp is far enough away" quietly stops being true.
 *  - Bosses do not roam at all. A telegraph is a flat circle drawn on levelled
 *    ground; a boss that ambled ten metres off its arena would draw one down a
 *    hillside.
 */
export const ROAM_RADIUS = 9;

/** Never wander more than this share of the leash — see above. */
export const ROAM_LEASH_SHARE = 0.4;

/** An amble, not a patrol. A creature that roams at running speed reads as fleeing. */
export const ROAM_SPEED = 0.34;

/** How long a creature stands about between wanders. */
export const ROAM_PAUSE_MIN_MS = 2500;
export const ROAM_PAUSE_MAX_MS = 11000;

/** How far this creature may wander, given what it is allowed to chase. */
export function roamRadiusFor(leashRadius: number): number {
  return Math.min(ROAM_RADIUS, leashRadius * ROAM_LEASH_SHARE);
}

/**
 * What dying costs.
 *
 * Death used to cost the walk back and nothing else, which in a game this
 * lethal makes a bad pull free — and a fight with no downside is a fight with
 * no tension. But the two obvious prices are both worse than no price at all:
 *
 *  - **Losing gear** turns a bad pull into a shopping trip, and punishes the
 *    player hardest at exactly the moment they were already having a bad time.
 *  - **Losing experience** means a run of bad luck can push a character
 *    *backwards*. A level you have already earned should never be revocable —
 *    twenty-eight thousand kills is not something to take away from somebody.
 *
 * So death is priced in the currency the whole game is denominated in, without
 * ever subtracting from it: you take on a **debt**, and kills pay it down out
 * of the same stream that levels you. Progress never reverses; it slows, and
 * then it stops slowing. A player can always see the end of it.
 */
export const DEATH_DEBT_SHARE = 0.35;

/** How much of each kill's experience goes to the debt rather than the bar. */
export const DEBT_REPAY_SHARE = 0.5;

/**
 * Debt never exceeds this many levels' worth.
 *
 * A losing streak against something well above you would otherwise dig a hole
 * that takes longer to climb out of than the level did to earn — which is the
 * "lost a level" failure wearing a different name.
 */
export const DEBT_CAP_LEVELS = 1;

/**
 * Below this level, dying is free.
 *
 * The first ten levels are where a player is learning which fights are
 * survivable. Charging for that lesson teaches caution before the game has
 * taught competence, and the numbers involved are trivial anyway.
 */
export const DEBT_FROM_LEVEL = 10;

/** How close you must get to where you fell to take the rest of it back. */
export const RECLAIM_RANGE = 5;

/** The debt one death at this level opens. */
export function deathDebt(level: number, xpToNextLevel: number): number {
  if (level < DEBT_FROM_LEVEL) return 0;
  return Math.round(xpToNextLevel * DEATH_DEBT_SHARE);
}

/**
 * Turn attributes + gear into the numbers combat actually reads.
 *
 * Deliberately linear and readable. Tuning happens by changing coefficients
 * here and re-running the balance tests, not by scattering magic numbers
 * through the combat resolver.
 */
export function deriveStats(input: DeriveInput): DerivedStats {
  const { level, attributes: a, armor, weapon } = input;
  const affix = input.affix ?? emptyAffixes();
  // Dexterity shaves up to ~25% off swing time, with diminishing returns.
  const hasteFactor = 1 - (a.dexterity * 0.008) / (1 + a.dexterity * 0.008);
  return {
    maxHealth: Math.round(60 + a.vitality * 8 + level * 12 + affix.health),
    maxEnergy: Math.round(30 + a.focus * 5 + level * 3),
    attack: Math.round(10 + a[input.primaryAttribute] * 2 + level * 3),
    defense: Math.round(a.vitality * 1.5 + armor + level * 2),
    // Attributes alone still cap at 0.5; a signature affix can push past it to
    // 0.6. Applying one cap to the sum instead would have quietly RAISED the
    // ceiling for high-Dexterity classes wearing ordinary gear, which the
    // balance suite caught within a run.
    critChance: Math.min(0.6, Math.min(0.5, 0.03 + a.dexterity * 0.0025) + affix.crit),
    swingMs: Math.max(600, Math.round(weapon.swingMs * Math.max(0.75, hasteFactor))),
    damageMin: weapon.damageMin + affix.damage,
    damageMax: weapon.damageMax + affix.damage,
    damageType: weapon.damageType,
    attackRange: weapon.attackRange,
    moveSpeed: BASE_MOVE_SPEED + affix.moveSpeed,
    skillPower: affix.skillPower,
    regenPerSec: affix.regen,
  };
}

// --------------------------------------------------------------------------
// Mob stat curves.
//
// The Fenmarch bestiary (levels 1-25) is hand-tuned and is the REFERENCE. These
// curves are fitted to it, and every mob in the later zones is generated from
// them. That is what keeps three more zones balanced without re-tuning forty
// creatures by hand — and it means a new mob cannot accidentally be a wall or a
// pushover just because someone typed the wrong health.
//
// Both return the ★1-equivalent value; STAR_MODIFIERS is applied on top.
// --------------------------------------------------------------------------

/**
 * Base health for a mob of this level, before star scaling.
 *
 * Linear at its base — that is the fit to the hand-tuned Fenmarch — and then
 * up to 45% more, phased in across Ardmoor's band.
 *
 * The uplift is not padding. Player damage climbs superlinearly (weapon dps
 * curve, attributes, and from Ardmoor on nine zone-taught skills), so flat
 * linear health meant fights got SHORTER the further you got: a level-56
 * character was killing a level-appropriate ★3 in three seconds. That was
 * always true — it only became visible when `test/helpers.ts` started firing
 * skills in a priority a real player would use instead of in list order.
 * Mobs from Ardmoor south fight a far better-armed player than the Fenmarch
 * ever does, and their health says so. Same shape as `mitigation` and
 * `scaledDefenseBonus`, and the Fenmarch is numerically untouched either way:
 * every one of its creatures is hand-authored and none of them read this.
 */
export function curveMobHealth(level: number): number {
  // Ramps in across Ardmoor's band, then holds. It starts at 20 rather than 25
  // because that is where the curve is first USED: the Fenmarch's bestiary is
  // hand-authored with explicit health and never calls this, so an early ramp
  // costs the reference zone nothing and stops the first Ardmoor camps being
  // the one soft spot in the game.
  const lateFactor = 1 + Math.min(0.45, Math.max(0, level - 20) * 0.03);
  return Math.round((68 + level * 13) * lateFactor);
}

/** Average hit for a mob of this level, before star scaling. */
export function curveMobDamage(level: number): number {
  return 2 + level * 1.2 + Math.pow(level, 1.6) * 0.27;
}

/** Base xp is already curved by `baseMobXp`; this is the damage spread. */
export function curveMobDamageRange(level: number): { min: number; max: number } {
  const avg = curveMobDamage(level);
  return { min: Math.round(avg * 0.78), max: Math.round(avg * 1.22) };
}

/** Mob stat block, derived the same way so player and mob math stay symmetric. */
export function deriveMobStats(def: MobDef): DerivedStats {
  const star = STAR_MODIFIERS[def.stars];
  // Bosses are exempt from both ordinary-creature dials: their ★5/★6
  // multipliers already do this job, and they are tuned fight by fight.
  const ordinary = def.stars < BOSS_STARS;
  const scales = ordinaryScales(def.level);
  const bulk = ordinary ? scales.bulk : 1;
  const bite = ordinary ? scales.bite : 1;
  return {
    maxHealth: Math.round(def.baseHealth * star.health * bulk),
    maxEnergy: 100,
    attack: Math.round(10 + def.attributes.strength * 2 + def.level * 3),
    defense: Math.round((def.attributes.vitality * 1.5 + def.level * 2) * star.defense),
    critChance: Math.min(0.3, 0.02 + def.attributes.dexterity * 0.002),
    swingMs: def.swingMs,
    damageMin: def.damageMin * star.damage * bite,
    damageMax: def.damageMax * star.damage * bite,
    damageType: def.damageType,
    attackRange: def.attackRange,
    moveSpeed: def.moveSpeed,
    // Mobs carry no luxury goods. Nothing they do reads either field.
    skillPower: 1,
    regenPerSec: 0,
  };
}

/**
 * Chance for `attack` to land against `defense`, given the level gap.
 *
 * The level term does the heavy lifting on purpose. Stat-only scaling let a
 * low-level player with a good weapon farm content far above them, which
 * flattens the whole progression curve.
 */
export function hitChance(levelDiff: number): number {
  // Accuracy is purely a function of the level gap.
  //
  // It used to carry a small (attack - defense) term as well, which was already
  // a double-dip — `defense` reduces damage through `mitigation()` — and it
  // broke outright once the cap moved to 100. Player defence grows far faster
  // than a mob's attack rating, so by the nineties mobs landed 31% of swings on
  // top of 91% mitigation and endgame fights cost no health at all. Gear
  // belongs in mitigation; level belongs here.
  return Math.min(0.95, Math.max(0.15, 0.9 + levelDiff * 0.04));
}

/**
 * Damage scaling from the level gap, applied before mitigation.
 *
 * Kept gentler than the hit-chance term on purpose: both key off the same level
 * difference, so a steep coefficient here compounds with `hitChance` and turns
 * every encounter into a cliff — unwinnable at N, trivial at N+4, with no
 * interesting band in between.
 */
export function levelDamageModifier(levelDiff: number): number {
  return Math.min(1.5, Math.max(0.25, 1 + levelDiff * 0.04));
}

/**
 * Diminishing-returns mitigation, measured against the threat.
 *
 * The softening constant scales with the ATTACKER's level rather than being
 * fixed at 100. With a fixed constant, armour that felt right at level 25
 * (~28% of damage getting through) reduced a level-90 hit to under 9%, because
 * player defence outgrows any constant across a hundred levels. Scaling the
 * constant keeps a level-appropriate hit landing for a level-appropriate share
 * of your health at every point on the curve.
 *
 * It only starts scaling above level 25, so the hand-tuned Fenmarch band is
 * numerically untouched.
 */
export function mitigation(defense: number, attackerLevel = 1): number {
  const softening = 100 + Math.max(0, attackerLevel - 25) * 5.5;
  return softening / (softening + Math.max(0, defense));
}

/**
 * A defensive buff's effective value at a given level.
 *
 * The listed bonus is flat, which is readable on a tooltip but useless past the
 * band it was written for: "+60 defence" is a third of your total at level 10
 * and a rounding error at level 60, so every class's panic button quietly
 * stopped working halfway through the game. Scaling above 25 keeps the Fenmarch
 * tuning exact while letting the same skill still matter at the cap.
 */
export function scaledDefenseBonus(base: number, level: number): number {
  return base * (1 + Math.max(0, level - 25) * 0.06);
}

/**
 * Roughly the defence a well-geared character of this level carries.
 *
 * Fitted to the gear ladders (level 25 ~260, level 50 ~550, level 95 ~1065) so
 * anything expressed as a RATIO against it stays meaningful at every level
 * instead of drifting the way flat constants do.
 */
export function expectedDefense(level: number): number {
  return Math.max(20, level * 11.5 - 26);
}

/**
 * Chance a single ordinary hit breaks a cast outright.
 *
 * The design: a mob's SPELLS and HEAVY ATTACKS always break your concentration
 * — those are the moments you are meant to plan around. A plain auto-attack
 * only *might*, and how often is a property of the character: armour and
 * levels are what let you finish a cast while being hit. A hit that fails to
 * break the cast still delays it (see CAST_PUSHBACK_MS), so being attacked
 * always costs something.
 */
export function castBreakChance(
  defense: number,
  defenderLevel: number,
  attackerLevel: number,
): number {
  // Defence relative to what this level is expected to have. Out-gearing the
  // content makes you steadier; being under-geared makes you easy to rattle.
  const ratio = Math.min(2.5, Math.max(0.4, defense / expectedDefense(defenderLevel)));
  // A mob well above your level breaks concentration more easily.
  const levelPressure = 1 + Math.max(-0.5, Math.min(0.8, (attackerLevel - defenderLevel) * 0.05));
  return Math.min(0.6, Math.max(0.05, (BASE_CAST_BREAK_CHANCE / ratio) * levelPressure));
}

/** Chance an ordinary hit breaks a cast for a character at exactly par defence. */
export const BASE_CAST_BREAK_CHANCE = 0.35;

export const CRIT_MULTIPLIER = 1.5;

export interface AttackResult {
  hit: boolean;
  crit: boolean;
  amount: number;
}

export interface AttackOptions {
  /** attackerLevel - defenderLevel. */
  levelDiff: number;
  /** The attacker's absolute level, which scales mitigation. */
  attackerLevel: number;
  /** 1 for an auto-attack, otherwise whatever the skill or ability declares. */
  weaponMultiplier: number;
  /** Added pre-mitigation. */
  flatPower: number;
  /** Set for abilities that always connect once their radius check passed. */
  alwaysHits?: boolean;
  /** Overrides the attacker's own crit chance — a ranked-up skill crits more. */
  critChance?: number;
  /** Overrides the crit multiplier. Skills land double. */
  critMultiplier?: number;
}

/** Resolve one attack: hit roll, damage roll, crit, level scaling, mitigation. */
export function resolveAttack(
  rng: Rng,
  attacker: DerivedStats,
  defender: DerivedStats,
  opts: AttackOptions,
): AttackResult {
  if (!opts.alwaysHits && !rng.chance(hitChance(opts.levelDiff))) {
    return { hit: false, crit: false, amount: 0 };
  }
  const roll = rng.range(attacker.damageMin, attacker.damageMax);
  const powerBonus = attacker.attack * 0.35;
  let raw = (roll + powerBonus) * opts.weaponMultiplier + opts.flatPower;
  raw *= levelDamageModifier(opts.levelDiff);

  // A skill passes its own chance and multiplier in: ranking a skill up makes
  // that skill crit more often, which is a property of the skill and not of the
  // character swinging.
  const crit = rng.chance(opts.critChance ?? attacker.critChance);
  if (crit) raw *= opts.critMultiplier ?? CRIT_MULTIPLIER;

  const amount = Math.max(1, Math.round(raw * mitigation(defender.defense, opts.attackerLevel)));
  return { hit: true, crit, amount };
}

/** Threat generated by dealing `amount` damage. Tuned for future tank roles. */
export function threatFromDamage(amount: number): number {
  return amount;
}

/** Out-of-combat regeneration per second. */
export function healthRegenPerSec(stats: DerivedStats, inCombat: boolean): number {
  return stats.maxHealth * (inCombat ? 0.005 : 0.04);
}

export function energyRegenPerSec(stats: DerivedStats, inCombat: boolean): number {
  return stats.maxEnergy * (inCombat ? 0.03 : 0.09);
}

/** Fold an equipped item's contribution into an accumulating stat bundle. */
export function applyItem(
  acc: { attributes: Attributes; armor: number; affix: Affixes },
  item: ItemDef,
): void {
  if (item.attributes) acc.attributes = addAttributes(acc.attributes, item.attributes);
  acc.armor += item.armor ?? 0;
  acc.affix.crit += item.critBonus ?? 0;
  acc.affix.health += item.healthBonus ?? 0;
  acc.affix.moveSpeed += item.moveSpeedBonus ?? 0;
  acc.affix.damage += item.damageBonus ?? 0;
  // Grimoires multiply rather than add: two of them should compound the way
  // two damage buffs do, not stack into a flat doubling.
  acc.affix.skillPower *= item.skillPower ?? 1;
  acc.affix.regen += item.regenBonus ?? 0;
}

/** Signature affixes summed across equipped gear. Ladder items contribute 0. */
export interface Affixes {
  crit: number;
  health: number;
  moveSpeed: number;
  /** Flat damage from an offhand blade. */
  damage: number;
  /** Multiplicative skill power from a grimoire. */
  skillPower: number;
  /** Flat health per second from an amulet or bracelet. */
  regen: number;
}

export function emptyAffixes(): Affixes {
  return { crit: 0, health: 0, moveSpeed: 0, damage: 0, skillPower: 1, regen: 0 };
}

export function dist(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}
