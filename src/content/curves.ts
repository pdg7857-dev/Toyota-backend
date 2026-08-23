import type { ArmorSlot } from '../sim/types.js';

/**
 * Gear curves, shared by the tier ladders in `items.ts` and the signature
 * pieces in `rares.ts`.
 *
 * They live in their own module because those two files would otherwise have
 * to import each other: `items.ts` owns the registry the rares merge into, and
 * `rares.ts` needs the same curves to sit a fixed step above the ladder. A
 * cycle there leaves whichever loaded second with an empty registry.
 */

/**
 * Weapon DPS for a given level, fitted to the hand-written 1-25 ladders so the
 * generated tier 9 picks up exactly where hand-written tier 8 left off.
 */
export function curveWeaponDps(level: number): number {
  return 0.62 * Math.pow(level, 1.28);
}

/**
 * Total armour a fully geared player of this level should carry.
 *
 * Linear, because player defence also grows from Vitality and level; making
 * armour superlinear too was what previously let high-level characters shrug
 * off everything. 5 per level reproduces the hand-tuned level-25 set (~125).
 */
export function curveArmorTotal(level: number): number {
  return 5 * level;
}

/** How that total splits across slots, matching the hand-built level-25 set. */
export const ARMOR_SLOT_SHARE: Record<ArmorSlot, number> = {
  head: 0.22,
  chest: 0.4,
  legs: 0.31,
  ring: 0.05,
};
