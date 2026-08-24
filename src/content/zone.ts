import { BOSS_STARS, type Attributes, type ClassId, type Vec2 } from '../sim/types.js';
import { MOBS } from './mobs.js';
import { SHORE_CLEARANCE, getTheme, terrainHeight } from './terrain.js';

/**
 * Zone definition: static spawn points laid out by hand. When this grows past a
 * couple of hundred entries it wants an editor rather than a literal, but the
 * shape stays the same — the sim only ever reads `spawns`.
 */
export interface SpawnPoint {
  mobId: string;
  pos: Vec2;
  /**
   * Marks this spawn as a deliberate guard for the named boss.
   *
   * Guards are *meant* to sit inside the boss's approach — you clear them, then
   * pull the boss. Everything else must stay far enough away that meleeing the
   * boss cannot drag an unrelated camp into the fight, which `balance.test.ts`
   * enforces. Without this flag the check cannot tell a designed gauntlet from
   * a levelling camp that drifted too close.
   */
  guardOf?: string;
  /**
   * Marks this as a guard post for a holding.
   *
   * A post's `mobId` is a fallback: what actually stands here is decided by
   * whoever holds the ground right now. Take the Road Watch off the outlaws
   * and the bowmen are replaced by whatever the Freeholders keep there —
   * which is the whole point of the territory layer being visible at all.
   */
  holding?: string;
}

export interface VendorPlacement {
  vendorId: string;
  pos: Vec2;
}

/**
 * A road out of the zone.
 *
 * Zone bands deliberately overlap (1-25, 20-40, 40-70, 70-100), so `minLevel`
 * is set at the bottom of the destination's band: you may leave as soon as the
 * next zone has anything you can fight, not once you have exhausted this one.
 */
export interface ZoneExit {
  toZoneId: string;
  pos: Vec2;
  label: string;
  minLevel: number;
}

export interface ZoneDef {
  id: string;
  name: string;
  /** Half-extent of the playable square, in world units. */
  halfSize: number;
  playerStart: Vec2;
  spawns: SpawnPoint[];
  /**
   * Traders. Placed clear of every camp's aggro radius — a vendor you have to
   * fight your way to and then get pulled off is not a shop, and a test
   * enforces the clearance.
   */
  vendors: VendorPlacement[];
  exits: ZoneExit[];
  /** Level band this zone is built for, shown in the UI and used by tests. */
  levelRange: [number, number];
  /**
   * Which entry in `content/terrain.ts` decides how this place looks: ground
   * shape, palette, light, fog and scatter. Renderer-only — the sim never reads
   * it. Omitted means the default plains theme, which is what test arenas want.
   */
  theme?: string;
  /**
   * Whether this zone's camps can turn up rare spawns. Defaults to true.
   *
   * Test arenas set it false. A duel against a named mob you did not ask for
   * is a test measuring the wrong creature, and even the roll itself is not
   * free: it draws from the same `Rng` as combat, so leaving it on would shift
   * every seeded fight in the balance corpus.
   */
  rareSpawns?: boolean;
  /**
   * Whether other adventurers are out in this zone. Defaults to true.
   *
   * Off in test arenas, for the same reason as `rareSpawns`: they wander and
   * talk on the sim's `Rng`, so a zone with a population in it is a zone where
   * every seeded fight rolls different numbers. A duel is supposed to be a duel.
   */
  adventurers?: boolean;
  /**
   * Whether this zone's camps spawn the same creature at different ratings.
   * Defaults to true.
   *
   * Off in test arenas, for the same reason as `rareSpawns` and `adventurers`:
   * a duel whose opponent is ★1 on one seed and ★4 on the next is measuring
   * the seed, and the roll itself comes out of the same `Rng` as the fight.
   */
  starVariants?: boolean;
}

/**
 * A camp: `count` mobs scattered in a ring around a centre.
 *
 * The angular offset is derived from the centre rather than random, so the zone
 * layout is identical on every load — spawn positions are content, not
 * simulation, and must not depend on the sim's Rng.
 */
/**
 * How big a zone is.
 *
 * Sized against walking speed, not against how much content there is: 3120
 * units across is ten minutes on foot and just under three on the best mount,
 * and `balance.test.ts` fails if either of those drifts. That ratio is the
 * whole argument for mounts existing — a map you can cross in a minute makes a
 * horse a cosmetic.
 *
 * The consequence is that a zone is a hundred times the area it used to be, so
 * nothing here is placed by hand any more: the road and its bands are generated
 * and the wilds either side are filled from the same table. Hand-placing four
 * hundred camps is four hundred chances to put one in a lake.
 */
export const ZONE_HALF = 1560;

/** Where the road starts and ends, north to south. */
// Leaves room north of the road for the arrival point, the traders and the
// road out, and room south of it for the elite boss to stand alone — all of it
// inside the wall, which the sim clamps to and a test checks.
const ROAD_START = ZONE_HALF * 0.78;
const ROAD_END = -ZONE_HALF * 0.88;

/**
 * How far the arrival point sits behind the first camp on the road.
 *
 * It was 190, which is thirty-six seconds of walking before a new character
 * meets anything at all — on a map where the first thing you are told is to
 * click a beast. A zone this size can afford a long walk anywhere except at
 * the very start, where the walk is the whole first impression.
 */
const ARRIVAL_GAP = 105;

/** How far off the road the near camps sit. */
const ROAD_OFFSET = 165;

/** Where the wilds begin, and how far apart camps are out there. */
const WILD_FROM = 560;
const WILD_STEP = 330;

/** Camp size, now that there is room for one. */
const CAMP_RADIUS = 17;
/**
 * Mobs per camp.
 *
 * Bigger than it was, because the walk between camps is now amortised over the
 * camp: the pacing test measures what fraction of the game is spent walking,
 * and six-mob camps on a map this size put it over half.
 */
const CAMP_COUNT = 8;

/**
 * Nudge a point onto dry, buildable ground.
 *
 * Zones have lakes in them now, and a camp at the bottom of one is a camp you
 * cannot fight in. Spirals outward from the authored spot until it finds land,
 * which keeps the layout table readable — it says where a camp belongs, and
 * this says where it actually fits.
 */
function dryPlace(
  x: number,
  z: number,
  themeId: string | undefined,
  rings = 14,
  step = 34,
): Vec2 {
  const spec = getTheme(themeId).terrain;
  const water = spec.waterLevel;
  const limit = ZONE_HALF * 0.96;
  const clamp = (v: number): number => Math.max(-limit, Math.min(limit, v));
  if (water === undefined) return { x: clamp(x), z: clamp(z) };

  for (let ring = 0; ring < rings; ring++) {
    const r = ring * step;
    const steps = ring === 0 ? 1 : 8;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2 + ring;
      const px = clamp(x + Math.cos(a) * r);
      const pz = clamp(z + Math.sin(a) * r);
      if (terrainHeight(px, pz, spec) > water + SHORE_CLEARANCE) return { x: px, z: pz };
    }
  }
  return { x: clamp(x), z: clamp(z) };
}

function camp(
  mobId: string,
  cx: number,
  cz: number,
  radius: number,
  count: number,
  theme?: string,
): SpawnPoint[] {
  const out: SpawnPoint[] = [];
  const offset = (Math.abs(cx * 7 + cz * 13) % 100) / 100;
  for (let i = 0; i < count; i++) {
    const a = ((i / count) + offset) * Math.PI * 2;
    // Alternate between the ring and a tighter inner ring so camps don't read
    // as perfect circles.
    const r = radius * (i % 2 === 0 ? 1 : 0.55);
    // Every point, not just the centre: a dry camp centre with two of its ring
    // standing in a tarn is still two creatures standing in a tarn.
    const at = dryPlace(cx + Math.cos(a) * r, cz + Math.sin(a) * r, theme, 5, 12);
    out.push({ mobId, pos: at });
  }
  return out;
}

/**
 * A herd of wild mounts.
 *
 * Well off the road on purpose. They have no aggro radius, so a herd is a place
 * you go rather than a thing you walk into — and finding one should feel like
 * noticing something, not like being ambushed by it.
 */
function herd(mobId: string, cx: number, cz: number, count: number, theme?: string): SpawnPoint[] {
  const at = dryPlace(cx, cz, theme);
  return camp(mobId, at.x, at.z, count > 2 ? 26 : 10, count, theme);
}

/** Mark a camp's spawn points as the guard posts of a holding. */
function post(holding: string, spawns: SpawnPoint[]): SpawnPoint[] {
  return spawns.map((sp) => ({ ...sp, holding }));
}

/**
 * One band of the zone: a creature, and how far down the road you meet it.
 *
 * `wilds` is how many camps of it stand out in the open country either side.
 * That number is what makes a big map worth crossing rather than a long
 * corridor with grass on both sides — and it is what makes a five-minute
 * respawn survivable, because there is always another camp.
 */
interface BandSpec {
  mobId: string;
  /** Position along the road: 0 is the arrival point, 1 is the far end. */
  at: number;
  /** Makes this band the guard posts of a holding rather than a plain camp. */
  holding?: string;
  /** Camps out in the wilds, split either side of the road. */
  wilds?: number;
}

/**
 * Lay a zone out from its bands.
 *
 * Difficulty runs north to south along the road, exactly as it did when this
 * was four hand-written literals; what is new is everything either side of it.
 */
function layout(theme: string, bands: BandSpec[]): SpawnPoint[] {
  const out: SpawnPoint[] = [];
  for (const [index, band] of bands.entries()) {
    const z = ROAD_START + (ROAD_END - ROAD_START) * band.at;
    const points: SpawnPoint[] = [];

    // The road itself: three camps you cannot miss walking past.
    // Three camps close enough together to rotate through while the first one
    // comes back, which is what makes a five-minute respawn a reason to move
    // rather than a reason to stand still.
    for (const [dx, dz] of [
      [-ROAD_OFFSET, 0],
      [ROAD_OFFSET, -35],
      [0, -125],
    ] as Array<[number, number]>) {
      const at = dryPlace(dx, z + dz, theme);
      points.push(...camp(band.mobId, at.x, at.z, CAMP_RADIUS, CAMP_COUNT, theme));
    }

    // And the wilds. Deterministic from the band index rather than random: a
    // zone whose camps move between loads is a zone nobody can learn.
    for (let w = 0; w < (band.wilds ?? 0); w++) {
      const side = w % 2 === 0 ? -1 : 1;
      const out_ = WILD_FROM + Math.floor(w / 2) * WILD_STEP;
      const wobble = ((index * 37 + w * 61) % 100) / 100;
      const at = dryPlace(side * out_, z - 220 + wobble * 300, theme);
      points.push(...camp(band.mobId, at.x, at.z, CAMP_RADIUS, CAMP_COUNT, theme));
    }

    out.push(...(band.holding ? post(band.holding, points) : points));
  }
  return out;
}

/**
 * The road.
 *
 * Every zone in this game is generated *along* a road — `layout` walks its
 * bands down one, the camps sit either side of it, the traders stand at the
 * top of it and the way out is at the bottom. It has been the organising idea
 * of the whole map since the zones were four hand-written literals, and until
 * now there was nothing on the ground to show for it. The map was doing all
 * the work of telling you where the road was, which is a strange thing to ask
 * of a map when the road is the one feature you could simply *draw*.
 *
 * A polyline rather than a straight line down x=0, for two reasons: a ruler
 * across three kilometres of moor reads as a seam in the terrain rather than
 * as something people wore into it, and — the practical half — a straight line
 * at x=0 goes through whatever lakes happen to be there.
 *
 * Exported as plain points because two very different things need it: the
 * renderer paints it into the ground's vertex colours (no geometry, no draw
 * calls, and it follows the hills for free), and the map draws it as a line.
 * Both from one source, so they cannot disagree about where the road goes.
 */

/** How wide the worn ground is, and how far the edge feathers out past it. */
export const ROAD_HALF_WIDTH = 4.2;
export const ROAD_EDGE = 3.4;

/** Points down the road, north to south. Uniform in z, which `roadOffsetAt` relies on. */
const ROAD_STEPS = 16;

/**
 * Deterministic wander, so the road bends without being random.
 *
 * Derived from the zone id: the Fenmarch's road is the Fenmarch's road on
 * every load, which matters more than it sounds — a route that moves between
 * sessions is one nobody can learn, and learning the route is most of what
 * knowing a zone means.
 */
function roadWander(zoneId: string, i: number): number {
  let h = 2166136261;
  for (let k = 0; k < zoneId.length; k++) {
    h ^= zoneId.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  let x = Math.imul(h ^ (i * 0x9e3779b9), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return ((x >>> 0) / 4294967296) * 2 - 1;
}

/**
 * Where the road runs through a zone.
 *
 * Anchored on the same `ROAD_START`/`ROAD_END` the bands are placed against —
 * it is not a decoration laid over the layout, it is the line the layout was
 * always built on. Each point is nudged onto dry ground, because a road into a
 * lake is worse than no road.
 */
export function roadPoints(zoneId: string, theme: string | undefined): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= ROAD_STEPS; i++) {
    const t = i / ROAD_STEPS;
    const z = ROAD_START + ARRIVAL_GAP + (ROAD_END - 90 - (ROAD_START + ARRIVAL_GAP)) * t;
    // Wide, lazy bends: a road that wiggles every fifty metres reads as a
    // river. The ends are pinned near the middle so the arrival point and the
    // way out are both on it.
    const bend = Math.sin(t * Math.PI) * roadWander(zoneId, i) * 95;
    // A wide search, because the Sunken Wood is a drowned forest and there is
    // not always dry ground within a hundred metres. Every point that has to
    // detour bends the road, which is fine — a road that goes round a lake is
    // what a road does.
    out.push(dryPlace(bend, z, theme, 14, 26));
  }
  return out;
}

/**
 * How far a world position is from the road, and nothing else.
 *
 * Called per ground vertex every time the terrain tile re-centres — a hundred
 * thousand times, several times a second while walking — so it must not walk
 * the whole polyline. The points are uniform in z by construction, so the
 * segment covering a given z is an index rather than a search.
 */
export function roadDistance(road: Vec2[], x: number, z: number): number {
  if (road.length < 2) return Infinity;
  const zStart = road[0]!.z;
  const zEnd = road[road.length - 1]!.z;
  const span = zEnd - zStart;
  const guess = Math.floor(((z - zStart) / span) * (road.length - 1));
  let best = Infinity;
  // The guess plus its neighbours: a bend means the nearest segment is not
  // always the one whose z-range contains the point.
  for (let i = guess - 1; i <= guess + 1; i++) {
    if (i < 0 || i >= road.length - 1) continue;
    const a = road[i]!;
    const b = road[i + 1]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2));
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    best = Math.min(best, Math.hypot(x - px, z - pz));
  }
  return best;
}

/**
 * How many single creatures are scattered across the open country.
 *
 * The wilds measured 45% of the ground more than 250 units — forty-eight
 * seconds' walk — from any creature at all, with the worst spot over a
 * thousand units from anything. That is what "the map feels empty" actually
 * was, and it is worth fixing.
 *
 * The obvious fix is more camps, and it is the wrong one: a camp is a place you
 * *go to*, and scattering more of them makes every part of the map the same
 * part of the map. What open country wants is not more grinding spots, it is
 * **life** — solitary animals you meet on the way somewhere, that give you
 * something to fight while travelling and are useless to farm because there is
 * one of them.
 */
const STRAY_CELLS = 11;

/** How far a stray keeps from anything that is not open country. */
const STRAY_CLEARANCE = 60;

/** Deterministic, so the country is the same country every time you walk it. */
function strayHash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13) ^ (b + 0x27d4eb2f), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Scatter single creatures across a finished zone's empty country.
 *
 * Applied to the **whole** zone rather than from inside `layout`, because the
 * things a stray must not stand on — a boss arena, a shopfront, the arrival
 * point — are added to the literal after the bands are. Doing it inside meant
 * the clearances held by luck, and a clearance that holds by luck is one that
 * breaks the next time somebody changes a constant.
 *
 * A grid rather than a scatter, because the number that matters is the *worst*
 * gap and a Poisson scatter's whole nature is to leave holes — which is the
 * problem being solved. One per cell caps how far you can be from anything at
 * roughly a cell's diagonal, whatever the hash does inside it.
 *
 * What each stray *is* comes from the nearest ordinary camp, so difficulty
 * still runs north to south out in the country and a stray is never something
 * ten levels above the ground it is standing on.
 */
function withStrays(zone: ZoneDef): ZoneDef {
  const cell = (zone.halfSize * 2) / STRAY_CELLS;
  const clear: Vec2[] = [
    zone.playerStart,
    ...zone.vendors.map((v) => v.pos),
    ...zone.exits.map((e) => e.pos),
  ];
  // Only ordinary camps are worth copying: a guard post belongs to its boss, a
  // garrison belongs to its holding, and a herd of horses in the middle of
  // nowhere is a herd, not a stray.
  const sources = zone.spawns.filter((sp) => {
    if (sp.guardOf || sp.holding) return false;
    const def = MOBS[sp.mobId];
    return !!def && def.stars < BOSS_STARS && !def.horse && !def.dragon;
  });
  if (sources.length === 0) return zone;

  // Bosses and their arenas keep a wide berth of their own: a wandering animal
  // inside a telegraph circle is exactly the unrelated pull the arena-isolation
  // test exists to prevent.
  const arenas = zone.spawns.filter((sp) => (MOBS[sp.mobId]?.stars ?? 0) >= BOSS_STARS);

  const out: SpawnPoint[] = [];
  for (let i = 0; i < STRAY_CELLS; i++) {
    for (let j = 0; j < STRAY_CELLS; j++) {
      const x = -zone.halfSize + (i + 0.2 + strayHash(i, j) * 0.6) * cell;
      const z = -zone.halfSize + (j + 0.2 + strayHash(j, i) * 0.6) * cell;
      const at = dryPlace(x, z, zone.theme);

      // Skip cells a camp already covers: one more creature beside eight is
      // not life, it is a rounding error on a camp.
      if (zone.spawns.some((sp) => Math.hypot(sp.pos.x - at.x, sp.pos.z - at.z) < cell * 0.45)) {
        continue;
      }
      if (clear.some((p) => Math.hypot(p.x - at.x, p.z - at.z) < STRAY_CLEARANCE)) continue;
      if (arenas.some((sp) => Math.hypot(sp.pos.x - at.x, sp.pos.z - at.z) < 130)) continue;

      let nearest = sources[0]!;
      let bestGap = Infinity;
      for (const sp of sources) {
        const gap = Math.hypot(sp.pos.x - at.x, sp.pos.z - at.z);
        if (gap < bestGap) {
          bestGap = gap;
          nearest = sp;
        }
      }
      out.push({ mobId: nearest.mobId, pos: at });
    }
  }
  return { ...zone, spawns: [...zone.spawns, ...out] };
}

/** A boss and the guards that belong to it, on levelled ground off the road. */
function arena(bossId: string, guardId: string, at: number, theme: string, guards = 4): SpawnPoint[] {
  const z = ROAD_START + (ROAD_END - ROAD_START) * at;
  const spot = dryPlace(0, z, theme);
  return [
    ...camp(guardId, spot.x, spot.z, 34, guards, theme).map((sp) => ({ ...sp, guardOf: bossId })),
    { mobId: bossId, pos: { x: spot.x, z: spot.z - 4 } },
  ];
}

/**
 * The Fenmarch — the levels 1-25 starting region.
 *
 * Bands running north to south: you arrive at the standing stones on the
 * northern moor and the danger rises the further down you push. Cadfael's
 * outlaw camp sits at the two-thirds mark and Old Scar holds the southern marsh
 * alone. The wilds either side hold the same creatures as the road beside them,
 * so wandering is a choice about scenery and rares rather than a difficulty
 * cliff.
 */
export const FENMARCH: ZoneDef = withStrays({
  id: 'fenmarch',
  name: 'The Fenmarch',
  halfSize: ZONE_HALF,
  playerStart: { x: 0, z: ROAD_START + ARRIVAL_GAP },
  spawns: [
    ...layout('plains', [
      { mobId: 'moor_hare', at: 0.0, wilds: 2 },
      { mobId: 'mossback_boar', at: 0.09, wilds: 3 },
      { mobId: 'fen_adder', at: 0.18, wilds: 3 },
      { mobId: 'bog_wolf', at: 0.27, wilds: 4 },
      { mobId: 'moor_stag', at: 0.36, wilds: 4 },
      { mobId: 'outlaw_bowman', at: 0.45, wilds: 3, holding: 'road_watch' },
      { mobId: 'outlaw_reaver', at: 0.54, wilds: 4 },
      { mobId: 'marsh_bear', at: 0.63, wilds: 3 },
    ]),
    ...arena('cadfael', 'outlaw_reaver', 0.71, 'plains'),
    ...layout('plains', [
      { mobId: 'fen_lynx', at: 0.8, wilds: 4 },
      { mobId: 'outlaw_marauder', at: 0.89, wilds: 3, holding: 'southern_marsh' },
    ]),
    ...herd('wild_cob', 680, 470, 5, 'plains'),
    ...herd('wild_fen_direwolf', -900, 120, 4, 'plains'),
    // No guards and a wide empty approach: Old Scar is meant to be fought with
    // nothing else on the screen.
    { mobId: 'old_scar', pos: { x: 0, z: ROAD_END - 60 } },
  ],
  vendors: [
    // At the standing stones, where you arrive and where you come back to.
    { vendorId: 'maeve', pos: { x: 0, z: ROAD_START + ARRIVAL_GAP + 44 } },
    // And the one whose wagon a level-1 character walks straight past on the
    // way to kill hares. The carrot has to be visible from the beginning.
    { vendorId: 'ceallach', pos: { x: -46, z: ROAD_START + ARRIVAL_GAP + 56 } },
    // Off the road east of the outlaw watch, for the second half of the zone.
    { vendorId: 'bryn', pos: { x: 430, z: -330 } },
  ],
  exits: [
    { toZoneId: 'ardmoor', pos: { x: 760, z: -700 }, label: 'The Hill Road to Ardmoor', minLevel: 20 },
  ],
  levelRange: [1, 25],
  theme: 'plains',
});

// --------------------------------------------------------------------------
// Zones 2-4. Same shape as the Fenmarch, from the same generator.
// --------------------------------------------------------------------------

export const ARDMOOR: ZoneDef = withStrays({
  id: 'ardmoor',
  name: 'Ardmoor',
  halfSize: ZONE_HALF,
  playerStart: { x: 0, z: ROAD_START + ARRIVAL_GAP },
  levelRange: [20, 40],
  theme: 'crags',
  spawns: [
    ...layout('crags', [
      { mobId: 'crag_goat', at: 0.0, wilds: 3 },
      { mobId: 'hill_wolf', at: 0.11, wilds: 4 },
      { mobId: 'cattle_raider', at: 0.22, wilds: 3, holding: 'cattle_road' },
      { mobId: 'moor_eagle', at: 0.33, wilds: 4 },
    ]),
    ...arena('aonghus', 'clan_axeman', 0.44, 'crags'),
    ...layout('crags', [
      { mobId: 'clan_axeman', at: 0.56, wilds: 3, holding: 'high_shelves' },
      { mobId: 'highland_bear', at: 0.68, wilds: 4 },
      { mobId: 'clan_berserker', at: 0.8, wilds: 4 },
    ]),
    ...herd('wild_courser', -720, 220, 5, 'crags'),
    ...herd('wild_crag_direwolf', 880, -260, 4, 'crags'),
    { mobId: 'muireann', pos: { x: 0, z: ROAD_END - 60 } },
  ],
  vendors: [{ vendorId: 'sorcha', pos: { x: 0, z: ROAD_START + ARRIVAL_GAP + 44 } }],
  exits: [
    { toZoneId: 'fenmarch', pos: { x: -640, z: ROAD_START + ARRIVAL_GAP + 60 }, label: 'The Hill Road to the Fenmarch', minLevel: 1 },
    { toZoneId: 'reach', pos: { x: 800, z: -700 }, label: 'The Drowned Causeway', minLevel: 38 },
  ],
});

export const SUNKEN_REACH: ZoneDef = withStrays({
  id: 'reach',
  name: 'The Sunken Wood',
  halfSize: ZONE_HALF,
  playerStart: { x: 0, z: ROAD_START + ARRIVAL_GAP },
  levelRange: [38, 70],
  theme: 'wyldwood',
  spawns: [
    ...layout('wyldwood', [
      { mobId: 'reach_eel', at: 0.0, wilds: 3 },
      { mobId: 'wrecker_scavenger', at: 0.11, wilds: 4 },
      { mobId: 'marsh_heron', at: 0.22, wilds: 4 },
      { mobId: 'smuggler_enforcer', at: 0.33, wilds: 3, holding: 'drowned_causeway' },
    ]),
    ...arena('fiachra', 'smuggler_enforcer', 0.44, 'wyldwood'),
    ...layout('wyldwood', [
      { mobId: 'tidewatch_marauder', at: 0.56, wilds: 3, holding: 'deepwood' },
      { mobId: 'great_pike', at: 0.68, wilds: 4 },
      { mobId: 'grey_seal_bull', at: 0.8, wilds: 4 },
    ]),
    ...herd('wild_destrier', 700, 330, 4, 'wyldwood'),
    ...herd('wild_drowned_direwolf', -840, -420, 3, 'wyldwood'),
    { mobId: 'old_cauldron', pos: { x: 0, z: ROAD_END - 60 } },
  ],
  vendors: [{ vendorId: 'odhran', pos: { x: 0, z: ROAD_START + ARRIVAL_GAP + 44 } }],
  exits: [
    { toZoneId: 'ardmoor', pos: { x: -640, z: ROAD_START + ARRIVAL_GAP + 60 }, label: 'The Causeway to Ardmoor', minLevel: 1 },
    { toZoneId: 'caer_dubh', pos: { x: 800, z: -700 }, label: 'The Black Road to Caer Dubh', minLevel: 66 },
  ],
});

export const CAER_DUBH: ZoneDef = withStrays({
  id: 'caer_dubh',
  name: 'Caer Dubh',
  halfSize: ZONE_HALF,
  playerStart: { x: 0, z: ROAD_START + ARRIVAL_GAP },
  levelRange: [66, 100],
  theme: 'otherworld',
  spawns: [
    ...layout('otherworld', [
      { mobId: 'fort_mastiff', at: 0.0, wilds: 3 },
      { mobId: 'warband_levy', at: 0.11, wilds: 4 },
      { mobId: 'blackshield_spearman', at: 0.22, wilds: 3, holding: 'black_road' },
      { mobId: 'siege_engineer', at: 0.33, wilds: 4 },
    ]),
    ...arena('ruadhan', 'blackshield_spearman', 0.44, 'otherworld'),
    ...layout('otherworld', [
      { mobId: 'warhound_alpha', at: 0.56, wilds: 4 },
      { mobId: 'blackshield_champion', at: 0.68, wilds: 3, holding: 'gatehouse' },
      { mobId: 'fort_warden', at: 0.8, wilds: 4 },
    ]),
    ...herd('wild_ashen_grey', -780, 300, 1, 'otherworld'),
    ...herd('wild_unicorn', 920, -520, 1, 'otherworld'),
    { mobId: 'donnchadh', pos: { x: 0, z: ROAD_END - 60 } },
  ],
  vendors: [{ vendorId: 'aoife', pos: { x: 0, z: ROAD_START + ARRIVAL_GAP + 44 } }],
  exits: [
    { toZoneId: 'reach', pos: { x: -640, z: ROAD_START + ARRIVAL_GAP + 60 }, label: 'The Black Road to the Sunken Wood', minLevel: 1 },
  ],
});


/** Every zone, keyed by id. Save files store a zone id, not a zone. */
export const ZONES: Record<string, ZoneDef> = {
  fenmarch: FENMARCH,
  ardmoor: ARDMOOR,
  reach: SUNKEN_REACH,
  caer_dubh: CAER_DUBH,
};

export function getZone(id: string): ZoneDef {
  const zone = ZONES[id];
  if (!zone) throw new Error(`Unknown zone: ${id}`);
  return zone;
}

export const STARTING_ZONE_ID = 'fenmarch';

export interface ClassDef {
  id: ClassId;
  name: string;
  description: string;
  baseAttributes: Attributes;
  startingWeapon: string;
  /** Whether the class is actually playable yet. */
  implemented: boolean;
  /** One-line hint shown on the class-select screen. */
  playstyle: string;
  /** Renderer hint. */
  color: number;
}

export const CLASSES: Record<ClassId, ClassDef> = {
  warrior: {
    id: 'warrior',
    name: 'Warrior',
    description: 'Holds the line. High health, steady melee damage, hard to kill.',
    playstyle: 'Strength · melee · durable',
    implemented: true,
    baseAttributes: { strength: 8, dexterity: 4, focus: 2, vitality: 8 },
    startingWeapon: 'rusted_blade',
    color: 0xd9c27a,
  },
  priest: {
    id: 'priest',
    name: 'Priest',
    description:
      'Outlasts what it cannot outhit. Sustains through damage with healing, ' +
      'and is the surest hand at cutting a spell short.',
    playstyle: 'Focus · caster · sustain & interrupts',
    implemented: true,
    baseAttributes: { strength: 3, dexterity: 4, focus: 10, vitality: 6 },
    startingWeapon: 'oaken_walking_staff',
    color: 0xbfd4e8,
  },
  ranger: {
    id: 'ranger',
    name: 'Ranger',
    description:
      'Kills at range before it reaches you. Trades armour for distance and ' +
      'the longest reach of any class.',
    playstyle: 'Dexterity · ranged · steady pressure',
    implemented: true,
    baseAttributes: { strength: 5, dexterity: 9, focus: 4, vitality: 6 },
    startingWeapon: 'frayed_shortbow',
    color: 0x7ab87a,
  },
  rogue: {
    id: 'rogue',
    name: 'Rogue',
    description:
      'Bursts a target down before it can answer. Fast blades, thin margins, ' +
      'and the best evasion in the game when it matters.',
    playstyle: 'Dexterity · melee · burst',
    implemented: true,
    baseAttributes: { strength: 6, dexterity: 10, focus: 3, vitality: 5 },
    startingWeapon: 'chipped_dirk',
    color: 0x9a7ab8,
  },
  mage: {
    id: 'mage',
    name: 'Mage',
    description:
      'The heaviest damage in the game and the least health to survive a ' +
      'mistake. Kill it before it reaches you.',
    playstyle: 'Focus · caster · burst',
    implemented: true,
    baseAttributes: { strength: 2, dexterity: 4, focus: 12, vitality: 5 },
    startingWeapon: 'cracked_wand',
    color: 0x7a9ad9,
  },
};

/** Classes a player can actually pick right now. */
export const PLAYABLE_CLASSES: ClassDef[] = Object.values(CLASSES).filter((c) => c.implemented);
