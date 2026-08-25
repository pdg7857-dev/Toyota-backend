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
  conditionPower,
  GCD_MS,
  TICK_MS,
  addAttributes,
  applyItem,
  adventurerStats,
  deriveMobStats,
  unscaleAdd,
  deriveStats,
  dist,
  emptyAffixes,
  emptyAttributes,
  energyRegenPerSec,
  healthRegenPerSec,
  MAX_SKILL_RANK,
  POINTS_PER_LEVEL,
  SKILL_CRIT_MULTIPLIER,
  SKILL_POINTS_PER_LEVEL,
  skillCritChance,
  skillRankPower,
  MAX_LEVEL,
  PRIMARY_ATTRIBUTE,
  MAX_EQUIPMENT_DROP_CHANCE,
  STAR_LOOT_MULTIPLIER,
  goldForKill,
  castBreakChance,
  DEBT_CAP_LEVELS,
  DEBT_REPAY_SHARE,
  deathDebt,
  RECLAIM_RANGE,
  resolveAttack,
  ROAM_PAUSE_MAX_MS,
  ROAM_PAUSE_MIN_MS,
  ROAM_SPEED,
  roamRadiusFor,
  scaledDefenseBonus,
  threatFromDamage,
  xpForKill,
  xpToNext,
} from './formulas.js';
import { BOSS_STARS, isBoss } from './types.js';
import {
  DAY_LENGTH_MS,
  NIGHT_AGGRO,
  daylightAt,
  weatherAt,
  type Daylight,
  type Weather,
} from '../content/daylight.js';
import type {
  ActiveEffect,
  AwayReport,
  DragonState,
  FactionId,
  ActorCommand,
  Attributes,
  Command,
  DamageType,
  DerivedStats,
  Entity,
  EntityId,
  EquipSlot,
  ItemStack,
  MobAbilityDef,
  MobDef,
  QuestObjective,
  SimEvent,
  SkillDef,
  Vec2,
} from './types.js';
import { canEquip, getItem } from '../content/items.js';
import {
  CONSUMABLE_DROP_CHANCE,
  ELIXIR_COOLDOWN_MS,
  ELIXIR_DURATION_MS,
  POTION_COOLDOWN_MS,
  consumableDropFor,
} from '../content/consumables.js';
import { STAR_SPREAD, baseMobId, getLootTable, getMob, starVariantId } from '../content/mobs.js';
import { BOUNTY_SPAWN_CHANCE, RARE_SPAWN_CHANCE } from '../content/rares.js';
import {
  ADVENTURERS,
  ADVENTURERS_PER_ZONE,
  CAMP_MINUTES,
  CHATTER_INTERVAL_SEC,
  CHATTER_MIN_GAP_MS,
  DEATH_CHATTER,
  DRAGON_CHATTER,
  DROVE_OFF_CHATTER,
  FIGHT_FLOOR,
  FIGHT_MS,
  FRONT_CHATTER,
  GIVE_UP_AT,
  GRATS_CHATTER,
  GRATS_RANGE,
  IDLE_CHATTER,
  REST_SHARE,
  YIELD_MARGIN,
} from '../content/adventurers.js';
import {
  CAPTURE_RANGE,
  CAPTURE_THRESHOLD,
  getMount,
} from '../content/mounts.js';
import {
  DRAGONS,
  DRAGON_DORMANT_MIN,
  DRAGON_HUNT_MIN,
  DRAGON_ROOST_MIN,
  DRAGON_SLAIN_MIN,
  dragonMobId,
  getDragon,
  type DragonDef,
} from '../content/dragons.js';
import {
  CONTROL_LIMIT,
  FLIP_THRESHOLD,
  HOLDINGS,
  HOSTILE_AT,
  PRESSURE_PER_BOSS,
  PRESSURE_PER_KILL,
  PRESSURE_PER_QUEST,
  STANDING_LIMIT,
  STANDING_PER_KILL,
  STANDING_PER_QUEST,
  STANDING_PRICE_SWING,
  STANDING_RIVAL_SHARE,
  TRUCE_AT,
  getFaction,
  getHolding,
  standingBand,
} from '../content/factions.js';
import {
  DISCOVERY_RANGE,
  discoveriesFor,
  discoveryName,
  type DiscoverySite,
} from '../content/discoveries.js';
import { zoneStructures as structuresOf } from '../content/structures.js';
import {
  MUSTER_AT,
  MUSTER_CELL,
  MUSTER_COOLDOWN_MS,
  MUSTER_DECAY_MS,
  MUSTER_MAX,
  MUSTER_MIN,
  MUSTER_RANGE,
  ROUSED_DAMAGE,
  ROUSED_MS,
  rousedName,
  rousedStars,
} from '../content/muster.js';
import {
  PACK_MAX_ALLIES,
  PACK_PER_ALLY,
  PACK_RANGE,
  SKITTISH_AT,
  SKITTISH_LEASH,
  SKITTISH_MS,
  SKITTISH_SPEED,
  STUBBORN_AT,
  STUBBORN_DAMAGE,
  VENOM_MAX_STACKS,
  VENOM_MAX_TICK,
  VENOM_MS,
  VENOM_SHARE,
  VENOM_TICK_MS,
  traitFor,
} from '../content/traits.js';
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

/** Minutes of world time, in ticks-friendly milliseconds. */
function minutes(n: number): number {
  return n * 60000;
}

/**
 * A number in [0, 1) from two integers, with no state anywhere.
 *
 * This is what keeps a camp full of wandering animals out of the combat RNG —
 * see `Entity.roamGoal`. Every creature's amble is a pure function of its id
 * and how many times it has already ambled, so the stream a fight draws from
 * is identical whether the zone is populated or empty.
 */
function roamHash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13) ^ b, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Time since last damage dealt/taken that still counts as "in combat". */
const COMBAT_TIMEOUT_MS = 6000;

/** Save format version. Bump when the Entity shape changes. */
const SAVE_VERSION = 11;

/**
 * How big a step `catchUp` takes through the time you were away.
 *
 * Shorter than the shortest dragon phase (`DRAGON_HUNT_MIN`, 90 seconds), so
 * no dragon can skip a stop on its round — a coarser step would let one hunt
 * and roost between two samples and take ground nobody ever saw it on.
 */
const AWAY_STEP_MS = 30000;

/**
 * The longest absence worth simulating.
 *
 * Drift converges: leave for long enough and every front reaches the far end
 * of whatever it was heading for, and more steps buy nothing but time. Two
 * weeks is comfortably past that, so a player returning after a year gets the
 * same world as one returning after a fortnight — which is the honest answer,
 * because the world they left is gone either way.
 */
const MAX_AWAY_MS = 14 * 24 * 60 * 60 * 1000;

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
  /**
   * Milliseconds of world time elapsed. Drives the sun and the weather.
   *
   * Sim state rather than a renderer clock, because time of day is one of the
   * things that genuinely is about elapsed time — the same argument territory
   * drift and the dragons' routine are made on. `catchUp` advances it, so
   * coming back after a fortnight puts you down at a different hour, which is
   * the cheapest proof the world did not pause when you closed the tab.
   *
   * Started part-way into the morning so a new character does not arrive at
   * midnight in a game whose first instruction is to go and look at a beast.
   */
  worldTimeMs = DAY_LENGTH_MS * 0.34;

  /**
   * Landmarks in this zone that hold something, and which of them are opened.
   *
   * The sites themselves are derived from the zone — `zoneStructures` is pure,
   * so the sim and the renderer compute the same landmarks rather than one
   * being handed the other's list. What is *state* is only which ones have
   * been opened, and that is keyed on where a site stands rather than on its
   * index: an index would silently re-point every save the moment anybody
   * added a landmark.
   */
  sites: DiscoverySite[] = [];
  found: Record<string, true> = {};

  /**
   * How hard the player has been working each patch of ground.
   *
   * Keyed on a coarse grid cell so it needs no camp identity, and decayed
   * rather than reset so a steady grind never builds it and a hard push does —
   * see `content/muster.ts`. `quietUntil` is the tick a cell may rouse again.
   *
   * Deliberately not saved. It is a two-minute clock in a game whose other
   * clocks run for half an hour, and a camp that remembers a grudge from last
   * Tuesday is not a camp reacting to what you are doing now.
   */
  pressure: Record<string, { count: number; lastTick: number; quietUntil: number }> = {};
  entities = new Map<EntityId, Entity>();
  playerId: EntityId = 0;

  /**
   * Who holds what, as one number per holding.
   *
   * Negative is `claimants[0]`, positive is `claimants[1]`, and the sign only
   * becomes control once it crosses `FLIP_THRESHOLD` — see
   * `content/factions.ts`. Authoritative sim state, so it serializes with
   * everything else and a server could own it unchanged.
   */
  /**
   * Patches of dangerous ground, from `hazard` abilities.
   *
   * World state rather than an entity, because a hazard is not a thing that
   * can be targeted, killed, healed or walked into by anything except the
   * player — modelling it as an entity would put it in every loop that
   * iterates creatures and every one of those loops would then need to skip it.
   */
  hazards: Array<{
    id: number;
    sourceId: EntityId;
    at: Vec2;
    radius: number;
    remainingMs: number;
    tickMs: number;
    sinceTickMs: number;
    power: number;
    damageType: DamageType;
  }> = [];
  private nextHazardId = 1;

  control: Record<string, number> = {};
  /** Which faction currently holds each holding. Derived, but cached so a flip is an event. */
  controller: Record<string, FactionId> = {};
  /**
   * Where each dragon is in its life. Runs whatever zone the player is in:
   * the world does not pause because you left.
   */
  dragons: Record<string, DragonState> = {};

  private nextId = 1;
  private queue: ActorCommand[] = [];
  private events: SimEvent[] = [];
  /** tickCount at which each entity was last in combat. */
  private lastCombatTick = new Map<EntityId, number>();
  /** World time of the last thing an adventurer said, for the chatter floor. */
  private lastChatMs = -Infinity;
  /** True while `catchUp` is running the hours nobody was here for. */
  private catchingUp = false;

  constructor(opts: WorldOptions) {
    this.zone = opts.zone;
    this.rng = new Rng(opts.seed);
    this.resetTerritory();
    this.resetDragons();
    this.spawnPlayer(opts.classId, opts.playerName ?? 'Wanderer');
    for (const sp of this.zone.spawns) {
      this.spawnMob(this.garrisonFor(sp), sp.pos, undefined, sp.holding, sp.plain);
    }
    for (const v of this.zone.vendors ?? []) this.spawnVendor(v.vendorId, v.pos);
    this.spawnAdventurers();
    this.sites = discoveriesFor(this.zone.id, structuresOf(this.zone));
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
      learnedSkills: [],
      stable: [],
      mounted: null,
      gcdMs: 0,
      cast: null,
      moveDir: { x: 0, z: 0 },
    };
    this.entities.set(id, player);
    const stats = this.statsOf(player);
    player.health = stats.maxHealth;
    player.energy = stats.maxEnergy;
  }

  /**
   * Which creature a camp spawn point puts out this time.
   *
   * Ordinary almost always; on a `RARE_SPAWN_CHANCE` hit, the named variant.
   * The roll goes through `this.rng` like everything else, so a rare spawn
   * replays exactly from (seed, commands) — a one-in-four-hundred event that
   * could not be reproduced would be untestable and unreportable.
   *
   * Summoned adds never roll: they belong to a fight, not to a camp. Nor do
   * the creatures a new character wakes up in front of — see `SpawnPoint.plain`.
   */
  private spawnChoice(baseId: string, asIs: boolean): string {
    const base = getMob(baseId);
    if (asIs) return baseId;
    if (base.rareVariant && this.zone.rareSpawns !== false) {
      // A bounty turns up more often than a signature item: one is spent the
      // moment you collect it, the other is yours for the rest of the game.
      const variant = getMob(base.rareVariant);
      const chance = variant.bounty ? BOUNTY_SPAWN_CHANCE : RARE_SPAWN_CHANCE;
      if (this.rng.chance(chance)) return base.rareVariant;
    }
    return this.starChoice(base);
  }

  /**
   * Which rating of a creature this spawn point comes back as.
   *
   * A camp is a population, not eight copies: mostly ordinary animals, a few
   * runts, a few big ones, and occasionally something you have to decide
   * whether to pull. The weights live in `content/mobs.ts` with the names.
   *
   * Off in test arenas along with everything else that rolls — a duel against
   * a creature whose rating changed with the seed is measuring the wrong thing,
   * and the roll itself draws from the same `Rng` as the fight.
   */
  private starChoice(base: MobDef): string {
    if (this.zone.starVariants === false) return base.id;
    if (base.stars >= BOSS_STARS || base.horse || base.rareOf || base.dragon) return base.id;
    let roll = this.rng.next();
    for (const { stars, weight } of STAR_SPREAD) {
      roll -= weight;
      if (roll > 0) continue;
      return stars === base.stars ? base.id : starVariantId(base.id, stars);
    }
    return base.id;
  }

  // ------------------------------------------------------------- territory

  /**
   * Put every front back where the world starts.
   *
   * Control begins at the far end for whoever holds the ground, not at the
   * midpoint: a fresh world should read as "the outlaws own the road", not as
   * "the road is up for grabs and happens to be theirs today".
   */
  private resetTerritory(): void {
    this.control = {};
    this.controller = {};
    for (const holding of HOLDINGS) {
      const sign = holding.claimants[1] === holding.initialController ? 1 : -1;
      this.control[holding.id] = sign * CONTROL_LIMIT;
      this.controller[holding.id] = holding.initialController;
    }
  }

  /** Who holds a holding right now. */
  controllerOf(holdingId: string): FactionId {
    return this.controller[holdingId] ?? getHolding(holdingId).initialController;
  }

  /** Control as a fraction from -1 (claimant 0) to +1 (claimant 1). */
  controlOf(holdingId: string): number {
    return (this.control[holdingId] ?? 0) / CONTROL_LIMIT;
  }

  /**
   * Push a front, and flip it if the push carried far enough.
   *
   * `byPlayer` only decides how the event reads; the arithmetic is the same
   * either way, because the drift and the player are pushing the same rope.
   */
  private applyPressure(holdingId: string, toward: FactionId, amount: number, byPlayer: boolean): void {
    const holding = getHolding(holdingId);
    if (!holding.claimants.includes(toward)) return;
    const sign = holding.claimants[1] === toward ? 1 : -1;
    const before = this.control[holdingId] ?? 0;
    const after = Math.max(-CONTROL_LIMIT, Math.min(CONTROL_LIMIT, before + sign * amount));
    this.control[holdingId] = after;

    const held = this.controllerOf(holdingId);
    const challenger = holding.claimants[0] === held ? holding.claimants[1] : holding.claimants[0];
    const challengerSign = holding.claimants[1] === challenger ? 1 : -1;
    // A flip needs the far threshold, not the midpoint: crossing zero would
    // have a contested front changing hands every couple of kills, and a
    // banner that flickers is a banner nobody reads.
    if (after * challengerSign >= FLIP_THRESHOLD) {
      this.controller[holdingId] = challenger;
      this.events.push({
        t: 'holdingChanged',
        holdingId,
        name: holding.name,
        from: held,
        to: challenger,
        byPlayer,
      });
      if (holding.zoneId === this.zone.id) this.reactTo(FRONT_CHATTER, holding.name);
    }
  }

  /**
   * The war carries on without you.
   *
   * Called once per tick, and again in coarse steps by `catchUp` for the hours
   * you were not here. `stepMs` is the only difference between the two: the
   * world moving while you are away has to run the *same* rules as the world
   * moving while you watch, or it is a second simulation that can disagree with
   * the first.
   */
  private tickTerritory(stepMs: number = TICK_MS): void {
    for (const holding of HOLDINGS) {
      if (holding.drift === 0) continue;
      // A front with a dragon on it is not a front. Nobody is contesting
      // anything while that is sitting there, and the war resumes when it
      // leaves or somebody kills it.
      if (this.isSuppressed(holding.id)) continue;
      const toward = holding.drift > 0 ? holding.claimants[1] : holding.claimants[0];
      const perStep = (Math.abs(holding.drift) * stepMs) / 60000;
      this.applyPressure(holding.id, toward, perStep, false);
    }
  }

  /**
   * What stands at a guard post right now.
   *
   * The zone's own `mobId` is only a fallback: the garrison follows control,
   * which is what makes a flip something you can walk into and see rather than
   * a number in a menu.
   */
  private garrisonFor(spawn: { mobId: string; holding?: string }): string {
    if (!spawn.holding) return spawn.mobId;
    const holding = getHolding(spawn.holding);
    return holding.garrison[this.controllerOf(spawn.holding)] ?? spawn.mobId;
  }

  // ----------------------------------------------------- other adventurers

  /**
   * Populate the zone with other people.
   *
   * Deterministic from the seed and the zone id, so a zone has the same names
   * in it every time you walk in. An MMO where the population is different
   * strangers every login is a lobby.
   */
  private spawnAdventurers(): void {
    if (this.zone.adventurers === false) return;
    const camps = this.campCentres();
    if (camps.length === 0) return;
    const [lo, hi] = this.zone.levelRange;
    // One of each class, as far as the roster allows. Striding the list by a
    // fixed step put three Priests in the Fenmarch, and a camp where everybody
    // plays the same thing reads as a bug in the population rather than a
    // coincidence in it.
    const takenClasses = new Set<string>();
    const takenNames = new Set<string>();
    for (let i = 0; i < ADVENTURERS_PER_ZONE; i++) {
      const start = (this.zoneSeed() + i * 5) % ADVENTURERS.length;
      const from = (skipClass: boolean) => {
        for (let step = 0; step < ADVENTURERS.length; step++) {
          const candidate = ADVENTURERS[(start + step) % ADVENTURERS.length]!;
          if (takenNames.has(candidate.name)) continue;
          if (skipClass && takenClasses.has(candidate.classId)) continue;
          return candidate;
        }
        return undefined;
      };
      // A fresh class if the roster still has one, otherwise just a new face:
      // two people with the same name is the one thing worse than two Priests.
      const who = from(true) ?? from(false) ?? ADVENTURERS[start]!;
      takenClasses.add(who.classId);
      takenNames.add(who.name);
      const camp = camps[(this.zoneSeed() + i * 3) % camps.length]!;
      const id = this.nextId++;
      const npc: Entity = {
        id,
        kind: 'npc',
        name: who.name,
        // Plausible for where they are standing: you never meet a level 4 in
        // Caer Dubh, which is the fastest way to break the illusion.
        level: lo + ((this.zoneSeed() + i * 7) % Math.max(1, hi - lo)),
        pos: { x: camp.x + (i - 1.5) * 4, z: camp.z + (i % 2 === 0 ? 5 : -5) },
        facing: 0,
        health: 1,
        energy: 1,
        dead: false,
        respawnInMs: 0,
        targetId: null,
        autoAttack: false,
        swingCooldownMs: 0,
        effects: [],
        cast: null,
        classId: who.classId,
        npcGoal: { ...camp },
        npcUntilMs: CAMP_MINUTES * 60000 * (0.5 + i * 0.3),
      };
      this.entities.set(id, npc);
      npc.health = 100;
    }
  }

  /** Camp centres in this zone, deduplicated, for somewhere to send them. */
  private campCentres(): Vec2[] {
    const out: Vec2[] = [];
    for (const sp of this.zone.spawns) {
      const def = getMob(sp.mobId);
      if (isBoss(def.stars) || def.horse) continue;
      if (out.some((c) => dist(c.x, c.z, sp.pos.x, sp.pos.z) < 18)) continue;
      out.push({ ...sp.pos });
    }
    return out;
  }

  /** What is standing closest to a point, for chatter that names things. */
  /** A stable per-zone number, so the same people are in the same zone. */
  private zoneSeed(): number {
    let h = 0;
    for (const ch of this.zone.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h;
  }

  /**
   * Move them along and let them talk.
   *
   * They walk between camps and stand in them. They do not fight the world's
   * actual mobs — nothing they do touches a mob's health, threat or loot,
   * because an adventurer that tags the creature you needed is not atmosphere,
   * it is a competitor, and competing with a script is miserable.
   */
  private tickAdventurers(): void {
    const npcs = [...this.entities.values()].filter((e) => e.kind === 'npc');
    // Test arenas and any zone without camps have nobody in them; don't walk
    // the spawn table sixty times a second to discover that.
    if (npcs.length === 0) return;
    const camps = this.campCentres();
    for (const e of npcs) {
      e.npcUntilMs = (e.npcUntilMs ?? 0) - TICK_MS;
      this.restNpc(e);

      if ((e.npcUntilMs ?? 0) <= 0 && camps.length > 0) {
        // Bored of this camp; pick another and walk there.
        const next = camps[this.rng.int(0, camps.length - 1)]!;
        e.npcGoal = { x: next.x + this.rng.int(-6, 6), z: next.z + this.rng.int(-6, 6) };
        e.npcUntilMs = CAMP_MINUTES * 60000 * (0.6 + this.rng.next());
      }

      if (this.tickFight(e)) continue;

      const goal = e.npcGoal;
      if (!goal) continue;
      const d = dist(e.pos.x, e.pos.z, goal.x, goal.z);
      if (d > 1.5) {
        const speed = 5.2 * (TICK_MS / 1000);
        e.pos.x += ((goal.x - e.pos.x) / d) * speed;
        e.pos.z += ((goal.z - e.pos.z) / d) * speed;
        e.facing = Math.atan2(goal.x - e.pos.x, goal.z - e.pos.z);
        e.npcBusy = false;
      } else {
        // Standing in a camp. They used to "fight" it abstractly, which from
        // sixty metres is a person turning slowly on the spot beside eight
        // creatures that have not noticed them. Now they pick one and pull it.
        e.npcBusy = true;
        e.facing += 0.02;
        this.startFight(e);
      }
    }

    this.tickChatter(npcs);
  }

  /**
   * One of them picks a creature and pulls it.
   *
   * Never a boss, never a horse, never something already fighting anything —
   * the first is not theirs to take on, the second is not a fight at all, and
   * the third is either the player's or another adventurer's.
   */
  private startFight(npc: Entity): void {
    if (npc.npcFoe !== undefined) return;
    if (npc.health < this.statsOf(npc).maxHealth * 0.8) return;
    // Once a second each, staggered by id. Looking for a creature means
    // walking every entity in the zone, and four people doing that sixty times
    // a second is a hundred and forty thousand distance checks — the same
    // lesson `tickPacks` had to learn, and worth nothing at all here: nobody
    // can see the difference between picking a fight now and picking one in
    // half a second.
    if ((this.tickCount + npc.id) % 20 !== 0) return;
    const player = this.player;

    let best: Entity | undefined;
    let bestGap = 26;
    for (const e of this.entities.values()) {
      if (e.kind !== 'mob' || e.dead) continue;
      if (e.targetId !== null || e.aiState === 'chasing' || e.aiState === 'attacking') continue;
      const def = getMob(e.defId!);
      if (def.stars >= BOSS_STARS || def.horse || def.dragon) continue;
      // Not one the player could be about to walk into. Whose creature it is
      // has to be decided before the swing, not after.
      if (dist(e.pos.x, e.pos.z, player.pos.x, player.pos.z) < def.aggroRadius + YIELD_MARGIN) {
        continue;
      }
      const gap = dist(e.pos.x, e.pos.z, npc.pos.x, npc.pos.z);
      if (gap >= bestGap) continue;
      bestGap = gap;
      best = e;
    }
    if (!best) return;

    npc.npcFoe = best.id;
    npc.npcFightMs = FIGHT_MS;
    npc.autoAttack = true;
    npc.targetId = best.id;
    best.threat = best.threat ?? {};
    best.threat[npc.id] = (best.threat[npc.id] ?? 0) + 1;
    best.targetId = npc.id;
    best.aiState = 'chasing';
    best.roamGoal = null;
    this.events.push({ t: 'aggro', mobId: best.id, targetId: npc.id });
  }

  /**
   * Run a fight one of them is in, and end it when it should end.
   *
   * Returns true while they are busy, so the walking half leaves them alone.
   * Every way out goes through `leashMob`, which is the game's own answer to
   * "that fight is over": home, threat dropped, healed to full. The creature a
   * player walks up to is therefore always the creature they would have found.
   */
  private tickFight(npc: Entity): boolean {
    const foe = this.entities.get(npc.npcFoe ?? -1);
    if (npc.npcFoe === undefined) return false;
    const stats = this.statsOf(npc);

    // The player is near enough to want it: it is theirs, and it is whole.
    const player = this.player;
    const near =
      foe && dist(foe.pos.x, foe.pos.z, player.pos.x, player.pos.z) <
        getMob(foe.defId!).aggroRadius + YIELD_MARGIN;
    const taken = foe && (foe.threat?.[player.id] ?? 0) > 0;

    npc.npcFightMs = (npc.npcFightMs ?? 0) - TICK_MS;
    const worn = npc.health <= stats.maxHealth * GIVE_UP_AT;
    // Reaching the floor *ends* it rather than capping it. A clamp alone meant
    // every fight drove the creature down and then sat on it for another half
    // a minute, with the bar visibly refusing to move.
    const beaten = !!foe && foe.health <= this.statsOf(foe).maxHealth * FIGHT_FLOOR + 0.5;
    const over =
      !foe || foe.dead || near || taken || worn || beaten || (npc.npcFightMs ?? 0) <= 0;

    if (over) {
      if (foe && !foe.dead && foe.targetId === npc.id) {
        this.leashMob(foe);
        // Whole again on the spot, rather than on arriving home the way an
        // ordinary leash heals. The walk back is too slow: the reason the
        // fight ended is usually that the player is nearly in range, and a
        // creature that aggros them halfway home arrives wounded — which is a
        // gift rather than a theft, and still not the creature they would have
        // found. The break happens `YIELD_MARGIN` outside its own aggro, so
        // nobody is close enough to watch the bar jump.
        foe.health = this.statsOf(foe).maxHealth;
        foe.effects = [];
        foe.firedAbilities = [];
      }
      npc.npcFoe = undefined;
      npc.npcFightMs = 0;
      npc.autoAttack = false;
      npc.targetId = null;
      npc.npcBusy = false;
      // Nothing follows them out of it. A venom stack that outlived the fight
      // would tick one of them down in a field somewhere with nobody watching.
      npc.effects = [];
      // Losing is the half worth watching. They cannot win — see
      // `content/adventurers.ts` — so the only fights that end any other way
      // are the ones somebody else wanted.
      if (worn) {
        npc.npcUntilMs = 0;
        if (foe) this.say(npc, this.pick(DEATH_CHATTER).replace('%s', foe.name));
      } else if (beaten && foe) {
        // And the other way round, because a population that only ever reports
        // losing is not people, it is a running joke.
        this.say(npc, this.pick(DROVE_OFF_CHATTER).replace('%s', foe.name));
      }
      return false;
    }

    npc.npcBusy = true;
    npc.facing = Math.atan2(foe!.pos.x - npc.pos.x, foe!.pos.z - npc.pos.z);
    return true;
  }

  /**
   * One line every minute and a half or so, from somebody who is here.
   *
   * Quiet on purpose. The fastest way to make a fake population feel fake is
   * to make it chatty.
   */
  /** They get their wind back between fights. Nothing else heals them. */
  private restNpc(npc: Entity): void {
    if (npc.npcFoe !== undefined) return;
    const max = this.statsOf(npc).maxHealth;
    npc.health = Math.min(max, npc.health + max * REST_SHARE * (TICK_MS / 1000));
  }

  private tickChatter(npcs: Entity[]): void {
    const perTick = TICK_MS / (CHATTER_INTERVAL_SEC * 1000);
    if (!this.rng.chance(perTick)) return;

    const who = npcs[this.rng.int(0, npcs.length - 1)]!;
    this.say(who, this.pick(IDLE_CHATTER));
  }

  /**
   * One of them says something.
   *
   * `ambient` lines — filler and "that boar got me" — go through a shared
   * floor, so the population's volume is a property of the feature rather than
   * the sum of however many things can currently talk. `event` lines are
   * reactions to something that actually happened and always land.
   */
  private say(npc: Entity, text: string, kind: 'ambient' | 'event' = 'ambient'): void {
    const now = this.tickCount * TICK_MS;
    if (kind === 'ambient' && now - this.lastChatMs < CHATTER_MIN_GAP_MS) return;
    this.lastChatMs = now;
    this.events.push({
      t: 'chat',
      entityId: npc.id,
      name: npc.name,
      classId: npc.classId ?? 'warrior',
      text,
    });
  }

  private pick<T>(list: readonly T[]): T {
    return list[this.rng.int(0, list.length - 1)]!;
  }

  /**
   * Somebody reacts to something that actually happened.
   *
   * This is the half that keeps them from being wallpaper: a population that
   * only ever says filler is scenery, and one that only reacts is a
   * notification feed. They need both.
   */
  private reactTo(template: readonly string[], subject: string): void {
    // Nobody is standing here during a catch-up — and more to the point, a
    // reaction draws from the Rng, so a front that fell while you were logged
    // out would change the numbers of the next fight you picked. Time alone
    // moves the world in your absence.
    if (this.catchingUp) return;
    const npcs = [...this.entities.values()].filter((e) => e.kind === 'npc');
    if (npcs.length === 0) return;
    const who = npcs[this.rng.int(0, npcs.length - 1)]!;
    this.say(who, this.pick(template).replace('%s', subject), 'event');
  }

  /**
   * Somebody standing near you congratulates you on a level.
   *
   * Deliberately proximity-gated rather than global. A "grats" from thin air is
   * a system message with a name attached; a "grats" from the ranger who has
   * been working the same camp as you for ten minutes is the whole feature in
   * one line. If nobody is close enough to have seen it, nobody says anything.
   */
  private gratsFrom(player: Entity): void {
    const near = [...this.entities.values()].filter(
      (e) => e.kind === 'npc' && dist(e.pos.x, e.pos.z, player.pos.x, player.pos.z) <= GRATS_RANGE,
    );
    if (near.length === 0) return;
    const who = near[this.rng.int(0, near.length - 1)]!;
    this.say(who, this.pick(GRATS_CHATTER).replace('%s', player.name), 'event');
  }

  // ---------------------------------------------------------------- mounts

  /**
   * Take a weakened wild horse.
   *
   * The one interaction in the game that punishes finishing a fight. A horse
   * you kill is worth almost nothing; a horse you stop hitting at the right
   * moment is a mount. Every failure path says which mistake you made, because
   * "nothing happened" would read as the command being broken.
   */
  private tryCapture(player: Entity, mobId: EntityId): void {
    if (player.kind !== 'player') return;
    const mob = this.entities.get(mobId);
    const def = mob?.defId ? getMob(mob.defId) : undefined;
    const mount = def?.horse ? getMount(def.horse) : undefined;
    if (!mob || !mount) {
      this.events.push({ t: 'error', entityId: player.id, message: 'That is not a horse.' });
      return;
    }
    if (mob.dead) {
      this.events.push({
        t: 'error',
        entityId: player.id,
        message: `You cannot ride a dead ${mount.name}.`,
      });
      return;
    }
    if (dist(player.pos.x, player.pos.z, mob.pos.x, mob.pos.z) > CAPTURE_RANGE) {
      this.events.push({ t: 'error', entityId: player.id, message: 'Too far to take hold of it.' });
      return;
    }
    const fraction = mob.health / this.statsOf(mob).maxHealth;
    if (fraction > CAPTURE_THRESHOLD) {
      this.events.push({
        t: 'error',
        entityId: player.id,
        message: `The ${mount.name} is far too strong to handle.`,
      });
      return;
    }
    if ((player.stable ?? []).includes(mount.id)) {
      this.events.push({
        t: 'error',
        entityId: player.id,
        message: `You already have a ${mount.name}.`,
      });
      return;
    }

    if (!this.rng.chance(mount.captureChance)) {
      // A failed attempt costs you the fight: it breaks away and comes back
      // swinging, which is what stops capture being a free retry button.
      mob.health = this.statsOf(mob).maxHealth * 0.5;
      mob.aiState = 'chasing';
      mob.targetId = player.id;
      mob.threat = { [player.id]: 1 };
      this.events.push({ t: 'captured', entityId: player.id, mountId: null, name: mount.name });
      return;
    }

    player.stable = [...(player.stable ?? []), mount.id];
    this.entities.delete(mob.id);
    this.events.push({ t: 'despawn', entityId: mob.id });
    this.events.push({ t: 'captured', entityId: player.id, mountId: mount.id, name: mount.name });
  }

  /** Get on or off. `null` dismounts. */
  private tryMount(player: Entity, mountId: string | null): void {
    if (player.kind !== 'player') return;
    if (mountId === null) {
      if (!player.mounted) return;
      player.mounted = null;
      this.events.push({ t: 'mounted', entityId: player.id, mountId: null, unseated: false });
      return;
    }
    if (!(player.stable ?? []).includes(mountId)) {
      this.events.push({ t: 'error', entityId: player.id, message: 'You have no such horse.' });
      return;
    }
    player.mounted = mountId;
    this.events.push({ t: 'mounted', entityId: player.id, mountId, unseated: false });
  }

  /**
   * Thrown off by a telegraphed hit.
   *
   * The same three-way rule casting uses: the big obvious ones always land,
   * ordinary swings never do. Being unseated by chip damage would mean nobody
   * ever rode anything into a fight, which makes the whole mount pointless the
   * moment combat starts.
   */
  private unseat(player: Entity): void {
    if (!player.mounted) return;
    player.mounted = null;
    this.events.push({ t: 'mounted', entityId: player.id, mountId: null, unseated: true });
  }

  // --------------------------------------------------------------- dragons

  /**
   * Every dragon asleep, staggered so they do not all wake at once.
   *
   * The stagger is derived from the roster order rather than rolled: a fresh
   * world should always feel the same shape, and a seed that happened to wake
   * three dragons in the first minute would read as the feature being broken.
   */
  private resetDragons(): void {
    this.dragons = {};
    DRAGONS.forEach((def, i) => {
      this.dragons[def.id] = {
        phase: 'dormant',
        // Spread the first wakings across one full dormancy.
        remainingMs: minutes(DRAGON_DORMANT_MIN * (0.35 + (i / DRAGONS.length) * 0.9)),
        stop: 0,
        holdingId: null,
      };
    });
  }

  dragonState(dragonId: string): DragonState {
    const state = this.dragons[dragonId];
    if (!state) throw new Error(`Unknown dragon: ${dragonId}`);
    return state;
  }

  /**
   * Put a named creature on the ground. Tests only.
   *
   * `spawnMob` is private because a camp spawn point is the only thing that
   * should be deciding what turns up; this is the seam a test needs to put a
   * *specific* creature in front of the player.
   */
  spawnMobForTest(mobId: string, pos: Vec2): Entity {
    return this.spawnMob(mobId, pos);
  }

  /** The dragon sitting on this holding, if one is. */
  dragonOver(holdingId: string): DragonDef | undefined {
    for (const def of DRAGONS) {
      const state = this.dragons[def.id];
      if (state?.phase === 'roosting' && state.holdingId === holdingId) return def;
    }
    return undefined;
  }

  /**
   * Advance every dragon's routine, wherever the player happens to be.
   *
   * dormant -> hunting -> roosting -> hunting -> ... -> dormant, and `slain`
   * when someone finally manages it. The phases are minutes long because the
   * whole point is that a dragon is not something you queue for.
   */
  private tickDragons(stepMs: number = TICK_MS): void {
    for (const def of DRAGONS) {
      const state = this.dragons[def.id];
      if (!state) continue;
      state.remainingMs -= stepMs;
      if (state.remainingMs > 0) continue;
      // Carry the overshoot into the next phase rather than discarding it.
      // At tick granularity this is worth 50ms and nothing else; in `catchUp`,
      // where a step is half a minute, throwing it away would round every
      // phase up to the step and stretch a dragon's whole routine.
      const carry = state.remainingMs;
      const next = (ms: number) => ms + carry;

      switch (state.phase) {
        case 'dormant':
        case 'slain': {
          // Clear the carcass, if the player left one lying on a holding.
          this.despawnDragon(def);
          state.phase = 'hunting';
          state.stop = 0;
          state.holdingId = null;
          state.remainingMs = next(minutes(DRAGON_HUNT_MIN));
          this.dragonEvent(def, state, def.waking);
          break;
        }
        case 'hunting': {
          const holdingId = def.territory[state.stop % def.territory.length]!;
          state.phase = 'roosting';
          state.holdingId = holdingId;
          state.remainingMs = next(minutes(DRAGON_ROOST_MIN));
          this.dragonEvent(def, state, def.arrival);
          this.syncDragonEntity(def);
          this.clearGarrison(holdingId);
          if (def.zoneId === this.zone.id) this.reactTo(DRAGON_CHATTER, def.name);
          break;
        }
        case 'roosting': {
          state.stop += 1;
          state.holdingId = null;
          this.despawnDragon(def);
          if (state.stop >= def.territory.length) {
            state.phase = 'dormant';
            state.remainingMs = next(minutes(DRAGON_DORMANT_MIN));
            this.dragonEvent(def, state, `${def.name} goes back to the dark.`);
          } else {
            state.phase = 'hunting';
            state.remainingMs = next(minutes(DRAGON_HUNT_MIN));
            this.dragonEvent(def, state, `${def.name} is moving.`);
          }
          break;
        }
      }
    }
  }

  private dragonEvent(def: DragonDef, state: DragonState, text: string): void {
    this.events.push({
      t: 'dragon',
      dragonId: def.id,
      name: def.name,
      phase: state.phase,
      zoneId: def.zoneId,
      holdingId: state.holdingId,
      text,
    });
  }

  /**
   * Put the dragon in the world if the player is standing in its zone.
   *
   * Only one zone is loaded at a time, so a dragon roosting three zones away
   * is a phase and a banner rather than an entity — and walking into its zone
   * while it is out is how you find it.
   */
  private syncDragonEntity(def: DragonDef): void {
    if (def.zoneId !== this.zone.id) return;
    const state = this.dragonState(def.id);
    if (state.phase !== 'roosting' || !state.holdingId) return;
    if (this.dragonEntity(def)) return;
    const holding = getHolding(state.holdingId);
    const mob = this.spawnMob(dragonMobId(def), holding.pos);
    mob.dragonId = def.id;
  }

  private dragonEntity(def: DragonDef): Entity | undefined {
    for (const e of this.entities.values()) if (e.dragonId === def.id) return e;
    return undefined;
  }

  private despawnDragon(def: DragonDef): void {
    const entity = this.dragonEntity(def);
    if (!entity) return;
    this.entities.delete(entity.id);
    this.events.push({ t: 'despawn', entityId: entity.id });
  }

  /**
   * Drive the garrison off a holding.
   *
   * They do not die — they leave. Killing a hundred guards with a scripted
   * event would hand the player a hundred kills' worth of nothing, and the
   * fiction is better anyway: a dragon lands and people run.
   */
  private clearGarrison(holdingId: string): void {
    for (const e of [...this.entities.values()]) {
      if (e.kind !== 'mob' || e.holding !== holdingId) continue;
      this.entities.delete(e.id);
      this.events.push({ t: 'despawn', entityId: e.id });
    }
  }

  /** True while a dragon is sitting on this holding. */
  isSuppressed(holdingId: string): boolean {
    return this.dragonOver(holdingId) !== undefined;
  }

  // -------------------------------------------------------------- standing

  /** What a faction makes of the player, from -1000 to +1000. */
  standingWith(entity: Entity, factionId: FactionId): number {
    return entity.standing?.[factionId] ?? 0;
  }

  /**
   * Move standing, and report it when the change means something.
   *
   * Only band crossings are announced. A player killing a camp does not need
   * a line of log per corpse; they need to be told the moment the outlaws
   * decide they are an enemy.
   */
  private addStanding(player: Entity, factionId: FactionId, amount: number): void {
    player.standing = player.standing ?? {};
    const before = player.standing[factionId] ?? 0;
    const after = Math.max(-STANDING_LIMIT, Math.min(STANDING_LIMIT, before + amount));
    player.standing[factionId] = after;
    if (standingBand(before) !== standingBand(after)) {
      this.events.push({
        t: 'standingChanged',
        entityId: player.id,
        factionId,
        value: after,
        band: standingBand(after),
      });
    }
  }

  /**
   * Whether this creature starts fights with the player.
   *
   * Wildlife always does — a bear does not care about your reputation. People
   * are the interesting case: come to terms with a faction and its guards stop
   * swinging at you, wrong them badly enough and they attack on sight even
   * outside their own aggro radius. In a game with no other players in it,
   * this is the most legible way the world can react to what you have done.
   */
  private isHostileTo(mob: Entity, player: Entity): boolean {
    const factionId = getMob(mob.defId!).factionId;
    if (!factionId) return true;
    return this.standingWith(player, factionId) < TRUCE_AT;
  }

  /** Faction guards notice a hated enemy from further off. */
  private aggroRadiusFor(mob: Entity, player: Entity): number {
    const def = getMob(mob.defId!);
    // In the dark, everything notices you from further off. This is the whole
    // gameplay consequence of the day cycle, and one is enough: it makes
    // crossing a zone at night a decision, it is legible without a tooltip,
    // and it costs nothing to explain.
    const base = def.aggroRadius * (this.daylight().dark ? NIGHT_AGGRO : 1);
    if (!def.factionId) return base;
    return this.standingWith(player, def.factionId) <= HOSTILE_AT ? base * 1.6 : base;
  }

  /** Where the sun is. Pure function of world time — see `content/daylight.ts`. */
  daylight(): Daylight {
    return daylightAt(this.worldTimeMs);
  }

  /** What the sky is doing over the zone you are standing in. */
  weather(): Weather {
    return weatherAt(this.zone.id, this.worldTimeMs);
  }

  /**
   * Everything a kill does to the political map.
   *
   * One kill is a rounding error; a session of them is a front moving. That
   * ratio is the point — territory should be earned at grind scale, in the
   * same currency the rest of the game is paid in.
   */
  private applyKillPolitics(player: Entity, victim: Entity): void {
    const def = getMob(victim.defId!);
    const factionId = def.factionId;
    if (!factionId) return;

    this.addStanding(player, factionId, -STANDING_PER_KILL);
    const rival = getFaction(factionId).rival;
    this.addStanding(player, rival, STANDING_PER_KILL * STANDING_RIVAL_SHARE);

    const pressure = isBoss(def.stars) ? PRESSURE_PER_BOSS : PRESSURE_PER_KILL;
    const front = this.frontFor(victim, factionId);
    if (!front) return;
    const challenger =
      front.claimants[0] === factionId ? front.claimants[1] : front.claimants[0];
    this.applyPressure(front.id, challenger, pressure, true);
  }

  /**
   * Which front a kill counts toward: the one it happened at.
   *
   * A guard dies at their own post. Anyone else is credited to the nearest
   * front their faction holds in this zone, so clearing a camp in the open
   * still weakens the people who sent them.
   *
   * Spreading one kill across every front that faction holds was the obvious
   * alternative and it is worse: it makes the map move somewhere you are not,
   * so a player fighting at the Road Watch watches the Southern Marsh fall.
   * Territory should be taken where you are standing.
   */
  private frontFor(victim: Entity, factionId: FactionId): (typeof HOLDINGS)[number] | undefined {
    if (victim.holding && this.controllerOf(victim.holding) === factionId) {
      return getHolding(victim.holding);
    }
    const here = HOLDINGS.filter(
      (h) => h.zoneId === this.zone.id && this.controllerOf(h.id) === factionId,
    );
    if (here.length === 0) return undefined;
    return here.reduce((closest, h) =>
      dist(victim.pos.x, victim.pos.z, h.pos.x, h.pos.z) <
      dist(victim.pos.x, victim.pos.z, closest.pos.x, closest.pos.z)
        ? h
        : closest,
    );
  }

  private spawnMob(
    requestedId: string,
    pos: Vec2,
    summonedBy?: EntityId,
    holding?: string,
    plain?: boolean,
  ): Entity {
    // A rare asked for BY NAME is spawned as itself. Only a camp spawn point
    // rolls — and unwrapping `rareOf` here as well silently turned every
    // deliberate rare spawn back into its host, which had a balance test
    // measuring the ordinary mob twice and reporting it as a match.
    const defId = getMob(requestedId).rareOf
      ? requestedId
      : this.spawnChoice(requestedId, summonedBy !== undefined || plain === true);
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
      ...(holding !== undefined ? { holding } : {}),
      ...(plain ? { plainSpawn: true } : {}),
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
    if (def.rareOf) this.announceRare(mob, def);
    return mob;
  }

  /** Tell the renderer a named creature is up, and what it looks like. */
  private announceRare(mob: Entity, def: MobDef): void {
    this.events.push({
      t: 'rareSpawn',
      entityId: mob.id,
      mobId: def.id,
      name: def.name,
      sighting: def.sighting ?? '',
    });
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
    // An adventurer carries no gear and spends no points, so there is nothing
    // to derive from — see `adventurerStats`. They needed one at all only once
    // they started pulling real creatures.
    if (e.kind === 'npc') return adventurerStats(e.level);
    if (e.kind === 'mob') {
      const def = getMob(e.defId!);
      stats = deriveMobStats(def);
      // An add belongs to the boss that called it, and a boss fight is tuned as
      // one thing. See `unscaleAdd`.
      if (e.summonedBy !== undefined) stats = unscaleAdd(stats, def.level);
    } else {
      const acc = {
        attributes: { ...(e.attributes ?? emptyAttributes()) },
        armor: 0,
        affix: emptyAffixes(),
      };
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
      // Whatever you are riding rides with you: its speed replaces yours and
      // its bonus lands on the same accumulator gear uses, so a mount is
      // simply another source of the same numbers.
      const mount = e.mounted ? getMount(e.mounted) : undefined;
      if (mount) {
        acc.affix.damage += mount.bonus.damageBonus ?? 0;
        acc.affix.health += mount.bonus.healthBonus ?? 0;
        acc.affix.regen += mount.bonus.regenBonus ?? 0;
        acc.armor += mount.bonus.armorBonus ?? 0;
      }
      stats = deriveStats({
        level: e.level,
        attributes: acc.attributes,
        primaryAttribute: PRIMARY_ATTRIBUTE[e.classId ?? 'warrior'],
        armor: acc.armor,
        affix: acc.affix,
        weapon,
      });
      if (mount) stats.moveSpeed = mount.speed + acc.affix.moveSpeed;
    }

    // Buffs are additive on defence and multiplicative on outgoing damage.
    let damageMultiplier = 1;
    for (const eff of e.effects) {
      if (eff.kind !== 'buff') continue;
      stats.defense += scaledDefenseBonus(eff.defenseBonus ?? 0, e.level);
      damageMultiplier *= eff.damageMultiplier ?? 1;
      stats.moveSpeed += eff.moveSpeedBonus ?? 0;
    }

    // A creature's trait, which is the only thing an ordinary mob does that a
    // stat block cannot. See `content/traits.ts`.
    if (e.kind === 'mob' && !e.dead) {
      damageMultiplier *= this.traitDamage(e);
      // And whether it stepped up when its ground was farmed. Small, because
      // the extra rating is already most of it.
      if (e.roused) damageMultiplier *= ROUSED_DAMAGE;
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
      case 'search':
        this.trySearch(e);
        break;
      case 'equip':
        this.tryEquip(e, cmd.itemId);
        break;
      case 'learnSkill':
        this.tryLearnSkill(e, cmd.itemId);
        break;
      case 'use':
        this.tryUse(e, cmd.itemId);
        break;
      case 'rankSkill':
        this.tryRankSkill(e, cmd.skillId);
        break;
      case 'capture':
        this.tryCapture(e, cmd.id);
        break;
      case 'mount':
        this.tryMount(e, cmd.mountId);
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
      case 'reclaim':
        if (e.kind === 'player') this.reclaim(e);
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

    this.worldTimeMs += TICK_MS;
    this.tickTerritory();
    this.tickDragons();
    this.tickAdventurers();
    this.tickCooldowns();
    this.tickEffects();
    this.tickHazards();
    this.tickCasts();
    this.tickAi();
    this.tickPacks();
    this.tickRoused();
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

  /**
   * Run the hours you were not here.
   *
   * The whole faction layer exists so that walking away and coming back means
   * walking into a different map. Until this, that was only true if you left
   * the tab open — which made "the world moves without you" a claim the game
   * only honoured while you were watching it.
   *
   * Three rules make this safe to run over a fortnight:
   *
   *  - **Only the world layers.** Territory drift and the dragons' routine,
   *    which are the two things that are genuinely about elapsed time. No
   *    combat, no respawns, no regeneration, nobody wandering: a mob that
   *    fought a hundred battles in an empty room is not a simulation, it is a
   *    random number generator with extra steps.
   *  - **The same rules, at a coarser step.** `tickTerritory` and `tickDragons`
   *    are the ones the live loop calls; only `stepMs` differs. A separate
   *    "offline" path is a second implementation of the world that is free to
   *    disagree with the first one.
   *  - **A summary, not a transcript.** Fourteen days of drift is hundreds of
   *    events, and a log that opens with forty lines of "Saorla is moving" has
   *    buried the one line that mattered. What comes back is the net change:
   *    which ground actually ended up in different hands.
   *
   * Time is a *parameter*, never a reading — `sim/` must never look at a clock.
   * The host stamps the save and hands the elapsed span in, which is also
   * exactly how a server would tell a reconnecting client what it missed.
   */
  catchUp(elapsedMs: number): AwayReport {
    const away = Math.min(Math.max(0, elapsedMs), MAX_AWAY_MS);
    const before = { ...this.controller };

    // Swallow the event stream: this produces a report, not a play-by-play.
    const live = this.events;
    this.events = [];
    this.catchingUp = true;
    const steps = Math.floor(away / AWAY_STEP_MS);
    for (let i = 0; i < steps; i++) {
      this.tickTerritory(AWAY_STEP_MS);
      this.tickDragons(AWAY_STEP_MS);
    }
    // The sun keeps moving too. It is elapsed time and nothing else, so it
    // takes the whole span rather than only the part that divides evenly into
    // AWAY_STEP_MS — the remainder is still time that passed.
    this.worldTimeMs += away;
    this.catchingUp = false;
    this.events = live;

    const fronts: AwayReport['fronts'] = [];
    for (const holding of HOLDINGS) {
      const from = before[holding.id];
      const to = this.controller[holding.id];
      // Net change only. A front that flipped twice and came back is a front
      // that did not change, however busy the fortnight was.
      if (!from || !to || from === to) continue;
      fronts.push({ holdingId: holding.id, name: holding.name, from, to });
    }

    const dragons: AwayReport['dragons'] = [];
    for (const def of DRAGONS) {
      const state = this.dragons[def.id];
      if (state?.phase !== 'roosting' || !state.holdingId) continue;
      dragons.push({
        dragonId: def.id,
        name: def.name,
        zoneId: def.zoneId,
        holdingId: state.holdingId,
        holdingName: getHolding(state.holdingId).name,
      });
    }

    return { awayMs: away, cappedAt: away < Math.max(0, elapsedMs) ? MAX_AWAY_MS : null, fronts, dragons };
  }

  private tickCooldowns(): void {
    for (const e of this.entities.values()) {
      if (e.gcdMs !== undefined && e.gcdMs > 0) e.gcdMs = Math.max(0, e.gcdMs - TICK_MS);
      const drinks = e.consumableCooldowns;
      if (drinks) {
        for (const family of Object.keys(drinks) as Array<'potion' | 'elixir'>) {
          const remaining = (drinks[family] ?? 0) - TICK_MS;
          if (remaining <= 0) delete drinks[family];
          else drinks[family] = remaining;
        }
      }
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
        if (eff.kind === 'buff' && eff.regenPerTick && eff.sinceTickMs >= eff.tickMs && !e.dead) {
          eff.sinceTickMs -= eff.tickMs;
          const stats = this.statsOf(e);
          const before = e.health;
          e.health = Math.min(stats.maxHealth, e.health + eff.regenPerTick);
          const healed = Math.round(e.health - before);
          if (healed > 0) {
            this.events.push({
              t: 'heal',
              sourceId: e.id,
              targetId: e.id,
              amount: healed,
            });
          }
        }
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

  /**
   * Ground patches bite whoever is standing in them, then expire.
   *
   * A hazard tick never breaks a cast, for the same reason a damage-over-time
   * tick does not: standing in a patch would silently disable casting, and no
   * player would ever attribute that to the ground they are standing on.
   */
  private tickHazards(): void {
    if (this.hazards.length === 0) return;
    const keep: typeof this.hazards = [];
    for (const hazard of this.hazards) {
      hazard.remainingMs -= TICK_MS;
      hazard.sinceTickMs += TICK_MS;
      if (hazard.sinceTickMs >= hazard.tickMs) {
        hazard.sinceTickMs -= hazard.tickMs;
        const player = this.player;
        if (!player.dead && dist(player.pos.x, player.pos.z, hazard.at.x, hazard.at.z) <= hazard.radius) {
          this.applyDamage(
            hazard.sourceId,
            player,
            Math.round(hazard.power),
            false,
            hazard.damageType,
            null,
            'never',
          );
        }
      }
      if (hazard.remainingMs > 0) keep.push(hazard);
      else this.events.push({ t: 'hazardGone', id: hazard.id });
    }
    this.hazards = keep;
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
            this.isHostileTo(e, player) &&
            dist(e.pos.x, e.pos.z, player.pos.x, player.pos.z) <= this.aggroRadiusFor(e, player)
          ) {
            e.targetId = player.id;
            e.threat![player.id] = 1;
            e.aiState = 'chasing';
            e.roamGoal = null;
            this.events.push({ t: 'aggro', mobId: e.id, targetId: player.id });
            break;
          }
          this.tickRoam(e, def);
          break;
        }
        case 'chasing':
        case 'attacking': {
          const target = this.highestThreatTarget(e);
          if (!target || target.dead) {
            this.leashMob(e);
            break;
          }
          if (this.tickSkittish(e, def, target)) break;
          e.targetId = target.id;
          const d = dist(e.pos.x, e.pos.z, target.pos.x, target.pos.z);
          e.aiState = d <= this.statsOf(e).attackRange ? 'attacking' : 'chasing';
          // A casting mob is rooted, and that has to include which way it is
          // pointing. This used to re-aim every tick regardless, so a `cleave`
          // tracked the player through its whole wind-up and the cone drawn on
          // the ground was a lie — the balance harness dodged it perfectly and
          // was hit every single time, which is exactly the shape of failure
          // the telegraph rule exists to prevent.
          if (!e.cast) e.facing = Math.atan2(target.pos.x - e.pos.x, target.pos.z - e.pos.z);
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

  /**
   * Count each fighting creature's packmates, once a tick.
   *
   * Only what is actually in combat: a mob standing in its camp has no use for
   * a damage multiplier, and that is the difference between five creatures
   * being counted and six hundred.
   */
  /**
   * Being roused wears off.
   *
   * Only while it is *not* fighting: a champion that calms down mid-fight
   * because a minute passed turns a decision into a waiting game, and running
   * away for sixty seconds should be the way out rather than standing still
   * for it.
   */
  private tickRoused(): void {
    for (const e of this.entities.values()) {
      if (e.kind !== 'mob' || !e.roused || e.dead) continue;
      if (e.aiState === 'chasing' || e.aiState === 'attacking') continue;
      e.rousedMs = (e.rousedMs ?? 0) - TICK_MS;
      if ((e.rousedMs ?? 0) > 0) continue;
      // Back to what it was. Through both wrappers, the same way the respawn
      // does — a roused ★3 of a ★2 creature is a rating of a rating otherwise.
      const base = baseMobId(getMob(e.defId!).rareOf ?? e.defId!);
      e.roused = false;
      e.rousedMs = 0;
      e.defId = base;
      e.name = getMob(base).name;
      e.level = getMob(base).level;
      e.health = Math.min(e.health, this.statsOf(e).maxHealth);
    }
  }

  private tickPacks(): void {
    for (const mob of this.entities.values()) {
      if (mob.kind !== 'mob' || mob.dead) continue;
      if (mob.aiState !== 'chasing' && mob.aiState !== 'attacking') {
        mob.packAllies = 0;
        continue;
      }
      const def = getMob(mob.defId!);
      if (traitFor(def)?.id !== 'pack') continue;
      // Its own kind only. A wolf takes no comfort from the boar next to it,
      // and counting everything in range would make a mixed camp — which is
      // most of them — into one large pack.
      const base = baseMobId(def.rareOf ?? mob.defId!);
      let allies = 0;
      for (const other of this.entities.values()) {
        if (other === mob || other.kind !== 'mob' || other.dead) continue;
        if (baseMobId(getMob(other.defId!).rareOf ?? other.defId!) !== base) continue;
        if (dist(mob.pos.x, mob.pos.z, other.pos.x, other.pos.z) > PACK_RANGE) continue;
        allies++;
        if (allies >= PACK_MAX_ALLIES) break;
      }
      mob.packAllies = allies;
    }
  }

  /**
   * A skittish creature turns and runs when it is badly hurt.
   *
   * Returns true if it is running, which takes it out of the ordinary chase
   * for the rest of the tick.
   *
   * The answer is *the opposite* of every other trait's: this one wants you to
   * decide whether the kill is worth the chase. It runs once — `fled` is set
   * for good — because a creature that bolts every time it dips below the line
   * is a creature you can never finish, and "unkillable" is not a mechanic, it
   * is a bug that reads as one.
   */
  private tickSkittish(mob: Entity, def: MobDef, target: Entity): boolean {
    const trait = traitFor(def);
    if (trait?.id !== 'skittish') return false;

    if ((mob.fleeingMs ?? 0) > 0) {
      mob.fleeingMs = (mob.fleeingMs ?? 0) - TICK_MS;
      if ((mob.fleeingMs ?? 0) <= 0) {
        mob.fleeingMs = 0;
        return false;
      }
      // Directly away, at a scramble. Not toward its spawn: a creature that
      // flees *home* is a creature you can head off, which turns a decision
      // into a routine.
      const away = Math.atan2(mob.pos.x - target.pos.x, mob.pos.z - target.pos.z);
      const step = (this.statsOf(mob).moveSpeed * SKITTISH_SPEED * TICK_MS) / 1000;
      let x = mob.pos.x + Math.sin(away) * step;
      let z = mob.pos.z + Math.cos(away) * step;
      // Never out of its own leash. Past it the ordinary leash check sends it
      // home and heals it to full, which makes a creature that flees at 28%
      // health one you can only kill by bursting the last quarter in three
      // seconds — unkillable by any other means, which is not a trait, it is
      // a bug that reads as one.
      const spawn = mob.spawnPos!;
      const out = dist(x, z, spawn.x, spawn.z);
      const cap = def.leashRadius * SKITTISH_LEASH;
      if (out > cap) {
        const back = cap / out;
        x = spawn.x + (x - spawn.x) * back;
        z = spawn.z + (z - spawn.z) * back;
      }
      mob.pos = { x, z };
      mob.facing = away;
      mob.aiState = 'chasing';
      return true;
    }

    if (mob.fled) return false;
    if (mob.health / this.statsOf0(mob) > SKITTISH_AT) return false;
    mob.fled = true;
    mob.fleeingMs = SKITTISH_MS;
    this.events.push({ t: 'flees', mobId: mob.id, name: mob.name });
    return true;
  }

  /**
   * Can this creature amble about, or does it stand where it was put?
   *
   * Four exclusions, each for a different reason:
   *  - **Bosses and dragons.** Their ground is levelled flat so a telegraph
   *    circle reads; wandering off it draws one down a hill.
   *  - **Summons.** Adds exist for the length of a fight and arrive already
   *    chasing. One that strolled off would be a bug wearing a feature.
   *  - **Garrisons.** A guard post is the visible half of the territory layer.
   *    A watch that wanders is not watching anything.
   */
  private canRoam(mob: Entity, def: MobDef): boolean {
    if (isBoss(def.stars) || def.dragon) return false;
    if (mob.summonedBy !== undefined) return false;
    if (mob.holding !== undefined) return false;
    return true;
  }

  /**
   * Pick somewhere to amble to, after standing about for a while.
   *
   * The destination is hashed from (entity id, wander count) rather than drawn
   * from `this.rng` — see `Entity.roamGoal`. Deterministic either way; this way
   * a populated zone and an empty test arena roll the same combat numbers.
   */
  private tickRoam(mob: Entity, def: MobDef): void {
    if (!this.canRoam(mob, def)) return;
    if (mob.roamGoal) return;
    mob.roamWaitMs = (mob.roamWaitMs ?? ROAM_PAUSE_MIN_MS) - TICK_MS;
    if (mob.roamWaitMs > 0) return;

    const step = (mob.roamStep ?? 0) + 1;
    mob.roamStep = step;
    const angle = roamHash(mob.id, step) * Math.PI * 2;
    // sqrt so destinations are spread evenly over the disc rather than
    // clustering at the spawn mark, which is the whole thing we are leaving.
    const radius = Math.sqrt(roamHash(mob.id, step + 7919)) * roamRadiusFor(def.leashRadius);
    const spawn = mob.spawnPos!;
    mob.roamGoal = {
      x: spawn.x + Math.sin(angle) * radius,
      z: spawn.z + Math.cos(angle) * radius,
    };
  }

  /** Send a mob home, drop its threat, and clean up anything it called in. */
  private leashMob(mob: Entity): void {
    mob.roamGoal = null;
    mob.castAt = null;
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

        this.noteAbilitySeen(e, ability.id);

        if (ability.castMs > 0) {
          // Ground-targeted abilities stamp their landing spot now, while the
          // player is standing on it. That stamp is the whole mechanic: the
          // circle on the ground is a promise about where this will land, and
          // re-aiming at resolution would break it.
          const aimed = ability.kind === 'fixate' || ability.kind === 'hazard';
          const mark = this.entities.get(e.targetId ?? -1);
          e.castAt = aimed && mark ? { ...mark.pos } : null;
          // A cleave is aimed the same way but at a direction rather than a
          // point, and the mob is rooted, so its facing at cast time is the
          // arc that lands.
          if (ability.kind === 'cleave' && mark) {
            e.facing = Math.atan2(mark.pos.x - e.pos.x, mark.pos.z - e.pos.z);
          }
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
            shape: ability.kind === 'cleave' ? 'cone' : 'circle',
            ...(e.castAt ? { at: { ...e.castAt } } : {}),
            ...(ability.kind === 'cleave'
              ? { facing: e.facing, arc: ((ability.arcDegrees ?? 100) * Math.PI) / 180 }
              : {}),
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
      case 'cleave': {
        // Aimed where the mob was facing when the cast began — it is rooted
        // through the wind-up, so the arc drawn is the arc that lands. Running
        // straight back keeps you inside it; the answer is to go round.
        const radius = ability.radius ?? 9;
        const arc = ((ability.arcDegrees ?? 100) * Math.PI) / 180;
        for (const target of [...this.entities.values()]) {
          if (target.kind !== 'player' || target.dead) continue;
          const dx = target.pos.x - mob.pos.x;
          const dz = target.pos.z - mob.pos.z;
          const d = Math.hypot(dx, dz);
          const bearing = Math.atan2(dx, dz);
          let off = Math.abs(bearing - mob.facing);
          if (off > Math.PI) off = Math.PI * 2 - off;
          if (d > radius || off > arc / 2) {
            this.events.push({ t: 'dodged', sourceId: mob.id, targetId: target.id, abilityId });
            continue;
          }
          const result = resolveAttack(this.rng, stats, this.statsOf(target), {
            levelDiff: mob.level - target.level,
            attackerLevel: mob.level,
            weaponMultiplier: ability.damageMultiplier ?? 2.6,
            flatPower: 0,
            alwaysHits: true,
          });
          this.applyDamage(mob.id, target, result.amount, result.crit, stats.damageType, abilityId, 'always');
        }
        break;
      }
      case 'fixate': {
        // The circle is already on the ground where the target was standing
        // when the cast began — see `tickMobAbilities`, which stamps it there.
        // Landing it back on the target's *current* position would make this
        // undodgeable, which is the one thing a telegraph must never be.
        const radius = ability.radius ?? 5;
        const at = mob.castAt ?? mob.pos;
        for (const target of [...this.entities.values()]) {
          if (target.kind !== 'player' || target.dead) continue;
          if (dist(at.x, at.z, target.pos.x, target.pos.z) > radius) {
            this.events.push({ t: 'dodged', sourceId: mob.id, targetId: target.id, abilityId });
            continue;
          }
          const result = resolveAttack(this.rng, stats, this.statsOf(target), {
            levelDiff: mob.level - target.level,
            attackerLevel: mob.level,
            weaponMultiplier: ability.damageMultiplier ?? 3,
            flatPower: 0,
            alwaysHits: true,
          });
          this.applyDamage(mob.id, target, result.amount, result.crit, stats.damageType, abilityId, 'always');
        }
        // The charge ends *short* of the mark, at about weapon range, not on
        // it. Landing exactly on the mark put the boss inside the player when
        // they had not moved — two bodies at one point, after which every
        // distance in the fight is zero, "run away from the boss" has no
        // direction to run in, and the player is welded to it for the rest of
        // the fight. It is also how a charge should look: it closes, it does
        // not merge.
        const back = Math.atan2(mob.pos.x - at.x, mob.pos.z - at.z);
        const standoff = Math.max(1.5, this.statsOf(mob).attackRange * 0.85);
        mob.pos = { x: at.x + Math.sin(back) * standoff, z: at.z + Math.cos(back) * standoff };
        mob.facing = Math.atan2(at.x - mob.pos.x, at.z - mob.pos.z);
        break;
      }
      case 'hazard': {
        const at = mob.castAt ?? mob.pos;
        const radius = ability.radius ?? 5;
        const durationMs = ability.hazardMs ?? 12000;
        // Per-tick damage is a fraction of a swing, not a fraction of a slam.
        // A patch is a space you lose, not a burst you eat.
        const power =
          ((stats.damageMin + stats.damageMax) / 2) * (ability.hazardMultiplier ?? 0.45);
        const id = this.nextHazardId++;
        this.hazards.push({
          id,
          sourceId: mob.id,
          at: { ...at },
          radius,
          remainingMs: durationMs,
          tickMs: ability.hazardTickMs ?? 1000,
          sinceTickMs: 0,
          power,
          damageType: stats.damageType,
        });
        this.events.push({ t: 'hazard', id, sourceId: mob.id, at: { ...at }, radius, durationMs });
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
      // Adventurers walk themselves, in `tickAdventurers`. Running them through
      // the combat mover would give them a chase state they can never have.
      if (e.kind === 'npc') continue;
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
        let speed = stats.moveSpeed;
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
        } else if (e.aiState === 'idle' && e.roamGoal) {
          goal = e.roamGoal;
          stopAt = 0.2;
          speed = stats.moveSpeed * ROAM_SPEED;
        }
        if (goal) {
          const dx = goal.x - e.pos.x;
          const dz = goal.z - e.pos.z;
          const d = Math.hypot(dx, dz);
          if (d > stopAt) {
            const step = Math.min(speed * dt, d - stopAt);
            e.pos.x += (dx / d) * step;
            e.pos.z += (dz / d) * step;
            e.facing = Math.atan2(dx, dz);
          } else if (goal === e.roamGoal) {
            // Arrived. Stand about for a while before picking somewhere else,
            // so a camp reads as animals grazing rather than a patrol route.
            e.roamGoal = null;
            const spread = ROAM_PAUSE_MAX_MS - ROAM_PAUSE_MIN_MS;
            e.roamWaitMs = ROAM_PAUSE_MIN_MS + roamHash(e.id, (e.roamStep ?? 0) + 104729) * spread;
          }
        }
      }

      e.pos.x = Math.max(-limit, Math.min(limit, e.pos.x));
      e.pos.z = Math.max(-limit, Math.min(limit, e.pos.z));
    }
  }

  /**
   * What a creature's trait is doing to its damage right now.
   *
   * Both of the damage traits are *conditional*, and that is the whole design:
   * a flat bonus is a bigger number and changes nothing, while a bonus that
   * turns on when its own kind is beside it — or when it is nearly dead —
   * gives the fight a shape and gives the player something to do about it.
   */
  private traitDamage(mob: Entity): number {
    const trait = traitFor(getMob(mob.defId!));
    if (!trait) return 1;

    // Read, never counted. `statsOf` is called many times per entity per tick
    // and there are six hundred creatures in a zone, so scanning for packmates
    // in here is a quarter of a million distance checks a tick — which is what
    // it was, and `smoke` reported it as the simulation blowing its budget.
    // `tickPacks` does the counting once, and only for what is fighting.
    if (trait.id === 'pack') return 1 + (mob.packAllies ?? 0) * PACK_PER_ALLY;

    if (trait.id === 'stubborn') {
      const share = mob.health / this.statsOf0(mob);
      return share <= STUBBORN_AT ? STUBBORN_DAMAGE : 1;
    }
    return 1;
  }

  /**
   * Max health without going back through `statsOf`.
   *
   * `traitDamage` is called *from* `statsOf`, and a stubborn creature asking
   * for its own health share would otherwise recurse forever.
   */
  private statsOf0(mob: Entity): number {
    return Math.max(1, deriveMobStats(getMob(mob.defId!)).maxHealth);
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
      // Non-combatants are not swung at, not just unhurt by it. A swing
      // animation that can never land is worse than no swing at all — which is
      // also why a creature an adventurer pulled *is* swung at: that one lands.
      if (target.kind === 'vendor') continue;
      if (target.kind === 'npc' && e.kind !== 'mob') continue;
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
      this.applyVenom(e, target, stats);
    }
  }

  /**
   * A venomous creature's bite stacks, and the poison outlives it.
   *
   * The answer is not "kill it faster" for its own sake — it is that a fight
   * you are *winning slowly* against a venomous thing is a fight you are
   * losing, which is a genuinely different decision from every other creature
   * in the game. The stack persisting past its death is what makes pulling a
   * second one while poisoned a real mistake rather than an inconvenience.
   */
  private applyVenom(mob: Entity, target: Entity, stats: DerivedStats): void {
    if (mob.kind !== 'mob') return;
    const trait = traitFor(getMob(mob.defId!));
    if (trait?.id !== 'venomous') return;

    target.effects = target.effects ?? [];
    const existing = target.effects.filter((e) => e.sourceAbilityId === 'venom');
    if (existing.length >= VENOM_MAX_STACKS) {
      // Refresh rather than add: a cap that silently drops the newest stack
      // makes a long fight *safer* than a short one, which is backwards.
      for (const e of existing) e.remainingMs = VENOM_MS;
      return;
    }
    target.effects.push({
      id: `venom:${this.nextId++}`,
      kind: 'dot',
      sourceId: mob.id,
      sourceAbilityId: 'venom',
      remainingMs: VENOM_MS,
      tickMs: VENOM_TICK_MS,
      sinceTickMs: 0,
      damageType: 'nature',
      dotPower: Math.max(
        1,
        Math.round(
          Math.min(
            ((stats.damageMin + stats.damageMax) / 2) * VENOM_SHARE,
            this.statsOf(target).maxHealth * VENOM_MAX_TICK,
          ),
        ),
      ),
    });
  }

  private tickRegen(): void {
    const dt = TICK_MS / 1000;
    for (const e of this.entities.values()) {
      if (e.dead || e.kind === 'vendor' || e.kind === 'npc') continue;
      const stats = this.statsOf(e);
      const combat = this.inCombat(e.id);
      // The flat part comes from amulets and bracelets and does NOT scale with
      // max health, so it is worth most to the classes with the least of it.
      const regen = healthRegenPerSec(stats, combat) + stats.regenPerSec;
      e.health = Math.min(stats.maxHealth, e.health + regen * dt);
      e.energy = Math.min(stats.maxEnergy, e.energy + energyRegenPerSec(stats, combat) * dt);
    }
  }

  private tickRespawns(): void {
    for (const e of this.entities.values()) {
      if (!e.dead || e.kind !== 'mob') continue;
      // A dragon is never on a respawn timer, however it got into the world.
      // Keyed off the DEFINITION rather than `e.dragonId`, which is only set
      // on the world's own dragons: a dragon in a test arena was resurrecting
      // at full health on the tick it died, so every fight against one
      // measured as unwinnable and three rounds of "tuning" chased a ghost.
      if (getMob(e.defId!).dragon) continue;
      // Adds never respawn — they belong to a fight that is already over.
      if (e.summonedBy !== undefined) {
        this.entities.delete(e.id);
        this.events.push({ t: 'despawn', entityId: e.id });
        continue;
      }
      e.respawnInMs -= TICK_MS;
      if (e.respawnInMs > 0) continue;
      // Nobody is standing a post under a dragon.
      if (e.holding && this.isSuppressed(e.holding)) {
        e.respawnInMs = 5000;
        continue;
      }
      // Every respawn is a fresh roll on this spawn point — which is both how
      // a rare turns up and how the camp goes back to normal after one dies.
      // Resolve to the ordinary mob first: the point belongs to the camp, not
      // to whatever named creature last stood on it.
      //
      // A guard post also re-reads who holds the ground, so a front that
      // flipped while you were standing on it visibly changes hands one
      // respawn at a time rather than all at once.
      // Back to the plain creature before re-rolling, through BOTH wrappers.
      // Unwrapping only the rare left a spawn point that had come back as a
      // Snarling Bog Wolf re-rolling from *that*, and the second roll asked for
      // the ★2 rating of a creature that is itself a rating — a variant of a
      // variant, which is not a creature at all.
      const plain = baseMobId(getMob(e.defId!).rareOf ?? e.defId!);
      const base = e.holding ? this.garrisonFor({ mobId: plain, holding: e.holding }) : plain;
      const defId = this.spawnChoice(base, e.plainSpawn === true);
      if (defId !== e.defId) {
        const def = getMob(defId);
        e.defId = defId;
        e.name = def.name;
        e.level = def.level;
      }
      const stats = this.statsOf(e);
      e.dead = false;
      e.aiState = 'idle';
      e.health = stats.maxHealth;
      e.energy = stats.maxEnergy;
      e.pos = { ...e.spawnPos! };
      e.roamGoal = null;
      e.roamWaitMs = 0;
      e.fled = false;
      e.fleeingMs = 0;
      e.roused = false;
      e.rousedMs = 0;
      e.targetId = null;
      e.threat = {};
      e.effects = [];
      e.abilityCooldowns = {};
      e.abilityLockouts = {};
      e.firedAbilities = [];
      e.corpseLoot = [];
      e.corpseGold = 0;
      this.events.push({ t: 'spawn', entityId: e.id });
      const spawnedDef = getMob(e.defId!);
      if (spawnedDef.rareOf) this.announceRare(e, spawnedDef);
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
    // Neither are the other adventurers — to *you*. A population you can kill
    // is a population you will kill, and then the world is empty again and it
    // was your fault. A creature they picked a fight with is a different
    // matter: that is the fight they are there to be seen having.
    if (target.kind === 'npc' && this.entities.get(sourceId)?.kind !== 'mob') return;
    // And nothing can finish one either. The rule is symmetrical on purpose:
    // an adventurer who dies is an adventurer who is *gone*, and a population
    // that quietly empties itself over an evening is worse than one that never
    // fought at all. They are worn down and they walk away — see `GIVE_UP_AT`,
    // which a single heavy hit can otherwise skip straight past.
    if (target.kind === 'npc') amount = Math.max(0, Math.min(amount, target.health - 1));
    // And nothing an adventurer does can finish a creature. Not "they usually
    // don't" — there is no path from their swing to `kill`, so a drop, a quest
    // tick or a scrap of territory can never go to somebody who is not you.
    if (target.kind === 'mob' && this.entities.get(sourceId)?.kind === 'npc') {
      const floor = this.statsOf(target).maxHealth * FIGHT_FLOOR;
      amount = Math.max(0, Math.min(amount, target.health - floor));
    }
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

    // A telegraphed hit throws a rider. Ordinary swings never do.
    if (castBreak === 'always' && target.kind === 'player') this.unseat(target);

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

    // The two numbers a player actually remembers. Kept here rather than
    // derived from the log, which holds nine lines.
    if (target.kind === 'mob' && sourceId === this.playerId) {
      const record = (this.player.record ??= { deaths: 0, biggestHit: 0, worstTaken: 0 });
      record.biggestHit = Math.max(record.biggestHit, Math.round(amount));
    } else if (target.kind === 'player') {
      const record = (target.record ??= { deaths: 0, biggestHit: 0, worstTaken: 0 });
      record.worstTaken = Math.max(record.worstTaken, Math.round(amount));
    }

    if (target.health <= 0) this.kill(target, sourceId);
  }

  /** Which cell a point falls in. Coarse on purpose: a camp is one cell. */
  private cellOf(pos: Vec2): string {
    return `${Math.round(pos.x / MUSTER_CELL)}:${Math.round(pos.z / MUSTER_CELL)}`;
  }

  /**
   * Note that the player has taken something out of this patch of ground, and
   * rouse it if they have taken enough, fast enough.
   *
   * The decay is what makes this a decision rather than a tax: at an ordinary
   * levelling pace the tally never reaches the threshold, so a player who
   * moves between camps is never troubled by it and one who stands in a camp
   * and empties it is.
   */
  private pressCamp(victim: Entity): void {
    if (this.zone.musters === false) return;
    const def = getMob(victim.defId!);
    // A boss's guard, a garrison and a horse belong to something else. So does
    // anything already roused: a muster that musters is a spiral.
    if (def.stars >= BOSS_STARS || def.horse || def.dragon || victim.roused) return;

    const key = this.cellOf(victim.pos);
    const cell = (this.pressure[key] ??= { count: 0, lastTick: this.tickCount, quietUntil: 0 });
    const sinceMs = (this.tickCount - cell.lastTick) * TICK_MS;
    cell.count = Math.max(0, cell.count - sinceMs / MUSTER_DECAY_MS) + 1;
    cell.lastTick = this.tickCount;
    if (cell.count < MUSTER_AT || this.tickCount < cell.quietUntil) return;

    // Only if there is still a camp to do the mustering. An emptied one keeps
    // its temper rather than spending it — the tally is left standing, so the
    // ground stays angry and calls the moment enough of them are back up.
    if (!this.muster(victim.pos)) return;
    cell.count = 0;
    cell.quietUntil = this.tickCount + MUSTER_COOLDOWN_MS / TICK_MS;
  }

  /**
   * The survivors come, and one of them is roused.
   *
   * Nearest first rather than everything in range: a wipe is not an event, it
   * is the end of a session, and the point of this is a fight you can decide
   * to take.
   */
  private muster(at: Vec2): boolean {
    const player = this.player;
    if (player.dead) return false;

    const near = [...this.entities.values()]
      .filter((e) => {
        if (e.kind !== 'mob' || e.dead || e.roused) return false;
        const def = getMob(e.defId!);
        if (def.stars >= BOSS_STARS || def.horse || def.dragon) return false;
        return dist(e.pos.x, e.pos.z, at.x, at.z) <= MUSTER_RANGE;
      })
      .sort(
        (a, b) => dist(a.pos.x, a.pos.z, at.x, at.z) - dist(b.pos.x, b.pos.z, at.x, at.z),
      )
      .slice(0, MUSTER_MAX);
    if (near.length < MUSTER_MIN) return false;

    // The nearest is the one that steps up. Named for it, a rating higher, and
    // carrying what a creature of that rating carries — an event that is only
    // harder is a punishment for playing well.
    const champion = near[0]!;
    const base = baseMobId(getMob(champion.defId!).rareOf ?? champion.defId!);
    const raised = rousedStars(getMob(base).stars);
    const variantId = raised === getMob(base).stars ? base : starVariantId(base, raised);
    if (getMob(variantId)) {
      champion.defId = variantId;
      champion.level = getMob(variantId).level;
    }
    champion.name = rousedName(getMob(base).name);
    champion.roused = true;
    champion.rousedMs = ROUSED_MS;
    champion.health = this.statsOf(champion).maxHealth;

    for (const mob of near) {
      mob.aiState = 'chasing';
      mob.targetId = player.id;
      mob.threat = mob.threat ?? {};
      mob.threat[player.id] = (mob.threat[player.id] ?? 0) + 1;
      mob.roamGoal = null;
      // A skittish creature that bolted is not coming back for this.
      mob.fleeingMs = 0;
    }

    this.events.push({
      t: 'muster',
      name: champion.name,
      count: near.length,
      at: { ...at },
    });
    return true;
  }

  /**
   * Write down what was killed.
   *
   * Through the *base* creature, so a Gaunt Bog Wolf, a Snarling one and
   * `Mirefang the Bog Wolf` all count as Bog Wolves — a player thinks in
   * creatures, not in ratings, and it is the same unwrapping quests use.
   *
   * The named ones are kept separately as well, because a rare is a
   * once-an-hour creature and losing it in a tally of four hundred wolves is
   * losing the only part of the tally anybody would want to look at.
   */
  /**
   * Write down what a boss just did, the first time you are shown it.
   *
   * The same rule the bestiary runs under: what a creature does is learned by
   * playing rather than by reading a tooltip on something already hitting you.
   * A boss kit is four telegraphed abilities and the only way to find out what
   * they were was to die to them, which is a fine way to learn it *once* and a
   * poor way to remember it a fortnight later.
   *
   * Only when it is aimed at the player, and only for what has a name worth
   * knowing — a creature working an adventurer over on the other side of the
   * zone is not teaching anybody anything.
   */
  private noteAbilitySeen(mob: Entity, abilityId: string): void {
    if (mob.targetId !== this.playerId) return;
    const player = this.player;
    player.seenAbilities = player.seenAbilities ?? [];
    if (player.seenAbilities.includes(abilityId)) return;
    player.seenAbilities.push(abilityId);
  }

  private recordKill(player: Entity, def: MobDef): void {
    const base = baseMobId(def.rareOf ?? def.id);
    player.slain = player.slain ?? {};
    player.slain[base] = (player.slain[base] ?? 0) + 1;
    if (def.rareOf && !def.bounty) {
      player.namedSlain = player.namedSlain ?? [];
      if (!player.namedSlain.includes(def.id)) player.namedSlain.push(def.id);
    }
  }

  private kill(victim: Entity, killerId: EntityId): void {
    victim.health = 0;
    victim.dead = true;
    victim.cast = null;
    victim.effects = [];
    victim.targetId = null;
    victim.autoAttack = victim.kind === 'mob';
    this.events.push({ t: 'death', entityId: victim.id, killerId });

    if (victim.kind === 'mob' && victim.dragonId) {
      // A dragon does not leave a corpse on a respawn timer. It is dealt with,
      // the ground it was sitting on goes back to the people fighting over it,
      // and something else wakes up a long while later.
      const dragon = getDragon(victim.dragonId);
      const state = this.dragonState(dragon.id);
      state.phase = 'slain';
      state.holdingId = null;
      state.stop = 0;
      state.remainingMs = minutes(DRAGON_SLAIN_MIN);
      this.dragonEvent(dragon, state, `${dragon.name} is dead. Somebody will write that down.`);
    }

    if (victim.kind === 'player') {
      this.chargeForDeath(victim);
      const record = (victim.record ??= { deaths: 0, biggestHit: 0, worstTaken: 0 });
      record.deaths++;
    }

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
        // Through the rating, not the id: a quest for eight Bog Wolves counts
        // the gaunt one and the alpha alike.
        const killed = baseMobId(def.id);
        this.advanceQuests(killer, (o) => (o.kind === 'kill' && o.mobId === killed ? 1 : 0));
        this.applyKillPolitics(killer, victim);
        this.recordKill(killer, def);
        this.pressCamp(victim);
      }
    } else {
      // Player death: everything currently hunting them goes home.
      for (const e of [...this.entities.values()]) {
        if (e.kind === 'mob' && e.targetId === victim.id) this.leashMob(e);
      }
    }
  }

  /**
   * What finishing a job for someone does to the map.
   *
   * Every trader in the game is a Freeholder, so their work pushes the
   * Freeholder claim on whatever front is contested in the zone you did it
   * in. This is the counterweight to the drift: a zone that is quietly losing
   * ground can be held by a player who actually does the work there.
   */
  private applyQuestPolitics(player: Entity, vendorId: string): void {
    const backer: FactionId = 'freeholders';
    this.addStanding(player, backer, STANDING_PER_QUEST);
    // Whichever front in this zone is furthest from Freeholder hands: a
    // trader spends the goodwill you earned them where they need it most,
    // which is also where the player will notice it.
    const contested = HOLDINGS.filter(
      (h) => h.zoneId === this.zone.id && h.claimants.includes(backer),
    ).sort((a, b) => this.towards(a, backer) - this.towards(b, backer));
    const front = contested[0];
    if (front) this.applyPressure(front.id, backer, PRESSURE_PER_QUEST, true);
    void vendorId;
  }

  /** Signed control in a faction's favour, -CONTROL_LIMIT..+CONTROL_LIMIT. */
  private towards(holding: (typeof HOLDINGS)[number], faction: FactionId): number {
    const sign = holding.claimants[1] === faction ? 1 : -1;
    return (this.control[holding.id] ?? 0) * sign;
  }

  /** Roll a corpse's contents. Exposed for the loot tests, which count drops. */
  rollLootFor(mob: Entity, killer: Entity | undefined): void {
    this.rollLoot(mob, killer);
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

    // The same resolution for a skill tome, minus anything the killer already
    // knows — a boss you farm for its gear should not keep handing you a book
    // you have already read.
    if (table.classTomes && killer?.kind === 'player' && killer.classId) {
      const tomeId = table.classTomes[killer.classId];
      const taught = tomeId ? getItem(tomeId).teaches : undefined;
      const known = taught ? (killer.learnedSkills ?? []).includes(taught) : true;
      if (tomeId && !known && this.rng.chance(table.classTomeChance ?? 1)) {
        loot.push({ itemId: tomeId, qty: 1 });
      }
    }

    // Harder creatures are likelier to be carrying something as well as
    // likelier to be carrying something good — capped, so gear stays rare.
    const gearBoost = STAR_LOOT_MULTIPLIER[def.stars];
    let gearChance = 0;
    for (const entry of table.entries) {
      const item = getItem(entry.itemId);
      const isGear = !!item.slot && item.slot !== 'none' && !item.merchantGood;
      let chance = entry.chance;
      if (isGear && gearBoost > 1) {
        // Scale, then clamp the *total* so the boost can never carry a table
        // past the ceiling the whole loot design rests on.
        const headroom = Math.max(0, MAX_EQUIPMENT_DROP_CHANCE - gearChance);
        chance = Math.min(entry.chance * gearBoost, entry.chance + headroom);
      }
      if (isGear) gearChance += chance;
      if (!this.rng.chance(chance)) continue;
      loot.push({ itemId: entry.itemId, qty: this.rng.int(entry.min, entry.max) });
    }

    // A potion, often. Deliberately outside the loot table and outside the
    // equipment drop cap: gear is meant to be rare and hoped for, and potions
    // are meant to keep you stocked. A player who runs dry mid-zone gets to
    // walk back to a trader, which is a punishment for the crime of fighting.
    if (!def.horse && this.rng.chance(CONSUMABLE_DROP_CHANCE)) {
      loot.push({ itemId: consumableDropFor(def.level), qty: 1 });
    }

    const gold = goldForKill(def.level, def.stars, table.goldMultiplier ?? 1);
    mob.corpseLoot = loot;
    mob.corpseGold = this.rng.int(gold.min, gold.max);
  }

  private awardXp(player: Entity, amount: number): void {
    if (player.level >= MAX_LEVEL) return;

    // The debt is paid out of the same stream that levels you, at a share —
    // never by subtracting from what you already have. Progress slows, and
    // then it stops slowing; it does not reverse. See `deathDebt`.
    const owed = player.xpDebt ?? 0;
    if (owed > 0) {
      const paid = Math.min(owed, Math.round(amount * DEBT_REPAY_SHARE));
      player.xpDebt = owed - paid;
      amount -= paid;
      this.events.push({
        t: 'debt',
        entityId: player.id,
        kind: 'repaid',
        amount: paid,
        remaining: player.xpDebt,
      });
    }

    player.xp = (player.xp ?? 0) + amount;
    this.events.push({ t: 'xpGained', entityId: player.id, amount });

    while (player.level < MAX_LEVEL && (player.xp ?? 0) >= xpToNext(player.level)) {
      player.xp = (player.xp ?? 0) - xpToNext(player.level);
      player.level += 1;
      player.unspentPoints = (player.unspentPoints ?? 0) + POINTS_PER_LEVEL;
      player.skillPoints = (player.skillPoints ?? 0) + SKILL_POINTS_PER_LEVEL;
      const stats = this.statsOf(player);
      player.health = stats.maxHealth;
      player.energy = stats.maxEnergy;
      this.events.push({ t: 'levelUp', entityId: player.id, level: player.level });
      this.gratsFrom(player);
      this.advanceQuests(player, (o) => (o.kind === 'level' && player.level >= o.level ? 1 : 0));

      for (const skill of skillsForClass(player.classId!, player.level, player.learnedSkills ?? [])) {
        if (skill.reqLevel === player.level) {
          this.events.push({ t: 'skillUnlocked', entityId: player.id, skillId: skill.id });
        }
      }
    }
    // At the cap, extra xp is discarded rather than banked.
    if (player.level >= MAX_LEVEL) player.xp = 0;
  }

  /**
   * Open a debt, and leave a body on the map.
   *
   * The body is the interesting half. Without it the walk back is dead time
   * and the debt is a flat tax; with it, the walk is a decision — go back
   * through the thing that killed you and clear the rest, or take the slow
   * road and pay it off in kills somewhere safer.
   */
  private chargeForDeath(player: Entity): void {
    player.deathSpot = { zoneId: this.zone.id, pos: { ...player.pos } };
    const debt = deathDebt(player.level, xpToNext(player.level));
    if (debt <= 0) return;
    const cap = xpToNext(player.level) * DEBT_CAP_LEVELS;
    // Capped, because a losing streak that digs a hole deeper than the level
    // took to earn is "you lost a level" wearing a different name.
    player.xpDebt = Math.min(cap, (player.xpDebt ?? 0) + debt);
    this.events.push({
      t: 'debt',
      entityId: player.id,
      kind: 'incurred',
      amount: debt,
      remaining: player.xpDebt,
    });
  }

  /** Stand where you fell and take the rest of it back. */
  private reclaim(player: Entity): void {
    const spot = player.deathSpot;
    if (!spot || spot.zoneId !== this.zone.id) {
      this.events.push({ t: 'error', entityId: player.id, message: 'Your body is not here.' });
      return;
    }
    if (dist(player.pos.x, player.pos.z, spot.pos.x, spot.pos.z) > RECLAIM_RANGE) {
      this.events.push({ t: 'error', entityId: player.id, message: 'Too far from where you fell.' });
      return;
    }
    const cleared = player.xpDebt ?? 0;
    player.xpDebt = 0;
    player.deathSpot = null;
    this.events.push({
      t: 'debt',
      entityId: player.id,
      kind: 'reclaimed',
      amount: cleared,
      remaining: 0,
    });
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
    // A taught skill needs its tome as well as the level. This is the whole
    // point of zone-taught skills: reaching 44 does not hand you the Sunken
    // Wood's kit, going there and finding it does.
    if (skill.taughtBy && !(e.learnedSkills ?? []).includes(skill.id)) {
      this.events.push({
        t: 'error',
        entityId: e.id,
        message: `You have not learned ${skill.name}.`,
      });
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

  /**
   * Is this skill's condition live right now?
   *
   * All five read state that is *already* on the table — a health share, a
   * distance, whether anything is fighting you, whether your own burn is on
   * it — so nothing new is tracked and nothing can drift out of step with
   * what the HUD is showing.
   */
  conditionMet(source: Entity, skill: SkillDef, targetId: EntityId | null): boolean {
    const when = skill.when;
    if (!when) return false;
    const target = this.entities.get(targetId ?? -1);

    switch (when.kind) {
      case 'finisher': {
        if (!target || target.dead) return false;
        return target.health / this.statsOf(target).maxHealth <= when.below;
      }
      case 'opener': {
        // Not fighting you *yet*. Threat rather than aiState, because a
        // creature already chasing somebody else is still unaware of you — and
        // because threat is what actually decides who it swings at.
        if (!target || target.dead || target.kind !== 'mob') return false;
        return (target.threat?.[source.id] ?? 0) <= 0;
      }
      case 'steady': {
        // The mirror of `desperate`, and the Ranger's whole fantasy: a class
        // that does not have to close is a class that should be rewarded for
        // not being hit. The first attempt keyed on *distance*, which for a
        // Ranger sitting at their own weapon range is true every second of
        // every fight — a passive wearing a decision's clothes.
        return source.health / this.statsOf(source).maxHealth >= when.above;
      }
      case 'onDot': {
        if (!target || target.dead) return false;
        return (target.effects ?? []).some(
          (e) => e.kind === 'dot' && e.sourceAbilityId === when.dotId && e.sourceId === source.id,
        );
      }
      case 'desperate': {
        // Yours, not theirs. A heal is timed against how much trouble you are
        // in, and topping yourself off at 90% should always be the wrong call.
        return source.health / this.statsOf(source).maxHealth <= when.below;
      }
    }
  }

  private applySkillEffect(source: Entity, skill: SkillDef, targetId: EntityId | null): void {
    const stats = this.statsOf(source);
    // What this character has invested in this particular skill. Rank 0 is the
    // skill exactly as it was taught; every point above that is a level the
    // player spent here instead of somewhere else.
    const rank = source.skillRanks?.[skill.id] ?? 0;
    // The condition is read once, here, at the moment of the cast — not while
    // the skill is winding up and not when it lands. A `finisher` that checked
    // on resolution would reward pressing it early and hoping, which is the
    // opposite of the decision it exists to create.
    const timed = this.conditionMet(source, skill, targetId) ? conditionPower(skill) : 1;
    const power = stats.skillPower * skillRankPower(rank) * timed;
    if (timed !== 1) {
      this.events.push({ t: 'wellTimed', sourceId: source.id, skillId: skill.id });
    }
    /** Did this cast land double? Skills crit the same way swings do. */
    const rolls = (): boolean => this.rng.chance(skillCritChance(stats.critChance, rank));

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
          // A grimoire makes what you CAST hit harder, and nothing else. It is
          // deliberately not a damage buff: it is worth most to the classes
          // whose damage is mostly skills, which is the point of the slot.
          weaponMultiplier: (skill.weaponMultiplier ?? 1) * power,
          flatPower: (skill.flatPower ?? 0) * power,
          critChance: skillCritChance(stats.critChance, rank),
          critMultiplier: SKILL_CRIT_MULTIPLIER,
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
          dotPower: ((skill.flatPower ?? 0) + stats.attack * 0.15) * power,
        });
        this.markCombat(source.id);
        this.markCombat(target.id);
        break;
      }
      case 'heal': {
        const target = this.entities.get(targetId ?? source.id) ?? source;
        // A heal can crit too, and it is the best moment in the game when it
        // does: the one that lands double is the one that saves the fight.
        const crit = rolls();
        const amount = Math.round(
          ((skill.flatPower ?? 0) + stats.attack * 0.5) * power * (crit ? SKILL_CRIT_MULTIPLIER : 1),
        );
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

  /**
   * The nearest unopened landmark you are standing at.
   *
   * Nothing here is rolled. What a site holds was decided by where it stands
   * (`discoveriesFor` hashes the position), which keeps the whole feature off
   * `this.rng` — the lesson roaming and the weather both had to learn, because
   * anything ambient that touches the combat stream turns every balance figure
   * in the suite into a measurement of the scenery.
   */
  siteAt(pos: Vec2): DiscoverySite | null {
    let best: DiscoverySite | null = null;
    let bestGap = DISCOVERY_RANGE;
    for (const site of this.sites) {
      if (this.found[site.id]) continue;
      const gap = dist(pos.x, pos.z, site.pos.x, site.pos.z);
      if (gap <= bestGap) {
        bestGap = gap;
        best = site;
      }
    }
    return best;
  }

  /** Every site in this zone you have not opened yet, for the marks on screen. */
  openSites(): DiscoverySite[] {
    return this.sites.filter((s) => !this.found[s.id]);
  }

  /**
   * Open one. Once, ever.
   *
   * A discovery you can come back to is a grinding spot with extra steps, and
   * the feeling being bought here is "nobody else is getting this one". The
   * refusal names the reason, the same way every mount failure does:
   * "nothing happened" reads as a broken key.
   */
  private trySearch(player: Entity): void {
    const site = this.siteAt(player.pos);
    if (!site) {
      this.events.push({
        t: 'error',
        entityId: player.id,
        // Covers both halves of the key: the player may have been reaching
        // for a corpse rather than for a landmark, and "worth searching" reads
        // as a refusal about the landmark they were not looking at.
        message: 'Nothing here to take.',
      });
      return;
    }
    this.found[site.id] = true;

    if (site.kind === 'boon' && site.boon) {
      const boon = site.boon;
      // Replaces rather than stacks: two of the same blessing is a number
      // going up, and a blessing is meant to be a thing you go and get.
      player.effects = (player.effects ?? []).filter((e) => e.sourceAbilityId !== boon.id);
      player.effects.push({
        id: `${boon.id}:${this.nextId++}`,
        kind: 'buff',
        sourceId: player.id,
        sourceAbilityId: boon.id,
        remainingMs: boon.minutes * 60_000,
        // A blessing that regenerates ticks on the same clock a salve does.
        tickMs: 1000,
        sinceTickMs: 0,
        damageType: 'physical',
        ...(boon.damageMultiplier ? { damageMultiplier: boon.damageMultiplier } : {}),
        ...(boon.defenseBonus ? { defenseBonus: boon.defenseBonus } : {}),
        ...(boon.regenPerSec ? { regenPerTick: boon.regenPerSec } : {}),
        ...(boon.moveSpeedBonus ? { moveSpeedBonus: boon.moveSpeedBonus } : {}),
      });
      this.events.push({
        t: 'discovered',
        entityId: player.id,
        siteId: site.id,
        name: boon.name,
        kind: 'boon',
        line: boon.line,
        gold: 0,
      });
      return;
    }

    // A cache pays in the currency the economy already runs on, scaled to what
    // an ordinary kill is worth *here*. Anywhere else and a level-3 farmstead
    // would be worth robbing at level 90.
    const band = this.zone.levelRange;
    const level = Math.round((band[0] + band[1]) / 2);
    const purse = goldForKill(level, 1);
    const gold = Math.round(((purse.min + purse.max) / 2) * site.worth);
    player.gold = (player.gold ?? 0) + gold;
    this.events.push({
      t: 'discovered',
      entityId: player.id,
      siteId: site.id,
      name: discoveryName(site),
      kind: 'cache',
      line: 'Somebody left in a hurry.',
      gold,
    });
  }

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

    // Hand the goods over. Collection objectives read the bags rather than
    // counting pickups, so without this a single stack could satisfy the same
    // requirement twice — and the armour lines ask for the same trophies again
    // at their capstone, which would then cost nothing.
    for (const objective of quest.objectives) {
      if (objective.kind === 'collect') this.removeItem(player, objective.itemId, objective.count);
    }

    player.quests = (player.quests ?? []).filter((q) => q.questId !== questId);
    player.questsDone = [...(player.questsDone ?? []), questId];

    const items = [...(quest.rewards.items ?? [])];
    const classItem = player.classId ? quest.rewards.classItems?.[player.classId] : undefined;
    if (classItem) items.push(classItem);
    for (const itemId of items) this.addItem(player, { itemId, qty: 1 });
    player.gold = (player.gold ?? 0) + quest.rewards.gold;

    this.applyQuestPolitics(player, quest.giverVendorId);

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
    // Ground the player is no longer standing on cannot still be burning them.
    for (const hazard of this.hazards) this.events.push({ t: 'hazardGone', id: hazard.id });
    this.hazards = [];

    player.pos = { ...zone.playerStart };
    player.targetId = null;
    player.autoAttack = false;
    player.moveDir = { x: 0, z: 0 };
    player.cast = null;
    player.effects = [];

    for (const sp of zone.spawns) {
      // Nothing garrisons a holding a dragon is sitting on, so arriving in a
      // zone mid-visit shows you the empty ground rather than a full camp.
      if (sp.holding && this.isSuppressed(sp.holding)) continue;
      this.spawnMob(this.garrisonFor(sp), sp.pos, undefined, sp.holding, sp.plain);
    }
    for (const v of zone.vendors) this.spawnVendor(v.vendorId, v.pos);
    for (const dragon of DRAGONS) this.syncDragonEntity(dragon);
    this.spawnAdventurers();
    // `found` is deliberately NOT cleared: a site's id carries its zone, so
    // what you opened in the Fenmarch is still opened when you come back.
    this.sites = discoveriesFor(zone.id, structuresOf(zone));

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

  /**
   * What this player pays, after the trader's opinion of them.
   *
   * Every trader is a Freeholder, so helping them is a discount and hunting
   * them is a markup. It is a small number by design — a shop that refuses a
   * hated player entirely would strand someone who wandered into the wrong
   * fight at level 6 with nowhere to repair.
   */
  priceFor(player: Entity, itemId: string): number {
    const base = buyPrice(getItem(itemId));
    const standing = this.standingWith(player, 'freeholders') / STANDING_LIMIT;
    return Math.max(1, Math.round(base * (1 - standing * STANDING_PRICE_SWING)));
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
    const price = this.priceFor(player, itemId);
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

  /**
   * Read a tome and learn the skill it teaches.
   *
   * Every failure path reports why. A tome is a rare, expensive thing — one
   * that silently does nothing when clicked reads as the game being broken.
   */
  private tryLearnSkill(player: Entity, itemId: string): void {
    const def = getItem(itemId);
    if (!def.teaches) {
      this.events.push({ t: 'error', entityId: player.id, message: `${def.name} teaches nothing.` });
      return;
    }
    const skill = getSkill(def.teaches);
    if (!canEquip(def, player.classId)) {
      this.events.push({
        t: 'error',
        entityId: player.id,
        message: `${def.name} means nothing to a ${player.classId ?? 'character'}.`,
      });
      return;
    }
    if (player.level < skill.reqLevel) {
      this.events.push({
        t: 'error',
        entityId: player.id,
        message: `${skill.name} needs level ${skill.reqLevel}.`,
      });
      return;
    }
    player.learnedSkills = player.learnedSkills ?? [];
    if (player.learnedSkills.includes(skill.id)) {
      this.events.push({
        t: 'error',
        entityId: player.id,
        message: `You already know ${skill.name}.`,
      });
      return;
    }
    if (!this.removeItem(player, itemId, 1)) return;
    player.learnedSkills.push(skill.id);
    this.events.push({ t: 'skillUnlocked', entityId: player.id, skillId: skill.id });
  }

  /**
   * Drink a potion or an elixir.
   *
   * The cooldown is per *family*, not per item, and it is the whole reason
   * consumables are a decision rather than a second health bar: a bag of forty
   * draughts still only answers one crisis every eighteen seconds, so the
   * question is always "now, or in ten seconds when it is worse".
   */
  private tryUse(player: Entity, itemId: string): void {
    if (player.kind !== 'player') return;
    const def = getItem(itemId);
    const spec = def.consumable;
    if (!spec) {
      this.events.push({ t: 'error', entityId: player.id, message: `${def.name} is not for drinking.` });
      return;
    }
    if (player.level < (def.reqLevel ?? 1)) {
      this.events.push({
        t: 'error',
        entityId: player.id,
        message: `${def.name} needs level ${def.reqLevel}.`,
      });
      return;
    }
    const cooldowns = (player.consumableCooldowns ??= {});
    const left = cooldowns[spec.family] ?? 0;
    if (left > 0) {
      this.events.push({
        t: 'error',
        entityId: player.id,
        message: `No more ${spec.family}s for ${Math.ceil(left / 1000)}s.`,
      });
      return;
    }
    if (!this.removeItem(player, itemId, 1)) {
      this.events.push({ t: 'error', entityId: player.id, message: `No ${def.name} left.` });
      return;
    }

    cooldowns[spec.family] =
      spec.family === 'potion' ? POTION_COOLDOWN_MS : ELIXIR_COOLDOWN_MS;

    const stats = this.statsOf(player);
    let healed = 0;
    if (spec.healPercent) {
      const before = player.health;
      player.health = Math.min(stats.maxHealth, player.health + stats.maxHealth * spec.healPercent);
      healed = Math.round(player.health - before);
      if (healed > 0) {
        this.events.push({
          t: 'heal',
          sourceId: player.id,
          targetId: player.id,
          amount: healed,
        });
      }
    }

    // Anything that lasts goes through the same effect list skills use, so a
    // buff from a bottle and a buff from a spell cannot drift apart.
    if (spec.regen) {
      player.effects.push({
        id: `${itemId}:regen`,
        kind: 'buff',
        sourceId: player.id,
        sourceAbilityId: itemId,
        remainingMs: spec.regen.seconds * 1000,
        tickMs: 1000,
        sinceTickMs: 0,
        damageType: 'nature',
        regenPerTick: spec.regen.perSec,
      });
    }
    if (spec.damageMultiplier || spec.defenseBonus) {
      player.effects.push({
        id: `${itemId}:buff`,
        kind: 'buff',
        sourceId: player.id,
        sourceAbilityId: itemId,
        remainingMs: ELIXIR_DURATION_MS,
        tickMs: ELIXIR_DURATION_MS,
        sinceTickMs: 0,
        damageType: 'physical',
        ...(spec.damageMultiplier ? { damageMultiplier: spec.damageMultiplier } : {}),
        ...(spec.defenseBonus ? { defenseBonus: spec.defenseBonus } : {}),
      });
    }

    this.events.push({ t: 'consumed', entityId: player.id, itemId, healed });
  }

  /**
   * Spend a skill point to rank a skill up.
   *
   * One point per level for a hundred levels, and ten ranks per skill, so the
   * whole game buys ten maxed skills out of sixteen — the character you end up
   * with is the one you chose to spend them on. Every refusal says which of the
   * three reasons it was; "nothing happened" is the worst answer a spend button
   * can give.
   */
  private tryRankSkill(player: Entity, skillId: string): void {
    if (player.kind !== 'player') return;
    const skill = getSkill(skillId);
    const known = skillsForClass(player.classId!, player.level, player.learnedSkills ?? []);
    if (!known.some((s) => s.id === skillId)) {
      this.events.push({
        t: 'error',
        entityId: player.id,
        message: `You have not learned ${skill.name}.`,
      });
      return;
    }
    const rank = player.skillRanks?.[skillId] ?? 0;
    if (rank >= MAX_SKILL_RANK) {
      this.events.push({
        t: 'error',
        entityId: player.id,
        message: `${skill.name} is already mastered.`,
      });
      return;
    }
    if ((player.skillPoints ?? 0) <= 0) {
      this.events.push({ t: 'error', entityId: player.id, message: 'No skill points to spend.' });
      return;
    }
    player.skillPoints = (player.skillPoints ?? 0) - 1;
    player.skillRanks = player.skillRanks ?? {};
    player.skillRanks[skillId] = rank + 1;
    this.events.push({ t: 'skillRanked', entityId: player.id, skillId, rank: rank + 1 });
  }

  private tryEquip(player: Entity, itemId: string): void {
    const def = getItem(itemId);
    // A potion has a slot of 'none' rather than null, so the inventory can tell
    // "you drink this" apart from "you sell this".
    if (!def.slot || def.slot === 'none') {
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
    if (def.reqLevel && player.level < def.reqLevel) {
      this.events.push({
        t: 'error',
        entityId: player.id,
        message: `${def.name} needs level ${def.reqLevel}.`,
      });
      return;
    }
    if (!this.removeItem(player, itemId, 1)) return;

    const slot = def.slot as EquipSlot;
    player.equipment = player.equipment ?? {};
    const previous = player.equipment[slot];
    player.equipment[slot] = itemId;
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
      worldTimeMs: this.worldTimeMs,
      nextId: this.nextId,
      playerId: this.playerId,
      zoneId: this.zone.id,
      // The war is world state, not player state: it has to survive a save or
      // the map resets to "the outlaws own everything" every time you load.
      control: this.control,
      controller: this.controller,
      dragons: this.dragons,
      hazards: this.hazards,
      nextHazardId: this.nextHazardId,
      // Which landmarks you have opened. The sites themselves are derived, so
      // only the "once, ever" half is state.
      found: this.found,
      entities: [...this.entities.values()],
    });
  }

  static deserialize(json: string, zone: ZoneDef): World {
    const data = JSON.parse(json) as {
      version: number;
      seed: number;
      tickCount: number;
      worldTimeMs?: number;
      nextId: number;
      playerId: EntityId;
      zoneId?: string;
      control?: Record<string, number>;
      hazards?: World['hazards'];
      nextHazardId?: number;
      found?: Record<string, true>;
      controller?: Record<string, FactionId>;
      dragons?: Record<string, DragonState>;
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
    // An unstamped save is one written before the sun moved. Leave it at the
    // fresh-world morning rather than dropping the player into midnight.
    if (typeof data.worldTimeMs === 'number') world.worldTimeMs = data.worldTimeMs;
    if (Array.isArray(data.hazards)) world.hazards = data.hazards;
    if (typeof data.nextHazardId === 'number') world.nextHazardId = data.nextHazardId;
    if (data.found) world.found = { ...data.found };
    world.nextId = data.nextId;
    world.playerId = data.playerId;
    if (data.control) world.control = { ...world.control, ...data.control };
    if (data.controller) world.controller = { ...world.controller, ...data.controller };
    if (data.dragons) world.dragons = { ...world.dragons, ...data.dragons };
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
