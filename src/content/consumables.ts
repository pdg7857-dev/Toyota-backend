import type { ItemDef } from '../sim/types.js';

/**
 * Potions and elixirs: what you drink when a fight goes wrong.
 *
 * These exist because the creatures got dangerous. Before that, every fight in
 * the game was won by pressing the same rotation, and there was no answer to
 * "this one is going badly" because no fight ever did. Now a ★4 at your level
 * kills the harness half the time and a double pull kills it nearly always —
 * and the difference between the harness and a player has to be *something a
 * player can do*. This is that something.
 *
 * Two families, and the split is the whole design:
 *
 *  - **Potions** are reactive. Health, right now, on a short cooldown. You drink
 *    one because you are about to die.
 *  - **Elixirs** are proactive. A temporary buff on a long cooldown, drunk
 *    *before* the pull because you already know it is going to be hard.
 *
 * They share one cooldown clock per family, so the answer to a hard fight is
 * "use it at the right moment", never "drink six". A consumable that can be
 * chained is not a decision, it is a health bar with extra steps.
 */

/** How long after a potion before another one will go down. */
export const POTION_COOLDOWN_MS = 18000;

/** Elixirs are a commitment: one per fight, at most. */
export const ELIXIR_COOLDOWN_MS = 120000;

/** How long an elixir's buff lasts. */
export const ELIXIR_DURATION_MS = 45000;

/**
 * What a consumable does when it goes down.
 *
 * `healPercent` rather than a flat number on purpose: a potion authored as "180
 * health" is a lifesaver at level 12 and a rounding error at level 90, and
 * tiering flat numbers means re-fitting them every time player health changes.
 * A percentage is the same decision at every level.
 */
export interface ConsumableSpec {
  /** Fraction of maximum health restored instantly. */
  healPercent?: number;
  /** Health per second, and for how long. */
  regen?: { perSec: number; seconds: number };
  /** Multiplier on outgoing damage while it lasts. */
  damageMultiplier?: number;
  /** Flat defence added while it lasts. */
  defenseBonus?: number;
  /** Which cooldown clock it runs on. */
  family: 'potion' | 'elixir';
}

/**
 * The tiers.
 *
 * One of each family per zone, sold by that zone's trader and dropped by its
 * creatures. Deliberately available from a vendor: this is the safety net that
 * makes a dangerous world fair, and gating it behind a drop rate would mean the
 * players who most need it are the ones who cannot get it.
 */
const TIERS: Array<{ tier: string; reqLevel: number; heal: number }> = [
  { tier: 'Lesser', reqLevel: 1, heal: 0.35 },
  { tier: 'Common', reqLevel: 20, heal: 0.4 },
  { tier: 'Strong', reqLevel: 40, heal: 0.45 },
  { tier: 'Greater', reqLevel: 66, heal: 0.5 },
];

/**
 * What each kind is and does.
 *
 * The healing potion is the one everybody carries. The others are answers to
 * specific problems: a salve for a long fight you expect to survive, a
 * whetstone for something with a lot of health, an ironskin for something that
 * hits far too hard.
 */
const KINDS: Array<{
  key: string;
  noun: string;
  blurb: string;
  spec: (heal: number, level: number) => ConsumableSpec;
}> = [
  {
    key: 'healing',
    noun: 'Healing Draught',
    blurb: 'Bitter, and it works before you have finished swallowing it.',
    spec: (heal) => ({ healPercent: heal, family: 'potion' }),
  },
  {
    key: 'salve',
    noun: 'Field Salve',
    blurb: 'Slower than a draught and worth more over a long fight.',
    spec: (heal, level) => ({
      regen: { perSec: Math.round(level * 1.6 + 8), seconds: 20 },
      healPercent: heal * 0.25,
      family: 'potion',
    }),
  },
  {
    key: 'whetstone',
    noun: 'Elixir of Edges',
    blurb: 'Drink it looking at the thing you are about to hit.',
    spec: () => ({ damageMultiplier: 1.3, family: 'elixir' }),
  },
  {
    key: 'ironskin',
    noun: 'Elixir of Ironskin',
    blurb: 'Everything lands. Nothing lands hard.',
    spec: (_heal, level) => ({ defenseBonus: Math.round(40 + level * 3.2), family: 'elixir' }),
  },
];

export function consumableId(key: string, tier: string): string {
  return `con_${tier.toLowerCase()}_${key}`;
}

/**
 * Price.
 *
 * Cheap enough that a player restocks without thinking about it and expensive
 * enough that carrying forty of them is a real chunk of a levelling session's
 * gold. A safety net you cannot afford is not a safety net.
 */
function consumableValue(reqLevel: number, family: 'potion' | 'elixir'): number {
  return Math.round(Math.pow(reqLevel, 1.55) * (family === 'elixir' ? 6.5 : 3.4) + 6);
}

export const CONSUMABLE_SPECS: Record<string, ConsumableSpec> = {};

export function buildConsumables(): Record<string, ItemDef> {
  const out: Record<string, ItemDef> = {};
  for (const { tier, reqLevel, heal } of TIERS) {
    for (const kind of KINDS) {
      const spec = kind.spec(heal, reqLevel);
      const id = consumableId(kind.key, tier);
      CONSUMABLE_SPECS[id] = spec;
      out[id] = {
        id,
        name: `${tier} ${kind.noun}`,
        slot: 'none',
        // Uncommon at most, so the one vendor rule holds: traders never stock
        // above uncommon and these are the thing traders are *for*.
        quality: reqLevel >= 40 ? 'uncommon' : 'common',
        value: consumableValue(reqLevel, spec.family),
        reqLevel,
        stackable: true,
        consumable: spec,
        flavor: kind.blurb,
      };
    }
  }
  return out;
}

/** The consumables a zone's trader keeps, by the level band they serve. */
export function consumablesFor(reqLevel: number): string[] {
  const tier = [...TIERS].reverse().find((t) => t.reqLevel <= reqLevel) ?? TIERS[0]!;
  return KINDS.map((k) => consumableId(k.key, tier.tier));
}

/** Every consumable, commonest first. */
export function allConsumables(): string[] {
  return Object.keys(buildConsumables());
}

/** The tier of consumable a creature of this level drops, if it drops one. */
export function consumableDropFor(level: number): string {
  const tier = [...TIERS].reverse().find((t) => t.reqLevel <= level) ?? TIERS[0]!;
  return consumableId('healing', tier.tier);
}

/**
 * How often an ordinary creature drops one.
 *
 * High, by this game's standards, and deliberately so: the drop rate on
 * equipment is meant to make you hope, and the drop rate on potions is meant to
 * make you *stocked*. A player who runs out mid-zone has to walk back to a
 * trader, and that is a punishment for the crime of fighting things.
 */
export const CONSUMABLE_DROP_CHANCE = 0.22;
