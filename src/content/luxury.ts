import type { ItemDef, VendorDef } from '../sim/types.js';
import { curveArmorTotal, curveWeaponDps } from './curves.js';

/**
 * The luxury merchant: the only shop in the game that is not a safety net.
 *
 * Every other trader is capped at uncommon on purpose — a vendor should never
 * be a shortcut past the grind. This one breaks that rule deliberately, and
 * the reason it works is that **the price is the grind**. A Sovereign-tier
 * piece costs tens of thousands of kills' worth of gold; nobody buys one
 * instead of playing, they buy one *because* they played.
 *
 * It also fixes the one thing gold was still bad at. Tomes gave coin a
 * purpose at level 70; past that a player has more gold than uses for it
 * again. These are what the last thirty levels of income are for.
 *
 * Three slots, none of which any mob drops or any quest pays out:
 *
 *  - **offhand** — a blade for damage, a shield for armour, or a grimoire that
 *    makes everything you *cast* hit harder. One slot, three different
 *    characters, which is the most build choice in the game.
 *  - **amulet** and **bracelet** — damage or regeneration. The regeneration
 *    ones are flat health per second rather than a percentage, so they are
 *    worth most to whoever has the least health.
 *
 * Deliberately a step BELOW what a dragon carries. A dragon is the hardest
 * fight in its zone at a moment you did not choose; this is a thing you can
 * decide to save up for. If money bought the best item in the game, killing
 * the dragon would be a formality.
 */

export type LuxuryKind = 'blade' | 'shield' | 'grimoire' | 'amulet' | 'bracelet';

/**
 * Four tiers, spread so there is always one just out of reach.
 *
 * The first is affordable in the forties by someone who has been careful, the
 * last is an endgame project. A shop where everything is unaffordable forever
 * is a shop nobody visits twice.
 */
const TIERS: Array<{ tier: string; reqLevel: number }> = [
  { tier: 'Wrought', reqLevel: 40 },
  { tier: 'Gilded', reqLevel: 62 },
  { tier: 'Regal', reqLevel: 82 },
  { tier: 'Sovereign', reqLevel: 100 },
];

/**
 * How much of a main weapon's damage an offhand blade adds.
 *
 * A quarter. An offhand that matched the main hand would double every
 * character's damage in one purchase and make the whole weapon ladder
 * irrelevant.
 */
const BLADE_SHARE = 0.25;

/** A shield's armour, as a share of a full set at that level. */
const SHIELD_SHARE = 0.3;

/** What a grimoire multiplies skill damage and healing by, per tier. */
const GRIMOIRE_POWER = [1.08, 1.12, 1.16, 1.2];

/** Damage an amulet or bracelet adds, as a share of an offhand blade's. */
const TRINKET_DAMAGE_SHARE = 0.55;

/** Flat health per second, as a share of what a level's health regen is worth. */
const TRINKET_REGEN_SHARE = 0.09;

/**
 * Price, in gold.
 *
 * Steep and superlinear: the top tier is meant to be the single most expensive
 * thing a character ever buys. `test/balance.test.ts` prints what each costs in
 * kills at its own level and fails if the number leaves the intended band.
 */
function luxuryValue(reqLevel: number, kind: LuxuryKind): number {
  const kindWeight = kind === 'amulet' || kind === 'bracelet' ? 0.75 : 1;
  return Math.round(Math.pow(reqLevel, 2.45) * 2.6 * kindWeight);
}

const KIND_NOUN: Record<LuxuryKind, string> = {
  blade: 'Parrying Blade',
  shield: 'Bulwark',
  grimoire: 'Grimoire',
  amulet: 'Amulet',
  bracelet: 'Bracelet',
};

/** Which trinkets do damage and which do regeneration. */
const TRINKET_ROLE: Record<'amulet' | 'bracelet', 'damage' | 'regen'> = {
  amulet: 'damage',
  bracelet: 'regen',
};

export function luxuryId(kind: LuxuryKind, tier: string): string {
  return `lux_${tier.toLowerCase()}_${kind}`;
}

/** Every luxury good, four tiers of five. */
export function buildLuxuryGoods(): Record<string, ItemDef> {
  const out: Record<string, ItemDef> = {};

  TIERS.forEach(({ tier, reqLevel }, tierIndex) => {
    const weaponDps = curveWeaponDps(reqLevel);

    for (const kind of Object.keys(KIND_NOUN) as LuxuryKind[]) {
      const base: ItemDef = {
        id: luxuryId(kind, tier),
        name: `${tier} ${KIND_NOUN[kind]}`,
        slot: kind === 'amulet' ? 'amulet' : kind === 'bracelet' ? 'bracelet' : 'offhand',
        quality: 'epic',
        value: luxuryValue(reqLevel, kind),
        reqLevel,
      };

      switch (kind) {
        case 'blade':
          // Flat damage on every swing, which means it is worth more to a
          // Rogue swinging every 1.4s than to a Ranger swinging every 2.4s.
          // That is how an offhand should read: it rewards the fast hands.
          out[base.id] = {
            ...base,
            damageBonus: Math.round(weaponDps * BLADE_SHARE * 1.85),
            attributes: { strength: Math.round(reqLevel * 0.25), dexterity: Math.round(reqLevel * 0.25) },
          };
          break;
        case 'shield':
          out[base.id] = {
            ...base,
            armor: Math.round(curveArmorTotal(reqLevel) * SHIELD_SHARE),
            healthBonus: Math.round(reqLevel * 6),
            attributes: { vitality: Math.round(reqLevel * 0.5) },
          };
          break;
        case 'grimoire':
          out[base.id] = {
            ...base,
            skillPower: GRIMOIRE_POWER[tierIndex]!,
            attributes: { focus: Math.round(reqLevel * 0.45) },
          };
          break;
        case 'amulet':
        case 'bracelet': {
          const role = TRINKET_ROLE[kind];
          out[base.id] = {
            ...base,
            ...(role === 'damage'
              ? {
                  damageBonus: Math.round(weaponDps * BLADE_SHARE * TRINKET_DAMAGE_SHARE * 1.85),
                  critBonus: 0.02,
                }
              : {
                  regenBonus: Math.round(reqLevel * TRINKET_REGEN_SHARE * 10) / 10,
                  healthBonus: Math.round(reqLevel * 4),
                }),
            attributes: { vitality: Math.round(reqLevel * 0.28) },
          };
          break;
        }
      }
    }
  });

  return out;
}

/**
 * The merchant.
 *
 * Parked at the standing stones in the Fenmarch, where a level-1 character
 * walks past the most expensive objects in the world on their way to kill
 * hares. That is the point: the carrot has to be visible from the start, and
 * an endgame shop tucked behind the endgame is a shop nobody knows exists.
 */
export function luxuryMerchant(): VendorDef {
  return {
    id: 'ceallach',
    name: 'Ceallach of the Long Road',
    greeting:
      'Look all you like. Everything here has a price, and none of them are the sort you have.',
    stock: Object.keys(buildLuxuryGoods()),
    view: { color: 0xe0cf9a, height: 1.86, radius: 0.46 },
  };
}

/** Vendors exempt from the uncommon stock cap, and why. */
export const LUXURY_VENDOR_ID = 'ceallach';
