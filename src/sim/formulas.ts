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

/** Attribute points granted per level up. */
export const POINTS_PER_LEVEL = 3;

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
  2: { health: 1.45, damage: 1.15, defense: 1.12 },
  3: { health: 2.1, damage: 1.32, defense: 1.26 },
  4: { health: 3.1, damage: 1.52, defense: 1.42 },
  5: { health: 9.0, damage: 1.85, defense: 1.6 },
  6: { health: 15.0, damage: 2.15, defense: 1.75 },
};

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
  if (diff >= 3) mult = 1.4;
  else if (diff >= 0) mult = 1 + diff * 0.13;
  else if (diff >= -4) mult = 1 + diff * 0.18;
  else mult = 0.05;
  return Math.max(1, Math.round(mobXp * Math.max(0.05, mult)));
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
  weapon: {
    damageMin: number;
    damageMax: number;
    damageType: DamageType;
    swingMs: number;
    attackRange: number;
  };
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
  // Dexterity shaves up to ~25% off swing time, with diminishing returns.
  const hasteFactor = 1 - (a.dexterity * 0.008) / (1 + a.dexterity * 0.008);
  return {
    maxHealth: Math.round(60 + a.vitality * 8 + level * 12),
    maxEnergy: Math.round(30 + a.focus * 5 + level * 3),
    attack: Math.round(10 + a[input.primaryAttribute] * 2 + level * 3),
    defense: Math.round(a.vitality * 1.5 + armor + level * 2),
    critChance: Math.min(0.5, 0.03 + a.dexterity * 0.0025),
    swingMs: Math.max(600, Math.round(weapon.swingMs * Math.max(0.75, hasteFactor))),
    damageMin: weapon.damageMin,
    damageMax: weapon.damageMax,
    damageType: weapon.damageType,
    attackRange: weapon.attackRange,
    moveSpeed: 5.2,
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
  return {
    maxHealth: Math.round(def.baseHealth * star.health),
    maxEnergy: 100,
    attack: Math.round(10 + def.attributes.strength * 2 + def.level * 3),
    defense: Math.round((def.attributes.vitality * 1.5 + def.level * 2) * star.defense),
    critChance: Math.min(0.3, 0.02 + def.attributes.dexterity * 0.002),
    swingMs: def.swingMs,
    damageMin: def.damageMin * star.damage,
    damageMax: def.damageMax * star.damage,
    damageType: def.damageType,
    attackRange: def.attackRange,
    moveSpeed: def.moveSpeed,
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

  const crit = rng.chance(attacker.critChance);
  if (crit) raw *= CRIT_MULTIPLIER;

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
  acc: { attributes: Attributes; armor: number },
  item: ItemDef,
): void {
  if (item.attributes) acc.attributes = addAttributes(acc.attributes, item.attributes);
  acc.armor += item.armor ?? 0;
}

export function dist(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}
