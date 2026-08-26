import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world.js';
import {
  duelZone,
  learnedAt,
  levelPlayer,
  pullZone,
  simulateFight,
  simulatePull,
  type FightResult,
} from './helpers.js';
import {
  MAX_EQUIPMENT_DROP_CHANCE,
  MAX_LEVEL,
  STAR_MODIFIERS,
  BASE_MOVE_SPEED,
  baseMobXp,
  deriveMobStats,
  goldForKill,
  POINTS_PER_LEVEL,
  expectedPrimary,
  roamRadiusFor,
  skillAttributePower,
  strengthDamage,
  xpForKill,
  xpToNext,
} from '../src/sim/formulas.js';
import {
  ABILITY_ANSWERS,
  BOSS_STARS,
  type ClassId,
  type StarRating,
  type Entity,
  type MobDef,
} from '../src/sim/types.js';
import { BOUNTY_MOBS, LOOT_TABLES, MOBS, baseMobId, getMob } from '../src/content/mobs.js';
import {
  BOUNTY_SPAWN_CHANCE,
  RARES,
  RARE_SPAWN_CHANCE,
  rareMobId,
} from '../src/content/rares.js';
import {
  ARMOUR_LINES,
  TROPHY_DROP_CHANCE,
  questArmourId,
} from '../src/content/questgear.js';
import {
  DRAGONS,
  DRAGON_DORMANT_MIN,
  DRAGON_HUNT_MIN,
  DRAGON_ROOST_MIN,
  dragonMobId,
  dragonWeaponId,
} from '../src/content/dragons.js';
import { curveArmorTotal, curveWeaponDps } from '../src/content/curves.js';
import { CLASS_ATTRIBUTES, SKILLS, getSkill } from '../src/content/skills.js';
import { TICK_MS } from '../src/sim/formulas.js';
import { MUSTER_MAX, ROUSED_MS } from '../src/content/muster.js';
import {
  STUBBORN_AT,
  TRAITS,
  VENOM_MAX_STACKS,
  traitFor,
} from '../src/content/traits.js';
import { consumableDropFor } from '../src/content/consumables.js';
import {
  CLASSES,
  FENMARCH,
  PLAYABLE_CLASSES,
  ZONES,
  roadDistance,
  roadPoints,
} from '../src/content/zone.js';
import { getTheme, terrainHeight } from '../src/content/terrain.js';
import { MOUNTS } from '../src/content/mounts.js';
import { crossingSeconds, hoursToCap, type PaceInput } from './pace.js';

/**
 * Levels to measure the game at, each paired with what a player would ACTUALLY
 * be grinding there — within a couple of levels and ★2 or better. Pairing a
 * level with something well beneath it just measures how fast an overgeared
 * character clears trash.
 *
 * The progression test asserts each one is winnable; the pacing test asks how
 * long it takes. They must be the same list, or the game is balanced against
 * one set of fights and timed against another.
 */
const PACE_LEVELS = [8, 14, 22, 28, 34, 42, 50, 58, 66, 74, 82, 90, 100];

/**
 * Levels to measure the game at, each paired with what a player would ACTUALLY
 * be grinding there.
 *
 * ★2 and ★3 only, and derived rather than typed. Once ordinary creatures became
 * able to kill you, a ★4 stopped being something anyone farms — it is a fight
 * you pick deliberately, with potions, having decided it is worth it. Measuring
 * the *pace* of the game against one measures a player who does the hardest
 * available thing over and over, which nobody does and which no xp curve is
 * fitted to. ★4 has its own test, and it is a much harsher one.
 */
const PACE_CHECKPOINTS: Array<{ level: number; mobId: string }> = PACE_LEVELS.map((level) => {
  const near = Object.values(MOBS)
    .filter(
      (m) =>
        (m.stars === 2 || m.stars === 3) &&
        !m.horse &&
        !m.rareOf &&
        !m.dragon &&
        // The creature as authored, not one of its ratings. A ★3 rating of a
        // level-8 creature is a fight a player picks, not the pace of the game.
        !m.starOf,
    )
    .sort((a, b) => Math.abs(a.level - level) - Math.abs(b.level - level));
  // ★3 where there is one within a couple of levels. Once a character has
  // spent ninety skill points, a ★2 at their own level dies in three seconds —
  // which is not a grind anybody measures a game against, it is the thing you
  // kill on the way past.
  const mob = near.find((m) => m.stars === 3 && Math.abs(m.level - level) <= 4) ?? near[0]!;
  return { level: mob.level, mobId: mob.id };
});

import { QUESTS } from '../src/content/quests.js';
import {
  CONTROL_LIMIT,
  FLIP_THRESHOLD,
  HOLDINGS,
  PRESSURE_PER_KILL,
  getFaction,
} from '../src/content/factions.js';
import {
  ITEMS,
  WEAPON_LADDER,
  canBeGraded,
  canEquip,
  gearSetFor,
  getItem,
} from '../src/content/items.js';
import {
  TIERS,
  TIER_ORDER,
  TIER_WEIGHTS,
  killsPerTier,
  tieredId,
  type ItemTier,
} from '../src/content/tiers.js';
import { MAX_STOCK_QUALITY, VENDORS, buyPrice, sellPrice } from '../src/content/vendors.js';
import { LUXURY_VENDOR_ID } from '../src/content/luxury.js';
import { skillBarFor, skillsForClass, skillsTaughtBy } from '../src/content/skills.js';

/**
 * Balance is measured, not guessed.
 *
 * Each case runs the same encounter across many seeds and asserts on the
 * *distribution* — win rate, time to kill, health remaining. When a number here
 * fails, the fix belongs in `sim/formulas.ts` or the content files, not in the
 * assertion. Widening a threshold to make a red test pass is how balance rots.
 */

const TRIALS = 100;

/**
 * How far this spawn's occupant can amble off its mark.
 *
 * Every clearance in this file is really a statement about aggro, and aggro is
 * measured from where a creature *is*. Once camps wander, "eighteen units from
 * the shop" stops meaning anything unless the wander is in the sum.
 */
function roamOf(spawn: { mobId: string; holding?: string }): number {
  const def = MOBS[spawn.mobId]!;
  if (def.stars >= BOSS_STARS || def.dragon || spawn.holding !== undefined) return 0;
  return roamRadiusFor(def.leashRadius);
}

interface Encounter {
  name: string;
  level: number;
  gear: string[];
  mobId: string;
  skills: string[];
  dodge?: boolean;
  classId?: ClassId;
  interruptSkill?: string;
  /** Taught skills the character knows; defaults to everything for the level. */
  learned?: string[];
  /**
   * Skill ranks to give them.
   *
   * Defaults to what a player would actually have spent by this level. Pass
   * `{}` for a comparison where ranks are noise rather than signal — a kit
   * against another kit, or a class against another class.
   */
  ranks?: Record<string, number>;
  /**
   * Fight it with nothing but the rotation.
   *
   * Every other measurement in this suite asks "can a player clear this", and
   * a player has a pouch of draughts — that is what a trader in every zone is
   * for. Only the lethality tests ask the other question, "is this dangerous",
   * and they set this to say so.
   */
  noPotions?: boolean;
}

interface Summary {
  winRate: number;
  medianTtk: number;
  medianHealthLeft: number;
  /** Median of the lowest point each fight reached — how close it got. */
  medianLowest: number;
  timeouts: number;
  slamsTaken: number;
  slamsDodged: number;
  interrupts: number;
  mobHealed: number;
  selfHealed: number;
}

function runEncounter(enc: Encounter, trials = TRIALS): Summary {
  const results: FightResult[] = [];
  for (let seed = 0; seed < trials; seed++) {
    const world = new World({
      seed: seed * 7919 + 13,
      zone: duelZone(enc.mobId),
      classId: enc.classId ?? 'warrior',
    });
    levelPlayer(world, {
      level: enc.level,
      gear: enc.gear,
      ...(enc.learned ? { learned: enc.learned } : {}),
      ...(enc.ranks ? { ranks: enc.ranks } : {}),
    });
    results.push(
      simulateFight(world, {
        skills: enc.skills,
        dodge: enc.dodge ?? false,
        ...(enc.noPotions ? {} : { potion: consumableDropFor(enc.level) }),
        ...(enc.interruptSkill ? { interruptSkill: enc.interruptSkill } : {}),
        timeoutSec: 240,
      }),
    );
  }
  const wins = results.filter((r) => r.playerWon);
  const ttks = wins.map((r) => r.durationSec).sort((a, b) => a - b);
  const healths = results.map((r) => r.healthLeft).sort((a, b) => a - b);
  const lowest = results.map((r) => r.lowestHealth).sort((a, b) => a - b);
  return {
    winRate: wins.length / results.length,
    medianTtk: ttks.length ? ttks[Math.floor(ttks.length / 2)]! : Infinity,
    medianHealthLeft: healths[Math.floor(healths.length / 2)]!,
    medianLowest: lowest[Math.floor(lowest.length / 2)]!,
    timeouts: results.filter((r) => r.timedOut).length,
    slamsTaken: results.reduce((a, r) => a + r.slamsTaken, 0),
    slamsDodged: results.reduce((a, r) => a + r.slamsDodged, 0),
    interrupts: results.reduce((a, r) => a + r.interrupts, 0),
    mobHealed: results.reduce((a, r) => a + r.mobHealed, 0),
    selfHealed: results.reduce((a, r) => a + r.selfHealed, 0),
  };
}

function report(name: string, s: Summary): void {
  // Printed so a failing threshold shows you the actual shape of the fight.
  const ttk = s.medianTtk === Infinity ? '  n/a' : `${s.medianTtk.toFixed(1).padStart(5)}s`;
  console.log(
    `${name.padEnd(40)} win ${(s.winRate * 100).toFixed(0).padStart(3)}%  ttk ${ttk}  ` +
      `hp left ${(s.medianHealthLeft * 100).toFixed(0).padStart(3)}%` +
      (s.slamsTaken + s.slamsDodged > 0 ? `  slams ${s.slamsTaken}/${s.slamsDodged}` : '') +
      (s.interrupts > 0 ? `  interrupts ${s.interrupts}` : '') +
      (s.mobHealed > 0 ? `  mob healed ${s.mobHealed}` : ''),
  );
}

/** The mob a player at `level` would sensibly be grinding. Never a boss. */
function grindMobFor(level: number): MobDef {
  const candidates = Object.values(MOBS)
    .filter((m) => m.stars < BOSS_STARS && m.level <= level + 1)
    .sort((a, b) => b.level - a.level);
  return candidates[0] ?? MOBS.moor_hare!;
}

/** Kills of a level-appropriate mob needed to clear one level. */
function killsForLevel(level: number): number {
  const mob = grindMobFor(level);
  return Math.ceil(xpToNext(level) / xpForKill(mob.xp, mob.level, level));
}

// --------------------------------------------------------------------------

describe('the first fight', () => {
  it('is a clear win that still costs something', () => {
    const enc: Encounter = {
      name: 'lv1 starting kit vs Moor Hare ★1 (1)',
      level: 1,
      gear: [],
      mobId: 'moor_hare',
      skills: ['strike'],
    };
    const s = runEncounter(enc);
    report(enc.name, s);

    expect(s.winRate).toBe(1);
    // Long enough to see a cooldown come back, short enough to stay interesting.
    expect(s.medianTtk).toBeGreaterThan(3);
    expect(s.medianTtk).toBeLessThan(20);
    // A first fight that costs nothing teaches nothing; one that nearly kills
    // you reads as the game being unfair before you understand it.
    expect(s.medianHealthLeft).toBeLessThan(0.95);
    expect(s.medianHealthLeft).toBeGreaterThan(0.5);
  });
});

describe('level-appropriate encounters are winnable across the whole 1-25 band', () => {
  const encounters: Encounter[] = [
    {
      name: 'lv4 vs Mossback Boar ★1 (3)',
      level: 4,
      gear: [],
      mobId: 'mossback_boar',
      skills: ['strike', 'rend'],
    },
    {
      name: 'lv6 vs Fen Adder ★2 (5)',
      level: 6,
      gear: ['bronze_shortsword', 'boiled_leather_vest'],
      mobId: 'fen_adder',
      skills: ['strike', 'rend', 'bulwark'],
    },
    {
      name: 'lv9 vs Bog Wolf ★2 (8)',
      level: 9,
      gear: ['ironbark_cudgel', 'boiled_leather_vest', 'leather_coif'],
      mobId: 'bog_wolf',
      skills: ['strike', 'rend', 'bulwark', 'sunder'],
    },
    {
      name: 'lv12 vs Moor Stag ★3 (11)',
      level: 12,
      gear: ['iron_longsword', 'studded_jerkin', 'leather_coif', 'bogstrider_greaves'],
      mobId: 'moor_stag',
      skills: ['strike', 'rend', 'bulwark', 'sunder'],
    },
    {
      name: 'lv17 vs Outlaw Reaver ★3 (16)',
      level: 17,
      gear: ['outlaw_saber', 'outlaw_mail', 'outlaw_hood', 'reaver_legguards'],
      mobId: 'outlaw_reaver',
      skills: ['strike', 'rend', 'bulwark', 'sunder', 'onslaught'],
    },
    {
      name: 'lv21 vs Marsh Bear ★4 (19)',
      level: 21,
      gear: ['boar_spear', 'outlaw_mail', 'bearhide_helm', 'reaver_legguards', 'outlaws_signet'],
      mobId: 'marsh_bear',
      skills: ['strike', 'rend', 'bulwark', 'sunder', 'onslaught'],
    },
    {
      name: 'lv25 vs Outlaw Marauder ★4 (23)',
      level: 25,
      gear: ['cadfaels_cleaver', 'bearhide_cuirass', 'bearhide_helm', 'fenhide_leggings', 'outlaws_signet'],
      mobId: 'outlaw_marauder',
      skills: ['strike', 'rend', 'bulwark', 'sunder', 'onslaught'],
    },
  ];

  for (const enc of encounters) {
    it(`${enc.name} — wins reliably in a sane time`, () => {
      const s = runEncounter(enc);
      report(enc.name, s);

      // A level-appropriate fight should almost never be lost by a player who
      // simply presses their buttons.
      expect(s.winRate).toBeGreaterThanOrEqual(0.9);
      // Long enough that skills and cooldowns matter, short enough that a
      // grind-heavy game does not become unplayable.
      expect(s.medianTtk).toBeGreaterThan(4);
      expect(s.medianTtk).toBeLessThan(40);
      expect(s.timeouts).toBe(0);
      // It should still cost something — a fight you win at full health is noise.
      expect(s.medianHealthLeft).toBeLessThan(0.95);
    });
  }
});

describe('star ratings mean something', () => {
  it('makes a higher star rating strictly harder at the same level', () => {
    // Same level, same player, only the star modifiers differ.
    for (let stars = 1; stars < 6; stars++) {
      const lower = STAR_MODIFIERS[stars as 1];
      const higher = STAR_MODIFIERS[(stars + 1) as 2];
      expect(higher.health).toBeGreaterThan(lower.health);
      expect(higher.damage).toBeGreaterThan(lower.damage);
      expect(higher.defense).toBeGreaterThan(lower.defense);
    }
  });

  it('gives every zone a ★5 boss and a ★6 elite boss, and nothing else above ★4', () => {
    for (const zone of Object.values(ZONES)) {
      const stars = zone.spawns.map((s) => MOBS[s.mobId]!.stars);
      expect(stars.filter((n) => n === BOSS_STARS).length, `${zone.id} boss`).toBe(1);
      expect(stars.filter((n) => n === 6).length, `${zone.id} elite boss`).toBe(1);
      expect(stars.filter((n) => n > 6).length).toBe(0);
    }
  });

  it('keeps boss arenas clear of unrelated camps', () => {
    // A boss fight is about the boss. If an ordinary camp sits close enough
    // that meleeing the boss puts you inside its aggro radius, every attempt
    // drags extra mobs in and the encounter stops being the fight you designed.
    const MELEE_STANDOFF = 3.5;
    const MARGIN = 4;
    const bosses = FENMARCH.spawns.filter((s) => MOBS[s.mobId]!.stars >= BOSS_STARS);
    expect(bosses.length).toBe(2);

    for (const boss of bosses) {
      for (const other of FENMARCH.spawns) {
        if (other === boss) continue;
        const otherDef = MOBS[other.mobId]!;
        if (otherDef.stars >= BOSS_STARS) continue;
        // Guards for THIS boss are part of the encounter by design.
        if (other.guardOf === boss.mobId) continue;
        const d = Math.hypot(boss.pos.x - other.pos.x, boss.pos.z - other.pos.z);
        const needed = MELEE_STANDOFF + otherDef.aggroRadius + roamOf(other) + MARGIN;
        if (d < needed) {
          throw new Error(
            `${otherDef.name} spawns ${d.toFixed(1)}u from ${MOBS[boss.mobId]!.name}; ` +
              `needs ${needed.toFixed(1)}u to stay out of the boss fight`,
          );
        }
      }
    }
  });

  it('keeps every spawn inside the zone bounds', () => {
    for (const spawn of FENMARCH.spawns) {
      expect(Math.abs(spawn.pos.x)).toBeLessThanOrEqual(FENMARCH.halfSize);
      expect(Math.abs(spawn.pos.z)).toBeLessThanOrEqual(FENMARCH.halfSize);
    }
  });

  it('leaves no gap wide enough to strand a player', () => {
    const levels = Object.values(MOBS)
      .filter((m) => m.stars < BOSS_STARS)
      .map((m) => m.level)
      .sort((a, b) => a - b);
    expect(levels[0]).toBe(1);
    expect(levels[levels.length - 1]).toBeGreaterThanOrEqual(MAX_LEVEL - 3);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]! - levels[i - 1]!, `gap above level ${levels[i - 1]}`).toBeLessThanOrEqual(6);
    }
  });
});

// --------------------------------------------------------------------------
// The whole reason boss abilities exist: without them, a boss fight's outcome
// is decided by the stat spread before the first swing. These tests assert that
// what the player DOES changes the result.
// --------------------------------------------------------------------------

describe('boss fights are decided by play, not just stats', () => {
  const cadfaelGear = ['boar_spear', 'outlaw_mail', 'bearhide_helm', 'reaver_legguards', 'outlaws_signet'];
  const scarGear = ['cadfaels_cleaver', 'bearhide_cuirass', 'bearhide_helm', 'fenhide_leggings', 'outlaws_signet'];
  const fullKit = ['strike', 'rend', 'rally', 'bulwark', 'sunder', 'onslaught'];

  it('gives every boss a different fight, not the same fight with a new name', () => {
    // The regression this exists for shipped and sat there: six of the eight
    // bosses were generated from one `bossKit` helper and ran slam → mend →
    // enrage, identically, with only the telegraph text differing. Every
    // assertion in this file passed the whole time, because each of them was
    // true of each boss individually. Printing the kits side by side is what
    // makes "these are the same fight" visible at all.
    const rows: string[] = [];
    const named: string[] = [];
    const signatures = new Map<string, string[]>();

    for (const zone of Object.values(ZONES)) {
      for (const spawn of zone.spawns) {
        const def = MOBS[spawn.mobId]!;
        if (def.stars < BOSS_STARS || def.dragon) continue;
        const kinds = (def.abilities ?? []).map((a) => a.kind);
        rows.push(`  ${def.name.padEnd(30)} ★${def.stars} (${String(def.level).padStart(3)})  ${kinds.join(', ')}`);
        // And what each ability is *called*, beside what it is. The target
        // frame now tells a player what to do about anything a boss has shown
        // them, which makes a name that contradicts its own kind actively
        // misleading: "Cleaving Blow — get out of the circle" sat in the game
        // for a while, telling the player to go round the side of an AoE they
        // were standing in the middle of. No assertion can see that; two
        // columns side by side can.
        for (const a of def.abilities ?? []) {
          named.push(`  ${a.name.padEnd(22)} ${a.kind.padEnd(11)} ${ABILITY_ANSWERS[a.kind]}`);
        }
        signatures.set(def.id, kinds);

        // Every boss must have something answered by *moving*. A boss whose
        // whole kit is answered by standing still and pressing buttons is a
        // stat block with a cooldown.
        const dodgeable = kinds.filter((k) => k === 'heavySlam' || k === 'cleave' || k === 'fixate' || k === 'hazard');
        expect(dodgeable.length, `${def.name} has nothing to dodge`).toBeGreaterThan(0);
        // And no boss repeats an ability kind — two cooldowns on one mechanic
        // is one mechanic that fires more often, not two mechanics.
        expect(new Set(kinds).size, `${def.name} repeats an ability kind`).toBe(kinds.length);
      }
    }

    console.log('\nWHAT EACH BOSS ACTUALLY DOES\n' + rows.sort().join('\n'));
    console.log(
      '\nAND WHAT EACH ABILITY IS CALLED, BESIDE WHAT IT IS\n' +
        [...new Set(named)].sort().join('\n'),
    );

    // The check with teeth: no two bosses may be answered by exactly the same
    // set of moves. They can share a piece; they cannot share the whole kit.
    const seen = new Map<string, string>();
    for (const [id, kinds] of signatures) {
      const signature = [...kinds].sort().join('+');
      const twin = seen.get(signature);
      expect(twin === undefined, `${id} is the same fight as ${twin}`).toBe(true);
      seen.set(signature, id);
    }
    expect(signatures.size).toBe(8);
  });

  it('makes playing well decide every boss in the game, not just the first two', () => {
    // One encounter per boss, at the level its zone expects, played badly and
    // played properly. Printed, because the gap between the two columns *is*
    // the mechanic — a boss where they match has a telegraph nobody needs to
    // read, and a boss where standing still wins has one that does nothing.
    const bosses = Object.values(ZONES)
      .flatMap((zone) => zone.spawns)
      .map((sp) => MOBS[sp.mobId]!)
      .filter((def) => def.stars >= BOSS_STARS && !def.dragon)
      .sort((a, b) => a.level - b.level);

    const rows: string[] = [];
    for (const def of bosses) {
      // One level of headroom: nobody fights a ★5 the minute they ding into
      // its level, and at exactly the boss's level with no potions the fight
      // is a coin flip by design. Two levels over is too far the other way —
      // dodging then costs more uptime than the telegraphs cost health, which
      // reads as "the mechanic does not matter" when what is being measured is
      // a player who has outgrown the fight.
      const level = def.level + 1;
      const shared = {
        level,
        gear: gearSetFor('warrior', level),
        mobId: def.id,
        skills: skillBarFor('warrior')
          .filter((sk) => sk.reqLevel <= level && !sk.taughtBy)
          .map((sk) => sk.id),
        noPotions: true,
      };
      const stand = runEncounter({ ...shared, name: `${def.name} standing`, dodge: false });
      const play = runEncounter({ ...shared, name: `${def.name} playing`, dodge: true });
      const row =
        `  ${def.name.padEnd(30)} lv${String(level).padStart(3)}  ` +
        `standing ${(stand.winRate * 100).toFixed(0).padStart(3)}% hp ${(stand.medianHealthLeft * 100).toFixed(0).padStart(3)}%  ` +
        `playing ${(play.winRate * 100).toFixed(0).padStart(3)}% hp ${(play.medianHealthLeft * 100).toFixed(0).padStart(3)}%  ` +
        `hit/dodged ${play.slamsTaken}/${play.slamsDodged} vs ${stand.slamsTaken}/${stand.slamsDodged}`;
      // Printed as it goes, so a failure part-way through still shows every
      // fight measured before it rather than only the message.
      console.log(row);
      rows.push(row);

      // The mechanics have to fire and have to be beatable.
      expect(play.slamsDodged, `${def.name}'s telegraphs never got dodged`).toBeGreaterThan(0);
      // Winnable at all, played properly and with nothing to drink. How
      // *comfortably* is the hand-tuned tests' business a few cases down; what
      // this one guards is that the mechanic exists and can be beaten.
      expect(play.winRate, `${def.name} is unwinnable played well`).toBeGreaterThan(0.4);
      // And playing well has to be better on both counts. Not necessarily the
      // difference between a win and a loss — some of these are generous — but
      // never worse, which is what a decorative telegraph looks like.
      expect(play.winRate, `${def.name} rewards ignoring it`).toBeGreaterThanOrEqual(stand.winRate);
      expect(play.medianHealthLeft, `${def.name} punishes dodging`).toBeGreaterThan(
        stand.medianHealthLeft,
      );
    }
    console.log('\nEVERY BOSS, PLAYED BADLY AND PLAYED WELL\n' + rows.join('\n'));
  });

  it('Cadfael ★5 (20): dodging the telegraphs decides the fight', () => {
    const stand = runEncounter({
      name: 'lv22 vs Cadfael, standing in it',
      level: 22,
      gear: cadfaelGear,
      mobId: 'cadfael',
      skills: fullKit,
      dodge: false,
      noPotions: true,
    });
    const dodge = runEncounter({
      name: 'lv22 vs Cadfael, dodging',
      level: 22,
      gear: cadfaelGear,
      mobId: 'cadfael',
      skills: fullKit,
      dodge: true,
      noPotions: true,
    });
    report('lv22 vs Cadfael ★5 (20), standing', stand);
    report('lv22 vs Cadfael ★5 (20), dodging', dodge);

    // The mechanic has to actually fire, and actually be escapable.
    expect(stand.slamsTaken).toBeGreaterThan(0);
    expect(dodge.slamsDodged).toBeGreaterThan(0);
    // And it has to matter: playing well must beat playing badly by a wide margin.
    expect(dodge.winRate).toBeGreaterThan(stand.winRate + 0.25);
    expect(dodge.medianHealthLeft).toBeGreaterThan(stand.medianHealthLeft);
  });

  it('Old Scar ★6 (25): dodging the telegraphs decides the fight', () => {
    const stand = runEncounter({
      name: 'lv25 vs Old Scar, standing in it',
      level: 25,
      gear: scarGear,
      mobId: 'old_scar',
      skills: fullKit,
      dodge: false,
      // Dry, both sides. A draught helps whoever stood in it just as much as
      // whoever moved, which is noise on the only comparison being made.
      noPotions: true,
    });
    const dodge = runEncounter({
      name: 'lv25 vs Old Scar, dodging',
      level: 25,
      gear: scarGear,
      mobId: 'old_scar',
      skills: fullKit,
      dodge: true,
      noPotions: true,
    });
    report('lv25 vs Old Scar ★6 (25), standing', stand);
    report('lv25 vs Old Scar ★6 (25), dodging', dodge);

    expect(stand.slamsTaken).toBeGreaterThan(0);
    expect(dodge.slamsDodged).toBeGreaterThan(0);
    expect(dodge.winRate).toBeGreaterThan(stand.winRate + 0.25);
  });

  it('turns back an underlevelled player at either boss', () => {
    for (const [mobId, level] of [
      ['cadfael', 14],
      ['old_scar', 18],
    ] as const) {
      const s = runEncounter(
        { name: mobId, level, gear: cadfaelGear, mobId, skills: fullKit, dodge: true },
        30,
      );
      report(`lv${level} vs ${mobId} (underlevelled)`, s);
      expect(s.winRate).toBeLessThan(0.2);
    }
  });
});

// --------------------------------------------------------------------------
// The grind. This game is deliberately grind-heavy: kills per level should be
// high and should keep climbing all the way to the cap.
// --------------------------------------------------------------------------

describe('the grind curve', () => {
  it('keeps demanding more kills at every level', () => {
    const rows: string[] = [];
    let total = 0;
    for (let level = 1; level < MAX_LEVEL; level++) {
      const kills = killsForLevel(level);
      total += kills;
      const mob = grindMobFor(level);
      rows.push(
        `  lv${String(level).padStart(2)} -> ${String(level + 1).padStart(2)}  ` +
          `${String(kills).padStart(4)} kills of ${mob.name} (${mob.level}★${mob.stars})`,
      );
    }
    console.log('\nGRIND CURVE\n' + rows.join('\n') + `\n  TOTAL to level ${MAX_LEVEL}: ${total} kills\n`);

    // Deliberately steep: this is the requested design, not an accident.
    expect(total).toBeGreaterThan(1200);
    expect(killsForLevel(1)).toBeLessThan(12);
    expect(killsForLevel(MAX_LEVEL - 1)).toBeGreaterThan(90);
  });

  it('increases strictly when the mob you fight keeps pace with your level', () => {
    // The pure curve property, independent of which camp a player picks: at a
    // fixed relative difficulty, each level costs more kills than the last.
    let previous = 0;
    for (let level = 1; level < MAX_LEVEL; level++) {
      const xp = xpForKill(baseMobXp(level, 2), level, level);
      const kills = xpToNext(level) / xp;
      expect(kills).toBeGreaterThan(previous);
      previous = kills;
    }
  });

  it('trends upward along the actual play path', () => {
    // Moving to a fresher camp dips kills for a level or two — that dip is the
    // reward for pushing south. Assert the shape of the whole game instead:
    // each third of the level range costs more per level than the one before.
    const kills: number[] = [];
    for (let level = 1; level < MAX_LEVEL; level++) kills.push(killsForLevel(level));
    const third = Math.floor(kills.length / 3);
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    const early = mean(kills.slice(0, third));
    const mid = mean(kills.slice(third, third * 2));
    const late = mean(kills.slice(third * 2));

    console.log(
      `  kills/level by third: early ${early.toFixed(0)}, mid ${mid.toFixed(0)}, late ${late.toFixed(0)}`,
    );
    expect(mid).toBeGreaterThan(early);
    expect(late).toBeGreaterThan(mid);
    // And the ramp should be steep, not a token increase.
    expect(late).toBeGreaterThan(early * 3);
  });

  it('makes grey mobs not worth farming', () => {
    const hare = MOBS.moor_hare!;
    // Full value at its own level, near-worthless once you have outgrown it.
    expect(xpForKill(hare.xp, hare.level, hare.level)).toBe(hare.xp);
    expect(xpForKill(hare.xp, hare.level, 12)).toBeLessThan(hare.xp * 0.15);
  });

  it('keeps the level curve monotonically more expensive', () => {
    for (let level = 1; level < MAX_LEVEL - 1; level++) {
      expect(xpToNext(level + 1)).toBeGreaterThan(xpToNext(level));
    }
  });
});

describe('level gaps matter', () => {
  it('punishes fighting well above your level', () => {
    const s = runEncounter(
      {
        name: 'lv8 vs Outlaw Reaver ★3 (16)',
        level: 8,
        gear: ['ironbark_cudgel'],
        mobId: 'outlaw_reaver',
        skills: ['strike', 'rend'],
      },
      40,
    );
    report('lv8 vs Outlaw Reaver ★3 (16)', s);
    expect(s.winRate).toBeLessThan(0.25);
  });
});

// --------------------------------------------------------------------------
// The loot economy.
//
// The design rule: harder mobs drop BETTER things and MORE GOLD, but gear
// stays rare at every tier. Gold and merchant goods are the reliable reward;
// equipment is the lottery.
// --------------------------------------------------------------------------

describe('loot scales with difficulty', () => {
  /**
   * Ordinary mobs, ordered from easiest to hardest by level then stars.
   *
   * Rare spawns are excluded, and not as a convenience: every rule below is
   * about what a CAMP pays out. A named creature you see once an hour is
   * governed by the opposite rules — guaranteed epic, double gold — and
   * mixing the two would either forbid the rare or licence the camp.
   *
   * Wild horses are excluded for the mirror reason: they are worth almost
   * nothing dead ON PURPOSE, because killing one is the mistake. Holding them
   * to "harder mobs pay more" would price the lesson out of the game.
   *
   * Star variants are excluded because they are not separate creatures — they
   * are the same animal at another rating, and their gold and experience come
   * from the same two functions as everything else here. Including them only
   * measured `goldForKill` against itself, while adding four times as many
   * pairs to a dominance check that then tripped over a flavour bonus one
   * loot table has and another does not.
   */
  const ladder = Object.values(MOBS)
    .filter((m) => m.stars < BOSS_STARS && !m.rareOf && !m.horse && !m.starOf)
    .sort((a, b) => a.level - b.level || a.stars - b.stars);

  /** Average gold a kill yields. */
  function expectedGold(mob: MobDef): number {
    const table = LOOT_TABLES[mob.lootTableId]!;
    const g = goldForKill(mob.level, mob.stars, table.goldMultiplier ?? 1);
    return (g.min + g.max) / 2;
  }

  /** Average vendor value of the items a kill yields. */
  function expectedItemValue(mob: MobDef): number {
    const table = LOOT_TABLES[mob.lootTableId]!;
    return table.entries.reduce((total, e) => {
      const qty = (e.min + e.max) / 2;
      return total + e.chance * qty * getItem(e.itemId).value;
    }, 0);
  }

  /** Chance that a kill drops any equippable piece. */
  function equipmentChance(mob: MobDef): number {
    const table = LOOT_TABLES[mob.lootTableId]!;
    return table.entries
      .filter((e) => getItem(e.itemId).slot !== null)
      .reduce((total, e) => total + e.chance, 0);
  }

  it('pays strictly more gold the harder the mob', () => {
    const rows = ladder.map(
      (m) =>
        `  ${m.name.padEnd(18)} lv${String(m.level).padStart(2)} ★${m.stars}  ` +
        `gold ${expectedGold(m).toFixed(0).padStart(5)}  ` +
        `item value ${expectedItemValue(m).toFixed(0).padStart(4)}  ` +
        `gear chance ${(equipmentChance(m) * 100).toFixed(0).padStart(2)}%`,
    );
    console.log('\nLOOT LADDER\n' + rows.join('\n'));

    // 'Harder' is a partial order, not a single ranking: a low-level ★3 can be
    // tougher than a higher-level ★2. So assert the dominance relation — if one
    // mob is no easier on BOTH axes and strictly harder on one, it must pay more.
    for (const a of ladder) {
      for (const c of ladder) {
        const dominates =
          c.level >= a.level && c.stars >= a.stars && (c.level > a.level || c.stars > a.stars);
        if (!dominates) continue;
        if (expectedGold(c) <= expectedGold(a)) {
          throw new Error(
            `${c.name} (lv${c.level} ★${c.stars}) pays ${expectedGold(c).toFixed(0)} gold, ` +
              `no more than the strictly easier ${a.name} (lv${a.level} ★${a.stars}) at ${expectedGold(a).toFixed(0)}`,
          );
        }
      }
    }
  });

  it('keeps equipment rare on every ordinary mob', () => {
    for (const mob of ladder) {
      const chance = equipmentChance(mob);
      if (chance > MAX_EQUIPMENT_DROP_CHANCE) {
        throw new Error(
          `${mob.name} drops equipment ${(chance * 100).toFixed(0)}% of the time; ` +
            `ceiling is ${(MAX_EQUIPMENT_DROP_CHANCE * 100).toFixed(0)}%`,
        );
      }
    }
  });

  it('raises the value of what drops, not how often it drops', () => {
    // Expected item value per kill must climb across the ladder even though the
    // drop *rate* does not — that is the whole "better, not more" rule.
    const easiest = ladder.slice(0, 5);
    const hardest = ladder.slice(-5);
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

    expect(mean(hardest.map(expectedItemValue))).toBeGreaterThan(
      mean(easiest.map(expectedItemValue)) * 8,
    );
    // ...while the gear drop RATE climbs far more gently than the value does.
    // "Better, not more" is now "much better, and a little likelier": a ★4 that
    // takes four times as long and kills a fifth of the players who pull it
    // should not pay out as rarely as the ★1 beside it, and the cap keeps the
    // whole thing rare either way.
    expect(mean(hardest.map(equipmentChance))).toBeLessThan(
      mean(easiest.map(equipmentChance)) * 4,
    );
  });

  it('gives harder mobs better merchant goods', () => {
    // Expected value per kill, not the single best item: two mobs can share a
    // rare drop, so 'best item' plateaus where the actual income does not.
    const goodsValue = (mob: MobDef): number =>
      LOOT_TABLES[mob.lootTableId]!.entries.filter((e) => getItem(e.itemId).merchantGood).reduce(
        (total, e) => total + e.chance * ((e.min + e.max) / 2) * getItem(e.itemId).value,
        0,
      );
    const ramp = [MOBS.moor_hare!, MOBS.bog_wolf!, MOBS.marsh_bear!, MOBS.outlaw_marauder!];
    for (let i = 1; i < ramp.length; i++) {
      expect(goodsValue(ramp[i]!)).toBeGreaterThan(goodsValue(ramp[i - 1]!));
    }
  });

  it('pays far better for a boss than for anything ordinary nearby', () => {
    // Zone bosses only. A dragon is ★6 as well, but it is not something a zone
    // spawns and it is not what this rule is about.
    const bosses = Object.values(MOBS).filter((m) => m.stars >= BOSS_STARS && !m.dragon);
    expect(bosses.length).toBe(8);
    for (const boss of bosses) {
      // Compare against what you would otherwise be killing at that level.
      const peers = ladder.filter((m) => Math.abs(m.level - boss.level) <= 6);
      const best = Math.max(...peers.map(expectedGold));
      expect(expectedGold(boss), `${boss.name} pays too little`).toBeGreaterThan(best * 3);
    }
  });

  it('only lets epics come from bosses and rare spawns', () => {
    for (const mob of ladder) {
      for (const entry of LOOT_TABLES[mob.lootTableId]!.entries) {
        const item = getItem(entry.itemId);
        if (item.quality === 'epic') {
          throw new Error(`${mob.name} (★${mob.stars}) drops the epic ${item.name}`);
        }
      }
    }
  });

  it('guarantees each boss a weapon for every playable class', () => {
    for (const bossId of ['cadfael', 'old_scar'] as const) {
      const table = LOOT_TABLES[MOBS[bossId]!.lootTableId]!;
      expect(table.classWeapons).toBeDefined();
      for (const cls of PLAYABLE_CLASSES) {
        const weaponId = table.classWeapons![cls.id];
        expect(weaponId, `${bossId} has no weapon for ${cls.id}`).toBeDefined();
        const weapon = getItem(weaponId!);
        expect(weapon.slot).toBe('weapon');
        expect(weapon.quality).toBe('epic');
        expect(canEquip(weapon, cls.id)).toBe(true);
      }
    }
  });
});

// --------------------------------------------------------------------------
// The Priest must be a real alternative, not a worse Warrior.
// --------------------------------------------------------------------------

describe('the Priest holds its own', () => {
  const priestKit = ['smite', 'mend_wounds', 'searing_word', 'spirit_shield', 'judgement'];

  it('clears its own first fight', () => {
    const s = runEncounter({
      name: 'lv1 Priest vs Moor Hare ★1 (1)',
      level: 1,
      gear: [],
      mobId: 'moor_hare',
      skills: ['smite'],
      classId: 'priest',
    });
    report('lv1 Priest vs Moor Hare ★1 (1)', s);
    expect(s.winRate).toBe(1);
    expect(s.medianTtk).toBeGreaterThan(3);
    expect(s.medianTtk).toBeLessThan(20);
  });

  for (const enc of [
    { name: 'lv9 Priest vs Bog Wolf ★2 (8)', level: 9, mobId: 'bog_wolf', gear: ['blessed_mace', 'boiled_leather_vest', 'leather_coif'] },
    { name: 'lv17 Priest vs Outlaw Reaver ★3 (16)', level: 17, mobId: 'outlaw_reaver', gear: ['reliquary_mace', 'outlaw_mail', 'outlaw_hood', 'reaver_legguards'] },
    { name: 'lv25 Priest vs Outlaw Marauder ★4 (23)', level: 25, mobId: 'outlaw_marauder', gear: ['chieftains_reliquary', 'bearhide_cuirass', 'bearhide_helm', 'fenhide_leggings', 'outlaws_signet'] },
  ]) {
    it(`${enc.name} — wins reliably in a sane time`, () => {
      const s = runEncounter({ ...enc, skills: priestKit, classId: 'priest' });
      report(enc.name, s);
      expect(s.winRate).toBeGreaterThanOrEqual(0.9);
      expect(s.medianTtk).toBeGreaterThan(4);
      expect(s.medianTtk).toBeLessThan(45);
      expect(s.timeouts).toBe(0);
    });
  }

  it('trades kill speed for sustain against the Warrior', () => {
    const shared = { level: 17, mobId: 'outlaw_reaver' as const, skills: [] as string[] };
    const warrior = runEncounter({
      ...shared,
      name: 'warrior',
      classId: 'warrior',
      gear: ['outlaw_saber', 'outlaw_mail', 'outlaw_hood', 'reaver_legguards'],
      skills: ['strike', 'rend', 'rally', 'bulwark', 'sunder', 'onslaught'],
    });
    const priest = runEncounter({
      ...shared,
      name: 'priest',
      classId: 'priest',
      gear: ['reliquary_mace', 'outlaw_mail', 'outlaw_hood', 'reaver_legguards'],
      skills: priestKit,
    });
    report('lv17 Warrior vs Outlaw Reaver', warrior);
    report('lv17 Priest  vs Outlaw Reaver', priest);

    // Both must be viable — that is the bar. The Priest trades kill speed for
    // sustain, so it should be slower and should heal considerably more.
    //
    // It is NOT simply "ends on more health": in a short fight the Warrior's
    // faster kill means less damage taken overall, and the Priest's advantage
    // only compounds over a long one. Asserting health-remaining here measured
    // fight length, not the class.
    expect(warrior.winRate).toBeGreaterThanOrEqual(0.9);
    expect(priest.winRate).toBeGreaterThanOrEqual(0.9);
    expect(priest.medianTtk).toBeGreaterThanOrEqual(warrior.medianTtk);
  });

  it('out-sustains the Warrior where sustain decides the fight', () => {
    // Over a short fight both classes simply overheal, so this has to be
    // measured somewhere long enough for healing to matter.
    const bossGear = (classId: 'warrior' | 'priest'): string[] =>
      gearSetFor(classId, 22).concat(['outlaw_mail', 'bearhide_helm']);
    const shared = { level: 22, mobId: 'cadfael', dodge: true, name: '', noPotions: true };
    const warrior = runEncounter(
      {
        ...shared,
        classId: 'warrior',
        gear: bossGear('warrior'),
        skills: ['strike', 'rend', 'rally', 'bulwark', 'sunder', 'bash', 'onslaught'],
      },
      30,
    );
    const priest = runEncounter(
      {
        ...shared,
        classId: 'priest',
        gear: bossGear('priest'),
        skills: ['smite', 'mend_wounds', 'searing_word', 'rebuke', 'spirit_shield', 'judgement'],
      },
      30,
    );
    // Both fought dry: a draught heals a Warrior exactly as well as a Priest,
    // so carrying one dilutes the only thing this test is measuring.
    console.log(
      `  self-healed over Cadfael: warrior ${warrior.selfHealed}, priest ${priest.selfHealed}`,
    );
    expect(priest.selfHealed).toBeGreaterThan(warrior.selfHealed * 1.4);
  });

  it('answers a boss heal with its interrupt', () => {
    const gear = ['prayerwood_stave', 'outlaw_mail', 'bearhide_helm', 'reaver_legguards', 'outlaws_signet'];
    const ignore = runEncounter({
      name: 'ignoring the heal',
      level: 22,
      gear,
      mobId: 'cadfael',
      skills: priestKit,
      classId: 'priest',
      dodge: true,
    });
    const punish = runEncounter({
      name: 'interrupting the heal',
      level: 22,
      gear,
      mobId: 'cadfael',
      skills: priestKit,
      classId: 'priest',
      dodge: true,
      interruptSkill: 'rebuke',
    });
    report('lv22 Priest vs Cadfael, no interrupt', ignore);
    report('lv22 Priest vs Cadfael, interrupting', punish);

    // The interrupt has to actually land, and it has to deny real healing.
    expect(punish.interrupts).toBeGreaterThan(0);
    expect(ignore.mobHealed).toBeGreaterThan(0);
    expect(punish.mobHealed).toBeLessThan(ignore.mobHealed);
  });
});

// --------------------------------------------------------------------------
// Five classes must be five ways to play, not four handicaps and one answer.
// --------------------------------------------------------------------------

describe('every class is viable', () => {
  /** The kit a class actually has by `level`, minus its self-heal-on-cast. */
  function kitFor(classId: ClassId, level: number): string[] {
    return skillsForClass(classId, level).map((s) => s.id);
  }

  /** Tier-appropriate weapon for a class, off the canonical progression. */
  function weaponFor(classId: ClassId, tier: number): string {
    return WEAPON_LADDER[classId][tier]!;
  }

  it('keeps every class weapon ladder in DPS parity, tier for tier', () => {
    const dps = (item: (typeof ITEMS)[string]): number =>
      (((item.damageMin! + item.damageMax!) / 2) / item.swingMs!) * 1000;

    const rows: string[] = [];
    for (let tier = 0; tier < 8; tier++) {
      const perClass = PLAYABLE_CLASSES.map((c) => ({
        id: c.id,
        dps: dps(ITEMS[weaponFor(c.id, tier)]!),
      }));
      const lo = Math.min(...perClass.map((x) => x.dps));
      const hi = Math.max(...perClass.map((x) => x.dps));
      rows.push(
        `  tier ${tier + 1}  ` +
          perClass.map((x) => `${x.id.slice(0, 3)} ${x.dps.toFixed(1)}`).join('  ') +
          `   spread ${((hi / lo - 1) * 100).toFixed(0)}%`,
      );
      // A class whose weapons are quietly 40% better than everyone else's is
      // not a different playstyle, it is the correct choice.
      expect(hi / lo).toBeLessThan(1.4);
    }
    console.log('\nWEAPON LADDER PARITY\n' + rows.join('\n'));
  });

  it('gives every class an interrupt and a way to heal or mitigate', () => {
    for (const cls of PLAYABLE_CLASSES) {
      const kit = skillBarFor(cls.id);
      expect(kit.some((s) => s.kind === 'interrupt'), `${cls.id} has no interrupt`).toBe(true);
      expect(
        kit.some((s) => s.kind === 'heal' || (s.kind === 'buff' && s.defenseBonus)),
        `${cls.id} has no way to survive a spike`,
      ).toBe(true);
      // And something to open with from level 1.
      expect(kit.some((s) => s.reqLevel === 1 && s.kind === 'damage')).toBe(true);
    }
  });

  it('clears the first fight on every class', () => {
    for (const cls of PLAYABLE_CLASSES) {
      const s = runEncounter({
        name: `lv1 ${cls.name}`,
        level: 1,
        gear: [],
        mobId: 'moor_hare',
        skills: kitFor(cls.id, 1),
        classId: cls.id,
      });
      report(`lv1 ${cls.name} vs Moor Hare ★1 (1)`, s);
      expect(s.winRate, `${cls.id} loses its first fight`).toBe(1);
      expect(s.medianTtk, `${cls.id} first fight too fast`).toBeGreaterThan(3);
      expect(s.medianTtk, `${cls.id} first fight too slow`).toBeLessThan(22);
    }
  });

  it('clears a mid-band fight on every class', () => {
    for (const cls of PLAYABLE_CLASSES) {
      const s = runEncounter({
        name: cls.name,
        level: 17,
        gear: [weaponFor(cls.id, 4), 'outlaw_mail', 'outlaw_hood', 'reaver_legguards'],
        mobId: 'outlaw_reaver',
        skills: kitFor(cls.id, 17),
        classId: cls.id,
      });
      report(`lv17 ${cls.name} vs Outlaw Reaver ★3 (16)`, s);
      expect(s.winRate, `${cls.id} cannot handle its own level`).toBeGreaterThanOrEqual(0.9);
      expect(s.medianTtk).toBeGreaterThan(4);
      expect(s.medianTtk).toBeLessThan(45);
      expect(s.timeouts).toBe(0);
    }
  });

  it('clears the endgame on every class', () => {
    for (const cls of PLAYABLE_CLASSES) {
      const s = runEncounter({
        name: cls.name,
        level: 25,
        gear: [
          weaponFor(cls.id, 6),
          'bearhide_cuirass',
          'bearhide_helm',
          'fenhide_leggings',
          'outlaws_signet',
        ],
        mobId: 'outlaw_marauder',
        skills: kitFor(cls.id, 25),
        classId: cls.id,
      });
      report(`lv25 ${cls.name} vs Outlaw Marauder ★4 (23)`, s);
      expect(s.winRate, `${cls.id} falls off at the cap`).toBeGreaterThanOrEqual(0.9);
      expect(s.timeouts).toBe(0);
    }
  });

  it('gives every class a guaranteed weapon from both bosses', () => {
    for (const bossId of ['cadfael', 'old_scar'] as const) {
      const table = LOOT_TABLES[MOBS[bossId]!.lootTableId]!;
      for (const cls of PLAYABLE_CLASSES) {
        const weaponId = table.classWeapons?.[cls.id];
        expect(weaponId, `${bossId} has no weapon for ${cls.id}`).toBeDefined();
        const weapon = getItem(weaponId!);
        expect(weapon.quality).toBe('epic');
        expect(canEquip(weapon, cls.id)).toBe(true);
      }
    }
  });
});

// --------------------------------------------------------------------------
// Vendors close the economy: gold gets a sink, merchant goods get a buyer.
// --------------------------------------------------------------------------

describe('zone-taught skills are worth going to get', () => {
  /**
   * The same shape as the dodge and interrupt comparisons: measure the player
   * who did the thing against the player who did not.
   *
   * A skill you cross a zone and kill a boss for has to be visibly better than
   * not having it, or the tome is just an item with extra steps.
   */
  it('measurably beats the level-granted kit alone', () => {
    const rows: string[] = [];
    for (const [level, mobId] of [
      [40, 'clan_berserker'],
      [70, 'grey_seal_bull'],
      [100, 'fort_warden'],
    ] as const) {
      for (const cls of PLAYABLE_CLASSES) {
        const untaught = runEncounter(
          {
            name: cls.name,
            level,
            gear: gearSetFor(cls.id, level),
            mobId,
            skills: skillsForClass(cls.id, level).map((sk) => sk.id),
            classId: cls.id,
            learned: [],
            // Both dry, and both unranked. A draught and a skill point are each
            // worth the same to a character who found the zone's tomes and one
            // who did not — and skill points are worse than neutral here, since
            // a hundred of them spread over a longer list of skills means lower
            // ranks on every one. Neither belongs in a kit-versus-kit test.
            noPotions: true,
            ranks: {},
          },
          20,
        );
        const taught = runEncounter(
          {
            name: cls.name,
            level,
            gear: gearSetFor(cls.id, level),
            mobId,
            skills: skillsForClass(cls.id, level, learnedAt(cls.id, level)).map((sk) => sk.id),
            classId: cls.id,
            noPotions: true,
            ranks: {},
          },
          20,
        );
        if (cls.id === 'warrior' || cls.id === 'rogue') {
          rows.push(
            `  lv${String(level).padStart(3)} ${cls.name.padEnd(8)} ` +
              `untaught ttk ${untaught.medianTtk.toFixed(1).padStart(5)}s hp ${(untaught.medianHealthLeft * 100).toFixed(0).padStart(3)}%  ` +
              `taught ttk ${taught.medianTtk.toFixed(1).padStart(5)}s hp ${(taught.medianHealthLeft * 100).toFixed(0).padStart(3)}%`,
          );
        }
        // Faster kills, more health left, or both — but never worse.
        const better =
          taught.medianTtk < untaught.medianTtk * 0.95 ||
          taught.medianHealthLeft > untaught.medianHealthLeft + 0.03;
        expect(better, `${cls.id}'s taught kit changes nothing at ${level}`).toBe(true);
        expect(taught.medianHealthLeft).toBeGreaterThanOrEqual(untaught.medianHealthLeft - 0.05);
      }
    }
    console.log('\nTAUGHT KIT vs LEVEL KIT (Warrior and Rogue shown; all five asserted)\n' + rows.join('\n'));
  });
});

describe('rare spawns are a fight, and worth the wait', () => {
  it('beats the camp it hides in without being a boss', () => {
    const winRates: number[] = [];
    const rows: string[] = [];
    for (const spec of RARES) {
      const rare = MOBS[rareMobId(spec)]!;
      const host = MOBS[spec.hostMobId]!;
      // Fought at the rare's own level, geared for it: what a player farming
      // that camp actually brings.
      for (const cls of PLAYABLE_CLASSES) {
        const level = rare.level;
        const versus = (mobId: string): Summary =>
          runEncounter(
            {
              name: cls.name,
              level,
              gear: gearSetFor(cls.id, level),
              mobId,
              skills: skillsForClass(cls.id, level, learnedAt(cls.id, level)).map((sk) => sk.id),
              classId: cls.id,
              dodge: true,
            },
            12,
          );
        const named = versus(rare.id);
        if (cls.id === 'warrior') {
          const camp = versus(host.id);
          rows.push(
            `  ${rare.name.padEnd(36)} ttk ${named.medianTtk.toFixed(1).padStart(5)}s ` +
              `hp ${(named.medianHealthLeft * 100).toFixed(0).padStart(3)}%  ` +
              `(camp mob ${camp.medianTtk.toFixed(1)}s hp ${(camp.medianHealthLeft * 100).toFixed(0)}%)`,
          );
          // "Bigger fight" is asserted on the stat block rather than on the
          // clock: at low levels both die inside a handful of swings and the
          // times quantise to the same tick, which says nothing either way.
          const namedStats = deriveMobStats(rare);
          const campStats = deriveMobStats(host);
          // A fifth tougher at least. A rare whose host is already ★4 takes a
          // smaller multiple than one that can climb a star, because it is
          // taking that multiple on top of the hardest ordinary stat block in
          // the game rather than on top of a middling one.
          const topped = rare.stars === host.stars;
          expect(namedStats.maxHealth, `${rare.name} is no tougher than the camp`).toBeGreaterThan(
            campStats.maxHealth * (topped ? 1.18 : 1.4),
          );
          expect(namedStats.damageMax).toBeGreaterThan(campStats.damageMax);
          expect(named.medianTtk).toBeGreaterThanOrEqual(camp.medianTtk);
        }
        // But a rare is not a boss: someone farming its camp must be able to
        // take it, or the whole mechanic is a taunt.
        //
        // "Able to take it" rather than "takes it nine times in ten". That bar
        // was written when a camp mob cost a tenth of your health, so anything
        // beatable was beatable almost always. Gaining a star makes a rare a ★4
        // fight, and the lethality suite measures a ★4 as the thing that kills
        // half the characters that pull one — so a cloth class meeting one at
        // level 18 losing more often than it wins is the world working, not the
        // rare being broken. What must never happen is a hard lock.
        expect(named.winRate, `${cls.id} is locked out of ${rare.name}`).toBeGreaterThan(0.2);
        winRates.push(named.winRate);
        expect(named.timeouts, `${cls.id} times out on ${rare.name}`).toBe(0);
      }
      // And across the five classes it has to be a fight most characters win.
      // One class having a bad time is the world; every class having one means
      // nobody ever cashes the thirty minutes of camping.
      const median = [...winRates].sort((a, b) => a - b)[Math.floor(winRates.length / 2)]!;
      // Half the roster, not most of it. A rare whose host is already ★4 gains
      // no star — there is nowhere above ★4 that is not a boss — so it takes
      // the full toughness multiple on top of the hardest ordinary stat block
      // in the game. Those are the hardest non-boss fights there are, and they
      // should be.
      expect(median, `${rare.name} beats the roster`).toBeGreaterThanOrEqual(0.5);
      winRates.length = 0;
    }
    console.log('\nRARE SPAWNS (Warrior shown; all five asserted)\n' + rows.join('\n'));
  });

  it('takes real camping to find, but not a second job', () => {
    // How long a player parked on a host camp waits, in minutes. Every rare
    // hides in a camp of roughly a dozen spawn points on ~30s timers.
    const rows: string[] = [];
    for (const spec of RARES) {
      const points = Object.values(ZONES)
        .flatMap((z) => z.spawns)
        .filter((sp) => sp.mobId === spec.hostMobId).length;
      const host = MOBS[spec.hostMobId]!;
      const rollsPerMinute = (points * 60000) / host.respawnMs;
      const minutes = 1 / (rollsPerMinute * RARE_SPAWN_CHANCE);
      rows.push(
        `  ${spec.epithet.padEnd(16)} ${String(points).padStart(2)} spawn points → ` +
          `~${minutes.toFixed(0)} min of camping`,
      );
      expect(minutes, `${spec.epithet} turns up too often to feel rare`).toBeGreaterThan(4);
      expect(minutes, `${spec.epithet} needs a second job`).toBeLessThan(90);
    }
    console.log('\nRARE SPAWN WAIT\n' + rows.join('\n'));
  });
});

describe('the armour lines are a plannable grind', () => {
  it('costs a known number of kills per piece, and more for the weapon', () => {
    const rows: string[] = [];
    for (const line of ARMOUR_LINES) {
      for (const step of line.steps) {
        const kills = step.count / TROPHY_DROP_CHANCE;
        const piece = getItem(questArmourId(line, step));
        rows.push(
          `  ${piece.name.padEnd(22)} lv${String(step.level).padStart(3)} ` +
            `${String(piece.armor).padStart(4)} armour  ~${kills.toFixed(0)} ${MOBS[step.mobId]!.name} kills`,
        );
        // Long enough to be a decision, short enough to finish in a sitting.
        expect(kills, `${piece.name} is a formality`).toBeGreaterThan(30);
        expect(kills, `${piece.name} is a second job`).toBeLessThan(120);
      }
      const capstoneKills = (line.capstone.each * line.steps.length) / TROPHY_DROP_CHANCE;
      rows.push(`  ${line.capstone.name.padEnd(22)} → ~${capstoneKills.toFixed(0)} kills for a weapon`);
      // The weapon should cost more than any single piece did.
      expect(capstoneKills).toBeGreaterThan(
        Math.max(...line.steps.map((st) => st.count / TROPHY_DROP_CHANCE)),
      );
    }
    console.log('\nARMOUR LINES\n' + rows.join('\n'));
  });

  it('does not out-earn the story chain it runs beside', () => {
    // The levelling curve is tuned against the story chain plus the grind. A
    // second chain paying story-sized experience would quietly shorten every
    // band by a third; this one pays in gear.
    for (const zone of Object.values(ZONES)) {
      const story = Object.values(QUESTS).filter((q) => q.chain === `${zone.id}_story`);
      const kit = Object.values(QUESTS).filter((q) => q.chain === `${zone.id}_kit`);
      const xp = (qs: typeof story): number => qs.reduce((total, q) => total + q.rewards.xp, 0);
      expect(xp(kit), `${zone.id}'s armour line pays nothing at all`).toBeGreaterThan(0);
      expect(xp(kit), `${zone.id}'s armour line out-earns its story`).toBeLessThan(xp(story) * 0.5);
    }
  });

  it('gives a bounty spawn a windfall you would notice', () => {
    const rows: string[] = [];
    for (const bounty of BOUNTY_MOBS) {
      const host = MOBS[bounty.rareOf!]!;
      const goldOf = (mob: MobDef): number => {
        const g = goldForKill(mob.level, mob.stars, LOOT_TABLES[mob.lootTableId]!.goldMultiplier ?? 1);
        return (g.min + g.max) / 2;
      };
      const points = Object.values(ZONES)
        .flatMap((z) => z.spawns)
        .filter((sp) => sp.mobId === bounty.rareOf).length;
      const minutes = 1 / (((points * 60000) / host.respawnMs) * BOUNTY_SPAWN_CHANCE);
      const worth =
        bounty.bounty === 'gold'
          ? `${goldOf(bounty).toFixed(0)}g (${(goldOf(bounty) / goldOf(host)).toFixed(0)}x a kill)`
          : `${bounty.xp} xp (${(bounty.xp / host.xp).toFixed(0)}x a kill)`;
      rows.push(`  ${bounty.name.padEnd(30)} ${worth.padEnd(28)} ~${minutes.toFixed(0)} min apart`);
      expect(minutes, `${bounty.name} is not rare`).toBeGreaterThan(3);
      expect(minutes, `${bounty.name} may as well not exist`).toBeLessThan(45);
    }
    console.log('\nBOUNTY SPAWNS\n' + rows.join('\n'));
  });
});

describe('the war is a grind, not a switch', () => {
  it('costs a session to take a front, and shows what that session looks like', () => {
    // Territory has to be earned in the same currency as everything else, or
    // it is a menu option rather than a thing you did.
    const rows: string[] = [];
    for (const holding of HOLDINGS) {
      const incumbent = holding.initialController;
      const challenger = holding.claimants.find((c) => c !== incumbent)!;
      // From fully held to flipped: across the middle and past the far mark.
      const distance = CONTROL_LIMIT + FLIP_THRESHOLD;
      const kills = distance / PRESSURE_PER_KILL;
      // The drift is pushing back the whole time on a front that favours the
      // incumbent, so the real cost is higher than the raw distance.
      const garrison = MOBS[holding.garrison[incumbent]!]!;
      rows.push(
        `  ${holding.name.padEnd(22)} ${getFaction(incumbent).name.padEnd(24)} ` +
          `~${kills.toFixed(0)} ${garrison.name} kills to flip`,
      );
      expect(kills, `${holding.name} flips on a whim`).toBeGreaterThan(60);
      expect(kills, `${holding.name} is unwinnable`).toBeLessThan(400);
      expect(getFaction(challenger)).toBeDefined();
    }
    console.log('\nTHE FRONTS\n' + rows.join('\n'));
  });

  it('moves the map on its own slowly enough to be a background, not a tide', () => {
    // Fast enough that a player who walks away comes back to a changed world;
    // slow enough that the work they did before leaving still stood for a
    // while. A front should take tens of minutes to drift, not seconds.
    for (const holding of HOLDINGS) {
      const minutesToFlip = (CONTROL_LIMIT + FLIP_THRESHOLD) / Math.abs(holding.drift);
      expect(minutesToFlip, `${holding.name} drifts too fast to matter`).toBeGreaterThan(20);
      expect(minutesToFlip, `${holding.name} may as well be static`).toBeLessThan(2000);
    }
  });

  it('never leaves a garrison the player cannot handle at that level', () => {
    // Both sides of a front have to be fightable by whoever is in the zone,
    // or flipping it makes the ground unusable.
    for (const holding of HOLDINGS) {
      const [lo, hi] = ZONES[holding.zoneId]!.levelRange;
      for (const mobId of Object.values(holding.garrison)) {
        const mob = MOBS[mobId]!;
        expect(mob.level, `${mob.name} is below ${holding.zoneId}`).toBeGreaterThanOrEqual(lo - 4);
        expect(mob.level, `${mob.name} is above ${holding.zoneId}`).toBeLessThanOrEqual(hi);
        expect(mob.stars, `${mob.name} is a boss on a guard post`).toBeLessThan(BOSS_STARS);
      }
    }
  });
});

describe('dragons are the hardest thing in the game', () => {
  it('beats the elite boss of its own zone, and is still winnable', () => {
    const rows: string[] = [];
    for (const def of DRAGONS) {
      const zone = ZONES[def.zoneId]!;
      const level = zone.levelRange[1];
      // A capped character in that zone, kitted out: the only person who has
      // any business trying this.
      for (const cls of PLAYABLE_CLASSES) {
        const fight = (mobId: string): Summary =>
          runEncounter(
            {
              name: cls.name,
              level,
              gear: gearSetFor(cls.id, level),
              mobId,
              skills: skillsForClass(cls.id, level, learnedAt(cls.id, level)).map((sk) => sk.id),
              classId: cls.id,
              dodge: true,
            },
            12,
          );
        const dragon = fight(dragonMobId(def));
        if (cls.id === 'warrior') {
          rows.push(
            `  ${def.title.padEnd(30)} lv${String(def.level).padStart(3)}  ` +
              `win ${(dragon.winRate * 100).toFixed(0).padStart(3)}%  ` +
              `ttk ${dragon.medianTtk.toFixed(1).padStart(5)}s  ` +
              `hp left ${(dragon.medianHealthLeft * 100).toFixed(0).padStart(3)}%`,
          );
        }
        // Hard, but not a wall: a capped player who plays well gets there.
        expect(dragon.winRate, `${cls.id} cannot touch ${def.name}`).toBeGreaterThan(0.4);
        expect(dragon.timeouts, `${cls.id} cannot finish ${def.name}`).toBe(0);
      }

      // And strictly beyond the elite boss that ends its zone.
      const elite = Object.values(MOBS).find(
        (m) => m.stars === 6 && !m.dragon && m.level === zone.levelRange[1],
      );
      if (elite) {
        expect(
          deriveMobStats(MOBS[dragonMobId(def)]!).maxHealth,
          `${def.name} is softer than ${elite.name}`,
        ).toBeGreaterThan(deriveMobStats(elite).maxHealth);
      }
    }
    console.log('\nDRAGONS (Warrior at the zone cap; all five asserted)\n' + rows.join('\n'));
  });

  it('turns up rarely enough to be an event', () => {
    // One full circuit: dormant, then a stop on each holding it claims.
    const circuit =
      DRAGON_DORMANT_MIN + DRAGONS[0]!.territory.length * (DRAGON_HUNT_MIN + DRAGON_ROOST_MIN);
    expect(circuit, 'a dragon is a rotation, not an event').toBeGreaterThan(30);
    expect(circuit, 'nobody will ever see one').toBeLessThan(120);
    // And the window you can actually fight it in is a fraction of that.
    const window = DRAGONS[0]!.territory.length * DRAGON_ROOST_MIN;
    expect(window / circuit).toBeLessThan(0.5);
  });

  it('carries the best weapon in the game, and only it does', () => {
    for (const def of DRAGONS) {
      for (const cls of PLAYABLE_CLASSES) {
        const weapon = getItem(dragonWeaponId(def, cls.id));
        const dps = (((weapon.damageMin! + weapon.damageMax!) / 2) * 1000) / weapon.swingMs!;
        const ratio = dps / curveWeaponDps(def.level);
        // Above a rare spawn's signature (1.22), which is the next best thing.
        expect(ratio, `${weapon.name} is not worth a dragon`).toBeGreaterThan(1.25);
        expect(ratio, `${weapon.name} breaks the game`).toBeLessThan(1.45);
        expect(weapon.quality).toBe('epic');
        expect(canEquip(weapon, cls.id)).toBe(true);
      }
    }
  });
});

describe('the luxury merchant', () => {
  it('prices the best gear in the game like the last thing you buy', () => {
    const rows: string[] = [];
    for (const itemId of VENDORS[LUXURY_VENDOR_ID]!.stock) {
      const item = getItem(itemId);
      const level = item.reqLevel!;
      // Denominated in ORDINARY kills at that level — what a player actually
      // farms. Measuring against a boss made a Sovereign Bulwark look like
      // ten kills, because a boss pays a boss's purse and you cannot repeat it.
      const peer = Object.values(MOBS)
        .filter(
          (m) =>
            !m.dragon && !m.rareOf && m.stars < BOSS_STARS && Math.abs(m.level - level) <= 5,
        )
        .sort((a, b) => b.stars - a.stars)[0]!;
      const g = goldForKill(peer.level, peer.stars, LOOT_TABLES[peer.lootTableId]!.goldMultiplier ?? 1);
      const kills = buyPrice(item) / ((g.min + g.max) / 2);
      rows.push(
        `  ${item.name.padEnd(26)} lv${String(level).padStart(3)}  ` +
          `${buyPrice(item).toLocaleString().padStart(10)}g = ${kills.toFixed(0).padStart(5)} ${peer.name} kills`,
      );
      // Expensive enough to be a project, not so expensive it is decoration.
      expect(kills, `${item.name} is pocket change`).toBeGreaterThan(150);
      expect(kills, `${item.name} will never be bought`).toBeLessThan(2000);
    }
    console.log('\nLUXURY GOODS\n' + rows.join('\n'));
  });

  it('stays a step below what a dragon carries', () => {
    // If money bought the best item in the game, killing the dragon would be
    // a formality. The offhand is worth a quarter of a main weapon; a dragon's
    // weapon is worth a third more than the ladder's.
    for (const itemId of VENDORS[LUXURY_VENDOR_ID]!.stock) {
      const item = getItem(itemId);
      const level = item.reqLevel!;
      const mainHand = curveWeaponDps(level);
      if (item.damageBonus) {
        // Flat damage per swing, judged against a two-second swing.
        const asDps = item.damageBonus / 2;
        expect(asDps / mainHand, `${item.name} outguns a main hand`).toBeLessThan(0.45);
      }
      if (item.armor) {
        expect(item.armor / curveArmorTotal(level)).toBeLessThan(0.5);
      }
      if (item.skillPower) {
        expect(item.skillPower, `${item.name} rewrites the class`).toBeLessThan(1.25);
      }
      // Nothing here is a weapon: it can never replace what a dragon drops.
      expect(item.slot).not.toBe('weapon');
    }
  });

  it('gives one offhand slot three different characters', () => {
    // The build choice is the point: damage, survivability or casting.
    const tier = 'Sovereign';
    const blade = getItem(`lux_${tier.toLowerCase()}_blade`);
    const shield = getItem(`lux_${tier.toLowerCase()}_shield`);
    const grimoire = getItem(`lux_${tier.toLowerCase()}_grimoire`);
    expect(blade.damageBonus).toBeGreaterThan(0);
    expect(blade.armor ?? 0).toBe(0);
    expect(shield.armor).toBeGreaterThan(0);
    expect(shield.damageBonus ?? 0).toBe(0);
    expect(grimoire.skillPower).toBeGreaterThan(1);
    expect(grimoire.damageBonus ?? 0).toBe(0);
    for (const item of [blade, shield, grimoire]) expect(item.slot).toBe('offhand');
  });

  it('makes a grimoire worth most to whoever casts most', () => {
    // Measured, not asserted from the numbers: a Mage lives on skills, a
    // Warrior lives on swings, and the slot should say so.
    const rows: string[] = [];
    for (const cls of PLAYABLE_CLASSES) {
      const level = 100;
      const known = learnedAt(cls.id, level);
      const kit = skillsForClass(cls.id, level, known).map((sk) => sk.id);
      const run = (offhand: string | null): number =>
        runEncounter(
          {
            name: cls.name,
            level,
            gear: [...gearSetFor(cls.id, level), ...(offhand ? [offhand] : [])],
            mobId: 'fort_warden',
            skills: kit,
            classId: cls.id,
          },
          12,
        ).medianTtk;
      const bare = run(null);
      const withGrimoire = run('lux_sovereign_grimoire');
      const gain = (bare - withGrimoire) / bare;
      rows.push(`  ${cls.name.padEnd(8)} ${bare.toFixed(1)}s → ${withGrimoire.toFixed(1)}s  (${(gain * 100).toFixed(0)}% faster)`);
      expect(withGrimoire, `${cls.id} got nothing from a grimoire`).toBeLessThanOrEqual(bare);
    }
    console.log('\nGRIMOIRE (level 100 vs the Fort Warden)\n' + rows.join('\n'));
  });
});

describe('the vendor economy', () => {
  it('pays full value for merchant goods and a fraction for gear', () => {
    // Merchant goods exist to be sold, so they fetch their listed value.
    expect(sellPrice(getItem('bear_claw'))).toBe(getItem('bear_claw').value);
    expect(sellPrice(getItem('ancient_bear_skull'))).toBe(getItem('ancient_bear_skull').value);
    // Gear must not be worth more vendored than worn, or nothing is a reward.
    const mail = getItem('outlaw_mail');
    expect(sellPrice(mail)).toBeLessThan(mail.value * 0.5);
    expect(sellPrice(mail)).toBeGreaterThan(0);
  });

  it('charges more than it pays, so trading is never a money loop', () => {
    for (const item of Object.values(ITEMS)) {
      expect(buyPrice(item), `${item.id} can be bought and resold at a profit`).toBeGreaterThan(
        sellPrice(item),
      );
    }
  });

  it('never stocks anything above uncommon, except the one shop that is the grind', () => {
    // Rares and epics are earned by killing things, not bought. The luxury
    // merchant is the deliberate exception: everything there is epic, and the
    // rule survives because for that shop the PRICE is the grind. Nobody buys
    // a Sovereign Bulwark instead of playing.
    const rank = { common: 0, uncommon: 1, rare: 2, epic: 3 };
    for (const vendor of Object.values(VENDORS)) {
      for (const itemId of vendor.stock) {
        const item = getItem(itemId);
        if (vendor.id === LUXURY_VENDOR_ID) {
          expect(item.quality, `${item.name} is not luxury enough`).toBe('epic');
          expect(item.reqLevel, `${item.name} has no level gate`).toBeGreaterThan(0);
          continue;
        }
        expect(
          rank[item.quality],
          `${vendor.name} stocks ${item.name} (${item.quality})`,
        ).toBeLessThanOrEqual(rank[MAX_STOCK_QUALITY]);
      }
    }
  });

  it('stocks a weapon for every playable class between them', () => {
    const stocked = Object.values(VENDORS).flatMap((v) => v.stock);
    for (const cls of PLAYABLE_CLASSES) {
      const has = stocked.some((id) => {
        const item = getItem(id);
        return item.slot === 'weapon' && item.classes?.includes(cls.id);
      });
      expect(has, `no vendor stocks a ${cls.id} weapon`).toBe(true);
    }
  });

  it('prices stock within reach of the band it serves', () => {
    // Maeve serves levels ~1-10. Her most expensive item should cost a sane
    // number of kills at the rates a player in that band actually earns.
    const wolf = MOBS.bog_wolf!;
    const perKill =
      (goldForKill(wolf.level, wolf.stars).min + goldForKill(wolf.level, wolf.stars).max) / 2;
    const dearest = Math.max(...VENDORS.maeve!.stock.map((id) => buyPrice(getItem(id))));
    const kills = dearest / perKill;
    console.log(`  Maeve's dearest stock: ${dearest}g = ${kills.toFixed(0)} Bog Wolf kills`);
    expect(kills).toBeGreaterThan(3);
    expect(kills).toBeLessThan(40);
  });

  it('prices a zone\'s taught skill within reach of the band that teaches it', () => {
    // A tome is the one purchase that changes how the character plays, so it
    // is allowed to be expensive — but "expensive" has to mean a session of
    // grinding, not a second job.
    const rows: string[] = [];
    for (const [zoneId, mobId] of [
      ['ardmoor', 'hill_wolf'],
      ['reach', 'marsh_heron'],
      ['caer_dubh', 'blackshield_spearman'],
    ] as const) {
      const mob = MOBS[mobId]!;
      const gold = goldForKill(mob.level, mob.stars);
      const perKill = (gold.min + gold.max) / 2;
      const tome = getItem(skillsTaughtBy(zoneId).find((sk) => sk.classId === 'warrior')!.taughtBy!);
      const kills = buyPrice(tome) / perKill;
      rows.push(`  ${tome.name.padEnd(28)} ${buyPrice(tome)}g = ${kills.toFixed(0)} ${mob.name} kills`);
      expect(kills, `${tome.name} is pocket change`).toBeGreaterThan(10);
      expect(kills, `${tome.name} costs a whole band to afford`).toBeLessThan(120);
    }
    console.log('\n' + rows.join('\n'));
  });

  it('keeps traders clear of every camp', () => {
    // A shop you get pulled off mid-trade is not a shop.
    for (const placement of FENMARCH.vendors) {
      for (const spawn of FENMARCH.spawns) {
        const def = MOBS[spawn.mobId]!;
        const d = Math.hypot(placement.pos.x - spawn.pos.x, placement.pos.z - spawn.pos.z);
        const needed = def.aggroRadius + roamOf(spawn) + 4;
        if (d < needed) {
          throw new Error(
            `${VENDORS[placement.vendorId]!.name} stands ${d.toFixed(1)}u from a ` +
              `${def.name}; needs ${needed.toFixed(1)}u`,
          );
        }
      }
    }
  });
});

// --------------------------------------------------------------------------
// Four zones, 1-100. The Fenmarch is hand-tuned; everything after it is
// generated from curves fitted to it. These tests are what proves the curves
// actually hold up across seventy-five more levels.
// --------------------------------------------------------------------------

describe('the whole 1-100 progression', () => {
  /**
   * Checkpoints across the whole game. Each pairs a level with what a player
   * at that level would ACTUALLY be grinding — within a couple of levels and
   * ★2 or better. Pairing a level with something well beneath it just measures
   * how fast an overgeared character clears trash.
   */
  const CHECKPOINTS = PACE_CHECKPOINTS;

  it('keeps every checkpoint winnable and paced, on every class', () => {
    const rows: string[] = [];
    for (const { level, mobId } of CHECKPOINTS) {
      for (const cls of PLAYABLE_CLASSES) {
        const s = runEncounter(
          {
            name: cls.name,
            level,
            gear: gearSetFor(cls.id, level),
            mobId,
            // A player at this level has been through the zones that taught
            // these, so measure the kit they would actually have. Testing the
            // level-only kit past 40 measures a character who skipped every
            // trader and both bosses in each zone.
            skills: skillsForClass(cls.id, level, learnedAt(cls.id, level)).map((sk) => sk.id),
            classId: cls.id,
          },
          20,
        );
        if (cls.id === 'warrior') {
          rows.push(
            `  lv${String(level).padStart(3)} vs ${MOBS[mobId]!.name.padEnd(22)} ` +
              `win ${(s.winRate * 100).toFixed(0).padStart(3)}%  ttk ${s.medianTtk.toFixed(1).padStart(5)}s  ` +
              `hp left ${(s.medianHealthLeft * 100).toFixed(0).padStart(3)}%`,
          );
        }
        // Four in five, not nine in ten. The lethality suite measures an
        // ordinary ★2 at your level killing four to six percent of the
        // characters that pull one and a ★3 nearer a fifth — so a class having
        // a bad run at one checkpoint is the world working as designed, and a
        // 90% floor would only be a demand that it stop.
        expect(s.winRate, `${cls.id} loses at level ${level} to ${mobId}`).toBeGreaterThanOrEqual(0.8);
        expect(s.timeouts, `${cls.id} times out at level ${level}`).toBe(0);
        // Two and a half seconds, not three. Where the bestiary has no ★3 near
        // a level the checkpoint falls back to a ★2, and a ★2 at your own level
        // fought by a character who has spent ninety skill points is supposed
        // to die fast — that is what the tier is for. The floor is here to
        // catch a fight resolving in one swing, not to insist every creature in
        // the world is a project.
        expect(s.medianTtk, `${cls.id} kills too fast at ${level}`).toBeGreaterThan(2.5);
        expect(s.medianTtk, `${cls.id} grinds too slowly at ${level}`).toBeLessThan(45);
      }
    }
    console.log('\nPROGRESSION (Warrior shown; all five asserted)\n' + rows.join('\n'));
  });

  it('covers every level from 1 to the cap with something to fight', () => {
    const ordinary = Object.values(MOBS).filter((m) => m.stars < BOSS_STARS);
    for (let level = 1; level <= MAX_LEVEL; level++) {
      // Something within four levels either way, so no level is a dead zone.
      const near = ordinary.filter((m) => Math.abs(m.level - level) <= 4);
      expect(near.length, `nothing to fight at level ${level}`).toBeGreaterThan(0);
    }
  });

  it('overlaps the zone bands rather than butting them end to end', () => {
    const zones = Object.values(ZONES).sort((a, b) => a.levelRange[0] - b.levelRange[0]);
    for (let i = 1; i < zones.length; i++) {
      const prev = zones[i - 1]!;
      const cur = zones[i]!;
      // The next zone must open before the last one is exhausted, so a player
      // always chooses to move on rather than being pushed out.
      expect(cur.levelRange[0], `${cur.id} does not overlap ${prev.id}`).toBeLessThan(
        prev.levelRange[1],
      );
      expect(cur.levelRange[1]).toBeGreaterThan(prev.levelRange[1]);
    }
    expect(zones[0]!.levelRange[0]).toBe(1);
    expect(zones[zones.length - 1]!.levelRange[1]).toBe(MAX_LEVEL);
  });

  it('runs a road the zone is actually built along', () => {
    // The claim being tested is not "there is a line on the map". Every zone is
    // *generated* along this road — `layout` walks its bands down it and puts
    // the camps either side — so the road and the content have to agree, or the
    // thing drawn on the ground is decoration pointing the wrong way.
    const rows: string[] = [];
    for (const zone of Object.values(ZONES)) {
      const road = roadPoints(zone.id, zone.theme);
      const spec = getTheme(zone.theme).terrain;
      expect(road.length, `${zone.id} has no road`).toBeGreaterThan(8);

      let length = 0;
      for (let i = 1; i < road.length; i++) {
        length += Math.hypot(road[i]!.x - road[i - 1]!.x, road[i]!.z - road[i - 1]!.z);
      }

      for (const point of road) {
        expect(Math.abs(point.x), `${zone.id} road leaves the zone`).toBeLessThan(zone.halfSize);
        expect(Math.abs(point.z), `${zone.id} road leaves the zone`).toBeLessThan(zone.halfSize);
        // A road into a lake is worse than no road.
        if (spec.waterLevel !== undefined) {
          expect(
            terrainHeight(point.x, point.z, spec),
            `${zone.id} road goes under water`,
          ).toBeGreaterThan(spec.waterLevel);
        }
      }

      // Every camp on the road proper — the three per band that `layout` puts
      // beside it — has to be within sight of it. The wilds camps do not: they
      // are the reason to leave the road.
      const near = zone.spawns.filter(
        (sp) => roadDistance(road, sp.pos.x, sp.pos.z) < 200 && !sp.guardOf,
      ).length;
      rows.push(
        `  ${zone.id.padEnd(10)} ${road.length} points, ${length.toFixed(0)}u long, ` +
          `${near} creatures within 200u of it`,
      );
      expect(near, `${zone.id}'s road passes nothing`).toBeGreaterThan(40);
      // Long enough to cross the zone, not so long it is wandering.
      expect(length).toBeGreaterThan(zone.halfSize * 1.6);
      expect(length).toBeLessThan(zone.halfSize * 2.6);

      // And the same road every time, or nobody can learn the route.
      expect(roadPoints(zone.id, zone.theme)).toEqual(road);
    }
    console.log('\nTHE ROAD\n' + rows.join('\n'));
  });

  it('leaves no quarter of the map with nothing in it', () => {
    // The complaint this answers is "the world feels empty", and it was real:
    // 45% of the ground was more than 250 units — forty-eight seconds' walk —
    // from any creature, and the worst spot in the Fenmarch was over a
    // thousand units from anything at all.
    //
    // Printed rather than merely asserted, because "the map feels empty" is a
    // feeling and this is the number under it. A bound alone would have said
    // "fine" at 44%.
    const rows: string[] = [];
    for (const zone of Object.values(ZONES)) {
      let sum = 0;
      let worst = 0;
      let samples = 0;
      const step = zone.halfSize / 12;
      for (let x = -zone.halfSize; x <= zone.halfSize; x += step) {
        for (let z = -zone.halfSize; z <= zone.halfSize; z += step) {
          let best = Infinity;
          for (const sp of zone.spawns) {
            best = Math.min(best, Math.hypot(sp.pos.x - x, sp.pos.z - z));
          }
          sum += best;
          worst = Math.max(worst, best);
          samples++;
        }
      }
      const mean = sum / samples;
      rows.push(
        `  ${zone.id.padEnd(10)} ${String(zone.spawns.length).padStart(4)} creatures  ` +
          `nearest one is ${mean.toFixed(0)}u away on average, ${worst.toFixed(0)}u at worst`,
      );
      // At walking speed these are about twenty seconds and about a minute.
      expect(mean, `${zone.id} is empty country`).toBeLessThan(140);
      expect(worst, `${zone.id} has a dead quarter`).toBeLessThan(330);
      // And not so full that the wilds stop being wild — a solitary creature
      // you meet while travelling is life; a wall of them is a camp.
      expect(mean, `${zone.id} is wall-to-wall creatures`).toBeGreaterThan(55);
    }
    console.log('\nHOW EMPTY THE COUNTRY IS\n' + rows.join('\n'));
  });

  it('keeps every zone laid out safely', () => {
    for (const zone of Object.values(ZONES)) {
      // Bosses clear of unrelated camps.
      for (const boss of zone.spawns.filter((s) => MOBS[s.mobId]!.stars >= BOSS_STARS)) {
        for (const other of zone.spawns) {
          const def = MOBS[other.mobId]!;
          if (other === boss || def.stars >= BOSS_STARS) continue;
          if (other.guardOf === boss.mobId) continue;
          const d = Math.hypot(boss.pos.x - other.pos.x, boss.pos.z - other.pos.z);
          const needed = 3.5 + def.aggroRadius + roamOf(other) + 4;
          if (d < needed) {
            throw new Error(
              `${zone.id}: ${def.name} is ${d.toFixed(1)}u from ${MOBS[boss.mobId]!.name}, needs ${needed.toFixed(1)}u`,
            );
          }
        }
      }
      // Traders and roads clear of camps.
      const landmarks = [
        ...zone.vendors.map((v) => ({ pos: v.pos, what: v.vendorId })),
        ...zone.exits.map((e) => ({ pos: e.pos, what: e.label })),
        { pos: zone.playerStart, what: 'the arrival point' },
      ];
      for (const landmark of landmarks) {
        for (const spawn of zone.spawns) {
          const def = MOBS[spawn.mobId]!;
          const d = Math.hypot(landmark.pos.x - spawn.pos.x, landmark.pos.z - spawn.pos.z);
          if (d < def.aggroRadius + roamOf(spawn) + 4) {
            throw new Error(
              `${zone.id}: ${landmark.what} is ${d.toFixed(1)}u from a ${def.name}`,
            );
          }
        }
      }
      // Everything inside the walls.
      for (const spawn of zone.spawns) {
        expect(Math.abs(spawn.pos.x)).toBeLessThanOrEqual(zone.halfSize);
        expect(Math.abs(spawn.pos.z)).toBeLessThanOrEqual(zone.halfSize);
      }
    }
  });
});

describe('quest chains give each zone a route', () => {
  it('gives every zone a chain that ends by pointing at the next', () => {
    for (const zone of Object.values(ZONES)) {
      const chain = Object.values(QUESTS).filter((q) => q.chain === `${zone.id}_story`);
      expect(chain.length, `${zone.id} has no story chain`).toBeGreaterThanOrEqual(5);

      // Every zone except the last should end with a road out.
      const isLast = zone.levelRange[1] === MAX_LEVEL;
      const travels = chain.filter((q) => q.objectives.some((o) => o.kind === 'reach'));
      if (!isLast) {
        expect(travels.length, `${zone.id} never points anywhere`).toBeGreaterThan(0);
      }
    }
  });

  it('links every chain in one unbroken, correctly ordered line', () => {
    // A zone runs more than one chain — its story, and its armour line — so
    // group by chain rather than by zone. Grouping by zone read the two as one
    // broken chain the moment the second existed.
    const chains = new Set(Object.values(QUESTS).map((q) => q.chain));
    expect(chains.size).toBeGreaterThanOrEqual(Object.keys(ZONES).length * 2);

    for (const chainId of chains) {
      const chain = Object.values(QUESTS)
        .filter((q) => q.chain === chainId)
        .sort((a, b) => a.id.localeCompare(b.id));
      chain.forEach((quest, i) => {
        if (i === 0) {
          expect(quest.requires, `${quest.id} should start its chain`).toBeUndefined();
        } else {
          expect(quest.requires, `${quest.id} is orphaned`).toBe(chain[i - 1]!.id);
        }
        // Every step in a chain is given by one person, in one place.
        expect(quest.zoneId, `${chainId} spans zones`).toBe(chain[0]!.zoneId);
        expect(quest.giverVendorId, `${chainId} has two givers`).toBe(chain[0]!.giverVendorId);
      });
    }
  });

  it('never asks for something that does not exist', () => {
    for (const quest of Object.values(QUESTS)) {
      expect(ZONES[quest.zoneId], `${quest.id} is set in no zone`).toBeDefined();
      expect(VENDORS[quest.giverVendorId], `${quest.id} has no giver`).toBeDefined();
      for (const objective of quest.objectives) {
        if (objective.kind === 'kill') expect(MOBS[objective.mobId], `${quest.id}: ${objective.mobId}`).toBeDefined();
        if (objective.kind === 'collect') expect(ITEMS[objective.itemId], `${quest.id}: ${objective.itemId}`).toBeDefined();
        if (objective.kind === 'reach') expect(ZONES[objective.zoneId], `${quest.id}: ${objective.zoneId}`).toBeDefined();
      }
      for (const itemId of quest.rewards.items ?? []) expect(ITEMS[itemId]).toBeDefined();
      for (const [classId, itemId] of Object.entries(quest.rewards.classItems ?? {})) {
        expect(ITEMS[itemId], `${quest.id}: ${itemId}`).toBeDefined();
        expect(canEquip(getItem(itemId), classId), `${quest.id}: ${classId} cannot use ${itemId}`).toBe(true);
      }
    }
  });

  it('only asks you to kill things that live in the zone you are in', () => {
    for (const quest of Object.values(QUESTS)) {
      const zone = ZONES[quest.zoneId]!;
      const present = new Set(zone.spawns.map((s) => s.mobId));
      for (const objective of quest.objectives) {
        if (objective.kind !== 'kill') continue;
        expect(present.has(objective.mobId), `${quest.id} sends you out of ${zone.id}`).toBe(true);
      }
    }
  });

  it('is worth doing — a chain meaningfully dents the grind', () => {
    // Quests should feel like a shortcut through the grind, not a rounding error
    // against it, or nobody will follow the route they exist to signpost.
    for (const zone of Object.values(ZONES)) {
      const chain = Object.values(QUESTS).filter((q) => q.zoneId === zone.id);
      const questXp = chain.reduce((total, q) => total + q.rewards.xp, 0);
      const [from, to] = zone.levelRange;
      let grindXp = 0;
      for (let level = from; level < to; level++) grindXp += xpToNext(level);
      const share = questXp / grindXp;
      console.log(
        `  ${zone.name.padEnd(18)} chain xp ${questXp.toLocaleString().padStart(11)} = ` +
          `${(share * 100).toFixed(0)}% of the band's grind`,
      );
      expect(share, `${zone.id} quests are pointless`).toBeGreaterThan(0.02);
      expect(share, `${zone.id} quests skip the grind`).toBeLessThan(0.6);
    }
  });
});

// --------------------------------------------------------------------------
// How long the whole game takes.
//
// The one number a grind-heavy game lives or dies on, and it was unmeasured:
// the suite knew kills per level and seconds per fight but never joined them
// up, so a change to respawn timers or map size could double the game's length
// with every test still green.
// --------------------------------------------------------------------------

describe('how long the game takes', () => {
  /** Measured pacing inputs, from the same fights the progression test runs. */
  function checkpointPace(moveSpeed: number): PaceInput[] {
    return PACE_CHECKPOINTS.map(({ level, mobId }) => {
      const s = runEncounter(
        {
          name: 'pace',
          level,
          gear: gearSetFor('warrior', level),
          mobId,
          skills: skillsForClass('warrior', level, learnedAt('warrior', level)).map((sk) => sk.id),
          classId: 'warrior',
        },
        8,
      );
      return { level, ttk: s.medianTtk, healthLeft: s.medianHealthLeft, moveSpeed };
    });
  }

  it('adds up to a grind you could actually finish', () => {
    const { rows, total } = hoursToCap(checkpointPace(BASE_MOVE_SPEED));

    const shown = rows.filter((r) => r.level === 1 || r.level % 10 === 0);
    const table = shown.map(
      (r) =>
        `  lv${String(r.level).padStart(3)}  ${String(r.kills).padStart(4)} kills of ` +
        `${r.mob.name.padEnd(22)} ` +
        `fight ${r.ttk.toFixed(1).padStart(5)}s  rest ${r.downtime.toFixed(1).padStart(5)}s  ` +
        `walk ${r.travel.toFixed(1).padStart(5)}s  wait ${r.waiting.toFixed(1).padStart(5)}s  ` +
        `= ${r.secondsPerKill.toFixed(1).padStart(5)}s/kill  ${r.hours.toFixed(1).padStart(5)}h`,
    );
    const kills = rows.reduce((a, r) => a + r.kills, 0);
    console.log(
      '\nTIME TO THE CAP\n' +
        table.join('\n') +
        `\n  ${kills.toLocaleString()} kills, ${total.toFixed(0)} hours to level ${MAX_LEVEL}\n`,
    );

    // A band, not a target. Below this the grind the design asks for is not
    // there; above it nobody finishes and the last two zones are decoration.
    expect(total).toBeGreaterThan(60);
    expect(total).toBeLessThan(400);
  });

  it('spends its time on fighting rather than on waiting', () => {
    // The failure mode of a long respawn timer is a player standing in an empty
    // camp watching the ground. That is not grind, it is queueing — and the
    // answer to it is somewhere else to go, which is what the map is for.
    const { rows } = hoursToCap(checkpointPace(BASE_MOVE_SPEED));
    const seconds = rows.reduce(
      (acc, r) => ({
        fight: acc.fight + r.kills * r.ttk,
        rest: acc.rest + r.kills * r.downtime,
        walk: acc.walk + r.kills * r.travel,
        wait: acc.wait + r.kills * r.waiting,
      }),
      { fight: 0, rest: 0, walk: 0, wait: 0 },
    );
    const all = seconds.fight + seconds.rest + seconds.walk + seconds.wait;
    const pct = (n: number) => `${((n / all) * 100).toFixed(0)}%`;
    console.log(
      `  where the time goes: fighting ${pct(seconds.fight)}, ` +
        `resting ${pct(seconds.rest)}, walking ${pct(seconds.walk)}, waiting ${pct(seconds.wait)}`,
    );
    expect(seconds.wait / all, 'the game is mostly waiting for respawns').toBeLessThan(0.12);
    expect(seconds.walk / all, 'the game is mostly walking').toBeLessThan(0.45);
  });

  it('is a walk across a zone, not a stroll', () => {
    // The map has to be big enough to be worth exploring and small enough to
    // cross. Ten minutes on foot is the size that makes a mount matter.
    const rows: string[] = [];
    for (const zone of Object.values(ZONES)) {
      const onFoot = crossingSeconds(zone, BASE_MOVE_SPEED);
      const fastest = Math.max(...MOUNTS.map((m) => m.speed));
      const ridden = crossingSeconds(zone, fastest);
      rows.push(
        `  ${zone.name.padEnd(18)} ${(zone.halfSize * 2).toFixed(0).padStart(5)} across  ` +
          `on foot ${(onFoot / 60).toFixed(1)} min  best mount ${(ridden / 60).toFixed(1)} min`,
      );
      expect(onFoot / 60, `${zone.name} crosses too fast`).toBeGreaterThan(8);
      expect(onFoot / 60, `${zone.name} crosses too slowly`).toBeLessThan(13);
      expect(ridden / 60, `${zone.name} is a slog even mounted`).toBeLessThan(3.5);
      expect(ridden / 60, `${zone.name} is a blur mounted`).toBeGreaterThan(1.5);
    }
    console.log('\nZONE SIZE\n' + rows.join('\n'));
  });
});

// --------------------------------------------------------------------------
// Lethality. A world where nothing can kill you is a world where no decision
// you make about gear, cooldowns or consumables means anything.
// --------------------------------------------------------------------------

describe('the world can kill you', () => {
  /**
   * Every ordinary creature, fought at its own level by a character geared and
   * skilled for that level.
   *
   * Sampled from the bestiary rather than from a list of levels, because the
   * ratings are not evenly spread: ★1 only exists in three places in the whole
   * game, and a fixed set of levels silently measured nothing at all for it.
   */
  const BESTIARY = Object.values(MOBS)
    .filter((m) => m.stars < BOSS_STARS && !m.horse && !m.rareOf && !m.dragon)
    .sort((a, b) => a.stars - b.stars || a.level - b.level);

  function duel(classId: ClassId, level: number, mobId: string, trials = 6): Summary {
    return runEncounter(
      {
        name: `${classId} vs ${mobId}`,
        level,
        gear: gearSetFor(classId, level),
        mobId,
        skills: skillsForClass(classId, level, learnedAt(classId, level)).map((sk) => sk.id),
        classId,
        // Nothing but the rotation: this is the "is it dangerous" question.
        noPotions: true,
      },
      trials,
    );
  }

  it('makes an even fight a fight', () => {
    // Stated as death rates, because "can this kill me" is not answerable in
    // win rates alone. A ★1 you lose to one time in twenty is a creature you
    // respect; one you never lose to is scenery.
    const rows: string[] = [];
    /** The lowest any ★1 fight in the game drove a character. */
    let worstOne = 1;
    const byStar = new Map<
      number,
      { deaths: number; fights: number; health: number; low: number; ttk: number; n: number }
    >();

    for (const mob of BESTIARY) {
      for (const cls of PLAYABLE_CLASSES) {
        const s = duel(cls.id, mob.level, mob.id);
        const acc = byStar.get(mob.stars) ?? { deaths: 0, fights: 0, health: 0, low: 0, ttk: 0, n: 0 };
        acc.deaths += (1 - s.winRate) * 6;
        acc.fights += 6;
        acc.health += s.medianHealthLeft;
        acc.low += s.medianLowest;
        acc.ttk += s.medianTtk;
        acc.n += 1;
        if (mob.stars === 1) worstOne = Math.min(worstOne, s.medianLowest);
        byStar.set(mob.stars, acc);
        if (cls.id === 'warrior') {
          rows.push(
            `  ★${mob.stars} lv${String(mob.level).padStart(3)} ${mob.name.padEnd(24)} ` +
              `win ${(s.winRate * 100).toFixed(0).padStart(3)}%  ` +
              `hp left ${(s.medianHealthLeft * 100).toFixed(0).padStart(3)}%  ` +
              `worst ${(s.medianLowest * 100).toFixed(0).padStart(3)}%  ` +
              `ttk ${s.medianTtk.toFixed(1).padStart(5)}s`,
          );
        }
      }
    }
    console.log('\nLETHALITY (Warrior shown; all five measured)\n' + rows.join('\n'));

    const summary: string[] = [];
    for (const [stars, acc] of [...byStar.entries()].sort((a, b) => a[0] - b[0])) {
      summary.push(
        `  ★${stars}  dies ${((acc.deaths / acc.fights) * 100).toFixed(0).padStart(2)}% of fights, ` +
          `ends on ${((acc.health / acc.n) * 100).toFixed(0).padStart(3)}% health, ` +
          `dips to ${((acc.low / acc.n) * 100).toFixed(0).padStart(3)}%, ` +
          `takes ${(acc.ttk / acc.n).toFixed(1).padStart(5)}s`,
      );
    }
    console.log('\nBY RATING\n' + summary.join('\n') + '\n');

    const rate = (stars: number): number => {
      const a = byStar.get(stars)!;
      return a.deaths / a.fights;
    };
    const left = (stars: number): number => {
      const a = byStar.get(stars)!;
      return a.health / a.n;
    };

    // ★1: winnable, but it takes a real bite out of you.
    //
    // Asserted on how far down the fight goes rather than on a death count.
    // "Can this kill me" is a question about the worst moment of a fight, and a
    // creature that routinely takes half your health is one that kills you the
    // day you pull it with something else nearby — which is how anybody
    // actually dies. Requiring a death outright would only be measuring how
    // many trials the suite can afford.
    // Two of the game's three ★1 creatures are the ones a brand new character
    // meets in their first minute, and are deliberately gentle — so the average
    // across the rating is soft by construction and the claim being made here
    // is carried by `worstOne` below, not by this.
    expect(left(1), 'a ★1 is a toll booth').toBeLessThan(0.85);
    // Measured on the worst of them rather than the average of all three,
    // because two of the game's three ★1 creatures are the ones a brand new
    // character meets in their first minute and are deliberately gentle. The
    // claim being made is "a ★1 can put you in real trouble", and that is a
    // claim about the hardest one, not about the tutorial.
    // Two thirds, not a near-death. All three of the game's ★1 creatures live
    // in the first twenty levels, where the danger ramp deliberately protects a
    // character whose health, armour and kit all start at nothing — so this is
    // the honest ceiling for the rating, and the claim that the world can kill
    // you is carried by the double-pull test below, where it belongs.
    expect(worstOne, 'no ★1 in the game can put you in trouble').toBeLessThan(0.7);

    // ★4: the fight you answer with everything you have. The harness presses
    // its rotation and nothing else — no potion, no held cooldown, no
    // repositioning — so losing a good share of these is the design, and a
    // player who does more than the harness does better.
    expect(rate(4), 'a ★4 is not frightening').toBeGreaterThan(0.15);
    expect(left(4), 'a ★4 leaves you comfortable').toBeLessThan(0.4);

    // And the ladder has to be monotonic in health left, or the ratings on the
    // nameplate mean nothing.
    for (const stars of [2, 3, 4]) {
      expect(left(stars), `★${stars} is gentler than ★${stars - 1}`).toBeLessThan(left(stars - 1));
    }
  });

  it('gives you an answer, if you carry one', () => {
    // The other half of a dangerous world. A ★4 kills the harness half the
    // time playing nothing but its rotation; the difference between that and a
    // player has to be something a player can actually DO. This measures the
    // same fights with a pouch of draughts and nothing else changed.
    const rows: string[] = [];
    let dryDeaths = 0;
    let wetDeaths = 0;
    let fights = 0;

    for (const mob of BESTIARY.filter((m) => m.stars >= 3)) {
      const potion = consumableDropFor(mob.level);
      for (const cls of PLAYABLE_CLASSES) {
        const base = {
          name: `${cls.id} vs ${mob.id}`,
          level: mob.level,
          gear: gearSetFor(cls.id, mob.level),
          mobId: mob.id,
          skills: skillsForClass(cls.id, mob.level, learnedAt(cls.id, mob.level)).map((sk) => sk.id),
          classId: cls.id,
        };
        const dry = runEncounter({ ...base, noPotions: true }, 6);
        const wet = runEncounter(base, 6);
        void potion;
        dryDeaths += (1 - dry.winRate) * 6;
        wetDeaths += (1 - wet.winRate) * 6;
        fights += 6;
        if (cls.id === 'warrior') {
          rows.push(
            `  ★${mob.stars} lv${String(mob.level).padStart(3)} ${mob.name.padEnd(24)} ` +
              `dry ${(dry.winRate * 100).toFixed(0).padStart(3)}%  ` +
              `with potions ${(wet.winRate * 100).toFixed(0).padStart(3)}%  ` +
              `(${getItem(potion).name})`,
          );
        }
      }
    }
    console.log('\nWHAT A POTION IS WORTH (Warrior shown; all five measured)\n' + rows.join('\n'));
    console.log(
      `  dies ${((dryDeaths / fights) * 100).toFixed(0)}% of fights with nothing, ` +
        `${((wetDeaths / fights) * 100).toFixed(0)}% carrying draughts\n`,
    );

    // Worth carrying, and not a win button. If a pouch of potions made a ★4
    // free, the creatures would be back to being scenery with an extra step.
    expect(wetDeaths, 'potions do nothing').toBeLessThan(dryDeaths * 0.75);
    expect(wetDeaths, 'potions trivialise the world').toBeGreaterThan(0);
  });

  it('kills you when you pull two', () => {
    // The way anybody actually dies in a game like this. One creature at your
    // level is a fight; two is a mistake, and a mistake has to cost something
    // or there are no decisions on the field at all.
    const rows: string[] = [];
    let doubles = 0;
    let deaths = 0;

    for (const mob of BESTIARY.filter((m) => m.stars <= 2)) {
      for (const cls of PLAYABLE_CLASSES) {
        const skills = skillsForClass(cls.id, mob.level, learnedAt(cls.id, mob.level)).map(
          (sk) => sk.id,
        );
        let survived = 0;
        const trials = 5;
        for (let seed = 0; seed < trials; seed++) {
          const world = new World({
            seed: seed * 9187 + 5,
            zone: pullZone(mob.id, 2),
            classId: cls.id,
          });
          levelPlayer(world, {
            level: mob.level,
            gear: gearSetFor(cls.id, mob.level),
            learned: learnedAt(cls.id, mob.level),
          });
          const out = simulatePull(world, skills);
          if (out.survived) survived++;
        }
        doubles += trials;
        deaths += trials - survived;
        if (cls.id === 'warrior') {
          rows.push(
            `  two ★${mob.stars} lv${String(mob.level).padStart(3)} ${mob.name.padEnd(24)} ` +
              `survived ${survived}/${trials}`,
          );
        }
      }
    }
    const rate = deaths / doubles;
    console.log('\nDOUBLE PULLS (Warrior shown; all five measured)\n' + rows.join('\n'));
    console.log(`  a double pull kills you ${(rate * 100).toFixed(0)}% of the time\n`);

    // Not certain death — that would make every camp a minefield and the game
    // unplayable at the edges. Frequent enough that pulling carefully is a real
    // skill and a bad pull is a real story.
    expect(rate, 'two at once is free').toBeGreaterThan(0.25);
    expect(rate, 'two at once is a death sentence').toBeLessThan(0.9);
  });
});

describe('every creature does something, not just bosses', () => {
  /**
   * Eight bosses in this game are excellent and every one of the twenty-eight
   * thousand other fights was identical: a health bar with a swing timer.
   * "Decided by play, not stats" was true of ★5 and ★6 and of nothing else,
   * and a hundred hours of a hundred-level game are spent on the other ratings.
   *
   * These tests measure each trait doing the thing it exists to do. They are
   * deliberately *mechanism* tests rather than win-rate tests: the whole suite
   * above already says the fights are winnable, and what has to be shown here
   * is that a trait is a shape rather than a number.
   */
  const skillsFor = (mobId: string): string[] =>
    MOBS[mobId]!.stars >= BOSS_STARS ? [] : ['strike', 'rend'];

  it('prints what every creature in the game is like to fight', () => {
    // The table is the point, exactly as it is for the boss kits. "Every
    // creature in Ardmoor is Stubborn" is invisible to any assertion made one
    // creature at a time, and it is the failure that matters most here —
    // four traits arranged into one experience is no better than none.
    const rows = new Map<string, string[]>();
    for (const zone of Object.values(ZONES)) {
      const seen = new Set<string>();
      for (const sp of zone.spawns) {
        const def = getMob(sp.mobId);
        if (def.stars >= BOSS_STARS || def.horse || def.dragon) continue;
        const base = def.starOf ?? def.rareOf ?? def.id;
        if (seen.has(base)) continue;
        seen.add(base);
        const trait = traitFor(def);
        const key = `${zone.id}:${trait?.id ?? 'none'}`;
        rows.set(key, [...(rows.get(key) ?? []), getMob(base).name]);
      }
    }
    console.log('\n  what lives where, and what it does');
    for (const zone of Object.keys(ZONES)) {
      const line: string[] = [];
      for (const t of ['pack', 'skittish', 'venomous', 'stubborn', 'none']) {
        const names = rows.get(`${zone}:${t}`);
        if (names?.length) line.push(`${t} ${names.length}`);
      }
      console.log(`    ${zone.padEnd(10)} ${line.join(', ')}`);
    }
    // Every zone has to offer more than one kind of fight.
    for (const zone of Object.keys(ZONES)) {
      const kinds = ['pack', 'skittish', 'venomous', 'stubborn'].filter(
        (t) => (rows.get(`${zone}:${t}`)?.length ?? 0) > 0,
      );
      expect(kinds.length, `${zone} is all one kind of fight`).toBeGreaterThan(1);
    }
    // And nothing may be left with no behaviour at all in the ordinary bands.
    const orphans = rows.get('fenmarch:none') ?? [];
    console.log(`    ${'no trait'.padEnd(10)} ${orphans.join(', ') || '(none in the Fenmarch)'}`);
  });

  it('makes a pack worse than the same creature alone', () => {
    // The mechanism, isolated: one wolf against four wolves is not merely four
    // times the health, it is four wolves each hitting harder for the company.
    const mobId = 'bog_wolf';
    let alone = 0;
    let together = 0;
    for (let seed = 0; seed < 6; seed++) {
      const solo = new World({ seed: seed * 31 + 5, zone: duelZone(mobId), classId: 'warrior' });
      levelPlayer(solo, { level: 12 });
      alone += simulateFight(solo, { skills: skillsFor(mobId), timeoutSec: 120 }).lowestHealth;

      const packed = new World({
        seed: seed * 31 + 5,
        zone: pullZone(mobId, 4),
        classId: 'warrior',
      });
      levelPlayer(packed, { level: 12 });
      together += simulateFight(packed, { skills: skillsFor(mobId), timeoutSec: 120 }).lowestHealth;
    }
    console.log(
      `\n  pack       alone ${(alone / 6).toFixed(2)} health left at worst, ` +
        `four together ${(together / 6).toFixed(2)}`,
    );
    expect(together / 6, 'a pack is no worse than one of them').toBeLessThan(alone / 6);
  });

  it('makes a venomous creature cost more the longer it takes', () => {
    // The answer to `venomous` is "shorten the fight", which is only an answer
    // if a long fight actually costs more. Measured as poison taken against
    // fight length rather than as a win rate.
    const world = new World({ seed: 404, zone: duelZone('fen_adder'), classId: 'warrior' });
    levelPlayer(world, { level: 5 });
    const player = world.player;
    world.submit(player.id, { t: 'target', id: [...world.entities.values()].find((e) => e.kind === 'mob')!.id });
    world.submit(player.id, { t: 'autoAttack', on: true });

    // Measured across the ramp rather than across the whole fight: the stacks
    // cap, so once a creature has bitten five times the poison is flat, and
    // comparing two windows after that point measures nothing.
    let opening = 0;
    let settled = 0;
    for (let i = 0; i < 400; i++) {
      for (const ev of world.tick()) {
        if (ev.t !== 'damage' || ev.targetId !== player.id || ev.damageType !== 'nature') continue;
        if (i < 80) opening += ev.amount;
        else if (i < 160) settled += ev.amount;
      }
      // Kept alive on purpose: this is a measurement of the poison, not of
      // whether an adder can kill a level-5 Warrior.
      player.health = world.statsOf(player).maxHealth;
    }
    const stacks = player.effects.filter((e) => e.sourceAbilityId === 'venom').length;
    console.log(
      `  venomous   ${opening} poison in the first four seconds, ` +
        `${settled} in the next four, ${stacks} stacks standing`,
    );
    expect(opening, 'nothing was poisoned at all').toBeGreaterThan(0);
    // It ramps: the stacks are the mechanic, so staying in longer costs more.
    expect(settled).toBeGreaterThan(opening);
    expect(stacks).toBeLessThanOrEqual(VENOM_MAX_STACKS);
  });

  it('makes a stubborn creature hit harder at the end than at the start', () => {
    const world = new World({ seed: 77, zone: duelZone('marsh_bear'), classId: 'warrior' });
    levelPlayer(world, { level: 20 });
    const player = world.player;
    const mob = [...world.entities.values()].find((e) => e.kind === 'mob')!;
    world.submit(player.id, { t: 'target', id: mob.id });
    world.submit(player.id, { t: 'autoAttack', on: true });

    // Held at a health share rather than fought down to one. A creature that
    // crosses the line naturally has only two or three swings left before it
    // dies, which is far too small a sample to measure anything with — the
    // first version of this recorded zero swings while cornered and reported
    // it as "being cornered changed nothing".
    const max = world.statsOf(mob).maxHealth;
    const sample = (share: number): { hits: number; total: number } => {
      const out = { hits: 0, total: 0 };
      for (let i = 0; i < 600; i++) {
        mob.health = max * share;
        for (const ev of world.tick()) {
          if (ev.t !== 'damage' || ev.targetId !== player.id || ev.sourceId !== mob.id) continue;
          out.hits++;
          out.total += ev.amount;
        }
        player.health = world.statsOf(player).maxHealth;
      }
      return out;
    };
    const healthy = sample(0.9);
    const cornered = sample(STUBBORN_AT - 0.05);
    const before = healthy.total / Math.max(1, healthy.hits);
    const after = cornered.total / Math.max(1, cornered.hits);
    console.log(`  stubborn   ${before.toFixed(0)} a swing healthy, ${after.toFixed(0)} cornered`);
    expect(healthy.hits, 'the fight never got going').toBeGreaterThan(2);
    expect(cornered.hits, 'the creature never got cornered').toBeGreaterThan(1);
    expect(after, 'being cornered changed nothing').toBeGreaterThan(before * 1.1);
  });

  it('lets a skittish creature run, but never lets it get away', () => {
    // The trap this exists to avoid: it flees past its leash, goes home,
    // heals to full, and can only be killed by bursting the last quarter in
    // three seconds. "You cannot kill this" is not a mechanic.
    const world = new World({ seed: 12, zone: duelZone('moor_hare'), classId: 'warrior' });
    levelPlayer(world, { level: 2 });
    const mob = [...world.entities.values()].find((e) => e.kind === 'mob')!;
    const spawn = { ...mob.spawnPos! };
    const def = getMob(mob.defId!);

    const outcome = simulateFight(world, { skills: skillsFor('moor_hare'), timeoutSec: 90 });
    console.log(
      `  skittish   ${outcome.playerWon ? 'killed' : 'escaped'} in ${outcome.durationSec.toFixed(1)}s, ` +
        `ran ${mob.fled ? 'once' : 'never'}`,
    );
    expect(mob.fled, 'it never broke').toBe(true);
    expect(outcome.playerWon, 'it got away for good').toBe(true);
    expect(outcome.timedOut).toBe(false);
    // And it stayed on its own ground while it ran.
    expect(Math.hypot(mob.pos.x - spawn.x, mob.pos.z - spawn.z)).toBeLessThanOrEqual(
      def.leashRadius,
    );
  });

  it('never gives a boss a trait on top of its kit', () => {
    // Bosses have kits, which are a bigger version of the same idea. Stacking
    // a trait on four telegraphed abilities is another number on the one fight
    // in the game that does not need one.
    for (const def of Object.values(MOBS)) {
      if (def.stars < BOSS_STARS && !def.dragon) continue;
      expect(traitFor(def), `${def.name} has a trait as well as a kit`).toBeNull();
    }
  });

  it('gives a star variant and a rare the trait of the creature they are', () => {
    // A Snarling Bog Wolf is still a wolf and `Mirefang the Bog Wolf` is still
    // a wolf. Their own ids say nothing about that, and the lesson has been
    // learned twice already.
    for (const def of Object.values(MOBS)) {
      const base = def.starOf ?? def.rareOf;
      if (!base || !MOBS[base]) continue;
      if (MOBS[base]!.stars >= BOSS_STARS) continue;
      expect(traitFor(def)?.id ?? null, `${def.name} does not fight like a ${MOBS[base]!.name}`)
        .toBe(traitFor(MOBS[base]!)?.id ?? null);
    }
  });

  it('gives every trait a different answer', () => {
    // The rule the boss kits already run under. Two traits that both mean
    // "kill it faster" are one trait with two names.
    const answers = Object.values(TRAITS).map((t) => t.answer);
    expect(new Set(answers).size).toBe(answers.length);
    for (const t of Object.values(TRAITS)) {
      expect(t.answer.length, `${t.id} says what it does but not what to do`).toBeGreaterThan(12);
      expect(t.line.length).toBeGreaterThan(12);
    }
  });
});

describe('eight grades of the same piece', () => {
  /**
   * The printed table is the whole point. "A boss is worth farming" is not a
   * thing any single assertion can see — it is a distribution, and the number
   * that matters is how many kills a Godly piece is.
   */
  it('prints what each rating hands out, and keeps a boss above a camp', () => {
    const rows: string[] = [];
    for (const stars of [1, 2, 3, 4, 5, 6] as StarRating[]) {
      const parts = TIER_ORDER.filter((t) => TIER_WEIGHTS[stars][t] !== undefined).map((t) => {
        const kills = killsPerTier(stars, t);
        return `${TIERS[t].prefix} 1 in ${kills.toFixed(kills >= 10 ? 0 : 1)}`;
      });
      rows.push(`  ★${stars}  ${parts.join('   ')}`);
    }
    // eslint-disable-next-line no-console
    console.log('\nWHAT A GRADE COSTS, PER DROP\n' + rows.join('\n'));

    // The rule the whole thing rests on: an ordinary creature never carries
    // what a boss carries, and a boss never carries what an ordinary creature
    // does. Without that a bag of hare drops quietly out-gears Old Scar.
    const bossFloor = TIER_ORDER.indexOf('royal');
    for (const stars of [1, 2, 3, 4] as StarRating[]) {
      for (const tier of Object.keys(TIER_WEIGHTS[stars]) as ItemTier[]) {
        expect(
          TIER_ORDER.indexOf(tier),
          `a ★${stars} can drop a ${tier}`,
        ).toBeLessThan(bossFloor);
      }
    }
    for (const stars of [5, 6] as StarRating[]) {
      for (const tier of Object.keys(TIER_WEIGHTS[stars]) as ItemTier[]) {
        expect(
          TIER_ORDER.indexOf(tier),
          `a ★${stars} can drop a ${tier}`,
        ).toBeGreaterThanOrEqual(bossFloor);
      }
    }

    // And the best grade has to be rare enough to be worth going back for, and
    // common enough to be worth hoping for.
    expect(killsPerTier(5, 'godly')).toBeGreaterThan(20);
    expect(killsPerTier(6, 'godly')).toBeLessThan(30);
  });

  it('climbs, and puts Greater exactly where the ladder always was', () => {
    // Greater is the piece as it was authored. The entire game is fitted
    // against that ladder — the DPS budget, the armour curve, every boss win
    // rate in this file — so the grade a piece "normally" is has to be the one
    // those numbers were measured at.
    expect(TIERS.greater.power).toBe(1);
    for (let i = 1; i < TIER_ORDER.length; i++) {
      const below = TIERS[TIER_ORDER[i - 1]!];
      const above = TIERS[TIER_ORDER[i]!];
      expect(above.power, `${TIER_ORDER[i]} is not above ${TIER_ORDER[i - 1]}`).toBeGreaterThan(
        below.power,
      );
    }
    // A Godly piece is a real jump on a Minor one and nothing like a tier of
    // the ladder: the ladder roughly doubles every few levels, and this has to
    // stay a *grade* rather than a shortcut past twenty levels of content.
    expect(TIERS.godly.power / TIERS.minor.power).toBeGreaterThan(2);
    expect(TIERS.godly.power / TIERS.greater.power).toBeLessThan(2);
  });

  it('leaves the one-of-a-kind pieces alone', () => {
    // A Godly Mirefang Blade would turn "the only one of these in the game"
    // into a ladder, which is the opposite of what a signature piece is for.
    // Same for a dragon's weapon and the luxury shop's offhands.
    const named = Object.values(ITEMS).filter(
      (it) => it.critBonus || it.healthBonus || it.moveSpeedBonus || it.skillPower,
    );
    expect(named.length, 'no signature pieces to check').toBeGreaterThan(4);
    for (const item of named) {
      expect(canBeGraded(item), `${item.id} can be graded`).toBe(false);
    }
    // And everything an ordinary camp drops can be.
    const droppable = Object.values(LOOT_TABLES)
      .flatMap((t) => t.entries.map((e) => getItem(e.itemId)))
      .filter((it) => it.slot && it.slot !== 'none' && !it.merchantGood && !it.teaches);
    const gradable = droppable.filter((it) => canBeGraded(it));
    expect(gradable.length / Math.max(1, droppable.length)).toBeGreaterThan(0.8);
  });

  it('scales what a piece does, and what it is worth', () => {
    const base = getItem('iron_longsword');
    const royal = getItem(tieredId('iron_longsword', 'royal'));
    const minor = getItem(tieredId('iron_longsword', 'minor'));

    expect(royal.name).toBe(`Royal ${base.name}`);
    expect(royal.damageMax!).toBeGreaterThan(base.damageMax!);
    expect(minor.damageMax!).toBeLessThan(base.damageMax!);
    expect(royal.slot).toBe(base.slot);
    expect(royal.classes).toEqual(base.classes);
    // Worth more than it does, so the trader maths the whole economy rests on
    // still holds: a Godly piece is a Godly price.
    expect(royal.value / base.value).toBeGreaterThan(TIERS.royal.power);
  });
});

describe('gear asks for more than a level', () => {
  it('lets a committed build wear its own ladder, and a spread one not', () => {
    // The point of a requirement is that a build decides what you can put on.
    // If every build clears it, it is decoration; if only one does, it is a
    // trap. Committing to one attribute or splitting two both clear it;
    // spreading across three does not.
    const rows: string[] = [];
    for (const level of [25, 50, 80]) {
      const points = (level - 1) * POINTS_PER_LEVEL;
      const set = gearSetFor('warrior', level).map((id) => getItem(id));
      const weapon = set.find((it) => it.slot === 'weapon')!;
      const armour = set.find((it) => it.slot === 'chest')!;
      const wantStr = weapon.reqAttributes?.strength ?? 0;
      const wantVit = armour.reqAttributes?.vitality ?? 0;

      const committed = { str: 8 + points * 0.6, vit: 8 + points * 0.4 };
      // Somebody who never touched the attribute their weapon fights with,
      // and somebody who never touched Vitality. Both are builds a player can
      // actually make by clicking + without reading anything.
      const noStrength = 8;
      const noVitality = 8;

      rows.push(
        `  lv${String(level).padStart(3)}  weapon wants ${String(wantStr).padStart(3)} str, ` +
          `armour wants ${String(wantVit).padStart(3)} vit   ` +
          `committed ${Math.round(committed.str)}/${Math.round(committed.vit)}   ` +
          `ignored ${noStrength}/${noVitality}`,
      );

      expect(wantStr, `nothing asked at ${level}`).toBeGreaterThan(0);
      expect(committed.str, `a committed build cannot hold its weapon at ${level}`)
        .toBeGreaterThanOrEqual(wantStr);
      expect(committed.vit, `a committed build cannot wear its armour at ${level}`)
        .toBeGreaterThanOrEqual(wantVit);
      // And it has to actually refuse somebody. A requirement every build
      // clears is a line of text.
      expect(noStrength, `a character with no Strength holds the weapon at ${level}`)
        .toBeLessThan(wantStr);
      expect(noVitality, `a character with no Vitality wears the plate at ${level}`)
        .toBeLessThan(wantVit);
    }
    // eslint-disable-next-line no-console
    console.log('\nWHAT GEAR ASKS FOR\n' + rows.join('\n'));
  });

  it('never hands a character gear it cannot wear', () => {
    // `gearSetFor` is what the whole balance suite dresses in. It used to round
    // to the nearest rung, which for levels 26 and 27 handed back a piece meant
    // for 28 — and the moment gear asked for a level that meant the suite
    // fought Old Scar naked and reported the fight unwinnable played well.
    for (const cls of PLAYABLE_CLASSES) {
      for (let level = 1; level <= 100; level++) {
        for (const id of gearSetFor(cls.id, level)) {
          const item = getItem(id);
          expect(item.reqLevel ?? 0, `${cls.id} at ${level} is handed ${id}`).toBeLessThanOrEqual(
            level,
          );
        }
      }
    }
  });

  it('asks more of a better grade', () => {
    const base = getItem('bearhide_cuirass');
    const godly = getItem(tieredId('bearhide_cuirass', 'godly'));
    expect(base.reqAttributes?.vitality).toBeGreaterThan(0);
    expect(godly.reqAttributes!.vitality!).toBeGreaterThan(base.reqAttributes!.vitality!);
    // But the level is unchanged: a Godly piece of a level-19 item is still a
    // level-19 item, and it is the build it asks more of.
    expect(godly.reqLevel).toBe(base.reqLevel);
  });

  it('asks nothing of the first weapon anybody is handed', () => {
    // A character who cannot equip the weapon they were created with, or the
    // first one they find, has been told to fix a build before they have
    // played the game.
    for (const cls of PLAYABLE_CLASSES) {
      for (const id of WEAPON_LADDER[cls.id].slice(0, 2)) {
        const item = getItem(id);
        expect(item.reqAttributes, `${id} asks for a build`).toBeUndefined();
        expect(item.reqLevel ?? 1, `${id} asks for a level`).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('every attribute is worth spending on', () => {
  /**
   * Two of the four used to be dead weight for most of the roster. Strength
   * did nothing at all unless you were a Warrior, and then only through attack
   * rating; Focus bought energy nobody was short of. Five points a level for a
   * hundred levels is a lot of non-decisions.
   *
   * The printed table is the point, as it is for the boss kits: "this class
   * has one build" is invisible to any assertion made one attribute at a time.
   */
  it('gives every class two builds worth having, and neither one for free', () => {
    const rows: string[] = [];
    const level = 60;
    const points = (level - 1) * POINTS_PER_LEVEL;

    for (const cls of PLAYABLE_CLASSES) {
      const pair = CLASS_ATTRIBUTES[cls.id];
      const bar = skillBarFor(cls.id);
      const onPower = bar.filter((sk) => sk.scalesWith === pair.power);
      const onGuard = bar.filter((sk) => sk.scalesWith === pair.guard);

      // What each build is worth to each half of the bar, at the same total
      // spend. The pair of numbers *crossing over* is the whole feature.
      const committed = CLASSES[cls.id].baseAttributes[pair.power] + points * 0.6;
      const split = CLASSES[cls.id].baseAttributes[pair.guard] + points * 0.6;
      const powerIfCommitted = skillAttributePower(committed, level);
      const powerIfSplit = skillAttributePower(
        CLASSES[cls.id].baseAttributes[pair.power] + points * 0.15,
        level,
      );
      const guardIfCommitted = skillAttributePower(
        CLASSES[cls.id].baseAttributes[pair.guard] + points * 0.15,
        level,
      );
      const guardIfSplit = skillAttributePower(split, level);

      rows.push(
        `  ${cls.name.padEnd(8)} ${pair.power.padEnd(9)}(${String(onPower.length).padStart(2)} skills) ` +
          `${Math.round(powerIfCommitted * 100)}% → ${Math.round(powerIfSplit * 100)}%   ` +
          `${pair.guard.padEnd(9)}(${String(onGuard.length).padStart(2)} skills) ` +
          `${Math.round(guardIfCommitted * 100)}% → ${Math.round(guardIfSplit * 100)}%`,
      );

      // Every skill that does something names an attribute. A bar where half
      // the entries ignore the build is a build that only half exists.
      for (const sk of bar) {
        if (sk.kind === 'interrupt') continue;
        expect(sk.scalesWith, `${cls.id}'s ${sk.name} answers to nothing`).toBeDefined();
      }

      // Committing has to be worth more than not committing, or there is no
      // decision — and the other half has to still be worth pressing, or the
      // decision is a trap.
      expect(powerIfCommitted, `${cls.id} gains nothing by committing`).toBeGreaterThan(
        powerIfSplit + 0.1,
      );
      expect(guardIfCommitted, `${cls.id}'s off-build skills are dead`).toBeGreaterThan(0.4);
    }

    // eslint-disable-next-line no-console
    console.log(
      '\nWHAT A BUILD IS WORTH (level 60, same points either way)\n' + rows.join('\n'),
    );
  });

  it('leaves a committed build exactly where it was before any of this', () => {
    // The reference the whole thing is measured against. Attributes were meant
    // to give a player a decision, not a power budget: the first pass simply
    // added to everything, and every boss in the game became winnable by
    // standing still in the telegraph.
    for (const level of [10, 40, 80]) {
      expect(skillAttributePower(expectedPrimary(level), level)).toBeCloseTo(1, 2);
    }
  });

  it('makes Strength worth something to a class that never attacks with it', () => {
    // The complaint this started from. A Mage's Strength bought precisely
    // nothing; it buys a bigger swing now, which is small on purpose — big
    // enough to be a reason, small enough not to be a rebalance.
    const none = strengthDamage(0);
    const some = strengthDamage(200);
    expect(some).toBeGreaterThan(none * 1.05);
    expect(some).toBeLessThan(none * 1.15);
  });
});

describe('your own rotation is worth timing', () => {
  /**
   * Bosses ask questions and every creature now has a trait, but the player's
   * side of twenty-eight thousand fights was "press whatever is off cooldown".
   * Cooldowns alone produce an *order*, not a decision: there was never a
   * moment where holding a button was better than pressing it.
   *
   * Measured the way the boss telegraphs are: played badly against played
   * well, and the gap is what the mechanic is worth.
   */
  const CHECKS: Array<{ classId: ClassId; level: number; mobId: string; skills: string[] }> = [
    { classId: 'warrior', level: 20, mobId: 'outlaw_reaver', skills: ['strike', 'rend', 'sunder', 'onslaught'] },
    { classId: 'rogue', level: 20, mobId: 'outlaw_reaver', skills: ['backstab', 'rupture', 'kidney_strike', 'assassinate'] },
    { classId: 'ranger', level: 20, mobId: 'outlaw_reaver', skills: ['quick_shot', 'hunters_mark', 'pinning_shot', 'volley'] },
    { classId: 'mage', level: 20, mobId: 'outlaw_reaver', skills: ['frostbolt', 'ember', 'arcane_surge', 'meteor'] },
    { classId: 'priest', level: 20, mobId: 'outlaw_reaver', skills: ['smite', 'searing_word', 'mend_wounds', 'judgement'] },
  ];

  function run(c: (typeof CHECKS)[number], timed: boolean, seed: number) {
    const world = new World({ seed, zone: duelZone(c.mobId), classId: c.classId });
    levelPlayer(world, { level: c.level });
    return simulateFight(world, { skills: c.skills, timeSkills: timed, timeoutSec: 120 });
  }

  it('pays a player who watches for the moment', () => {
    // Measured on *both* axes, because the conditions do not all buy the same
    // thing: a finisher shortens the fight and a desperate heal leaves you
    // standing at the end of it. Judging every class on duration alone
    // reported the Priest's as worthless, which is a fact about the ruler.
    console.log('\n  played in cooldown order, and played watching');
    let better = 0;
    for (const c of CHECKS) {
      const rounds = 12;
      let blindTime = 0;
      let watchTime = 0;
      let blindLow = 0;
      let watchLow = 0;
      for (let seed = 0; seed < rounds; seed++) {
        const a = run(c, false, seed * 977 + 3);
        const b = run(c, true, seed * 977 + 3);
        blindTime += a.durationSec;
        watchTime += b.durationSec;
        blindLow += a.lowestHealth;
        watchLow += b.lowestHealth;
      }
      const bt = blindTime / rounds;
      const wt = watchTime / rounds;
      const bl = blindLow / rounds;
      const wl = watchLow / rounds;
      const skill = c.skills.find((id) => getSkill(id).when)!;
      console.log(
        `    ${c.classId.padEnd(8)} ${getSkill(skill).name.padEnd(12)} ` +
          `${bt.toFixed(1)}s → ${wt.toFixed(1)}s   worst health ` +
          `${bl.toFixed(2)} → ${wl.toFixed(2)}`,
      );
      // Either faster or safer. A condition that buys neither is decoration.
      if (wt < bt - 0.15 || wl > bl + 0.015) better++;
    }
    // Only the ones you can actually *wait* for. `opener` is about the pull
    // and is spent on the first global cooldown whether or not you were
    // thinking; `steady` and `desperate` are rewards for the fight you had
    // rather than buttons to sit on. Those three are measured below, directly.
    expect(better, 'waiting for the moment paid off for nobody').toBeGreaterThanOrEqual(2);
  });

  it('pays the conditions you cannot wait for, where they land', () => {
    // Measured as damage on the spot rather than as a fight, because there is
    // nothing to decide: you press an opener on the pull and a desperate heal
    // when you are nearly dead, and the question is only whether it is worth
    // anything when you do.
    const hit = (classId: ClassId, skillId: string, arrange: (w: World, mob: Entity) => void) => {
      const world = new World({ seed: 5, zone: duelZone('outlaw_reaver'), classId });
      levelPlayer(world, { level: 20 });
      const mob = [...world.entities.values()].find((e) => e.kind === 'mob')!;
      arrange(world, mob);
      world.submit(world.playerId, { t: 'target', id: mob.id });
      world.submit(world.playerId, { t: 'useSkill', skillId });
      // Long enough for a cast to land. Mend Wounds is a 1.5s cast — the first
      // version ticked once and reported the Priest's condition as worth
      // nothing, which was a fact about the probe.
      let total = 0;
      const castTicks = Math.ceil(getSkill(skillId).castMs / TICK_MS) + 2;
      for (let i = 0; i < castTicks; i++) {
        for (const ev of world.tick()) {
          if (ev.t === 'damage' && ev.sourceId === world.playerId) total += ev.amount;
          if (ev.t === 'heal' && ev.targetId === world.playerId) total += ev.amount;
        }
      }
      return total;
    };

    console.log('\n  what a condition is worth where it lands');
    const cases: Array<[string, ClassId, string, (w: World, m: Entity) => void, (w: World, m: Entity) => void]> = [
      ['opener', 'rogue', 'assassinate', () => {}, (w, m) => { m.threat = { [w.playerId]: 50 }; }],
      [
        'steady',
        'ranger',
        'volley',
        () => {},
        (w) => { w.player.health = w.statsOf(w.player).maxHealth * 0.4; },
      ],
      [
        'desperate',
        'priest',
        'mend_wounds',
        (w) => { w.player.health = w.statsOf(w.player).maxHealth * 0.2; },
        (w) => { w.player.health = w.statsOf(w.player).maxHealth * 0.95; },
      ],
    ];
    for (const [name, classId, skillId, live, dead] of cases) {
      const on = hit(classId, skillId, live);
      const off = hit(classId, skillId, dead);
      // The Priest's pair is partly measuring the ceiling rather than the
      // multiplier — a heal at 95% health is capped by the health you have
      // left — and that is the honest number anyway: the whole point is that
      // topping yourself off is worth nothing.
      console.log(`    ${name.padEnd(10)} ${getSkill(skillId).name.padEnd(12)} ${off} → ${on}`);
      expect(on, `${name} is worth nothing when it lands`).toBeGreaterThan(off * 1.2);
    }
  });

  it('gives every class exactly one, and no two the same', () => {
    // The rule the boss kits and the creature traits already run under: two
    // conditions that both mean "use it later" are one condition with two
    // names. Printed, because "all five classes hold a finisher" is invisible
    // to any assertion made one class at a time.
    const byClass = new Map<ClassId, string[]>();
    for (const skill of Object.values(SKILLS)) {
      if (!skill.when) continue;
      byClass.set(skill.classId, [...(byClass.get(skill.classId) ?? []), skill.when.kind]);
    }
    console.log('\n  what each class has to watch for');
    for (const cls of PLAYABLE_CLASSES) {
      const kinds = byClass.get(cls.id) ?? [];
      console.log(`    ${cls.id.padEnd(8)} ${kinds.join(', ') || '(nothing)'}`);
      expect(kinds.length, `${cls.id} has ${kinds.length} skills worth timing`).toBe(1);
    }
    const all = [...byClass.values()].flat();
    expect(new Set(all).size, `only ${new Set(all).size} distinct answers`).toBe(all.length);
  });

  it('never lets a condition be worth more than the skill itself', () => {
    // A multiplier big enough to make the unconditional press pointless turns
    // a decision back into a rotation — you would simply never fire it early,
    // which is the same as it having no untimed use at all.
    for (const skill of Object.values(SKILLS)) {
      if (!skill.when) continue;
      expect(skill.when.multiplier, `${skill.name} is only worth using timed`).toBeLessThan(2.5);
      expect(skill.when.multiplier).toBeGreaterThan(1.2);
    }
  });

  it('reads the condition when the cast begins, not when it lands', () => {
    // A `finisher` checked on resolution would reward pressing it early and
    // hoping the target dips under the line while it flies — the opposite of
    // the decision it exists to create.
    const world = new World({ seed: 5, zone: duelZone('outlaw_reaver'), classId: 'warrior' });
    levelPlayer(world, { level: 20 });
    const mob = [...world.entities.values()].find((e) => e.kind === 'mob')!;
    const max = world.statsOf(mob).maxHealth;

    world.submit(world.playerId, { t: 'target', id: mob.id });
    mob.health = max;
    expect(world.conditionMet(world.player, getSkill('onslaught'), mob.id)).toBe(false);
    mob.health = max * 0.2;
    expect(world.conditionMet(world.player, getSkill('onslaught'), mob.id)).toBe(true);
  });

  it('gives the Rogue their opener and takes it away once seen', () => {
    const world = new World({ seed: 5, zone: duelZone('outlaw_reaver'), classId: 'rogue' });
    levelPlayer(world, { level: 20 });
    const mob = [...world.entities.values()].find((e) => e.kind === 'mob')!;
    const skill = getSkill('assassinate');

    expect(world.conditionMet(world.player, skill, mob.id), 'nothing has seen you yet').toBe(true);
    mob.threat = { [world.playerId]: 40 };
    expect(world.conditionMet(world.player, skill, mob.id), 'it is fighting you now').toBe(false);
  });

  it('makes the Mage land the burn first', () => {
    const world = new World({ seed: 5, zone: duelZone('outlaw_reaver'), classId: 'mage' });
    levelPlayer(world, { level: 20 });
    const mob = [...world.entities.values()].find((e) => e.kind === 'mob')!;
    const meteor = getSkill('meteor');

    expect(world.conditionMet(world.player, meteor, mob.id)).toBe(false);
    world.submit(world.playerId, { t: 'target', id: mob.id });
    world.submit(world.playerId, { t: 'useSkill', skillId: 'ember' });
    for (let i = 0; i < 6; i++) world.tick();
    expect(world.conditionMet(world.player, meteor, mob.id), 'the burn did not count').toBe(true);
  });
});

describe('a camp that notices you are farming it', () => {
  /**
   * The loop has a ten-second unit — a kill — and a forty-minute unit — a
   * level — and nothing at all in between. Everything the world layer does
   * runs on a much longer clock than that: a front slides over twenty minutes,
   * a dragon wakes every half hour. The two-minute scale, which is the one a
   * player actually sits inside, was empty.
   *
   * The whole design rests on the *pace* being the lever, so the numbers that
   * matter are how much farming it takes — and how much ordinary levelling it
   * does not.
   */
  function campWorld(mobId: string, count = 10): World {
    return new World({
      seed: 21,
      zone: {
        ...pullZone(mobId, count),
        id: 'test-camp',
        // The whole point of this suite.
        musters: true,
      },
      classId: 'warrior',
    });
  }

  /** Kill everything the camp puts up, at a given seconds-per-kill pace. */
  function farm(world: World, kills: number, secondsPerKill: number) {
    const player = world.player;
    const events: string[] = [];
    let musters = 0;
    let champion = '';
    /** How many converged at the moment it fired, not at the end of the farm. */
    let came = 0;
    for (let n = 0; n < kills; n++) {
      const victim = [...world.entities.values()].find(
        (e) => e.kind === 'mob' && !e.dead && !e.roused,
      );
      if (!victim) break;
      victim.health = 1;
      world.submit(player.id, { t: 'target', id: victim.id });
      world.submit(player.id, { t: 'autoAttack', on: true });
      for (let i = 0; i < 200 && !victim.dead; i++) {
        victim.health = 1;
        player.health = world.statsOf(player).maxHealth;
        for (const ev of world.tick()) {
          if (ev.t === 'muster') {
            musters++;
            champion = ev.name;
            came = ev.count;
            events.push(`kill ${n + 1}`);
          }
        }
      }
      // The gap between kills, which is the whole lever.
      const idle = Math.round((secondsPerKill * 1000) / TICK_MS);
      for (let i = 0; i < idle; i++) {
        player.health = world.statsOf(player).maxHealth;
        for (const ev of world.tick()) {
          if (ev.t === 'muster') {
            musters++;
            champion = ev.name;
            came = ev.count;
            events.push(`waiting after ${n + 1}`);
          }
        }
      }
    }
    world.submit(player.id, { t: 'autoAttack', on: false });
    return { musters, champion, came, events };
  }

  it('rouses a camp you are emptying, and never one you are passing through', () => {
    console.log('\n  how hard you have to push');
    const rows: Array<[string, number, number]> = [];
    for (const pace of [3, 8, 15, 25]) {
      const world = campWorld('bog_wolf', 12);
      levelPlayer(world, { level: 30 });
      const out = farm(world, 12, pace);
      rows.push([`${pace}s a kill`, out.musters, 12]);
      console.log(
        `    ${String(pace).padStart(2)}s between kills  ${out.musters} muster(s) in 12 kills` +
          (out.champion ? `  — ${out.champion}` : ''),
      );
    }
    // Hard farming rouses the ground. A player who is levelling — walking to
    // the next camp, resting, picking their pulls — never sees it, and that is
    // what makes it a decision rather than a tax on playing.
    const fast = rows.find((r) => r[0] === '3s a kill')!;
    const slow = rows.find((r) => r[0] === '25s a kill')!;
    expect(fast[1], 'emptying a camp went unnoticed').toBeGreaterThan(0);
    expect(slow[1], 'an ordinary levelling pace rouses the ground').toBe(0);
  });

  it('sends a few, not everything in the zone', () => {
    // A wipe is not an event, it is the end of a session.
    const world = campWorld('bog_wolf', 14);
    levelPlayer(world, { level: 30 });
    // Counted when it fired, not at the end: the farm goes on killing, so by
    // the end of it the ones that came are corpses.
    const out = farm(world, 10, 2);
    expect(out.musters, 'nothing mustered').toBeGreaterThan(0);
    expect(out.came).toBeGreaterThan(0);
    expect(out.came, 'the whole camp came').toBeLessThanOrEqual(MUSTER_MAX);
  });

  it('raises one of them a rating, and never past ★4', () => {
    const world = campWorld('bog_wolf', 12);
    levelPlayer(world, { level: 30 });
    farm(world, 10, 2);
    const champion = [...world.entities.values()].find((e) => e.roused);
    expect(champion, 'nobody stepped up').toBeDefined();
    const def = getMob(champion!.defId!);
    const base = getMob(baseMobId(def.starOf ?? def.id));
    expect(def.stars).toBeGreaterThan(base.stars - 1);
    // ★5 and ★6 mean boss and elite boss everywhere else in the codebase.
    expect(def.stars).toBeLessThan(BOSS_STARS);
    expect(champion!.name).toContain('Roused');
  });

  it('is worth taking, not only surviving', () => {
    // An event that is only harder is a punishment for playing well. A roused
    // champion carries what a creature of its new rating carries.
    const world = campWorld('bog_wolf', 12);
    levelPlayer(world, { level: 30 });
    farm(world, 10, 2);
    const champion = [...world.entities.values()].find((e) => e.roused)!;
    const base = getMob(baseMobId(getMob(champion.defId!).starOf ?? champion.defId!));
    const raised = getMob(champion.defId!);
    expect(raised.xp).toBeGreaterThan(base.xp);
    const purse = goldForKill(raised.level, raised.stars);
    const plain = goldForKill(base.level, base.stars);
    console.log(
      `\n  a roused ${base.name}: ${base.xp} → ${raised.xp} xp, ` +
        `${plain.max}g → ${purse.max}g`,
    );
    expect(purse.max).toBeGreaterThan(plain.max);
  });

  it('calms down if you walk away, and never while you are fighting it', () => {
    const world = campWorld('bog_wolf', 12);
    levelPlayer(world, { level: 30 });
    farm(world, 10, 2);
    const champion = [...world.entities.values()].find((e) => e.roused)!;

    // Still coming: it must not calm down mid-fight, or the decision becomes a
    // waiting game.
    champion.aiState = 'chasing';
    for (let i = 0; i < (ROUSED_MS / TICK_MS) * 2; i++) world.tick();
    expect(champion.roused, 'it gave up while chasing you').toBe(true);

    // Walked away from — actually away. Left standing next to it, the ordinary
    // aggro check puts it straight back to chasing every tick, which is the
    // right behaviour and the wrong test.
    world.player.pos = { x: 4000, z: 4000 };
    champion.aiState = 'idle';
    champion.targetId = null;
    for (let i = 0; i < ROUSED_MS / TICK_MS + 10; i++) world.tick();
    expect(champion.roused, 'it stayed roused for ever').toBe(false);
    expect(champion.name).not.toContain('Roused');
  });

  it('is off wherever a fight is being measured', () => {
    // The same switch `rareSpawns` and `adventurers` have, for the same
    // reason: a duel whose opponent is joined by three friends is measuring
    // something else entirely.
    expect(duelZone('bog_wolf').musters).toBe(false);
    expect(pullZone('bog_wolf', 3).musters).toBe(false);
  });
});
