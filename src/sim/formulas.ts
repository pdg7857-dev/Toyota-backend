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
 * Level cap for the current content release. The Fenmarch is built for 1–25;
 * raise this when a second zone lands, not before — a cap above the content
 * just leaves players stranded with nothing level-appropriate to fight.
 */
export const MAX_LEVEL = 25;

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
// --------------------------------------------------------------------------

export const XP_CURVE_BASE = 48;
export const XP_CURVE_EXPONENT = 2.15;

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
export function hitChance(attack: number, defense: number, levelDiff: number): number {
  // The stat term is deliberately weak. `defense` already reduces damage via
  // `mitigation()`, so letting it also drive avoidance makes armour double-dip:
  // by level 25 a fully geared player had ~280 defence against a mob attack
  // rating of ~140, which pushed incoming hit chance under 60% on top of 74%
  // mitigation. Level gap is meant to be the dominant term here, not gear.
  const raw = 0.9 + (attack - defense) * 0.0006 + levelDiff * 0.04;
  return Math.min(0.95, Math.max(0.15, raw));
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

/** Diminishing-returns mitigation: 100 defense halves incoming damage. */
export function mitigation(defense: number): number {
  return 100 / (100 + Math.max(0, defense));
}

export const CRIT_MULTIPLIER = 1.5;

export interface AttackResult {
  hit: boolean;
  crit: boolean;
  amount: number;
}

export interface AttackOptions {
  /** attackerLevel - defenderLevel. */
  levelDiff: number;
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
  if (!opts.alwaysHits && !rng.chance(hitChance(attacker.attack, defender.defense, opts.levelDiff))) {
    return { hit: false, crit: false, amount: 0 };
  }
  const roll = rng.range(attacker.damageMin, attacker.damageMax);
  const powerBonus = attacker.attack * 0.35;
  let raw = (roll + powerBonus) * opts.weaponMultiplier + opts.flatPower;
  raw *= levelDamageModifier(opts.levelDiff);

  const crit = rng.chance(attacker.critChance);
  if (crit) raw *= CRIT_MULTIPLIER;

  const amount = Math.max(1, Math.round(raw * mitigation(defender.defense)));
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
