import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world.js';
import { MAX_LEVEL, TICK_MS, castBreakChance, expectedDefense, xpToNext } from '../src/sim/formulas.js';
import { FENMARCH, PLAYABLE_CLASSES, ZONES, getZone } from '../src/content/zone.js';
import { HeightField, getTheme, type Clearing } from '../src/content/terrain.js';
import { countEvents, duelZone, emptyZone, levelPlayer, simulateFight, vendorZone } from './helpers.js';
import { VENDORS, buyPrice, sellPrice } from '../src/content/vendors.js';
import { getQuest } from '../src/content/quests.js';
import { SKILLS, skillBarFor, getSkill, skillsTaughtBy } from '../src/content/skills.js';
import { canEquip, getItem } from '../src/content/items.js';
import { LOOT_TABLES, getMob } from '../src/content/mobs.js';
import { isBoss } from '../src/sim/types.js';
import type { Entity, SimEvent } from '../src/sim/types.js';

function newWorld(seed = 1, zone = duelZone('mossback_boar')) {
  return new World({ seed, zone, classId: 'warrior' });
}

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
      const near = { ...hare.pos };
      player.pos = { x: near.x + 1, z: near.z };
      events.push(...world.advance(3000));
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
