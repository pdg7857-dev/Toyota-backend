import type { Vec2 } from '../sim/types.js';
import { dryGround } from './terrain.js';

/**
 * Towns, and the stones that join them up.
 *
 * A zone is three kilometres of ground with one trader standing at the top of
 * it. Everything the player does happens on a road between camps, and the only
 * building on that road was a wagon they walked past in the first minute. The
 * map was "quite big, but kind of just open and dead" — and it was, because
 * the only thing on it that was not a creature was a signpost.
 *
 * A settlement is the answer, and it is deliberately not a camp. Four rules:
 *
 * - **Each one sells something the others do not.** A smith, an armourer, an
 *   apothecary, a scholar, a market. That is the whole reason to walk to a
 *   different one rather than the nearest one — a row of identical general
 *   stores is one general store drawn five times.
 * - **They are on the road.** Not scattered across the wilds: a town nobody
 *   passes is a town nobody finds, and the road has been the organising idea
 *   of every zone in this game since the first one was a hand-written literal.
 * - **They are clear of every camp, by the same rule a trader always was.**
 *   Placed off the road and then pushed until nothing can reach them, because
 *   a shop you get pulled off mid-trade is not a shop.
 * - **Each has a leystone.** That is what makes four to seven towns a network
 *   rather than four to seven errands — see `sim/world.ts` for the attuning
 *   and the travelling, which are sim state because where you can get to is a
 *   fact about the world and not about the camera.
 *
 * Hand-authored rather than generated, unlike almost everything else south of
 * the Fenmarch. Names are the part a player reads and says out loud, and a
 * generated town name is a string with a seed in it. Twenty entries is not
 * seventy-five levels of numbers.
 */

/** What a settlement is for. Decides its trader's stock, and nothing else. */
export type SettlementRole = 'hold' | 'smith' | 'armoury' | 'apothecary' | 'scholar' | 'market';

/** What each role reads as, on the map and over the shop door. */
export const ROLE_LABEL: Record<SettlementRole, string> = {
  hold: 'Hold',
  smith: 'Smithy',
  armoury: 'Armoury',
  apothecary: 'Apothecary',
  scholar: 'Scriptorium',
  market: 'Market',
};

export interface SettlementPlan {
  /** Stable across saves and across anybody moving a road point. */
  id: string;
  name: string;
  role: SettlementRole;
  /**
   * Where down the road, 0 at the top and 1 at the bottom — or `'arrival'`,
   * which puts it where a new character wakes up.
   *
   * The first settlement of every zone is the arrival one on purpose: the
   * moment a player walks into a new zone is the moment they most want a shop
   * and an anchor to come back to.
   */
  at: number | 'arrival';
  /** Which side of the road, so a run of them does not read as a queue. */
  side: 1 | -1;
  /**
   * A hand-written trader who already stands in this zone. When set, this
   * settlement is that trader's town and keeps their stock; otherwise a trader
   * is generated for the role.
   */
  vendorId?: string;
  /**
   * The generated trader's name. Hand-written for the same reason the town's
   * is: a name is the part a player says out loud, and a generated one is a
   * string with a seed in it.
   */
  keeper?: string;
  /** One line, shown on the map. What you would tell somebody about the place. */
  blurb: string;
}

export const SETTLEMENT_PLANS: Record<string, SettlementPlan[]> = {
  fenmarch: [
    {
      id: 'kilmory',
      name: 'Kilmory',
      role: 'hold',
      at: 'arrival',
      side: 1,
      vendorId: 'maeve',
      blurb: 'The last roofs before the moor.',
    },
    {
      id: 'ardnahoe',
      keeper: 'Fergus the Smith',
      name: 'Ardnahoe',
      role: 'smith',
      at: 0.16,
      side: -1,
      blurb: 'A forge, a well, and four people who would rather you moved on.',
    },
    {
      id: 'fenwick',
      keeper: 'Nuala the Herbwife',
      name: 'Fenwick Crossing',
      role: 'apothecary',
      at: 0.32,
      side: 1,
      blurb: 'Where the fen is shallow enough to wade, and somebody sells you something for after.',
    },
    {
      id: 'dunloe',
      name: 'Dunloe',
      role: 'hold',
      at: 0.5,
      side: -1,
      vendorId: 'bryn',
      blurb: "The quartermaster's yard. Everything south of here is worse.",
    },
    {
      id: 'greystones',
      keeper: 'Padraig the Broker',
      name: 'Greystones',
      role: 'market',
      at: 0.68,
      side: 1,
      blurb: 'Three stalls under a standing stone. They buy anything.',
    },
    {
      id: 'moorwatch',
      keeper: 'Sile the Mailwright',
      name: 'Moorwatch',
      role: 'armoury',
      at: 0.88,
      side: -1,
      blurb: 'The last place that will sell you a coat before the marsh.',
    },
  ],
  ardmoor: [
    {
      id: 'carn_ardmoor',
      name: 'Carn Ardmoor',
      role: 'hold',
      at: 'arrival',
      side: 1,
      vendorId: 'sorcha',
      blurb: 'Cut into the terrace. Warm, for Ardmoor.',
    },
    {
      id: 'sgurr_bothy',
      keeper: 'Torcall the Smith',
      name: 'Sgurr Bothy',
      role: 'smith',
      at: 0.16,
      side: -1,
      blurb: 'One long shed and a water-driven hammer.',
    },
    {
      id: 'cold_well',
      keeper: 'Beatha the Herbwife',
      name: 'Cold Well',
      role: 'apothecary',
      at: 0.32,
      side: 1,
      blurb: 'The water comes up freezing and does you good.',
    },
    {
      id: 'tearmann',
      keeper: 'Ruari the Mailwright',
      name: 'Tearmann',
      role: 'armoury',
      at: 0.5,
      side: -1,
      blurb: 'A refuge with a mail-shop attached. Both get used.',
    },
    {
      id: 'drovers_rest',
      keeper: 'Ailis the Drover',
      name: "Drovers' Rest",
      role: 'market',
      at: 0.68,
      side: 1,
      blurb: 'Where the cattle roads meet. They will buy whatever you are carrying.',
    },
    {
      id: 'beinn_gate',
      keeper: 'Eithne the Reader',
      name: 'Beinn Gate',
      role: 'scholar',
      at: 0.88,
      side: -1,
      blurb: 'Somebody up here has been writing things down for a long time.',
    },
  ],
  reach: [
    {
      id: 'alderhythe',
      name: 'Alderhythe',
      role: 'hold',
      at: 'arrival',
      side: 1,
      vendorId: 'odhran',
      blurb: 'Built on the last dry acre. It will not be dry for ever.',
    },
    {
      id: 'stiltmarket',
      keeper: 'Cuan the Broker',
      name: 'Stiltmarket',
      role: 'market',
      at: 0.16,
      side: -1,
      blurb: 'A market on piles. Everything is for sale and nothing is on the ground.',
    },
    {
      id: 'drownwell',
      keeper: 'Muirgen the Brewer',
      name: 'Drownwell',
      role: 'apothecary',
      at: 0.32,
      side: 1,
      blurb: 'They brew with the water that killed the trees. It works.',
    },
    {
      id: 'weirhouse',
      keeper: 'Neasa the Mailwright',
      name: 'Weirhouse',
      role: 'armoury',
      at: 0.5,
      side: -1,
      blurb: 'A weir that holds nothing back any more, and a shop that still works.',
    },
    {
      id: 'rootfast',
      keeper: 'Lorcan the Smith',
      name: 'Rootfast',
      role: 'smith',
      at: 0.68,
      side: 1,
      blurb: 'A forge grown through by a root nobody dares cut.',
    },
    {
      id: 'lampholt',
      keeper: 'Aengus the Reader',
      name: 'Lampholt',
      role: 'scholar',
      at: 0.88,
      side: -1,
      blurb: 'Lit all night, by people who have read why.',
    },
  ],
  caer_dubh: [
    {
      id: 'dun_sian',
      name: 'Dun Sian',
      role: 'hold',
      at: 'arrival',
      side: 1,
      vendorId: 'aoife',
      blurb: 'The last place in the world that answers to a name.',
    },
    {
      id: 'threshold',
      keeper: 'Sorley the Mailwright',
      name: 'Threshold',
      role: 'armoury',
      at: 0.16,
      side: -1,
      blurb: 'A gate with nothing behind it, and a shop that has not closed.',
    },
    {
      id: 'blackwell',
      keeper: 'Sluagh the Brewer',
      name: 'Blackwell',
      role: 'apothecary',
      at: 0.32,
      side: 1,
      blurb: 'The water is black and it does not kill you. That is the recommendation.',
    },
    {
      id: 'cold_market',
      keeper: 'Feargal the Broker',
      name: 'The Cold Market',
      role: 'market',
      at: 0.5,
      side: -1,
      blurb: 'Nobody sets the prices any more. They are still the prices.',
    },
    {
      id: 'lamplit_stair',
      keeper: 'Brigid the Reader',
      name: 'The Lamplit Stair',
      role: 'scholar',
      at: 0.68,
      side: 1,
      blurb: 'Steps going down. Everything worth knowing here was written on the way up.',
    },
    {
      id: 'caer_vane',
      keeper: 'Colm the Smith',
      name: 'Caer Vane',
      role: 'smith',
      at: 0.88,
      side: -1,
      blurb: 'Still making weapons. Nobody has told them.',
    },
  ],
};

/** How far off the road a town stands before anything pushes it further. */
const ROAD_OFFSET = 62;

/** How far the trader stands from the stone. Close enough to be one place. */
export const VENDOR_OFFSET = 9;

/** Walk within this of a stone and it is yours. Generous: not a precision test. */
export const LEYSTONE_RANGE = 8;

/** How far off you can see a stone you have not attuned. */
export const LEYSTONE_SIGHT = 110;

export interface SettlementDef {
  /** `ley_<zone>_<plan id>`. Never an index — an index re-points every save. */
  id: string;
  zoneId: string;
  name: string;
  role: SettlementRole;
  blurb: string;
  /** The leystone, and the middle of the town. */
  pos: Vec2;
  /** Where the trader stands. */
  vendorPos: Vec2;
  vendorId: string;
}

/**
 * What this module needs of a zone.
 *
 * Structural rather than a `ZoneDef` import, for the reason `StructureZone`
 * gives: `content/zone.ts` calls this while it is still building itself, and
 * the two must not form a cycle. The road comes in as a polyline because it is
 * `zone.ts` that knows how to draw one — the settlement is placed *on the
 * road the zone actually has*, never on a second guess at where it goes.
 */
export interface SettlementZone {
  id: string;
  theme?: string;
  halfSize: number;
  playerStart: Vec2;
  road: Vec2[];
  spawns: Array<{ mobId: string; pos: Vec2 }>;
  /** Aggro plus roam plus a margin, per spawn. Supplied, because only the
   *  caller can read the bestiary without dragging it in here. */
  reachOf: (mobId: string) => number;
}

/** A point some way down a polyline, by fraction of its length. */
function alongRoad(road: Vec2[], t: number): Vec2 {
  if (road.length === 0) return { x: 0, z: 0 };
  if (road.length === 1) return { ...road[0]! };
  const span = (road.length - 1) * Math.max(0, Math.min(1, t));
  const i = Math.min(road.length - 2, Math.floor(span));
  const f = span - i;
  const a = road[i]!;
  const b = road[i + 1]!;
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
}

/** Which way is sideways, here. */
function roadNormal(road: Vec2[], t: number): Vec2 {
  const a = alongRoad(road, Math.max(0, t - 0.02));
  const b = alongRoad(road, Math.min(1, t + 0.02));
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  return { x: -dz / len, z: dx / len };
}

/**
 * Lay a zone's towns out.
 *
 * The clearance loop is the whole of it. A town goes where the plan says, and
 * then walks away from anything that could reach it — because the alternative
 * is a hand-tuned coordinate per settlement that stops being right the moment
 * somebody moves a camp, and the zone-layout test would catch it as a failure
 * with no obvious fix. Twenty towns is twenty coordinates nobody wants to own.
 */
export function settlementsFor(zone: SettlementZone): SettlementDef[] {
  const plans = SETTLEMENT_PLANS[zone.id] ?? [];
  const limit = zone.halfSize * 0.96;
  const out: SettlementDef[] = [];

  for (const plan of plans) {
    const anchor =
      plan.at === 'arrival'
        ? { x: zone.playerStart.x, z: zone.playerStart.z + 44 }
        : alongRoad(zone.road, plan.at);
    const normal =
      plan.at === 'arrival' ? { x: 1, z: 0 } : roadNormal(zone.road, plan.at as number);

    let pos = dryGround(
      anchor.x + normal.x * ROAD_OFFSET * plan.side,
      anchor.z + normal.z * ROAD_OFFSET * plan.side,
      zone.theme,
      limit,
    );

    // Push out until nothing in the zone can reach either the stone or the
    // trader beside it. Spiralling rather than stepping straight out, because
    // "straight out" from a camp on a lake shore is into the lake.
    for (let attempt = 0; attempt < 40; attempt++) {
      let worst: { pos: Vec2; need: number; gap: number } | null = null;
      for (const spawn of zone.spawns) {
        const need = zone.reachOf(spawn.mobId) + VENDOR_OFFSET + 6;
        const gap = Math.hypot(pos.x - spawn.pos.x, pos.z - spawn.pos.z);
        if (gap < need && (!worst || need - gap > worst.need - worst.gap)) {
          worst = { pos: spawn.pos, need, gap };
        }
      }
      // And never on top of another town.
      for (const other of out) {
        const gap = Math.hypot(pos.x - other.pos.x, pos.z - other.pos.z);
        if (gap < 150 && (!worst || 150 - gap > worst.need - worst.gap)) {
          worst = { pos: other.pos, need: 150, gap };
        }
      }
      if (!worst) break;
      const dx = pos.x - worst.pos.x;
      const dz = pos.z - worst.pos.z;
      const len = Math.hypot(dx, dz) || 1;
      const push = worst.need - worst.gap + 8;
      // A slight rotation each pass, so a town wedged between two camps walks
      // round one of them instead of oscillating between them for ever.
      const a = Math.atan2(dz, dx) + 0.12 * (attempt % 2 === 0 ? 1 : -1);
      pos = dryGround(
        worst.pos.x + Math.cos(a) * (len + push),
        worst.pos.z + Math.sin(a) * (len + push),
        zone.theme,
        limit,
      );
    }

    const vendorPos = dryGround(
      pos.x + normal.x * VENDOR_OFFSET * plan.side,
      pos.z + normal.z * VENDOR_OFFSET * plan.side,
      zone.theme,
      limit,
      3,
      6,
    );

    out.push({
      id: `ley_${zone.id}_${plan.id}`,
      zoneId: zone.id,
      name: plan.name,
      role: plan.role,
      blurb: plan.blurb,
      pos,
      vendorPos,
      vendorId: plan.vendorId ?? settlementVendorId(zone.id, plan.id),
    });
  }
  return out;
}

/** The generated trader for a town that has no hand-written one. */
export function settlementVendorId(zoneId: string, planId: string): string {
  return `keeper_${zoneId}_${planId}`;
}

/**
 * The keeper of a zone's shop of this kind.
 *
 * Derived rather than written down twice. The hoard sets are handed over by a
 * zone's armourer, and naming `keeper_fenmarch_moorwatch` in a second file is a
 * name that stops being right the moment somebody renames a town.
 */
export function keeperOfTrade(zoneId: string, role: SettlementRole): string | undefined {
  const plan = (SETTLEMENT_PLANS[zoneId] ?? []).find((p) => p.role === role);
  if (!plan) return undefined;
  return plan.vendorId ?? settlementVendorId(zoneId, plan.id);
}

/** Every settlement in the game, without needing a built zone. For vendors. */
export function allSettlementPlans(): Array<{ zoneId: string; plan: SettlementPlan }> {
  const out: Array<{ zoneId: string; plan: SettlementPlan }> = [];
  for (const [zoneId, plans] of Object.entries(SETTLEMENT_PLANS)) {
    for (const plan of plans) out.push({ zoneId, plan });
  }
  return out;
}
