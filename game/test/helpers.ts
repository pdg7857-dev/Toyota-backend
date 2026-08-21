import { World } from '../src/sim/world.js';
import { POINTS_PER_LEVEL, TICK_MS } from '../src/sim/formulas.js';
import type { Attributes, Entity, SimEvent } from '../src/sim/types.js';
import type { ZoneDef } from '../src/content/zone.js';

/** A bare arena with one mob a couple of metres away — no scenery, no neighbours. */
export function duelZone(mobId: string, distance = 2.5): ZoneDef {
  return {
    id: 'test-duel',
    name: 'Test Duel',
    halfSize: 60,
    playerStart: { x: 0, z: 0 },
    spawns: [{ mobId, pos: { x: distance, z: 0 } }],
  };
}

/** An empty arena, for tests that don't want anything attacking them. */
export function emptyZone(): ZoneDef {
  return { id: 'test-empty', name: 'Test Empty', halfSize: 60, playerStart: { x: 0, z: 0 }, spawns: [] };
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

export interface LevelOptions {
  level: number;
  /** Item ids to equip before the fight. */
  gear?: string[];
}

/** Fast-forward a freshly built player to `level` with the given gear. */
export function levelPlayer(world: World, opts: LevelOptions): Entity {
  const player = world.player;
  player.level = opts.level;
  const build = warriorBuild(opts.level);
  player.attributes = {
    strength: 8 + build.strength,
    dexterity: 4 + build.dexterity,
    focus: 2 + build.focus,
    vitality: 8 + build.vitality,
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
}

/**
 * Run one full auto-attack-plus-skills duel and report the outcome.
 * The "rotation" is deliberately dumb — fire every ready skill — because that
 * is the floor a real player should always clear.
 */
export function simulateFight(
  world: World,
  useSkills: string[] = [],
  timeoutSec = 180,
): FightResult {
  const player = world.player;
  const mob = [...world.entities.values()].find((e) => e.kind === 'mob');
  if (!mob) throw new Error('duel zone has no mob');

  world.submit(player.id, { t: 'target', id: mob.id });
  world.submit(player.id, { t: 'autoAttack', on: true });

  const maxTicks = Math.round((timeoutSec * 1000) / TICK_MS);
  const maxHealth = world.statsOf(player).maxHealth;

  for (let i = 0; i < maxTicks; i++) {
    for (const skillId of useSkills) {
      if ((player.skillCooldowns?.[skillId] ?? 0) <= 0) {
        world.submit(player.id, { t: 'useSkill', skillId });
      }
    }
    world.tick();
    if (player.dead || mob.dead) {
      return {
        playerWon: mob.dead && !player.dead,
        durationSec: (i * TICK_MS) / 1000,
        healthLeft: Math.max(0, player.health) / maxHealth,
        timedOut: false,
      };
    }
  }
  return { playerWon: false, durationSec: timeoutSec, healthLeft: player.health / maxHealth, timedOut: true };
}

export function countEvents(events: SimEvent[], type: SimEvent['t']): number {
  return events.filter((e) => e.t === type).length;
}
