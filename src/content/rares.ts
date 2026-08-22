import type { ClassId, EquipSlot, ItemDef, ItemQuality, StarRating } from '../sim/types.js';
import { ARMOR_SLOT_SHARE, curveArmorTotal, curveWeaponDps } from './curves.js';
import { zoneTomes } from './skills.js';

/**
 * Rare spawns: named creatures that are not in the zone layout at all.
 *
 * A camp is a list of ordinary mobs on respawn timers. Every time one of those
 * timers fires on a HOST spawn point, the world rolls `RARE_SPAWN_CHANCE`, and
 * on a hit the mob comes back as its named variant instead — harder, a few
 * levels above the camp, and carrying one signature item that drops nowhere
 * else in the game.
 *
 * The point is that finding it IS the grind. There is no quest that sends you,
 * no boss timer, and no vendor alternative: you farm a camp you have already
 * outlevelled because you know what walks in it. So the drop itself is
 * GUARANTEED — a rare spawn that then fails a loot roll is punishing twice for
 * the same piece of luck, and turns a good hour into a wasted one.
 *
 * Every rare is named for what it carries. `Mirefang the Bog Wolf` drops the
 * `Mirefang Blade`, and a Priest killing the same creature gets the
 * `Mirefang Stave` — one epithet, one creature, an item per class that shares
 * its name.
 */

/** What a rare carries, which decides how its item resolves on the corpse. */
export type RareCarry =
  /** A signature weapon, resolved against the killer's class. */
  | 'weapon'
  /** A signature armour piece or ring. Class-neutral, so a flat drop. */
  | 'relic'
  /** A signature tome teaching the zone's elite-boss skill, per class. */
  | 'lore';

export interface RareSpec {
  /** Shared by the creature and its item. This is the whole naming rule. */
  epithet: string;
  /** Ordinary mob whose spawn points it can replace. */
  hostMobId: string;
  zoneId: string;
  /** Host level; the rare itself is this plus `RARE_LEVEL_BONUS`. */
  hostLevel: number;
  hostStars: StarRating;
  carries: RareCarry;
  /** relic only. */
  slot?: Exclude<EquipSlot, 'weapon'>;
  /** One line for the combat log when it turns up. */
  sighting: string;
}

/** Levels a rare sits above the camp it hides in. */
export const RARE_LEVEL_BONUS = 2;

/**
 * Odds that a host spawn point comes back rare, rolled per respawn.
 *
 * A band's host camp runs roughly a dozen spawn points on ~30s timers, so a
 * player parked on it rolls this about 25 times a minute: at 0.25% that is a
 * named creature every twenty minutes or so of deliberate camping, and
 * essentially never by accident while levelling past. `test/balance.test.ts`
 * prints the expected wait and fails if it leaves that band.
 */
export const RARE_SPAWN_CHANCE = 0.0025;

/** Weapon noun per class, so one epithet names five weapons. */
const SIGNATURE_WEAPON_NOUN: Record<ClassId, string> = {
  warrior: 'Blade',
  priest: 'Stave',
  ranger: 'Bow',
  rogue: 'Dirk',
  mage: 'Rod',
};

const SIGNATURE_RELIC_NOUN: Record<Exclude<EquipSlot, 'weapon'>, string> = {
  head: 'Crown',
  chest: 'Mail',
  legs: 'Greaves',
  ring: 'Torc',
};

/**
 * Weapon feel per class, alongside the late ladders' own table in `items.ts`.
 *
 * Held here rather than imported because `items.ts` imports THIS file to build
 * the signature gear; the shared numbers that both need — the dps and armour
 * curves — live in `curves.ts` for the same reason.
 */
const SIGNATURE_FEEL: Record<
  ClassId,
  { swingMs: number; attackRange: number; damageType: ItemDef['damageType']; primary: 'strength' | 'dexterity' | 'focus' }
> = {
  warrior: { swingMs: 1800, attackRange: 2.7, damageType: 'physical', primary: 'strength' },
  priest: { swingMs: 2050, attackRange: 2.9, damageType: 'nature', primary: 'focus' },
  ranger: { swingMs: 2350, attackRange: 12, damageType: 'physical', primary: 'dexterity' },
  rogue: { swingMs: 1350, attackRange: 2.3, damageType: 'physical', primary: 'dexterity' },
  mage: { swingMs: 1950, attackRange: 10, damageType: 'fire', primary: 'focus' },
};

/**
 * How much better than the tier ladder a signature piece is.
 *
 * Kept modest on purpose. The reward for an hour of camping is a piece you
 * cannot get any other way and an affix no ladder item carries — not a number
 * so far ahead that skipping the rare leaves you unable to clear content. A
 * test asserts this ratio from the other side.
 */
const SIGNATURE_POWER = 1.22;

export const RARES: RareSpec[] = [
  // --- The Fenmarch: no taught skills here, so four gear rares ------------
  {
    epithet: 'Mirefang',
    hostMobId: 'bog_wolf',
    zoneId: 'fenmarch',
    hostLevel: 8,
    hostStars: 2,
    carries: 'weapon',
    sighting: 'A wolf with a broken white tooth watches from the reeds.',
  },
  {
    epithet: 'Cairnhorn',
    hostMobId: 'moor_stag',
    zoneId: 'fenmarch',
    hostLevel: 11,
    hostStars: 3,
    carries: 'relic',
    slot: 'head',
    sighting: 'A stag stands on the cairn, antlers grown through an old crown.',
  },
  {
    epithet: 'Blackthorn',
    hostMobId: 'outlaw_reaver',
    zoneId: 'fenmarch',
    hostLevel: 16,
    hostStars: 3,
    carries: 'weapon',
    sighting: 'One of the reavers carries something far better than he should.',
  },
  {
    epithet: 'Ashenhide',
    hostMobId: 'marsh_bear',
    zoneId: 'fenmarch',
    hostLevel: 19,
    hostStars: 4,
    carries: 'relic',
    slot: 'chest',
    sighting: 'A grey-muzzled bear drags a coat of mail it will not give up.',
  },

  // --- Ardmoor -----------------------------------------------------------
  {
    epithet: 'Stormcrag',
    hostMobId: 'hill_wolf',
    zoneId: 'ardmoor',
    hostLevel: 23,
    hostStars: 2,
    carries: 'weapon',
    sighting: 'Something pale moves at the head of the pack.',
  },
  {
    epithet: 'Skyburn',
    hostMobId: 'moor_eagle',
    zoneId: 'ardmoor',
    hostLevel: 29,
    hostStars: 3,
    carries: 'relic',
    slot: 'legs',
    sighting: 'An eagle circles low, dragging something bright in its talons.',
  },
  {
    epithet: 'Ironpelt',
    hostMobId: 'highland_bear',
    zoneId: 'ardmoor',
    hostLevel: 35,
    hostStars: 4,
    carries: 'weapon',
    sighting: 'A bear with a hide like scale rises out of the heather.',
  },
  {
    epithet: 'Wyrmscale',
    hostMobId: 'clan_berserker',
    zoneId: 'ardmoor',
    hostLevel: 38,
    hostStars: 4,
    carries: 'lore',
    sighting: 'A berserker with a scarred book chained to his belt steps out.',
  },

  // --- The Sunken Wood ---------------------------------------------------
  {
    epithet: 'Fenlight',
    hostMobId: 'marsh_heron',
    zoneId: 'reach',
    hostLevel: 50,
    hostStars: 3,
    carries: 'weapon',
    sighting: 'A heron the colour of foxfire stalks the shallows.',
  },
  {
    epithet: 'Drownlace',
    hostMobId: 'tidewatch_marauder',
    zoneId: 'reach',
    hostLevel: 58,
    hostStars: 3,
    carries: 'relic',
    slot: 'ring',
    sighting: 'One of the marauders wears something that catches no light.',
  },
  {
    epithet: 'Deepmaw',
    hostMobId: 'great_pike',
    zoneId: 'reach',
    hostLevel: 62,
    hostStars: 4,
    carries: 'weapon',
    sighting: 'The water goes still. Something long turns underneath it.',
  },
  {
    epithet: 'Tidewright',
    hostMobId: 'grey_seal_bull',
    zoneId: 'reach',
    hostLevel: 66,
    hostStars: 4,
    carries: 'lore',
    sighting: 'An old bull hauls out, and the drowned wood goes quiet for it.',
  },

  // --- Caer Dubh ---------------------------------------------------------
  {
    epithet: 'Duskbrand',
    hostMobId: 'warband_levy',
    zoneId: 'caer_dubh',
    hostLevel: 76,
    hostStars: 2,
    carries: 'weapon',
    sighting: 'A levy at the back of the line carries a lit weapon.',
  },
  {
    epithet: 'Gravecrown',
    hostMobId: 'blackshield_spearman',
    zoneId: 'caer_dubh',
    hostLevel: 80,
    hostStars: 3,
    carries: 'relic',
    slot: 'head',
    sighting: 'A spearman stands too straight, wearing something he did not earn.',
  },
  {
    epithet: 'Nightreave',
    hostMobId: 'warhound_alpha',
    zoneId: 'caer_dubh',
    hostLevel: 88,
    hostStars: 4,
    carries: 'weapon',
    sighting: 'The pack parts around a hound with violet eyes.',
  },
  {
    epithet: 'Sovereignlight',
    hostMobId: 'fort_warden',
    zoneId: 'caer_dubh',
    hostLevel: 97,
    hostStars: 4,
    carries: 'lore',
    sighting: 'A warden turns, and the twilight bends toward what she is reading.',
  },
];

/** Mob id of the named variant that can replace `hostMobId`. */
export function rareMobId(spec: RareSpec): string {
  return `rare_${slug(spec.epithet)}`;
}

/** `Mirefang the Bog Wolf` — the creature is named for what it carries. */
export function rareMobName(spec: RareSpec, hostName: string): string {
  return `${spec.epithet} the ${hostName}`;
}

export function rareLootTableId(spec: RareSpec): string {
  return `${rareMobId(spec)}_loot`;
}

/** The signature weapon a rare yields to a given class. */
export function signatureWeaponId(spec: RareSpec, classId: ClassId): string {
  return `sig_${slug(spec.epithet)}_${classId}`;
}

export function signatureRelicId(spec: RareSpec): string {
  return `sig_${slug(spec.epithet)}`;
}

/** Per-class weapon ids for a weapon rare, in `classWeapons` shape. */
export function signatureWeapons(spec: RareSpec): Partial<Record<ClassId, string>> {
  const out: Partial<Record<ClassId, string>> = {};
  for (const classId of Object.keys(SIGNATURE_FEEL) as ClassId[]) {
    out[classId] = signatureWeaponId(spec, classId);
  }
  return out;
}

/**
 * The tomes a lore rare carries: the same skill its zone's ★6 elite boss
 * teaches.
 *
 * A second source, not a new skill. The elite boss is a fixed, findable
 * encounter; the rare is luck. Having both means the zone's capstone skill is
 * never locked behind one creature you cannot beat yet.
 */
export function signatureTomes(spec: RareSpec): Partial<Record<ClassId, string>> {
  return zoneTomes(spec.zoneId, 'epic');
}

/** Level and star rating of the named variant itself. */
export function rareLevel(spec: RareSpec): number {
  return spec.hostLevel + RARE_LEVEL_BONUS;
}

/**
 * Rares cap at ★4 rather than climbing into boss territory.
 *
 * ★5 and ★6 mean "boss" and "elite boss" everywhere else in the codebase —
 * `isBoss` gates arena clearings, telegraph tests and loot rules on exactly
 * that. A rare spawn is a hard camp mob, not a boss that wanders.
 */
export function rareStars(spec: RareSpec): StarRating {
  return Math.min(4, spec.hostStars + 1) as StarRating;
}

/** Every signature item, generated from the roster. */
export function buildSignatureItems(): Record<string, ItemDef> {
  const out: Record<string, ItemDef> = {};

  for (const spec of RARES) {
    const level = rareLevel(spec);
    const quality: ItemQuality = 'epic';
    const value = Math.round(Math.pow(level, 1.9) * 1.15 * 4.2);
    const primaryBonus = Math.round(level * 1.05);
    const vitalityBonus = Math.round(level * 0.55);

    if (spec.carries === 'weapon') {
      for (const classId of Object.keys(SIGNATURE_FEEL) as ClassId[]) {
        const feel = SIGNATURE_FEEL[classId];
        const avg = (curveWeaponDps(level) * SIGNATURE_POWER * feel.swingMs) / 1000;
        out[signatureWeaponId(spec, classId)] = {
          id: signatureWeaponId(spec, classId),
          name: `${spec.epithet} ${SIGNATURE_WEAPON_NOUN[classId]}`,
          slot: 'weapon',
          quality,
          classes: [classId],
          value,
          damageMin: Math.round(avg * 0.78),
          damageMax: Math.round(avg * 1.22),
          damageType: feel.damageType,
          swingMs: feel.swingMs,
          attackRange: feel.attackRange,
          attributes: { [feel.primary]: primaryBonus, vitality: vitalityBonus },
          // The affix is the reason to want it. No ladder weapon has one.
          critBonus: 0.04,
        };
      }
    }

    if (spec.carries === 'relic') {
      const slot = spec.slot!;
      out[signatureRelicId(spec)] = {
        id: signatureRelicId(spec),
        name: `${spec.epithet} ${SIGNATURE_RELIC_NOUN[slot]}`,
        slot,
        quality,
        value: Math.round(value * 0.85),
        armor: Math.max(1, Math.round(curveArmorTotal(level) * ARMOR_SLOT_SHARE[slot] * SIGNATURE_POWER)),
        attributes: {
          vitality: Math.round(level * 0.45),
          strength: Math.round(level * 0.2),
          focus: Math.round(level * 0.2),
          dexterity: Math.round(level * 0.2),
        },
        ...RELIC_AFFIX[slot](level),
      };
    }
  }
  return out;
}

/**
 * One affix per slot, chosen so a full signature set is a spread of small
 * advantages rather than one stacked stat.
 */
const RELIC_AFFIX: Record<Exclude<EquipSlot, 'weapon'>, (level: number) => Partial<ItemDef>> = {
  head: (level) => ({ healthBonus: Math.round(level * 4) }),
  chest: (level) => ({ healthBonus: Math.round(level * 7) }),
  legs: () => ({ moveSpeedBonus: 0.35 }),
  ring: (level) => ({ critBonus: 0.03, healthBonus: Math.round(level * 2) }),
};

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}
