import type { ArmorSlot, ItemDef } from '../sim/types.js';
import { ARMOR_SLOT_SHARE, curveArmorTotal, curveWeaponDps } from './curves.js';
import { keeperOfTrade } from './settlements.js';

/**
 * The hoard sets: armour you farm one camp for.
 *
 * There were three ways to get dressed and all three are somebody else's
 * schedule. A drop is a rate you fight and hope against. The story chain walks
 * you down the zone. The kit chain sends you to four different camps in turn.
 * What none of them is, is **a thing you can decide to go and do**: pick one
 * place, work it, and come out with a set.
 *
 * So a hoard set is one camp — the hardest ordinary one in its zone — a token
 * at a known rate, and a keeper in a town who will make the pieces up. It is
 * entirely optional and entirely off the main line, which is the point: it is
 * the first reward in this game whose whole cost is *deciding to*.
 *
 * The piece is not what makes it worth doing. Each one sits exactly on the
 * ladder curve — a hair *below* what the kit chain hands out — because the
 * payment is the **set bonus**, and that is the only thing in this game a
 * single piece of gear cannot buy you.
 *
 * Four rules:
 *
 * - **One camp, and never one the kit chain already uses.** "Farm this place"
 *   has to name a place you would not otherwise be standing, or it is the kit
 *   chain with a different quest log entry.
 * - **A known rate.** `HOARD_TOKEN_CHANCE`, the same argument the trophies run
 *   under: a rate you can count turns hope into "a hundred more kills", and
 *   that is the difference between a grind that feels long and one that feels
 *   arbitrary.
 * - **Each set answers a different question.** The rule the boss kits, the
 *   creature traits and the timed skills all already run under. Health and
 *   regeneration is a different afternoon from crit and damage, and a player
 *   who has both should want them for different fights.
 * - **The bonus is the reward, so the pieces are not.** Guaranteed gear that
 *   also beat the drops would make the drops pointless — the same reason the
 *   kit chain sits a hair above the curve rather than above the bosses.
 */

/** What a piece of the set is worth, as a multiple of the ladder curve. */
const HOARD_GEAR_POWER = 1;

/**
 * How often the camp gives up a token.
 *
 * Rarer than a trophy (12%), because a trophy is one of four camps' worth and
 * this is all of one camp's. `npm test` prints what each piece costs in kills.
 */
export const HOARD_TOKEN_CHANCE = 0.07;

/** Distinct from the kit set's nouns, so a bag never reads as two of the same. */
const HOARD_NOUN: Record<ArmorSlot, string> = {
  head: 'Hood',
  chest: 'Cuirass',
  legs: 'Legguards',
  ring: 'Signet',
};

/**
 * A bonus for wearing some of a set.
 *
 * The fields are exactly the ones an item's affixes already feed, so a set
 * bonus lands on the same accumulator gear does and needs no new maths in
 * `deriveStats`. Anything a set can give, a piece could have given — which is
 * what keeps the two comparable in a tooltip.
 */
export interface SetBonus {
  /** How many pieces it takes. */
  at: number;
  /** What it says on the piece. */
  label: string;
  healthBonus?: number;
  critBonus?: number;
  damageBonus?: number;
  moveSpeedBonus?: number;
  regenBonus?: number;
  armorBonus?: number;
  /** Multiplier, so 1 is nothing. */
  skillPower?: number;
}

export interface HoardSet {
  id: string;
  zoneId: string;
  /** "Mirewrought". Every piece is named for it. */
  name: string;
  /** The one camp. */
  mobId: string;
  /** The camp's level, and the level every piece is built for. */
  level: number;
  /** What it drops, and what the keeper wants. */
  token: string;
  /** One line about the place, for the quest that sends you there. */
  blurb: string;
  /** In the order you earn them: cheapest first, the commitment last. */
  slots: ArmorSlot[];
  /** Tokens per piece, matching `slots`. */
  costs: number[];
  bonuses: SetBonus[];
}

/**
 * Where each set's numbers come from.
 *
 * Scaled off the camp's own level, like everything else south of the Fenmarch,
 * so a set is worth the same share of a character at 19 and at 84. The
 * magnitudes are fitted against what a signature affix is worth — a two-piece
 * bonus is about one signature piece, and the four-piece is about two.
 */
function bonusesFor(kind: string, level: number): SetBonus[] {
  switch (kind) {
    case 'endure':
      return [
        { at: 2, label: 'Health', healthBonus: Math.round(level * 5) },
        {
          at: 4,
          label: 'Health a second',
          regenBonus: Math.max(2, Math.round(level * 0.14)),
        },
      ];
    case 'strike':
      return [
        { at: 2, label: 'Critical chance', critBonus: 0.04 },
        {
          at: 4,
          label: 'Weapon damage',
          damageBonus: Math.max(1, Math.round(curveWeaponDps(level) * 0.09)),
        },
      ];
    case 'compose':
      return [
        {
          at: 2,
          label: 'Armour',
          armorBonus: Math.max(1, Math.round(curveArmorTotal(level) * 0.1)),
        },
        { at: 4, label: 'Skill power', skillPower: 1.07 },
      ];
    default:
      return [
        { at: 2, label: 'Movement', moveSpeedBonus: 0.45 },
        {
          at: 4,
          label: 'Critical chance and health',
          critBonus: 0.03,
          healthBonus: Math.round(level * 3),
        },
      ];
  }
}

interface SetSpec {
  zoneId: string;
  name: string;
  mobId: string;
  /**
   * The camp's level, written down rather than read off the bestiary.
   *
   * `content/mobs.ts` has to import this file to hang the token on the camp's
   * loot table, so this file must not import it back — the same reason
   * `questgear.ts` writes its step levels out. A test asserts the two agree,
   * which is the half a hand-typed number needs.
   */
  level: number;
  token: string;
  blurb: string;
  kind: 'endure' | 'strike' | 'compose' | 'evade';
}

/**
 * One per zone, and each answers a different question.
 *
 * The camps are deliberately the hard ones and deliberately not the ones the
 * kit chain sends you to. A zone with a bear problem and a set made out of
 * bears is a place; a second quest pointing at the same adder camp is a chore.
 */
const SPECS: SetSpec[] = [
  {
    zoneId: 'fenmarch',
    name: 'Mirewrought',
    mobId: 'marsh_bear',
    level: 19,
    token: 'Bear Ivory',
    blurb: 'The deep fen belongs to the bears, and nobody has argued with them in years.',
    kind: 'endure',
  },
  {
    zoneId: 'ardmoor',
    name: 'Stormhewn',
    mobId: 'clan_berserker',
    level: 38,
    token: "Berserker's Torc",
    blurb: 'The berserkers hold the top of the pass and wear their wealth around their necks.',
    kind: 'strike',
  },
  {
    zoneId: 'reach',
    name: 'Tidebound',
    mobId: 'grey_seal_bull',
    level: 66,
    token: 'Sealskin Cord',
    blurb: 'The bulls have the last of the open water, and they are not sharing it.',
    kind: 'compose',
  },
  {
    zoneId: 'caer_dubh',
    name: 'Breachward',
    mobId: 'siege_engineer',
    level: 84,
    token: "Engineer's Rivet",
    blurb: 'The engineers keep a yard behind the line, and everything in it is worth taking.',
    kind: 'evade',
  },
];

/**
 * Rising, so the last piece is a decision rather than a formality — and the
 * four-piece bonus is on the far side of it.
 */
const COSTS = [4, 6, 8, 10];

/** Cheapest first, the chest last: it is the piece that finishes the set. */
const SLOT_ORDER: ArmorSlot[] = ['ring', 'head', 'legs', 'chest'];

export const HOARD_SETS: HoardSet[] = SPECS.map((spec) => ({
  id: `hoard_${spec.zoneId}`,
  zoneId: spec.zoneId,
  name: spec.name,
  mobId: spec.mobId,
  level: spec.level,
  token: spec.token,
  blurb: spec.blurb,
  slots: SLOT_ORDER,
  costs: COSTS,
  bonuses: bonusesFor(spec.kind, spec.level),
}));

/** The keeper who makes the pieces up: a zone's armourer, wherever they live. */
export function hoardGiver(set: HoardSet): string {
  const keeper = keeperOfTrade(set.zoneId, 'armoury');
  if (!keeper) throw new Error(`${set.zoneId} has no armourer to hand ${set.name} over`);
  return keeper;
}

export function hoardTokenId(set: HoardSet): string {
  return `token_${set.zoneId}`;
}

export function hoardPieceId(set: HoardSet, slot: ArmorSlot): string {
  return `hoard_${set.zoneId}_${slot}`;
}

/** The level a set is built for: the camp's own. */
export function hoardLevel(set: HoardSet): number {
  return set.level;
}

/** Every token, keyed by the camp that drops it — for the loot tables. */
export function hoardTokensByMob(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const set of HOARD_SETS) out[set.mobId] = hoardTokenId(set);
  return out;
}

/** Tokens and set pieces, generated from the table above. */
export function buildHoardGear(): Record<string, ItemDef> {
  const out: Record<string, ItemDef> = {};

  for (const set of HOARD_SETS) {
    const level = hoardLevel(set);
    out[hoardTokenId(set)] = {
      id: hoardTokenId(set),
      name: set.token,
      slot: null,
      // Uncommon on purpose, exactly like a trophy. Rare would pop the drop
      // card four hundred times over a set, and a card the player learns to
      // ignore is a card the epic goes past unnoticed behind.
      quality: 'uncommon',
      value: Math.max(3, Math.round(Math.pow(level, 1.4) * 0.6)),
      stackable: true,
    };

    for (const slot of set.slots) {
      out[hoardPieceId(set, slot)] = {
        id: hoardPieceId(set, slot),
        name: `${set.name} ${HOARD_NOUN[slot]}`,
        slot,
        // Rare, which is also what keeps it out of every shop in the game:
        // a keeper's stock is generated from the registry and capped at
        // uncommon, so a set piece excludes itself with no list to maintain.
        quality: 'rare',
        setId: set.id,
        value: Math.round(Math.pow(level, 1.9) * 0.9 * 2.2),
        armor: Math.max(
          1,
          Math.round(curveArmorTotal(level) * ARMOR_SLOT_SHARE[slot] * HOARD_GEAR_POWER),
        ),
        attributes: {
          vitality: Math.round(level * 0.4),
          strength: Math.round(level * 0.18),
          focus: Math.round(level * 0.18),
          dexterity: Math.round(level * 0.18),
        },
      };
    }
  }
  return out;
}

export function getSet(id: string): HoardSet | undefined {
  return HOARD_SETS.find((s) => s.id === id);
}

/**
 * What a rack of worn pieces is currently paying.
 *
 * Cumulative: at four pieces both bonuses are live, which is the convention
 * every player already knows and the only one where the last piece reads as an
 * upgrade rather than as a swap.
 */
export function setBonusesActive(worn: string[]): SetBonus[] {
  const counts = new Map<string, number>();
  for (const setId of worn) counts.set(setId, (counts.get(setId) ?? 0) + 1);
  const out: SetBonus[] = [];
  for (const [setId, n] of counts) {
    const set = getSet(setId);
    if (!set) continue;
    for (const bonus of set.bonuses) if (n >= bonus.at) out.push(bonus);
  }
  return out;
}
