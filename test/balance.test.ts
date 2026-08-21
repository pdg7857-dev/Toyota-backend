import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world.js';
import { duelZone, levelPlayer, simulateFight, type FightResult } from './helpers.js';
import {
  MAX_EQUIPMENT_DROP_CHANCE,
  MAX_LEVEL,
  STAR_MODIFIERS,
  baseMobXp,
  goldForKill,
  xpForKill,
  xpToNext,
} from '../src/sim/formulas.js';
import { BOSS_STARS, type MobDef } from '../src/sim/types.js';
import { LOOT_TABLES, MOBS } from '../src/content/mobs.js';
import { FENMARCH, PLAYABLE_CLASSES } from '../src/content/zone.js';
import { canEquip, getItem } from '../src/content/items.js';

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
  classId?: 'warrior' | 'priest';
  interruptSkill?: string;
}

interface Summary {
  winRate: number;
  medianTtk: number;
  medianHealthLeft: number;
  timeouts: number;
  slamsTaken: number;
  slamsDodged: number;
  interrupts: number;
  mobHealed: number;
}

function runEncounter(enc: Encounter, trials = TRIALS): Summary {
  const results: FightResult[] = [];
  for (let seed = 0; seed < trials; seed++) {
    const world = new World({
      seed: seed * 7919 + 13,
      zone: duelZone(enc.mobId),
      classId: enc.classId ?? 'warrior',
    });
    levelPlayer(world, { level: enc.level, gear: enc.gear });
    results.push(
      simulateFight(world, {
        skills: enc.skills,
        dodge: enc.dodge ?? false,
        ...(enc.interruptSkill ? { interruptSkill: enc.interruptSkill } : {}),
        timeoutSec: 240,
      }),
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
    interrupts: results.reduce((a, r) => a + r.interrupts, 0),
    mobHealed: results.reduce((a, r) => a + r.mobHealed, 0),
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

// --------------------------------------------------------------------------
// The loot economy.
//
// The design rule: harder mobs drop BETTER things and MORE GOLD, but gear
// stays rare at every tier. Gold and merchant goods are the reliable reward;
// equipment is the lottery.
// --------------------------------------------------------------------------

describe('loot scales with difficulty', () => {
  /** Ordinary mobs, ordered from easiest to hardest by level then stars. */
  const ladder = Object.values(MOBS)
    .filter((m) => m.stars < BOSS_STARS)
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
    const easiest = ladder.slice(0, 3);
    const hardest = ladder.slice(-3);
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

    expect(mean(hardest.map(expectedItemValue))).toBeGreaterThan(
      mean(easiest.map(expectedItemValue)) * 8,
    );
    // ...while the gear drop rate stays in the same band throughout.
    expect(mean(hardest.map(equipmentChance))).toBeLessThan(
      mean(easiest.map(equipmentChance)) * 2,
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

  it('pays far better for a boss than for anything ordinary', () => {
    const hardestOrdinary = Math.max(...ladder.map(expectedGold));
    for (const bossId of ['cadfael', 'old_scar'] as const) {
      expect(expectedGold(MOBS[bossId]!)).toBeGreaterThan(hardestOrdinary * 4);
    }
  });

  it('only lets epics come from bosses', () => {
    for (const mob of ladder) {
      for (const entry of LOOT_TABLES[mob.lootTableId]!.entries) {
        expect(getItem(entry.itemId).quality).not.toBe('epic');
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

  it('kills more slowly than the Warrior but survives better', () => {
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
    // staying power; if it were simply worse at both there would be no reason
    // to pick it.
    expect(warrior.winRate).toBeGreaterThanOrEqual(0.9);
    expect(priest.winRate).toBeGreaterThanOrEqual(0.9);
    expect(priest.medianTtk).toBeGreaterThan(warrior.medianTtk);
    expect(priest.medianHealthLeft).toBeGreaterThan(warrior.medianHealthLeft);
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
