/**
 * Core sim types. This file must never import anything from `render/`.
 *
 * The renderer is a *subscriber*: it reads state snapshots and reacts to the
 * SimEvent stream. Animation, VFX, sound and floating combat text all hang off
 * these events, which is why the event list is deliberately richer than what
 * the current placeholder renderer consumes.
 */

export type EntityId = number;

/** Ground-plane position. Y is derived from terrain, so the sim stays 2D. */
export interface Vec2 {
  x: number;
  z: number;
}

export type ClassId = 'warrior' | 'ranger' | 'rogue' | 'mage' | 'druid';

export type DamageType = 'physical' | 'fire' | 'frost' | 'nature';

/** The four primary attributes players spend points into on level up. */
export interface Attributes {
  strength: number;
  dexterity: number;
  focus: number;
  vitality: number;
}

/** Everything combat math actually reads, after gear and buffs are folded in. */
export interface DerivedStats {
  maxHealth: number;
  maxEnergy: number;
  attack: number;
  defense: number;
  critChance: number;
  /** Milliseconds between auto-attack swings. */
  swingMs: number;
  damageMin: number;
  damageMax: number;
  damageType: DamageType;
  /** Melee reach / weapon range, in world units. */
  attackRange: number;
  moveSpeed: number;
}

export type EquipSlot = 'weapon' | 'head' | 'chest' | 'legs' | 'ring';

export interface ItemDef {
  id: string;
  name: string;
  slot: EquipSlot | null;
  /** Rough tier for colouring and vendor value. */
  quality: 'common' | 'uncommon' | 'rare' | 'epic';
  value: number;
  stackable?: boolean;
  attributes?: Partial<Attributes>;
  damageMin?: number;
  damageMax?: number;
  damageType?: DamageType;
  swingMs?: number;
  attackRange?: number;
  armor?: number;
}

export interface ItemStack {
  itemId: string;
  qty: number;
}

export type SkillEffectKind = 'damage' | 'heal' | 'dot' | 'buff';

export interface SkillDef {
  id: string;
  name: string;
  classId: ClassId;
  /** Level at which the skill unlocks. */
  reqLevel: number;
  energyCost: number;
  cooldownMs: number;
  /** 0 for instant. Casting is interrupted by taking damage when true. */
  castMs: number;
  interruptible: boolean;
  range: number;
  kind: SkillEffectKind;
  /** Multiplier applied to rolled weapon damage, for `damage` skills. */
  weaponMultiplier?: number;
  /** Flat addition before mitigation. */
  flatPower?: number;
  damageType?: DamageType;
  /** Extra threat added on top of damage-derived threat. */
  threatBonus?: number;
  /** For dot/buff: total duration and tick spacing. */
  durationMs?: number;
  tickMs?: number;
  description: string;
}

export interface LootEntry {
  itemId: string;
  chance: number;
  min: number;
  max: number;
}

export interface LootTable {
  id: string;
  /** Rolled independently — every entry gets its own chance check. */
  entries: LootEntry[];
  goldMin: number;
  goldMax: number;
}

export interface MobDef {
  id: string;
  name: string;
  level: number;
  /** Bosses get a wider leash, more health and are worth calling out in the UI. */
  rank: 'normal' | 'elite' | 'boss';
  attributes: Attributes;
  baseHealth: number;
  damageMin: number;
  damageMax: number;
  damageType: DamageType;
  swingMs: number;
  attackRange: number;
  moveSpeed: number;
  aggroRadius: number;
  leashRadius: number;
  xp: number;
  lootTableId: string;
  respawnMs: number;
  /** Renderer hints only — the sim never reads these. */
  view: { color: number; height: number; radius: number };
}

export type ActiveEffectKind = 'dot' | 'buff';

export interface ActiveEffect {
  id: string;
  kind: ActiveEffectKind;
  sourceId: EntityId;
  skillId: string;
  remainingMs: number;
  tickMs: number;
  sinceTickMs: number;
  power: number;
  damageType: DamageType;
}

export interface Entity {
  id: EntityId;
  kind: 'player' | 'mob';
  name: string;
  level: number;
  pos: Vec2;
  /** Facing in radians; presentation reads it, AI writes it. */
  facing: number;
  health: number;
  energy: number;
  dead: boolean;
  /** Set on death; counts down to respawn for mobs. */
  respawnInMs: number;
  targetId: EntityId | null;
  autoAttack: boolean;
  swingCooldownMs: number;
  effects: ActiveEffect[];

  // --- player-only ---
  classId?: ClassId;
  xp?: number;
  gold?: number;
  attributes?: Attributes;
  unspentPoints?: number;
  inventory?: ItemStack[];
  equipment?: Partial<Record<EquipSlot, string>>;
  skillCooldowns?: Record<string, number>;
  /** Global cooldown remaining; blocks every skill while > 0. */
  gcdMs?: number;
  cast?: { skillId: string; remainingMs: number; targetId: EntityId | null } | null;
  /** Normalized movement intent, held until the client changes it. */
  moveDir?: Vec2;

  // --- mob-only ---
  defId?: string;
  spawnPos?: Vec2;
  aiState?: 'idle' | 'chasing' | 'attacking' | 'returning' | 'dead';
  threat?: Record<EntityId, number>;
  /** Corpse loot, generated at death, claimed by `loot` command. */
  corpseLoot?: ItemStack[];
  corpseGold?: number;
}

// --------------------------------------------------------------------------
// Commands: the ONLY way the outside world mutates the sim.
//
// Single-player runs these in-process. A future server would receive the exact
// same objects over the wire and validate them the exact same way. Do not add
// a code path that mutates entities directly from the renderer.
// --------------------------------------------------------------------------

export type Command =
  | { t: 'move'; dir: Vec2 }
  | { t: 'face'; facing: number }
  | { t: 'target'; id: EntityId | null }
  | { t: 'autoAttack'; on: boolean }
  | { t: 'useSkill'; skillId: string }
  | { t: 'loot'; id: EntityId }
  | { t: 'equip'; itemId: string }
  | { t: 'unequip'; slot: EquipSlot }
  | { t: 'spendPoint'; attr: keyof Attributes }
  | { t: 'respawn' };

/** A command paired with the actor issuing it. Server-side, actorId is trusted. */
export interface ActorCommand {
  actorId: EntityId;
  cmd: Command;
}

// --------------------------------------------------------------------------
// Events: the sim's outbound stream. Presentation subscribes; sim never reads.
// --------------------------------------------------------------------------

export type SimEvent =
  | { t: 'swing'; sourceId: EntityId; targetId: EntityId }
  | { t: 'castBegin'; sourceId: EntityId; skillId: string; durationMs: number }
  | { t: 'castInterrupted'; sourceId: EntityId; skillId: string }
  | { t: 'castComplete'; sourceId: EntityId; skillId: string }
  | {
      t: 'damage';
      sourceId: EntityId;
      targetId: EntityId;
      amount: number;
      crit: boolean;
      damageType: DamageType;
      skillId: string | null;
    }
  | { t: 'miss'; sourceId: EntityId; targetId: EntityId }
  | { t: 'heal'; sourceId: EntityId; targetId: EntityId; amount: number }
  | { t: 'death'; entityId: EntityId; killerId: EntityId | null }
  | { t: 'spawn'; entityId: EntityId }
  | { t: 'despawn'; entityId: EntityId }
  | { t: 'aggro'; mobId: EntityId; targetId: EntityId }
  | { t: 'leash'; mobId: EntityId }
  | { t: 'xpGained'; entityId: EntityId; amount: number }
  | { t: 'levelUp'; entityId: EntityId; level: number }
  | { t: 'lootGained'; entityId: EntityId; items: ItemStack[]; gold: number }
  | { t: 'skillUnlocked'; entityId: EntityId; skillId: string }
  | { t: 'error'; entityId: EntityId; message: string };
