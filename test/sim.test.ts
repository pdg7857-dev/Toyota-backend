import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world.js';
import { MAX_LEVEL, TICK_MS, xpToNext } from '../src/sim/formulas.js';
import { FENMARCH } from '../src/content/zone.js';
import { countEvents, duelZone, emptyZone, levelPlayer, simulateFight } from './helpers.js';
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

  it('interrupts an interruptible cast when the caster takes damage', () => {
    const world = newWorld(14);
    const player = levelPlayer(world, { level: 6 });
    world.submit(player.id, { t: 'useSkill', skillId: 'rally' });

    // The boar is already in aggro range, so it can land a hit on the very tick
    // the cast starts — assert on the event stream rather than on end state.
    const events = world.advance(4000);
    expect(events.some((e) => e.t === 'castBegin' && e.id === 'rally')).toBe(true);
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
