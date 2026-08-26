import type { ItemQuality, StarRating } from '../sim/types.js';
import type { Rng } from '../sim/rng.js';

/**
 * Eight grades of the same piece of gear.
 *
 * Before this, a drop was a single fixed object: the Iron Longsword was the
 * Iron Longsword, and once you had it that camp had nothing left to give you.
 * The whole back half of a hundred-level game is farming things you have
 * already beaten, and "you have already got that one" is the worst thing a
 * loot table can say.
 *
 * A tier is a **grade of an existing piece**, not a new piece: same name, same
 * slot, same look, a prefix and a multiplier. That is deliberate — a ladder of
 * eight *new* items per slot would be eight times the content to write and
 * would say nothing new. What it buys is a reason to kill the same boss again:
 * you have the Longsword, but you have a Royal one and there is a Godly one.
 *
 * Two rules decide where they come from, and between them they are the whole
 * design:
 *
 * - **Ordinary creatures roll Minor to Grand.** A ★1 hare can hand you a
 *   Minor piece and, very rarely, a Grand one. Nothing below a boss ever
 *   carries better, so the ladder of camps is a ladder of odds rather than a
 *   ladder of ceilings.
 * - **A boss never rolls below Royal, and rarely rolls Godly.** That is the
 *   hook. A ★5 pays Godly about one kill in fifty and a ★6 about one in
 *   seventeen, so the answer to "why fight Old Scar again" is a number rather
 *   than a shrug.
 */
export type ItemTier =
  | 'minor'
  | 'lesser'
  | 'greater'
  | 'grand'
  | 'royal'
  | 'majestic'
  | 'imperial'
  | 'godly';

export const TIER_ORDER: ItemTier[] = [
  'minor',
  'lesser',
  'greater',
  'grand',
  'royal',
  'majestic',
  'imperial',
  'godly',
];

interface TierDef {
  /** What goes in front of the item's own name. */
  prefix: string;
  /**
   * Multiplier on everything the piece does: damage, armour, attributes.
   *
   * Greater is 1.0 — the piece exactly as it was authored — so the ladder the
   * whole game is fitted against still means what it meant. Minor and Lesser
   * sit below it and the four boss grades above, which is what stops a bag of
   * ★1 drops from quietly out-gearing a boss.
   */
  power: number;
  /**
   * The colour it reads as. Quality still drives what a trader will stock,
   * what gets a drop card and what a piece is worth, so a tier has to answer
   * to it rather than sit beside it.
   */
  quality: ItemQuality;
}

export const TIERS: Record<ItemTier, TierDef> = {
  minor: { prefix: 'Minor', power: 0.78, quality: 'common' },
  lesser: { prefix: 'Lesser', power: 0.89, quality: 'common' },
  greater: { prefix: 'Greater', power: 1, quality: 'uncommon' },
  grand: { prefix: 'Grand', power: 1.12, quality: 'uncommon' },
  royal: { prefix: 'Royal', power: 1.26, quality: 'rare' },
  majestic: { prefix: 'Majestic', power: 1.4, quality: 'rare' },
  imperial: { prefix: 'Imperial', power: 1.56, quality: 'epic' },
  godly: { prefix: 'Godly', power: 1.75, quality: 'epic' },
};

/**
 * What each star rating can hand out, and how often.
 *
 * Weights rather than a ladder of thresholds, because the interesting number
 * is not "can a ★4 drop a Grand" but "how many ★4s is a Grand". `npm test`
 * prints how many kills each grade is worth at each rating.
 */
export const TIER_WEIGHTS: Record<StarRating, Partial<Record<ItemTier, number>>> = {
  1: { minor: 58, lesser: 29, greater: 11, grand: 2 },
  2: { minor: 42, lesser: 33, greater: 19, grand: 6 },
  3: { minor: 26, lesser: 32, greater: 28, grand: 14 },
  4: { minor: 12, lesser: 27, greater: 35, grand: 26 },
  // A boss never rolls below Royal. It is the one thing that separates a boss
  // from a very hard camp, and it is why a ★6 is worth walking to.
  5: { royal: 62, majestic: 26, imperial: 10, godly: 2 },
  6: { royal: 40, majestic: 32, imperial: 22, godly: 6 },
};

/** Separator in a tiered id. Two underscores, so a base id can hold one. */
const MARK = '__';

export function tieredId(baseId: string, tier: ItemTier): string {
  return `${tier}${MARK}${baseId}`;
}

/** The tier and base of an id, or null if it is an ordinary item. */
export function splitTier(id: string): { tier: ItemTier; baseId: string } | null {
  const at = id.indexOf(MARK);
  if (at <= 0) return null;
  const tier = id.slice(0, at) as ItemTier;
  if (!TIERS[tier]) return null;
  return { tier, baseId: id.slice(at + MARK.length) };
}

/** The piece behind a grade, or the id itself if it carries none. */
export function baseItemId(id: string): string {
  return splitTier(id)?.baseId ?? id;
}

/** Roll a grade for something this creature was carrying. */
export function rollTier(rng: Rng, stars: StarRating): ItemTier {
  const weights = TIER_WEIGHTS[stars];
  const total = Object.values(weights).reduce((n, w) => n + (w ?? 0), 0);
  let pick = rng.next() * total;
  for (const tier of TIER_ORDER) {
    const w = weights[tier];
    if (w === undefined) continue;
    pick -= w;
    if (pick <= 0) return tier;
  }
  return 'greater';
}

/**
 * How many kills of this rating it takes to see this grade, on average, once
 * something has dropped at all. Printed by the suite rather than asserted one
 * number at a time.
 */
export function killsPerTier(stars: StarRating, tier: ItemTier): number {
  const weights = TIER_WEIGHTS[stars];
  const w = weights[tier];
  if (!w) return Infinity;
  const total = Object.values(weights).reduce((n, x) => n + (x ?? 0), 0);
  return total / w;
}
