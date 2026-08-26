import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world.js';
import {
  MAX_EQUIPMENT_DROP_CHANCE,
  MAX_LEVEL,
  MAX_SKILL_RANK,
  POINTS_PER_LEVEL,
  SKILL_CRIT_MULTIPLIER,
  SKILL_POINTS_PER_LEVEL,
  STAR_LOOT_MULTIPLIER,
  STRENGTH_DAMAGE_MAX,
  skillRankPower,
  xpForKill,
  TICK_MS,
  castBreakChance,
  deriveMobStats,
  expectedDefense,
  goldForKill,
  roamRadiusFor,
  DEATH_DEBT_SHARE,
  DEBT_CAP_LEVELS,
  DEBT_FROM_LEVEL,
  DEBT_REPAY_SHARE,
  deathDebt,
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
import { KIND_RARITY, MOUNTS, getMount, mountsOfKind, type MountKind } from '../src/content/mounts.js';
import {
  ADVENTURERS,
  ADVENTURERS_PER_ZONE,
  CHATTER_INTERVAL_SEC,
  FIGHT_FLOOR,
  GIVE_UP_AT,
  GRATS_RANGE,
  YIELD_MARGIN,
} from '../src/content/adventurers.js';
import { SKILLS, skillBarFor, getSkill, skillsTaughtBy } from '../src/content/skills.js';
import { grindMobFor, killsForLevel } from './pace.js';
import {
  ROAM_RADIUS,
  THREAT_WORDS,
  threatBand,
  threatGap,
} from '../src/sim/formulas.js';
import { zoneStructures } from '../src/content/structures.js';
import { MODELS, clipFor } from '../src/content/models.js';
import {
  BODY_PLANS,
  QUALITY_METAL,
  bodyPlanFor,
  bodyPlanForClass,
  offhandLookFor,
  offhandParts,
  weaponLookFor,
  weaponParts,
} from '../src/content/bodies.js';
import {
  DAY_LENGTH_MS,
  NIGHT_FLOOR,
  clockOf,
  daylightAt,
  weatherAt,
} from '../src/content/daylight.js';
import { ITEMS, bestDrink, canEquip, gearSetFor, getItem } from '../src/content/items.js';
import { TIER_ORDER, baseItemId, splitTier } from '../src/content/tiers.js';
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
import {
  BOUNTY_MOBS,
  LOOT_TABLES,
  MOBS,
  RESPAWN_MS,
  baseMobId,
  getMob,
  starVariantId,
  starVariantsOf,
} from '../src/content/mobs.js';
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
    // Five minutes now, not twenty seconds: the timer is what makes a big map
    // worth crossing instead of a camp worth standing in.
    const events = world.advance(RESPAWN_MS + 2000);
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
    // A hare rather than a boar: this is a test about the xp curve, and a
    // level-1 character now takes a real fight off a level-3 ★1 — which is the
    // point of the world being dangerous, and nothing to do with levelling.
    const world = newWorld(9, duelZone('moor_hare'));
    const player = levelPlayer(world, { level: 1, gear: ['bronze_shortsword'] });
    player.xp = xpToNext(1) - 1;

    const events: SimEvent[] = [];
    world.submit(player.id, { t: 'target', id: theMob(world).id });
    world.submit(player.id, { t: 'autoAttack', on: true });
    for (let i = 0; i < 3000 && player.level < 2; i++) events.push(...world.tick());

    expect(player.level).toBe(2);
    expect(player.unspentPoints).toBe(POINTS_PER_LEVEL);
    expect(player.skillPoints).toBe(SKILL_POINTS_PER_LEVEL);
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
    // Levelled, because the cudgel asks for a level and some Strength now.
    // Swapping gear you are not allowed to wear is a different test.
    const player = levelPlayer(world, { level: 12 });
    expect(player.equipment?.weapon).toBe('rusted_blade');
    const before = world.statsOf(player).damageMin;

    world.addItem(player, { itemId: 'ironbark_cudgel', qty: 1 });
    world.submit(player.id, { t: 'equip', itemId: 'ironbark_cudgel' });
    world.tick();

    expect(player.equipment?.weapon).toBe('ironbark_cudgel');
    expect(player.inventory?.some((s) => s.itemId === 'rusted_blade')).toBe(true);
    // Against the weapon rather than against a number typed in once. Strength
    // multiplies weapon damage now — and the cudgel carries Strength of its
    // own — so a literal here is a test of a Warrior's starting attributes and
    // not of equipping anything.
    const after = world.statsOf(player).damageMin;
    const base = getItem('ironbark_cudgel').damageMin!;
    expect(after).toBeGreaterThan(before);
    expect(after).toBeGreaterThanOrEqual(base);
    expect(after).toBeLessThanOrEqual(base * (1 + STRENGTH_DAMAGE_MAX));
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
      // Levelled first: armour asks for a level and some Vitality now, and
      // what this test is about is that it never asks which class you are.
      const player = levelPlayer(world, { level: 25 });
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
      // Through the base id: a boss's weapon comes out at a grade now, so the
      // drop is a Royal Scarred Fang or better rather than the plain one. What
      // the test is about is *which* weapon, not which grade of it.
      const dropped = boss.corpseLoot?.find((s) => baseItemId(s.itemId) === expected);
      expect(dropped, `no ${expected} on the corpse`).toBeDefined();
      // And it must actually be equippable by the class that earned it.
      const drop = getItem(dropped!.itemId);
      expect(canEquip(drop, classId)).toBe(true);
      // A boss never hands out below Royal — that is what a boss is for.
      const tier = splitTier(dropped!.itemId)?.tier;
      expect(tier, `${expected} came out ungraded`).toBeDefined();
      expect(TIER_ORDER.indexOf(tier!)).toBeGreaterThanOrEqual(TIER_ORDER.indexOf('royal'));
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
    //
    // Measured as total relief now rather than as one number, because the
    // ground is two layers: rolling country everywhere, and high country over
    // the part of a map its mask claims. Ardmoor is not rougher because its
    // hills are steeper, it is rougher because it has mountains.
    const relief = (id: string): number => {
      const t = getTheme(getZone(id).theme).terrain;
      return t.amplitude + (t.mountains?.amplitude ?? 0) * (t.mountains?.mask ?? 0);
    };
    expect(relief('fenmarch')).toBeLessThan(relief('ardmoor') / 2);
    expect(relief('caer_dubh')).toBeGreaterThan(relief('fenmarch'));
    // And the moor keeps the gentlest hills of the four, whatever stands
    // behind them.
    const hills = (id: string): number => getTheme(getZone(id).theme).terrain.amplitude;
    for (const id of ['ardmoor', 'reach', 'caer_dubh']) {
      expect(hills('fenmarch'), `${id} has gentler ground than the moor`).toBeLessThan(hills(id));
    }
  });

  it('puts water in the low ground of every zone', () => {
    // A map with no water on it is a map with nothing on it but slopes.
    for (const zone of Object.values(ZONES)) {
      const theme = getTheme(zone.theme);
      const spec = theme.terrain;
      expect(spec.waterLevel, `${zone.name} has no water`).toBeDefined();
      expect(theme.water, `${zone.name} has water with no colour`).toBeDefined();

      const field = new HeightField(spec, clearingsOf(zone));
      let wet = 0;
      let samples = 0;
      const step = zone.halfSize / 22;
      for (let x = -zone.halfSize; x <= zone.halfSize; x += step) {
        for (let z = -zone.halfSize; z <= zone.halfSize; z += step) {
          samples++;
          if (field.underwater(x, z)) wet++;
        }
      }
      const share = wet / samples;
      console.log(`  ${zone.name.padEnd(18)} ${(share * 100).toFixed(0)}% under water`);
      // Enough to be a feature of the place, not so much that it is a sea with
      // some hills in it — and the drowned wood is allowed to be the wettest.
      expect(share, `${zone.name} is dry`).toBeGreaterThan(0.02);
      expect(share, `${zone.name} is a lake`).toBeLessThan(0.45);
    }
  });

  it('keeps camps, traders and arenas out of the water', () => {
    // Somewhere you have to stand and fight cannot be at the bottom of a lake,
    // and on a map this size nobody is checking four hundred camps by hand.
    for (const zone of Object.values(ZONES)) {
      const field = new HeightField(getTheme(zone.theme).terrain, clearingsOf(zone));
      const dry = (pos: { x: number; z: number }, what: string): void => {
        expect(field.underwater(pos.x, pos.z), `${what} in ${zone.name} is under water`).toBe(false);
      };
      dry(zone.playerStart, 'the arrival point');
      for (const vendor of zone.vendors) dry(vendor.pos, vendor.vendorId);
      for (const exit of zone.exits) dry(exit.pos, exit.label);
      // Camp centres rather than every point: a spawn on the shoreline of a
      // tarn is scenery, a camp in the middle of one is a bug.
      const seen = new Map<string, { x: number; z: number }>();
      for (const spawn of zone.spawns) {
        const key = `${spawn.mobId}:${Math.round(spawn.pos.x / 60)}:${Math.round(spawn.pos.z / 60)}`;
        if (!seen.has(key)) seen.set(key, spawn.pos);
      }
      let drowned = 0;
      for (const pos of seen.values()) if (field.underwater(pos.x, pos.z)) drowned++;
      expect(drowned, `${drowned} camps in ${zone.name} are under water`).toBe(0);
    }
  });

  it('keeps the ground continuous and inside the amplitude it declares', () => {
    for (const zone of Object.values(ZONES)) {
      const spec = getTheme(zone.theme).terrain;
      const field = new HeightField(spec, clearingsOf(zone));
      // Total relief the two layers can produce between them, plus the bite
      // the water line takes out of the low ground.
      const ceiling = (spec.amplitude + (spec.mountains?.amplitude ?? 0)) * 1.05 + 10;
      let last = field.at(-zone.halfSize, 0);
      for (let x = -zone.halfSize; x <= zone.halfSize; x += 0.5) {
        const h = field.at(x, 0);
        expect(Math.abs(h), `${zone.name} at x=${x}`).toBeLessThanOrEqual(ceiling);
        // No cliffs: a half-metre step must not move the ground more than the
        // player's own height, or entities visibly pop as they walk. This is
        // what keeps "mountains" from meaning "walls".
        expect(Math.abs(h - last), `a cliff in ${zone.name} at x=${x}`).toBeLessThan(1.8);
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
      expect(baseMobId(post.defId!)).toBe(holding.garrison[holding.initialController]);
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

describe('horses and mounts', () => {
  function herdZone(mobId: string, distance = 2) {
    return { ...duelZone(mobId, distance), rareSpawns: false };
  }

  it('will not pick a fight with you', () => {
    // A herd is a place you go, not a thing that ambushes you.
    for (const mount of MOUNTS) {
      const horse = getMob(mount.mobId);
      expect(horse.aggroRadius, `${horse.name} hunts people`).toBe(0);
      expect(horse.horse).toBe(mount.id);
    }
    const world = new World({ seed: 820, zone: herdZone('wild_cob'), classId: 'warrior' });
    levelPlayer(world, { level: 20 });
    world.advance(5000);
    expect(theMob(world).aiState).toBe('idle');
  });

  it('is worth almost nothing dead', () => {
    // Everything about the stat block should say "this is not what you are
    // here for". Killing one is the mistake the whole mechanic is about.
    const horse = getMob('wild_cob');
    const peer = getMob('moor_stag');
    expect(horse.xp).toBeLessThan(peer.xp);
    expect(LOOT_TABLES[horse.lootTableId]!.entries).toHaveLength(0);
    expect(LOOT_TABLES[horse.lootTableId]!.goldMultiplier).toBeLessThan(0.3);
  });

  it('refuses a capture until the horse is worn down, and says why', () => {
    const world = new World({ seed: 821, zone: herdZone('wild_cob'), classId: 'warrior' });
    const player = levelPlayer(world, { level: 20 });
    const horse = theMob(world);

    world.submit(player.id, { t: 'capture', id: horse.id });
    let events = world.tick();
    expect(events.some((e) => e.t === 'error' && /too strong/i.test(e.message))).toBe(true);

    // Out of reach, even when it is weak.
    horse.health = world.statsOf(horse).maxHealth * 0.1;
    player.pos = { x: 40, z: 0 };
    world.submit(player.id, { t: 'capture', id: horse.id });
    events = world.tick();
    expect(events.some((e) => e.t === 'error' && /too far/i.test(e.message))).toBe(true);

    // And a dead one is just a dead horse.
    player.pos = { x: 0, z: 0 };
    horse.dead = true;
    world.submit(player.id, { t: 'capture', id: horse.id });
    events = world.tick();
    expect(events.some((e) => e.t === 'error' && /dead/i.test(e.message))).toBe(true);
    expect(player.stable ?? []).toHaveLength(0);
  });

  it('takes the horse when it works, and fights back when it does not', () => {
    let captured = 0;
    let thrown = 0;
    for (let seed = 0; seed < 40; seed++) {
      const world = new World({ seed: seed * 331 + 7, zone: herdZone('wild_cob'), classId: 'warrior' });
      const player = levelPlayer(world, { level: 20 });
      const horse = theMob(world);
      horse.health = world.statsOf(horse).maxHealth * 0.1;

      world.submit(player.id, { t: 'capture', id: horse.id });
      for (const ev of world.tick()) {
        if (ev.t !== 'captured') continue;
        if (ev.mountId) {
          captured++;
          expect(player.stable).toContain('moor_cob');
          // It leaves the world with you.
          expect(world.entity(horse.id)).toBeUndefined();
        } else {
          thrown++;
          // A failed attempt costs you the fight, so capture is not a free
          // retry button: it breaks away with half its health and comes back.
          expect(horse.aiState).not.toBe('idle');
          expect(horse.targetId).toBe(player.id);
          expect(horse.health).toBeGreaterThan(world.statsOf(horse).maxHealth * 0.4);
        }
      }
    }
    console.log(`  moor cob: caught ${captured} of ${captured + thrown}`);
    expect(captured).toBeGreaterThan(0);
    expect(thrown).toBeGreaterThan(0);
  });

  it('makes the good ones very hard to keep rather than hard to find', () => {
    // A herd you can walk to and an animal that shrugs you off is a better
    // story than a spawn timer. Both legendaries run alone.
    for (const id of ['ashen_grey', 'caer_unicorn']) {
      const legend = getMount(id);
      expect(legend.count, `${legend.name} runs in a herd`).toBe(1);
      expect(legend.captureChance, `${legend.name} is too easy to take`).toBeLessThan(0.12);
    }
  });

  it('keeps the three families in rarity order', () => {
    // Horse, then dire wolf, then unicorn. The ladder is the feature, so it
    // must hold across every member of every family rather than on average —
    // one generous number in the rare family and the rare family is the easy
    // one.
    const order: MountKind[] = ['horse', 'direwolf', 'unicorn'];
    const rows: string[] = [];
    for (const kind of order) {
      const family = mountsOfKind(kind);
      expect(family.length, `no ${kind}s`).toBeGreaterThan(0);
      for (const m of family) {
        rows.push(
          `  ${m.name.padEnd(26)} ${kind.padEnd(9)} lv${String(m.level).padStart(3)}  ` +
            `1 in ${(1 / m.captureChance).toFixed(0).padStart(2)} attempts  speed ${m.speed}`,
        );
        const band = KIND_RARITY[kind];
        expect(m.captureChance, `${m.name} is out of its family's rarity band`).toBeLessThanOrEqual(
          band.max,
        );
        expect(m.captureChance, `${m.name} is out of its family's rarity band`).toBeGreaterThanOrEqual(
          band.min,
        );
      }
    }
    console.log('\nMOUNTS\n' + rows.join('\n'));

    // The unicorn is the rarest thing in the game you can ride, and the best.
    const unicorn = getMount('caer_unicorn');
    for (const other of MOUNTS.filter((m) => m.id !== unicorn.id)) {
      expect(other.captureChance, `${other.name} is rarer than the unicorn`).toBeGreaterThan(
        unicorn.captureChance,
      );
      expect(other.speed, `${other.name} is faster than the unicorn`).toBeLessThan(unicorn.speed);
    }

    // And a wolf is worth more in a fight than any horse, which is why both
    // families exist rather than one ladder of numbers.
    const worth = (m: (typeof MOUNTS)[number]): number =>
      (m.bonus.damageBonus ?? 0) + (m.bonus.armorBonus ?? 0) * 0.4 + (m.bonus.regenBonus ?? 0) * 4;
    const wolves = mountsOfKind('direwolf');
    for (const wolf of wolves) {
      const peers = mountsOfKind('horse').filter((h) => h.level <= wolf.level);
      for (const horse of peers) {
        expect(worth(wolf), `${horse.name} out-fights ${wolf.name}`).toBeGreaterThan(worth(horse));
      }
    }
  });

  it('rides faster and carries its own bonus', () => {
    const world = new World({ seed: 822, zone: emptyZone(), classId: 'warrior' });
    const player = levelPlayer(world, { level: 60 });
    const onFoot = world.statsOf(player);

    player.stable = ['wood_destrier'];
    world.submit(player.id, { t: 'mount', mountId: 'wood_destrier' });
    world.tick();
    const ridden = world.statsOf(player);

    const mount = getMount('wood_destrier');
    expect(ridden.moveSpeed).toBe(mount.speed);
    expect(ridden.moveSpeed).toBeGreaterThan(onFoot.moveSpeed);
    expect(ridden.defense).toBeGreaterThan(onFoot.defense);
    expect(ridden.maxHealth).toBeGreaterThan(onFoot.maxHealth);
    // Each herd is a different choice, not a speed upgrade with one winner.
    expect(getMount('hill_courser').bonus.damageBonus).toBeGreaterThan(0);
    expect(getMount('moor_cob').bonus.regenBonus).toBeGreaterThan(0);
  });

  it('will not let you ride one you have not caught', () => {
    const world = new World({ seed: 823, zone: emptyZone(), classId: 'warrior' });
    const player = levelPlayer(world, { level: 60 });
    world.submit(player.id, { t: 'mount', mountId: 'ashen_grey' });
    const events = world.tick();
    expect(events.some((e) => e.t === 'error' && /no such horse/i.test(e.message))).toBe(true);
    expect(player.mounted ?? null).toBeNull();
  });

  it('throws you off a telegraphed hit, but not an ordinary swing', () => {
    // The same three-way rule casting uses. Being unseated by chip damage
    // would mean nobody ever rode anything into a fight.
    const world = new World({ seed: 824, zone: duelZone('old_scar', 2), classId: 'warrior' });
    const player = levelPlayer(world, { level: 40 });
    player.stable = ['moor_cob'];
    player.mounted = 'moor_cob';
    const boss = theMob(world);

    let unseated = false;
    for (let i = 0; i < 2000 && !unseated; i++) {
      player.health = world.statsOf(player).maxHealth;
      boss.health = world.statsOf(boss).maxHealth;
      for (const ev of world.tick()) {
        if (ev.t === 'mounted' && ev.unseated) unseated = true;
      }
    }
    expect(unseated, 'a telegraphed hit left the rider seated').toBe(true);
    expect(player.mounted).toBeNull();
  });

  it('stays in the saddle through anything without a telegraph', () => {
    // The other half of the same rule, measured against a creature that has
    // no abilities at all: nothing it can do should ever unseat a rider.
    const world = new World({ seed: 826, zone: duelZone('bog_wolf', 2), classId: 'warrior' });
    const player = levelPlayer(world, { level: 8 });
    player.stable = ['moor_cob'];
    player.mounted = 'moor_cob';
    const wolf = theMob(world);
    expect(getMob(wolf.defId!).abilities ?? []).toHaveLength(0);

    let hits = 0;
    for (let i = 0; i < 1200; i++) {
      player.health = world.statsOf(player).maxHealth;
      wolf.health = world.statsOf(wolf).maxHealth;
      for (const ev of world.tick()) {
        if (ev.t === 'damage' && ev.targetId === player.id) hits++;
        expect(ev.t === 'mounted' && ev.unseated).toBe(false);
      }
    }
    expect(hits, 'the wolf never landed anything').toBeGreaterThan(5);
    expect(player.mounted).toBe('moor_cob');
  });

  it('keeps the stable across a save', () => {
    const world = new World({ seed: 825, zone: getZone('fenmarch'), classId: 'warrior' });
    world.player.stable = ['moor_cob', 'ashen_grey'];
    world.player.mounted = 'ashen_grey';
    const restored = World.deserialize(world.serialize(), getZone('fenmarch'));
    expect(restored.player.stable).toEqual(['moor_cob', 'ashen_grey']);
    expect(restored.player.mounted).toBe('ashen_grey');
  });
});

describe('the other adventurers', () => {
  /** Chat lines out of an event stream, in order. */
  function chatLines(events: SimEvent[]): string[] {
    return events.filter((e) => e.t === 'chat').map((e) => `[${e.name}] ${e.text}`);
  }

  function peopleIn(world: World): Entity[] {
    return [...world.entities.values()].filter((e) => e.kind === 'npc');
  }

  it('puts the same people in every zone, at levels that make sense there', () => {
    for (const zone of Object.values(ZONES)) {
      const world = new World({ seed: 900, zone, classId: 'warrior' });
      const people = peopleIn(world);
      expect(people, `nobody is in ${zone.name}`).toHaveLength(ADVENTURERS_PER_ZONE);

      const [lo, hi] = zone.levelRange;
      for (const person of people) {
        // The fastest way to break the illusion is a level 4 in Caer Dubh.
        expect(person.level, `${person.name} is level ${person.level} in ${zone.name}`)
          .toBeGreaterThanOrEqual(lo);
        expect(person.level).toBeLessThanOrEqual(hi);
        expect(ADVENTURERS.some((a) => a.name === person.name)).toBe(true);
        expect(person.classId).toBeDefined();
      }

      // No two of the same person, and no two of the same class while the
      // roster still has one spare: a camp where everybody plays a Priest
      // reads as a bug in the population rather than a coincidence in it.
      expect(new Set(people.map((p) => p.name)).size).toBe(people.length);
      expect(new Set(people.map((p) => p.classId)).size).toBe(people.length);

      // Deterministic: walk into the same zone twice and it is the same people.
      const again = new World({ seed: 900, zone, classId: 'warrior' });
      expect(peopleIn(again).map((p) => p.name)).toEqual(people.map((p) => p.name));
    }
  });

  it('pulls real creatures, and never takes one from you', () => {
    // The rule the whole feature stands on, and the only interesting question
    // once they fight for real: an adventurer that tags the creature you
    // needed is not atmosphere, it is a competitor.
    //
    // Four things are watched at once, because the failure modes are all
    // "it worked, and it took something": a kill, a drop, a creature left
    // standing wounded for you to walk into, or one picked from under you.
    const world = new World({ seed: 901, zone: getZone('fenmarch'), classId: 'warrior' });
    const player = world.player;
    const mobs = [...world.entities.values()].filter((e) => e.kind === 'mob');
    const people = peopleIn(world);

    let deaths = 0;
    const died: string[] = [];
    let loot = 0;
    let swungAt = 0;
    const fought = new Set<number>();
    let lowest = 1;
    let stolen = 0;
    let woundedAndFree = 0;
    const ends: string[] = [];
    const engagedNow = new Map<number, number>();

    for (let i = 0; i < 12 * 60 * 20; i++) {
      for (const ev of world.tick()) {
        if (ev.t === 'death') {
          deaths++;
          died.push(`${world.entity(ev.entityId)?.kind ?? '?'} ${world.entity(ev.entityId)?.name}`);
        }
        if (ev.t === 'lootGained') loot++;
        if (ev.t === 'damage' && world.entity(ev.sourceId)?.kind === 'npc') {
          swungAt++;
          fought.add(ev.targetId);
        }
      }
      if (i % 20 !== 0) continue;

      const engaged = new Set(people.map((p) => p.npcFoe).filter((id) => id !== undefined));
      for (const p of people) {
        const was = engagedNow.get(p.id);
        if (p.npcFoe === undefined && was !== undefined) {
          const mob = world.entity(was);
          const left = p.health / world.statsOf(p).maxHealth;
          ends.push(left <= GIVE_UP_AT + 0.03 ? 'worn down' : 'gave it up');
          void mob;
          engagedNow.delete(p.id);
        } else if (p.npcFoe !== undefined) {
          engagedNow.set(p.id, p.npcFoe);
        }
      }
      for (const mob of mobs) {
        const max = world.statsOf(mob).maxHealth;
        if (engaged.has(mob.id)) {
          lowest = Math.min(lowest, mob.health / max);
          const reach = getMob(mob.defId!).aggroRadius + YIELD_MARGIN;
          if (Math.hypot(mob.pos.x - player.pos.x, mob.pos.z - player.pos.z) < reach) stolen++;
        } else if (mob.health < max - 0.5 && mob.aiState !== 'returning') {
          // Nobody is on it and it is not walking home: that is a wounded
          // creature left lying about for the player to find, which is the
          // quiet version of taking one.
          woundedAndFree++;
        }
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      `\n  twelve minutes of other people: ${fought.size} creature(s) pulled, ` +
        `${swungAt} blows landed, worst off any of them got ` +
        `${Math.round(lowest * 100)}% (floor ${Math.round(FIGHT_FLOOR * 100)}%)` +
        `\n    ${ends.length} fight(s): ` +
        [...new Set(ends)].map((k) => `${ends.filter((e) => e === k).length} ${k}`).join(', '),
    );

    expect(fought.size, 'nobody pulled anything in four minutes').toBeGreaterThan(0);
    expect(deaths, `something died: ${died.join(', ')}`).toBe(0);
    expect(loot, 'somebody looted something').toBe(0);
    expect(lowest, 'they got one below the floor').toBeGreaterThanOrEqual(FIGHT_FLOOR - 0.01);
    expect(stolen, 'one was fought inside the reach of the player').toBe(0);
    expect(woundedAndFree, 'a wounded creature was left lying about').toBe(0);
    for (const mob of mobs) expect(mob.dead).toBe(false);
  });

  it('gives the creature straight back when you come near', () => {
    // The half that makes the rule true rather than merely likely. Whatever
    // they were doing to it, the creature a player walks up to is the creature
    // they would have found: leashMob sends it home and heals it to full,
    // which is this game's own answer to "that fight is over" rather than a
    // special case pretending to be one.
    const world = new World({ seed: 907, zone: getZone('fenmarch'), classId: 'warrior' });
    const player = world.player;
    const people = peopleIn(world);

    let foe: Entity | undefined;
    for (let i = 0; i < 3 * 60 * 20 && !foe; i++) {
      world.tick();
      for (const p of people) {
        const e = world.entity(p.npcFoe ?? -1);
        if (e && e.health < world.statsOf(e).maxHealth * 0.9) foe = e;
      }
    }
    expect(foe, 'nobody got a creature far enough into a fight').toBeDefined();

    const hurt = foe!.health;
    player.pos = { x: foe!.pos.x + 4, z: foe!.pos.z };
    world.advance(300);

    expect(people.some((p) => p.npcFoe === foe!.id), 'they hung on to it').toBe(false);
    // Whole again on the spot, not on arriving home: by the time it has walked
    // back it has aggroed the player and arrived at their feet wounded, which
    // is a gift rather than a theft and still not the creature they would have
    // found.
    expect(hurt).toBeLessThan(world.statsOf(foe!).maxHealth);
    expect(foe!.health).toBe(world.statsOf(foe!).maxHealth);
  });

  it('cannot be fought, however hard you try', () => {
    // Not "takes no damage" — a population you can kill is a population you
    // will kill, and then the world is empty and it was your fault.
    const world = new World({ seed: 902, zone: getZone('fenmarch'), classId: 'warrior' });
    const player = levelPlayer(world, { level: 40 });
    const victim = peopleIn(world)[0]!;
    player.pos = { x: victim.pos.x + 1, z: victim.pos.z };

    world.submit(player.id, { t: 'target', id: victim.id });
    world.submit(player.id, { t: 'autoAttack', on: true });
    const events = world.advance(20000);

    expect(events.some((e) => e.t === 'swing' && e.targetId === victim.id)).toBe(false);
    expect(events.some((e) => e.t === 'damage' && e.targetId === victim.id)).toBe(false);
    expect(victim.dead).toBe(false);
  });

  it('walks the zone rather than standing in it', () => {
    const world = new World({ seed: 903, zone: getZone('fenmarch'), classId: 'warrior' });
    const people = peopleIn(world);
    const start = people.map((p) => ({ ...p.pos }));

    world.advance(60000);

    const moved = people.filter(
      (p, i) => Math.hypot(p.pos.x - start[i]!.x, p.pos.z - start[i]!.z) > 2,
    );
    expect(moved.length, 'nobody moved in a minute').toBeGreaterThan(0);
    const limit = getZone('fenmarch').halfSize;
    for (const p of people) {
      expect(Math.abs(p.pos.x)).toBeLessThanOrEqual(limit);
      expect(Math.abs(p.pos.z)).toBeLessThanOrEqual(limit);
    }
  });

  it('is quiet', () => {
    // The fastest way to make a fake population feel fake is to make it chatty.
    const minutes = 30;
    const world = new World({ seed: 904, zone: getZone('fenmarch'), classId: 'warrior' });
    const lines = chatLines(world.advance(minutes * 60 * 1000));
    const perMinute = lines.length / minutes;
    console.log(`  chatter: ${lines.length} lines in ${minutes} min (${perMinute.toFixed(2)}/min)`);
    console.log(`    e.g. ${lines.slice(0, 3).join('  |  ')}`);

    // Around one line per interval, per zone — not per person.
    const expected = 60 / CHATTER_INTERVAL_SEC;
    expect(perMinute).toBeGreaterThan(expected * 0.4);
    expect(perMinute).toBeLessThan(expected * 2.2);
    // Every line is attributed to somebody who is actually here.
    const names = new Set(peopleIn(world).map((p) => p.name));
    for (const line of lines) {
      expect(names.has(line.slice(1, line.indexOf(']')))).toBe(true);
    }
  });

  it('congratulates you on a level, if anyone was near enough to see it', () => {
    /** Level the player off one kill, and report what anybody said about it. */
    function levelUpWith(witnessAt: number): { lines: string[]; level: number; name: string } {
      const world = new World({ seed: 906, zone: getZone('fenmarch'), classId: 'warrior' });
      const player = world.player;
      const boar = [...world.entities.values()].find((e) => e.kind === 'mob')!;
      player.pos = { x: boar.pos.x + 1, z: boar.pos.z };
      // One kill short of the level, so the next swing is the one that counts.
      player.xp = xpToNext(player.level) - 1;
      for (const person of peopleIn(world)) {
        person.pos = { x: player.pos.x + witnessAt, z: player.pos.z };
      }
      boar.health = 1;
      world.submit(player.id, { t: 'target', id: boar.id });
      world.submit(player.id, { t: 'autoAttack', on: true });
      const lines = chatLines(world.advance(6000));
      return { lines, level: player.level, name: player.name };
    }

    const seen = levelUpWith(2);
    expect(seen.level, 'the kill did not level the player').toBeGreaterThan(1);
    expect(seen.lines.some((l) => l.includes(seen.name)), seen.lines.join(' | ')).toBe(true);

    // The proximity gate is the whole trick: a congratulation from somebody
    // three fields away is a system message wearing a name.
    const unseen = levelUpWith(GRATS_RANGE * 3);
    expect(unseen.level).toBeGreaterThan(1);
    expect(unseen.lines.some((l) => l.includes(unseen.name))).toBe(false);
  });

  it('talks about the front that just moved', () => {
    const holding = getHolding('road_watch');
    const incumbent = holding.initialController;
    const challenger = Object.keys(holding.garrison).find((f) => f !== incumbent)!;
    const zone = {
      ...emptyZone(),
      id: holding.zoneId,
      // The one arena that wants a population: the reaction is the thing
      // under test.
      adventurers: true,
      spawns: [{ mobId: holding.garrison[incumbent]!, pos: { x: 2, z: 0 }, holding: holding.id }],
    };
    const world = new World({ seed: 907, zone, classId: 'warrior' });
    const player = levelPlayer(world, { level: 30 });
    const guard = [...world.entities.values()].find((e) => e.kind === 'mob')!;

    const said: string[] = [];
    let flipped = false;
    for (let i = 0; i < 400 && !flipped; i++) {
      guard.dead = false;
      guard.health = 1;
      world.submit(player.id, { t: 'target', id: guard.id });
      world.submit(player.id, { t: 'autoAttack', on: true });
      for (const ev of world.advance(1000)) {
        if (ev.t === 'holdingChanged') flipped = true;
        if (ev.t === 'chat') said.push(ev.text);
      }
    }

    expect(flipped, 'the front never moved').toBe(true);
    expect(challenger).toBeDefined();
    expect(said.some((line) => line.includes(holding.name)), said.join(' | ')).toBe(true);
  });

  it('stays out of the test arenas', () => {
    // They walk and talk on the sim's Rng, so a populated arena is an arena
    // where every seeded fight rolls different numbers.
    for (const zone of [duelZone('mossback_boar'), emptyZone(), vendorZone('maeve')]) {
      const world = new World({ seed: 908, zone, classId: 'warrior' });
      expect(peopleIn(world), `${zone.name} is not empty`).toHaveLength(0);
    }
  });

  it('is still there after a save', () => {
    const world = new World({ seed: 909, zone: getZone('fenmarch'), classId: 'warrior' });
    world.advance(30000);
    const before = peopleIn(world).map((p) => ({ name: p.name, level: p.level, pos: { ...p.pos } }));

    const restored = World.deserialize(world.serialize(), getZone('fenmarch'));
    const after = peopleIn(restored).map((p) => ({
      name: p.name,
      level: p.level,
      pos: { ...p.pos },
    }));
    expect(after).toEqual(before);
  });
});

describe('the world moves while you are gone', () => {
  const HOUR = 3600000;
  const DAY = 24 * HOUR;

  function fresh(seed = 950) {
    return new World({ seed, zone: getZone('fenmarch'), classId: 'warrior' });
  }

  /**
   * The same zone with nothing living in it.
   *
   * Comparing catch-up against real ticking means running hours of the live
   * loop, and the live loop is mostly creatures. Emptying the zone leaves
   * exactly the two layers under test — the fronts and the dragons, which are
   * world state and do not care what is standing in the grass.
   */
  function quiet(seed = 950) {
    return new World({ seed, zone: { ...emptyZone(), id: 'fenmarch' }, classId: 'warrior' });
  }

  it('runs the same rules at a coarser step', () => {
    // The whole safety of catch-up rests on this: `tickTerritory` and
    // `tickDragons` are the live loop's own functions with a different step,
    // not an offline path free to disagree with them. Two hours ticked in real
    // time and two hours caught up must land on the same map.
    const ticked = quiet();
    ticked.advance(2 * HOUR);

    const caught = quiet();
    caught.catchUp(2 * HOUR);

    for (const holding of HOLDINGS) {
      expect(caught.controllerOf(holding.id), holding.name).toBe(ticked.controllerOf(holding.id));
      // Drift accumulates in fractions, so the two paths land close rather
      // than identical — a 30s step versus a 50ms one over two hours.
      expect(Math.abs(caught.controlOf(holding.id) - ticked.controlOf(holding.id))).toBeLessThan(
        0.02,
      );
    }
  });

  it('moves ground that nobody fought over', () => {
    const world = fresh();
    const before = Object.fromEntries(HOLDINGS.map((h) => [h.id, world.controllerOf(h.id)]));

    const report = world.catchUp(3 * DAY);

    expect(report.fronts.length, 'three days changed nothing').toBeGreaterThan(0);
    for (const front of report.fronts) {
      expect(front.from).toBe(before[front.holdingId]);
      expect(world.controllerOf(front.holdingId)).toBe(front.to);
      expect(front.to).not.toBe(front.from);
    }
    // Towns are never contested, however long you stay away — a player who
    // comes back to find the shop gone has been punished for leaving.
    const traderGround = HOLDINGS.filter((h) => h.drift === 0);
    for (const holding of traderGround) {
      expect(report.fronts.some((f) => f.holdingId === holding.id)).toBe(false);
    }
  });

  it('reports the net change, not the transcript', () => {
    // A fortnight is hundreds of flips. What comes back is what is different
    // now, because a log opening with forty lines has buried the one that
    // mattered.
    const world = fresh();
    const report = world.catchUp(14 * DAY);
    const ids = report.fronts.map((f) => f.holdingId);
    expect(new Set(ids).size, 'a holding was reported twice').toBe(ids.length);
    for (const front of report.fronts) {
      expect(world.controllerOf(front.holdingId)).toBe(front.to);
    }
  });

  it('does not fight the war for you', () => {
    // Only the world layers run. A mob that fought a hundred battles in an
    // empty room is a random number generator with extra steps.
    const world = fresh();
    const player = world.player;
    const mobs = [...world.entities.values()].filter((e) => e.kind === 'mob');
    const health = new Map(mobs.map((m) => [m.id, m.health]));
    const where = { ...player.pos };
    player.health = 10;
    player.xp = 3;

    world.catchUp(5 * DAY);

    expect(player.health, 'the player healed up while logged out').toBe(10);
    expect(player.xp).toBe(3);
    expect(player.pos).toEqual(where);
    // A dragon landing on a holding clears its garrison, which is the world
    // layer doing its job; everything still standing must be untouched.
    for (const mob of mobs) {
      if (!world.entity(mob.id)) continue;
      expect(mob.health, mob.name).toBe(health.get(mob.id));
    }
  });

  it('says nothing at all about a short absence', () => {
    // Lunch is not an absence. A card that opens on "nothing happened" teaches
    // the player to dismiss the one that will matter.
    const report = fresh().catchUp(4 * 60000);
    expect(report.fronts).toHaveLength(0);
    expect(report.dragons).toHaveLength(0);
  });

  it('caps an absence rather than simulating a year', () => {
    const world = fresh();
    const report = world.catchUp(400 * DAY);
    expect(report.cappedAt).not.toBeNull();
    expect(report.awayMs).toBe(report.cappedAt);
    // And the cap is past convergence, so a year and a fortnight agree.
    const fortnight = fresh();
    fortnight.catchUp(14 * DAY);
    for (const holding of HOLDINGS) {
      expect(world.controllerOf(holding.id), holding.name).toBe(fortnight.controllerOf(holding.id));
    }
    expect(fresh().catchUp(14 * DAY).cappedAt).toBeNull();
  });

  it('keeps every dragon on its round', () => {
    // A step coarser than the shortest phase would let one hunt and roost
    // between two samples, taking ground nobody ever saw it on.
    const world = fresh();
    world.catchUp(2 * DAY);
    for (const def of DRAGONS) {
      const state = world.dragonState(def.id);
      expect(['dormant', 'hunting', 'roosting'], def.name).toContain(state.phase);
      expect(state.remainingMs).toBeGreaterThan(0);
      expect(state.stop).toBeLessThanOrEqual(def.territory.length);
      if (state.phase === 'roosting') {
        expect(def.territory).toContain(state.holdingId);
        // A front under a dragon is stopped, whoever was holding it.
        expect(world.isSuppressed(state.holdingId!)).toBe(true);
      }
    }
    const printed = DRAGONS.map((d) => `${d.name.split(',')[0]} ${world.dragonState(d.id).phase}`);
    console.log(`  after two days away: ${printed.join(', ')}`);
  });

  it('is deterministic, and does not touch the rng', () => {
    // Catch-up runs on elapsed time alone. If it drew from the Rng, the same
    // absence would produce a different world each load — and worse, the next
    // fight you picked would roll differently for having been away.
    const a = fresh();
    const b = fresh();
    const rngBefore = a.rng.state;
    a.catchUp(6 * DAY);
    b.catchUp(6 * DAY);
    expect(a.rng.state).toBe(rngBefore);
    expect(a.serialize()).toBe(b.serialize());
  });

  it('leaves a save that reloads into the world it caught up to', () => {
    const world = fresh();
    world.catchUp(4 * DAY);
    const restored = World.deserialize(world.serialize(), getZone('fenmarch'));
    for (const holding of HOLDINGS) {
      expect(restored.controllerOf(holding.id)).toBe(world.controllerOf(holding.id));
    }
    for (const def of DRAGONS) {
      expect(restored.dragonState(def.id)).toEqual(world.dragonState(def.id));
    }
  });
});

describe('skill points and ability ranks', () => {
  function warrior(level = 10) {
    const world = new World({ seed: 400, zone: emptyZone(), classId: 'warrior' });
    // No ranks: these are tests about spending points, so the character starts
    // having spent none.
    const player = levelPlayer(world, { level, ranks: {} });
    return { world, player };
  }

  it('pays out five attribute points and one skill point a level', () => {
    // Two currencies, and the scarcity of the second is the design: attribute
    // points are the dial you turn every level without thinking, and a skill
    // point is one of the hundred you will ever get.
    const world = new World({ seed: 401, zone: duelZone('moor_hare'), classId: 'warrior' });
    const player = world.player;
    player.xp = xpToNext(1) - 1;
    world.submit(player.id, { t: 'target', id: theMob(world).id });
    world.submit(player.id, { t: 'autoAttack', on: true });
    for (let i = 0; i < 6000 && player.level < 2; i++) world.tick();

    expect(player.level).toBe(2);
    expect(player.unspentPoints).toBe(POINTS_PER_LEVEL);
    expect(player.skillPoints).toBe(SKILL_POINTS_PER_LEVEL);
    expect(POINTS_PER_LEVEL).toBe(5);
    expect(SKILL_POINTS_PER_LEVEL).toBe(1);
  });

  it('spends a point to rank a skill up, and says why when it cannot', () => {
    const { world, player } = warrior();
    player.skillPoints = 2;

    world.submit(player.id, { t: 'rankSkill', skillId: 'strike' });
    const events = world.tick();
    expect(events.some((e) => e.t === 'skillRanked' && e.skillId === 'strike' && e.rank === 1)).toBe(
      true,
    );
    expect(player.skillRanks?.strike).toBe(1);
    expect(player.skillPoints).toBe(1);

    // A skill this character has never learned.
    world.submit(player.id, { t: 'rankSkill', skillId: 'smite' });
    expect(world.tick().some((e) => e.t === 'error' && /have not learned/i.test(e.message))).toBe(
      true,
    );

    // And no points left.
    player.skillPoints = 0;
    world.submit(player.id, { t: 'rankSkill', skillId: 'strike' });
    expect(world.tick().some((e) => e.t === 'error' && /No skill points/i.test(e.message))).toBe(
      true,
    );
    expect(player.skillRanks?.strike).toBe(1);
  });

  it('stops at the cap and says so', () => {
    const { world, player } = warrior();
    player.skillPoints = 40;
    for (let i = 0; i < MAX_SKILL_RANK; i++) {
      world.submit(player.id, { t: 'rankSkill', skillId: 'strike' });
      world.tick();
    }
    expect(player.skillRanks?.strike).toBe(MAX_SKILL_RANK);
    world.submit(player.id, { t: 'rankSkill', skillId: 'strike' });
    expect(world.tick().some((e) => e.t === 'error' && /already mastered/i.test(e.message))).toBe(
      true,
    );
    // The cap is a real ceiling on the multiplier, not just on the counter.
    expect(skillRankPower(MAX_SKILL_RANK + 5)).toBe(skillRankPower(MAX_SKILL_RANK));
  });

  it('makes a ranked skill measurably stronger', () => {
    // The whole point of spending the scarcest currency in the game.
    const hit = (rank: number): number => {
      let total = 0;
      const trials = 60;
      for (let seed = 0; seed < trials; seed++) {
        const world = new World({ seed: seed * 31 + 3, zone: duelZone('bog_wolf', 2), classId: 'warrior' });
        const player = levelPlayer(world, { level: 20, gear: ['iron_longsword'], ranks: {} });
        if (rank > 0) player.skillRanks = { strike: rank };
        const mob = theMob(world);
        world.submit(player.id, { t: 'target', id: mob.id });
        world.submit(player.id, { t: 'useSkill', skillId: 'strike' });
        for (const ev of world.advance(400)) {
          if (ev.t === 'damage' && ev.targetId === mob.id && ev.abilityId === 'strike') {
            total += ev.amount;
          }
        }
      }
      return total / trials;
    };

    const plain = hit(0);
    const mastered = hit(MAX_SKILL_RANK);
    console.log(`  Strike: rank 0 hits for ${plain.toFixed(0)}, rank 10 for ${mastered.toFixed(0)}`);
    // Ten ranks is worth roughly a gear tier on one skill: enough to be a real
    // choice, not enough to make the other fifteen decoration.
    expect(mastered).toBeGreaterThan(plain * 1.3);
    expect(mastered).toBeLessThan(plain * 2.4);
  });

  it('lets a skill land double, and more often when it is mastered', () => {
    // A skill crit is 2x, the same shape as a weapon crit and a bigger number,
    // because it is the moment a cast you chose pays off.
    const critRate = (rank: number): number => {
      let crits = 0;
      let hits = 0;
      for (let seed = 0; seed < 220; seed++) {
        const world = new World({ seed: seed * 17 + 5, zone: duelZone('bog_wolf', 2), classId: 'warrior' });
        const player = levelPlayer(world, { level: 30, gear: ['iron_longsword'], ranks: {} });
        if (rank > 0) player.skillRanks = { strike: rank };
        const mob = theMob(world);
        world.submit(player.id, { t: 'target', id: mob.id });
        world.submit(player.id, { t: 'useSkill', skillId: 'strike' });
        for (const ev of world.advance(400)) {
          if (ev.t === 'damage' && ev.abilityId === 'strike') {
            hits++;
            if (ev.crit) crits++;
          }
        }
      }
      return hits === 0 ? 0 : crits / hits;
    };

    const plain = critRate(0);
    const mastered = critRate(MAX_SKILL_RANK);
    console.log(
      `  Strike crits: rank 0 ${(plain * 100).toFixed(0)}%, rank 10 ${(mastered * 100).toFixed(0)}%`,
    );
    expect(plain, 'skills never crit').toBeGreaterThan(0);
    expect(mastered, 'ranking a skill does not make it crit more').toBeGreaterThan(plain + 0.05);
    // Still uncommon at the cap. A skill that crits half the time is not
    // exciting, it is just a bigger number with extra steps.
    expect(mastered, 'a mastered skill crits routinely').toBeLessThan(0.5);
    expect(SKILL_CRIT_MULTIPLIER).toBe(2);
  });

  it('carries ranks and points across a save', () => {
    const { world, player } = warrior();
    player.skillPoints = 3;
    world.submit(player.id, { t: 'rankSkill', skillId: 'strike' });
    world.tick();
    const restored = World.deserialize(world.serialize(), emptyZone());
    expect(restored.player.skillRanks?.strike).toBe(1);
    expect(restored.player.skillPoints).toBe(2);
  });
});

describe('the reward gradient', () => {
  it('pays more for fighting up and less and less for fighting down', () => {
    // The push. Every level below you is worth nearly a third less than the
    // one above it, all the way down, so a camp you have outgrown stops being
    // worth clearing before it stops being easy.
    const rows: string[] = [];
    let last = Infinity;
    for (const gap of [4, 3, 2, 1, 0, -1, -2, -3, -4, -5, -6, -8, -12]) {
      const value = xpForKill(1000, 50 + gap, 50) / 1000;
      rows.push(`  ${String(gap).padStart(3)} levels: ${(value * 100).toFixed(0)}%`);
      expect(value, `a gap of ${gap} pays more than the level above it`).toBeLessThanOrEqual(last);
      last = value;
    }
    console.log('\nXP BY LEVEL GAP\n' + rows.join('\n'));

    // Fighting up is worth it, and fighting down decays without a cliff in it.
    expect(xpForKill(1000, 53, 50)).toBeGreaterThan(1000);
    expect(xpForKill(1000, 47, 50) / 1000).toBeLessThan(0.45);
    expect(xpForKill(1000, 44, 50) / 1000).toBeLessThan(0.16);
    // No step: each rung is a similar fraction of the one above it.
    for (let gap = -1; gap > -8; gap--) {
      const here = xpForKill(1000, 50 + gap, 50);
      const above = xpForKill(1000, 50 + gap + 1, 50);
      expect(here / above, `a cliff at a gap of ${gap}`).toBeGreaterThan(0.55);
    }
  });

  it('makes a harder creature likelier to be carrying something', () => {
    // "Better things, not more things" was half right: a ★4 that takes four
    // times as long and kills a quarter of the players who pull it should not
    // pay out as rarely as the ★1 beside it.
    for (const stars of [2, 3, 4] as const) {
      expect(STAR_LOOT_MULTIPLIER[stars]).toBeGreaterThan(STAR_LOOT_MULTIPLIER[(stars - 1) as 1]);
    }
    // And bosses are left alone: they hand out guaranteed class weapons.
    expect(STAR_LOOT_MULTIPLIER[5]).toBe(1);
    expect(STAR_LOOT_MULTIPLIER[6]).toBe(1);

    // Measured, not asserted from the table: kill a lot of each and count.
    const gearRate = (mobId: string): number => {
      const world = new World({ seed: 909, zone: duelZone(mobId, 2), classId: 'warrior' });
      const mob = theMob(world);
      const def = getMob(mob.defId!);
      let carried = 0;
      const trials = 3000;
      for (let i = 0; i < trials; i++) {
        world.rollLootFor(mob, world.player);
        if (
          (mob.corpseLoot ?? []).some((s) => {
            const item = getItem(s.itemId);
            return !!item.slot && item.slot !== 'none' && !item.merchantGood;
          })
        ) {
          carried++;
        }
      }
      void def;
      return carried / trials;
    };

    const soft = gearRate('moor_hare');
    const hard = gearRate('marsh_bear');
    console.log(`  gear drops: Moor Hare ★1 ${(soft * 100).toFixed(1)}%, Marsh Bear ★4 ${(hard * 100).toFixed(1)}%`);
    expect(hard, 'a ★4 is no likelier to be carrying gear than a ★1').toBeGreaterThan(soft);
    // And still rare. The ceiling the whole loot design rests on.
    expect(hard).toBeLessThanOrEqual(MAX_EQUIPMENT_DROP_CHANCE + 0.02);
  });
});

describe('star variants', () => {
  it('gives every ordinary creature four ratings, and names them', () => {
    const rows: string[] = [];
    const ordinary = Object.values(MOBS).filter(
      (m) => m.stars < BOSS_STARS && !m.horse && !m.rareOf && !m.dragon && !m.starOf,
    );
    expect(ordinary.length).toBeGreaterThan(20);

    for (const base of ordinary) {
      const family = starVariantsOf(base.id);
      expect(family, `${base.name} has no ratings`).toHaveLength(4);
      const names = family.map((m) => m.name);
      // Four distinct names, so the nameplate tells you which one you pulled.
      expect(new Set(names).size, `${base.name}'s ratings share a name`).toBe(4);
      for (const m of family) {
        // Every rating is the same creature at the same level in the same camp.
        expect(m.level).toBe(base.level);
        expect(m.lootTableId).toBe(base.lootTableId);
        expect(baseMobId(m.id)).toBe(base.id);
      }
      // And harder ratings pay more, which is the reason to take one.
      const sorted = [...family].sort((a, b) => a.stars - b.stars);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]!.xp, `${sorted[i]!.name} pays no more than the rating below`).toBeGreaterThan(
          sorted[i - 1]!.xp,
        );
      }
      if (base.id === 'bog_wolf') rows.push('  ' + names.join('  ·  '));
    }
    console.log('\nSTAR VARIANTS, e.g.\n' + rows.join('\n'));
  });

  it('never puts a rating on a boss, a mount or a named rare', () => {
    // Each of those means something specific. "Gaunt Cadfael" is a joke at the
    // expense of the one thing in the zone that is supposed to land.
    for (const mob of Object.values(MOBS)) {
      if (!mob.starOf) continue;
      const base = getMob(mob.starOf);
      expect(base.stars, `${mob.name} is a rating of a boss`).toBeLessThan(BOSS_STARS);
      expect(base.horse, `${mob.name} is a rating of a mount`).toBeUndefined();
      expect(base.rareOf, `${mob.name} is a rating of a rare`).toBeUndefined();
      expect(base.dragon, `${mob.name} is a rating of a dragon`).toBeUndefined();
      // And nothing is ever a rating of a rating.
      expect(base.starOf, `${mob.name} is a variant of a variant`).toBeUndefined();
    }
  });

  it('spawns a camp as a population rather than eight of the same thing', () => {
    const world = new World({ seed: 500, zone: getZone('fenmarch'), classId: 'warrior' });
    const counts = new Map<number, number>();
    let total = 0;
    for (const e of world.entities.values()) {
      if (e.kind !== 'mob') continue;
      const def = getMob(e.defId!);
      if (def.stars >= BOSS_STARS || def.horse) continue;
      counts.set(def.stars, (counts.get(def.stars) ?? 0) + 1);
      total++;
    }
    const shown = [...counts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([stars, n]) => `★${stars} ${((n / total) * 100).toFixed(0)}%`);
    console.log(`  a fresh Fenmarch: ${shown.join(', ')} of ${total} creatures`);

    // All four ratings present, weighted toward the middle.
    for (const stars of [1, 2, 3, 4]) {
      expect(counts.get(stars) ?? 0, `no ★${stars} anywhere in the zone`).toBeGreaterThan(0);
    }
    expect((counts.get(2) ?? 0) / total, 'the ordinary rating is not the common one').toBeGreaterThan(
      0.3,
    );
    expect((counts.get(4) ?? 0) / total, '★4 is not rare').toBeLessThan(0.2);
  });

  it('counts every rating toward a quest for the creature', () => {
    // A quest for eight Bog Wolves counts the gaunt one and the alpha alike.
    // Resolving on the id instead would mean a player who killed eight wolves
    // of assorted sizes had killed eight of nothing.
    // Whatever the first kill quest in the game happens to ask for, fought at
    // a rating it was not authored with.
    const quest = Object.values(QUESTS).find((q) => q.objectives[0]?.kind === 'kill')!;
    const objective = quest.objectives[0] as { kind: 'kill'; mobId: string; count: number };
    const world = new World({
      seed: 501,
      zone: duelZone(starVariantId(objective.mobId, 4), 2),
      classId: 'warrior',
    });
    const player = levelPlayer(world, { level: 30, gear: ['iron_longsword'] });
    player.quests = [{ questId: quest.id, counts: [0] }];

    const mob = theMob(world);
    expect(getMob(mob.defId!).starOf).toBe(objective.mobId);
    world.submit(player.id, { t: 'target', id: mob.id });
    world.submit(player.id, { t: 'autoAttack', on: true });
    for (let i = 0; i < 4000 && !mob.dead; i++) world.tick();

    expect(mob.dead).toBe(true);
    expect(player.quests[0]!.counts[0], 'the alpha did not count').toBe(1);
  });

  it('stays out of the test arenas', () => {
    // Same reason as rare spawns and adventurers: a duel whose opponent is ★1
    // on one seed and ★4 on the next is measuring the seed.
    const world = new World({ seed: 502, zone: duelZone('bog_wolf'), classId: 'warrior' });
    expect(getMob(theMob(world).defId!).id).toBe('bog_wolf');
  });
});

describe('camps mill about', () => {
  /** A field of creatures far enough from the player that nothing aggros. */
  function grazingZone(mobId: string, count: number) {
    const spawns = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      spawns.push({ mobId, pos: { x: Math.cos(a) * 70, z: Math.sin(a) * 70 } });
    }
    return {
      id: 'test-graze',
      name: 'Test Graze',
      halfSize: 200,
      playerStart: { x: 0, z: 0 },
      spawns,
      vendors: [],
      exits: [],
      levelRange: [1, 100] as [number, number],
      rareSpawns: false,
      adventurers: false,
      starVariants: false,
    };
  }

  function tickFor(world: World, ms: number): void {
    for (let t = 0; t < ms; t += TICK_MS) world.tick();
  }

  it('lets an idle creature wander, and never off its own ground', () => {
    const world = new World({ seed: 71, zone: grazingZone('bog_wolf', 12), classId: 'warrior' });
    const mobs = [...world.entities.values()].filter((e) => e.kind === 'mob');
    expect(mobs.length).toBe(12);
    const limit = roamRadiusFor(getMob(mobs[0]!.defId!).leashRadius);

    tickFor(world, 90000);

    let moved = 0;
    for (const mob of mobs) {
      const home = mob.spawnPos!;
      const d = Math.hypot(mob.pos.x - home.x, mob.pos.z - home.z);
      // Leash is measured from the spawn mark, so anything wandered is chase
      // distance already spent. Past the cap a camp starts pulling itself home
      // the instant it aggros.
      expect(d, `${mob.name} strayed ${d.toFixed(1)}u from its mark`).toBeLessThanOrEqual(limit + 0.3);
      if (d > 0.5) moved++;
    }
    expect(moved, 'a camp stood perfectly still for a minute and a half').toBeGreaterThan(6);
  });

  it('never draws from the stream the fight rolls on', () => {
    // The whole reason a wander is hashed from (id, step) rather than taken
    // from `World.rng`: a camp grazing in the background must not shift a
    // single number in a seeded fight. If this ever fails, every balance
    // figure in the suite quietly became a measurement of the scenery.
    const world = new World({ seed: 404, zone: grazingZone('moor_hare', 8), classId: 'warrior' });
    const before = world.rng.state;
    tickFor(world, 60000);
    const wandered = [...world.entities.values()].some(
      (e) => e.kind === 'mob' && Math.hypot(e.pos.x - e.spawnPos!.x, e.pos.z - e.spawnPos!.z) > 0.5,
    );
    expect(wandered, 'nothing moved, so this test proved nothing').toBe(true);
    expect(world.rng.state, 'roaming spent the combat random stream').toBe(before);
  });

  it('keeps a boss standing on its arena', () => {
    // A telegraph is a flat circle drawn on ground that was levelled for it.
    // A boss that ambled ten metres would draw one down a hillside.
    const world = new World({ seed: 12, zone: grazingZone('old_scar', 1), classId: 'warrior' });
    const boss = [...world.entities.values()].find((e) => e.kind === 'mob')!;
    const home = { ...boss.pos };
    tickFor(world, 60000);
    expect(Math.hypot(boss.pos.x - home.x, boss.pos.z - home.z)).toBe(0);
  });

  it('keeps a garrison standing on the ground it holds', () => {
    // A guard post is the visible half of the territory layer. A watch that
    // wanders is not watching anything.
    const world = new World({ seed: 9, zone: getZone('fenmarch'), classId: 'warrior' });
    const posts = [...world.entities.values()].filter((e) => e.kind === 'mob' && e.holding);
    expect(posts.length).toBeGreaterThan(0);
    const homes = posts.map((p) => ({ ...p.pos }));
    tickFor(world, 40000);
    posts.forEach((post, i) => {
      if (post.dead || post.aiState !== 'idle') return;
      expect(Math.hypot(post.pos.x - homes[i]!.x, post.pos.z - homes[i]!.z)).toBe(0);
    });
  });
});

describe('death costs something', () => {
  const this_max = (world: World, e: Entity): number => world.statsOf(e).maxHealth;

  /** Kill the player outright, the way a bad pull does. */
  function killPlayer(world: World): void {
    const player = world.player;
    const mob = [...world.entities.values()].find((e) => e.kind === 'mob' && !e.dead)!;
    player.health = 1;
    world.submit(player.id, { t: 'target', id: mob.id });
    for (let t = 0; t < 60000 && !player.dead; t += TICK_MS) world.tick();
  }

  it('opens a debt rather than taking a level back', () => {
    const world = new World({ seed: 5, zone: duelZone('marsh_bear', 3), classId: 'warrior' });
    const player = levelPlayer(world, { level: 30 });
    player.xp = 500;
    killPlayer(world);
    expect(player.dead, 'the harness never managed to kill anybody').toBe(true);

    // The two things that must never happen: a level lost, or the bar going
    // backwards. Twenty-eight thousand kills is not something to take away.
    expect(player.level).toBe(30);
    expect(player.xp).toBe(500);
    expect(player.xpDebt!).toBeGreaterThan(0);
    expect(player.xpDebt!).toBeCloseTo(Math.round(xpToNext(30) * DEATH_DEBT_SHARE), -1);
  });

  it('is free while you are still learning which fights are survivable', () => {
    const world = new World({ seed: 6, zone: duelZone('marsh_bear', 3), classId: 'warrior' });
    const player = levelPlayer(world, { level: DEBT_FROM_LEVEL - 1 });
    killPlayer(world);
    expect(player.dead).toBe(true);
    expect(player.xpDebt ?? 0).toBe(0);
    // The body is still marked, so the map does not lie about where you died.
    expect(player.deathSpot?.zoneId).toBe('test-duel');
  });

  it('pays the debt down out of kills, and never stops you moving forward', () => {
    // A level-appropriate creature, deliberately: a level-30 character killing
    // a level-1 hare earns nothing at all by design, and measuring the debt
    // against that measures the xp curve, not the debt.
    const world = new World({ seed: 7, zone: duelZone('outlaw_reaver', 3), classId: 'warrior' });
    const player = levelPlayer(world, { level: 16, gear: gearSetFor('warrior', 16) });
    player.xpDebt = 4000;
    const before = player.xp ?? 0;
    const owedBefore = player.xpDebt;

    world.submit(player.id, { t: 'autoAttack', on: true });
    const mob = [...world.entities.values()].find((e) => e.kind === 'mob')!;
    world.submit(player.id, { t: 'target', id: mob.id });
    // Held on its last point of health until a swing lands. This measures the
    // accounting, not whether a level-16 warrior wins the fight.
    for (let t = 0; t < 60000 && !mob.dead; t += TICK_MS) {
      mob.health = 1;
      player.health = this_max(world, player);
      world.tick();
    }
    expect(mob.dead).toBe(true);

    expect(player.xpDebt!, 'the kill paid nothing off').toBeLessThan(owedBefore);
    expect(player.xp!, 'the kill moved you backwards').toBeGreaterThan(before);
  });

  it('caps what a losing streak can dig', () => {
    const world = new World({ seed: 8, zone: duelZone('marsh_bear', 3), classId: 'warrior' });
    const player = levelPlayer(world, { level: 30 });
    for (let i = 0; i < 6; i++) {
      world.submit(player.id, { t: 'respawn' });
      world.tick();
      killPlayer(world);
    }
    // Otherwise a bad night digs a hole deeper than the level took to earn,
    // which is "you lost a level" wearing a different name.
    expect(player.xpDebt!).toBeLessThanOrEqual(xpToNext(30) * DEBT_CAP_LEVELS);
  });

  it('gives the walk back a point', () => {
    const world = new World({ seed: 9, zone: duelZone('marsh_bear', 3), classId: 'warrior' });
    const player = levelPlayer(world, { level: 30 });
    killPlayer(world);
    const spot = player.deathSpot!;
    world.submit(player.id, { t: 'respawn' });
    world.tick();
    expect(player.xpDebt!).toBeGreaterThan(0);

    // Too far is a named failure, not a silent no-op.
    player.pos = { x: spot.pos.x + 40, z: spot.pos.z };
    world.submit(player.id, { t: 'reclaim' });
    let events = world.tick();
    expect(events.some((e) => e.t === 'error' && /fell/i.test(e.message))).toBe(true);
    expect(player.xpDebt!).toBeGreaterThan(0);

    player.pos = { ...spot.pos };
    world.submit(player.id, { t: 'reclaim' });
    events = world.tick();
    expect(events.some((e) => e.t === 'debt' && e.kind === 'reclaimed')).toBe(true);
    expect(player.xpDebt).toBe(0);
    expect(player.deathSpot).toBe(null);
  });

  it('prices a death in kills, at every band', () => {
    // Printed, not just asserted. "35% of a level" means nothing until it is
    // "about nine boars", which is the unit a player actually experiences.
    const rows: string[] = [];
    for (const level of [DEBT_FROM_LEVEL - 1, 12, 22, 40, 70, 99]) {
      const def = grindMobFor(level);
      const perKill = xpForKill(def.xp, def.level, level);
      const debt = deathDebt(level, xpToNext(level));
      const levelKills = killsForLevel(level);
      // Two different numbers, and the difference is the whole design. You
      // grind `owedKills` before the bar moves at full speed again, but half
      // of those kills were progress — so what the death actually cost you is
      // `lostKills`, and it is never more than that.
      const owedKills = debt / (perKill * DEBT_REPAY_SHARE);
      const lostKills = debt / perKill;
      rows.push(
        `  lv${String(level).padEnd(3)} ${def.name.padEnd(22)}` +
          ` ${String(debt).padStart(8)} owed = ${lostKills.toFixed(0).padStart(4)} kills lost` +
          ` over ${owedKills.toFixed(0).padStart(4)} slow ones` +
          ` (a level is ${levelKills})`,
      );
      if (level < DEBT_FROM_LEVEL) {
        expect(debt, 'learning to die was charged for').toBe(0);
        continue;
      }
      // The claim under test is that a death costs the same *share* of the
      // level it happened in at every band. Price it off a flat number instead
      // of `xpToNext` and this fails at both ends at once — trivial at 99,
      // ruinous at 12 — which is exactly the failure that made every other
      // fixed constant in this game get scaled.
      expect(lostKills / levelKills, `a death at ${level} is mispriced`).toBeGreaterThan(0.2);
      expect(lostKills / levelKills, `a death at ${level} is mispriced`).toBeLessThan(0.5);
    }
    console.log('\nWHAT A DEATH COSTS\n' + rows.join('\n'));
  });
});

describe('the sun moves, and so does the weather', () => {
  it('never lets a zone get too dark to fight in', () => {
    // The rule that outranks the atmosphere. Caer Dubh was once authored at
    // true dusk and shipped with the mobs as black shapes on a black hill; a
    // day cycle is a much better way to make that mistake, because it only
    // happens for a few minutes at a time and only to whoever was online.
    let darkest = 1;
    for (let ms = 0; ms < DAY_LENGTH_MS; ms += DAY_LENGTH_MS / 240) {
      const light = daylightAt(ms);
      expect(light.light, `light at ${clockOf(light)}`).toBeGreaterThanOrEqual(NIGHT_FLOOR);
      expect(light.light).toBeLessThanOrEqual(1);
      darkest = Math.min(darkest, light.light);
    }
    // And it has to actually get dark, or the whole cycle is decoration.
    expect(darkest, 'midnight is as bright as noon').toBeLessThan(0.7);
  });

  it('runs a whole day and names every part of it', () => {
    const seen = new Set<string>();
    const rows: string[] = [];
    for (let i = 0; i < 24; i++) {
      const light = daylightAt((DAY_LENGTH_MS * i) / 24);
      seen.add(light.phase);
      rows.push(`  ${clockOf(light)}  ${light.phase.padEnd(6)} light ${light.light.toFixed(2)}`);
    }
    console.log('\nA DAY IN THE FENMARCH\n' + rows.join('\n'));
    expect([...seen].sort()).toEqual(['dawn', 'day', 'dusk', 'night']);
  });

  it('keeps the clock in the sim, so a fortnight away moves it', () => {
    const ticked = new World({ seed: 1, zone: emptyZone(), classId: 'warrior' });
    const caught = new World({ seed: 1, zone: emptyZone(), classId: 'warrior' });
    const twoHours = 2 * 60 * 60 * 1000;

    ticked.advance(twoHours);
    caught.catchUp(twoHours);
    // Same rule, coarser step — the same argument territory drift is made on.
    expect(caught.worldTimeMs).toBeCloseTo(ticked.worldTimeMs, -2);
    expect(caught.daylight().phase).toBe(ticked.daylight().phase);
  });

  it('remembers what time it is across a save', () => {
    const world = new World({ seed: 2, zone: emptyZone(), classId: 'warrior' });
    world.advance(60000);
    const at = world.worldTimeMs;
    const back = World.deserialize(world.serialize(), FENMARCH);
    expect(back.worldTimeMs).toBe(at);
  });

  it('never spends the fight\'s random stream on the sky', () => {
    // Same rule the roaming creatures run under, and for the same reason: an
    // ambient system that draws from `World.rng` turns every balance figure in
    // the suite into a measurement of the scenery.
    const world = new World({ seed: 3, zone: emptyZone(), classId: 'warrior' });
    const before = world.rng.state;
    world.advance(DAY_LENGTH_MS / 4);
    expect(world.daylight().phase).not.toBe(daylightAt(0).phase);
    expect(world.rng.state).toBe(before);
  });

  it('makes the dark a reason to be somewhere else', () => {
    // The one gameplay consequence, and one is enough: it makes crossing a
    // zone at night a decision, and it needs no tooltip to explain.
    const day = new World({ seed: 4, zone: duelZone('bog_wolf', 26), classId: 'warrior' });
    const night = new World({ seed: 4, zone: duelZone('bog_wolf', 26), classId: 'warrior' });
    const radius = getMob('bog_wolf').aggroRadius;
    const mob = (w: World) => [...w.entities.values()].find((e) => e.kind === 'mob')!;
    // Stand just outside what it would notice by day, and inside what it
    // notices in the dark.
    for (const [world, t] of [
      [day, DAY_LENGTH_MS * 0.5],
      [night, DAY_LENGTH_MS * 0.02],
    ] as Array<[World, number]>) {
      world.worldTimeMs = t;
      mob(world).pos = { x: radius * 1.15, z: 0 };
      mob(world).spawnPos = { x: radius * 1.15, z: 0 };
      world.advance(2000);
    }
    expect(day.daylight().dark).toBe(false);
    expect(night.daylight().dark).toBe(true);
    expect(mob(day).aiState, 'it saw you in broad daylight from too far').toBe('idle');
    expect(mob(night).aiState, 'the dark changed nothing').not.toBe('idle');
  });

  it('gives every zone weather that changes, and never the same weather forever', () => {
    const rows: string[] = [];
    for (const zoneId of Object.keys(ZONES)) {
      const kinds = new Map<string, number>();
      for (let ms = 0; ms < DAY_LENGTH_MS * 8; ms += 30000) {
        const w = weatherAt(zoneId, ms);
        kinds.set(w.kind, (kinds.get(w.kind) ?? 0) + 1);
        expect(w.intensity).toBeGreaterThanOrEqual(0);
        expect(w.intensity).toBeLessThanOrEqual(1);
      }
      const total = [...kinds.values()].reduce((a, b) => a + b, 0);
      const share = [...kinds.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${k} ${Math.round((n / total) * 100)}%`)
        .join(', ');
      rows.push(`  ${zoneId.padEnd(10)} ${share}`);
      expect(kinds.size, `${zoneId} has one kind of sky`).toBeGreaterThan(2);
      // And it is the same every time, from nothing but the clock.
      expect(weatherAt(zoneId, 12345678)).toEqual(weatherAt(zoneId, 12345678));
    }
    console.log('\nEIGHT DAYS OF SKY\n' + rows.join('\n'));
  });
});

describe('art can be dropped in', () => {
  it('names a real creature for every model listed', () => {
    // The failure this exists for is silent: a key with a typo simply never
    // matches anything, the game never looks for the file, and the creature
    // stays a capsule with no explanation anywhere.
    for (const [key, def] of Object.entries(MODELS)) {
      const [kind, id] = key.split(':');
      expect(['mob', 'class', 'vendor'], `${key} has an unknown kind`).toContain(kind);
      if (kind === 'mob') expect(MOBS[id!], `${key} is not a creature`).toBeDefined();
      if (kind === 'class') expect(PLAYABLE_CLASSES, `${key} is not a class`).toContain(id);
      if (kind === 'vendor') expect(VENDORS[id!], `${key} is not a trader`).toBeDefined();
      expect(def.file, `${key} points outside public/models`).toMatch(/^models\//);
      expect(def.file).toMatch(/\.(glb|gltf)$/);
      // A model scaled far off the capsule it replaces breaks every measurement
      // taken against it: nameplate height, telegraph radius, click target.
      expect(def.scale ?? 1).toBeGreaterThan(0.4);
      expect(def.scale ?? 1).toBeLessThan(2.5);
    }
  });

  it('finds the right clip whatever the exporter called it', () => {
    const typical = ['Idle', 'Walk_Loop', 'RunFast', 'Attack01', 'Death'];
    expect(clipFor('idle', typical)).toBe('Idle');
    expect(clipFor('walk', typical)).toBe('Walk_Loop');
    expect(clipFor('run', typical)).toBe('RunFast');
    expect(clipFor('attack', typical)).toBe('Attack01');
    expect(clipFor('death', typical)).toBe('Death');
    // No cast clip in the file: fall back to idle rather than to nothing, so a
    // caster with partial art stands there rather than snapping to a T-pose.
    expect(clipFor('cast', typical)).toBe('Idle');
  });

  it('falls back rather than freezing when the art is incomplete', () => {
    // A model with only an idle is still an enormous improvement on a capsule
    // and must not be punished for being unfinished.
    const sparse = ['idle'];
    for (const state of ['idle', 'walk', 'run', 'attack', 'cast', 'hit', 'death'] as const) {
      expect(clipFor(state, sparse), `${state} found nothing`).toBe('idle');
    }
    // And walk borrows run rather than standing still mid-stride.
    expect(clipFor('walk', ['run'])).toBe('run');
    expect(clipFor('run', ['walk'])).toBe('walk');
    // Nothing at all is nothing at all — the caller keeps the capsule.
    expect(clipFor('idle', [])).toBeUndefined();
  });

  it('lets an exporter that names everything Take 001 be told explicitly', () => {
    const useless = ['Take 001', 'Take 002'];
    expect(clipFor('idle', useless, { idle: 'Take 002' })).toBe('Take 002');
    // An override naming a clip that is not in the file is ignored, not
    // obeyed: a stale manifest entry should degrade, not break.
    expect(clipFor('idle', useless, { idle: 'Nope' })).toBe('Take 001');
  });
});

describe('the renderer answers for the flat sim', () => {
  it('wades a creature rather than walking it along the lake bed', () => {
    // The sim is flat and stays flat: nothing in `sim/` samples a height, and
    // a test above enforces it. A creature chased across a tarn therefore
    // walks straight through it — which is fine, and would look fine, except
    // that drawing it at ground height puts it four metres under the surface.
    //
    // Wading is entirely the renderer's business, and this is the check that
    // it happens: same answer as the ground on dry land, water line in a lake.
    const theme = getTheme('plains');
    const water = theme.terrain.waterLevel!;
    const field = new HeightField(theme.terrain, []);

    let foundLake = false;
    let foundLand = false;
    for (let x = -1400; x <= 1400 && !(foundLake && foundLand); x += 37) {
      for (let z = -1400; z <= 1400; z += 37) {
        const ground = field.at(x, z);
        const stand = field.standHeight(x, z);
        if (ground < water - 2) {
          foundLake = true;
          // Never on the bottom, and never floating over the surface.
          expect(stand, `standing under ${(water - stand).toFixed(1)}m of water`).toBeGreaterThan(
            ground,
          );
          expect(stand).toBeLessThanOrEqual(water);
          expect(water - stand, 'wading too deep to read as wading').toBeLessThan(0.8);
        } else if (ground > water + 3) {
          foundLand = true;
          // On dry ground it must not move anything at all.
          expect(stand).toBe(ground);
        }
      }
    }
    expect(foundLake, 'no lake in the Fenmarch to test against').toBe(true);
    expect(foundLand).toBe(true);
  });
});

describe('every creature has a shape', () => {
  /**
   * The whole bestiary was a capsule. A wolf, a stag, an outlaw, a heron and a
   * dragon were the same object in five colours, so the only way to tell what
   * was walking at you was to read its nameplate — and a nameplate is the most
   * expensive way a 3D game can answer a question a silhouette answers free.
   *
   * These tests are the half a screenshot cannot do. `tools/bestiary.mjs` is
   * the other half, and it found the two bugs that mattered: a head placed
   * inside its own ribcage, and a rare spawn resolving to a capsule while
   * standing in a camp of the creature it is meant to be a bigger version of.
   */
  it('resolves one for every creature that spawns in a zone', () => {
    const missing: string[] = [];
    const table = new Map<string, string[]>();
    for (const zone of Object.values(ZONES)) {
      for (const spawn of zone.spawns) {
        const def = getMob(spawn.mobId);
        const plan = bodyPlanFor(def);
        if (plan.id === 'blob') missing.push(`${zone.id}: ${def.name} (${def.id})`);
        const row = table.get(plan.id) ?? [];
        if (!row.includes(def.name)) row.push(def.name);
        table.set(plan.id, row);
      }
    }
    // Printed rather than only asserted: two creatures landing on a plan that
    // is obviously wrong for one of them is the failure this catches, and no
    // assertion can spot it.
    console.log('\n  body plans');
    for (const [planId, names] of [...table].sort()) {
      console.log(`    ${planId.padEnd(9)} ${names.slice(0, 5).join(', ')}${names.length > 5 ? ` +${names.length - 5}` : ''}`);
    }
    expect(missing, `creatures with no shape: ${missing.join('; ')}`).toEqual([]);
  });

  it('puts what you are actually carrying in your hands', () => {
    // Every other piece of gear in this game is a number in a panel. A weapon
    // is the one you are looking at all game, and a character who picks up a
    // spear and goes on swinging the same abstract blade has an equipment
    // screen that might as well be a spreadsheet.
    const table = new Map<string, string[]>();
    for (const item of Object.values(ITEMS)) {
      if (item.slot !== 'weapon') continue;
      const look = weaponLookFor(item.name, item.classes?.[0]);
      expect(weaponParts(look).length, `${item.name} resolves a shape with nothing in it`)
        .toBeGreaterThan(0);
      const row = table.get(look) ?? [];
      row.push(item.name);
      table.set(look, row);
    }
    console.log('\n  weapon shapes');
    for (const [look, names] of [...table].sort()) {
      console.log(`    ${look.padEnd(11)} ${names.length.toString().padStart(3)}  ${names.slice(0, 4).join(', ')}`);
    }
    // Not one shape for every weapon in the game. If a ladder ever lands on a
    // single look, "my new sword" and "my old sword" become the same picture.
    expect(table.size).toBeGreaterThan(4);
  });

  it('reads a whole word before a fragment of one', () => {
    // A rare spawn's epithet is a made-up word glued onto a real one, and it
    // collides: `Mirefang Bow` matched `fang` before `bow` and the Ranger's
    // signature longbow came out as a knife.
    expect(weaponLookFor('Mirefang Bow', 'ranger')).toBe('bow');
    expect(weaponLookFor('Mirefang Rod', 'mage')).toBe('staff');
    expect(weaponLookFor('Mirefang Dirk', 'rogue')).toBe('dagger');
    // And a single made-up word still finds the real one inside it.
    expect(weaponLookFor('Fenblade', 'warrior')).toBe('blade');
  });

  it('gives every class a weapon even when its name says nothing', () => {
    for (const cls of PLAYABLE_CLASSES) {
      const look = weaponLookFor(undefined, cls.id);
      expect(look, `${cls.id} falls back to nothing`).not.toBe('none');
      expect(weaponParts(look).length).toBeGreaterThan(0);
    }
  });

  it('makes the three offhands three different objects', () => {
    // The offhand is the most build choice in the game — a blade, a bulwark or
    // a grimoire is three characters — which is exactly why it is the slot
    // that most has to be visible.
    const looks = new Set<string>();
    for (const item of Object.values(ITEMS)) {
      if (item.slot !== 'offhand') continue;
      const look = offhandLookFor(item.name);
      expect(look, `${item.name} is carried as nothing`).not.toBe('none');
      expect(offhandParts(look).length).toBeGreaterThan(0);
      looks.add(look);
    }
    expect(looks.size, `offhands all look alike: ${[...looks]}`).toBe(3);
  });

  it('has a metal for every quality an item can be', () => {
    // A missing entry is a weapon that silently falls back to common — which
    // reads as "my epic looks like my starter blade", the exact opposite of
    // what this is for.
    for (const item of Object.values(ITEMS)) {
      expect(QUALITY_METAL[item.quality], `no metal for ${item.quality}`).toBeDefined();
    }
    expect(new Set(Object.values(QUALITY_METAL)).size).toBe(Object.keys(QUALITY_METAL).length);
  });

  it('gives the four dragons the only shape with wings on it', () => {
    // Dragons never appear in a zone's spawn list — they live in world state —
    // so the walk above cannot see them, and the one creature in the game that
    // most has to look like itself would have gone out as a capsule.
    for (const def of DRAGONS) {
      const plan = bodyPlanFor(getMob(dragonMobId(def)));
      expect(plan.id, `${def.name} is not shaped like a dragon`).toBe('wyrm');
    }
    const wings = BODY_PLANS.wyrm.parts.filter((p) => p.mirror === 'wingL');
    expect(wings.length, 'a wyrm with no wings is a big lizard').toBeGreaterThan(0);
  });

  it('gives a rare spawn the shape of the creature it replaces', () => {
    // A named rare is the same animal as the camp mob, one star up. Its own id
    // says nothing about what it looks like, so resolving on the id alone put
    // `Mirefang the Bog Wolf` on screen as a capsule standing among wolves.
    for (const spec of RARES) {
      const rare = getMob(rareMobId(spec));
      const host = getMob(spec.hostMobId);
      expect(bodyPlanFor(rare).id, `${rare.name} does not look like a ${host.name}`)
        .toBe(bodyPlanFor(host).id);
    }
  });

  it('keeps every part inside the creature it belongs to', () => {
    // Everything is authored in units of the creature's own height, so a plan
    // that strays far outside that box is a typo — a decimal point in the
    // wrong place is a tail three creatures long, and it renders as a spear
    // through whatever is standing behind it.
    for (const plan of Object.values(BODY_PLANS)) {
      for (const part of plan.parts) {
        const reach = Math.max(...part.size.map(Math.abs)) + Math.max(...part.at.map(Math.abs));
        expect(reach, `${plan.id} has a part reaching ${reach.toFixed(2)} of its own height`)
          .toBeLessThan(2.6);
        expect(part.at[1], `${plan.id} has a part below the ground`).toBeGreaterThan(-0.2);
      }
    }
  });

  it('mirrors what it mirrors, and only off the centre line', () => {
    // A plan cannot grow a left ear without a right one, which is the mistake
    // that is obvious in a screenshot and invisible in a diff. The reverse is
    // the one that is invisible in both: a mirrored part sitting ON the centre
    // line is two copies of itself in the same place, z-fighting.
    for (const plan of Object.values(BODY_PLANS)) {
      for (const part of plan.parts) {
        if (!part.mirror) continue;
        expect(Math.abs(part.at[0]), `${plan.id} mirrors a part standing on the centre line`)
          .toBeGreaterThan(0.02);
        expect(part.joint, `${plan.id} mirrors a part with no joint of its own`).toBeDefined();
      }
    }
  });

  it('stands every plan on the ground and gives it a described silhouette', () => {
    for (const plan of Object.values(BODY_PLANS)) {
      expect(plan.parts.length, `${plan.id} is empty`).toBeGreaterThan(0);
      expect(plan.reads.length, `${plan.id} does not say what it reads as`).toBeGreaterThan(10);
      // The pivot is where the body leans and how far it drops when it dies.
      // Above its own height means a creature that topples into the sky.
      expect(plan.pivot).toBeGreaterThan(0);
      expect(plan.pivot).toBeLessThan(1);
      const lowest = Math.min(...plan.parts.map((p) => p.at[1] - p.size[1] / 2));
      expect(lowest, `${plan.id} floats ${lowest.toFixed(2)} above its own feet`).toBeLessThan(0.12);
    }
  });

  it('puts a weapon in every hand, and a different shape on each class', () => {
    const seen = new Map<string, string>();
    for (const cls of PLAYABLE_CLASSES) {
      const plan = bodyPlanForClass(cls.id);
      seen.set(cls.id, plan.id);
      // Two legs and two arms, or the gait has nothing to move.
      const joints = new Set(plan.parts.flatMap((p) => [p.joint, p.mirror].filter(Boolean)));
      expect(joints.has('legL') && joints.has('legR'), `${cls.id} has no legs`).toBe(true);
      expect(joints.has('armL') && joints.has('armR'), `${cls.id} has no arms`).toBe(true);
    }
    console.log(`\n  classes  ${[...seen].map(([c, p]) => `${c}=${p}`).join('  ')}`);
    // Not one shape for all five: what somebody is carrying is the only thing
    // that says which class an adventurer across the camp is playing.
    expect(new Set(seen.values()).size).toBeGreaterThan(2);
  });
});

describe('the first sixty seconds', () => {
  /**
   * The one moment on a three-kilometre map that every single player sees.
   *
   * Measured from a fresh character, the nearest creature was **179 units
   * away** while the only line on screen said "click a beast to attack".
   * `ARRIVAL_GAP` had already been shortened once to fix exactly this and did
   * not, because the camps sit 165 units *off* the road: moving the road's
   * start does not bring anything nearer to it.
   */
  const arrivals = (zone: (typeof ZONES)[string]) =>
    zone.spawns.filter((sp) => sp.plain);

  it('puts something to fight in front of a new character', () => {
    console.log('\n  the walk to the first fight');
    for (const zone of Object.values(ZONES)) {
      const gaps = zone.spawns
        .filter((sp) => !sp.guardOf && !sp.holding)
        .map((sp) => Math.hypot(sp.pos.x - zone.playerStart.x, sp.pos.z - zone.playerStart.z))
        .sort((a, b) => a - b);
      const nearest = gaps[0] ?? Infinity;
      const first = arrivals(zone)[0]!;
      console.log(
        `    ${zone.id.padEnd(10)} nearest ${Math.round(nearest)}m  ` +
          `${getMob(first.mobId).name} ★${getMob(first.mobId).stars}`,
      );
      // Within sight, so the opening line can actually be obeyed.
      expect(nearest, `${zone.name} makes you walk ${Math.round(nearest)}m to find anything`)
        .toBeLessThan(45);
      expect(arrivals(zone).length, `${zone.name} has no arrival creatures`).toBeGreaterThan(1);
    }
  });

  it('never lets the opening walk up and start the fight for you', () => {
    // Waking up already in combat, before the controls have been read, is the
    // worst possible first thirty seconds. Every arrival creature stands
    // outside its own aggro plus its own roam.
    for (const zone of Object.values(ZONES)) {
      for (const sp of arrivals(zone)) {
        const def = getMob(sp.mobId);
        const gap = Math.hypot(sp.pos.x - zone.playerStart.x, sp.pos.z - zone.playerStart.z);
        expect(gap, `${def.name} can reach the arrival point in ${zone.name}`)
          .toBeGreaterThan(def.aggroRadius + ROAM_RADIUS);
      }
    }
  });

  it('makes the first fight the gentlest thing in the zone', () => {
    for (const zone of Object.values(ZONES)) {
      const ordinary = zone.spawns
        .filter((sp) => !sp.guardOf && !sp.holding && !sp.plain)
        .map((sp) => getMob(sp.mobId))
        .filter((m) => m.stars < BOSS_STARS && !m.horse && !m.dragon);
      const easiest = Math.min(...ordinary.map((m) => m.level * 10 + m.stars));
      for (const sp of arrivals(zone)) {
        const def = getMob(sp.mobId);
        expect(def.level * 10 + def.stars, `${zone.name} opens on a ${def.name}`).toBe(easiest);
      }
    }
  });

  it('does not roll a star variant on the creature you meet first', () => {
    // A ★4 Scarred Moor Hare has four times an ordinary one's health. Meeting
    // it as the first fight you ever have, before the word "star" means
    // anything, makes the game's opening a coin flip.
    const world = new World({ seed: 4, zone: getZone('fenmarch'), classId: 'warrior' });
    const start = world.zone.playerStart;
    const opening = [...world.entities.values()].filter(
      (e) => e.kind === 'mob' && Math.hypot(e.pos.x - start.x, e.pos.z - start.z) < 45,
    );
    expect(opening.length).toBeGreaterThan(1);
    for (const e of opening) {
      const def = getMob(e.defId!);
      expect(def.rareOf, `${def.name} is a variant standing in the opening`).toBeUndefined();
      expect(e.plainSpawn).toBe(true);
    }

    // And it survives the respawn timer, which re-rolls from the entity and
    // has no way back to the spawn point that made it.
    const one = opening[0]!;
    one.dead = true;
    one.respawnInMs = 1;
    for (let i = 0; i < 4; i++) world.tick();
    expect(getMob(one.defId!).rareOf).toBeUndefined();
    expect(getMob(one.defId!).stars).toBe(getMob(one.defId!).stars);
    expect(one.name).toBe(getMob(one.defId!).name);
  });
});

describe('can I win this fight', () => {
  /**
   * The one question a player asks of everything on screen.
   *
   * The map has always answered it with a colour; the nameplate over the
   * creature's head — the thing you are actually looking at while deciding
   * whether to pull — was not coloured at all, and nothing anywhere said what
   * the colours meant. Worse, the map's scale read the level gap alone, which
   * is exactly the thing stars exist to work around.
   */
  it('counts stars, because that is what stars are for', () => {
    // A ★4 at your own level and a ★1 at your own level are the same colour on
    // a level-only scale and a very different afternoon.
    const even = threatBand(threatGap(20, 1, 20));
    const nasty = threatBand(threatGap(20, 4, 20));
    expect(even).toBe('even');
    expect(nasty).not.toBe('even');
    expect(threatGap(20, 4, 20)).toBeGreaterThan(threatGap(20, 1, 20));
  });

  it('runs the whole scale rather than bunching at one end', () => {
    const bands = new Set<string>();
    for (let gap = -12; gap <= 12; gap++) bands.add(threatBand(gap));
    expect(bands.size).toBe(5);
  });

  it('never rates a boss as an even fight', () => {
    // ★5 and ★6 are the two things in the game you are meant to bring friends
    // to, in a game with no friends in it.
    for (const zone of Object.values(ZONES)) {
      for (const sp of zone.spawns) {
        const def = getMob(sp.mobId);
        if (!isBoss(def.stars)) continue;
        // Even at the boss's own level, which is the earliest anyone sensibly
        // fights one.
        const band = threatBand(threatGap(def.level, def.stars, def.level));
        expect(band, `${def.name} reads as ${band} at level ${def.level}`).toBe('deadly');
      }
    }
  });

  it('prints how every camp reads to a character at its own level', () => {
    // The table is the point. A scale where the whole Fenmarch reads "even" is
    // a scale that says nothing, and no single assertion can see that.
    const counts = new Map<string, number>();
    for (const zone of Object.values(ZONES)) {
      const band = zone.levelRange;
      const at = Math.round((band[0] + band[1]) / 2);
      const seen = new Map<string, string>();
      for (const sp of zone.spawns) {
        const def = getMob(sp.mobId);
        if (isBoss(def.stars) || def.horse || def.dragon) continue;
        seen.set(def.name, threatBand(threatGap(def.level, def.stars, at)));
      }
      const tally = new Map<string, number>();
      for (const b of seen.values()) tally.set(b, (tally.get(b) ?? 0) + 1);
      for (const [b, n] of tally) counts.set(b, (counts.get(b) ?? 0) + n);
      console.log(
        `    ${zone.id.padEnd(10)} at lv${String(at).padStart(3)}  ` +
          [...tally].sort().map(([b, n]) => `${b} ${n}`).join(', '),
      );
    }
    // Every band has to be reachable from somewhere in the game, or it is a
    // colour that never appears.
    expect(counts.size).toBeGreaterThanOrEqual(4);
  });

  it('gives every band its own word and its own colour', () => {
    const words = Object.values(THREAT_WORDS);
    expect(new Set(words).size).toBe(words.length);
    for (const w of words) expect(w.length).toBeGreaterThan(3);
  });
});

describe('things worth walking to', () => {
  /**
   * Three kilometres of ground had two reasons to be crossed: a camp at the
   * far end, and an arrow pointing at it. Landmarks existed and were
   * navigation furniture — you steered by the watchtower, you never went to
   * it. A discovery is the opposite of a camp: once ever, found rather than
   * farmed, and paying in something no kill can drop.
   */
  function fresh(zoneId = 'fenmarch'): World {
    return new World({ seed: 99, zone: getZone(zoneId), classId: 'warrior' });
  }

  function walkTo(world: World, site: { pos: { x: number; z: number } }): void {
    world.player.pos = { ...site.pos };
  }

  it('puts some in every zone, of both kinds, and prints them', () => {
    console.log('\n  discoveries');
    for (const zoneId of Object.keys(ZONES)) {
      const world = fresh(zoneId);
      const kinds = new Map<string, number>();
      for (const s of world.sites) kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1);
      console.log(
        `    ${zoneId.padEnd(10)} ${String(world.sites.length).padStart(2)} sites  ` +
          [...kinds].sort().map(([k, n]) => `${k} ${n}`).join(', '),
      );
      expect(world.sites.length, `${zoneId} has nothing to find`).toBeGreaterThan(3);
      expect(kinds.get('boon') ?? 0, `${zoneId} has no blessings`).toBeGreaterThan(0);
      expect(kinds.get('cache') ?? 0, `${zoneId} has nothing left behind`).toBeGreaterThan(0);
    }
  });

  it('leaves some landmarks holding nothing', () => {
    // If every cairn paid out, a cairn would be a vending machine and walking
    // to one would be a chore. The ones that hold nothing are what make the
    // ones that do feel found.
    const world = fresh();
    const landmarks = zoneStructures(world.zone).filter(
      (st) => st.kind === 'cairn' || st.kind === 'farmstead' || st.kind === 'stoneCircle',
    );
    expect(landmarks.length).toBeGreaterThan(world.sites.length);
  });

  it('pays once, ever', () => {
    const world = fresh();
    const cache = world.sites.find((s) => s.kind === 'cache')!;
    walkTo(world, cache);
    world.player.gold = 0;

    world.submit(world.playerId, { t: 'search' });
    world.tick();
    const first = world.player.gold ?? 0;
    expect(first).toBeGreaterThan(0);

    world.submit(world.playerId, { t: 'search' });
    world.tick();
    expect(world.player.gold, 'a discovery you can farm is a grinding spot').toBe(first);
  });

  it('says so rather than doing nothing, when there is nothing here', () => {
    // Every mount failure names the mistake for the same reason: "nothing
    // happened" reads as a broken key.
    const world = fresh();
    world.player.pos = { x: 0, z: 0 };
    world.submit(world.playerId, { t: 'search' });
    const events = world.tick();
    expect(events.some((e) => e.t === 'error')).toBe(true);
  });

  it('never draws from the combat stream', () => {
    // The lesson roaming and the weather both had to learn. What a site holds
    // is hashed from where it stands, so two players who walk to the same
    // cairn find the same thing — and a blessing taken mid-grind cannot change
    // the numbers of the next fight.
    // Against a control that ticks identically without searching, because a
    // tick moves the Rng for a hundred other reasons — creatures deciding
    // where to walk, adventurers deciding what to say.
    const world = fresh();
    const control = fresh();
    const site = world.sites[0]!;
    walkTo(world, site);
    walkTo(control, site);

    world.submit(world.playerId, { t: 'search' });
    world.tick();
    control.tick();

    expect(world.found[site.id]).toBe(true);
    expect(world.rng.state, 'searching moved the Rng').toBe(control.rng.state);
  });

  it('never pays in equipment', () => {
    // Every piece of gear is earned off a drop table, a boss or a trader. A
    // chest in a field that beat any of those would make all three pointless.
    const world = fresh();
    for (const site of world.sites) {
      walkTo(world, site);
      world.submit(world.playerId, { t: 'search' });
      world.tick();
    }
    expect((world.player.inventory ?? []).length).toBe(0);
  });

  it('gives a blessing that runs out', () => {
    const world = fresh();
    const boon = world.sites.find((s) => s.kind === 'boon')!;
    walkTo(world, boon);
    world.submit(world.playerId, { t: 'search' });
    world.tick();

    const on = world.player.effects.find((e) => e.sourceAbilityId === boon.boon!.id);
    expect(on, 'the blessing did not land').toBeDefined();
    expect(on!.remainingMs).toBeGreaterThan(5 * 60_000);
    // Worth using rather than banking: it runs from the moment you take it.
    on!.remainingMs = 60;
    world.tick();
    world.tick();
    expect(world.player.effects.some((e) => e.sourceAbilityId === boon.boon!.id)).toBe(false);
  });

  it('remembers what you opened, across a save and across a zone', () => {
    const world = fresh();
    const site = world.sites[0]!;
    walkTo(world, site);
    world.submit(world.playerId, { t: 'search' });
    world.tick();

    const back = World.deserialize(world.serialize(), world.zone);
    expect(back.found[site.id], 'the world forgot what you found').toBe(true);
    expect(back.openSites().some((s) => s.id === site.id)).toBe(false);

    // And going away and coming back does not reset it: a site's id carries
    // its zone, so `found` is never cleared on travel.
    back.travelTo('ardmoor');
    back.travelTo('fenmarch');
    expect(back.found[site.id]).toBe(true);
  });

  it('agrees with the renderer about where the landmarks are', () => {
    // The sim and the renderer both call `zoneStructures`, rather than one
    // being handed the other's list — which is what makes a headless world's
    // discoveries independent of whether anybody drew them.
    for (const zone of Object.values(ZONES)) {
      const a = zoneStructures(zone);
      const b = zoneStructures(zone);
      expect(a.length).toBe(b.length);
      for (const [i, st] of a.entries()) {
        expect(st.pos.x).toBe(b[i]!.pos.x);
        expect(st.kind).toBe(b[i]!.kind);
      }
    }
  });

  it('keeps them clear of everything you fight in', () => {
    // A landmark already keeps `STRUCTURE_CLEARANCE` from every camp, and a
    // discovery inherits that: standing still to search while a camp pulls you
    // is not a discovery, it is an ambush.
    for (const zoneId of Object.keys(ZONES)) {
      const world = fresh(zoneId);
      for (const site of world.sites) {
        for (const sp of world.zone.spawns) {
          const def = getMob(sp.mobId);
          const gap = Math.hypot(sp.pos.x - site.pos.x, sp.pos.z - site.pos.z);
          expect(
            gap,
            `a ${site.structure} in ${zoneId} sits ${Math.round(gap)}m from a ${def.name}`,
          ).toBeGreaterThan(def.aggroRadius + ROAM_RADIUS);
        }
      }
    }
  });

  it('prints what a cache is worth in kills', () => {
    // Measured, like everything else here. A cache should be a good half hour,
    // not a shortcut past one — and not a rounding error either.
    console.log('\n  what a cache pays');
    for (const zoneId of Object.keys(ZONES)) {
      const world = fresh(zoneId);
      const band = world.zone.levelRange;
      const level = Math.round((band[0] + band[1]) / 2);
      const purse = goldForKill(level, 1);
      const perKill = (purse.min + purse.max) / 2;
      const caches = world.sites.filter((s) => s.kind === 'cache');
      const kills = caches.map((c) => c.worth);
      const gold = kills.map((k) => Math.round(perKill * k));
      console.log(
        `    ${zoneId.padEnd(10)} ${caches.length} caches, ` +
          `${Math.min(...gold).toLocaleString()}–${Math.max(...gold).toLocaleString()}g ` +
          `(${Math.min(...kills)}–${Math.max(...kills)} kills each)`,
      );
      for (const k of kills) {
        expect(k, 'a cache worth almost nothing is not worth walking to').toBeGreaterThan(10);
        expect(k, 'a cache should not skip a session of grinding').toBeLessThan(45);
      }
    }
  });
});

describe('the answer you can actually reach', () => {
  /**
   * Sixteen consumables, a two-clock cooldown system built so chaining them is
   * impossible, and a balance test measuring exactly how much they save you —
   * and no key drank one. The whole system was reachable only by opening the
   * backpack and clicking, which nobody has ever done while something was
   * hitting them.
   */
  it('offers the best of each family you can actually drink', () => {
    const world = new World({ seed: 3, zone: getZone('fenmarch'), classId: 'warrior' });
    const player = world.player;
    player.level = 20;

    const drinkable = (family: 'potion' | 'elixir') =>
      Object.values(ITEMS).filter((i) => i.consumable?.family === family);
    const potions = drinkable('potion').sort((a, b) => a.value - b.value);
    const low = potions[0]!;
    const high = potions[potions.length - 1]!;

    world.addItem(player, { itemId: low.id, qty: 2 });
    expect(bestDrink(player, 'potion')).toBe(low.id);

    // The better one wins — but only if it is one this character can drink.
    // The belt offered a level-66 salve to a level-24 character on the first
    // pass and the key then refused it, which is worse than an empty belt:
    // an empty belt at least tells the truth.
    world.addItem(player, { itemId: high.id, qty: 1 });
    const chosen = bestDrink(player, 'potion')!;
    expect((getItem(chosen).reqLevel ?? 1)).toBeLessThanOrEqual(player.level);

    // And it never offers the wrong family.
    expect(getItem(chosen).consumable?.family).toBe('potion');
    expect(bestDrink(player, 'elixir')).toBeNull();
  });

  it('drinks it, spends it, and refuses the next one', () => {
    const world = new World({ seed: 3, zone: getZone('fenmarch'), classId: 'warrior' });
    const player = world.player;
    player.level = 20;
    const potion = Object.values(ITEMS)
      .filter((i) => i.consumable?.family === 'potion' && (i.reqLevel ?? 1) <= 20)
      .sort((a, b) => b.value - a.value)[0]!;
    world.addItem(player, { itemId: potion.id, qty: 3 });

    const first = bestDrink(player, 'potion')!;
    world.submit(player.id, { t: 'use', itemId: first });
    world.tick();
    expect((player.inventory ?? []).find((s) => s.itemId === first)?.qty).toBe(2);
    expect(player.consumableCooldowns?.potion ?? 0).toBeGreaterThan(0);

    // The two clocks are the whole decision the system was built to create.
    world.submit(player.id, { t: 'use', itemId: first });
    world.tick();
    expect(
      (player.inventory ?? []).find((s) => s.itemId === first)?.qty,
      'a consumable you can chain is a health bar with extra steps',
    ).toBe(2);
  });

  it('has something to drink at every level of the game', () => {
    // A belt that is empty for forty levels is a belt nobody looks at.
    console.log('\n  what is on the belt');
    for (const level of [1, 10, 25, 40, 55, 70, 85, 100]) {
      const bag = Object.values(ITEMS)
        .filter((i) => i.consumable && (i.reqLevel ?? 1) <= level)
        .map((i) => ({ itemId: i.id, qty: 1 }));
      const holder = { level, inventory: bag };
      const potion = bestDrink(holder, 'potion');
      const elixir = bestDrink(holder, 'elixir');
      console.log(
        `    lv${String(level).padStart(3)}  ${potion ? getItem(potion).name : '—'}` +
          `  ·  ${elixir ? getItem(elixir).name : '—'}`,
      );
      expect(potion, `nothing to drink at level ${level}`).not.toBeNull();
      expect(elixir, `no elixir at level ${level}`).not.toBeNull();
    }
  });
});

describe('the reckoning', () => {
  /**
   * The whole design of this game is twenty-eight thousand kills, and it kept
   * no record of a single one of them. A grind you cannot see is a grind that
   * feels like nothing is happening — and it is the number the design is
   * proudest of, hidden from the only person doing it.
   */
  function killWith(world: World, mobId: string): void {
    const mob = world.spawnMobForTest(mobId, { x: 2, z: 0 });
    mob.health = 1;
    world.player.pos = { x: 0, z: 0 };
    world.submit(world.playerId, { t: 'target', id: mob.id });
    world.submit(world.playerId, { t: 'autoAttack', on: true });
    for (let i = 0; i < 200 && !mob.dead; i++) {
      mob.health = 1;
      world.tick();
    }
    world.submit(world.playerId, { t: 'autoAttack', on: false });
    world.tick();
  }

  it('counts a variant and a rare as the creature they are', () => {
    // A player thinks in creatures, not in ratings: a Gaunt Bog Wolf, a
    // Snarling one and `Mirefang the Bog Wolf` are all Bog Wolves, and a
    // bestiary that lists them separately is a list of internal ids.
    const world = new World({ seed: 8, zone: duelZone('bog_wolf'), classId: 'warrior' });
    levelPlayer(world, { level: 30 });
    const start = [...world.entities.values()].find((e) => e.kind === 'mob')!;
    start.dead = true;
    start.respawnInMs = 999999;

    killWith(world, 'bog_wolf');
    killWith(world, starVariantId('bog_wolf', 3));
    const rare = RARES.find((r) => r.hostMobId === 'bog_wolf');
    if (rare) killWith(world, rareMobId(rare));

    const slain = world.player.slain ?? {};
    expect(Object.keys(slain), `counted as ${Object.keys(slain).join(', ')}`).toEqual(['bog_wolf']);
    expect(slain.bog_wolf).toBe(rare ? 3 : 2);
    if (rare) {
      expect(world.player.namedSlain, 'the named one was lost in the tally')
        .toContain(rareMobId(rare));
    }
  });

  it('remembers the worst moments, and keeps them across a save', () => {
    const world = new World({ seed: 8, zone: duelZone('bog_wolf'), classId: 'warrior' });
    levelPlayer(world, { level: 30 });
    killWith(world, 'bog_wolf');
    expect(world.player.record?.biggestHit ?? 0).toBeGreaterThan(0);

    const back = World.deserialize(world.serialize(), world.zone);
    expect(back.player.slain?.bog_wolf).toBe(world.player.slain?.bog_wolf);
    expect(back.player.record?.biggestHit).toBe(world.player.record?.biggestHit);
  });

  it('never records anything for a creature somebody else killed', () => {
    // The adventurers fight abstractly and must never touch your tally, the
    // same way they must never touch your loot.
    const world = new World({ seed: 8, zone: getZone('fenmarch'), classId: 'warrior' });
    for (let i = 0; i < 400; i++) world.tick();
    expect(Object.keys(world.player.slain ?? {}).length).toBe(0);
  });
});
