import type { ClassId, ItemDef, Vec2 } from '../sim/types.js';
import { curveWeaponDps } from './curves.js';

/**
 * Dragons: the one mythical thing in a deliberately grounded world.
 *
 * Everything else here is wildlife and people. That is the whole reason a
 * dragon works — put griffons and wyrms and trolls in the same hills and a
 * dragon is just the biggest monster on a list. Leave it as the only creature
 * in Dal Riata that should not exist and it is an event.
 *
 * A dragon is **not a boss with a spawn point**. Bosses stand where the zone
 * layout puts them and wait. A dragon:
 *
 *  - lives in world state, not in `ZoneDef.spawns`
 *  - sleeps in a lair for a long time, then wakes and goes hunting
 *  - moves between the holdings of its territory on its own schedule
 *  - drives whoever garrisons a holding off it while it is there, which stops
 *    that front dead — a third power the factions cannot negotiate with
 *  - cannot be tamed, ridden, farmed or camped
 *
 * That last point is the design. The rare spawns are things you camp; the
 * bosses are things you plan. A dragon is a thing that happens to the world
 * while you are doing something else, and the only question it asks is
 * whether you are strong enough to go and deal with it.
 */

export type DragonPhase =
  /** In its lair, out of the world. Most of a dragon's life. */
  | 'dormant'
  /** Awake and moving toward the next holding in its territory. */
  | 'hunting'
  /** Sitting over a holding. This is when you can fight it. */
  | 'roosting'
  /** Killed. Something else will wake eventually. */
  | 'slain';

export interface DragonDef {
  id: string;
  /** `Vharok` — used alone in banners, because that is how a name gets feared. */
  name: string;
  /** The full mouthful, for the realm panel. */
  title: string;
  zoneId: string;
  level: number;
  /**
   * The zone's ★6 elite boss. A dragon's stat block is derived from it.
   *
   * Anchoring to the curve instead produced a difficulty curve running the
   * wrong way: the Fenmarch's elite is hand-tuned and soft, Caer Dubh's is
   * generated and hard, so one flat multiplier made the first dragon a
   * pushover and the last one a coin flip. Anchored to the elite, every dragon
   * is the same step beyond whatever ends its own zone.
   */
  eliteId: string;
  /**
   * Health and damage as multiples of that elite boss.
   *
   * Per dragon rather than one constant, because the elite bosses are not
   * uniformly tuned themselves — Old Scar is hand-written and gentle, Muireann
   * is generated and already a coin flip — so a single multiplier made the
   * first dragon a pushover and the rest unbeatable. These are hand-fitted
   * against the printed table in `test/balance.test.ts`, the same way the
   * Fenmarch's bestiary is.
   */
  toughness: number;
  menace: number;
  /** Holdings it visits, in order. Its territory, and the ground it ruins. */
  territory: string[];
  /** Where it sleeps. Shown on the map even when it is not out. */
  lair: Vec2;
  /** Years, purely so the panel can say something a stat block cannot. */
  age: number;
  /** One line when it wakes. */
  waking: string;
  /** One line when it settles over a holding. */
  arrival: string;
  view: { color: number; height: number; radius: number };
}

/**
 * How long a dragon spends in each phase, in minutes of play.
 *
 * Long. A dragon you see every ten minutes is a rare spawn with a bigger
 * health bar; the point of the dormancy is that when a banner does say
 * `Vharok stirs`, you stop what you are doing.
 */
export const DRAGON_DORMANT_MIN = 26;
export const DRAGON_HUNT_MIN = 1.5;
export const DRAGON_ROOST_MIN = 7;

/** Dormancy after one is actually killed — long enough that it counts. */
export const DRAGON_SLAIN_MIN = 45;

/**
 * How much harder than the zone's elite boss a dragon is.
 *
 * Star rating stops at ★6, and adding a seventh would mean re-fitting
 * `STAR_MODIFIERS` and every rule keyed to "★5 is a boss, ★6 is an elite" for
 * one creature. So a dragon is ★6 and carries its difficulty in a multiplier
 * instead — which also keeps `isBoss` meaning what it has always meant.
 *
 * Expressed as a multiple of the zone's own elite boss, so a dragon is the
 * same step beyond whatever ends its zone however that boss is tuned.
 */
export const DRAGON_TOUGHNESS = 1.6;

/**
 * A dragon sits AT the top of its zone's band, not above it.
 *
 * Level gap drives both accuracy and mitigation, so three levels of headroom
 * turned every dragon into a cliff: unwinnable at the cap, trivial four levels
 * later. It also cannot work for Caer Dubh, where the cap is the level cap and
 * there is no "come back stronger". A dragon carries its difficulty in its
 * stat block instead, where it can be tuned smoothly.
 */
export const DRAGON_LEVEL_BONUS = 0;

export const DRAGONS: DragonDef[] = [
  {
    id: 'saorla',
    eliteId: 'old_scar',
    toughness: 1.75,
    menace: 1.12,
    name: 'Saorla',
    title: 'Saorla, the Fen Wyrm',
    zoneId: 'fenmarch',
    level: 25,
    territory: ['road_watch', 'southern_marsh'],
    lair: { x: -96, z: -108 },
    age: 340,
    waking: 'Something in the southern fen has woken up, and the birds have gone.',
    arrival: 'Saorla settles over the ground. Whoever was holding it is running.',
    view: { color: 0x6f8f5a, height: 4.2, radius: 2.1 },
  },
  {
    id: 'crannach',
    eliteId: 'muireann',
    toughness: 1.3,
    menace: 0.88,
    name: 'Crannach',
    title: 'Crannach of the Cold Shelves',
    zoneId: 'ardmoor',
    level: 40,
    territory: ['cattle_road', 'high_shelves'],
    lair: { x: 92, z: -104 },
    age: 610,
    waking: 'The high shelves have gone quiet. Even the wind sounds careful.',
    arrival: 'Crannach comes down on the ridge and the clan break and run.',
    view: { color: 0x8e9aa6, height: 4.6, radius: 2.3 },
  },
  {
    id: 'oanach',
    eliteId: 'old_cauldron',
    toughness: 1.2,
    menace: 0.9,
    name: 'Oanach',
    title: 'Oanach, the Drowned Worm',
    zoneId: 'reach',
    level: 70,
    territory: ['drowned_causeway', 'deepwood'],
    lair: { x: -98, z: -100 },
    age: 1120,
    waking: 'The standing water is moving against the wind.',
    arrival: 'Oanach hauls itself onto the causeway. The wreckers do not stay.',
    view: { color: 0x4a7a68, height: 5, radius: 2.5 },
  },
  {
    id: 'vharok',
    eliteId: 'donnchadh',
    toughness: 1.25,
    menace: 0.74,
    name: 'Vharok',
    title: 'Vharok, Last of the Ashen',
    zoneId: 'caer_dubh',
    level: 100,
    territory: ['black_road', 'gatehouse'],
    lair: { x: 96, z: -110 },
    age: 1843,
    waking: 'The twilight over Caer Dubh has gone the colour of a burn.',
    arrival: 'Vharok lands on the road. The warband abandons the position entirely.',
    view: { color: 0x7a4a6b, height: 5.6, radius: 2.8 },
  },
];

export function getDragon(id: string): DragonDef {
  const dragon = DRAGONS.find((d) => d.id === id);
  if (!dragon) throw new Error(`Unknown dragon: ${id}`);
  return dragon;
}

export function dragonsIn(zoneId: string): DragonDef[] {
  return DRAGONS.filter((d) => d.zoneId === zoneId);
}

export function dragonMobId(def: DragonDef): string {
  return `dragon_${def.id}`;
}

export function dragonLootTableId(def: DragonDef): string {
  return `dragon_${def.id}_loot`;
}

/** The legendary a dragon carries, per class. */
export function dragonWeaponId(def: DragonDef, classId: ClassId): string {
  return `wyrm_${def.id}_${classId}`;
}

export function dragonWeapons(def: DragonDef): Partial<Record<ClassId, string>> {
  const out: Partial<Record<ClassId, string>> = {};
  for (const classId of Object.keys(WYRM_NOUN) as ClassId[]) {
    out[classId] = dragonWeaponId(def, classId);
  }
  return out;
}

const WYRM_NOUN: Record<ClassId, string> = {
  warrior: 'Fang',
  priest: 'Relic',
  ranger: 'Talon',
  rogue: 'Claw',
  mage: 'Ember',
};

const WYRM_FEEL: Record<
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
 * How far above the curve a dragon's weapon sits.
 *
 * The highest number in the game, and it should be: this is the only item you
 * cannot get by camping, buying, questing or planning. It is above the rare
 * spawns' 1.22 because a signature weapon costs an hour of camping and this
 * costs beating the hardest thing in the zone at a moment you did not choose.
 */
const WYRM_POWER = 1.34;

export function buildDragonItems(): Record<string, ItemDef> {
  const out: Record<string, ItemDef> = {};
  for (const def of DRAGONS) {
    const level = def.level;
    for (const classId of Object.keys(WYRM_FEEL) as ClassId[]) {
      const feel = WYRM_FEEL[classId];
      const avg = (curveWeaponDps(level) * WYRM_POWER * feel.swingMs) / 1000;
      out[dragonWeaponId(def, classId)] = {
        id: dragonWeaponId(def, classId),
        name: `${def.name}'s ${WYRM_NOUN[classId]}`,
        slot: 'weapon',
        quality: 'epic',
        classes: [classId],
        value: Math.round(Math.pow(level, 1.9) * 1.4 * 4.2),
        damageMin: Math.round(avg * 0.78),
        damageMax: Math.round(avg * 1.22),
        damageType: feel.damageType,
        swingMs: feel.swingMs,
        attackRange: feel.attackRange,
        attributes: {
          [feel.primary]: Math.round(level * 1.15),
          vitality: Math.round(level * 0.6),
        },
        // A dragon's weapon carries an affix, like a rare spawn's — this is
        // the one category of drop that is allowed to be strictly special.
        critBonus: 0.05,
      };
    }
  }
  return out;
}
