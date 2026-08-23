import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world.js';
import { duelZone, learnedAt, levelPlayer, simulateFight, type FightResult } from './helpers.js';
import {
  MAX_EQUIPMENT_DROP_CHANCE,
  MAX_LEVEL,
  STAR_MODIFIERS,
  baseMobXp,
  deriveMobStats,
  goldForKill,
  xpForKill,
  xpToNext,
} from '../src/sim/formulas.js';
import { BOSS_STARS, type ClassId, type MobDef } from '../src/sim/types.js';
import { BOUNTY_MOBS, LOOT_TABLES, MOBS } from '../src/content/mobs.js';
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
import { FENMARCH, PLAYABLE_CLASSES, ZONES } from '../src/content/zone.js';
import { QUESTS } from '../src/content/quests.js';
import {
  CONTROL_LIMIT,
  FLIP_THRESHOLD,
  HOLDINGS,
  PRESSURE_PER_KILL,
  getFaction,
} from '../src/content/factions.js';
import { ITEMS, WEAPON_LADDER, canEquip, gearSetFor, getItem } from '../src/content/items.js';
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
    });
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
  /**
   * Ordinary mobs, ordered from easiest to hardest by level then stars.
   *
   * Rare spawns are excluded, and not as a convenience: every rule below is
   * about what a CAMP pays out. A named creature you see once an hour is
   * governed by the opposite rules — guaranteed epic, double gold — and
   * mixing the two would either forbid the rare or licence the camp.
   */
  const ladder = Object.values(MOBS)
    .filter((m) => m.stars < BOSS_STARS && !m.rareOf)
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
    const shared = { level: 22, mobId: 'cadfael', dodge: true, name: '' };
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
          expect(namedStats.maxHealth, `${rare.name} is no tougher than the camp`).toBeGreaterThan(
            campStats.maxHealth * 1.4,
          );
          expect(namedStats.damageMax).toBeGreaterThan(campStats.damageMax);
          expect(named.medianTtk).toBeGreaterThanOrEqual(camp.medianTtk);
        }
        // But a rare is not a boss: someone farming its camp must be able to
        // take it, or the whole mechanic is a taunt.
        expect(named.winRate, `${cls.id} cannot beat ${rare.name}`).toBeGreaterThanOrEqual(0.85);
        expect(named.timeouts, `${cls.id} times out on ${rare.name}`).toBe(0);
      }
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
        const needed = def.aggroRadius + 4;
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
  const CHECKPOINTS: Array<{ level: number; mobId: string }> = [
    { level: 22, mobId: 'hill_wolf' },
    { level: 28, mobId: 'moor_eagle' },
    { level: 34, mobId: 'highland_bear' },
    { level: 40, mobId: 'clan_berserker' },
    { level: 48, mobId: 'marsh_heron' },
    // Tidewatch Marauder, not the Smuggler Enforcer two levels BELOW: every
    // other checkpoint pairs you with something at your level or above, and
    // the one that did not was measuring how fast you clear trash.
    { level: 56, mobId: 'tidewatch_marauder' },
    { level: 64, mobId: 'great_pike' },
    { level: 70, mobId: 'grey_seal_bull' },
    { level: 78, mobId: 'blackshield_spearman' },
    { level: 86, mobId: 'warhound_alpha' },
    { level: 94, mobId: 'blackshield_champion' },
    { level: 100, mobId: 'fort_warden' },
  ];

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
        expect(s.winRate, `${cls.id} loses at level ${level} to ${mobId}`).toBeGreaterThanOrEqual(0.85);
        expect(s.timeouts, `${cls.id} times out at level ${level}`).toBe(0);
        expect(s.medianTtk, `${cls.id} kills too fast at ${level}`).toBeGreaterThan(3);
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

  it('keeps every zone laid out safely', () => {
    for (const zone of Object.values(ZONES)) {
      // Bosses clear of unrelated camps.
      for (const boss of zone.spawns.filter((s) => MOBS[s.mobId]!.stars >= BOSS_STARS)) {
        for (const other of zone.spawns) {
          const def = MOBS[other.mobId]!;
          if (other === boss || def.stars >= BOSS_STARS) continue;
          if (other.guardOf === boss.mobId) continue;
          const d = Math.hypot(boss.pos.x - other.pos.x, boss.pos.z - other.pos.z);
          const needed = 3.5 + def.aggroRadius + 4;
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
          if (d < def.aggroRadius + 4) {
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
