import type { Vec2 } from '../sim/types.js';
import type { StructureDef, StructureKind } from './structures.js';

/**
 * Things worth walking to.
 *
 * Three kilometres of ground had exactly two reasons to be crossed: a camp at
 * the far end, and a quest arrow pointing at it. Landmarks existed and were
 * *navigation furniture* — you steered by the watchtower, you never went to
 * it. The obvious fix is more camps, and it is the wrong one for the same
 * reason it was wrong for the empty country: a camp is a grinding spot, and
 * making every part of the map a grinding spot makes every part of the map the
 * same part of the map.
 *
 * A discovery is the opposite of a camp. It is **once, ever**, it is *found*
 * rather than farmed, and what it pays cannot be got by killing anything.
 *
 * Five rules hold it together:
 *
 * - **Only out in the country.** A landmark that was placed to *explain*
 *   something — the ruin over a boss's ground, the tower on a holding, the
 *   farmstead at a shopfront — sits deliberately inside the thing it explains,
 *   which is right for a landmark and wrong for anywhere you have to stand
 *   still: a test caught a ruin fourteen metres from a Clan Axeman, and
 *   searching there is not a discovery, it is an ambush.
 * - **Once each, forever.** Anything you can go back to is a grinding spot
 *   with extra steps, and the whole feeling being bought here is "nobody else
 *   is getting this one".
 * - **They are not on the map until you find them.** A map that lists them is
 *   a checklist, and walking a checklist is errand-running, not exploring.
 *   Once found they *are* on it, so the map slowly becomes a record of where
 *   you have actually been.
 * - **They never pay in equipment.** Every piece of gear in this game is
 *   earned off a drop table, a boss or a trader, and a chest in a field that
 *   beat any of those would make all three pointless. A cairn pays in a
 *   blessing that expires; a cache pays in the coin and goods the economy
 *   already runs on.
 * - **What a landmark holds is a property of the landmark.** Hashed from where
 *   it stands, never rolled — so it cannot draw from `World.rng` (the lesson
 *   roaming and the weather both had to learn), and so two players who walk to
 *   the same cairn in the same world find the same thing there.
 * - **The blessing is worth using, not banking.** It runs on a clock from the
 *   moment you take it, which is what makes finding one on the way to a boss
 *   different from finding one on the way home.
 */

export type DiscoveryKind = 'boon' | 'cache';

export interface BoonDef {
  id: string;
  name: string;
  /** What it reads as in the log. */
  line: string;
  minutes: number;
  /** Multiplier on outgoing weapon damage. */
  damageMultiplier?: number;
  /** Flat defence, scaled by level the same way a defensive skill is. */
  defenseBonus?: number;
  /** Health a second. */
  regenPerSec?: number;
  /** Units a second on top of your movement. */
  moveSpeedBonus?: number;
}

/**
 * Six blessings, one per site.
 *
 * Deliberately not "a potion, but bigger": each is something you cannot buy,
 * and each changes a different thing about the next ten minutes so that which
 * one you found matters. The numbers are modest — a blessing is a good hour,
 * not a different character.
 */
export const BOONS: BoonDef[] = [
  {
    id: 'boon_hunt',
    name: "The Hunter's Blessing",
    line: 'Your arm feels lighter.',
    minutes: 12,
    damageMultiplier: 1.14,
  },
  {
    id: 'boon_ward',
    name: 'The Warding',
    line: 'The stones stand between you and what is coming.',
    minutes: 12,
    defenseBonus: 55,
  },
  {
    id: 'boon_mend',
    name: 'The Quiet Water',
    line: 'Something here is closing your cuts.',
    minutes: 10,
    regenPerSec: 6,
  },
  {
    id: 'boon_swift',
    name: 'The Long Stride',
    line: 'The ground goes by faster than it should.',
    minutes: 10,
    moveSpeedBonus: 1.9,
  },
  {
    id: 'boon_old',
    name: 'The Old Rite',
    line: 'Whoever raised this meant it kindly.',
    minutes: 14,
    damageMultiplier: 1.08,
    defenseBonus: 30,
  },
  {
    id: 'boon_wake',
    name: 'The Wakeful Watch',
    line: 'You could walk all night on this.',
    minutes: 14,
    moveSpeedBonus: 1.1,
    regenPerSec: 3,
  },
];

/**
 * Which landmarks hold which sort of thing.
 *
 * A cairn is a marker somebody raised and a stone circle is a place somebody
 * kept, so those hold a blessing; a farmstead, a wreck or an abandoned camp is
 * somewhere people *lived*, so those hold what people leave behind. The kind
 * of landmark is therefore a promise about what is in it, which is what makes
 * spotting one from four hundred metres worth anything.
 */
const HOLDS: Partial<Record<StructureKind, DiscoveryKind>> = {
  cairn: 'boon',
  stoneCircle: 'boon',
  farmstead: 'cache',
  wreck: 'cache',
  camp: 'cache',
  ruin: 'cache',
};

/** How close you have to be standing. Generous: this is not a precision test. */
export const DISCOVERY_RANGE = 7;

/**
 * How far off you can see one you have not opened yet.
 *
 * Well past the nameplate range and short of the fog: a landmark is how you
 * navigate, and a mark you can only see from on top of it does not change how
 * anybody walks.
 */
export const DISCOVERY_SIGHT = 90;

export interface DiscoverySite {
  /** Stable across saves: derived from where it stands, never from an index. */
  id: string;
  pos: Vec2;
  kind: DiscoveryKind;
  structure: StructureKind;
  /** For a boon: which one. */
  boon?: BoonDef;
  /** For a cache: how much it is worth, as a multiple of an ordinary kill. */
  worth: number;
}

/** Deterministic, and never through `World.rng`. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  return (h ^ (h >>> 15)) >>> 0;
}

/**
 * How many of a zone's landmarks hold something.
 *
 * Not all of them, on purpose. If every cairn paid out, a cairn would be a
 * vending machine and walking to one would be a chore rather than a punt —
 * and the ones that hold nothing are what make the ones that do feel found.
 */
export const DISCOVERY_SHARE = 0.55;

export function discoveriesFor(zoneId: string, structures: StructureDef[]): DiscoverySite[] {
  const out: DiscoverySite[] = [];
  for (const st of structures) {
    if (st.anchored) continue;
    const kind = HOLDS[st.kind];
    if (!kind) continue;
    // Keyed on the position, so a site keeps its identity when the list around
    // it changes — an index would silently re-point every save the moment
    // anybody added a landmark.
    const id = `${zoneId}:${Math.round(st.pos.x)}:${Math.round(st.pos.z)}`;
    const h = hash(id);
    if ((h % 1000) / 1000 > DISCOVERY_SHARE) continue;
    out.push({
      id,
      pos: st.pos,
      kind,
      structure: st.kind,
      boon: kind === 'boon' ? BOONS[h % BOONS.length] : undefined,
      // Worth what a decent run of the local camp is worth, so a cache is a
      // good half hour rather than a shortcut past one.
      worth: kind === 'cache' ? 18 + ((h >>> 8) % 15) : 0,
    });
  }
  return out;
}

/** What a site says on the map and in the log once you have opened it. */
export function discoveryName(site: DiscoverySite): string {
  if (site.kind === 'boon') return site.boon!.name;
  switch (site.structure) {
    case 'wreck':
      return 'A wrecked boat';
    case 'camp':
      return 'An abandoned camp';
    case 'ruin':
      return 'A ruin';
    default:
      return 'An empty farmstead';
  }
}
