/**
 * All balance math lives here, isolated and pure, so `test/balance.test.ts` can
 * hammer it without standing up a World. If a number feels wrong in play, this
 * is the only file that should need editing.
 */
import type { Attributes, DamageType, DerivedStats, ItemDef, MobDef } from './types.js';
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

export const MAX_LEVEL = 40;

/** XP required to go from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  return Math.round(80 * Math.pow(level, 1.65));
}

/** Total XP required to reach `level` from level 1. */
export function xpTotalForLevel(level: number): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += xpToNext(l);
  return total;
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

export interface DeriveInput {
  level: number;
  attributes: Attributes;
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
  const hasteFactor = 1 - (a.dexterity * 0.008) / (1 + a.dexterity * 0.008) ;
  return {
    maxHealth: Math.round(60 + a.vitality * 8 + level * 12),
    maxEnergy: Math.round(30 + a.focus * 5 + level * 3),
    attack: Math.round(10 + a.strength * 2 + level * 3),
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

/**
 * What a mob's rank is worth in combat.
 *
 * This is the lever that lets level scaling stay gentle (so encounters have a
 * "close fight" band rather than flipping from impossible to trivial in four
 * levels) while elites and bosses still hit above their level. Without it,
 * `rank` is just a nameplate decoration.
 */
export const RANK_MODIFIERS: Record<MobDef['rank'], { damage: number; defense: number }> = {
  normal: { damage: 1, defense: 1 },
  elite: { damage: 1.3, defense: 1.35 },
  boss: { damage: 1.45, defense: 1.5 },
};

/** Mob stat block, derived the same way so player and mob math stay symmetric. */
export function deriveMobStats(def: MobDef): DerivedStats {
  const rank = RANK_MODIFIERS[def.rank];
  return {
    maxHealth: def.baseHealth,
    maxEnergy: 100,
    attack: Math.round(10 + def.attributes.strength * 2 + def.level * 3),
    defense: Math.round((def.attributes.vitality * 1.5 + def.level * 2) * rank.defense),
    critChance: Math.min(0.3, 0.02 + def.attributes.dexterity * 0.002),
    swingMs: def.swingMs,
    damageMin: def.damageMin * rank.damage,
    damageMax: def.damageMax * rank.damage,
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
  const raw = 0.9 + (attack - defense) * 0.0018 + levelDiff * 0.04;
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
  /** 1 for an auto-attack, otherwise whatever the skill declares. */
  weaponMultiplier: number;
  /** Added pre-mitigation. */
  flatPower: number;
}

/** Resolve one attack: hit roll, damage roll, crit, level scaling, mitigation. */
export function resolveAttack(
  rng: Rng,
  attacker: DerivedStats,
  defender: DerivedStats,
  opts: AttackOptions,
): AttackResult {
  if (!rng.chance(hitChance(attacker.attack, defender.defense, opts.levelDiff))) {
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
