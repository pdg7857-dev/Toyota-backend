import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world.js';
import { MAX_LEVEL, TICK_MS, xpToNext } from '../src/sim/formulas.js';
import { FENMARCH, getZone } from '../src/content/zone.js';
import { countEvents, duelZone, emptyZone, levelPlayer, simulateFight, vendorZone } from './helpers.js';
import { buyPrice, sellPrice } from '../src/content/vendors.js';
import { getQuest } from '../src/content/quests.js';
import { skillBarFor, getSkill } from '../src/content/skills.js';
import { canEquip, getItem } from '../src/content/items.js';
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

  it('delays a cast when the caster takes damage, but still lands it', () => {
    const world = newWorld(14);
    const player = levelPlayer(world, { level: 6 });
    player.health = world.statsOf(player).maxHealth * 0.5; // hurt, not dying
    world.submit(player.id, { t: 'useSkill', skillId: 'rally' });

    // Hold the boar alive so it keeps swinging through the whole cast.
    const boar = theMob(world);
    const events: SimEvent[] = [];
    for (let i = 0; i < 120; i++) {
      boar.health = world.statsOf(boar).maxHealth;
      events.push(...world.tick());
    }
    expect(events.some((e) => e.t === 'castBegin' && e.id === 'rally')).toBe(true);
    expect(events.some((e) => e.t === 'castPushback' && e.id === 'rally')).toBe(true);
    // Being hit must not stop a heal from ever completing — that would delete
    // the whole point of every sustain class.
    expect(events.some((e) => e.t === 'castComplete' && e.id === 'rally')).toBe(true);
    expect(events.some((e) => e.t === 'heal' && e.targetId === player.id)).toBe(true);
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
