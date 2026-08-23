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

export interface MountDef {
  id: string;
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
  {
    id: 'moor_cob',
    name: 'Moor Cob',
    blurb: 'Short, shaggy, and quicker over bad ground than anything has a right to be.',
    mobId: 'wild_cob',
    zoneId: 'fenmarch',
    level: 12,
    herd: { x: 62, z: 44 },
    count: 5,
    captureChance: 0.45,
    speed: 7.6,
    bonus: { regenBonus: 1.5 },
    view: { color: 0x8a7355, height: 1.9, radius: 0.8 },
  },
  {
    id: 'hill_courser',
    name: 'Hill Courser',
    blurb: 'Bred by the clans for running men down. It has not forgotten.',
    mobId: 'wild_courser',
    zoneId: 'ardmoor',
    level: 32,
    herd: { x: -66, z: 20 },
    count: 5,
    captureChance: 0.35,
    speed: 8.2,
    bonus: { damageBonus: 22 },
    view: { color: 0x6d5a44, height: 2.05, radius: 0.85 },
  },
  {
    id: 'wood_destrier',
    name: 'Drowned Wood Destrier',
    blurb: 'Heavy, patient, and entirely unbothered by standing water or shouting.',
    mobId: 'wild_destrier',
    zoneId: 'reach',
    level: 58,
    herd: { x: 64, z: 30 },
    count: 4,
    captureChance: 0.3,
    speed: 7.9,
    bonus: { armorBonus: 90, healthBonus: 700 },
    view: { color: 0x4f5a4a, height: 2.2, radius: 0.95 },
  },
  {
    id: 'ashen_grey',
    name: 'The Ashen Grey',
    blurb:
      'One horse, in the whole of Caer Dubh, that the twilight does not seem to touch. Nobody has ridden it. Several have tried.',
    mobId: 'wild_ashen_grey',
    zoneId: 'caer_dubh',
    level: 96,
    herd: { x: -70, z: 28 },
    // It runs alone. A herd of legendaries is not a legendary.
    count: 1,
    // One attempt in twelve. You will spend a long evening on this.
    captureChance: 0.08,
    speed: 9.4,
    bonus: { damageBonus: 70, armorBonus: 120, healthBonus: 1400, regenBonus: 12 },
    view: { color: 0xd8d2e4, height: 2.35, radius: 1 },
  },
];

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
