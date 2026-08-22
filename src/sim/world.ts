/**
 * The authoritative game simulation.
 *
 * Rules of this module:
 *  - No imports from `render/`. No DOM. No three.js. No wall-clock time.
 *  - All randomness goes through `this.rng`.
 *  - The only inbound mutation path is `submit()` + `tick()`.
 *  - The only outbound signal is the SimEvent array returned by `tick()`.
 *
 * Those four rules are what make this file reusable as a server authority if
 * the project ever goes multiplayer. Breaking them is how that door closes.
 */
import { Rng } from './rng.js';
import {
  GCD_MS,
  TICK_MS,
  addAttributes,
  applyItem,
  deriveMobStats,
  deriveStats,
  dist,
  emptyAttributes,
  energyRegenPerSec,
  healthRegenPerSec,
  POINTS_PER_LEVEL,
  MAX_LEVEL,
  PRIMARY_ATTRIBUTE,
  goldForKill,
  castBreakChance,
  resolveAttack,
  scaledDefenseBonus,
  threatFromDamage,
  xpForKill,
  xpToNext,
} from './formulas.js';
import type {
  ActiveEffect,
  ActorCommand,
  Attributes,
  Command,
  DerivedStats,
  Entity,
  EntityId,
  EquipSlot,
  ItemStack,
  MobAbilityDef,
  QuestObjective,
  SimEvent,
  SkillDef,
  Vec2,
} from './types.js';
import { canEquip, getItem } from '../content/items.js';
import { getLootTable, getMob } from '../content/mobs.js';
import { getSkill, skillsForClass } from '../content/skills.js';
import { buyPrice, getVendor, sellPrice } from '../content/vendors.js';
import { CLASSES, ZONES, getZone, type ZoneDef } from '../content/zone.js';
import { getQuest, questsAvailableFrom } from '../content/quests.js';

/** Distance within which a corpse can be looted. */
const LOOT_RANGE = 4.5;

/** Distance within which a player can trade with a vendor. */
const VENDOR_RANGE = 5.5;

/** Distance within which a zone exit can be used. */
const TRAVEL_RANGE = 6;

/** How much each incoming hit delays an interruptible cast. */
const CAST_PUSHBACK_MS = 400;

/** How many counts an objective needs. Reach/level steps are one-and-done. */
function neededFor(objective: QuestObjective): number {
  if (objective.kind === 'kill') return objective.count;
  if (objective.kind === 'collect') return objective.count;
  return 1;
}

/** Time since last damage dealt/taken that still counts as "in combat". */
const COMBAT_TIMEOUT_MS = 6000;

/** Save format version. Bump when the Entity shape changes. */
const SAVE_VERSION = 4;

export interface WorldOptions {
  seed: number;
  zone: ZoneDef;
  classId: keyof typeof CLASSES;
  playerName?: string;
}

export class World {
  /** The zone currently loaded. Mutable: `travelTo` swaps it. */
  zone: ZoneDef;
  rng: Rng;
  tickCount = 0;
  entities = new Map<EntityId, Entity>();
  playerId: EntityId = 0;

  private nextId = 1;
  private queue: ActorCommand[] = [];
  private events: SimEvent[] = [];
  /** tickCount at which each entity was last in combat. */
  private lastCombatTick = new Map<EntityId, number>();

  constructor(opts: WorldOptions) {
    this.zone = opts.zone;
    this.rng = new Rng(opts.seed);
    this.spawnPlayer(opts.classId, opts.playerName ?? 'Wanderer');
    for (const sp of this.zone.spawns) this.spawnMob(sp.mobId, sp.pos);
    for (const v of this.zone.vendors ?? []) this.spawnVendor(v.vendorId, v.pos);
  }

  // ------------------------------------------------------------------ setup

  private spawnPlayer(classId: keyof typeof CLASSES, name: string): void {
    const def = CLASSES[classId];
    const id = this.nextId++;
    this.playerId = id;
    const player: Entity = {
      id,
      kind: 'player',
      name,
      level: 1,
      pos: { ...this.zone.playerStart },
      facing: Math.PI,
      health: 1,
      energy: 1,
      dead: false,
      respawnInMs: 0,
      targetId: null,
      autoAttack: false,
      swingCooldownMs: 0,
      effects: [],
      classId: def.id,
      xp: 0,
      gold: 0,
      attributes: { ...def.baseAttributes },
      unspentPoints: 0,
      inventory: [],
      equipment: { weapon: def.startingWeapon },
      skillCooldowns: {},
      gcdMs: 0,
      cast: null,
      moveDir: { x: 0, z: 0 },
    };
    this.entities.set(id, player);
    const stats = this.statsOf(player);
    player.health = stats.maxHealth;
    player.energy = stats.maxEnergy;
  }

  private spawnMob(defId: string, pos: Vec2, summonedBy?: EntityId): Entity {
    const def = getMob(defId);
    const id = this.nextId++;
    const mob: Entity = {
      id,
      kind: 'mob',
      name: def.name,
      level: def.level,
      pos: { ...pos },
      facing: 0,
      health: 1,
      energy: 100,
      dead: false,
      respawnInMs: 0,
      targetId: null,
      autoAttack: true,
      swingCooldownMs: 0,
      effects: [],
      cast: null,
      defId,
      spawnPos: { ...pos },
      aiState: 'idle',
      threat: {},
      abilityCooldowns: {},
      abilityLockouts: {},
      firedAbilities: [],
      corpseLoot: [],
      corpseGold: 0,
      ...(summonedBy !== undefined ? { summonedBy } : {}),
    };
    this.entities.set(id, mob);
    mob.health = this.statsOf(mob).maxHealth;
    return mob;
  }

  /**
   * A trader. Inert by design: no AI, no threat, cannot be damaged. It exists
   * so the economy has a counterparty.
   */
  private spawnVendor(vendorId: string, pos: Vec2): Entity {
    const def = getVendor(vendorId);
    const id = this.nextId++;
    const vendor: Entity = {
      id,
      kind: 'vendor',
      name: def.name,
      level: 0,
      pos: { ...pos },
      facing: Math.PI,
      health: 1,
      energy: 1,
      dead: false,
      respawnInMs: 0,
      targetId: null,
      autoAttack: false,
      swingCooldownMs: 0,
      effects: [],
      cast: null,
      vendorId,
    };
    this.entities.set(id, vendor);
    return vendor;
  }

  // --------------------------------------------------------------- accessors

  get player(): Entity {
    const p = this.entities.get(this.playerId);
    if (!p) throw new Error('player entity missing');
    return p;
  }

  entity(id: EntityId): Entity | undefined {
    return this.entities.get(id);
  }

  /** True if the entity has dealt or taken damage recently. */
  inCombat(id: EntityId): boolean {
    const last = this.lastCombatTick.get(id);
    if (last === undefined) return false;
    return (this.tickCount - last) * TICK_MS < COMBAT_TIMEOUT_MS;
  }

  /**
   * Full derived stat block, including gear and active buffs.
   * Recomputed on demand — cheap at this entity count, and never stale.
   */
  statsOf(e: Entity): DerivedStats {
    let stats: DerivedStats;
    if (e.kind === 'mob') {
      stats = deriveMobStats(getMob(e.defId!));
    } else {
      const acc = { attributes: { ...(e.attributes ?? emptyAttributes()) }, armor: 0 };
      let weapon = {
        damageMin: 1,
        damageMax: 3,
        damageType: 'physical' as const,
        swingMs: 2000,
        attackRange: 2.2,
      };
      for (const slot of Object.keys(e.equipment ?? {}) as EquipSlot[]) {
        const itemId = e.equipment?.[slot];
        if (!itemId) continue;
        const item = getItem(itemId);
        applyItem(acc, item);
        if (slot === 'weapon') {
          weapon = {
            damageMin: item.damageMin ?? weapon.damageMin,
            damageMax: item.damageMax ?? weapon.damageMax,
            damageType: (item.damageType ?? 'physical') as 'physical',
            swingMs: item.swingMs ?? weapon.swingMs,
            attackRange: item.attackRange ?? weapon.attackRange,
          };
        }
      }
      stats = deriveStats({
        level: e.level,
        attributes: acc.attributes,
        primaryAttribute: PRIMARY_ATTRIBUTE[e.classId ?? 'warrior'],
        armor: acc.armor,
        weapon,
      });
    }

    // Buffs are additive on defence and multiplicative on outgoing damage.
    let damageMultiplier = 1;
    for (const eff of e.effects) {
      if (eff.kind !== 'buff') continue;
      stats.defense += scaledDefenseBonus(eff.defenseBonus ?? 0, e.level);
      damageMultiplier *= eff.damageMultiplier ?? 1;
    }
    if (damageMultiplier !== 1) {
      stats.damageMin *= damageMultiplier;
      stats.damageMax *= damageMultiplier;
    }
    return stats;
  }

  /** Attributes including gear, for display. */
  displayAttributes(e: Entity): Attributes {
    let attrs = { ...(e.attributes ?? emptyAttributes()) };
    for (const itemId of Object.values(e.equipment ?? {})) {
      if (!itemId) continue;
      const item = getItem(itemId);
      if (item.attributes) attrs = addAttributes(attrs, item.attributes);
    }
    return attrs;
  }

  // ---------------------------------------------------------------- commands

  submit(actorId: EntityId, cmd: Command): void {
    this.queue.push({ actorId, cmd });
  }

  private applyCommand(actorId: EntityId, cmd: Command): void {
    const e = this.entities.get(actorId);
    if (!e) return;

    // Dead entities may only respawn. Server-side this is the validation seam.
    if (e.dead && cmd.t !== 'respawn') return;

    switch (cmd.t) {
      case 'move': {
        const len = Math.hypot(cmd.dir.x, cmd.dir.z);
        e.moveDir = len > 0 ? { x: cmd.dir.x / len, z: cmd.dir.z / len } : { x: 0, z: 0 };
        // Moving cancels an interruptible cast, as it does in most tab-target games.
        if (e.cast && e.cast.kind === 'skill' && getSkill(e.cast.id).interruptible && len > 0) {
          this.events.push({
            t: 'castInterrupted',
            sourceId: e.id,
            kind: 'skill',
            id: e.cast.id,
          });
          e.cast = null;
        }
        break;
      }
      case 'face':
        e.facing = cmd.facing;
        break;
      case 'target': {
        if (cmd.id === null) {
          e.targetId = null;
          break;
        }
        const target = this.entities.get(cmd.id);
        if (target && target.id !== e.id) e.targetId = cmd.id;
        break;
      }
      case 'autoAttack':
        e.autoAttack = cmd.on;
        break;
      case 'useSkill':
        this.tryUseSkill(e, cmd.skillId);
        break;
      case 'loot':
        this.tryLoot(e, cmd.id);
        break;
      case 'equip':
        this.tryEquip(e, cmd.itemId);
        break;
      case 'unequip':
        this.tryUnequip(e, cmd.slot);
        break;
      case 'spendPoint':
        if ((e.unspentPoints ?? 0) > 0 && e.attributes) {
          e.attributes[cmd.attr] += 1;
          e.unspentPoints = (e.unspentPoints ?? 0) - 1;
        }
        break;
      case 'sell':
        this.trySell(e, cmd.vendorId, cmd.itemId, cmd.qty);
        break;
      case 'buy':
        this.tryBuy(e, cmd.vendorId, cmd.itemId);
        break;
      case 'acceptQuest':
        this.tryAcceptQuest(e, cmd.vendorId, cmd.questId);
        break;
      case 'turnInQuest':
        this.tryTurnInQuest(e, cmd.vendorId, cmd.questId);
        break;
      case 'abandonQuest':
        this.abandonQuest(e, cmd.questId);
        break;
      case 'travel':
        this.tryTravel(e, cmd.toZoneId);
        break;
      case 'respawn':
        if (e.dead && e.kind === 'player') this.respawnPlayer(e);
        break;
    }
  }

  // ------------------------------------------------------------------- tick

  /** Advance the world by exactly one TICK_MS and return everything that happened. */
  tick(): SimEvent[] {
    this.events = [];
    this.tickCount++;

    const pending = this.queue;
    this.queue = [];
    for (const { actorId, cmd } of pending) this.applyCommand(actorId, cmd);

    this.tickCooldowns();
    this.tickEffects();
    this.tickCasts();
    this.tickAi();
    this.tickMobAbilities();
    this.tickMovement();
    this.tickSwings();
    this.tickRegen();
    this.tickRespawns();

    return this.events;
  }

  /** Convenience for tests: run `ms` worth of ticks, collecting all events. */
  advance(ms: number): SimEvent[] {
    const out: SimEvent[] = [];
    const ticks = Math.round(ms / TICK_MS);
    for (let i = 0; i < ticks; i++) out.push(...this.tick());
    return out;
  }

  private tickCooldowns(): void {
    for (const e of this.entities.values()) {
      if (e.gcdMs !== undefined && e.gcdMs > 0) e.gcdMs = Math.max(0, e.gcdMs - TICK_MS);
      for (const bag of [e.skillCooldowns, e.abilityCooldowns, e.abilityLockouts]) {
        if (!bag) continue;
        for (const id of Object.keys(bag)) {
          const remaining = (bag[id] ?? 0) - TICK_MS;
          if (remaining <= 0) delete bag[id];
          else bag[id] = remaining;
        }
      }
    }
  }

  private tickEffects(): void {
    for (const e of this.entities.values()) {
      if (e.effects.length === 0) continue;
      const keep: ActiveEffect[] = [];
      for (const eff of e.effects) {
        eff.remainingMs -= TICK_MS;
        eff.sinceTickMs += TICK_MS;
        if (eff.kind === 'dot' && eff.sinceTickMs >= eff.tickMs && !e.dead) {
          eff.sinceTickMs -= eff.tickMs;
          // DoTs bypass mitigation — that is what makes them worth a slot.
          this.applyDamage(
            eff.sourceId,
            e,
            Math.round(eff.dotPower ?? 0),
            false,
            eff.damageType,
            eff.sourceAbilityId,
            'never',
          );
        }
        if (eff.remainingMs > 0) keep.push(eff);
      }
      e.effects = keep;
    }
  }

  private tickCasts(): void {
    for (const e of this.entities.values()) {
      if (!e.cast || e.dead) continue;
      e.cast.remainingMs -= TICK_MS;
      if (e.cast.remainingMs > 0) continue;
      const { kind, id, targetId } = e.cast;
      e.cast = null;
      this.events.push({ t: 'castComplete', sourceId: e.id, kind, id });
      if (kind === 'skill') this.applySkillEffect(e, getSkill(id), targetId);
      else this.resolveMobAbility(e, id);
    }
  }

  private tickAi(): void {
    for (const e of this.entities.values()) {
      if (e.kind !== 'mob' || e.dead) continue;
      const def = getMob(e.defId!);
      const spawn = e.spawnPos!;

      // Leash check runs first: a mob dragged too far always goes home.
      if (e.aiState === 'chasing' || e.aiState === 'attacking') {
        if (dist(e.pos.x, e.pos.z, spawn.x, spawn.z) > def.leashRadius) {
          this.leashMob(e);
          continue;
        }
      }

      switch (e.aiState) {
        case 'idle': {
          const player = this.player;
          if (
            !player.dead &&
            dist(e.pos.x, e.pos.z, player.pos.x, player.pos.z) <= def.aggroRadius
          ) {
            e.targetId = player.id;
            e.threat![player.id] = 1;
            e.aiState = 'chasing';
            this.events.push({ t: 'aggro', mobId: e.id, targetId: player.id });
          }
          break;
        }
        case 'chasing':
        case 'attacking': {
          const target = this.highestThreatTarget(e);
          if (!target || target.dead) {
            this.leashMob(e);
            break;
          }
          e.targetId = target.id;
          const d = dist(e.pos.x, e.pos.z, target.pos.x, target.pos.z);
          e.aiState = d <= this.statsOf(e).attackRange ? 'attacking' : 'chasing';
          e.facing = Math.atan2(target.pos.x - e.pos.x, target.pos.z - e.pos.z);
          break;
        }
        case 'returning': {
          const d = dist(e.pos.x, e.pos.z, spawn.x, spawn.z);
          if (d < 0.5) {
            e.aiState = 'idle';
            e.health = this.statsOf(e).maxHealth;
            e.effects = [];
            e.firedAbilities = [];
          }
          break;
        }
      }
    }
  }

  /** Send a mob home, drop its threat, and clean up anything it called in. */
  private leashMob(mob: Entity): void {
    mob.aiState = 'returning';
    mob.targetId = null;
    mob.threat = {};
    mob.cast = null;
    this.despawnSummonsOf(mob.id);
    this.events.push({ t: 'leash', mobId: mob.id });
  }

  private highestThreatTarget(mob: Entity): Entity | undefined {
    let bestId: EntityId | null = null;
    let best = -Infinity;
    for (const [idStr, threat] of Object.entries(mob.threat ?? {})) {
      const id = Number(idStr);
      const candidate = this.entities.get(id);
      if (!candidate || candidate.dead) continue;
      if (threat > best) {
        best = threat;
        bestId = id;
      }
    }
    return bestId === null ? undefined : this.entities.get(bestId);
  }

  // -------------------------------------------------------------- abilities

  /**
   * Pick and start mob abilities.
   *
   * Ordinary mobs have none — this is what separates a boss from a big normal
   * mob. Threshold abilities (enrage) fire once per life; the rest run on
   * cooldown while the mob is engaged.
   */
  private tickMobAbilities(): void {
    for (const e of this.entities.values()) {
      if (e.kind !== 'mob' || e.dead || e.cast) continue;
      if (e.aiState !== 'chasing' && e.aiState !== 'attacking') continue;
      const def = getMob(e.defId!);
      if (!def.abilities?.length) continue;

      const stats = this.statsOf(e);
      for (const ability of def.abilities) {
        if ((e.abilityCooldowns?.[ability.id] ?? 0) > 0) continue;
        // Locked out by a player interrupt.
        if ((e.abilityLockouts?.[ability.id] ?? 0) > 0) continue;

        if (ability.healthThreshold !== undefined) {
          // One-shot: only when crossing the threshold, and only once per life.
          if (e.firedAbilities?.includes(ability.id)) continue;
          if (e.health / stats.maxHealth > ability.healthThreshold) continue;
          e.firedAbilities = [...(e.firedAbilities ?? []), ability.id];
        }

        e.abilityCooldowns = e.abilityCooldowns ?? {};
        e.abilityCooldowns[ability.id] = ability.cooldownMs;

        if (ability.castMs > 0) {
          e.cast = {
            kind: 'ability',
            id: ability.id,
            remainingMs: ability.castMs,
            totalMs: ability.castMs,
            targetId: e.targetId,
          };
          this.events.push({
            t: 'castBegin',
            sourceId: e.id,
            kind: 'ability',
            id: ability.id,
            durationMs: ability.castMs,
          });
          this.events.push({
            t: 'telegraph',
            sourceId: e.id,
            abilityId: ability.id,
            name: ability.name,
            // A non-AoE telegraph still wants a visible marker; 0 means "no circle".
            radius: ability.radius ?? 0,
            durationMs: ability.castMs,
            text: ability.telegraphText,
          });
        } else {
          this.resolveMobAbility(e, ability.id);
        }
        // One ability per tick keeps a boss from dumping its whole kit at once.
        break;
      }
    }
  }

  private findAbility(mob: Entity, abilityId: string): MobAbilityDef | undefined {
    return getMob(mob.defId!).abilities?.find((a) => a.id === abilityId);
  }

  private resolveMobAbility(mob: Entity, abilityId: string): void {
    const ability = this.findAbility(mob, abilityId);
    if (!ability || mob.dead) return;
    const stats = this.statsOf(mob);

    switch (ability.kind) {
      case 'heavySlam': {
        const radius = ability.radius ?? 5;
        // The mob is rooted while casting, so its current position is the same
        // one the telegraph was drawn at — that is what makes this fair.
        for (const target of [...this.entities.values()]) {
          if (target.kind !== 'player' || target.dead) continue;
          const d = dist(mob.pos.x, mob.pos.z, target.pos.x, target.pos.z);
          if (d > radius) {
            this.events.push({
              t: 'dodged',
              sourceId: mob.id,
              targetId: target.id,
              abilityId,
            });
            continue;
          }
          const result = resolveAttack(this.rng, stats, this.statsOf(target), {
            levelDiff: mob.level - target.level,
            attackerLevel: mob.level,
            weaponMultiplier: ability.damageMultiplier ?? 2,
            flatPower: 0,
            alwaysHits: true,
          });
          // A telegraphed slam is exactly the kind of hit you are meant to
          // plan a cast around, so it always breaks one.
          this.applyDamage(
            mob.id,
            target,
            result.amount,
            result.crit,
            stats.damageType,
            abilityId,
            'always',
          );
        }
        break;
      }
      case 'enrage': {
        this.addEffect(mob, {
          id: `enrage:${abilityId}`,
          kind: 'buff',
          sourceId: mob.id,
          sourceAbilityId: abilityId,
          remainingMs: ability.enrageDurationMs ?? 600000,
          tickMs: 1000,
          sinceTickMs: 0,
          damageType: stats.damageType,
          damageMultiplier: ability.enrageDamageMultiplier ?? 1.4,
        });
        this.events.push({ t: 'enraged', entityId: mob.id, abilityId });
        break;
      }
      case 'summon': {
        const count = ability.summonCount ?? 2;
        const spawnedIds: EntityId[] = [];
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2 + this.rng.next() * 0.5;
          const add = this.spawnMob(
            ability.summonMobId!,
            { x: mob.pos.x + Math.cos(angle) * 4, z: mob.pos.z + Math.sin(angle) * 4 },
            mob.id,
          );
          // Adds join the fight immediately rather than idling until aggroed.
          const target = this.entities.get(mob.targetId ?? -1);
          if (target) {
            add.aiState = 'chasing';
            add.targetId = target.id;
            add.threat = { [target.id]: 1 };
            this.events.push({ t: 'aggro', mobId: add.id, targetId: target.id });
          }
          this.events.push({ t: 'spawn', entityId: add.id });
          spawnedIds.push(add.id);
        }
        this.events.push({ t: 'summoned', sourceId: mob.id, spawnedIds });
        break;
      }
      case 'mend': {
        const amount = Math.round(stats.maxHealth * (ability.healFraction ?? 0.1));
        const before = mob.health;
        mob.health = Math.min(stats.maxHealth, mob.health + amount);
        this.events.push({
          t: 'heal',
          sourceId: mob.id,
          targetId: mob.id,
          amount: Math.round(mob.health - before),
        });
        break;
      }
    }
  }

  /** Remove every add called in by `summonerId`. */
  private despawnSummonsOf(summonerId: EntityId): void {
    const doomed: EntityId[] = [];
    for (const e of this.entities.values()) {
      if (e.summonedBy === summonerId) doomed.push(e.id);
    }
    for (const id of doomed) {
      this.entities.delete(id);
      this.events.push({ t: 'despawn', entityId: id });
    }
  }

  // -------------------------------------------------------------- movement

  private tickMovement(): void {
    const dt = TICK_MS / 1000;
    const limit = this.zone.halfSize;

    for (const e of this.entities.values()) {
      if (e.dead || e.kind === 'vendor') continue;
      const stats = this.statsOf(e);

      if (e.kind === 'player') {
        const dir = e.moveDir ?? { x: 0, z: 0 };
        if (dir.x !== 0 || dir.z !== 0) {
          e.pos.x += dir.x * stats.moveSpeed * dt;
          e.pos.z += dir.z * stats.moveSpeed * dt;
          e.facing = Math.atan2(dir.x, dir.z);
        }
      } else {
        // Casting mobs are rooted. This is what makes a telegraphed AoE
        // dodgeable: the danger circle stays where it was drawn.
        if (e.cast) continue;

        let goal: Vec2 | null = null;
        let stopAt = 0;
        if (e.aiState === 'chasing') {
          const target = this.entities.get(e.targetId ?? -1);
          if (target) {
            goal = target.pos;
            // Stop just inside weapon range so the mob doesn't jitter on the edge.
            stopAt = stats.attackRange * 0.85;
          }
        } else if (e.aiState === 'returning') {
          goal = e.spawnPos!;
          stopAt = 0.2;
        }
        if (goal) {
          const dx = goal.x - e.pos.x;
          const dz = goal.z - e.pos.z;
          const d = Math.hypot(dx, dz);
          if (d > stopAt) {
            const step = Math.min(stats.moveSpeed * dt, d - stopAt);
            e.pos.x += (dx / d) * step;
            e.pos.z += (dz / d) * step;
            e.facing = Math.atan2(dx, dz);
          }
        }
      }

      e.pos.x = Math.max(-limit, Math.min(limit, e.pos.x));
      e.pos.z = Math.max(-limit, Math.min(limit, e.pos.z));
    }
  }

  private tickSwings(): void {
    for (const e of this.entities.values()) {
      if (e.dead || !e.autoAttack) continue;
      if (e.swingCooldownMs > 0) e.swingCooldownMs -= TICK_MS;
      if (e.swingCooldownMs > 0) continue;
      // Casting locks out auto-attack, so a cast is a real commitment.
      if (e.cast) continue;

      const target = this.entities.get(e.targetId ?? -1);
      if (!target || target.dead || target.id === e.id) continue;
      const stats = this.statsOf(e);
      if (dist(e.pos.x, e.pos.z, target.pos.x, target.pos.z) > stats.attackRange) continue;

      e.swingCooldownMs = stats.swingMs;
      e.facing = Math.atan2(target.pos.x - e.pos.x, target.pos.z - e.pos.z);
      this.events.push({ t: 'swing', sourceId: e.id, targetId: target.id });

      const result = resolveAttack(this.rng, stats, this.statsOf(target), {
        levelDiff: e.level - target.level,
        attackerLevel: e.level,
        weaponMultiplier: 1,
        flatPower: 0,
      });
      if (!result.hit) {
        this.events.push({ t: 'miss', sourceId: e.id, targetId: target.id });
        this.markCombat(e.id);
        this.markCombat(target.id);
        continue;
      }
      this.applyDamage(e.id, target, result.amount, result.crit, stats.damageType, null);
    }
  }

  private tickRegen(): void {
    const dt = TICK_MS / 1000;
    for (const e of this.entities.values()) {
      if (e.dead || e.kind === 'vendor') continue;
      const stats = this.statsOf(e);
      const combat = this.inCombat(e.id);
      e.health = Math.min(stats.maxHealth, e.health + healthRegenPerSec(stats, combat) * dt);
      e.energy = Math.min(stats.maxEnergy, e.energy + energyRegenPerSec(stats, combat) * dt);
    }
  }

  private tickRespawns(): void {
    for (const e of this.entities.values()) {
      if (!e.dead || e.kind !== 'mob') continue;
      // Adds never respawn — they belong to a fight that is already over.
      if (e.summonedBy !== undefined) {
        this.entities.delete(e.id);
        this.events.push({ t: 'despawn', entityId: e.id });
        continue;
      }
      e.respawnInMs -= TICK_MS;
      if (e.respawnInMs > 0) continue;
      const stats = this.statsOf(e);
      e.dead = false;
      e.aiState = 'idle';
      e.health = stats.maxHealth;
      e.energy = stats.maxEnergy;
      e.pos = { ...e.spawnPos! };
      e.targetId = null;
      e.threat = {};
      e.effects = [];
      e.abilityCooldowns = {};
      e.abilityLockouts = {};
      e.firedAbilities = [];
      e.corpseLoot = [];
      e.corpseGold = 0;
      this.events.push({ t: 'spawn', entityId: e.id });
    }
  }

  // ------------------------------------------------------------------ combat

  private markCombat(id: EntityId): void {
    this.lastCombatTick.set(id, this.tickCount);
  }

  /**
   * How a given source of damage treats an in-progress cast.
   *
   *   'always' — mob spells and heavy attacks. The moments you plan around.
   *   'chance' — ordinary auto-attacks. Rolled against the target's defence.
   *   'never'  — damage-over-time ticks, which would otherwise make casting
   *              impossible for anything standing in a bleed.
   */
  private applyDamage(
    sourceId: EntityId,
    target: Entity,
    amount: number,
    crit: boolean,
    damageType: ActiveEffect['damageType'],
    abilityId: string | null,
    castBreak: 'always' | 'chance' | 'never' = 'chance',
  ): void {
    if (target.dead) return;
    // Traders are scenery with a shop attached, not combatants.
    if (target.kind === 'vendor') return;
    target.health -= amount;
    this.events.push({
      t: 'damage',
      sourceId,
      targetId: target.id,
      amount,
      crit,
      damageType,
      abilityId,
    });
    this.markCombat(sourceId);
    this.markCombat(target.id);

    // Threat, so tank mechanics and future pets work without a rewrite.
    if (target.kind === 'mob') {
      target.threat = target.threat ?? {};
      target.threat[sourceId] = (target.threat[sourceId] ?? 0) + threatFromDamage(amount);
      if (target.aiState === 'idle' || target.aiState === 'returning') {
        target.aiState = 'chasing';
        this.events.push({ t: 'aggro', mobId: target.id, targetId: sourceId });
      }
    }

    // What this hit does to an in-progress cast.
    if (
      castBreak !== 'never' &&
      target.cast &&
      target.cast.kind === 'skill' &&
      getSkill(target.cast.id).interruptible
    ) {
      const attacker = this.entities.get(sourceId);
      const breaks =
        castBreak === 'always' ||
        this.rng.chance(
          castBreakChance(
            this.statsOf(target).defense,
            target.level,
            attacker?.level ?? target.level,
          ),
        );

      if (breaks) {
        this.events.push({
          t: 'castInterrupted',
          sourceId: target.id,
          kind: 'skill',
          id: target.cast.id,
        });
        target.cast = null;
      } else {
        // Survived it, but concentration still slips. Capped so a cast that
        // is never broken always eventually lands.
        const already = target.cast.pushbackMs ?? 0;
        const delay = Math.min(CAST_PUSHBACK_MS, Math.max(0, target.cast.totalMs - already));
        if (delay > 0) {
          target.cast.remainingMs += delay;
          target.cast.pushbackMs = already + delay;
          this.events.push({
            t: 'castPushback',
            sourceId: target.id,
            id: target.cast.id,
            delayMs: delay,
          });
        }
      }
    }

    if (target.health <= 0) this.kill(target, sourceId);
  }

  private kill(victim: Entity, killerId: EntityId): void {
    victim.health = 0;
    victim.dead = true;
    victim.cast = null;
    victim.effects = [];
    victim.targetId = null;
    victim.autoAttack = victim.kind === 'mob';
    this.events.push({ t: 'death', entityId: victim.id, killerId });

    if (victim.kind === 'mob') {
      const def = getMob(victim.defId!);
      victim.aiState = 'dead';
      victim.respawnInMs = def.respawnMs;
      victim.threat = {};
      this.despawnSummonsOf(victim.id);
      const killer = this.entities.get(killerId);
      this.rollLoot(victim, killer);

      if (killer && killer.kind === 'player') {
        this.awardXp(killer, xpForKill(def.xp, def.level, killer.level));
        this.advanceQuests(killer, (o) => (o.kind === 'kill' && o.mobId === def.id ? 1 : 0));
      }
    } else {
      // Player death: everything currently hunting them goes home.
      for (const e of [...this.entities.values()]) {
        if (e.kind === 'mob' && e.targetId === victim.id) this.leashMob(e);
      }
    }
  }

  private rollLoot(mob: Entity, killer: Entity | undefined): void {
    // Adds drop nothing — otherwise a summoning boss is an infinite loot faucet.
    if (mob.summonedBy !== undefined) {
      mob.corpseLoot = [];
      mob.corpseGold = 0;
      return;
    }
    const def = getMob(mob.defId!);
    const table = getLootTable(def.lootTableId);
    const loot: ItemStack[] = [];

    // A boss's class weapon is resolved against whoever actually killed it, so
    // the reward is always something that player can equip rather than a
    // class-locked drop they can only vendor.
    if (table.classWeapons && killer?.kind === 'player' && killer.classId) {
      const weaponId = table.classWeapons[killer.classId];
      if (weaponId) loot.push({ itemId: weaponId, qty: 1 });
    }

    for (const entry of table.entries) {
      if (!this.rng.chance(entry.chance)) continue;
      loot.push({ itemId: entry.itemId, qty: this.rng.int(entry.min, entry.max) });
    }

    const gold = goldForKill(def.level, def.stars, table.goldMultiplier ?? 1);
    mob.corpseLoot = loot;
    mob.corpseGold = this.rng.int(gold.min, gold.max);
  }

  private awardXp(player: Entity, amount: number): void {
    if (player.level >= MAX_LEVEL) return;
    player.xp = (player.xp ?? 0) + amount;
    this.events.push({ t: 'xpGained', entityId: player.id, amount });

    while (player.level < MAX_LEVEL && (player.xp ?? 0) >= xpToNext(player.level)) {
      player.xp = (player.xp ?? 0) - xpToNext(player.level);
      player.level += 1;
      player.unspentPoints = (player.unspentPoints ?? 0) + POINTS_PER_LEVEL;
      const stats = this.statsOf(player);
      player.health = stats.maxHealth;
      player.energy = stats.maxEnergy;
      this.events.push({ t: 'levelUp', entityId: player.id, level: player.level });
      this.advanceQuests(player, (o) => (o.kind === 'level' && player.level >= o.level ? 1 : 0));

      for (const skill of skillsForClass(player.classId!, player.level)) {
        if (skill.reqLevel === player.level) {
          this.events.push({ t: 'skillUnlocked', entityId: player.id, skillId: skill.id });
        }
      }
    }
    // At the cap, extra xp is discarded rather than banked.
    if (player.level >= MAX_LEVEL) player.xp = 0;
  }

  private respawnPlayer(player: Entity): void {
    player.dead = false;
    player.pos = { ...this.zone.playerStart };
    player.targetId = null;
    player.autoAttack = false;
    player.effects = [];
    player.moveDir = { x: 0, z: 0 };
    const stats = this.statsOf(player);
    player.health = stats.maxHealth * 0.5;
    player.energy = stats.maxEnergy * 0.5;
    this.events.push({ t: 'spawn', entityId: player.id });
  }

  // ------------------------------------------------------------------ skills

  private tryUseSkill(e: Entity, skillId: string): void {
    const skill = getSkill(skillId);

    if (e.level < skill.reqLevel) {
      this.events.push({ t: 'error', entityId: e.id, message: `${skill.name} is not learned yet.` });
      return;
    }
    if ((e.skillCooldowns?.[skillId] ?? 0) > 0) {
      this.events.push({ t: 'error', entityId: e.id, message: `${skill.name} is not ready.` });
      return;
    }
    if ((e.gcdMs ?? 0) > 0) {
      // Silent: the player is simply queuing faster than the GCD allows, and
      // spamming "not ready" for that would drown the combat log.
      return;
    }
    if (e.cast) {
      this.events.push({ t: 'error', entityId: e.id, message: 'Already casting.' });
      return;
    }
    if (e.energy < skill.energyCost) {
      this.events.push({ t: 'error', entityId: e.id, message: 'Not enough energy.' });
      return;
    }

    const needsTarget =
      skill.kind === 'damage' || skill.kind === 'dot' || skill.kind === 'interrupt';
    let targetId: EntityId | null = e.targetId;
    if (needsTarget) {
      const target = this.entities.get(targetId ?? -1);
      if (!target || target.dead) {
        this.events.push({ t: 'error', entityId: e.id, message: 'No target.' });
        return;
      }
      if (dist(e.pos.x, e.pos.z, target.pos.x, target.pos.z) > skill.range) {
        this.events.push({ t: 'error', entityId: e.id, message: 'Out of range.' });
        return;
      }
    } else {
      targetId = e.id;
    }

    // Costs and cooldown are paid at cast start, not on completion — otherwise
    // a player could spam-start casts for free.
    e.energy -= skill.energyCost;
    e.skillCooldowns = e.skillCooldowns ?? {};
    e.skillCooldowns[skillId] = skill.cooldownMs;
    // A cast occupies you for its whole duration, so the GCD is the longer of the two.
    e.gcdMs = Math.max(GCD_MS, skill.castMs);

    if (skill.castMs > 0) {
      e.cast = {
        kind: 'skill',
        id: skillId,
        remainingMs: skill.castMs,
        totalMs: skill.castMs,
        targetId,
      };
      this.events.push({
        t: 'castBegin',
        sourceId: e.id,
        kind: 'skill',
        id: skillId,
        durationMs: skill.castMs,
      });
      return;
    }
    this.applySkillEffect(e, skill, targetId);
  }

  private applySkillEffect(source: Entity, skill: SkillDef, targetId: EntityId | null): void {
    const stats = this.statsOf(source);

    switch (skill.kind) {
      case 'damage': {
        const target = this.entities.get(targetId ?? -1);
        if (!target || target.dead) return;
        if (dist(source.pos.x, source.pos.z, target.pos.x, target.pos.z) > skill.range) {
          this.events.push({ t: 'error', entityId: source.id, message: 'Out of range.' });
          return;
        }
        const result = resolveAttack(this.rng, stats, this.statsOf(target), {
          levelDiff: source.level - target.level,
          attackerLevel: source.level,
          weaponMultiplier: skill.weaponMultiplier ?? 1,
          flatPower: skill.flatPower ?? 0,
        });
        if (!result.hit) {
          this.events.push({ t: 'miss', sourceId: source.id, targetId: target.id });
          return;
        }
        this.applyDamage(
          source.id,
          target,
          result.amount,
          result.crit,
          skill.damageType ?? stats.damageType,
          skill.id,
        );
        if (skill.threatBonus && target.kind === 'mob') {
          target.threat = target.threat ?? {};
          target.threat[source.id] = (target.threat[source.id] ?? 0) + skill.threatBonus;
        }
        break;
      }
      case 'dot': {
        const target = this.entities.get(targetId ?? -1);
        if (!target || target.dead) return;
        this.addEffect(target, {
          id: `${skill.id}:${source.id}`,
          kind: 'dot',
          sourceId: source.id,
          sourceAbilityId: skill.id,
          remainingMs: skill.durationMs ?? 5000,
          tickMs: skill.tickMs ?? 1000,
          sinceTickMs: 0,
          damageType: skill.damageType ?? 'physical',
          dotPower: (skill.flatPower ?? 0) + stats.attack * 0.15,
        });
        this.markCombat(source.id);
        this.markCombat(target.id);
        break;
      }
      case 'heal': {
        const target = this.entities.get(targetId ?? source.id) ?? source;
        const amount = Math.round((skill.flatPower ?? 0) + stats.attack * 0.5);
        const before = target.health;
        target.health = Math.min(this.statsOf(target).maxHealth, target.health + amount);
        this.events.push({
          t: 'heal',
          sourceId: source.id,
          targetId: target.id,
          amount: Math.round(target.health - before),
        });
        break;
      }
      case 'interrupt': {
        const target = this.entities.get(targetId ?? -1);
        if (!target || target.dead) return;
        if (dist(source.pos.x, source.pos.z, target.pos.x, target.pos.z) > skill.range) {
          this.events.push({ t: 'error', entityId: source.id, message: 'Out of range.' });
          return;
        }

        const cast = target.cast;
        const ability = cast?.kind === 'ability' ? this.findAbility(target, cast.id) : undefined;
        // Only an interruptible ability can be stopped. A missed interrupt still
        // costs its cooldown — that is what makes timing it a real decision.
        if (!cast || !ability?.interruptible) {
          this.events.push({ t: 'interruptWasted', sourceId: source.id, targetId: target.id });
          break;
        }

        target.cast = null;
        const lockoutMs = skill.lockoutMs ?? 5000;
        target.abilityLockouts = target.abilityLockouts ?? {};
        target.abilityLockouts[ability.id] = lockoutMs;
        this.events.push({
          t: 'castInterrupted',
          sourceId: target.id,
          kind: 'ability',
          id: ability.id,
        });
        this.events.push({
          t: 'interrupted',
          sourceId: source.id,
          targetId: target.id,
          abilityId: ability.id,
          abilityName: ability.name,
          lockoutMs,
        });
        if (skill.threatBonus && target.kind === 'mob') {
          target.threat = target.threat ?? {};
          target.threat[source.id] = (target.threat[source.id] ?? 0) + skill.threatBonus;
        }
        this.markCombat(source.id);
        this.markCombat(target.id);
        break;
      }
      case 'buff': {
        const target = this.entities.get(targetId ?? source.id) ?? source;
        this.addEffect(target, {
          id: `${skill.id}:${source.id}`,
          kind: 'buff',
          sourceId: source.id,
          sourceAbilityId: skill.id,
          remainingMs: skill.durationMs ?? 10000,
          tickMs: skill.tickMs ?? 1000,
          sinceTickMs: 0,
          damageType: 'physical',
          ...(skill.defenseBonus !== undefined ? { defenseBonus: skill.defenseBonus } : {}),
          ...(skill.damageMultiplier !== undefined
            ? { damageMultiplier: skill.damageMultiplier }
            : {}),
        });
        break;
      }
    }
  }

  /** Re-applying an effect refreshes it rather than stacking. */
  private addEffect(target: Entity, effect: ActiveEffect): void {
    const existing = target.effects.findIndex((e) => e.id === effect.id);
    if (existing >= 0) target.effects[existing] = effect;
    else target.effects.push(effect);
  }

  // --------------------------------------------------------------- inventory

  private tryLoot(player: Entity, corpseId: EntityId): void {
    const corpse = this.entities.get(corpseId);
    if (!corpse || !corpse.dead || corpse.kind !== 'mob') return;
    if (dist(player.pos.x, player.pos.z, corpse.pos.x, corpse.pos.z) > LOOT_RANGE) {
      this.events.push({ t: 'error', entityId: player.id, message: 'Too far away to loot.' });
      return;
    }
    const items = corpse.corpseLoot ?? [];
    const gold = corpse.corpseGold ?? 0;
    if (items.length === 0 && gold === 0) return;

    for (const stack of items) this.addItem(player, stack);
    player.gold = (player.gold ?? 0) + gold;
    this.syncCollectionQuests(player);
    corpse.corpseLoot = [];
    corpse.corpseGold = 0;
    this.events.push({ t: 'lootGained', entityId: player.id, items, gold });
  }


  // ------------------------------------------------------------------ quests

  /** Quests this vendor can offer the player right now. */
  questsOfferedBy(player: Entity, vendorId: string): ReturnType<typeof questsAvailableFrom> {
    return questsAvailableFrom(
      vendorId,
      player.level,
      player.questsDone ?? [],
      (player.quests ?? []).map((q) => q.questId),
    );
  }

  /** True when every objective of an accepted quest is satisfied. */
  isQuestComplete(player: Entity, questId: string): boolean {
    const progress = player.quests?.find((q) => q.questId === questId);
    if (!progress) return false;
    return getQuest(questId).objectives.every((o, i) => (progress.counts[i] ?? 0) >= neededFor(o));
  }

  private tryAcceptQuest(player: Entity, vendorId: EntityId, questId: string): void {
    if (player.kind !== 'player') return;
    const vendor = this.vendorInReach(player, vendorId);
    if (!vendor) return;
    const offered = this.questsOfferedBy(player, vendor.vendorId!);
    if (!offered.some((q) => q.id === questId)) {
      this.events.push({ t: 'error', entityId: player.id, message: 'That work is not on offer.' });
      return;
    }
    player.quests = [...(player.quests ?? []), { questId, counts: getQuest(questId).objectives.map(() => 0) }];
    this.events.push({ t: 'questAccepted', entityId: player.id, questId });

    // A "reach this zone" step is already satisfied if you are standing there,
    // and collection steps count what you are already carrying.
    this.advanceQuests(player, (o) => (o.kind === 'reach' && o.zoneId === this.zone.id ? 1 : 0));
    this.syncCollectionQuests(player);
  }

  private tryTurnInQuest(player: Entity, vendorId: EntityId, questId: string): void {
    if (player.kind !== 'player') return;
    const vendor = this.vendorInReach(player, vendorId);
    if (!vendor) return;
    const quest = getQuest(questId);
    if (vendor.vendorId !== quest.giverVendorId) {
      this.events.push({ t: 'error', entityId: player.id, message: 'That is not their business.' });
      return;
    }
    if (!this.isQuestComplete(player, questId)) {
      this.events.push({ t: 'error', entityId: player.id, message: 'That work is not finished.' });
      return;
    }

    player.quests = (player.quests ?? []).filter((q) => q.questId !== questId);
    player.questsDone = [...(player.questsDone ?? []), questId];

    const items = [...(quest.rewards.items ?? [])];
    const classItem = player.classId ? quest.rewards.classItems?.[player.classId] : undefined;
    if (classItem) items.push(classItem);
    for (const itemId of items) this.addItem(player, { itemId, qty: 1 });
    player.gold = (player.gold ?? 0) + quest.rewards.gold;

    this.events.push({
      t: 'questCompleted',
      entityId: player.id,
      questId,
      xp: quest.rewards.xp,
      gold: quest.rewards.gold,
      items,
    });
    this.awardXp(player, quest.rewards.xp);
  }

  private abandonQuest(player: Entity, questId: string): void {
    if (!player.quests?.some((q) => q.questId === questId)) return;
    player.quests = player.quests.filter((q) => q.questId !== questId);
    this.events.push({ t: 'questAbandoned', entityId: player.id, questId });
  }

  /**
   * Push progress into every active quest. `gain` reports how much a given
   * objective advanced, which keeps the event hooks above to one line each.
   */
  private advanceQuests(player: Entity, gain: (o: QuestObjective) => number): void {
    for (const progress of player.quests ?? []) {
      const quest = getQuest(progress.questId);
      let changed = false;
      quest.objectives.forEach((objective, i) => {
        const needed = neededFor(objective);
        const current = progress.counts[i] ?? 0;
        if (current >= needed) return;
        const added = gain(objective);
        if (added <= 0) return;
        progress.counts[i] = Math.min(needed, current + added);
        changed = true;
        this.events.push({
          t: 'questProgress',
          entityId: player.id,
          questId: quest.id,
          objectiveIndex: i,
          count: progress.counts[i]!,
          needed,
        });
      });
      if (changed && this.isQuestComplete(player, quest.id)) {
        this.events.push({ t: 'questReady', entityId: player.id, questId: quest.id });
      }
    }
  }

  /**
   * Collection objectives read the bags directly rather than counting pickups.
   * Counting pickups would mean items gathered before accepting the quest never
   * counted, which reads as a bug every single time.
   */
  private syncCollectionQuests(player: Entity): void {
    for (const progress of player.quests ?? []) {
      const quest = getQuest(progress.questId);
      let changed = false;
      quest.objectives.forEach((objective, i) => {
        if (objective.kind !== 'collect') return;
        const held = player.inventory?.find((s) => s.itemId === objective.itemId)?.qty ?? 0;
        const capped = Math.min(objective.count, held);
        if (capped === (progress.counts[i] ?? 0)) return;
        progress.counts[i] = capped;
        changed = true;
        this.events.push({
          t: 'questProgress',
          entityId: player.id,
          questId: quest.id,
          objectiveIndex: i,
          count: capped,
          needed: objective.count,
        });
      });
      if (changed && this.isQuestComplete(player, quest.id)) {
        this.events.push({ t: 'questReady', entityId: player.id, questId: quest.id });
      }
    }
  }

  // ------------------------------------------------------------------ travel

  /** The exit the player is currently standing on, if any. */
  exitInReach(player: Entity): ZoneDef['exits'][number] | null {
    for (const exit of this.zone.exits) {
      if (dist(player.pos.x, player.pos.z, exit.pos.x, exit.pos.z) <= TRAVEL_RANGE) return exit;
    }
    return null;
  }

  private tryTravel(player: Entity, toZoneId: string): void {
    if (player.kind !== 'player') return;
    const exit = this.zone.exits.find((e) => e.toZoneId === toZoneId);
    if (!exit) return;
    if (dist(player.pos.x, player.pos.z, exit.pos.x, exit.pos.z) > TRAVEL_RANGE) {
      this.events.push({ t: 'error', entityId: player.id, message: 'You are not on the road.' });
      return;
    }
    if (player.level < exit.minLevel) {
      this.events.push({
        t: 'error',
        entityId: player.id,
        message: `${exit.label} is no place for you yet. Return at level ${exit.minLevel}.`,
      });
      return;
    }
    this.travelTo(toZoneId);
  }

  /**
   * Load a different zone.
   *
   * Only the player survives — every mob and trader is rebuilt from the zone
   * definition. Mobs respawn on a timer anyway, so nothing meaningful is lost,
   * and it keeps a save to one zone's worth of state instead of four.
   */
  travelTo(zoneId: string): void {
    const zone = getZone(zoneId);
    const player = this.player;

    for (const id of [...this.entities.keys()]) {
      if (id !== player.id) this.entities.delete(id);
    }
    this.zone = zone;
    this.lastCombatTick.clear();

    player.pos = { ...zone.playerStart };
    player.targetId = null;
    player.autoAttack = false;
    player.moveDir = { x: 0, z: 0 };
    player.cast = null;
    player.effects = [];

    for (const sp of zone.spawns) this.spawnMob(sp.mobId, sp.pos);
    for (const v of zone.vendors) this.spawnVendor(v.vendorId, v.pos);

    this.events.push({
      t: 'zoneChanged',
      entityId: player.id,
      zoneId: zone.id,
      zoneName: zone.name,
    });
    this.advanceQuests(player, (o) => (o.kind === 'reach' && o.zoneId === zone.id ? 1 : 0));
  }

  // ------------------------------------------------------------------ trade

  /** Resolve a vendor the player is standing close enough to deal with. */
  private vendorInReach(player: Entity, vendorId: EntityId): Entity | null {
    const vendor = this.entities.get(vendorId);
    if (!vendor || vendor.kind !== 'vendor') return null;
    if (dist(player.pos.x, player.pos.z, vendor.pos.x, vendor.pos.z) > VENDOR_RANGE) {
      this.events.push({ t: 'error', entityId: player.id, message: 'Too far from the trader.' });
      return null;
    }
    return vendor;
  }

  private trySell(player: Entity, vendorId: EntityId, itemId: string, qty: number): void {
    if (player.kind !== 'player' || qty <= 0) return;
    if (!this.vendorInReach(player, vendorId)) return;

    const held = player.inventory?.find((s) => s.itemId === itemId);
    if (!held) return;
    // Sell what they actually have rather than rejecting an over-count.
    const selling = Math.min(qty, held.qty);
    if (!this.removeItem(player, itemId, selling)) return;

    const gold = sellPrice(getItem(itemId)) * selling;
    player.gold = (player.gold ?? 0) + gold;
    this.events.push({ t: 'sold', entityId: player.id, itemId, qty: selling, gold });
  }

  private tryBuy(player: Entity, vendorId: EntityId, itemId: string): void {
    if (player.kind !== 'player') return;
    const vendor = this.vendorInReach(player, vendorId);
    if (!vendor) return;

    const def = getVendor(vendor.vendorId!);
    if (!def.stock.includes(itemId)) {
      this.events.push({ t: 'error', entityId: player.id, message: 'That is not for sale.' });
      return;
    }
    const item = getItem(itemId);
    const price = buyPrice(item);
    if ((player.gold ?? 0) < price) {
      this.events.push({ t: 'error', entityId: player.id, message: 'You cannot afford that.' });
      return;
    }
    player.gold = (player.gold ?? 0) - price;
    this.addItem(player, { itemId, qty: 1 });
    this.events.push({ t: 'bought', entityId: player.id, itemId, gold: price });
  }

  addItem(player: Entity, stack: ItemStack): void {
    player.inventory = player.inventory ?? [];
    const def = getItem(stack.itemId);
    if (def.stackable) {
      const existing = player.inventory.find((s) => s.itemId === stack.itemId);
      if (existing) {
        existing.qty += stack.qty;
        return;
      }
    }
    player.inventory.push({ ...stack });
  }

  private removeItem(player: Entity, itemId: string, qty = 1): boolean {
    const inv = player.inventory ?? [];
    const idx = inv.findIndex((s) => s.itemId === itemId);
    if (idx < 0) return false;
    const stack = inv[idx]!;
    if (stack.qty < qty) return false;
    stack.qty -= qty;
    if (stack.qty <= 0) inv.splice(idx, 1);
    return true;
  }

  private tryEquip(player: Entity, itemId: string): void {
    const def = getItem(itemId);
    if (!def.slot) {
      this.events.push({ t: 'error', entityId: player.id, message: `${def.name} cannot be equipped.` });
      return;
    }
    if (!canEquip(def, player.classId)) {
      this.events.push({
        t: 'error',
        entityId: player.id,
        message: `${def.name} cannot be used by a ${player.classId ?? 'character'}.`,
      });
      return;
    }
    if (!this.removeItem(player, itemId, 1)) return;

    player.equipment = player.equipment ?? {};
    const previous = player.equipment[def.slot];
    player.equipment[def.slot] = itemId;
    if (previous) this.addItem(player, { itemId: previous, qty: 1 });

    // Clamp to the new maxima so swapping gear can never leave you over-full.
    const stats = this.statsOf(player);
    player.health = Math.min(player.health, stats.maxHealth);
    player.energy = Math.min(player.energy, stats.maxEnergy);
  }

  private tryUnequip(player: Entity, slot: EquipSlot): void {
    const itemId = player.equipment?.[slot];
    if (!itemId) return;
    delete player.equipment![slot];
    this.addItem(player, { itemId, qty: 1 });
    const stats = this.statsOf(player);
    player.health = Math.min(player.health, stats.maxHealth);
    player.energy = Math.min(player.energy, stats.maxEnergy);
  }

  // ------------------------------------------------------------- save / load

  /**
   * Whole-world snapshot. Entities are plain data by design, so this is just a
   * structured clone — the same property that makes state cheap to send over a
   * network later.
   */
  serialize(): string {
    return JSON.stringify({
      version: SAVE_VERSION,
      seed: this.rng.state,
      tickCount: this.tickCount,
      nextId: this.nextId,
      playerId: this.playerId,
      zoneId: this.zone.id,
      entities: [...this.entities.values()],
    });
  }

  static deserialize(json: string, zone: ZoneDef): World {
    const data = JSON.parse(json) as {
      version: number;
      seed: number;
      tickCount: number;
      nextId: number;
      playerId: EntityId;
      zoneId?: string;
      entities: Entity[];
    };
    if (data.version !== SAVE_VERSION) {
      throw new Error(`Unsupported save version: ${data.version}`);
    }

    // Saves record which zone the player was standing in. Resolve it against
    // the registry when possible, but fall back to the zone handed in so ad-hoc
    // zones (tests, anything not in ZONES) still round-trip.
    const resolved =
      data.zoneId && data.zoneId !== zone.id && ZONES[data.zoneId] ? ZONES[data.zoneId]! : zone;
    const world = new World({ seed: data.seed, zone: resolved, classId: 'warrior' });
    world.entities.clear();
    world.rng = Rng.fromState(data.seed);
    world.tickCount = data.tickCount;
    world.nextId = data.nextId;
    world.playerId = data.playerId;
    for (const e of data.entities) {
      // JSON turns numeric threat keys into strings; normalize them back.
      if (e.threat) {
        const fixed: Record<number, number> = {};
        for (const [k, v] of Object.entries(e.threat)) fixed[Number(k)] = v as number;
        e.threat = fixed;
      }
      world.entities.set(e.id, e);
    }
    return world;
  }
}
