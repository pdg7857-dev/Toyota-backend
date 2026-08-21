import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world.js';
import { duelZone, levelPlayer, simulateFight, type FightResult } from './helpers.js';
import { xpForKill, xpToNext } from '../src/sim/formulas.js';
import { MOBS } from '../src/content/mobs.js';

/**
 * Balance is measured, not guessed.
 *
 * Each case runs the same encounter across many seeds and asserts on the
 * *distribution* — win rate, time to kill, health remaining. When a number here
 * fails, the fix belongs in `sim/formulas.ts` or the content files, not in the
 * assertion. Widening a threshold to make a red test pass is how balance rots.
 */

const TRIALS = 120;

interface Encounter {
  name: string;
  level: number;
  gear: string[];
  mobId: string;
  skills: string[];
}

interface Summary {
  winRate: number;
  medianTtk: number;
  p90Ttk: number;
  medianHealthLeft: number;
  timeouts: number;
}

function runEncounter(enc: Encounter, trials = TRIALS): Summary {
  const results: FightResult[] = [];
  for (let seed = 0; seed < trials; seed++) {
    const world = new World({
      seed: seed * 7919 + 13,
      zone: duelZone(enc.mobId),
      classId: 'warrior',
    });
    levelPlayer(world, { level: enc.level, gear: enc.gear });
    results.push(simulateFight(world, enc.skills));
  }
  const wins = results.filter((r) => r.playerWon);
  const ttks = wins.map((r) => r.durationSec).sort((a, b) => a - b);
  const healths = results.map((r) => r.healthLeft).sort((a, b) => a - b);
  return {
    winRate: wins.length / results.length,
    medianTtk: ttks.length ? ttks[Math.floor(ttks.length / 2)]! : Infinity,
    p90Ttk: ttks.length ? ttks[Math.floor(ttks.length * 0.9)]! : Infinity,
    medianHealthLeft: healths[Math.floor(healths.length / 2)]!,
    timeouts: results.filter((r) => r.timedOut).length,
  };
}

function report(name: string, s: Summary): void {
  // Printed so a failing threshold shows you the actual shape of the fight.
  console.log(
    `${name.padEnd(34)} win ${(s.winRate * 100).toFixed(0).padStart(3)}%  ` +
      `ttk ${s.medianTtk.toFixed(1).padStart(5)}s (p90 ${s.p90Ttk.toFixed(1)}s)  ` +
      `hp left ${(s.medianHealthLeft * 100).toFixed(0)}%  timeouts ${s.timeouts}`,
  );
}

/**
 * The very first fight is the most important encounter in the game: it is where
 * a player decides whether the combat is worth their time. It gets its own case
 * with tighter bounds than anything else.
 */
describe('the first fight', () => {
  it('is a clear win that still costs something', () => {
    const enc: Encounter = {
      name: 'lv1 starting kit vs Mossback Boar (2)',
      level: 1,
      gear: [],
      mobId: 'mossback_boar',
      skills: ['strike'],
    };
    const s = runEncounter(enc);
    report(enc.name, s);

    expect(s.winRate).toBe(1);
    // Long enough to see a cooldown come back, short enough to stay interesting.
    expect(s.medianTtk).toBeGreaterThan(5);
    expect(s.medianTtk).toBeLessThan(20);
    // A first fight that costs nothing teaches nothing; one that nearly kills
    // you reads as the game being unfair before you understand it.
    expect(s.medianHealthLeft).toBeLessThan(0.9);
    expect(s.medianHealthLeft).toBeGreaterThan(0.5);
  });
});

describe('level-appropriate encounters are winnable', () => {
  const encounters: Encounter[] = [
    {
      name: 'lv6 geared vs Bog Wolf (5)',
      level: 6,
      gear: ['bronze_shortsword', 'boiled_leather_vest'],
      mobId: 'bog_wolf',
      skills: ['strike', 'rend'],
    },
    {
      name: 'lv10 geared vs Fen Kobold (8, elite)',
      level: 10,
      gear: ['ironbark_cudgel', 'boiled_leather_vest', 'bogstrider_greaves'],
      mobId: 'fen_kobold',
      skills: ['strike', 'rend', 'bulwark', 'sunder'],
    },
  ];

  for (const enc of encounters) {
    it(`${enc.name} — wins reliably in a sane time`, () => {
      const s = runEncounter(enc);
      report(enc.name, s);

      // A level-appropriate fight should almost never be lost by a player who
      // simply presses their buttons.
      expect(s.winRate).toBeGreaterThanOrEqual(0.9);
      // Long enough that skills and cooldowns matter — a fight decided before
      // anything comes off cooldown is just an auto-attack with extra steps.
      // Fights that drag are the other classic MMO-to-RPG pacing failure.
      expect(s.medianTtk).toBeGreaterThan(5);
      expect(s.medianTtk).toBeLessThan(45);
      expect(s.timeouts).toBe(0);
      // It should still cost something — a fight you win at full health is noise.
      expect(s.medianHealthLeft).toBeLessThan(0.9);
    });
  }
});

describe('the boss is a real fight', () => {
  const bossGear = ['ironbark_cudgel', 'kobold_scale_mail', 'bogstrider_greaves', 'ring_of_the_fen'];
  const bossSkills = ['strike', 'rend', 'rally', 'bulwark', 'sunder'];

  // The shape we want is a wall that moves: you lose at the boss's own level,
  // and you win once you have put a few levels and the zone's gear behind you.
  // Asserting that gradient is far more robust than pinning one win rate.
  it('turns back a player at its own level', () => {
    const s = runEncounter({
      name: 'lv12 geared vs Grualach (12, boss)',
      level: 12,
      gear: bossGear,
      mobId: 'grualach',
      skills: bossSkills,
    });
    report('lv12 geared vs Grualach (12, boss)', s);
    expect(s.winRate).toBeLessThan(0.4);
  });

  it('is beatable once the player outlevels it', () => {
    const s = runEncounter({
      name: 'lv16 geared vs Grualach (12, boss)',
      level: 16,
      gear: bossGear,
      mobId: 'grualach',
      skills: bossSkills,
    });
    report('lv16 geared vs Grualach (12, boss)', s);

    expect(s.winRate).toBeGreaterThan(0.75);
    // Long enough to feel like a boss, short enough not to be a war of attrition.
    expect(s.medianTtk).toBeGreaterThan(20);
    expect(s.medianTtk).toBeLessThan(150);
    // It should still hurt.
    expect(s.medianHealthLeft).toBeLessThan(0.7);
  });

  it('kills an underlevelled player', () => {
    const enc: Encounter = {
      name: 'lv6 vs Grualach (12, boss)',
      level: 6,
      gear: ['bronze_shortsword'],
      mobId: 'grualach',
      skills: ['strike', 'rend'],
    };
    const s = runEncounter(enc, 30);
    report(enc.name, s);
    expect(s.winRate).toBe(0);
  });
});

describe('level gaps matter', () => {
  it('punishes fighting well above your level', () => {
    const s = runEncounter(
      {
        name: 'lv4 vs Fen Kobold (8, elite)',
        level: 4,
        gear: ['bronze_shortsword'],
        mobId: 'fen_kobold',
        skills: ['strike', 'rend'],
      },
      40,
    );
    report('lv4 vs Fen Kobold (8, elite)', s);
    expect(s.winRate).toBeLessThan(0.25);
  });

  it('makes grey mobs not worth killing', () => {
    const boar = MOBS.mossback_boar!;
    expect(xpForKill(boar.xp, boar.level, 2)).toBeGreaterThan(15);
    expect(xpForKill(boar.xp, boar.level, 12)).toBeLessThan(3);
  });
});

describe('progression pacing', () => {
  it('reaches level 10 in a believable number of kills', () => {
    // How many level-appropriate kills the curve demands, ignoring travel time.
    let kills = 0;
    for (let level = 1; level < 10; level++) {
      const mob =
        level < 4 ? MOBS.mossback_boar! : level < 8 ? MOBS.bog_wolf! : MOBS.fen_kobold!;
      const perKill = xpForKill(mob.xp, mob.level, level);
      kills += Math.ceil(xpToNext(level) / perKill);
    }
    console.log(`kills to reach level 10: ${kills}`);

    // Enough to feel earned, few enough that it never reads as an MMO grind.
    expect(kills).toBeGreaterThan(40);
    expect(kills).toBeLessThan(260);
  });

  it('keeps the level curve monotonically more expensive', () => {
    for (let level = 1; level < 39; level++) {
      expect(xpToNext(level + 1)).toBeGreaterThan(xpToNext(level));
    }
  });
});
