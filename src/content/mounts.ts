import type { Vec2 } from '../sim/types.js';

/**
 * Horses, and how you get one.
 *
 * You do not buy a mount and you cannot loot one. Wild horses run in their own
 * herds, and taking one is a *fight you have to lose gently*: beat it down
 * below `CAPTURE_THRESHOLD` and then use `capture` instead of hitting it
 * again. Kill it and you get nothing — no loot table, no experience worth the
 * name. The whole mechanic is knowing when to stop.
 *
 * That is deliberately the opposite of everything else in the game. Every
 * other creature in Dal Riata is a health bar you empty. A horse is the one
 * you have to leave something in.
 *
 * Each herd carries a different bonus, so a mount is a real choice rather than
 * a speed upgrade: the cob is faster, the courser hits harder, the destrier
 * takes hits, and one of them is a thing almost nobody will ever ride.
 */

/**
 * What kind of animal it is, which is also its rarity.
 *
 * Three families rather than one ladder of numbers, because "rarer" has to mean
 * something you can see. A horse is a horse; a dire wolf is obviously not; a
 * unicorn is the only one of its kind in Dal Riata and everyone who has one
 * knows exactly how long it took.
 */
export type MountKind = 'horse' | 'direwolf' | 'unicorn';

export interface MountDef {
  id: string;
  kind: MountKind;
  name: string;
  /** Shown when you get one, and in the panel. */
  blurb: string;
  /** Wild mob you capture it from. */
  mobId: string;
  zoneId: string;
  level: number;
  /** Where the herd runs. */
  herd: Vec2;
  /** How many run in it. */
  count: number;
  /**
   * Chance the capture takes, per attempt, once it is weak enough.
   *
   * The legendary is not rarer to *find* — it is rarer to *keep*. A herd you
   * can walk to and a horse that shrugs you off nine times in ten is a much
   * better story than a spawn timer.
   */
  captureChance: number;
  /** Movement speed, replacing the on-foot 5.2. */
  speed: number;
  /** What riding it is worth, on top of the speed. */
  bonus: {
    damageBonus?: number;
    armorBonus?: number;
    healthBonus?: number;
    regenBonus?: number;
  };
  view: { color: number; height: number; radius: number };
}

/**
 * How often each family lets you take it, as a band.
 *
 * The ladder is the whole feature: a horse is a good evening, a dire wolf is a
 * project, and a unicorn is something you tell people about. A test asserts no
 * member of a rarer family is ever easier to take than any member of a commoner
 * one, so the ladder cannot quietly invert when somebody tunes one number.
 */
export const KIND_RARITY: Record<MountKind, { max: number; min: number }> = {
  horse: { max: 0.45, min: 0.1 },
  direwolf: { max: 0.2, min: 0.12 },
  unicorn: { max: 0.05, min: 0.03 },
};

/** Health fraction a horse has to be under before it will let you near it. */
export const CAPTURE_THRESHOLD = 0.25;

/** How close you have to be. Closer than weapon range — you are grabbing it. */
export const CAPTURE_RANGE = 3;

/**
 * A telegraphed hit throws you off.
 *
 * Same rule as breaking a cast: the big obvious ones always land, ordinary
 * swings never do. Being unseated by chip damage would mean nobody ever rode
 * anything into a fight, which would make the whole mount pointless the moment
 * combat started.
 */
export const UNSEAT_ON_HEAVY = true;

export const MOUNTS: MountDef[] = [
  // --- horses: what most people ride ---------------------------------------
  {
    id: 'moor_cob',
    kind: 'horse',
    name: 'Moor Cob',
    blurb: 'Short, shaggy, and quicker over bad ground than anything has a right to be.',
    mobId: 'wild_cob',
    zoneId: 'fenmarch',
    level: 12,
    herd: { x: 680, z: 470 },
    count: 5,
    captureChance: 0.45,
    speed: 11,
    bonus: { regenBonus: 1.5 },
    view: { color: 0x8a7355, height: 1.9, radius: 0.8 },
  },
  {
    id: 'hill_courser',
    kind: 'horse',
    name: 'Hill Courser',
    blurb: 'Bred by the clans for running men down. It has not forgotten.',
    mobId: 'wild_courser',
    zoneId: 'ardmoor',
    level: 32,
    herd: { x: -720, z: 220 },
    count: 5,
    captureChance: 0.38,
    speed: 11.8,
    bonus: { damageBonus: 22 },
    view: { color: 0x6d5a44, height: 2.05, radius: 0.85 },
  },
  {
    id: 'wood_destrier',
    kind: 'horse',
    name: 'Drowned Wood Destrier',
    blurb: 'Heavy, patient, and entirely unbothered by standing water or shouting.',
    mobId: 'wild_destrier',
    zoneId: 'reach',
    level: 58,
    herd: { x: 700, z: 330 },
    count: 4,
    captureChance: 0.34,
    speed: 11.4,
    bonus: { armorBonus: 90, healthBonus: 700 },
    view: { color: 0x4f5a4a, height: 2.2, radius: 0.95 },
  },
  {
    id: 'ashen_grey',
    kind: 'horse',
    name: 'The Ashen Grey',
    blurb:
      'One horse, in the whole of Caer Dubh, that the twilight does not seem to touch. Nobody has ridden it. Several have tried.',
    mobId: 'wild_ashen_grey',
    zoneId: 'caer_dubh',
    level: 96,
    herd: { x: -780, z: 300 },
    // It runs alone. A herd of legendaries is not a legendary.
    count: 1,
    // One attempt in ten. You will spend a long evening on this.
    captureChance: 0.1,
    speed: 15.2,
    bonus: { damageBonus: 70, armorBonus: 120, healthBonus: 1400, regenBonus: 12 },
    view: { color: 0xd8d2e4, height: 2.35, radius: 1 },
  },

  // --- dire wolves: rarer, faster, and they bite ----------------------------
  //
  // A wolf is not a bigger horse. It is worth more of everything a fight cares
  // about and less of what a journey does, which is why both families exist:
  // the horse you take to cross the map, the wolf you take to a camp.
  {
    id: 'fen_direwolf',
    kind: 'direwolf',
    name: 'Fenmarch Dire Wolf',
    blurb: 'Half again the size of the bog wolves, and it watched you for a while before you saw it.',
    mobId: 'wild_fen_direwolf',
    zoneId: 'fenmarch',
    level: 24,
    herd: { x: -900, z: 120 },
    count: 4,
    captureChance: 0.2,
    speed: 13.2,
    bonus: { damageBonus: 34, regenBonus: 3 },
    view: { color: 0x554b45, height: 1.75, radius: 0.82 },
  },
  {
    id: 'crag_direwolf',
    kind: 'direwolf',
    name: 'Crag Dire Wolf',
    blurb: 'Grey on grey rock. The clans do not hunt these and will tell you why at length.',
    mobId: 'wild_crag_direwolf',
    zoneId: 'ardmoor',
    level: 40,
    herd: { x: 880, z: -260 },
    count: 4,
    captureChance: 0.16,
    speed: 14,
    bonus: { damageBonus: 62, armorBonus: 70, regenBonus: 5 },
    view: { color: 0x6b6a63, height: 1.85, radius: 0.86 },
  },
  {
    id: 'drowned_direwolf',
    kind: 'direwolf',
    name: 'Drowned Dire Wolf',
    blurb: 'It swims better than you walk, and it has been following the boat for an hour.',
    mobId: 'wild_drowned_direwolf',
    zoneId: 'reach',
    level: 68,
    herd: { x: -840, z: -420 },
    count: 3,
    captureChance: 0.13,
    speed: 14.6,
    bonus: { damageBonus: 105, armorBonus: 130, healthBonus: 900, regenBonus: 9 },
    view: { color: 0x3f4a44, height: 1.95, radius: 0.9 },
  },

  // --- and the one that should not exist -----------------------------------
  {
    id: 'caer_unicorn',
    kind: 'unicorn',
    name: 'The Pale of Caer Dubh',
    blurb:
      'The only impossible thing in Dal Riata that does not have wings. It has let nobody near it, which is not the same as nobody having tried.',
    mobId: 'wild_unicorn',
    zoneId: 'caer_dubh',
    level: 98,
    herd: { x: 920, z: -520 },
    count: 1,
    // One attempt in twenty-five. This is the longest grind in the game that is
    // not a level, and it is meant to be.
    captureChance: 0.04,
    speed: 18.2,
    bonus: { damageBonus: 150, armorBonus: 210, healthBonus: 2600, regenBonus: 22 },
    view: { color: 0xf0ecf7, height: 2.4, radius: 0.98 },
  },
];

/** Every mount of a family, commonest first. */
export function mountsOfKind(kind: MountKind): MountDef[] {
  return MOUNTS.filter((m) => m.kind === kind);
}

export function getMount(id: string): MountDef {
  const mount = MOUNTS.find((m) => m.id === id);
  if (!mount) throw new Error(`Unknown mount: ${id}`);
  return mount;
}

/** The mount a given wild horse yields, if any. */
export function mountForMob(mobId: string): MountDef | undefined {
  return MOUNTS.find((m) => m.mobId === mobId);
}

export function mountsIn(zoneId: string): MountDef[] {
  return MOUNTS.filter((m) => m.zoneId === zoneId);
}
