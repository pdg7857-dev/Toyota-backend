import { World } from '../src/sim/world.js';
import { PRIMARY_ATTRIBUTE, POINTS_PER_LEVEL, TICK_MS } from '../src/sim/formulas.js';
import type { Attributes, ClassId, Entity, SimEvent } from '../src/sim/types.js';
import { CLASSES, type ZoneDef } from '../src/content/zone.js';
import { getMob } from '../src/content/mobs.js';
import { SKILLS, getSkill } from '../src/content/skills.js';

/** A bare arena with one mob a couple of metres away — no scenery, no neighbours. */
export function duelZone(mobId: string, distance = 2.5): ZoneDef {
  return {
    id: 'test-duel',
    name: 'Test Duel',
    halfSize: 120,
    playerStart: { x: 0, z: 0 },
    spawns: [{ mobId, pos: { x: distance, z: 0 } }],
    vendors: [],
    exits: [],
    levelRange: [1, 100],
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
    exits: [],
    levelRange: [1, 100],
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
    exits: [],
    levelRange: [1, 100],
  };
}

/**
 * How a player of `classId` plausibly spends attribute points: 60% into the
 * attribute their attack rating scales off, the rest into Vitality.
 *
 * This MUST follow PRIMARY_ATTRIBUTE. It previously hardcoded Warrior and
 * Priest, which meant Ranger, Rogue and Mage were tested pouring points into
 * Strength — an attribute none of them use. They read as underpowered when the
 * only thing wrong was the harness building them wrong.
 */
export function buildFor(classId: ClassId, level: number): Attributes {
  const points = (level - 1) * POINTS_PER_LEVEL;
  const primary = Math.round(points * 0.6);
  const attributes: Attributes = { strength: 0, dexterity: 0, focus: 0, vitality: points - primary };
  attributes[PRIMARY_ATTRIBUTE[classId]] += primary;
  return attributes;
}

export interface LevelOptions {
  level: number;
  /** Item ids to equip before the fight. */
  gear?: string[];
  /**
   * Taught skills the character knows. Defaults to every one their level
   * qualifies for — see `learnedAt`.
   */
  learned?: string[];
}

/**
 * Every zone-taught skill a character of this level would have.
 *
 * Zone-taught skills need a tome as well as a level, and the harness has to
 * grant them explicitly: without this a levelled test character silently fails
 * every `useSkill` for a taught skill, and the whole feature measures as though
 * it does not exist. Which is exactly what it did the first time.
 */
export function learnedAt(classId: ClassId, level: number): string[] {
  return Object.values(SKILLS)
    .filter((s) => s.classId === classId && s.taughtBy && s.reqLevel <= level)
    .map((s) => s.id);
}

/** Fast-forward a freshly built player to `level` with the given gear. */
export function levelPlayer(world: World, opts: LevelOptions): Entity {
  const player = world.player;
  player.level = opts.level;
  const classId = player.classId ?? 'warrior';
  player.learnedSkills = opts.learned ?? learnedAt(classId, opts.level);
  const base = CLASSES[classId].baseAttributes;
  const build = buildFor(classId, opts.level);
  player.attributes = {
    strength: base.strength + build.strength,
    dexterity: base.dexterity + build.dexterity,
    focus: base.focus + build.focus,
    vitality: base.vitality + build.vitality,
  };
  // Top up BEFORE the tick as well as after.
  //
  // Equipping goes through the command queue, which needs a tick to drain —
  // and during that tick the duel's mob is already swinging while the player
  // still carries level-1 health. A crit could kill them during setup, which
  // reported as the class losing the fight it never got to start. It hit the
  // low-Vitality classes hardest, so it read exactly like a balance problem.
  const before = world.statsOf(player);
  player.health = before.maxHealth;
  player.energy = before.maxEnergy;

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
  /** Health the player restored to themselves during the fight. */
  selfHealed: number;
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
  let selfHealed = 0;
  let lastMove = { x: 0, z: 0 };

  const move = (x: number, z: number): void => {
    if (x === lastMove.x && z === lastMove.z) return;
    lastMove = { x, z };
    world.submit(player.id, { t: 'move', dir: { x, z } });
  };

  /** The ability the mob is currently casting, if any. */
  const mobCasting = (): { id: string; kind: string; interruptible?: boolean } | null => {
    const cast = mob.cast;
    if (cast?.kind !== 'ability') return null;
    const ability = getMob(mob.defId!).abilities?.find((a) => a.id === cast.id);
    return ability ?? null;
  };

  for (let i = 0; i < maxTicks; i++) {
    const healthFraction = player.health / maxHealth;
    const casting = mobCasting();

    // Saving the interrupt for a heal means HOLDING the global cooldown for it.
    // Spamming the rest of the kit keeps the GCD permanently busy, so the
    // interrupt never gets a window — which measured as "interrupts do nothing"
    // when the real cause was the harness never letting one fire.
    const wantInterrupt =
      !!opts.interruptSkill &&
      (player.skillCooldowns?.[opts.interruptSkill] ?? 0) <= 0 &&
      casting?.interruptible === true &&
      casting.kind === 'mend';

    if (wantInterrupt) {
      world.submit(player.id, { t: 'useSkill', skillId: opts.interruptSkill! });
    } else {
      const ready = skills.filter((skillId) => {
        if ((player.skillCooldowns?.[skillId] ?? 0) > 0) return false;
        const skill = getSkill(skillId);
        // Don't heal at full health. Casting locks out auto-attack, so firing a
        // heal on cooldown regardless of need costs real damage and drags the
        // fight out — which then costs MORE health.
        if (skill.kind === 'heal' && healthFraction > 0.7) return false;
        // Don't spend an interrupt on nothing: it burns energy and a global
        // cooldown for no effect, which penalised every class that has one.
        if (skill.kind === 'interrupt' && !casting?.interruptible) return false;
        // Don't burn a defensive cooldown while nothing is threatening you.
        // Firing one on cooldown costs a global cooldown that would otherwise
        // have been damage, which measured as "the taught defensive skills
        // make you slightly worse".
        if (skill.kind === 'buff' && skill.defenseBonus && healthFraction > 0.65) return false;
        return true;
      });
      // Only ONE skill can clear the global cooldown per window, and the sim
      // takes them in submitted order — so submission order IS the rotation.
      //
      // Left in list order that means "always the lowest-level skill you own",
      // which quietly made every skill learned later in the game invisible to
      // the balance suite: they sat at the end of the list and never once got
      // pressed. Longest cooldown first is both a truer floor and the order a
      // real player uses — spend the big button when it is up, filler when it
      // is not.
      ready.sort((a, b) => getSkill(b).cooldownMs - getSkill(a).cooldownMs);
      for (const skillId of ready) world.submit(player.id, { t: 'useSkill', skillId });
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
      } else if (ev.t === 'heal' && ev.targetId === player.id) {
        selfHealed += ev.amount;
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
        selfHealed,
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
    selfHealed,
  };
}

export function countEvents(events: SimEvent[], type: SimEvent['t']): number {
  return events.filter((e) => e.t === type).length;
}
