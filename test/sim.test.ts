import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world.js';
import {
  MAX_LEVEL,
  TICK_MS,
  castBreakChance,
  deriveMobStats,
  expectedDefense,
  goldForKill,
  xpToNext,
} from '../src/sim/formulas.js';
import { FENMARCH, PLAYABLE_CLASSES, ZONES, getZone } from '../src/content/zone.js';
import { HeightField, getTheme, type Clearing } from '../src/content/terrain.js';
import { countEvents, duelZone, emptyZone, levelPlayer, simulateFight, vendorZone } from './helpers.js';
import { VENDORS, buyPrice, sellPrice } from '../src/content/vendors.js';
import { QUESTS, getQuest } from '../src/content/quests.js';
import {
  HOLDINGS,
  STANDING_LIMIT,
  getHolding,
} from '../src/content/factions.js';
import { DRAGONS, dragonMobId } from '../src/content/dragons.js';
import { SKILLS, skillBarFor, getSkill, skillsTaughtBy } from '../src/content/skills.js';
import { ITEMS, canEquip, getItem } from '../src/content/items.js';
import { ARMOR_SLOT_SHARE, curveArmorTotal, curveWeaponDps } from '../src/content/curves.js';
import {
  ARMOUR_LINES,
  TROPHY_DROP_CHANCE,
  questArmourId,
  questWeaponId,
  trophyId,
} from '../src/content/questgear.js';
import {
  RARES,
  RARE_LEVEL_BONUS,
  RARE_SPAWN_CHANCE,
  rareMobId,
  signatureWeaponId,
} from '../src/content/rares.js';
import { BOUNTY_MOBS, LOOT_TABLES, MOBS, getMob } from '../src/content/mobs.js';
import { BOSS_STARS, isBoss } from '../src/sim/types.js';
import type { Entity, SimEvent } from '../src/sim/types.js';

function newWorld(seed = 1, zone = duelZone('mossback_boar')) {
  return new World({ seed, zone, classId: 'warrior' });
}

/** Which mob owns each loot table, for tracing a drop back to its source. */
const MOBS_BY_TABLE: Record<string, string> = Object.fromEntries(
  Object.values(MOBS).map((m) => [m.lootTableId, m.id]),
);

function theMob(world: World): Entity {
  const mob = [...world.entities.values()].find((e) => e.kind === 'mob');
  if (!mob) throw new Error('no mob in world');
  return mob;
}

describe('determinism', () => {
  it('produces identical event streams for identical seeds and commands', () => {
    const run = (): string => {
      const world = newWorld(4242);
      world.submit(world.playerId, { t: 'target', id: theMob(world).id });
      world.submit(world.playerId, { t: 'autoAttack', on: true });
      const events: SimEvent[] = [];
      for (let i = 0; i < 400; i++) {
        if (i % 90 === 0) world.submit(world.playerId, { t: 'useSkill', skillId: 'strike' });
        events.push(...world.tick());
      }
      return JSON.stringify(events);
    };
    expect(run()).toBe(run());
  });

  it('diverges for different seeds', () => {
    const run = (seed: number): string => {
      const world = newWorld(seed);
      world.submit(world.playerId, { t: 'target', id: theMob(world).id });
      world.submit(world.playerId, { t: 'autoAttack', on: true });
      const events: SimEvent[] = [];
      for (let i = 0; i < 400; i++) events.push(...world.tick());
      return JSON.stringify(events);
    };
    expect(run(1)).not.toBe(run(2));
  });
});

describe('combat', () => {
  it('deals damage and eventually kills a target', () => {
    const world = newWorld(7);
    levelPlayer(world, { level: 5, gear: ['bronze_shortsword'] });
    const result = simulateFight(world);
    expect(result.timedOut).toBe(false);
    expect(result.playerWon).toBe(true);
  });

  it('does not swing while out of range, and swings once in range', () => {
    const world = new World({ seed: 3, zone: duelZone('mossback_boar', 30), classId: 'warrior' });
    world.submit(world.playerId, { t: 'target', id: theMob(world).id });
    world.submit(world.playerId, { t: 'autoAttack', on: true });

    const idle = world.advance(3000);
    expect(countEvents(idle, 'swing')).toBe(0);

    // Walk into range; the mob is out of aggro radius so it stays put.
    world.submit(world.playerId, { t: 'move', dir: { x: 1, z: 0 } });
    const approach = world.advance(12000);
    expect(countEvents(approach, 'swing')).toBeGreaterThan(0);
  });

  it('charges energy and starts a cooldown when a skill is used', () => {
    const world = newWorld(11);
    const player = levelPlayer(world, { level: 5 });
    const energyBefore = player.energy;
    world.submit(player.id, { t: 'target', id: theMob(world).id });
    world.submit(player.id, { t: 'useSkill', skillId: 'strike' });
    world.tick();
    expect(player.energy).toBeLessThan(energyBefore);
    expect(player.skillCooldowns?.strike).toBeGreaterThan(0);
  });

  it('refuses a skill that is on cooldown and reports why', () => {
    const world = newWorld(12);
    const player = levelPlayer(world, { level: 5 });
    world.submit(player.id, { t: 'target', id: theMob(world).id });
    world.submit(player.id, { t: 'useSkill', skillId: 'strike' });
    world.tick();
    world.advance(2000); // clear the GCD so cooldown is the only blocker
    world.submit(player.id, { t: 'useSkill', skillId: 'strike' });
    const events = world.tick();
    expect(events.some((e) => e.t === 'error' && e.message.includes('not ready'))).toBe(true);
  });

  it('blocks a second skill during the global cooldown', () => {
    const world = newWorld(15);
    const player = levelPlayer(world, { level: 10 });
    world.submit(player.id, { t: 'target', id: theMob(world).id });
    world.submit(player.id, { t: 'useSkill', skillId: 'strike' });
    world.tick();
    // Sunder is off cooldown, but the GCD from Strike must still block it.
    world.submit(player.id, { t: 'useSkill', skillId: 'sunder' });
    world.tick();
    expect(player.skillCooldowns?.sunder).toBeUndefined();
  });

  it('applies a damage-over-time effect that ticks on its own schedule', () => {
    const world = newWorld(13);
    const player = levelPlayer(world, { level: 5 });
    const mob = theMob(world);
    world.submit(player.id, { t: 'target', id: mob.id });
    world.submit(player.id, { t: 'useSkill', skillId: 'rend' });
    world.tick();
    expect(mob.effects.some((e) => e.sourceAbilityId === 'rend')).toBe(true);

    // Rend is 8s at 2s intervals; auto-attack is off, so all damage is the DoT.
    const events = world.advance(8000);
    const dotHits = events.filter((e) => e.t === 'damage' && e.abilityId === 'rend');
    expect(dotHits.length).toBe(4);
  });

  it('sometimes breaks a cast on an ordinary hit, and otherwise only delays it', () => {
    // Auto-attacks are a roll, not a certainty: over many attempts a caster
    // being chipped at should see both outcomes.
    let broken = 0;
    let landed = 0;
    let pushed = 0;
    for (let seed = 0; seed < 40; seed++) {
      const world = newWorld(seed * 977 + 3);
      const player = levelPlayer(world, { level: 6 });
      player.health = world.statsOf(player).maxHealth * 0.5;
      world.submit(player.id, { t: 'useSkill', skillId: 'rally' });

      const boar = theMob(world);
      for (let i = 0; i < 120; i++) {
        boar.health = world.statsOf(boar).maxHealth;
        for (const ev of world.tick()) {
          if (ev.t === 'castInterrupted' && ev.id === 'rally') broken++;
          if (ev.t === 'castComplete' && ev.id === 'rally') landed++;
          if (ev.t === 'castPushback') pushed++;
        }
        if (player.cast === null && (broken > 0 || landed > 0)) break;
      }
    }
    console.log(`  rally under fire: broken ${broken}, landed ${landed}, pushbacks ${pushed}`);
    expect(broken, 'ordinary hits never break a cast').toBeGreaterThan(0);
    expect(landed, 'ordinary hits always break a cast').toBeGreaterThan(0);
    expect(pushed, 'surviving a hit should still cost time').toBeGreaterThan(0);
  });

  it('makes a better-defended character much harder to interrupt', () => {
    // The whole point of tying this to defence: gear should make you steadier.
    const flimsy = castBreakChance(40, 20, 20);
    const armoured = castBreakChance(expectedDefense(20) * 2, 20, 20);
    expect(armoured).toBeLessThan(flimsy * 0.6);
    // And a mob far above your level rattles you more than an equal one.
    expect(castBreakChance(200, 20, 28)).toBeGreaterThan(castBreakChance(200, 20, 20));
  });

  it("always breaks a cast with a boss's heavy attack", () => {
    // A telegraphed slam is the moment you are meant to plan a cast around, so
    // it is never a roll.
    let slamsSeen = 0;
    let brokenBySlam = 0;
    for (let seed = 0; seed < 6; seed++) {
      const world = new World({ seed: seed * 131 + 5, zone: duelZone('old_scar'), classId: 'priest' });
      const player = levelPlayer(world, { level: 25, gear: ['bonecarved_stave', 'bearhide_cuirass'] });
      const boss = theMob(world);
      for (let i = 0; i < 1200; i++) {
        player.health = world.statsOf(player).maxHealth;
        boss.health = world.statsOf(boss).maxHealth;
        // Keep a heal rolling essentially continuously, or the 1.4s cast and a
        // slam every ~20s almost never overlap and the test proves nothing.
        player.skillCooldowns = {};
        player.gcdMs = 0;
        if (!player.cast) {
          player.health = world.statsOf(player).maxHealth * 0.5;
          world.submit(player.id, { t: 'useSkill', skillId: 'mend_wounds' });
        }
        // Capture this BEFORE the tick: a slam that breaks the cast leaves
        // player.cast null afterwards, which read as 'there was no cast'.
        const wasCasting = player.cast !== null;
        const events = world.tick();
        // Resolve the ability rather than pattern-matching its id — bosses name
        // their slams differently and a name filter silently matched nothing.
        const heavy = getMob(boss.defId!).abilities?.filter((a) => a.kind === 'heavySlam') ?? [];
        const slamAt = events.findIndex(
          (e) =>
            e.t === 'damage' &&
            e.targetId === player.id &&
            e.abilityId !== null &&
            heavy.some((a) => a.id === e.abilityId),
        );
        // A cast that FINISHED earlier in this same tick is not a cast the slam
        // could break — counting those made one landed-on-a-caster slam look
        // like the rule had failed.
        const finishedFirst = events
          .slice(0, slamAt < 0 ? 0 : slamAt)
          .some((e) => e.t === 'castComplete' && e.sourceId === player.id);
        if (slamAt >= 0 && wasCasting && !finishedFirst) {
          slamsSeen++;
          if (
            events.some(
              (e) => e.t === 'castInterrupted' && e.kind === 'skill' && e.sourceId === player.id,
            )
          ) {
            brokenBySlam++;
          }
        }
      }
    }
    console.log(`  heavy attacks landed on a caster: ${slamsSeen}, casts broken: ${brokenBySlam}`);
    expect(slamsSeen, 'no heavy attack ever landed while casting').toBeGreaterThan(0);
    expect(brokenBySlam).toBe(slamsSeen);
  });

  it('never breaks a cast with a damage-over-time tick', () => {
    // Otherwise nothing could ever cast while bleeding, which is most of a fight.
    const world = new World({ seed: 21, zone: emptyZone(), classId: 'warrior' });
    const player = levelPlayer(world, { level: 10 });
    player.health = world.statsOf(player).maxHealth * 0.5;
    player.effects = [
      {
        id: 'test-bleed',
        kind: 'dot',
        sourceId: player.id,
        sourceAbilityId: 'rend',
        remainingMs: 8000,
        tickMs: 200,
        sinceTickMs: 0,
        damageType: 'physical',
        dotPower: 3,
      },
    ];
    world.submit(player.id, { t: 'useSkill', skillId: 'rally' });
    const events = world.advance(4000);
    expect(events.some((e) => e.t === 'damage' && e.abilityId === 'rend')).toBe(true);
    expect(events.some((e) => e.t === 'castInterrupted')).toBe(false);
    expect(events.some((e) => e.t === 'castComplete' && e.id === 'rally')).toBe(true);
  });

  it('still cancels a cast outright when the caster moves', () => {
    const world = new World({ seed: 14, zone: emptyZone(), classId: 'warrior' });
    const player = levelPlayer(world, { level: 6 });
    world.submit(player.id, { t: 'useSkill', skillId: 'rally' });
    world.tick();
    expect(player.cast).not.toBeNull();

    world.submit(player.id, { t: 'move', dir: { x: 1, z: 0 } });
    const events = world.tick();
    expect(events.some((e) => e.t === 'castInterrupted' && e.id === 'rally')).toBe(true);
    expect(player.cast).toBeNull();
  });
});

describe('threat and AI', () => {
  it('aggros when the player walks into range', () => {
    const world = new World({ seed: 5, zone: duelZone('mossback_boar', 25), classId: 'warrior' });
    levelPlayer(world, { level: 5 });
    world.submit(world.playerId, { t: 'move', dir: { x: 1, z: 0 } });
    const events = world.advance(8000);
    expect(events.some((e) => e.t === 'aggro')).toBe(true);
  });

  it('leashes home and heals when dragged past its leash radius', () => {
    const world = newWorld(6);
    const player = levelPlayer(world, { level: 5 });
    const mob = theMob(world);

    world.submit(player.id, { t: 'target', id: mob.id });
    world.submit(player.id, { t: 'autoAttack', on: true });
    world.advance(2000);
    expect(mob.health).toBeLessThan(world.statsOf(mob).maxHealth);

    // Run away far enough to break the leash.
    world.submit(player.id, { t: 'autoAttack', on: false });
    world.submit(player.id, { t: 'move', dir: { x: -1, z: 0 } });
    const events = world.advance(20000);
    expect(events.some((e) => e.t === 'leash')).toBe(true);

    world.advance(20000);
    expect(mob.aiState).toBe('idle');
    expect(mob.health).toBe(world.statsOf(mob).maxHealth);
  });

  it('respawns a mob after its timer elapses', () => {
    const world = newWorld(8);
    levelPlayer(world, { level: 8, gear: ['ironbark_cudgel'] });
    const mob = theMob(world);
    simulateFight(world);
    expect(mob.dead).toBe(true);

    // Stop attacking, or the player just kills it again the moment it returns.
    world.submit(world.playerId, { t: 'autoAttack', on: false });
    world.submit(world.playerId, { t: 'target', id: null });
    const events = world.advance(21000);
    expect(events.some((e) => e.t === 'spawn' && e.entityId === mob.id)).toBe(true);
    expect(mob.dead).toBe(false);
    expect(mob.health).toBe(world.statsOf(mob).maxHealth);
  });
});

// --------------------------------------------------------------------------
// Boss abilities. These exist to give boss fights outcome variance — the whole
// point is that what the player does changes the result.
// --------------------------------------------------------------------------

describe('boss abilities', () => {
  it('telegraphs a heavy slam with a radius before it lands', () => {
    const world = newWorld(41, duelZone('old_scar'));
    levelPlayer(world, { level: 25, gear: ['scarred_fang', 'bearhide_cuirass'] });
    world.submit(world.playerId, { t: 'target', id: theMob(world).id });
    world.submit(world.playerId, { t: 'autoAttack', on: true });

    const events = world.advance(20000);
    const telegraph = events.find((e) => e.t === 'telegraph');
    expect(telegraph).toBeDefined();
    if (telegraph?.t === 'telegraph') {
      expect(telegraph.radius).toBeGreaterThan(0);
      expect(telegraph.durationMs).toBeGreaterThan(0);
      expect(telegraph.text.length).toBeGreaterThan(0);
      // The telegraph must precede the damage, or it is not a warning.
      const tIdx = events.indexOf(telegraph);
      const hit = events.findIndex(
        (e, i) => i > tIdx && e.t === 'damage' && e.abilityId === telegraph.abilityId,
      );
      expect(hit === -1 || hit > tIdx).toBe(true);
    }
  });

  it('roots the caster while it winds up, so the danger circle stays put', () => {
    const world = newWorld(42, duelZone('old_scar'));
    levelPlayer(world, { level: 25, gear: ['scarred_fang'] });
    const boss = theMob(world);
    world.submit(world.playerId, { t: 'target', id: boss.id });
    world.submit(world.playerId, { t: 'autoAttack', on: true });

    // Advance until the boss starts casting, then check it cannot move.
    let casting = false;
    for (let i = 0; i < 600 && !casting; i++) {
      world.tick();
      casting = boss.cast !== null && boss.cast !== undefined;
    }
    expect(casting).toBe(true);

    const before = { ...boss.pos };
    // Run away: a rooted caster must not follow.
    world.submit(world.playerId, { t: 'move', dir: { x: -1, z: 0 } });
    world.advance(600);
    expect(boss.pos.x).toBeCloseTo(before.x, 5);
    expect(boss.pos.z).toBeCloseTo(before.z, 5);
  });

  it('lets a player who leaves the radius dodge the slam entirely', () => {
    const world = newWorld(43, duelZone('old_scar'));
    levelPlayer(world, { level: 25, gear: ['scarred_fang', 'bearhide_cuirass'] });
    const result = simulateFight(world, {
      skills: ['strike', 'sunder', 'onslaught'],
      dodge: true,
      timeoutSec: 120,
    });
    expect(result.slamsDodged).toBeGreaterThan(0);
  });

  it('hits a player who stands in it', () => {
    const world = newWorld(43, duelZone('old_scar'));
    levelPlayer(world, { level: 25, gear: ['scarred_fang', 'bearhide_cuirass'] });
    const result = simulateFight(world, {
      skills: ['strike', 'sunder', 'onslaught'],
      dodge: false,
      timeoutSec: 120,
    });
    expect(result.slamsDodged).toBe(0);
    expect(result.slamsTaken).toBeGreaterThan(0);
  });

  it('enrages once below the health threshold, not repeatedly', () => {
    const world = newWorld(44, duelZone('old_scar'));
    levelPlayer(world, { level: 25, gear: ['scarred_fang'] });
    const boss = theMob(world);
    world.submit(world.playerId, { t: 'target', id: boss.id });
    world.submit(world.playerId, { t: 'autoAttack', on: true });

    // Drop it straight under the 35% threshold, then hold it there so the fight
    // cannot end before we have seen whether it re-fires.
    boss.health = world.statsOf(boss).maxHealth * 0.3;
    const events: SimEvent[] = [];
    let sawBuff = false;
    for (let i = 0; i < 600; i++) {
      boss.health = Math.min(boss.health, world.statsOf(boss).maxHealth * 0.3);
      events.push(...world.tick());
      if (boss.effects.some((e) => e.damageMultiplier !== undefined)) sawBuff = true;
    }
    expect(countEvents(events, 'enraged')).toBe(1);
    expect(sawBuff).toBe(true);
  });

  it('summons adds that despawn when the boss resets', () => {
    const world = newWorld(45, duelZone('cadfael'));
    const player = levelPlayer(world, { level: 25, gear: ['scarred_fang', 'bearhide_cuirass'] });
    const boss = theMob(world);
    world.submit(player.id, { t: 'target', id: boss.id });
    world.submit(player.id, { t: 'autoAttack', on: true });

    // Keep it alive so the summon cooldown has time to come up.
    let summoned = false;
    for (let i = 0; i < 2000 && !summoned; i++) {
      boss.health = world.statsOf(boss).maxHealth;
      summoned = world.tick().some((e) => e.t === 'summoned');
    }
    expect(summoned).toBe(true);

    const adds = [...world.entities.values()].filter((e) => e.summonedBy === boss.id);
    expect(adds.length).toBeGreaterThan(0);

    // Drag the boss out of its leash; the adds should go with it.
    world.submit(player.id, { t: 'autoAttack', on: false });
    world.submit(player.id, { t: 'target', id: null });
    world.submit(player.id, { t: 'move', dir: { x: 1, z: 0 } });
    world.advance(30000);
    expect([...world.entities.values()].filter((e) => e.summonedBy === boss.id).length).toBe(0);
  });

  it('gives adds no loot, so a summoning boss is not a loot faucet', () => {
    const world = newWorld(46, duelZone('cadfael'));
    const player = levelPlayer(world, { level: 25, gear: ['scarred_fang', 'bearhide_cuirass'] });
    const boss = theMob(world);
    world.submit(player.id, { t: 'target', id: boss.id });
    world.submit(player.id, { t: 'autoAttack', on: true });

    let summoned = false;
    for (let i = 0; i < 2000 && !summoned; i++) {
      boss.health = world.statsOf(boss).maxHealth;
      summoned = world.tick().some((e) => e.t === 'summoned');
    }
    const add = [...world.entities.values()].find((e) => e.summonedBy === boss.id);
    expect(add).toBeDefined();

    add!.health = 1;
    world.submit(player.id, { t: 'target', id: add!.id });
    world.advance(6000);
    expect(add!.corpseLoot?.length ?? 0).toBe(0);
    expect(add!.corpseGold ?? 0).toBe(0);
  });

  it('gives ordinary mobs no abilities at all', () => {
    const world = newWorld(47, duelZone('bog_wolf'));
    levelPlayer(world, { level: 10, gear: ['ironbark_cudgel'] });
    const wolf = theMob(world);
    world.submit(world.playerId, { t: 'target', id: wolf.id });
    // Keep it alive so we would notice an ability if one existed.
    const events: SimEvent[] = [];
    for (let i = 0; i < 800; i++) {
      wolf.health = world.statsOf(wolf).maxHealth;
      events.push(...world.tick());
    }
    expect(countEvents(events, 'telegraph')).toBe(0);
    expect(countEvents(events, 'enraged')).toBe(0);
  });
});

describe('progression', () => {
  it('awards xp and levels up, granting points and unlocking skills', () => {
    const world = newWorld(9);
    const player = levelPlayer(world, { level: 1, gear: ['bronze_shortsword'] });
    player.xp = xpToNext(1) - 1;

    const events: SimEvent[] = [];
    world.submit(player.id, { t: 'target', id: theMob(world).id });
    world.submit(player.id, { t: 'autoAttack', on: true });
    for (let i = 0; i < 3000 && player.level < 2; i++) events.push(...world.tick());

    expect(player.level).toBe(2);
    expect(player.unspentPoints).toBe(3);
    expect(events.some((e) => e.t === 'skillUnlocked' && e.skillId === 'rend')).toBe(true);
  });

  it('gives almost no xp for a mob far below the player', () => {
    const world = newWorld(10);
    const player = levelPlayer(world, { level: 20, gear: ['boar_spear'] });
    const events: SimEvent[] = [];
    world.submit(player.id, { t: 'target', id: theMob(world).id });
    world.submit(player.id, { t: 'autoAttack', on: true });
    for (let i = 0; i < 600; i++) events.push(...world.tick());

    const xp = events.find((e) => e.t === 'xpGained');
    expect(xp).toBeDefined();
    expect(xp?.t === 'xpGained' ? xp.amount : Infinity).toBeLessThan(5);
  });

  it('stops awarding xp at the level cap', () => {
    const world = newWorld(48, duelZone('marsh_bear'));
    const player = levelPlayer(world, { level: MAX_LEVEL, gear: ['scarred_fang'] });
    world.submit(player.id, { t: 'target', id: theMob(world).id });
    world.submit(player.id, { t: 'autoAttack', on: true });
    const events = world.advance(60000);
    expect(events.some((e) => e.t === 'death')).toBe(true);
    expect(countEvents(events, 'xpGained')).toBe(0);
    expect(player.level).toBe(MAX_LEVEL);
  });

  it('spends attribute points and the derived stats change', () => {
    const world = new World({ seed: 2, zone: emptyZone(), classId: 'warrior' });
    const player = world.player;
    player.unspentPoints = 5;
    const before = world.statsOf(player).maxHealth;
    for (let i = 0; i < 5; i++) world.submit(player.id, { t: 'spendPoint', attr: 'vitality' });
    world.tick();
    expect(player.unspentPoints).toBe(0);
    expect(world.statsOf(player).maxHealth).toBeGreaterThan(before);
  });
});

describe('loot and inventory', () => {
  it('generates corpse loot and transfers it on loot', () => {
    const world = newWorld(21);
    const player = levelPlayer(world, { level: 8, gear: ['ironbark_cudgel'] });
    const mob = theMob(world);
    simulateFight(world);

    const hadLoot = (mob.corpseLoot?.length ?? 0) > 0 || (mob.corpseGold ?? 0) > 0;
    expect(hadLoot).toBe(true);

    world.submit(player.id, { t: 'loot', id: mob.id });
    const events = world.tick();
    expect(events.some((e) => e.t === 'lootGained')).toBe(true);
    expect(mob.corpseLoot?.length).toBe(0);
    expect((player.inventory?.length ?? 0) + (player.gold ?? 0)).toBeGreaterThan(0);
  });

  it('refuses to loot a corpse that is out of range', () => {
    const world = newWorld(22);
    const player = levelPlayer(world, { level: 8, gear: ['ironbark_cudgel'] });
    const mob = theMob(world);
    simulateFight(world);

    player.pos = { x: 40, z: 40 };
    world.submit(player.id, { t: 'loot', id: mob.id });
    const events = world.tick();
    expect(events.some((e) => e.t === 'error' && e.message.includes('Too far'))).toBe(true);
  });

  it('swaps equipment and returns the old item to the bags', () => {
    const world = new World({ seed: 2, zone: emptyZone(), classId: 'warrior' });
    const player = world.player;
    expect(player.equipment?.weapon).toBe('rusted_blade');

    world.addItem(player, { itemId: 'ironbark_cudgel', qty: 1 });
    world.submit(player.id, { t: 'equip', itemId: 'ironbark_cudgel' });
    world.tick();

    expect(player.equipment?.weapon).toBe('ironbark_cudgel');
    expect(player.inventory?.some((s) => s.itemId === 'rusted_blade')).toBe(true);
    expect(world.statsOf(player).damageMin).toBe(11);
  });

  it('stacks stackable items and keeps gear unstacked', () => {
    const world = new World({ seed: 2, zone: emptyZone(), classId: 'warrior' });
    const player = world.player;
    world.addItem(player, { itemId: 'wolf_pelt', qty: 2 });
    world.addItem(player, { itemId: 'wolf_pelt', qty: 3 });
    world.addItem(player, { itemId: 'bronze_shortsword', qty: 1 });
    world.addItem(player, { itemId: 'bronze_shortsword', qty: 1 });

    expect(player.inventory?.find((s) => s.itemId === 'wolf_pelt')?.qty).toBe(5);
    expect(player.inventory?.filter((s) => s.itemId === 'bronze_shortsword').length).toBe(2);
  });
});

describe('death', () => {
  it('kills the player against a far higher level boss and allows respawn', () => {
    const world = newWorld(31, duelZone('old_scar'));
    const player = levelPlayer(world, { level: 5 });
    const result = simulateFight(world);
    expect(result.playerWon).toBe(false);
    expect(player.dead).toBe(true);

    world.submit(player.id, { t: 'respawn' });
    world.tick();
    expect(player.dead).toBe(false);
    expect(player.pos).toEqual(world.zone.playerStart);
    expect(player.health).toBeGreaterThan(0);
  });

  it('sends attackers home when the player dies', () => {
    const world = newWorld(32, duelZone('old_scar'));
    levelPlayer(world, { level: 5 });
    const mob = theMob(world);
    simulateFight(world);
    // The contract is "stops hunting the corpse". Whether it is still walking
    // home or already back on its spawn depends on how far it was dragged.
    expect(mob.targetId).toBeNull();
    expect(['returning', 'idle']).toContain(mob.aiState);
    expect(Object.keys(mob.threat ?? {})).toHaveLength(0);
  });

  it('ignores commands from a dead player except respawn', () => {
    const world = newWorld(33, duelZone('old_scar'));
    const player = levelPlayer(world, { level: 5 });
    simulateFight(world);
    expect(player.dead).toBe(true);

    world.submit(player.id, { t: 'move', dir: { x: 1, z: 0 } });
    const posBefore = { ...player.pos };
    world.advance(1000);
    expect(player.pos).toEqual(posBefore);
  });
});

describe('save and load', () => {
  it('round-trips world state and keeps simulating identically', () => {
    const world = new World({ seed: 99, zone: FENMARCH, classId: 'warrior' });
    levelPlayer(world, { level: 7, gear: ['ironbark_cudgel', 'studded_jerkin'] });
    world.submit(world.playerId, { t: 'move', dir: { x: 0, z: -1 } });
    world.advance(4000);

    const json = world.serialize();
    const restored = World.deserialize(json, FENMARCH);

    expect(restored.player.level).toBe(world.player.level);
    expect(restored.player.pos).toEqual(world.player.pos);
    expect(restored.player.equipment).toEqual(world.player.equipment);
    expect(restored.entities.size).toBe(world.entities.size);

    // Same state + same seed + same commands must produce the same future.
    const a = JSON.stringify(world.advance(3000));
    const b = JSON.stringify(restored.advance(3000));
    expect(a).toBe(b);
  });

  it('rejects a save from an older format rather than loading it wrong', () => {
    const world = new World({ seed: 1, zone: FENMARCH, classId: 'warrior' });
    const stale = JSON.parse(world.serialize()) as { version: number };
    stale.version = 1;
    expect(() => World.deserialize(JSON.stringify(stale), FENMARCH)).toThrow(/version/i);
  });
});

describe('tick contract', () => {
  it('advances exactly TICK_MS of game time per tick', () => {
    const world = new World({ seed: 2, zone: emptyZone(), classId: 'warrior' });
    const player = world.player;
    player.skillCooldowns = { strike: 1000 };
    world.advance(1000 - TICK_MS);
    expect(player.skillCooldowns.strike).toBeCloseTo(TICK_MS, 5);
    world.tick();
    expect(player.skillCooldowns.strike).toBeUndefined();
  });
});

// --------------------------------------------------------------------------
// Interrupts. The counterpart to dodging: heavy AoEs are answered by moving,
// heals and summons are answered by cutting the cast short.
// --------------------------------------------------------------------------

describe('interrupts', () => {
  function bossFight(seed: number, mobId: string, classId: 'warrior' | 'priest') {
    const world = new World({ seed, zone: duelZone(mobId), classId });
    const player = levelPlayer(world, {
      level: 25,
      gear: classId === 'warrior' ? ['scarred_fang'] : ['bonecarved_stave'],
    });
    const boss = theMob(world);
    world.submit(player.id, { t: 'target', id: boss.id });
    world.submit(player.id, { t: 'autoAttack', on: true });
    return { world, player, boss };
  }

  /** Hold the boss alive until it starts the named interruptible cast. */
  function runUntilCasting(world: World, boss: Entity, abilityId: string): boolean {
    for (let i = 0; i < 3000; i++) {
      boss.health = world.statsOf(boss).maxHealth * 0.5;
      world.tick();
      if (boss.cast?.kind === 'ability' && boss.cast.id === abilityId) return true;
    }
    return false;
  }

  it('stops an interruptible cast and locks the ability out', () => {
    const { world, player, boss } = bossFight(61, 'cadfael', 'priest');
    expect(runUntilCasting(world, boss, 'bind_wounds')).toBe(true);

    world.submit(player.id, { t: 'useSkill', skillId: 'rebuke' });
    const events = world.tick();

    const hit = events.find((e) => e.t === 'interrupted');
    expect(hit).toBeDefined();
    if (hit?.t === 'interrupted') {
      expect(hit.abilityId).toBe('bind_wounds');
      expect(hit.lockoutMs).toBe(9000);
    }
    expect(boss.cast).toBeNull();
    expect(boss.abilityLockouts?.bind_wounds).toBeGreaterThan(0);
  });

  it('prevents the heal from landing at all', () => {
    const { world, player, boss } = bossFight(62, 'cadfael', 'priest');
    expect(runUntilCasting(world, boss, 'bind_wounds')).toBe(true);

    boss.health = world.statsOf(boss).maxHealth * 0.4;
    world.submit(player.id, { t: 'useSkill', skillId: 'rebuke' });
    const healthAfterInterrupt = boss.health;
    const events = world.advance(2000);
    const healed = events.filter((e) => e.t === 'heal' && e.targetId === boss.id);
    expect(healed).toHaveLength(0);
    expect(boss.health).toBeLessThanOrEqual(healthAfterInterrupt);
  });

  it('keeps the ability unusable for the whole lockout', () => {
    const { world, player, boss } = bossFight(63, 'cadfael', 'priest');
    expect(runUntilCasting(world, boss, 'bind_wounds')).toBe(true);
    world.submit(player.id, { t: 'useSkill', skillId: 'rebuke' });
    world.tick();

    // Clear the normal cooldown so only the lockout can be holding it back.
    delete boss.abilityCooldowns?.bind_wounds;
    const events: SimEvent[] = [];
    for (let i = 0; i < 150; i++) {
      boss.health = world.statsOf(boss).maxHealth * 0.5;
      events.push(...world.tick());
    }
    const recast = events.some((e) => e.t === 'castBegin' && e.id === 'bind_wounds');
    expect(recast).toBe(false);
  });

  it('cannot interrupt an ability flagged uninterruptible — dodge that instead', () => {
    const { world, player, boss } = bossFight(64, 'old_scar', 'priest');
    let casting = false;
    for (let i = 0; i < 3000 && !casting; i++) {
      boss.health = world.statsOf(boss).maxHealth;
      world.tick();
      casting = boss.cast?.kind === 'ability' && boss.cast.id === 'ground_shake';
    }
    expect(casting).toBe(true);

    world.submit(player.id, { t: 'useSkill', skillId: 'rebuke' });
    const events = world.tick();
    expect(events.some((e) => e.t === 'interruptWasted')).toBe(true);
    expect(boss.cast).not.toBeNull();
  });

  it('reports a wasted interrupt when the target is not casting', () => {
    const { world, player } = bossFight(65, 'cadfael', 'priest');
    world.submit(player.id, { t: 'useSkill', skillId: 'rebuke' });
    const events = world.tick();
    expect(events.some((e) => e.t === 'interruptWasted')).toBe(true);
    // It still costs the cooldown, so mashing it is a real mistake.
    expect(world.player.skillCooldowns?.rebuke).toBeGreaterThan(0);
  });

  it('gives the Warrior an interrupt too', () => {
    const { world, player, boss } = bossFight(66, 'cadfael', 'warrior');
    expect(runUntilCasting(world, boss, 'bind_wounds')).toBe(true);
    world.submit(player.id, { t: 'useSkill', skillId: 'bash' });
    const events = world.tick();
    const hit = events.find((e) => e.t === 'interrupted');
    expect(hit).toBeDefined();
    // Warrior's lockout is shorter than the Priest's — interrupting is the
    // Priest's speciality, not a tool both classes hold equally.
    if (hit?.t === 'interrupted') expect(hit.lockoutMs).toBe(6000);
    expect(boss.abilityLockouts?.bind_wounds).toBeGreaterThan(5000);
  });
});

describe('classes', () => {
  it('scales the Priest off Focus and the Warrior off Strength', () => {
    const priest = new World({ seed: 1, zone: emptyZone(), classId: 'priest' });
    const warrior = new World({ seed: 1, zone: emptyZone(), classId: 'warrior' });

    const priestBefore = priest.statsOf(priest.player).attack;
    priest.player.attributes!.focus += 10;
    expect(priest.statsOf(priest.player).attack).toBe(priestBefore + 20);
    priest.player.attributes!.strength += 10;
    expect(priest.statsOf(priest.player).attack).toBe(priestBefore + 20);

    const warriorBefore = warrior.statsOf(warrior.player).attack;
    warrior.player.attributes!.strength += 10;
    expect(warrior.statsOf(warrior.player).attack).toBe(warriorBefore + 20);
  });

  it('refuses to equip a weapon from another class', () => {
    const world = new World({ seed: 1, zone: emptyZone(), classId: 'priest' });
    const player = world.player;
    world.addItem(player, { itemId: 'scarred_fang', qty: 1 });
    world.submit(player.id, { t: 'equip', itemId: 'scarred_fang' });
    const events = world.tick();

    expect(events.some((e) => e.t === 'error' && /cannot be used/i.test(e.message))).toBe(true);
    expect(player.equipment?.weapon).toBe('oaken_walking_staff');
    // And the item stays in the bag rather than vanishing.
    expect(player.inventory?.some((s) => s.itemId === 'scarred_fang')).toBe(true);
  });

  it('lets either class wear the same armour', () => {
    for (const classId of ['warrior', 'priest'] as const) {
      const world = new World({ seed: 1, zone: emptyZone(), classId });
      const player = world.player;
      world.addItem(player, { itemId: 'bearhide_cuirass', qty: 1 });
      world.submit(player.id, { t: 'equip', itemId: 'bearhide_cuirass' });
      world.tick();
      expect(player.equipment?.chest).toBe('bearhide_cuirass');
    }
  });

  it('gives each class its own skill bar', () => {
    const warriorKit = skillBarFor('warrior').map((s) => s.id);
    const priestKit = skillBarFor('priest').map((s) => s.id);
    expect(warriorKit).toContain('bash');
    expect(priestKit).toContain('rebuke');
    expect(warriorKit.some((id) => priestKit.includes(id))).toBe(false);
    // Both must have an interrupt, or one class simply cannot answer a heal.
    for (const kit of [warriorKit, priestKit]) {
      expect(kit.some((id) => getSkill(id).kind === 'interrupt')).toBe(true);
    }
  });
});

describe('boss class weapons', () => {
  for (const [classId, mobId, expected] of [
    ['warrior', 'old_scar', 'scarred_fang'],
    ['priest', 'old_scar', 'bonecarved_stave'],
    ['warrior', 'cadfael', 'cadfaels_cleaver'],
    ['priest', 'cadfael', 'chieftains_reliquary'],
  ] as const) {
    it(`drops ${expected} for a ${classId} killing ${mobId}`, () => {
      const world = new World({ seed: 71, zone: duelZone(mobId, 2), classId });
      const player = levelPlayer(world, { level: 25 });
      const boss = theMob(world);
      world.submit(player.id, { t: 'target', id: boss.id });
      world.submit(player.id, { t: 'autoAttack', on: true });
      boss.health = 1;
      world.advance(4000);

      expect(boss.dead).toBe(true);
      expect(boss.corpseLoot?.some((s) => s.itemId === expected)).toBe(true);
      // And it must actually be equippable by the class that earned it.
      const drop = getItem(expected);
      expect(canEquip(drop, classId)).toBe(true);
    });
  }
});

// --------------------------------------------------------------------------
// Vendors. The counterparty that turns gold and merchant goods into decisions.
// --------------------------------------------------------------------------

describe('vendors', () => {
  function shop(seed = 91, distance = 2) {
    const world = new World({ seed, zone: vendorZone('maeve', distance), classId: 'warrior' });
    const vendor = [...world.entities.values()].find((e) => e.kind === 'vendor')!;
    return { world, player: world.player, vendor };
  }

  it('buys merchant goods at their full listed value', () => {
    const { world, player, vendor } = shop();
    world.addItem(player, { itemId: 'bear_claw', qty: 3 });
    player.gold = 0;

    world.submit(player.id, { t: 'sell', vendorId: vendor.id, itemId: 'bear_claw', qty: 3 });
    const events = world.tick();

    const sold = events.find((e) => e.t === 'sold');
    expect(sold).toBeDefined();
    expect(player.gold).toBe(getItem('bear_claw').value * 3);
    expect(player.inventory?.some((s) => s.itemId === 'bear_claw')).toBe(false);
  });

  it('pays only a fraction for equipment', () => {
    const { world, player, vendor } = shop();
    world.addItem(player, { itemId: 'outlaw_mail', qty: 1 });
    player.gold = 0;
    world.submit(player.id, { t: 'sell', vendorId: vendor.id, itemId: 'outlaw_mail', qty: 1 });
    world.tick();
    expect(player.gold).toBe(sellPrice(getItem('outlaw_mail')));
    expect(player.gold).toBeLessThan(getItem('outlaw_mail').value / 2);
  });

  it('sells only what the player actually holds', () => {
    const { world, player, vendor } = shop();
    world.addItem(player, { itemId: 'wolf_pelt', qty: 2 });
    player.gold = 0;
    world.submit(player.id, { t: 'sell', vendorId: vendor.id, itemId: 'wolf_pelt', qty: 99 });
    world.tick();
    expect(player.gold).toBe(getItem('wolf_pelt').value * 2);
  });

  it('sells stock for gold', () => {
    const { world, player, vendor } = shop();
    const price = buyPrice(getItem('bronze_shortsword'));
    player.gold = price + 10;

    world.submit(player.id, { t: 'buy', vendorId: vendor.id, itemId: 'bronze_shortsword' });
    const events = world.tick();

    expect(events.some((e) => e.t === 'bought')).toBe(true);
    expect(player.gold).toBe(10);
    expect(player.inventory?.some((s) => s.itemId === 'bronze_shortsword')).toBe(true);
  });

  it('refuses a purchase the player cannot afford', () => {
    const { world, player, vendor } = shop();
    player.gold = 1;
    world.submit(player.id, { t: 'buy', vendorId: vendor.id, itemId: 'bronze_shortsword' });
    const events = world.tick();
    expect(events.some((e) => e.t === 'error' && /afford/i.test(e.message))).toBe(true);
    expect(player.gold).toBe(1);
    expect(player.inventory?.length ?? 0).toBe(0);
  });

  it('refuses to sell something it does not stock', () => {
    const { world, player, vendor } = shop();
    player.gold = 999999;
    world.submit(player.id, { t: 'buy', vendorId: vendor.id, itemId: 'scarred_fang' });
    const events = world.tick();
    expect(events.some((e) => e.t === 'error' && /not for sale/i.test(e.message))).toBe(true);
    expect(player.gold).toBe(999999);
  });

  it('refuses to trade from across the zone', () => {
    const { world, player, vendor } = shop(92, 40);
    world.addItem(player, { itemId: 'bear_claw', qty: 1 });
    player.gold = 999999;

    world.submit(player.id, { t: 'sell', vendorId: vendor.id, itemId: 'bear_claw', qty: 1 });
    world.submit(player.id, { t: 'buy', vendorId: vendor.id, itemId: 'bronze_shortsword' });
    const events = world.tick();

    expect(events.filter((e) => e.t === 'error' && /too far/i.test(e.message))).toHaveLength(2);
    expect(player.inventory?.some((s) => s.itemId === 'bear_claw')).toBe(true);
    expect(player.gold).toBe(999999);
  });

  it('cannot be attacked', () => {
    const { world, player, vendor } = shop();
    world.submit(player.id, { t: 'target', id: vendor.id });
    world.submit(player.id, { t: 'autoAttack', on: true });
    const events = world.advance(8000);

    expect(events.some((e) => e.t === 'damage' && e.targetId === vendor.id)).toBe(false);
    expect(vendor.dead).toBe(false);
  });

  it('survives a save/load round trip', () => {
    const { world, player, vendor } = shop();
    world.addItem(player, { itemId: 'bear_claw', qty: 1 });
    const restored = World.deserialize(world.serialize(), world.zone);
    const restoredVendor = restored.entity(vendor.id);
    expect(restoredVendor?.kind).toBe('vendor');
    expect(restoredVendor?.vendorId).toBe('maeve');

    restored.submit(restored.playerId, {
      t: 'sell',
      vendorId: vendor.id,
      itemId: 'bear_claw',
      qty: 1,
    });
    expect(restored.tick().some((e) => e.t === 'sold')).toBe(true);
  });
});

// --------------------------------------------------------------------------
// Quests and travel: the systems that turn four fields of camps into a route.
// --------------------------------------------------------------------------

describe('quests', () => {
  function questWorld(seed = 201) {
    const world = new World({ seed, zone: getZone('fenmarch'), classId: 'warrior' });
    const player = world.player;
    // Stand next to Maeve so turn-ins are in reach.
    const maeve = [...world.entities.values()].find(
      (e) => e.kind === 'vendor' && e.vendorId === 'maeve',
    )!;
    player.pos = { x: maeve.pos.x + 1, z: maeve.pos.z };
    return { world, player, maeve };
  }

  it('offers the first quest of a chain and nothing further', () => {
    const { world, player } = questWorld();
    const offered = world.questsOfferedBy(player, 'maeve').map((q) => q.id);
    expect(offered).toContain('fen_01');
    // fen_02 requires fen_01, so it must not be on the board yet.
    expect(offered).not.toContain('fen_02');
  });

  it('tracks kills and reports the quest ready', () => {
    const { world, player, maeve } = questWorld();
    world.submit(player.id, { t: 'acceptQuest', vendorId: maeve.id, questId: 'fen_01' });
    world.tick();
    expect(player.quests?.[0]?.questId).toBe('fen_01');

    // Kill the eight hares the quest asks for.
    const hares = [...world.entities.values()].filter((e) => e.defId === 'moor_hare').slice(0, 8);
    const events: SimEvent[] = [];
    for (const hare of hares) {
      hare.health = 1;
      world.submit(player.id, { t: 'target', id: hare.id });
      world.submit(player.id, { t: 'autoAttack', on: true });
      player.pos = { x: hare.pos.x + 1, z: hare.pos.z };
      // Swing until it actually dies rather than for a fixed few seconds. A
      // level-1 character misses, and a fixed window made this test pass or
      // fail on where the seed happened to leave the hit rolls.
      for (let i = 0; i < 400 && !hare.dead; i++) events.push(...world.tick());
    }

    expect(events.some((e) => e.t === 'questProgress' && e.questId === 'fen_01')).toBe(true);
    expect(events.some((e) => e.t === 'questReady' && e.questId === 'fen_01')).toBe(true);
    expect(world.isQuestComplete(player, 'fen_01')).toBe(true);
  });

  it('pays out on turn-in and unlocks the next link in the chain', () => {
    const { world, player, maeve } = questWorld();
    player.level = 5; // fen_02 also gates on level, which is not what this tests
    world.submit(player.id, { t: 'acceptQuest', vendorId: maeve.id, questId: 'fen_01' });
    world.tick();
    // Complete it directly; the kill path is covered above.
    player.quests![0]!.counts = [8];

    const goldBefore = player.gold ?? 0;
    world.submit(player.id, { t: 'turnInQuest', vendorId: maeve.id, questId: 'fen_01' });
    const events = world.tick();

    const done = events.find((e) => e.t === 'questCompleted');
    expect(done).toBeDefined();
    expect(player.gold).toBe(goldBefore + getQuest('fen_01').rewards.gold);
    expect(player.questsDone).toContain('fen_01');
    expect(player.quests).toHaveLength(0);
    expect(events.some((e) => e.t === 'xpGained')).toBe(true);
    // The next step is now on the board, and the finished one is not repeatable.
    const offered = world.questsOfferedBy(player, 'maeve').map((q) => q.id);
    expect(offered).toContain('fen_02');
    expect(offered).not.toContain('fen_01');
  });

  it('refuses to turn in unfinished work', () => {
    const { world, player, maeve } = questWorld();
    world.submit(player.id, { t: 'acceptQuest', vendorId: maeve.id, questId: 'fen_01' });
    world.tick();
    world.submit(player.id, { t: 'turnInQuest', vendorId: maeve.id, questId: 'fen_01' });
    const events = world.tick();
    expect(events.some((e) => e.t === 'error' && /not finished/i.test(e.message))).toBe(true);
    expect(player.questsDone ?? []).toHaveLength(0);
  });

  it('counts items already in the bags toward a collection step', () => {
    const { world, player, maeve } = questWorld();
    // Boar tusks gathered before anyone asked for them.
    world.addItem(player, { itemId: 'boar_tusk', qty: 4 });
    player.questsDone = ['fen_01'];
    player.level = 5;

    world.submit(player.id, { t: 'acceptQuest', vendorId: maeve.id, questId: 'fen_02' });
    world.tick();

    const progress = player.quests?.find((q) => q.questId === 'fen_02');
    // Objective 1 is the collect step; it should already be satisfied.
    expect(progress?.counts[1]).toBe(4);
  });

  it('gives a class-matched reward where the chain promises one', () => {
    for (const classId of ['warrior', 'mage'] as const) {
      const world = new World({ seed: 5, zone: getZone('fenmarch'), classId });
      const player = world.player;
      const maeve = [...world.entities.values()].find(
        (e) => e.kind === 'vendor' && e.vendorId === 'maeve',
      )!;
      player.pos = { x: maeve.pos.x + 1, z: maeve.pos.z };
      player.level = 20;
      player.questsDone = ['fen_01', 'fen_02', 'fen_03', 'fen_04', 'fen_05'];

      world.submit(player.id, { t: 'acceptQuest', vendorId: maeve.id, questId: 'fen_06' });
      world.tick();
      player.quests![0]!.counts = [1];
      world.submit(player.id, { t: 'turnInQuest', vendorId: maeve.id, questId: 'fen_06' });
      world.tick();

      const reward = player.inventory?.find((s) => canEquip(getItem(s.itemId), classId));
      expect(reward, `${classId} got no usable reward`).toBeDefined();
      expect(getItem(reward!.itemId).slot).toBe('weapon');
    }
  });

  it('abandons a quest without marking it done', () => {
    const { world, player, maeve } = questWorld();
    world.submit(player.id, { t: 'acceptQuest', vendorId: maeve.id, questId: 'fen_01' });
    world.tick();
    world.submit(player.id, { t: 'abandonQuest', questId: 'fen_01' });
    const events = world.tick();
    expect(events.some((e) => e.t === 'questAbandoned')).toBe(true);
    expect(player.quests).toHaveLength(0);
    expect(world.questsOfferedBy(player, 'maeve').map((q) => q.id)).toContain('fen_01');
  });
});

describe('zone travel', () => {
  it('moves the player to another zone and rebuilds it', () => {
    const world = new World({ seed: 301, zone: getZone('fenmarch'), classId: 'warrior' });
    const player = world.player;
    player.level = 20;
    const exit = world.zone.exits[0]!;
    player.pos = { ...exit.pos };

    world.submit(player.id, { t: 'travel', toZoneId: 'ardmoor' });
    const events = world.tick();

    expect(events.some((e) => e.t === 'zoneChanged' && e.zoneId === 'ardmoor')).toBe(true);
    expect(world.zone.id).toBe('ardmoor');
    expect(player.pos).toEqual(getZone('ardmoor').playerStart);
    // The old zone's creatures are gone and Ardmoor's are here.
    expect([...world.entities.values()].some((e) => e.defId === 'moor_hare')).toBe(false);
    expect([...world.entities.values()].some((e) => e.defId === 'crag_goat')).toBe(true);
    // And its trader came with it.
    expect([...world.entities.values()].some((e) => e.vendorId === 'sorcha')).toBe(true);
  });

  it('refuses to travel from the wrong place', () => {
    const world = new World({ seed: 302, zone: getZone('fenmarch'), classId: 'warrior' });
    world.player.level = 30;
    world.player.pos = { x: 0, z: 0 };
    world.submit(world.playerId, { t: 'travel', toZoneId: 'ardmoor' });
    const events = world.tick();
    expect(events.some((e) => e.t === 'error' && /not on the road/i.test(e.message))).toBe(true);
    expect(world.zone.id).toBe('fenmarch');
  });

  it('refuses to travel below the road level', () => {
    const world = new World({ seed: 303, zone: getZone('fenmarch'), classId: 'warrior' });
    const exit = world.zone.exits[0]!;
    world.player.pos = { ...exit.pos };
    world.player.level = 5;
    world.submit(world.playerId, { t: 'travel', toZoneId: 'ardmoor' });
    const events = world.tick();
    expect(events.some((e) => e.t === 'error' && /level 20/i.test(e.message))).toBe(true);
    expect(world.zone.id).toBe('fenmarch');
  });

  it('satisfies a travel objective on arrival', () => {
    const world = new World({ seed: 304, zone: getZone('fenmarch'), classId: 'warrior' });
    const player = world.player;
    player.level = 20;
    player.questsDone = ['fen_01', 'fen_02', 'fen_03', 'fen_04', 'fen_05', 'fen_06', 'fen_07'];
    const maeve = [...world.entities.values()].find((e) => e.vendorId === 'maeve')!;
    player.pos = { x: maeve.pos.x + 1, z: maeve.pos.z };
    world.submit(player.id, { t: 'acceptQuest', vendorId: maeve.id, questId: 'fen_08' });
    world.tick();

    player.pos = { ...world.zone.exits[0]!.pos };
    world.submit(player.id, { t: 'travel', toZoneId: 'ardmoor' });
    const events = world.tick();
    expect(events.some((e) => e.t === 'questReady' && e.questId === 'fen_08')).toBe(true);
  });

  it('remembers the zone across a save', () => {
    const world = new World({ seed: 305, zone: getZone('fenmarch'), classId: 'warrior' });
    world.player.level = 40;
    world.travelTo('ardmoor');
    const restored = World.deserialize(world.serialize(), getZone('fenmarch'));
    expect(restored.zone.id).toBe('ardmoor');
    expect([...restored.entities.values()].some((e) => e.defId === 'crag_goat')).toBe(true);
  });
});

describe('zone terrain and theme', () => {
  /** The clearings the renderer levels: spawn, boss arenas, shopfronts, exits. */
  function clearingsOf(zone: ReturnType<typeof getZone>): Clearing[] {
    const out: Clearing[] = [{ x: zone.playerStart.x, z: zone.playerStart.z, r: 11 }];
    for (const sp of zone.spawns) {
      if (isBoss(getMob(sp.mobId).stars)) out.push({ x: sp.pos.x, z: sp.pos.z, r: 18 });
    }
    for (const v of zone.vendors) out.push({ x: v.pos.x, z: v.pos.z, r: 9 });
    for (const e of zone.exits) out.push({ x: e.pos.x, z: e.pos.z, r: 8 });
    return out;
  }

  it('gives every zone its own look', () => {
    const ids = Object.values(ZONES).map((z) => z.theme);
    // Four zones, four distinct places. Travel that lands you somewhere that
    // looks like where you left is not travel.
    expect(new Set(ids).size).toBe(ids.length);
    for (const zone of Object.values(ZONES)) {
      const theme = getTheme(zone.theme);
      expect(theme.props.length, `${zone.name} has nothing in it`).toBeGreaterThan(2);
      // Fog you cannot see a camp through makes tab-targeting guesswork.
      expect(theme.fog.far).toBeGreaterThan(theme.fog.near + 40);
      expect(theme.fog.far).toBeGreaterThan(85);
      // Nor can a theme be so dim you cannot see what is hitting you. Caer
      // Dubh was authored at dusk and shipped with the mobs as black blobs on
      // a black hill — atmosphere is not worth an unreadable fight.
      expect(
        theme.sun.intensity + theme.hemisphere.intensity,
        `${zone.name} is too dark to fight in`,
      ).toBeGreaterThan(2);
    }
  });

  it('gets rougher as you go inland, and the Fenmarch stays gentle', () => {
    // The starting zone is the reference for feel as well as for balance:
    // whatever the later zones do, the moor stays walkable and readable.
    const amp = (id: string): number => getTheme(getZone(id).theme).terrain.amplitude;
    expect(amp('fenmarch')).toBeLessThan(3);
    expect(amp('ardmoor')).toBeGreaterThan(amp('fenmarch') * 2);
    expect(amp('caer_dubh')).toBeGreaterThan(amp('fenmarch'));
  });

  it('keeps the ground continuous and inside the amplitude it declares', () => {
    for (const zone of Object.values(ZONES)) {
      const spec = getTheme(zone.theme).terrain;
      const field = new HeightField(spec, clearingsOf(zone));
      let last = field.at(-zone.halfSize, 0);
      for (let x = -zone.halfSize; x <= zone.halfSize; x += 0.5) {
        const h = field.at(x, 0);
        expect(Math.abs(h)).toBeLessThanOrEqual(spec.amplitude * 1.05);
        // No cliffs: a half-metre step must not move the ground more than the
        // player's own height, or entities visibly pop as they walk.
        expect(Math.abs(h - last)).toBeLessThan(1.8);
        last = h;
      }
    }
  });

  it('levels every boss arena, so a telegraph circle reads as a circle', () => {
    for (const zone of Object.values(ZONES)) {
      const spec = getTheme(zone.theme).terrain;
      const field = new HeightField(spec, clearingsOf(zone));
      for (const sp of zone.spawns) {
        if (!isBoss(getMob(sp.mobId).stars)) continue;
        const centre = field.at(sp.pos.x, sp.pos.z);
        // Sample the ring a slam actually covers.
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
          const h = field.at(sp.pos.x + Math.cos(a) * 7, sp.pos.z + Math.sin(a) * 7);
          expect(
            Math.abs(h - centre),
            `${getMob(sp.mobId).name}'s arena is on a slope`,
          ).toBeLessThan(0.9);
        }
      }
    }
  });

  it('is renderer-only — the sim never reads a height', () => {
    // The whole reason terrain is cheap: it cannot desync anything. If this
    // ever fails, terrain has become gameplay and needs to move into sim/.
    const sim = import.meta.glob('../src/sim/*.ts', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    expect(Object.keys(sim).length).toBeGreaterThan(3);
    for (const [path, src] of Object.entries(sim)) {
      expect(/terrainHeight|HeightField|heightAt/.test(src), `${path} samples terrain`).toBe(false);
      expect(/content\/terrain/.test(src), `${path} imports the theme table`).toBe(false);
    }
  });
});

describe('zone-taught skills', () => {
  const TAUGHT_ZONES = ['ardmoor', 'reach', 'caer_dubh'];

  /** Everywhere a tome can come from: a trader's shelf or a loot table. */
  function sources(tomeId: string): string[] {
    const out: string[] = [];
    for (const vendor of Object.values(VENDORS)) {
      if (vendor.stock.includes(tomeId)) out.push(`vendor:${vendor.id}`);
    }
    for (const table of Object.values(LOOT_TABLES)) {
      if (Object.values(table.classTomes ?? {}).includes(tomeId)) out.push(`loot:${table.id}`);
      if (table.entries.some((e) => e.itemId === tomeId)) out.push(`loot:${table.id}`);
    }
    return out;
  }

  it('gives every class something new in every zone past the Fenmarch', () => {
    // The level-granted kit finishes at 15. Without this, levels 16-100 add
    // bigger numbers and no new decisions.
    for (const zoneId of TAUGHT_ZONES) {
      for (const cls of PLAYABLE_CLASSES) {
        const taught = skillsTaughtBy(zoneId).filter((s) => s.classId === cls.id);
        expect(taught.length, `${cls.name} learns nothing in ${zoneId}`).toBe(3);
        // And they unlock inside that zone's band, not somewhere unreachable.
        const [lo, hi] = getZone(zoneId).levelRange;
        for (const skill of taught) {
          expect(skill.reqLevel).toBeGreaterThanOrEqual(lo);
          expect(skill.reqLevel).toBeLessThanOrEqual(hi);
        }
      }
    }
    // The Fenmarch teaches by level alone — it is the tutorial for the game,
    // not for the tome system.
    expect(skillsTaughtBy('fenmarch')).toHaveLength(0);
  });

  it('can actually be obtained — every tome has a source', () => {
    for (const skill of Object.values(SKILLS)) {
      if (!skill.taughtBy) continue;
      const tome = getItem(skill.taughtBy);
      expect(tome.teaches, `${tome.id} does not teach back`).toBe(skill.id);
      expect(tome.classes, `${tome.id} is not locked to a class`).toEqual([skill.classId]);
      expect(
        sources(skill.taughtBy).length,
        `${tome.name} drops from nowhere and no one sells it`,
      ).toBeGreaterThan(0);
    }
  });

  it('sells the cheap one and makes you kill for the rest', () => {
    // Same rule as gear: a trader is a safety net, never a shortcut. The
    // uncommon tome is stocked; the rare and epic ones are boss drops.
    for (const zoneId of TAUGHT_ZONES) {
      for (const cls of PLAYABLE_CLASSES) {
        const [first, second, third] = skillsTaughtBy(zoneId).filter((s) => s.classId === cls.id);
        expect(getItem(first!.taughtBy!).quality).toBe('uncommon');
        expect(sources(first!.taughtBy!).some((s) => s.startsWith('vendor:'))).toBe(true);

        for (const skill of [second!, third!]) {
          const tome = getItem(skill.taughtBy!);
          expect(['rare', 'epic']).toContain(tome.quality);
          expect(
            sources(skill.taughtBy!).some((s) => s.startsWith('vendor:')),
            `${tome.name} is on a shelf; it should be killed for`,
          ).toBe(false);
        }
      }
    }
  });

  it('refuses to cast a skill you have not been taught', () => {
    const world = new World({ seed: 610, zone: duelZone('crag_goat'), classId: 'warrior' });
    const player = levelPlayer(world, { level: 40, learned: [] });
    const skill = skillsTaughtBy('ardmoor').find((s) => s.classId === 'warrior')!;

    world.submit(player.id, { t: 'target', id: theMob(world).id });
    world.submit(player.id, { t: 'useSkill', skillId: skill.id });
    const refused = world.tick();
    expect(refused.some((e) => e.t === 'error' && /have not learned/i.test(e.message))).toBe(true);

    // Learn it from the tome, and the same command works.
    world.addItem(player, { itemId: skill.taughtBy!, qty: 1 });
    world.submit(player.id, { t: 'learnSkill', itemId: skill.taughtBy! });
    const learned = world.tick();
    expect(learned.some((e) => e.t === 'skillUnlocked' && e.skillId === skill.id)).toBe(true);
    expect(player.learnedSkills).toContain(skill.id);
    // The tome is spent.
    expect(player.inventory?.some((s) => s.itemId === skill.taughtBy)).toBe(false);

    world.advance(3000);
    world.submit(player.id, { t: 'useSkill', skillId: skill.id });
    const cast = world.advance(200);
    expect(cast.some((e) => e.t === 'error' && /have not learned/i.test(e.message))).toBe(false);
  });

  it('will not teach the wrong class, the under-levelled, or the same thing twice', () => {
    const world = new World({ seed: 611, zone: emptyZone(), classId: 'warrior' });
    const player = levelPlayer(world, { level: 22, learned: [] });
    const warriorSkill = skillsTaughtBy('ardmoor').find((s) => s.classId === 'warrior')!;
    const priestSkill = skillsTaughtBy('ardmoor').find((s) => s.classId === 'priest')!;
    const lateSkill = skillsTaughtBy('caer_dubh').find((s) => s.classId === 'warrior')!;

    for (const [itemId, pattern] of [
      [priestSkill.taughtBy!, /means nothing/i],
      [lateSkill.taughtBy!, /needs level/i],
    ] as const) {
      world.addItem(player, { itemId, qty: 1 });
      world.submit(player.id, { t: 'learnSkill', itemId });
      const events = world.tick();
      expect(events.some((e) => e.t === 'error' && pattern.test(e.message))).toBe(true);
      // A refused tome is never consumed.
      expect(player.inventory?.some((s) => s.itemId === itemId)).toBe(true);
    }

    world.addItem(player, { itemId: warriorSkill.taughtBy!, qty: 2 });
    world.submit(player.id, { t: 'learnSkill', itemId: warriorSkill.taughtBy! });
    world.tick();
    world.submit(player.id, { t: 'learnSkill', itemId: warriorSkill.taughtBy! });
    const again = world.tick();
    expect(again.some((e) => e.t === 'error' && /already know/i.test(e.message))).toBe(true);
    expect(player.learnedSkills!.filter((id) => id === warriorSkill.id)).toHaveLength(1);
  });

  it('hands a boss tome to the class that killed it, and only once', () => {
    // Close enough for a Rogue's short reach — the default duel distance is
    // just outside it, which reads as "the boss never died".
    const world = new World({ seed: 612, zone: duelZone('aonghus', 2), classId: 'rogue' });
    const player = levelPlayer(world, { level: 40, learned: [] });
    const boss = theMob(world);
    const expected = LOOT_TABLES.aonghus_loot!.classTomes!.rogue!;

    boss.health = 1;
    world.submit(player.id, { t: 'target', id: boss.id });
    world.submit(player.id, { t: 'autoAttack', on: true });
    world.advance(6000);
    expect(boss.dead).toBe(true);
    expect(boss.corpseLoot?.some((s) => s.itemId === expected)).toBe(true);
    // A Warrior's tome is not in there — the drop is resolved against the killer.
    const warriorTome = LOOT_TABLES.aonghus_loot!.classTomes!.warrior!;
    expect(boss.corpseLoot?.some((s) => s.itemId === warriorTome)).toBe(false);

    // Learn it, kill the boss again, and it does not hand over a second copy.
    player.learnedSkills = [getItem(expected).teaches!];
    boss.dead = false;
    boss.health = 1;
    boss.corpseLoot = [];
    world.submit(player.id, { t: 'target', id: boss.id });
    world.advance(6000);
    expect(boss.corpseLoot?.some((s) => s.itemId === expected)).toBe(false);
  });

  it('remembers what you learned across a save', () => {
    const world = new World({ seed: 613, zone: getZone('fenmarch'), classId: 'mage' });
    const skill = skillsTaughtBy('ardmoor').find((s) => s.classId === 'mage')!;
    world.player.level = 30;
    world.player.learnedSkills = [skill.id];
    const restored = World.deserialize(world.serialize(), getZone('fenmarch'));
    expect(restored.player.learnedSkills).toContain(skill.id);
  });
});

describe('rare spawns', () => {
  /** A camp of one host mob, with rare spawns left switched on. */
  function campZone(mobId: string, count = 1) {
    return {
      ...duelZone(mobId),
      id: 'test-camp',
      spawns: Array.from({ length: count }, (_, i) => ({ mobId, pos: { x: 3 + i * 4, z: 0 } })),
      rareSpawns: true,
    };
  }

  /** Force the next spawn on this point to be the named variant. */
  function makeRare(world: World, mob: Entity): void {
    const host = getMob(mob.defId!);
    const rare = getMob(host.rareVariant!);
    mob.defId = rare.id;
    mob.name = rare.name;
    mob.level = rare.level;
    mob.health = world.statsOf(mob).maxHealth;
  }

  it('names every rare after what it carries', () => {
    for (const spec of RARES) {
      const rare = getMob(rareMobId(spec));
      const host = getMob(spec.hostMobId);
      // "Mirefang the Bog Wolf" — epithet, then the camp it hides in.
      expect(rare.name).toBe(`${spec.epithet} the ${host.name}`);
      expect(rare.rareOf).toBe(spec.hostMobId);
      expect(host.rareVariant).toBe(rare.id);
      // Harder than the camp, but never a boss: ★5 means boss everywhere else.
      expect(rare.level).toBe(spec.hostLevel + RARE_LEVEL_BONUS);
      expect(rare.stars).toBeGreaterThan(host.stars - 1);
      expect(rare.stars).toBeLessThan(BOSS_STARS);
      expect(rare.sighting!.length).toBeGreaterThan(10);

      // And the thing it carries shares its name.
      const table = LOOT_TABLES[rare.lootTableId]!;
      const carried = [
        ...Object.values(table.classWeapons ?? {}),
        ...table.entries.filter((e) => e.chance === 1).map((e) => e.itemId),
      ].map((id) => getItem(id));
      const signature = carried.filter((item) => item.quality === 'epic');
      if (spec.carries === 'lore') {
        // A lorekeeper carries the zone's capstone tome rather than gear.
        expect(Object.keys(table.classTomes ?? {}).length).toBe(PLAYABLE_CLASSES.length);
      } else {
        expect(signature.length, `${rare.name} carries nothing signature`).toBeGreaterThan(0);
        for (const item of signature) {
          expect(item.name.startsWith(spec.epithet), `${item.name} is not a ${spec.epithet}`).toBe(true);
        }
      }
    }
  });

  it('drops its signature nowhere else in the game', () => {
    const signatures = Object.values(ITEMS).filter((i) => i.id.startsWith('sig_'));
    expect(signatures.length).toBeGreaterThan(20);
    for (const item of signatures) {
      const from = Object.values(LOOT_TABLES).filter(
        (t) =>
          Object.values(t.classWeapons ?? {}).includes(item.id) ||
          t.entries.some((e) => e.itemId === item.id),
      );
      expect(from.length, `${item.name} comes from ${from.length} tables`).toBe(1);
      expect(getMob(MOBS_BY_TABLE[from[0]!.id]!).rareOf).toBeDefined();
      // And no trader ever stocks one.
      for (const vendor of Object.values(VENDORS)) {
        expect(vendor.stock).not.toContain(item.id);
      }
    }
  });

  it('carries an affix no ladder item has', () => {
    // Affixes belong to the things a ladder tier never is: a named creature
    // you camp for, a dragon that turns up when it feels like it, and the one
    // shop whose prices are themselves the grind. Everything that DROPS from
    // an ordinary source is a statline and nothing more.
    const unplannable = (id: string): boolean =>
      id.startsWith('sig_') || id.startsWith('wyrm_') || id.startsWith('lux_');
    for (const item of Object.values(ITEMS).filter((i) => !unplannable(i.id))) {
      expect(item.critBonus ?? 0, `${item.name} grew an affix`).toBe(0);
      expect(item.healthBonus ?? 0, `${item.name} grew an affix`).toBe(0);
      expect(item.moveSpeedBonus ?? 0, `${item.name} grew an affix`).toBe(0);
    }
    for (const item of Object.values(ITEMS).filter((i) => unplannable(i.id))) {
      const affixes =
        (item.critBonus ?? 0) +
        (item.healthBonus ?? 0) +
        (item.moveSpeedBonus ?? 0) +
        (item.damageBonus ?? 0) +
        (item.regenBonus ?? 0) +
        ((item.skillPower ?? 1) - 1);
      expect(affixes, `${item.name} is just a better statline`).toBeGreaterThan(0);
    }
  });

  it('turns up rarely, and hands the camp back afterwards', () => {
    // Statistical, over many respawns of one host camp.
    const world = new World({ seed: 900, zone: campZone('bog_wolf', 6), classId: 'warrior' });
    const mobs = [...world.entities.values()].filter((e) => e.kind === 'mob');
    let respawns = 0;
    let rares = 0;

    for (let i = 0; i < 4000; i++) {
      for (const mob of mobs) {
        if (mob.dead) continue;
        mob.dead = true;
        mob.respawnInMs = 1;
        respawns++;
      }
      for (const ev of world.tick()) {
        if (ev.t === 'rareSpawn') rares++;
      }
    }
    const rate = rares / respawns;
    console.log(`  rare spawns: ${rares} in ${respawns} respawns (${(rate * 100).toFixed(2)}%)`);
    // Wide bounds: this is a statistical check that the roll happens at all and
    // is in the right order of magnitude, not a test of the PRNG.
    expect(rate).toBeGreaterThan(RARE_SPAWN_CHANCE * 0.4);
    expect(rate).toBeLessThan(RARE_SPAWN_CHANCE * 2.5);
    // Whatever is standing at the end, the camp is not permanently named.
    const stillRare = mobs.filter((m) => getMob(m.defId!).rareOf).length;
    expect(stillRare).toBeLessThan(mobs.length);
  });

  it('never replaces a mob in a zone that switched them off', () => {
    // Test arenas rely on this: a duel against a creature you did not ask for
    // measures the wrong thing, and the roll itself would shift the rng stream.
    const world = new World({ seed: 901, zone: duelZone('bog_wolf'), classId: 'warrior' });
    const mob = theMob(world);
    for (let i = 0; i < 3000; i++) {
      mob.dead = true;
      mob.respawnInMs = 1;
      const events = world.tick();
      expect(events.some((e) => e.t === 'rareSpawn')).toBe(false);
      expect(mob.defId).toBe('bog_wolf');
    }
  });

  it('guarantees the signature to whoever kills it', () => {
    for (const classId of ['warrior', 'mage'] as const) {
      const world = new World({ seed: 902, zone: campZone('bog_wolf'), classId });
      const player = levelPlayer(world, { level: 20 });
      const mob = [...world.entities.values()].find((e) => e.kind === 'mob')!;
      makeRare(world, mob);

      mob.health = 1;
      world.submit(player.id, { t: 'target', id: mob.id });
      world.submit(player.id, { t: 'autoAttack', on: true });
      world.advance(8000);
      expect(mob.dead, `${classId} could not kill the rare`).toBe(true);

      const expected = signatureWeaponId(RARES.find((r) => r.epithet === 'Mirefang')!, classId);
      expect(mob.corpseLoot?.some((s) => s.itemId === expected)).toBe(true);
      // Every time, not on a roll — finding it was the luck.
      expect(getItem(expected).classes).toEqual([classId]);
    }
  });

  it('pays far better than the camp it hides in', () => {
    const rare = getMob('rare_mirefang');
    const host = getMob('bog_wolf');
    const gold = (mob: typeof rare): number => {
      const table = LOOT_TABLES[mob.lootTableId]!;
      const g = goldForKill(mob.level, mob.stars, table.goldMultiplier ?? 1);
      return (g.min + g.max) / 2;
    };
    expect(gold(rare)).toBeGreaterThan(gold(host) * 3);
  });

  it('makes a signature piece better than the tier, but not a different game', () => {
    for (const spec of RARES) {
      if (spec.carries !== 'weapon') continue;
      const level = spec.hostLevel + RARE_LEVEL_BONUS;
      for (const cls of PLAYABLE_CLASSES) {
        const signature = getItem(signatureWeaponId(spec, cls.id));
        const dps =
          (((signature.damageMin! + signature.damageMax!) / 2) * 1000) / signature.swingMs!;
        const ladderDps = curveWeaponDps(level);
        expect(dps / ladderDps, `${signature.name} is no better than the ladder`).toBeGreaterThan(1.1);
        expect(dps / ladderDps, `${signature.name} outclasses the game`).toBeLessThan(1.4);
      }
    }
  });
});

describe('bounty spawns', () => {
  it('is the same fight as its camp, with a purse', () => {
    for (const bounty of BOUNTY_MOBS) {
      const host = getMob(bounty.rareOf!);
      expect(bounty.level).toBe(host.level);
      expect(bounty.stars).toBe(host.stars);
      // Softer, not harder: a jackpot you cannot cash is worse than none.
      expect(deriveMobStats(bounty).maxHealth).toBeLessThan(deriveMobStats(host).maxHealth);
      expect(bounty.damageMax).toBe(host.damageMax);
      expect(bounty.name).toBe(`${bounty.name.split(' ')[0]} the ${host.name}`);
      expect(bounty.sighting!.length).toBeGreaterThan(10);
    }
  });

  it('pays one kind of windfall each, and pays it big', () => {
    for (const bounty of BOUNTY_MOBS) {
      const host = getMob(bounty.rareOf!);
      const goldOf = (mob: typeof host): number => {
        const g = goldForKill(mob.level, mob.stars, LOOT_TABLES[mob.lootTableId]!.goldMultiplier ?? 1);
        return (g.min + g.max) / 2;
      };
      const goldRatio = goldOf(bounty) / goldOf(host);
      const xpRatio = bounty.xp / host.xp;

      if (bounty.bounty === 'gold') {
        expect(goldRatio, `${bounty.name} is not much of a purse`).toBeGreaterThan(10);
        expect(xpRatio, `${bounty.name} pays xp as well as gold`).toBe(1);
      } else {
        expect(xpRatio, `${bounty.name} is not much of an elder`).toBeGreaterThan(10);
        expect(goldRatio, `${bounty.name} pays gold as well as xp`).toBeCloseTo(1, 1);
      }
      // Neither is worth a level, or the grind stops being the game.
      expect(Math.max(goldRatio, xpRatio)).toBeLessThan(30);
    }
  });

  it('anchors its worth to the camp it hides in', () => {
    // This is what stops a level-90 player farming a level-3 boar camp for
    // gold: fifteen times a Mossback Boar is still Mossback Boar money.
    const early = BOUNTY_MOBS.find((b) => b.bounty === 'gold' && getMob(b.rareOf!).level < 10)!;
    const late = BOUNTY_MOBS.filter((b) => b.bounty === 'gold').sort((a, b) => b.level - a.level)[0]!;
    const worth = (mob: typeof early): number => {
      const g = goldForKill(mob.level, mob.stars, LOOT_TABLES[mob.lootTableId]!.goldMultiplier ?? 1);
      return (g.min + g.max) / 2;
    };
    expect(worth(late)).toBeGreaterThan(worth(early) * 10);
  });

  it('never shares a camp with an item rare', () => {
    // One variant per host: the spawn roll picks between "ordinary" and "the
    // variant", so a host carrying two would silently drop one of them.
    const hosts = Object.values(MOBS).filter((m) => m.rareVariant);
    const seen = new Map<string, string>();
    for (const host of hosts) {
      expect(seen.has(host.id), `${host.id} hosts two variants`).toBe(false);
      seen.set(host.id, host.rareVariant!);
    }
    // And every variant points back at exactly one host.
    for (const [hostId, variantId] of seen) {
      expect(getMob(variantId).rareOf).toBe(hostId);
    }
  });

  it('actually hands over the windfall when killed', () => {
    const spec = BOUNTY_MOBS.find((b) => b.bounty === 'gold')!;
    const world = new World({
      seed: 950,
      zone: { ...duelZone(spec.rareOf!, 2), rareSpawns: false },
      classId: 'warrior',
    });
    const player = levelPlayer(world, { level: 20 });
    const mob = theMob(world);
    const host = getMob(mob.defId!);

    // Kill the camp mob, note the purse, then do it again as the bounty.
    const take = (): number => {
      mob.dead = false;
      mob.corpseLoot = [];
      mob.corpseGold = 0;
      mob.health = 1;
      world.submit(player.id, { t: 'target', id: mob.id });
      world.submit(player.id, { t: 'autoAttack', on: true });
      world.advance(6000);
      expect(mob.dead).toBe(true);
      return mob.corpseGold ?? 0;
    };
    const ordinary = take();
    mob.defId = spec.id;
    mob.name = spec.name;
    const windfall = take();
    expect(windfall).toBeGreaterThan(ordinary * 8);
    expect(getMob(mob.defId).rareOf).toBe(host.id);
  });
});

describe('the armour lines', () => {
  it('outfits every zone, one slot at a time', () => {
    for (const line of ARMOUR_LINES) {
      const chain = Object.values(QUESTS)
        .filter((q) => q.chain === `${line.zoneId}_kit`)
        .sort((a, b) => a.id.localeCompare(b.id));
      expect(chain.length, `${line.zoneId} has no armour line`).toBe(5);

      // Four steps, one per slot — the set covers a character.
      const slots = line.steps.map((s) => s.slot);
      expect(new Set(slots).size).toBe(4);
      // Rising through the zone's band, never out of it.
      const [lo, hi] = getZone(line.zoneId).levelRange;
      let last = 0;
      for (const step of line.steps) {
        expect(step.level).toBeGreaterThan(last);
        expect(step.level).toBeGreaterThanOrEqual(lo);
        expect(step.level).toBeLessThanOrEqual(hi);
        last = step.level;
      }
      expect(line.capstone.level).toBeGreaterThanOrEqual(last);
    }
  });

  it('drops every trophy where the quest says it does', () => {
    for (const line of ARMOUR_LINES) {
      for (const step of line.steps) {
        const table = LOOT_TABLES[getMob(step.mobId).lootTableId]!;
        const entry = table.entries.find((e) => e.itemId === trophyId(step));
        expect(entry, `${step.trophy} does not drop from ${step.mobId}`).toBeDefined();
        expect(entry!.chance).toBe(TROPHY_DROP_CHANCE);
        // And nowhere else: a known rate on a known camp is the whole point.
        const sources = Object.values(LOOT_TABLES).filter((t) =>
          t.entries.some((e) => e.itemId === trophyId(step)),
        );
        // The camp itself, plus whatever named variant shares its spawn point.
        expect(sources.length).toBeLessThanOrEqual(2);
      }
    }
  });

  it('pays out the piece it promised, and a weapon at the end', () => {
    for (const line of ARMOUR_LINES) {
      line.steps.forEach((step, i) => {
        const quest = getQuest(`${line.zoneId}_kit_0${i + 1}`);
        const [reward] = quest.rewards.items!;
        expect(getItem(reward!).slot, `${quest.name} pays the wrong slot`).toBe(step.slot);
        expect(quest.objectives).toHaveLength(1);
        expect(quest.objectives[0]).toMatchObject({ kind: 'collect', itemId: trophyId(step) });
      });

      const capstone = getQuest(`${line.zoneId}_kit_05`);
      // A handful of everything the line taught you to farm.
      expect(capstone.objectives).toHaveLength(4);
      for (const step of line.steps) {
        expect(capstone.objectives.some((o) => o.kind === 'collect' && o.itemId === trophyId(step))).toBe(true);
      }
      for (const cls of PLAYABLE_CLASSES) {
        const weapon = getItem(capstone.rewards.classItems![cls.id]!);
        expect(weapon.slot).toBe('weapon');
        expect(canEquip(weapon, cls.id)).toBe(true);
      }
    }
  });

  it('takes the trophies when you hand them in', () => {
    const world = new World({ seed: 960, zone: getZone('fenmarch'), classId: 'warrior' });
    const player = world.player;
    const maeve = [...world.entities.values()].find((e) => e.vendorId === 'maeve')!;
    player.pos = { x: maeve.pos.x + 1, z: maeve.pos.z };
    player.level = 20;

    const step = ARMOUR_LINES.find((l) => l.zoneId === 'fenmarch')!.steps[0]!;
    // One more than the quest wants, so we can see exactly what was taken.
    world.addItem(player, { itemId: trophyId(step), qty: step.count + 1 });
    world.submit(player.id, { t: 'acceptQuest', vendorId: maeve.id, questId: 'fenmarch_kit_01' });
    world.tick();
    expect(world.isQuestComplete(player, 'fenmarch_kit_01')).toBe(true);

    world.submit(player.id, { t: 'turnInQuest', vendorId: maeve.id, questId: 'fenmarch_kit_01' });
    world.tick();
    const left = player.inventory?.find((s) => s.itemId === trophyId(step))?.qty ?? 0;
    expect(left, 'the trophies were not handed over').toBe(1);
    // And the piece is in the bags.
    const line = ARMOUR_LINES.find((l) => l.zoneId === 'fenmarch')!;
    expect(player.inventory?.some((s) => s.itemId === questArmourId(line, step))).toBe(true);
  });

  it('is better than the shops and worse than the bosses', () => {
    // Quest gear is the reliable path, so it must not be the best path.
    for (const line of ARMOUR_LINES) {
      for (const step of line.steps) {
        const piece = getItem(questArmourId(line, step));
        expect(piece.quality).toBe('rare');
        expect(piece.armor).toBeGreaterThan(
          curveArmorTotal(step.level) * ARMOR_SLOT_SHARE[step.slot] * 0.99,
        );
        expect(piece.armor).toBeLessThan(
          curveArmorTotal(step.level) * ARMOR_SLOT_SHARE[step.slot] * 1.2,
        );
        // No affixes: those belong to rare spawns alone.
        expect(piece.critBonus ?? 0).toBe(0);
        expect(piece.healthBonus ?? 0).toBe(0);
      }
      for (const cls of PLAYABLE_CLASSES) {
        const weapon = getItem(questWeaponId(line, cls.id));
        const dps = (((weapon.damageMin! + weapon.damageMax!) / 2) * 1000) / weapon.swingMs!;
        const curve = curveWeaponDps(line.capstone.level);
        expect(dps / curve).toBeGreaterThan(1.0);
        // A signature weapon from a rare spawn is 1.22x. This must stay under.
        expect(dps / curve).toBeLessThan(1.15);
      }
    }
  });
});

describe('territory and standing', () => {
  /** A zone with one holding's guard post and nothing else. */
  function frontZone(holdingId: string) {
    const holding = getHolding(holdingId);
    return {
      ...emptyZone(),
      id: holding.zoneId,
      rareSpawns: false,
      spawns: [
        // Inside every class's reach: the default duel distance is outside a
        // Rogue's, which reads as "the front never moved".
        { mobId: holding.garrison[holding.initialController]!, pos: { x: 2, z: 0 }, holding: holding.id },
      ],
    };
  }

  it('starts every front where the world says it starts', () => {
    const world = new World({ seed: 700, zone: getZone('fenmarch'), classId: 'warrior' });
    for (const holding of HOLDINGS) {
      expect(world.controllerOf(holding.id)).toBe(holding.initialController);
      // Held at the far end, not the midpoint: a fresh world reads as
      // "the outlaws own the road", not "the road happens to be theirs".
      expect(Math.abs(world.controlOf(holding.id))).toBe(1);
      expect(holding.claimants).toContain(holding.initialController);
      expect(new Set(holding.claimants).size).toBe(2);
      // Both claimants keep something there, or a flip empties the ground.
      for (const claimant of holding.claimants) {
        expect(getMob(holding.garrison[claimant]!)).toBeDefined();
      }
    }
  });

  it('puts the holder\'s own people on the guard posts', () => {
    const holding = getHolding('road_watch');
    const world = new World({ seed: 701, zone: getZone('fenmarch'), classId: 'warrior' });
    const posts = [...world.entities.values()].filter((e) => e.holding === 'road_watch');
    expect(posts.length).toBeGreaterThan(6);
    for (const post of posts) {
      expect(post.defId).toBe(holding.garrison[holding.initialController]);
    }
  });

  it('changes hands when you put in the work, and says so', () => {
    const world = new World({ seed: 702, zone: frontZone('road_watch'), classId: 'warrior' });
    const player = levelPlayer(world, { level: 30 });
    const guard = theMob(world);
    const holding = getHolding('road_watch');
    const incumbent = holding.initialController;
    const challenger = holding.claimants.find((c) => c !== incumbent)!;

    let flip: SimEvent | undefined;
    for (let i = 0; i < 400 && !flip; i++) {
      guard.dead = false;
      guard.health = 1;
      world.submit(player.id, { t: 'target', id: guard.id });
      world.submit(player.id, { t: 'autoAttack', on: true });
      for (const ev of world.advance(1000)) {
        if (ev.t === 'holdingChanged') flip = ev;
      }
    }

    expect(flip, 'the front never moved').toBeDefined();
    // The front you actually fought at, not whichever one the faction was
    // weakest on: territory is taken where you are standing.
    expect(flip).toMatchObject({
      holdingId: 'road_watch',
      from: incumbent,
      to: challenger,
      byPlayer: true,
    });
    expect(world.controllerOf('road_watch')).toBe(challenger);

    // And the ground visibly changes hands: the next respawn is the new
    // holder's garrison, not the old one's.
    guard.dead = true;
    guard.respawnInMs = 1;
    world.tick();
    expect(guard.defId).toBe(holding.garrison[challenger]);
  });

  it('moves on its own while nobody is looking', () => {
    // The map has to be a thing happening in the world rather than a thing
    // waiting for the player to press start.
    const world = new World({ seed: 703, zone: emptyZone(), classId: 'warrior' });
    const drifting = HOLDINGS.filter((h) => h.drift !== 0);
    expect(drifting.length).toBe(HOLDINGS.length);

    const before = Object.fromEntries(HOLDINGS.map((h) => [h.id, world.controlOf(h.id)]));
    world.advance(120000); // two minutes of world time
    for (const holding of drifting) {
      const moved = world.controlOf(holding.id) - before[holding.id]!;
      // Everything at its cap can only move one way, so check the sign of
      // whatever movement there was rather than demanding movement.
      if (moved !== 0) expect(Math.sign(moved)).toBe(Math.sign(holding.drift));
    }
    // At least one front should have actually moved in two minutes.
    expect(HOLDINGS.some((h) => world.controlOf(h.id) !== before[h.id])).toBe(true);
  });

  it('remembers what you did to people, and to whom', () => {
    const world = new World({ seed: 704, zone: duelZone('outlaw_bowman', 2), classId: 'warrior' });
    const player = levelPlayer(world, { level: 30 });
    const outlaw = theMob(world);

    for (let i = 0; i < 12; i++) {
      outlaw.dead = false;
      outlaw.health = 1;
      world.submit(player.id, { t: 'target', id: outlaw.id });
      world.submit(player.id, { t: 'autoAttack', on: true });
      world.advance(2000);
    }
    // Hunting outlaws costs you with the outlaws and earns you with the
    // people they prey on.
    expect(world.standingWith(player, 'outlaws')).toBeLessThan(0);
    expect(world.standingWith(player, 'freeholders')).toBeGreaterThan(0);
    // Wildlife has no opinion about any of it.
    expect(getMob('bog_wolf').factionId).toBeUndefined();
  });

  it('lets a faction you have come to terms with leave you alone', () => {
    // The most legible consequence available in a game with no other players
    // in it: a camp that stops swinging at you.
    const zone = { ...duelZone('outlaw_bowman', 4), rareSpawns: false };
    const hated = new World({ seed: 705, zone, classId: 'warrior' });
    const friend = new World({ seed: 705, zone, classId: 'warrior' });
    // Standing FIRST: `levelPlayer` ticks the world on its way out, and a mob
    // that aggroed during that tick stays on you whatever you do afterwards.
    friend.player.standing = { outlaws: STANDING_LIMIT };
    levelPlayer(hated, { level: 30 });
    levelPlayer(friend, { level: 30 });

    // Read the mob's state rather than the event: `levelPlayer` ticks once on
    // the way in, so the aggro event can already have been and gone.
    const hunted = (world: World): boolean => {
      world.advance(4000);
      const mob = [...world.entities.values()].find((e) => e.kind === 'mob')!;
      return mob.aiState !== 'idle' && mob.targetId === world.playerId;
    };
    expect(hunted(hated), 'an outlaw ignored a stranger').toBe(true);
    expect(hunted(friend), 'the outlaws attacked a friend').toBe(false);

    // A bear does not care about your reputation.
    const beastZone = { ...duelZone('marsh_bear', 4), rareSpawns: false };
    const beasts = new World({ seed: 706, zone: beastZone, classId: 'warrior' });
    levelPlayer(beasts, { level: 30 });
    beasts.player.standing = { outlaws: STANDING_LIMIT, freeholders: STANDING_LIMIT };
    beasts.advance(4000);
    const bear = [...beasts.entities.values()].find((e) => e.kind === 'mob')!;
    expect(bear.targetId).toBe(beasts.playerId);
  });

  it('prices a trader by what they make of you', () => {
    const world = new World({ seed: 707, zone: vendorZone('maeve'), classId: 'warrior' });
    const player = world.player;
    const itemId = 'bronze_shortsword';

    const neutral = world.priceFor(player, itemId);
    player.standing = { freeholders: STANDING_LIMIT };
    const trusted = world.priceFor(player, itemId);
    player.standing = { freeholders: -STANDING_LIMIT };
    const hated = world.priceFor(player, itemId);

    expect(trusted).toBeLessThan(neutral);
    expect(hated).toBeGreaterThan(neutral);
    // Never so steep that a bad reputation strands you with nowhere to shop.
    expect(hated / neutral).toBeLessThan(1.5);
  });

  it('keeps the shops out of the war', () => {
    // Ground changes hands; the place you keep your things does not.
    for (const zone of Object.values(ZONES)) {
      for (const vendor of zone.vendors) {
        for (const holding of HOLDINGS.filter((h) => h.zoneId === zone.id)) {
          const posts = zone.spawns.filter((sp) => sp.holding === holding.id);
          for (const post of posts) {
            const d = Math.hypot(post.pos.x - vendor.pos.x, post.pos.z - vendor.pos.z);
            expect(d, `${holding.name} is fought over on ${vendor.vendorId}'s doorstep`).toBeGreaterThan(20);
          }
        }
      }
    }
  });

  it('carries the war across a save', () => {
    const world = new World({ seed: 708, zone: getZone('fenmarch'), classId: 'warrior' });
    const holding = HOLDINGS[0]!;
    const challenger = holding.claimants.find((c) => c !== holding.initialController)!;
    world.control[holding.id] = 0;
    world.controller[holding.id] = challenger;
    world.player.standing = { outlaws: -400 };

    const restored = World.deserialize(world.serialize(), getZone('fenmarch'));
    expect(restored.controllerOf(holding.id)).toBe(challenger);
    expect(restored.controlOf(holding.id)).toBe(0);
    expect(restored.player.standing?.outlaws).toBe(-400);
  });
});

describe('dragons are world entities', () => {
  /** Wind a world forward far enough to catch a dragon doing something. */
  function until(
    world: World,
    predicate: () => boolean,
    limitMinutes = 200,
  ): SimEvent[] {
    const seen: SimEvent[] = [];
    const ticks = (limitMinutes * 60000) / TICK_MS;
    for (let i = 0; i < ticks && !predicate(); i++) seen.push(...world.tick());
    return seen;
  }

  it('is in no zone\'s spawn list', () => {
    // A boss stands where the layout puts it. A dragon is somewhere the world
    // decided, which is the entire difference between the two.
    for (const zone of Object.values(ZONES)) {
      for (const spawn of zone.spawns) {
        expect(getMob(spawn.mobId).dragon ?? false).toBe(false);
      }
    }
    expect(DRAGONS.length).toBe(4);
    for (const def of DRAGONS) {
      const mob = getMob(dragonMobId(def));
      expect(mob.dragon).toBe(true);
      // AT the top of its zone's band, not above it. Level gap drives both
      // accuracy and mitigation, so headroom turned every dragon into a
      // cliff — and there is no "come back stronger" past the level cap.
      expect(def.level).toBe(getZone(def.zoneId).levelRange[1]);
      // Harder than the boss that ends its zone, and anchored to it.
      const elite = getMob(def.eliteId);
      expect(elite.stars).toBe(6);
      expect(elite.dragon ?? false).toBe(false);
      expect(mob.baseHealth).toBeGreaterThan(elite.baseHealth);
      expect(def.territory.length).toBeGreaterThan(1);
      for (const holdingId of def.territory) expect(getHolding(holdingId).zoneId).toBe(def.zoneId);
      // Telegraphed, like every other big fight in the game.
      expect(mob.abilities?.some((a) => a.kind === 'heavySlam')).toBe(true);
    }
  });

  it('sleeps, wakes, works its territory and goes back to the dark', () => {
    const world = new World({ seed: 800, zone: getZone('fenmarch'), classId: 'warrior' });
    const def = DRAGONS.find((d) => d.zoneId === 'fenmarch')!;
    const phases: string[] = [];
    const seen = new Set<string>();

    expect(world.dragonState(def.id).phase).toBe('dormant');
    for (let i = 0; i < (200 * 60000) / TICK_MS; i++) {
      for (const ev of world.tick()) {
        if (ev.t === 'dragon' && ev.dragonId === def.id) {
          phases.push(ev.phase);
          if (ev.holdingId) seen.add(ev.holdingId);
        }
      }
      if (phases.filter((p) => p === 'dormant').length > 0 && seen.size === def.territory.length) break;
    }

    // It woke, sat on every holding it claims, and went home.
    expect(phases[0]).toBe('hunting');
    expect(phases).toContain('roosting');
    expect(phases[phases.length - 1]).toBe('dormant');
    expect([...seen].sort()).toEqual([...def.territory].sort());
  });

  it('drives the garrison off the ground it sits on, and stops the war there', () => {
    const world = new World({ seed: 801, zone: getZone('fenmarch'), classId: 'warrior' });
    const def = DRAGONS.find((d) => d.zoneId === 'fenmarch')!;

    until(world, () => world.dragonState(def.id).phase === 'roosting');
    const state = world.dragonState(def.id);
    expect(state.phase).toBe('roosting');
    const holdingId = state.holdingId!;

    // Nobody is standing a post under a dragon.
    const posts = [...world.entities.values()].filter((e) => e.holding === holdingId);
    expect(posts.length, 'the garrison stayed put under a dragon').toBe(0);
    expect(world.isSuppressed(holdingId)).toBe(true);

    // And the front is frozen while it is there: no drift either way.
    const before = world.controlOf(holdingId);
    world.advance(60000);
    expect(world.controlOf(holdingId)).toBe(before);

    // The dragon itself is here, and it is the real thing.
    const dragon = [...world.entities.values()].find((e) => e.dragonId === def.id);
    expect(dragon, 'the dragon never entered the world').toBeDefined();
    expect(getMob(dragon!.defId!).dragon).toBe(true);
  });

  it('hands the ground back when somebody finally kills it', () => {
    const world = new World({ seed: 802, zone: getZone('fenmarch'), classId: 'warrior' });
    const def = DRAGONS.find((d) => d.zoneId === 'fenmarch')!;
    until(world, () => world.dragonState(def.id).phase === 'roosting');
    const holdingId = world.dragonState(def.id).holdingId!;

    const player = levelPlayer(world, { level: 40 });
    const dragon = [...world.entities.values()].find((e) => e.dragonId === def.id)!;
    dragon.health = 1;
    player.pos = { x: dragon.pos.x + 1, z: dragon.pos.z };
    world.submit(player.id, { t: 'target', id: dragon.id });
    world.submit(player.id, { t: 'autoAttack', on: true });
    const events = world.advance(6000);

    expect(dragon.dead).toBe(true);
    expect(events.some((e) => e.t === 'dragon' && e.phase === 'slain')).toBe(true);
    expect(world.dragonState(def.id).phase).toBe('slain');
    // The ground goes back to the people who were fighting over it.
    expect(world.isSuppressed(holdingId)).toBe(false);
    // And it carried something for whoever landed the kill.
    const carried = dragon.corpseLoot!.map((s) => getItem(s.itemId));
    expect(carried.some((i) => i.slot === 'weapon' && i.classes?.includes('warrior'))).toBe(true);
  });

  it('carries on while you are somewhere else', () => {
    // The point of a routine over a spawn timer: the world does not pause
    // because the player left the zone.
    const world = new World({ seed: 803, zone: getZone('fenmarch'), classId: 'warrior' });
    const far = DRAGONS.find((d) => d.zoneId === 'caer_dubh')!;
    const before = world.dragonState(far.id).remainingMs;
    world.advance(60000);
    expect(world.dragonState(far.id).remainingMs).toBeLessThan(before);
    // But it is not standing in the Fenmarch.
    expect([...world.entities.values()].some((e) => e.dragonId === far.id)).toBe(false);
  });

  it('is waiting for you when you walk into its zone mid-visit', () => {
    const world = new World({ seed: 804, zone: getZone('ardmoor'), classId: 'warrior' });
    const def = DRAGONS.find((d) => d.zoneId === 'ardmoor')!;
    until(world, () => world.dragonState(def.id).phase === 'roosting');
    const holdingId = world.dragonState(def.id).holdingId!;

    world.player.level = 60;
    world.travelTo('fenmarch');
    expect([...world.entities.values()].some((e) => e.dragonId === def.id)).toBe(false);
    world.travelTo('ardmoor');

    expect([...world.entities.values()].some((e) => e.dragonId === def.id)).toBe(true);
    // And the ground it is on is still empty.
    expect([...world.entities.values()].filter((e) => e.holding === holdingId)).toHaveLength(0);
  });

  it('remembers where it was across a save', () => {
    const world = new World({ seed: 805, zone: getZone('fenmarch'), classId: 'warrior' });
    const def = DRAGONS[0]!;
    until(world, () => world.dragonState(def.id).phase === 'roosting');

    const restored = World.deserialize(world.serialize(), getZone('fenmarch'));
    expect(restored.dragonState(def.id).phase).toBe('roosting');
    expect(restored.dragonState(def.id).holdingId).toBe(world.dragonState(def.id).holdingId);
  });

  it('cannot be camped: nothing you do makes one turn up', () => {
    // No spawn roll, no host camp, no respawn timer on the corpse. The only
    // thing that produces a dragon is time.
    for (const def of DRAGONS) {
      const mob = getMob(dragonMobId(def));
      expect(mob.respawnMs).toBe(0);
      expect(mob.rareOf).toBeUndefined();
      expect(mob.rareVariant).toBeUndefined();
    }
    const world = new World({ seed: 806, zone: getZone('fenmarch'), classId: 'warrior' });
    const def = DRAGONS.find((d) => d.zoneId === 'fenmarch')!;
    // Kill things for a solid stretch: it changes nothing about the dragon.
    const before = world.dragonState(def.id).remainingMs;
    for (const e of [...world.entities.values()]) {
      if (e.kind === 'mob') e.dead = true;
    }
    world.advance(1000);
    expect(world.dragonState(def.id).phase).toBe('dormant');
    expect(world.dragonState(def.id).remainingMs).toBeLessThan(before);
  });
});
