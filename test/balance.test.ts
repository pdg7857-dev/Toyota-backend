import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world.js';
import { duelZone, levelPlayer, simulateFight, type FightResult } from './helpers.js';
import { MAX_LEVEL, STAR_MODIFIERS, baseMobXp, xpForKill, xpToNext } from '../src/sim/formulas.js';
import { BOSS_STARS, type MobDef } from '../src/sim/types.js';
import { MOBS } from '../src/content/mobs.js';
import { FENMARCH } from '../src/content/zone.js';

/**
 * Balance is measured, not guessed.
 *
 * Each case runs the same encounter across many seeds and asserts on the
 * *distribution* — win rate, time to kill, health remaining. When a number here
 * fails, the fix belongs in `sim/formulas.ts` or the content files, not in the
 * assertion. Widening a threshold to make a red test pass is how balance rots.
 */

const TRIALS = 100;

interface Encounter {
  name: string;
  level: number;
  gear: string[];
  mobId: string;
  skills: string[];
  dodge?: boolean;
}

interface Summary {
  winRate: number;
  medianTtk: number;
  medianHealthLeft: number;
  timeouts: number;
  slamsTaken: number;
  slamsDodged: number;
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
    results.push(
      simulateFight(world, { skills: enc.skills, dodge: enc.dodge ?? false, timeoutSec: 240 }),
    );
  }
  const wins = results.filter((r) => r.playerWon);
  const ttks = wins.map((r) => r.durationSec).sort((a, b) => a - b);
  const healths = results.map((r) => r.healthLeft).sort((a, b) => a - b);
  return {
    winRate: wins.length / results.length,
    medianTtk: ttks.length ? ttks[Math.floor(ttks.length / 2)]! : Infinity,
    medianHealthLeft: healths[Math.floor(healths.length / 2)]!,
    timeouts: results.filter((r) => r.timedOut).length,
    slamsTaken: results.reduce((a, r) => a + r.slamsTaken, 0),
    slamsDodged: results.reduce((a, r) => a + r.slamsDodged, 0),
  };
}

function report(name: string, s: Summary): void {
  // Printed so a failing threshold shows you the actual shape of the fight.
  const ttk = s.medianTtk === Infinity ? '  n/a' : `${s.medianTtk.toFixed(1).padStart(5)}s`;
  console.log(
    `${name.padEnd(40)} win ${(s.winRate * 100).toFixed(0).padStart(3)}%  ttk ${ttk}  ` +
      `hp left ${(s.medianHealthLeft * 100).toFixed(0).padStart(3)}%` +
      (s.slamsTaken + s.slamsDodged > 0 ? `  slams hit/dodged ${s.slamsTaken}/${s.slamsDodged}` : ''),
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

  it('keeps every ordinary mob under ★5 and both bosses at ★5+', () => {
    expect(MOBS.cadfael!.stars).toBe(5);
    expect(MOBS.old_scar!.stars).toBe(6);
    for (const mob of Object.values(MOBS)) {
      if (mob.id === 'cadfael' || mob.id === 'old_scar') continue;
      expect(mob.stars).toBeLessThan(BOSS_STARS);
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
        const needed = MELEE_STANDOFF + otherDef.aggroRadius + MARGIN;
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

  it('covers the whole 1-25 band with ordinary mobs', () => {
    const levels = Object.values(MOBS)
      .filter((m) => m.stars < BOSS_STARS)
      .map((m) => m.level)
      .sort((a, b) => a - b);
    expect(levels[0]).toBe(1);
    expect(levels[levels.length - 1]).toBeGreaterThanOrEqual(MAX_LEVEL - 3);
    // No gap wide enough to strand a player with nothing to fight.
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]! - levels[i - 1]!).toBeLessThanOrEqual(4);
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

  it('Cadfael ★5 (20): dodging the telegraphs decides the fight', () => {
    const stand = runEncounter({
      name: 'lv22 vs Cadfael, standing in it',
      level: 22,
      gear: cadfaelGear,
      mobId: 'cadfael',
      skills: fullKit,
      dodge: false,
    });
    const dodge = runEncounter({
      name: 'lv22 vs Cadfael, dodging',
      level: 22,
      gear: cadfaelGear,
      mobId: 'cadfael',
      skills: fullKit,
      dodge: true,
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
    });
    const dodge = runEncounter({
      name: 'lv25 vs Old Scar, dodging',
      level: 25,
      gear: scarGear,
      mobId: 'old_scar',
      skills: fullKit,
      dodge: true,
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
