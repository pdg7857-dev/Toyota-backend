import { World } from '../src/sim/world.js';
import { POINTS_PER_LEVEL, TICK_MS } from '../src/sim/formulas.js';
import type { Attributes, Entity, SimEvent } from '../src/sim/types.js';
import { CLASSES, type ZoneDef } from '../src/content/zone.js';
import { getMob } from '../src/content/mobs.js';

/** A bare arena with one mob a couple of metres away — no scenery, no neighbours. */
export function duelZone(mobId: string, distance = 2.5): ZoneDef {
  return {
    id: 'test-duel',
    name: 'Test Duel',
    halfSize: 120,
    playerStart: { x: 0, z: 0 },
    spawns: [{ mobId, pos: { x: distance, z: 0 } }],
    vendors: [],
  };
}

/** An empty arena, for tests that don't want anything attacking them. */
export function emptyZone(): ZoneDef {
  return {
    id: 'test-empty',
    name: 'Test Empty',
    halfSize: 120,
    playerStart: { x: 0, z: 0 },
    spawns: [],
    vendors: [],
  };
}

/** An arena with one trader a couple of metres away and nothing hostile. */
export function vendorZone(vendorId: string, distance = 2): ZoneDef {
  return {
    id: 'test-vendor',
    name: 'Test Vendor',
    halfSize: 120,
    playerStart: { x: 0, z: 0 },
    spawns: [],
    vendors: [{ vendorId, pos: { x: distance, z: 0 } }],
  };
}

/**
 * Spend a level's worth of attribute points the way a Warrior player plausibly
 * would: mostly strength, the rest into vitality. Balance targets assume this
 * build, so if the intended build changes, this changes with it.
 */
export function warriorBuild(level: number): Attributes {
  const points = (level - 1) * POINTS_PER_LEVEL;
  const strength = Math.round(points * 0.6);
  return { strength, dexterity: 0, focus: 0, vitality: points - strength };
}

/**
 * How a Priest player plausibly spends points: mostly Focus (their attack
 * rating scales off it), the rest into Vitality.
 */
export function priestBuild(level: number): Attributes {
  const points = (level - 1) * POINTS_PER_LEVEL;
  const focus = Math.round(points * 0.6);
  return { strength: 0, dexterity: 0, focus, vitality: points - focus };
}

export interface LevelOptions {
  level: number;
  /** Item ids to equip before the fight. */
  gear?: string[];
}

/** Fast-forward a freshly built player to `level` with the given gear. */
export function levelPlayer(world: World, opts: LevelOptions): Entity {
  const player = world.player;
  player.level = opts.level;
  const base = CLASSES[player.classId ?? 'warrior'].baseAttributes;
  const build = player.classId === 'priest' ? priestBuild(opts.level) : warriorBuild(opts.level);
  player.attributes = {
    strength: base.strength + build.strength,
    dexterity: base.dexterity + build.dexterity,
    focus: base.focus + build.focus,
    vitality: base.vitality + build.vitality,
  };
  for (const itemId of opts.gear ?? []) {
    world.addItem(player, { itemId, qty: 1 });
    world.submit(player.id, { t: 'equip', itemId });
  }
  world.tick();
  const stats = world.statsOf(player);
  player.health = stats.maxHealth;
  player.energy = stats.maxEnergy;
  return player;
}

export interface FightResult {
  playerWon: boolean;
  /** Seconds elapsed before someone died, or the timeout. */
  durationSec: number;
  /** Player health remaining, as a fraction of max. */
  healthLeft: number;
  timedOut: boolean;
  /** Telegraphed AoEs that landed on the player. */
  slamsTaken: number;
  /** Telegraphed AoEs the player escaped. */
  slamsDodged: number;
  /** Mob casts the player successfully cut short. */
  interrupts: number;
  /** Health the mob recovered because a heal was allowed to finish. */
  mobHealed: number;
}

export interface FightOptions {
  /** Skills to fire whenever they are off cooldown. */
  skills?: string[];
  /**
   * Model a player who reacts to telegraphs by running out of the danger
   * circle, then walking back in. Without this the harness models someone who
   * stands in every AoE — which is the floor, not the ceiling.
   */
  dodge?: boolean;
  /**
   * Skill id to fire the moment the mob starts an interruptible cast. Models a
   * player who is actually watching for the heal, rather than one who mashes
   * the interrupt on cooldown and has it down when it matters.
   */
  interruptSkill?: string;
  timeoutSec?: number;
}

interface PendingSlam {
  sourceId: number;
  radius: number;
  remainingMs: number;
}

/**
 * Run one full duel and report the outcome.
 *
 * The "rotation" is deliberately dumb — fire every ready skill — because that
 * is the floor a real player should always clear. `dodge` is the one piece of
 * actual play the harness models, because dodging is the mechanic that is
 * supposed to decide boss fights.
 */
export function simulateFight(world: World, options: FightOptions | string[] = {}): FightResult {
  const opts: FightOptions = Array.isArray(options) ? { skills: options } : options;
  const skills = opts.skills ?? [];
  const timeoutSec = opts.timeoutSec ?? 240;

  const player = world.player;
  const mob = [...world.entities.values()].find((e) => e.kind === 'mob');
  if (!mob) throw new Error('duel zone has no mob');

  world.submit(player.id, { t: 'target', id: mob.id });
  world.submit(player.id, { t: 'autoAttack', on: true });

  const maxTicks = Math.round((timeoutSec * 1000) / TICK_MS);
  const maxHealth = world.statsOf(player).maxHealth;
  let pending: PendingSlam | null = null;
  let slamsTaken = 0;
  let slamsDodged = 0;
  let interrupts = 0;
  let mobHealed = 0;
  let lastMove = { x: 0, z: 0 };

  const move = (x: number, z: number): void => {
    if (x === lastMove.x && z === lastMove.z) return;
    lastMove = { x, z };
    world.submit(player.id, { t: 'move', dir: { x, z } });
  };

  for (let i = 0; i < maxTicks; i++) {
    for (const skillId of skills) {
      if ((player.skillCooldowns?.[skillId] ?? 0) <= 0) {
        world.submit(player.id, { t: 'useSkill', skillId });
      }
    }

    // React to an interruptible cast in progress. Checked before the tick so
    // the interrupt lands during the cast window rather than after it resolves.
    if (opts.interruptSkill && (player.skillCooldowns?.[opts.interruptSkill] ?? 0) <= 0) {
      const cast = mob.cast;
      if (cast?.kind === 'ability') {
        const ability = getMob(mob.defId!).abilities?.find((a) => a.id === cast.id);
        if (ability?.interruptible) {
          world.submit(player.id, { t: 'useSkill', skillId: opts.interruptSkill });
        }
      }
    }

    if (opts.dodge) {
      const source = pending ? world.entity(pending.sourceId) : undefined;
      if (pending && source) {
        // Clear the circle with a margin, then hold still.
        const dx = player.pos.x - source.pos.x;
        const dz = player.pos.z - source.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        if (d < pending.radius + 1.5) move(dx / d, dz / d);
        else move(0, 0);
      } else {
        // Nothing incoming: close back to weapon range.
        const dx = mob.pos.x - player.pos.x;
        const dz = mob.pos.z - player.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        const reach = world.statsOf(player).attackRange;
        if (d > reach * 0.85) move(dx / d, dz / d);
        else move(0, 0);
      }
    }

    const events = world.tick();

    for (const ev of events) {
      if (ev.t === 'telegraph' && ev.radius > 0) {
        pending = { sourceId: ev.sourceId, radius: ev.radius, remainingMs: ev.durationMs };
      } else if (ev.t === 'dodged' && ev.targetId === player.id) {
        slamsDodged++;
      } else if (ev.t === 'interrupted' && ev.sourceId === player.id) {
        interrupts++;
      } else if (ev.t === 'heal' && ev.targetId === mob.id) {
        mobHealed += ev.amount;
      } else if (ev.t === 'damage' && ev.targetId === player.id && ev.abilityId) {
        // Any damage to the player carrying an ability id came from a mob
        // ability — auto-attacks pass null. Do NOT gate this on `pending`: the
        // pending window closes on the same tick the slam resolves, which
        // silently zeroed this counter and made "stood in the fire" look
        // identical to "dodged everything".
        slamsTaken++;
      }
    }
    if (pending) {
      pending.remainingMs -= TICK_MS;
      if (pending.remainingMs <= 0) pending = null;
    }

    if (player.dead || mob.dead) {
      return {
        playerWon: mob.dead && !player.dead,
        durationSec: (i * TICK_MS) / 1000,
        healthLeft: Math.max(0, player.health) / maxHealth,
        timedOut: false,
        slamsTaken,
        slamsDodged,
        interrupts,
        mobHealed,
      };
    }
  }
  return {
    playerWon: false,
    durationSec: timeoutSec,
    healthLeft: player.health / maxHealth,
    timedOut: true,
    slamsTaken,
    slamsDodged,
    interrupts,
    mobHealed,
  };
}

export function countEvents(events: SimEvent[], type: SimEvent['t']): number {
  return events.filter((e) => e.t === type).length;
}
