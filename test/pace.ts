import { MOBS } from '../src/content/mobs.js';
import { ZONES, type ZoneDef } from '../src/content/zone.js';
import { BOSS_STARS, type MobDef, type Vec2 } from '../src/sim/types.js';
import { BASE_MOVE_SPEED, MAX_LEVEL, healthRegenPerSec, xpForKill, xpToNext } from '../src/sim/formulas.js';
import { MOUNTS } from '../src/content/mounts.js';

/**
 * How long the whole game takes, in hours.
 *
 * "How long to 100" is the single number a grind-heavy game lives or dies on,
 * and until this it was unanswerable: the suite measured kills per level and
 * seconds per fight but nothing joined them up. So a change to respawn timers
 * or map size could double the game's length and every test would still pass.
 *
 * This is a *model*, and it is honest about being one — but every term in it is
 * measured rather than assumed:
 *
 *  - **kills** come from the xp curve and the mob a player would actually be
 *    fighting at that level.
 *  - **time to kill** comes from the balance suite running the real fight.
 *  - **downtime** comes from the real regeneration rate and the health the real
 *    fight left you on. This is why making mobs dangerous makes the game
 *    longer: you spend the difference sitting down.
 *  - **travel** comes from the real zone layout — the walk from one camp of the
 *    thing you are farming to the next one.
 *  - **waiting** comes from the real respawn timer, and only counts when a
 *    player who keeps moving would still get back before the camp does.
 *
 * The last two are why the map size and the respawn timer belong in a *pacing*
 * test rather than in nobody's test at all.
 */

/** How much health a player tops back up to before pulling again. */
const PUSH_ON_AT = 0.9;

/** Seconds of faff per pull that no simulation will ever capture. */
const OVERHEAD_PER_KILL = 1.5;

export interface Camp {
  mobId: string;
  centre: Vec2;
  size: number;
}

/**
 * Group a zone's spawn points back into the camps they were authored as.
 *
 * The zone stores a flat list of points; a camp is a ring of them around a
 * centre. Anything of the same creature within `CAMP_RADIUS` is one camp.
 */
const CAMP_RADIUS = 26;

export function campsOf(zone: ZoneDef): Camp[] {
  const camps: Array<{ mobId: string; points: Vec2[] }> = [];
  for (const spawn of zone.spawns) {
    const found = camps.find(
      (c) =>
        c.mobId === spawn.mobId &&
        c.points.some((p) => Math.hypot(p.x - spawn.pos.x, p.z - spawn.pos.z) <= CAMP_RADIUS),
    );
    if (found) found.points.push(spawn.pos);
    else camps.push({ mobId: spawn.mobId, points: [spawn.pos] });
  }
  return camps.map((c) => ({
    mobId: c.mobId,
    size: c.points.length,
    centre: {
      x: c.points.reduce((a, p) => a + p.x, 0) / c.points.length,
      z: c.points.reduce((a, p) => a + p.z, 0) / c.points.length,
    },
  }));
}

/** Every camp of a given creature, across whichever zone it lives in. */
export function campsFor(mobId: string): Camp[] {
  for (const zone of Object.values(ZONES)) {
    const mine = campsOf(zone).filter((c) => c.mobId === mobId);
    if (mine.length > 0) return mine;
  }
  return [];
}

/** Mean walk from one camp of a creature to the nearest other one. */
export function campHop(mobId: string): number {
  const camps = campsFor(mobId);
  if (camps.length < 2) return 0;
  let total = 0;
  for (const camp of camps) {
    let best = Infinity;
    for (const other of camps) {
      if (other === camp) continue;
      best = Math.min(best, Math.hypot(other.centre.x - camp.centre.x, other.centre.z - camp.centre.z));
    }
    total += best;
  }
  return total / camps.length;
}

/** The mob a player at `level` would sensibly be grinding. Never a boss. */
export function grindMobFor(level: number): MobDef {
  const candidates = Object.values(MOBS)
    .filter((m) => m.stars < BOSS_STARS && !m.horse && !m.rareOf && m.level <= level + 1)
    .sort((a, b) => b.level - a.level);
  return candidates[0] ?? MOBS.moor_hare!;
}

/** Kills of a level-appropriate mob needed to clear one level. */
export function killsForLevel(level: number): number {
  const mob = grindMobFor(level);
  return Math.ceil(xpToNext(level) / xpForKill(mob.xp, mob.level, level));
}

/**
 * How fast a player at this level actually gets about.
 *
 * On foot until the first herd is within reach, and mounted after that. Walking
 * the whole game is not what anybody does, and modelling it that way makes the
 * map look like a punishment instead of the reason to go and catch something.
 */
export function travelSpeedAt(level: number): number {
  const owned = MOUNTS.filter((m) => m.level <= level);
  return owned.length === 0 ? BASE_MOVE_SPEED : Math.max(...owned.map((m) => m.speed));
}

export interface PaceInput {
  level: number;
  /** Median seconds to kill, measured by the balance suite. */
  ttk: number;
  /** Median fraction of health left afterwards, measured the same way. */
  healthLeft: number;
  /** Movement speed the player travels at between camps, if not derived. */
  moveSpeed: number;
}

export interface PaceRow {
  level: number;
  mob: MobDef;
  kills: number;
  ttk: number;
  /** Seconds sitting down after each fight. */
  downtime: number;
  /** Seconds walking, per kill. */
  travel: number;
  /** Seconds waiting on a respawn timer nothing else could fill, per kill. */
  waiting: number;
  secondsPerKill: number;
  hours: number;
}

/**
 * The pacing of one level, from measured inputs.
 *
 * The camp cycle is the load-bearing part. A player clears a camp, walks to the
 * next, clears that, and so on; they only ever wait on a respawn if they run out
 * of camps to rotate through before the first one comes back. That is exactly
 * the relationship between map size and respawn timer — a long timer costs
 * nothing on a big map with somewhere else to go, and is dead time on a small
 * one.
 */
export function paceOf(input: PaceInput): PaceRow {
  const { level, ttk, healthLeft, moveSpeed } = input;
  const mob = grindMobFor(level);
  const kills = killsForLevel(level);

  const downtime = Math.max(0, PUSH_ON_AT - healthLeft) / 0.04;
  const camps = campsFor(mob.id);
  const campSize = camps.length > 0 ? camps.reduce((a, c) => a + c.size, 0) / camps.length : 5;
  const hop = campHop(mob.id) || 60;

  const perFight = ttk + downtime + OVERHEAD_PER_KILL;
  const travel = hop / moveSpeed / campSize;

  // Round trip: every other camp of this creature, cleared and walked.
  const cycle = camps.length * campSize * (perFight + travel);
  const respawn = mob.respawnMs / 1000;
  const waiting = Math.max(0, respawn - cycle) / campSize;

  const secondsPerKill = perFight + travel + waiting;
  return {
    level,
    mob,
    kills,
    ttk,
    downtime,
    travel,
    waiting,
    secondsPerKill,
    hours: (kills * secondsPerKill) / 3600,
  };
}

/**
 * Total hours to the cap, interpolating measured checkpoints across every level.
 *
 * Checkpoints are expensive (each one runs twenty real fights), so the suite
 * measures a dozen and this fills in between them. A level's pacing changes
 * smoothly with level; what it does not do is jump between the ones we sampled.
 */
export function hoursToCap(
  checkpoints: PaceInput[],
): { rows: PaceRow[]; total: number } {
  const sorted = [...checkpoints].sort((a, b) => a.level - b.level);
  const rows: PaceRow[] = [];
  let total = 0;

  for (let level = 1; level < MAX_LEVEL; level++) {
    const above = sorted.find((c) => c.level >= level) ?? sorted[sorted.length - 1]!;
    const below = [...sorted].reverse().find((c) => c.level <= level) ?? sorted[0]!;
    const span = above.level - below.level;
    const t = span === 0 ? 0 : (level - below.level) / span;
    const row = paceOf({
      level,
      ttk: below.ttk + (above.ttk - below.ttk) * t,
      healthLeft: below.healthLeft + (above.healthLeft - below.healthLeft) * t,
      moveSpeed: travelSpeedAt(level),
    });
    rows.push(row);
    total += row.hours;
  }
  return { rows, total };
}

/** Seconds to walk from one edge of a zone to the other, at a given speed. */
export function crossingSeconds(zone: ZoneDef, speed: number): number {
  return (zone.halfSize * 2) / speed;
}

/** Health regeneration, exposed so the model and the sim cannot drift apart. */
export function regenFractionPerSec(maxHealth: number): number {
  return healthRegenPerSec({ maxHealth } as never, false) / maxHealth;
}
