import * as THREE from 'three';
import { getSkill, skillBarFor } from '../content/skills.js';
import { QUALITY_COLORS, canEquip, getItem } from '../content/items.js';
import { getMob, mobDropping } from '../content/mobs.js';
import { buyPrice, getVendor, sellPrice } from '../content/vendors.js';
import { getQuest } from '../content/quests.js';
import {
  MAX_LEVEL,
  MAX_SKILL_RANK,
  SKILL_RANK_CRIT,
  SKILL_RANK_POWER,
  xpToNext,
} from '../sim/formulas.js';
import { BOSS_STARS, ELITE_BOSS_STARS } from '../sim/types.js';
import { ZONES } from '../content/zone.js';
import { DRAGONS } from '../content/dragons.js';
import { getMount } from '../content/mounts.js';
import {
  FACTIONS,
  HOLDINGS,
  getFaction,
  getHolding,
  standingBand,
  type StandingBand,
} from '../content/factions.js';
import type {
  Attributes,
  AwayReport,
  Command,
  Entity,
  EntityId,
  EquipSlot,
  ItemStack,
  QuestObjective,
  SimEvent,
} from '../sim/types.js';
import type { World } from '../sim/world.js';

const MAX_LOG_LINES = 9;
/** Slots on the first hotkey row, bound to 1-9 then 0. */
const PRIMARY_ROW_SLOTS = 10;

/** The key that fires slot `index`: 1-9, 0, then Shift+1 onwards. */
function hotkeyLabel(index: number): string {
  if (index < 9) return String(index + 1);
  if (index === 9) return '0';
  return `⇧${index - 9}`;
}
/**
 * How far away a mob can be and still show a nameplate, in world units.
 *
 * Kept tight on purpose. Camps are dense so the grind has throughput, which
 * means a generous plate range buries the screen in labels — the plates you
 * actually need are your target, whatever is hitting you, and what is close
 * enough to pull next.
 */
const NAMEPLATE_RANGE = 13;

/**
 * How close a rare spawn has to be before the log mentions it.
 *
 * Deliberately about as far as you can see one. Announcing it zone-wide would
 * turn the thing you are hunting into a notification you follow.
 */
const RARE_SIGHTING_RANGE = 45;

/** How long another adventurer's line stays over their head. */
const CHAT_BUBBLE_MS = 5200;

/** ★ string for a mob's difficulty rating. ★5 is a boss, ★6 an elite boss. */
function starText(stars: number): string {
  return '★'.repeat(stars);
}

/** CSS class controlling star colour: ordinary, boss, elite boss. */
function starClass(stars: number): string {
  if (stars >= ELITE_BOSS_STARS) return 'stars-elite-boss';
  if (stars >= BOSS_STARS) return 'stars-boss';
  return `stars-${stars}`;
}

type Emit = (cmd: Command) => void;

/**
 * All DOM UI. Reads world state each frame and reacts to the sim event stream.
 *
 * The HUD never mutates the world directly — every interaction goes out through
 * `emit`, which pushes a Command into the sim queue. Same path the keyboard
 * uses, and the same path a network client would use.
 */
export class Hud {
  private root: HTMLDivElement;
  private els!: {
    playerName: HTMLElement;
    playerLevel: HTMLElement;
    playerHp: HTMLElement;
    playerHpLabel: HTMLElement;
    playerEnergy: HTMLElement;
    playerEnergyLabel: HTMLElement;
    targetFrame: HTMLElement;
    targetName: HTMLElement;
    targetLevel: HTMLElement;
    targetHp: HTMLElement;
    targetHpLabel: HTMLElement;
    castBar: HTMLElement;
    castFill: HTMLElement;
    castLabel: HTMLElement;
    xpFill: HTMLElement;
    xpLabel: HTMLElement;
    xpDebt: HTMLElement;
    deathCost: HTMLElement;
    xpLevel: HTMLElement;
    tracker: HTMLElement;
    trackerHead: HTMLElement;
    trackerBody: HTMLElement;
    trackerWhere: HTMLElement;
    trackerArrow: HTMLElement;
    trackerDist: HTMLElement;
    log: HTMLElement;
    skillBar: HTMLElement;
    characterWindow: HTMLElement;
    characterBody: HTMLElement;
    inventoryWindow: HTMLElement;
    inventoryBody: HTMLElement;
    volumeToast: HTMLElement;
    volumeIcon: HTMLElement;
    volumeBar: HTMLElement;
    deathOverlay: HTMLElement;
    overlays: HTMLElement;
    telegraph: HTMLElement;
    zoneBanner: HTMLElement;
    travelPrompt: HTMLElement;
    questLog: HTMLElement;
    questLogBody: HTMLElement;
    realmWindow: HTMLElement;
    realmBody: HTMLElement;
    awayReport: HTMLElement;
    awayTitle: HTMLElement;
    awayBody: HTMLElement;
    vendorQuests: HTMLElement;
    vendorWindow: HTMLElement;
    vendorName: HTMLElement;
    vendorGreeting: HTMLElement;
    vendorStock: HTMLElement;
    vendorBags: HTMLElement;
    vendorGold: HTMLElement;
  };

  /** Entity id of the trader whose shop is open, or null. */
  private openVendorId: EntityId | null = null;

  private telegraphTimer: number | null = null;
  private volumeTimer: number | null = null;

  private slots = new Map<string, { el: HTMLElement; cd: HTMLElement; name: HTMLElement }>();
  /** Hotkey order for this character's class, filled in at construction. */
  private skillOrder: string[] = [];
  private nameplates = new Map<EntityId, HTMLElement>();
  /** The bag item currently being dragged, so a slot can say whether it fits. */
  private dragItemId: string | null = null;
  /** The last thing each adventurer said, for the bubble over their head. */
  private chatter = new Map<EntityId, { text: string; at: number }>();
  private projected = new THREE.Vector3();

  constructor(
    container: HTMLElement,
    private readonly world: World,
    private readonly emit: Emit,
    /**
     * Ground height under a world position. Plates and floating text are
     * projected from a world point, so on sloped terrain they detach from the
     * entity entirely unless they start from the ground it is standing on.
     */
    private readonly groundAt: (x: number, z: number) => number = () => 0,
    /**
     * Which way the camera is looking. The quest arrow is drawn on the screen,
     * so it has to point in screen space — an arrow that points north is a
     * compass, and a compass is a second thing to learn.
     */
    private readonly yawOf: () => number = () => 0,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = TEMPLATE;
    container.appendChild(this.root);
    this.cacheElements();
    this.buildSkillBar();

    this.root.querySelector('#respawn-btn')!.addEventListener('click', () => {
      this.emit({ t: 'respawn' });
    });
    this.root.querySelector('#vendor-close')!.addEventListener('click', () => this.closeVendor());
    this.root
      .querySelector('#away-close')!
      .addEventListener('click', () => this.hideAwayReport());
  }

  private q<T extends HTMLElement>(sel: string): T {
    const el = this.root.querySelector<T>(sel);
    if (!el) throw new Error(`HUD element missing: ${sel}`);
    return el;
  }

  private cacheElements(): void {
    this.els = {
      playerName: this.q('#player-name'),
      playerLevel: this.q('#player-level'),
      playerHp: this.q('#player-hp .bar-fill'),
      playerHpLabel: this.q('#player-hp .bar-label'),
      playerEnergy: this.q('#player-energy .bar-fill'),
      playerEnergyLabel: this.q('#player-energy .bar-label'),
      targetFrame: this.q('#target-frame'),
      targetName: this.q('#target-name'),
      targetLevel: this.q('#target-level'),
      targetHp: this.q('#target-hp .bar-fill'),
      targetHpLabel: this.q('#target-hp .bar-label'),
      castBar: this.q('#cast-bar'),
      castFill: this.q('#cast-bar .bar-fill'),
      castLabel: this.q('#cast-bar .bar-label'),
      xpFill: this.q('#xp-bar .bar-fill'),
      xpLabel: this.q('#xp-bar .bar-label'),
      xpLevel: this.q('#xp-level'),
      tracker: this.q('#tracker'),
      trackerHead: this.q('#tracker-head'),
      trackerBody: this.q('#tracker-body'),
      trackerWhere: this.q('#tracker-where'),
      trackerArrow: this.q('#tracker-arrow'),
      trackerDist: this.q('#tracker-dist'),
      log: this.q('#log'),
      skillBar: this.q('#skill-bar'),
      characterWindow: this.q('#character-window'),
      characterBody: this.q('#character-body'),
      inventoryWindow: this.q('#inventory-window'),
      inventoryBody: this.q('#inventory-body'),
      xpDebt: this.q('#xp-debt'),
      deathCost: this.q('#death-cost'),
      volumeToast: this.q('#volume-toast'),
      volumeIcon: this.q('#volume-icon'),
      volumeBar: this.q('#volume-bar'),
      deathOverlay: this.q('#death-overlay'),
      overlays: this.q('#overlays'),
      telegraph: this.q('#telegraph-banner'),
      zoneBanner: this.q('#zone-banner'),
      travelPrompt: this.q('#travel-prompt'),
      questLog: this.q('#quest-log'),
      questLogBody: this.q('#quest-log-body'),
      realmWindow: this.q('#realm-window'),
      realmBody: this.q('#realm-body'),
      awayReport: this.q('#away-report'),
      awayTitle: this.q('#away-title'),
      awayBody: this.q('#away-body'),
      vendorQuests: this.q('#vendor-quests'),
      vendorWindow: this.q('#vendor-window'),
      vendorName: this.q('#vendor-name'),
      vendorGreeting: this.q('#vendor-greeting'),
      vendorStock: this.q('#vendor-stock'),
      vendorBags: this.q('#vendor-bags'),
      vendorGold: this.q('#vendor-gold'),
    };
  }

  /**
   * Two rows: the level-granted kit on 1-0, everything a zone taught you on
   * Shift+1-6. A class ends the game with up to sixteen skills, which does not
   * fit on one row of hotkeys at any readable size.
   */
  private buildSkillBar(): void {
    const bar = skillBarFor(this.world.player.classId ?? 'warrior');
    this.skillOrder = bar.map((s) => s.id);
    this.els.skillBar.innerHTML = '';

    const primary = document.createElement('div');
    primary.className = 'skill-row';
    const secondary = document.createElement('div');
    secondary.className = 'skill-row secondary';
    this.els.skillBar.append(primary, secondary);

    bar.forEach((skill, i) => {
      const skillId = skill.id;
      const el = document.createElement('div');
      el.className = 'slot clickable';
      el.title = `${skill.name} — ${skill.description} (${skill.energyCost} energy)`;
      el.innerHTML =
        `<span class="slot-key">${hotkeyLabel(i)}</span>` +
        `<span class="slot-name">${skill.name}</span>` +
        `<div class="slot-cd" style="display:none"></div>`;
      el.addEventListener('click', () => this.emit({ t: 'useSkill', skillId }));
      (i < PRIMARY_ROW_SLOTS ? primary : secondary).appendChild(el);
      this.slots.set(skillId, {
        el,
        cd: el.querySelector<HTMLElement>('.slot-cd')!,
        name: el.querySelector<HTMLElement>('.slot-name')!,
      });
    });
  }

  /** Skill id bound to a hotkey slot, or null. */
  skillForSlot(index: number): string | null {
    return this.skillOrder[index] ?? null;
  }

  // ------------------------------------------------------------------ events

  handleEvents(events: SimEvent[], camera: THREE.Camera): void {
    const playerId = this.world.playerId;
    for (const ev of events) {
      switch (ev.t) {
        case 'damage': {
          const source = this.world.entity(ev.sourceId);
          const target = this.world.entity(ev.targetId);
          if (!source || !target) break;
          const dealt = ev.sourceId === playerId;
          if (dealt || ev.targetId === playerId) {
            const skill = ev.abilityId ? ` (${this.abilityName(ev.sourceId, ev.abilityId)})` : '';
            this.log(
              dealt
                ? `You hit ${target.name} for ${ev.amount}${ev.crit ? ' (crit!)' : ''}${skill}`
                : `${source.name} hits you for ${ev.amount}${ev.crit ? ' (crit!)' : ''}`,
              dealt ? 'log-hit' : 'log-dmg',
            );
          }
          this.float(
            camera,
            target,
            `${ev.amount}`,
            `${dealt ? 'dealt' : 'taken'}${ev.crit ? ' crit' : ''}`,
          );
          break;
        }
        case 'miss': {
          const target = this.world.entity(ev.targetId);
          if (target) this.float(camera, target, 'miss', 'miss');
          break;
        }
        case 'heal': {
          const target = this.world.entity(ev.targetId);
          if (target && ev.amount > 0) {
            this.float(camera, target, `+${ev.amount}`, 'heal');
            if (ev.targetId === playerId) this.log(`You recover ${ev.amount} health.`, 'log-xp');
          }
          break;
        }
        case 'death': {
          const victim = this.world.entity(ev.entityId);
          if (!victim) break;
          if (ev.entityId === playerId) this.log('You have died.', 'log-warn');
          else if (ev.killerId === playerId) this.log(`You have slain ${victim.name}.`, 'log-hit');
          break;
        }
        case 'xpGained':
          if (ev.amount > 0) this.log(`You gain ${ev.amount} experience.`, 'log-xp');
          break;
        case 'debt':
          // A repayment is not worth a line every kill — the bar says it.
          if (ev.kind === 'incurred') {
            this.log(`Dying cost you ${ev.amount.toLocaleString()} experience.`, 'log-danger');
            this.log('Your body lies where you fell. Go back to it and take it back.', 'log-loot');
          } else if (ev.kind === 'reclaimed' && ev.amount > 0) {
            this.log(`You take back ${ev.amount.toLocaleString()} experience.`, 'log-good');
          }
          break;
        case 'levelUp':
          this.log(`You have reached level ${ev.level}!`, 'log-good');
          break;
        case 'captured': {
          this.log(
            ev.mountId
              ? `The ${ev.name} lets you get a hand on its mane. It is yours.`
              : `The ${ev.name} throws you off and comes back angry.`,
            ev.mountId ? 'log-good' : 'log-warn',
          );
          break;
        }
        case 'mounted': {
          const name = ev.mountId ? getMount(ev.mountId).name : null;
          this.log(
            ev.unseated
              ? 'You are thrown out of the saddle.'
              : name
                ? `You swing up onto the ${name}.`
                : 'You dismount.',
            ev.unseated ? 'log-warn' : 'log-loot',
          );
          break;
        }
        case 'dragon': {
          this.log(ev.text, 'log-dragon');
          // Only the moments that change what the world looks like get a
          // banner. "It is moving" is a log line; "it is here" is an event.
          if (ev.phase === 'roosting' || ev.phase === 'slain') {
            this.showZoneBanner(ev.name, 'dragon');
          }
          if (this.els.realmWindow.style.display === 'block') this.renderRealm();
          break;
        }
        case 'holdingChanged': {
          const to = getFaction(ev.to).name;
          this.log(
            ev.byPlayer
              ? `${to} take ${ev.name}. That was your doing.`
              : `${ev.name} has fallen to ${to}.`,
            'log-realm',
          );
          this.showZoneBanner(`${ev.name} — ${to}`, 'realm');
          if (this.els.realmWindow.style.display === 'block') this.renderRealm();
          break;
        }
        case 'standingChanged': {
          const faction = getFaction(ev.factionId);
          this.log(`${faction.name} now consider you ${ev.band}.`, 'log-realm');
          break;
        }
        case 'rareSpawn': {
          // Only when it is close enough to see. A world-wide announcement
          // would replace the hunt with a notification.
          const mob = this.world.entity(ev.entityId);
          const player = this.world.player;
          if (!mob) break;
          const d = Math.hypot(mob.pos.x - player.pos.x, mob.pos.z - player.pos.z);
          if (d > RARE_SIGHTING_RANGE) break;
          this.log(ev.sighting, 'log-rare');
          this.log(`${ev.name} is here.`, 'log-rare');
          this.showZoneBanner(ev.name, 'rare');
          break;
        }
        case 'skillUnlocked':
          this.log(`New skill learned: ${getSkill(ev.skillId).name}.`, 'log-good');
          break;
        case 'questAccepted':
          this.log(`Quest accepted: ${getQuest(ev.questId).name}`, 'log-good');
          this.renderVendor();
          break;
        case 'questProgress': {
          const objective = getQuest(ev.questId).objectives[ev.objectiveIndex]!;
          this.log(`${objective.text}: ${ev.count}/${ev.needed}`, 'log-xp');
          break;
        }
        case 'questReady':
          this.log(`${getQuest(ev.questId).name} — return to the one who asked.`, 'log-good');
          this.renderVendor();
          break;
        case 'questCompleted': {
          const quest = getQuest(ev.questId);
          this.log(`Completed: ${quest.name} (+${ev.xp} xp, +${ev.gold} gold)`, 'log-good');
          for (const itemId of ev.items) this.log(`Received ${getItem(itemId).name}.`, 'log-loot');
          this.renderVendor();
          break;
        }
        case 'questAbandoned':
          this.log(`Abandoned: ${getQuest(ev.questId).name}`, 'log-warn');
          break;
        case 'zoneChanged':
          this.log(`You arrive in ${ev.zoneName}.`, 'log-good');
          this.showZoneBanner(ev.zoneName);
          this.closeVendor();
          break;
        case 'sold': {
          const item = getItem(ev.itemId);
          this.log(
            `Sold ${item.name}${ev.qty > 1 ? ` x${ev.qty}` : ''} for ${ev.gold} gold.`,
            'log-loot',
          );
          this.renderVendor();
          break;
        }
        case 'bought': {
          this.log(`Bought ${getItem(ev.itemId).name} for ${ev.gold} gold.`, 'log-loot');
          this.renderVendor();
          break;
        }
        case 'lootGained': {
          const names = ev.items.map(
            (s) => `${getItem(s.itemId).name}${s.qty > 1 ? ` x${s.qty}` : ''}`,
          );
          if (ev.gold > 0) names.push(`${ev.gold} gold`);
          if (names.length) this.log(`You loot ${names.join(', ')}.`, 'log-loot');
          break;
        }
        case 'castInterrupted':
          if (ev.sourceId === playerId && ev.kind === 'skill') {
            this.log(`${getSkill(ev.id).name} was interrupted.`, 'log-warn');
          }
          break;
        case 'telegraph':
          this.log(ev.text, 'log-danger');
          this.showTelegraphBanner(ev.text, ev.durationMs);
          break;
        case 'dodged':
          if (ev.targetId === playerId) {
            const source = this.world.entity(ev.sourceId);
            this.log(
              `You dodge ${source ? source.name + "'s" : 'the'} ${this.abilityName(ev.sourceId, ev.abilityId)}!`,
              'log-good',
            );
            const target = this.world.entity(ev.targetId);
            if (target) this.float(camera, target, 'dodged!', 'dodge');
          }
          break;
        case 'enraged': {
          const mob = this.world.entity(ev.entityId);
          if (mob) this.log(`${mob.name} is enraged!`, 'log-danger');
          break;
        }
        case 'interrupted': {
          if (ev.sourceId !== playerId) break;
          const target = this.world.entity(ev.targetId);
          this.log(
            `You interrupt ${target?.name ?? 'the caster'}'s ${ev.abilityName}! ` +
              `Locked out for ${Math.round(ev.lockoutMs / 1000)}s.`,
            'log-good',
          );
          // Clear the warning immediately — the thing it warned about is gone.
          this.hideTelegraphBanner();
          if (target) this.float(camera, target, 'interrupted!', 'interrupt');
          break;
        }
        case 'interruptWasted': {
          if (ev.sourceId !== playerId) break;
          this.log('Nothing to interrupt.', 'log-warn');
          break;
        }
        case 'summoned': {
          const mob = this.world.entity(ev.sourceId);
          if (mob) this.log(`${mob.name} calls in reinforcements!`, 'log-danger');
          break;
        }
        case 'chat':
          // Chat, in a game with no chat. It goes in the same log as everything
          // else on purpose: a separate channel window would be a UI pretending
          // there is somebody on the other end of it.
          this.log(`[${ev.name}] ${ev.text}`, 'log-chat');
          this.chatter.set(ev.entityId, { text: ev.text, at: performance.now() });
          break;
        case 'error':
          if (ev.entityId === playerId) this.log(ev.message, 'log-warn');
          break;
      }
    }
  }

  /** Resolve a skill or mob-ability id to a display name. */
  private abilityName(sourceId: EntityId, id: string): string {
    const source = this.world.entity(sourceId);
    if (source?.kind === 'mob' && source.defId) {
      const ability = getMob(source.defId).abilities?.find((a) => a.id === id);
      if (ability) return ability.name;
    }
    try {
      return getSkill(id).name;
    } catch {
      return id;
    }
  }

  /** Big centred warning while a boss winds up something dangerous. */
  /**
   * Flash the volume, then get out of the way.
   *
   * A toast rather than a permanent control: the mixer is two keys and a
   * setting people change twice, and a slider parked on screen forever costs
   * more attention than it ever repays.
   */
  showVolume(muted: boolean, level: number): void {
    const steps = 10;
    const filled = muted ? 0 : Math.round(level * steps);
    this.els.volumeIcon.textContent = muted || filled === 0 ? 'Muted' : 'Sound';
    this.els.volumeBar.innerHTML = Array.from({ length: steps }, (_, i) =>
      `<i class="${i < filled ? 'on' : ''}"></i>`,
    ).join('');
    this.els.volumeToast.classList.add('shown');
    if (this.volumeTimer !== null) window.clearTimeout(this.volumeTimer);
    this.volumeTimer = window.setTimeout(() => {
      this.els.volumeToast.classList.remove('shown');
      this.volumeTimer = null;
    }, 1400);
  }

  private showTelegraphBanner(text: string, durationMs: number): void {
    const banner = this.els.telegraph;
    banner.textContent = text;
    banner.style.display = 'block';
    if (this.telegraphTimer !== null) clearTimeout(this.telegraphTimer);
    this.telegraphTimer = window.setTimeout(() => {
      banner.style.display = 'none';
      this.telegraphTimer = null;
    }, durationMs + 400);
  }

  private hideTelegraphBanner(): void {
    if (this.telegraphTimer !== null) clearTimeout(this.telegraphTimer);
    this.telegraphTimer = null;
    this.els.telegraph.style.display = 'none';
  }

  log(text: string, cls = ''): void {
    const line = document.createElement('div');
    line.className = `log-line ${cls}`;
    line.textContent = text;
    this.els.log.prepend(line);
    while (this.els.log.childElementCount > MAX_LOG_LINES) {
      this.els.log.lastElementChild?.remove();
    }
  }

  private float(camera: THREE.Camera, entity: Entity, text: string, cls: string): void {
    // Sits above the nameplate, which occupies roughly height + 0.35.
    const height = entity.kind === 'mob' ? getMob(entity.defId!).view.height : 1.8;
    const base = this.groundAt(entity.pos.x, entity.pos.z);
    const screen = this.toScreen(camera, entity.pos.x, base + height + 1.5, entity.pos.z);
    if (!screen) return;
    const el = document.createElement('div');
    el.className = `float ${cls}`;
    el.textContent = text;
    // Jitter so simultaneous hits don't stack into an unreadable pile.
    el.style.left = `${screen.x + (Math.random() * 28 - 14)}px`;
    el.style.top = `${screen.y}px`;
    this.els.overlays.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }

  private toScreen(
    camera: THREE.Camera,
    x: number,
    y: number,
    z: number,
  ): { x: number; y: number } | null {
    this.projected.set(x, y, z).project(camera);
    if (this.projected.z > 1) return null;
    return {
      x: (this.projected.x * 0.5 + 0.5) * window.innerWidth,
      y: (-this.projected.y * 0.5 + 0.5) * window.innerHeight,
    };
  }

  // ------------------------------------------------------------------- frame

  update(camera: THREE.Camera): void {
    const player = this.world.player;
    const stats = this.world.statsOf(player);

    this.els.playerName.textContent = player.name;
    this.els.playerLevel.textContent = `Lv ${player.level}`;
    setBar(this.els.playerHp, player.health, stats.maxHealth);
    this.els.playerHpLabel.textContent = `${Math.ceil(Math.max(0, player.health))} / ${stats.maxHealth}`;
    setBar(this.els.playerEnergy, player.energy, stats.maxEnergy);
    this.els.playerEnergyLabel.textContent = `${Math.floor(player.energy)} / ${stats.maxEnergy}`;

    this.updateTargetFrame();
    this.updateCastBar(player);
    this.updateXpBar(player);
    this.updateSkillBar(player);
    this.updateNameplates(camera);
    this.updateTracker(player);

    this.els.deathOverlay.style.display = player.dead ? 'flex' : 'none';
    if (player.dead) {
      const owed = player.xpDebt ?? 0;
      this.els.deathCost.textContent =
        owed > 0
          ? `${owed.toLocaleString()} experience owed. Walk back to where you fell and press V to take it back.`
          : 'That one was free.';
    }

    if (this.openVendorId !== null) {
      const vendor = this.world.entity(this.openVendorId);
      const d = vendor
        ? Math.hypot(vendor.pos.x - player.pos.x, vendor.pos.z - player.pos.z)
        : Infinity;
      // Walking away ends the conversation, rather than leaving a shop open
      // across the map that would reject every click.
      if (!vendor || d > 7 || player.dead) this.closeVendor();
    }
    this.updateTravelPrompt(player);
    if (this.els.questLog.style.display === 'block') this.renderQuestLog();
    if (this.els.characterWindow.style.display === 'block') this.renderCharacter();
    if (this.els.inventoryWindow.style.display === 'block') this.renderInventory();
    if (this.els.realmWindow.style.display === 'block') this.renderRealm();
  }

  /**
   * What to do next, and which way it is.
   *
   * The story chain always walked you to the bosses band by band — but only if
   * you opened the quest log, read it, and then worked out for yourself where
   * "the wet ground south of the stones" was on a map three kilometres across.
   * A route nobody can see is not a route.
   *
   * So: the current objective, its count, and an arrow. The arrow is the whole
   * feature. It points at the nearest place that objective can actually be
   * advanced — the camp that holds the creature, the trader who wants the
   * trophies, the road out of the zone — and it turns with the camera, so
   * "which way" is answered by looking rather than by reading.
   */
  private updateTracker(player: Entity): void {
    const found = this.trackedObjective(player);
    if (!found) {
      this.els.tracker.style.display = 'none';
      return;
    }
    this.els.tracker.style.display = 'block';
    this.els.trackerHead.textContent = found.title;
    this.els.trackerBody.innerHTML = found.line;

    const where = found.where;
    if (!where) {
      this.els.trackerWhere.style.display = 'none';
      return;
    }
    this.els.trackerWhere.style.display = 'flex';
    const dx = where.x - player.pos.x;
    const dz = where.z - player.pos.z;
    const distance = Math.hypot(dx, dz);
    // Bearing relative to where the camera is looking, so the arrow points the
    // way the screen does rather than the way the world does.
    const bearing = Math.atan2(dx, dz) - this.cameraYaw();
    this.els.trackerArrow.style.transform = `rotate(${-bearing}rad)`;
    this.els.trackerDist.textContent =
      distance < 12 ? `${where.label} — you are here` : `${where.label} — ${Math.round(distance)}m`;
  }

  /** Which way the camera is facing, for the tracker arrow. */
  private cameraYaw(): number {
    return this.yawOf();
  }

  /**
   * The objective the tracker should be showing.
   *
   * Story chain first, then the armour line, then whatever else is in hand —
   * the story chain is the one that leads to the bosses, so it is the one that
   * gets the arrow. With nothing accepted at all it points at the trader, which
   * is the answer to the only question a player with no quests has.
   */
  private trackedObjective(
    player: Entity,
  ): { title: string; line: string; where: { x: number; z: number; label: string } | null } | null {
    const active = (player.quests ?? [])
      .map((p) => ({ p, q: getQuest(p.questId) }))
      .filter(({ q }) => q.zoneId === this.world.zone.id)
      .sort((a, b) => Number(b.q.chain.endsWith('_story')) - Number(a.q.chain.endsWith('_story')));

    for (const { p, q } of active) {
      if (this.world.isQuestComplete(player, q.id)) {
        const vendor = this.vendorSpot(q.giverVendorId);
        return {
          title: q.name,
          line: '<span class="tracker-ready">Ready to hand in</span>',
          where: vendor,
        };
      }
      for (const [i, objective] of q.objectives.entries()) {
        const needed =
          objective.kind === 'kill' || objective.kind === 'collect' ? objective.count : 1;
        const count = Math.min(needed, p.counts[i] ?? 0);
        if (count >= needed) continue;
        return {
          title: q.name,
          line: `${objective.text} <span class="quest-count">${count}/${needed}</span>`,
          where: this.objectiveSpot(objective),
        };
      }
    }

    // Nothing in hand: the next step is whoever hands work out.
    const trader = this.world.zone.vendors.find((v) => v.vendorId !== 'ceallach');
    if (!trader) return null;
    return {
      title: 'No work in hand',
      line: 'Traders keep a chain of work that runs to the bosses.',
      where: this.vendorSpot(trader.vendorId),
    };
  }

  private vendorSpot(vendorId: string): { x: number; z: number; label: string } | null {
    const placed = this.world.zone.vendors.find((v) => v.vendorId === vendorId);
    if (!placed) return null;
    return { x: placed.pos.x, z: placed.pos.z, label: getVendor(vendorId).name };
  }

  /** The nearest place in this zone where an objective can be advanced. */
  private objectiveSpot(
    objective: QuestObjective,
  ): { x: number; z: number; label: string } | null {
    if (objective.kind === 'level') return null;
    if (objective.kind === 'reach') {
      const exit = this.world.zone.exits.find((e) => e.toZoneId === objective.zoneId);
      return exit ? { x: exit.pos.x, z: exit.pos.z, label: exit.label } : null;
    }
    const mobId =
      objective.kind === 'kill' ? objective.mobId : mobDropping(objective.itemId);
    if (!mobId) return null;
    return this.nearestSpawn(mobId);
  }

  /** Closest spawn point of a creature, by the zone layout rather than by what is alive. */
  private nearestSpawn(mobId: string): { x: number; z: number; label: string } | null {
    const player = this.world.player;
    let best: { x: number; z: number } | null = null;
    let bestDist = Infinity;
    for (const spawn of this.world.zone.spawns) {
      if (spawn.mobId !== mobId) continue;
      const d = Math.hypot(spawn.pos.x - player.pos.x, spawn.pos.z - player.pos.z);
      if (d < bestDist) {
        bestDist = d;
        best = spawn.pos;
      }
    }
    if (!best) return null;
    return { x: best.x, z: best.z, label: getMob(mobId).name };
  }

  private updateTargetFrame(): void {
    const target = this.world.entity(this.world.player.targetId ?? -1);
    if (!target) {
      this.els.targetFrame.style.display = 'none';
      return;
    }
    this.els.targetFrame.style.display = 'block';
    const stats = this.world.statsOf(target);
    const stars = target.kind === 'mob' ? getMob(target.defId!).stars : 0;
    this.els.targetName.textContent = target.dead ? `${target.name} (dead)` : target.name;
    this.els.targetLevel.innerHTML =
      `Lv ${target.level}` +
      (target.kind === 'npc' ? ` <span class="np-lvl">${target.classId ?? ''}</span>` : '') +
      (stars ? ` <span class="stars ${starClass(stars)}">${starText(stars)}</span>` : '');
    // A boss frame should be unmistakable before the fight starts.
    this.els.targetFrame.classList.toggle('is-boss', stars >= BOSS_STARS);
    // Somebody you cannot fight has no health bar to read. Selecting another
    // adventurer is a "who is that", not a target call.
    const combatant = target.kind !== 'npc' && target.kind !== 'vendor';
    this.els.targetHp.parentElement!.style.visibility = combatant ? 'visible' : 'hidden';
    setBar(this.els.targetHp, target.health, stats.maxHealth);
    this.els.targetHpLabel.textContent = combatant
      ? `${Math.ceil(Math.max(0, target.health))} / ${stats.maxHealth}`
      : '';
  }

  private updateCastBar(player: Entity): void {
    if (!player.cast) {
      this.els.castBar.style.display = 'none';
      return;
    }
    const progress = 1 - player.cast.remainingMs / player.cast.totalMs;
    this.els.castBar.style.display = 'block';
    this.els.castFill.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
    this.els.castLabel.textContent = this.abilityName(player.id, player.cast.id);
  }

  private updateXpBar(player: Entity): void {
    const need = xpToNext(player.level);
    const have = player.xp ?? 0;
    const left = Math.max(0, need - have);
    const owed = player.xpDebt ?? 0;
    this.els.xpFill.style.width = `${Math.min(100, (have / need) * 100)}%`;
    // Debt is drawn as ground still to make up, sitting on the bar ahead of
    // where you are — not as a bite taken out behind you. It has never taken
    // anything away from you, and the bar should not imply that it has.
    this.els.xpDebt.style.left = `${Math.min(100, (have / need) * 100)}%`;
    this.els.xpDebt.style.width = `${Math.min(100 - (have / need) * 100, (owed / need) * 100)}%`;
    this.els.xpLabel.textContent =
      player.level >= MAX_LEVEL
        ? 'Level 100'
        : `${have.toLocaleString()} / ${need.toLocaleString()} — ${left.toLocaleString()} to go` +
          (owed > 0 ? `  ·  ${owed.toLocaleString()} owed` : '');

    const points = player.unspentPoints ?? 0;
    const skillPoints = player.skillPoints ?? 0;
    const waiting: string[] = [];
    if (points > 0) waiting.push(`${points} attribute`);
    if (skillPoints > 0) waiting.push(`${skillPoints} skill`);
    this.els.xpLevel.innerHTML =
      `Level ${player.level}` +
      (waiting.length
        ? ` <span class="unspent">· ${waiting.join(' and ')} ${
            points + skillPoints === 1 ? 'point' : 'points'
          } to spend (C)</span>`
        : '');
  }

  private updateSkillBar(player: Entity): void {
    for (const [skillId, slot] of this.slots) {
      const skill = getSkill(skillId);
      const underLevel = player.level < skill.reqLevel;
      // A taught skill you are high enough for but have not found the tome for
      // reads differently from one you are simply too low for: one is a thing
      // to go and get, the other is a thing to wait for.
      const unlearned =
        !!skill.taughtBy && !(player.learnedSkills ?? []).includes(skill.id);
      const locked = underLevel || unlearned;
      slot.el.classList.toggle('locked', underLevel);
      slot.el.classList.toggle('unlearned', !underLevel && unlearned);
      slot.el.classList.toggle('unaffordable', !locked && player.energy < skill.energyCost);
      slot.name.textContent = underLevel
        ? `Lv ${skill.reqLevel}`
        : unlearned
          ? 'Untaught'
          : skill.name;

      const remaining = player.skillCooldowns?.[skillId] ?? 0;
      if (remaining > 0) {
        slot.cd.style.display = 'flex';
        slot.cd.textContent = remaining >= 1000 ? `${Math.ceil(remaining / 1000)}` : '<1';
      } else {
        slot.cd.style.display = 'none';
      }
    }
  }

  private updateNameplates(camera: THREE.Camera): void {
    const player = this.world.player;
    for (const entity of this.world.entities.values()) {
      if (entity.id === player.id) continue;
      if (entity.kind === 'vendor') {
        this.updateVendorPlate(camera, entity, player);
        continue;
      }
      if (entity.kind === 'npc') {
        this.updateAdventurerPlate(camera, entity, player);
        continue;
      }
      let plate = this.nameplates.get(entity.id);
      if (!plate) {
        plate = document.createElement('div');
        plate.className = 'nameplate hostile';
        plate.innerHTML = `<div class="np-name"></div><div class="np-bar"><div class="np-fill"></div></div>`;
        this.els.overlays.appendChild(plate);
        this.nameplates.set(entity.id, plate);
      }

      const def = entity.kind === 'mob' ? getMob(entity.defId!) : null;
      const height = def?.view.height ?? 1.8;
      const screen = this.toScreen(
        camera,
        entity.pos.x,
        this.groundAt(entity.pos.x, entity.pos.z) + height + 0.35,
        entity.pos.z,
      );
      const distance = Math.hypot(entity.pos.x - player.pos.x, entity.pos.z - player.pos.z);

      const lootable =
        entity.dead && ((entity.corpseLoot?.length ?? 0) > 0 || (entity.corpseGold ?? 0) > 0);

      // Plates are the noisiest thing on screen in a populated camp, and they
      // have no depth occlusion, so keep them tight: only what you are fighting,
      // what is fighting you, or what is close enough to matter.
      // A rare spawn is the exception to the tight plate range: the whole
      // mechanic is spotting one in a camp you have walked past a hundred
      // times, and a plate you can only read from melee range does not help.
      const rare = !!def?.rareOf;
      const range = rare ? NAMEPLATE_RANGE * 3 : NAMEPLATE_RANGE;
      const relevant =
        entity.id === player.targetId ||
        entity.targetId === player.id ||
        distance < range ||
        (lootable && distance < range * 1.5);

      if (!screen || !relevant || (entity.dead && !lootable)) {
        plate.style.display = 'none';
        continue;
      }
      // Fade with distance so the near ones read as the important ones.
      plate.style.opacity = `${Math.max(0.35, Math.min(1, 1.4 - distance / range))}`;

      plate.style.display = 'block';
      plate.classList.toggle('rare', rare);
      plate.style.left = `${screen.x}px`;
      plate.style.top = `${screen.y}px`;
      plate.classList.toggle('dead', entity.dead);
      plate.classList.toggle('lootable', lootable);

      const stars = def?.stars ?? 0;
      const name = plate.querySelector<HTMLElement>('.np-name')!;
      const horse = def?.horse;
      const spent =
        horse && !entity.dead && entity.health / this.world.statsOf(entity).maxHealth <= 0.25;
      if (spent && !(player.stable ?? []).includes(horse!)) {
        name.textContent = `${entity.name} — press H to take it`;
      } else if (lootable) {
        name.textContent = `${entity.name} — press F to loot`;
      } else {
        name.innerHTML =
          `${entity.name} <span class="np-lvl">${entity.level}</span>` +
          `<span class="stars ${starClass(stars)}">${starText(stars)}</span>`;
      }
      plate.classList.toggle('is-boss', stars >= BOSS_STARS);

      const bar = plate.querySelector<HTMLElement>('.np-bar')!;
      bar.style.display = entity.dead ? 'none' : 'block';
      const stats = this.world.statsOf(entity);
      plate.querySelector<HTMLElement>('.np-fill')!.style.width =
        `${Math.max(0, (entity.health / stats.maxHealth) * 100)}%`;
    }

    for (const [id, plate] of this.nameplates) {
      if (!this.world.entity(id)) {
        plate.remove();
        this.nameplates.delete(id);
        this.chatter.delete(id);
      }
    }
  }

  /**
   * Traders read differently from mobs: no health bar, a gold label, and a
   * prompt once you are close enough to actually trade.
   */
  private updateVendorPlate(camera: THREE.Camera, entity: Entity, player: Entity): void {
    let plate = this.nameplates.get(entity.id);
    if (!plate) {
      plate = document.createElement('div');
      plate.innerHTML = `<div class="np-name"></div><div class="np-bar"><div class="np-fill"></div></div>`;
      this.els.overlays.appendChild(plate);
      this.nameplates.set(entity.id, plate);
    }
    plate.className = 'nameplate vendor';

    const screen = this.toScreen(
      camera,
      entity.pos.x,
      this.groundAt(entity.pos.x, entity.pos.z) + 2.9,
      entity.pos.z,
    );
    const distance = Math.hypot(entity.pos.x - player.pos.x, entity.pos.z - player.pos.z);
    // Traders are landmarks, so they stay legible from much further than a mob.
    if (!screen || distance > 55) {
      plate.style.display = 'none';
      return;
    }
    plate.style.display = 'block';
    plate.style.left = `${screen.x}px`;
    plate.style.top = `${screen.y}px`;
    plate.style.opacity = '1';
    plate.querySelector<HTMLElement>('.np-bar')!.style.display = 'none';
    plate.querySelector<HTMLElement>('.np-name')!.textContent =
      distance <= 5.5 ? `${entity.name} — press E to trade` : entity.name;
  }

  /**
   * Another adventurer's plate: name, class, level. No health bar.
   *
   * A health bar over somebody you cannot fight is an invitation to try, and
   * the answer would be "nothing happens" — which reads as a broken game rather
   * than a deliberate rule. What their plate says instead is what an MMO's says
   * about a stranger: who they are and what they play.
   */
  private updateAdventurerPlate(camera: THREE.Camera, entity: Entity, player: Entity): void {
    let plate = this.nameplates.get(entity.id);
    if (!plate) {
      plate = document.createElement('div');
      plate.innerHTML =
        `<div class="np-says"></div><div class="np-name"></div>` +
        `<div class="np-bar"><div class="np-fill"></div></div>`;
      this.els.overlays.appendChild(plate);
      this.nameplates.set(entity.id, plate);
    }
    plate.className = 'nameplate adventurer';

    const screen = this.toScreen(
      camera,
      entity.pos.x,
      this.groundAt(entity.pos.x, entity.pos.z) + 2.3,
      entity.pos.z,
    );
    const distance = Math.hypot(entity.pos.x - player.pos.x, entity.pos.z - player.pos.z);
    // Readable from further off than a mob: the point of them is being seen
    // across a field, and a plate that only resolves in melee range never is.
    if (!screen || distance > NAMEPLATE_RANGE * 2.5) {
      plate.style.display = 'none';
      return;
    }
    plate.style.display = 'block';
    plate.style.left = `${screen.x}px`;
    plate.style.top = `${screen.y}px`;
    plate.style.opacity = `${Math.max(0.4, Math.min(1, 1.5 - distance / (NAMEPLATE_RANGE * 2.5)))}`;
    plate.querySelector<HTMLElement>('.np-bar')!.style.display = 'none';
    plate.querySelector<HTMLElement>('.np-name')!.innerHTML =
      `${entity.name} <span class="np-lvl">${entity.level} ${entity.classId ?? ''}</span>`;

    // The speech bubble, if they said something recently enough.
    const says = plate.querySelector<HTMLElement>('.np-says')!;
    const line = this.chatter.get(entity.id);
    if (line && performance.now() - line.at < CHAT_BUBBLE_MS) {
      says.textContent = line.text;
      says.style.display = 'block';
    } else {
      says.style.display = 'none';
    }
  }

  // -------------------------------------------------------- while you were away

  /**
   * What the world did in your absence.
   *
   * Shown once, on load, and only when something actually changed. A card that
   * opens on "nothing happened while you were away" is worse than no card: it
   * teaches the player to dismiss the thing that will one day tell them the
   * road they levelled on belongs to somebody else now.
   */
  showAwayReport(report: AwayReport): void {
    if (report.fronts.length === 0 && report.dragons.length === 0) return;

    this.els.awayTitle.textContent = `While you were away — ${describeSpan(report.awayMs)}`;
    const body = this.els.awayBody;
    body.innerHTML = '';

    for (const front of report.fronts) {
      const row = document.createElement('div');
      row.className = 'away-row';
      const to = getFaction(front.to);
      row.innerHTML =
        `<div class="away-what">${front.name}</div>` +
        `<div class="away-who">${getFaction(front.from).name} → ` +
        `<span style="color:${hex(to.color)}">${to.name}</span></div>`;
      body.appendChild(row);
    }

    for (const dragon of report.dragons) {
      const row = document.createElement('div');
      row.className = 'away-row dragon';
      row.innerHTML =
        `<div class="away-what">${dragon.name}</div>` +
        `<div class="away-who">is on ${dragon.holdingName}, in ${ZONES[dragon.zoneId]?.name ?? dragon.zoneId}</div>`;
      body.appendChild(row);
    }

    if (report.cappedAt !== null) {
      const note = document.createElement('div');
      note.className = 'away-note';
      note.textContent = 'You have been gone a long time. The map settled without you.';
      body.appendChild(note);
    }

    this.els.awayReport.style.display = 'block';
    // Also goes in the log, because the card is dismissible and the log is the
    // record — a player who closes this should still be able to read what it said.
    this.log(`While you were away — ${describeSpan(report.awayMs)}:`, 'log-realm');
    for (const front of report.fronts) {
      this.log(`${front.name} has fallen to ${getFaction(front.to).name}.`, 'log-realm');
    }
    for (const dragon of report.dragons) {
      this.log(`${dragon.name} is out, over ${dragon.holdingName}.`, 'log-danger');
    }
  }

  hideAwayReport(): void {
    this.els.awayReport.style.display = 'none';
  }

  get awayReportOpen(): boolean {
    return this.els.awayReport.style.display === 'block';
  }

  // ------------------------------------------------------------------ panels

  /** Open the shop for a trader. Returns false if there is nobody to talk to. */
  openVendor(vendorEntityId: EntityId): boolean {
    const vendor = this.world.entity(vendorEntityId);
    if (!vendor || vendor.kind !== 'vendor') return false;
    this.openVendorId = vendorEntityId;
    this.els.vendorWindow.style.display = 'block';
    const def = getVendor(vendor.vendorId!);
    this.els.vendorName.textContent = def.name;
    this.els.vendorGreeting.textContent = def.greeting;
    this.renderVendor();
    return true;
  }

  closeVendor(): void {
    this.openVendorId = null;
    this.els.vendorWindow.style.display = 'none';
  }

  get vendorOpen(): boolean {
    return this.openVendorId !== null;
  }

  private renderVendor(): void {
    if (this.openVendorId === null) return;
    const vendor = this.world.entity(this.openVendorId);
    if (!vendor?.vendorId) return;
    const player = this.world.player;
    this.renderVendorQuests(vendor.vendorId, player);
    const gold = player.gold ?? 0;
    this.els.vendorGold.textContent = `${gold}g`;

    // --- stock ---
    const stock = this.els.vendorStock;
    stock.innerHTML = '';
    for (const itemId of getVendor(vendor.vendorId).stock) {
      const item = getItem(itemId);
      const price = buyPrice(item);
      const usable = canEquip(item, player.classId);
      const afford = gold >= price;
      const row = document.createElement('div');
      row.className = `vendor-row${afford && usable ? ' clickable' : ' unusable'}`;
      row.innerHTML =
        `<span style="color:${QUALITY_COLORS[item.quality]}">${item.name}</span>` +
        `<span class="${afford ? 'price' : 'price too-dear'}">${price}g</span>`;
      row.title = usable
        ? `${describeItem(itemId)} — costs ${price} gold`
        : `${item.classes?.join('/')} only`;
      if (afford && usable) {
        row.addEventListener('click', () =>
          this.emit({ t: 'buy', vendorId: this.openVendorId!, itemId }),
        );
      }
      stock.appendChild(row);
    }

    // --- what you can sell ---
    const bags = this.els.vendorBags;
    bags.innerHTML = '';
    const inv = player.inventory ?? [];
    if (inv.length === 0) {
      const none = document.createElement('div');
      none.className = 'empty';
      none.textContent = 'Nothing to sell';
      bags.appendChild(none);
    }
    for (const stack of inv) {
      const item = getItem(stack.itemId);
      const unit = sellPrice(item);
      const row = document.createElement('div');
      row.className = 'vendor-row clickable';
      row.innerHTML =
        `<span style="color:${QUALITY_COLORS[item.quality]}">${item.name}` +
        `${stack.qty > 1 ? ` <span class="muted">x${stack.qty}</span>` : ''}</span>` +
        `<span class="price sell">+${unit * stack.qty}g</span>`;
      row.title =
        stack.qty > 1
          ? `Click to sell all ${stack.qty} for ${unit * stack.qty} gold (${unit} each)`
          : `Click to sell for ${unit} gold`;
      row.addEventListener('click', () =>
        this.emit({ t: 'sell', vendorId: this.openVendorId!, itemId: stack.itemId, qty: stack.qty }),
      );
      bags.appendChild(row);
    }
  }

  toggleQuestLog(): void {
    const visible = this.els.questLog.style.display === 'block';
    this.els.questLog.style.display = visible ? 'none' : 'block';
    if (!visible) this.renderQuestLog();
  }

  private showZoneBanner(name: string, cls = ''): void {
    const banner = this.els.zoneBanner;
    banner.textContent = name;
    banner.className = cls;
    banner.classList.remove('show');
    // Restart the animation rather than letting a second arrival be silent.
    void banner.offsetWidth;
    banner.classList.add('show');
  }

  /** The road out, shown only when you are actually standing on it. */
  private updateTravelPrompt(player: Entity): void {
    const exit = this.world.exitInReach(player);
    if (!exit || player.dead) {
      this.els.travelPrompt.style.display = 'none';
      return;
    }
    const canGo = player.level >= exit.minLevel;
    this.els.travelPrompt.style.display = 'block';
    this.els.travelPrompt.className = canGo ? '' : 'barred';
    this.els.travelPrompt.textContent = canGo
      ? `${exit.label} — press G to travel`
      : `${exit.label} — return at level ${exit.minLevel}`;
  }

  toggleRealm(): void {
    const visible = this.els.realmWindow.style.display === 'block';
    this.els.realmWindow.style.display = visible ? 'none' : 'block';
    if (!visible) this.renderRealm();
  }

  /**
   * Who holds what, and what they make of you.
   *
   * This panel is the whole territory layer's only home. Without it the war is
   * a number nobody sees: a front can slide for twenty minutes and the only
   * evidence is different mobs standing in a field, which reads as a bug.
   */
  private renderRealm(): void {
    const player = this.world.player;
    const body = this.els.realmBody;
    body.innerHTML = '';

    for (const zone of Object.values(ZONES)) {
      const holdings = HOLDINGS.filter((h) => h.zoneId === zone.id);
      if (holdings.length === 0) continue;
      const head = document.createElement('div');
      head.className = 'realm-zone';
      head.textContent = zone.name;
      body.appendChild(head);

      for (const holding of holdings) {
        const wyrm = this.world.dragonOver(holding.id);
        if (wyrm) {
          // A front with a dragon on it is not a front. Say so instead of
          // drawing a contest that is not happening.
          const row = document.createElement('div');
          row.className = 'realm-row';
          row.innerHTML =
            `<div class="realm-name">${holding.name}` +
            `<span class="realm-dragon">${wyrm.name}</span></div>` +
            `<div class="realm-bar"><div class="realm-wyrm"></div></div>`;
          row.title = `${wyrm.title}, ${wyrm.age} years old. Nobody is holding this.`;
          body.appendChild(row);
          continue;
        }
        const held = this.world.controllerOf(holding.id);
        const faction = getFaction(held);
        // -1..1 mapped onto the bar, with the incumbent's colour filling from
        // their end: the shape of a front is easier to read than its number.
        const control = this.world.controlOf(holding.id);
        const pct = Math.round(((control + 1) / 2) * 100);
        const row = document.createElement('div');
        row.className = 'realm-row';
        row.innerHTML =
          `<div class="realm-name">${holding.name}` +
          `<span class="realm-holder" style="color:${hex(faction.color)}">${faction.name}</span></div>` +
          `<div class="realm-bar">` +
          `<div class="realm-fill" style="width:${pct}%;background:${hex(
            getFaction(holding.claimants[1]).color,
          )}"></div>` +
          `<div class="realm-mark" style="left:${pct}%"></div>` +
          `</div>`;
        row.title =
          `${getFaction(holding.claimants[0]).name} vs ${getFaction(holding.claimants[1]).name} — ` +
          `${this.world.controllerOf(holding.id) === holding.claimants[1] ? 'holding' : 'holding'} at ${pct}%`;
        body.appendChild(row);
      }
    }

    const wyrms = document.createElement('div');
    wyrms.className = 'realm-zone';
    wyrms.style.marginTop = '10px';
    wyrms.textContent = 'The old things';
    body.appendChild(wyrms);

    for (const def of DRAGONS) {
      const state = this.world.dragonState(def.id);
      const row = document.createElement('div');
      row.className = 'realm-row wyrm';
      const where =
        state.phase === 'roosting' && state.holdingId
          ? getHolding(state.holdingId).name
          : state.phase === 'hunting'
            ? 'on the wing'
            : state.phase === 'slain'
              ? 'dead'
              : 'sleeping';
      row.innerHTML =
        `<div class="realm-name">${def.name}` +
        `<span class="${state.phase === 'roosting' ? 'realm-dragon' : 'band-neutral'}">${where}</span></div>`;
      row.title = `${def.title} — ${def.age} years old, ${ZONES[def.zoneId]?.name ?? def.zoneId}.`;
      body.appendChild(row);
    }

    const stable = document.createElement('div');
    stable.className = 'realm-zone';
    stable.style.marginTop = '10px';
    stable.textContent = 'Your stable';
    body.appendChild(stable);

    const owned = player.stable ?? [];
    if (owned.length === 0) {
      const none = document.createElement('div');
      none.className = 'empty';
      none.textContent = 'No horse. There are herds out there.';
      body.appendChild(none);
    }
    for (const mountId of owned) {
      const mount = getMount(mountId);
      const riding = player.mounted === mountId;
      const row = document.createElement('div');
      row.className = 'realm-row wyrm clickable';
      row.innerHTML =
        `<div class="realm-name">${mount.name}` +
        `<span class="${riding ? 'band-good' : 'band-neutral'}">${riding ? 'riding' : 'stabled'}</span></div>`;
      row.title = `${mount.blurb} Click to ${riding ? 'dismount' : 'ride'}.`;
      row.addEventListener('click', () => {
        this.emit({ t: 'mount', mountId: riding ? null : mountId });
        this.renderRealm();
      });
      body.appendChild(row);
    }

    const sep = document.createElement('div');
    sep.className = 'realm-zone';
    sep.style.marginTop = '10px';
    sep.textContent = 'What they make of you';
    body.appendChild(sep);

    for (const faction of Object.values(FACTIONS)) {
      const value = this.world.standingWith(player, faction.id);
      const band = standingBand(value);
      const row = document.createElement('div');
      row.className = 'realm-row standing';
      row.innerHTML =
        `<div class="realm-name">${faction.name}` +
        `<span class="realm-band ${bandClass(band)}">${band}</span></div>`;
      row.title = `${faction.blurb} (${value > 0 ? '+' : ''}${Math.round(value)})`;
      body.appendChild(row);
    }
  }

  private renderQuestLog(): void {
    const player = this.world.player;
    const body = this.els.questLogBody;
    body.innerHTML = '';
    const active = player.quests ?? [];

    if (active.length === 0) {
      const none = document.createElement('div');
      none.className = 'empty';
      none.textContent = 'No work in hand. Traders have some.';
      body.appendChild(none);
      return;
    }

    for (const progress of active) {
      const quest = getQuest(progress.questId);
      const ready = this.world.isQuestComplete(player, quest.id);
      const entry = document.createElement('div');
      entry.className = `quest-entry${ready ? ' ready' : ''}`;
      entry.innerHTML =
        `<div class="quest-head"><span>${quest.name}</span>` +
        `<span class="quest-state">${ready ? 'Ready' : ZONES[quest.zoneId]?.name ?? ''}</span></div>` +
        `<div class="quest-summary">${quest.summary}</div>` +
        quest.objectives
          .map((objective, i) => {
            const needed =
              objective.kind === 'kill' || objective.kind === 'collect' ? objective.count : 1;
            const count = Math.min(needed, progress.counts[i] ?? 0);
            const done = count >= needed;
            return (
              `<div class="quest-obj${done ? ' done' : ''}">` +
              `${done ? '✔' : '○'} ${objective.text} ` +
              `<span class="quest-count">${count}/${needed}</span></div>`
            );
          })
          .join('');

      const abandon = document.createElement('span');
      abandon.className = 'quest-abandon clickable';
      abandon.textContent = 'Abandon';
      abandon.addEventListener('click', () => this.emit({ t: 'abandonQuest', questId: quest.id }));
      entry.appendChild(abandon);
      body.appendChild(entry);
    }
  }

  /** Work this trader has on offer, and work of theirs you have finished. */
  private renderVendorQuests(vendorId: string, player: Entity): void {
    const host = this.els.vendorQuests;
    host.innerHTML = '';

    const offers = this.world.questsOfferedBy(player, vendorId);
    const ready = (player.quests ?? [])
      .map((q) => getQuest(q.questId))
      .filter((q) => q.giverVendorId === vendorId && this.world.isQuestComplete(player, q.id));

    if (offers.length === 0 && ready.length === 0) return;

    const head = document.createElement('div');
    head.className = 'vendor-col-head';
    head.textContent = 'Work';
    host.appendChild(head);

    for (const quest of ready) {
      const row = document.createElement('div');
      row.className = 'quest-row ready clickable';
      row.innerHTML =
        `<span>✔ ${quest.name}</span>` +
        `<span class="price">+${quest.rewards.xp.toLocaleString()} xp</span>`;
      row.title = 'Click to hand in';
      row.addEventListener('click', () =>
        this.emit({ t: 'turnInQuest', vendorId: this.openVendorId!, questId: quest.id }),
      );
      host.appendChild(row);
    }

    for (const quest of offers) {
      const row = document.createElement('div');
      row.className = 'quest-row clickable';
      row.innerHTML =
        `<span>! ${quest.name} <span class="muted">lv${quest.minLevel}</span></span>` +
        `<span class="price">+${quest.rewards.xp.toLocaleString()} xp</span>`;
      row.title = quest.summary;
      row.addEventListener('click', () =>
        this.emit({ t: 'acceptQuest', vendorId: this.openVendorId!, questId: quest.id }),
      );
      host.appendChild(row);
    }
  }

  toggleCharacter(): void {
    const visible = this.els.characterWindow.style.display === 'block';
    this.els.characterWindow.style.display = visible ? 'none' : 'block';
    if (!visible) this.renderCharacter();
  }

  toggleInventory(): void {
    const visible = this.els.inventoryWindow.style.display === 'block';
    this.els.inventoryWindow.style.display = visible ? 'none' : 'block';
    if (!visible) this.renderInventory();
  }

  private renderCharacter(): void {
    const player = this.world.player;
    const stats = this.world.statsOf(player);
    const attrs = this.world.displayAttributes(player);
    const points = player.unspentPoints ?? 0;
    const body = this.els.characterBody;
    body.innerHTML = '';

    const attrRow = (label: string, key: keyof Attributes) => {
      const base = player.attributes?.[key] ?? 0;
      const total = attrs[key];
      const row = document.createElement('div');
      row.className = 'stat-row';
      row.innerHTML =
        `<span>${label}</span>` +
        `<span><span class="v">${total}</span>` +
        `${total !== base ? ` <span class="muted">(${base}+${total - base})</span>` : ''}</span>`;
      const btn = document.createElement('span');
      btn.className = `spend clickable${points > 0 ? '' : ' hidden'}`;
      btn.textContent = '+';
      btn.addEventListener('click', () => {
        this.emit({ t: 'spendPoint', attr: key });
        this.renderCharacter();
      });
      row.appendChild(btn);
      body.appendChild(row);
    };

    const info = document.createElement('div');
    info.className = 'stat-row';
    info.innerHTML = `<span>Attribute points</span><span class="v">${points}</span>`;
    body.appendChild(info);

    attrRow('Strength', 'strength');
    attrRow('Dexterity', 'dexterity');
    attrRow('Focus', 'focus');
    attrRow('Vitality', 'vitality');

    const derived: Array<[string, string]> = [
      ['Health', `${stats.maxHealth}`],
      ['Energy', `${stats.maxEnergy}`],
      ['Attack', `${stats.attack}`],
      ['Defence', `${stats.defense}`],
      ['Crit chance', `${(stats.critChance * 100).toFixed(1)}%`],
      ['Damage', `${stats.damageMin}–${stats.damageMax}`],
      ['Swing', `${(stats.swingMs / 1000).toFixed(2)}s`],
      ['Gold', `${player.gold ?? 0}`],
    ];
    const sep = document.createElement('div');
    sep.style.cssText = 'height:1px;background:rgba(190,168,110,0.28);margin:8px 0';
    body.appendChild(sep);
    for (const [label, value] of derived) {
      const row = document.createElement('div');
      row.className = 'stat-row';
      row.innerHTML = `<span>${label}</span><span class="v">${value}</span>`;
      body.appendChild(row);
    }

    this.renderSkillRanks(player, body);
  }

  /**
   * The skills you know, and what you have invested in each.
   *
   * One point a level for a hundred levels against ten ranks apiece means the
   * whole game buys ten skills out of sixteen — so this panel is where a
   * character stops being "a Warrior" and becomes *your* Warrior. It shows what
   * each rank is worth in the numbers rather than as a bar, because "+13%
   * damage, crits 4% more often" is a decision and a filled bar is not.
   */
  private renderSkillRanks(player: Entity, body: HTMLElement): void {
    const points = player.skillPoints ?? 0;
    // Everything the class has, so an unranked skill you have not learned yet
    // still shows what is coming; only what you actually know can take a point.
    const learned = new Set(player.learnedSkills ?? []);
    const known = skillBarFor(player.classId ?? 'warrior').filter(
      (s) => s.reqLevel <= player.level && (!s.taughtBy || learned.has(s.id)),
    );

    const head = document.createElement('div');
    head.className = 'skills-head';
    head.innerHTML =
      `<span>Skills</span><span class="${points > 0 ? 'v' : 'muted'}">` +
      `${points} skill point${points === 1 ? '' : 's'}</span>`;
    body.appendChild(head);

    for (const skill of known) {
      const rank = player.skillRanks?.[skill.id] ?? 0;
      const row = document.createElement('div');
      row.className = 'stat-row skill-rank';
      const maxed = rank >= MAX_SKILL_RANK;
      row.innerHTML =
        `<span>${skill.name}</span>` +
        `<span class="${rank > 0 ? 'v' : 'muted'}">` +
        (maxed
          ? 'mastered'
          : rank > 0
            ? `rank ${rank} · +${Math.round(rank * SKILL_RANK_POWER * 100)}% · ` +
              `+${(rank * SKILL_RANK_CRIT * 100).toFixed(0)}% crit`
            : 'rank 0') +
        '</span>';
      if (points > 0 && !maxed) {
        const btn = document.createElement('span');
        btn.className = 'spend clickable';
        btn.textContent = '+';
        btn.title = `Spend a point on ${skill.name}`;
        btn.addEventListener('click', () => {
          this.emit({ t: 'rankSkill', skillId: skill.id });
          this.renderCharacter();
        });
        row.appendChild(btn);
      }
      body.appendChild(row);
    }
  }

  /**
   * The backpack: what you are wearing, and what you are carrying.
   *
   * A paper doll rather than a list, because equipment is spatial in a player's
   * head — you do not think "my head slot", you think "the thing on my head".
   * Drag a piece out of the bag onto its slot to wear it, drag it off to take
   * it off, and every square shows the full stat block on hover. Clicking still
   * works for anyone who would rather not drag.
   */
  private renderInventory(): void {
    const player = this.world.player;
    const body = this.els.inventoryBody;
    body.innerHTML = '';

    body.appendChild(this.buildPaperDoll(player));

    const sep = document.createElement('div');
    sep.className = 'bag-head';
    sep.innerHTML = `<span>Bags</span><span class="v">${(player.gold ?? 0).toLocaleString()} gold</span>`;
    body.appendChild(sep);

    const grid = document.createElement('div');
    grid.className = 'bag-grid';
    body.appendChild(grid);

    const inv = player.inventory ?? [];
    if (inv.length === 0) {
      const none = document.createElement('div');
      none.className = 'empty';
      none.textContent = 'Your bags are empty';
      body.appendChild(none);
      return;
    }
    for (const stack of inv) grid.appendChild(this.buildBagSlot(player, stack));
  }

  /**
   * The character, with a square for every slot.
   *
   * Empty slots are labelled and stay visible: a paper doll with the empty
   * squares hidden is a list again, and the gaps are half the information —
   * "I have nothing on my legs" is exactly what a player opens this to find out.
   */
  private buildPaperDoll(player: Entity): HTMLElement {
    const doll = document.createElement('div');
    doll.className = 'doll';

    const slots: Array<{ slot: EquipSlot; label: string }> = [
      { slot: 'head', label: 'Head' },
      { slot: 'chest', label: 'Chest' },
      { slot: 'legs', label: 'Legs' },
      { slot: 'weapon', label: 'Weapon' },
      { slot: 'offhand', label: 'Offhand' },
      { slot: 'ring', label: 'Ring' },
      { slot: 'amulet', label: 'Amulet' },
      { slot: 'bracelet', label: 'Bracelet' },
    ];

    for (const { slot, label } of slots) {
      const itemId = player.equipment?.[slot];
      const cell = document.createElement('div');
      cell.className = `doll-slot${itemId ? ' filled' : ''}`;
      cell.dataset.slot = slot;

      if (itemId) {
        const item = getItem(itemId);
        cell.style.borderColor = QUALITY_COLORS[item.quality];
        cell.innerHTML =
          `<div class="doll-label">${label}</div>` +
          `<div class="doll-name" style="color:${QUALITY_COLORS[item.quality]}">${item.name}</div>`;
        cell.title = describeItem(itemId);
        cell.draggable = true;
        cell.addEventListener('dragstart', (e) => {
          e.dataTransfer?.setData('text/plain', `unequip:${slot}`);
          cell.classList.add('dragging');
        });
        cell.addEventListener('dragend', () => cell.classList.remove('dragging'));
        cell.addEventListener('click', () => {
          this.emit({ t: 'unequip', slot });
          this.renderInventory();
        });
      } else {
        cell.innerHTML = `<div class="doll-label">${label}</div><div class="doll-empty">empty</div>`;
        cell.title = `Nothing on your ${label.toLowerCase()}`;
      }

      // Every slot accepts a drop, filled or not — swapping a worn piece for a
      // better one is the commonest thing anybody does in here.
      cell.addEventListener('dragover', (e) => {
        if (!this.dragItemId) return;
        const dragged = getItem(this.dragItemId);
        if (dragged.slot !== slot || !canEquip(dragged, player.classId)) return;
        e.preventDefault();
        cell.classList.add('drop-target');
      });
      cell.addEventListener('dragleave', () => cell.classList.remove('drop-target'));
      cell.addEventListener('drop', (e) => {
        e.preventDefault();
        cell.classList.remove('drop-target');
        const payload = e.dataTransfer?.getData('text/plain') ?? '';
        if (!payload.startsWith('equip:')) return;
        const itemId = payload.slice('equip:'.length);
        const dragged = getItem(itemId);
        if (dragged.slot !== slot || !canEquip(dragged, player.classId)) return;
        this.emit({ t: 'equip', itemId });
        this.renderInventory();
      });

      doll.appendChild(cell);
    }
    return doll;
  }

  /** One square in the bag. */
  private buildBagSlot(player: Entity, stack: ItemStack): HTMLElement {
    const item = getItem(stack.itemId);
    const usable = canEquip(item, player.classId);
    const wearable = !!item.slot && item.slot !== 'none' && usable;
    const drinkable = !!item.consumable;
    const taught = item.teaches ? getSkill(item.teaches) : null;
    const known = taught ? (player.learnedSkills ?? []).includes(taught.id) : false;
    const learnable = !!taught && usable && !known && player.level >= taught.reqLevel;

    const cell = document.createElement('div');
    cell.className = `bag-slot${usable ? '' : ' unusable'}`;
    cell.style.borderColor = QUALITY_COLORS[item.quality];

    // Is anything you are carrying this for? A collection grind is a lot
    // easier to read when the bag itself says 4/6.
    const wanted = (player.quests ?? [])
      .map((q) => ({ quest: getQuest(q.questId), progress: q }))
      .flatMap(({ quest, progress }) =>
        quest.objectives.map((o, i) => ({ o, have: progress.counts[i] ?? 0 })),
      )
      .find(({ o }) => o.kind === 'collect' && o.itemId === stack.itemId);

    let tag = '';
    if ((item.slot || taught) && !usable) tag = `<span class="locked-class">${item.classes?.join('/')}</span>`;
    else if (taught) tag = known ? 'known' : learnable ? 'learn' : `Lv ${taught.reqLevel}`;
    else if (wanted && wanted.o.kind === 'collect') {
      const have = Math.min(wanted.have, wanted.o.count);
      tag = `<span class="${have >= wanted.o.count ? 'quest-have' : 'quest-want'}">${have}/${wanted.o.count}</span>`;
    } else if (drinkable) tag = 'drink';
    else if (item.slot && item.slot !== 'none') tag = item.slot;
    else tag = `${item.value}g`;

    cell.innerHTML =
      `<div class="bag-name" style="color:${QUALITY_COLORS[item.quality]}">${item.name}</div>` +
      `<div class="bag-foot"><span class="muted">${tag}</span>` +
      `${stack.qty > 1 ? `<span class="bag-qty">${stack.qty}</span>` : ''}</div>`;
    cell.title = describeItem(stack.itemId);

    if (wearable) {
      cell.draggable = true;
      cell.classList.add('clickable');
      cell.addEventListener('dragstart', (e) => {
        this.dragItemId = stack.itemId;
        e.dataTransfer?.setData('text/plain', `equip:${stack.itemId}`);
        cell.classList.add('dragging');
        // Light up the slot it belongs in, so a player who has not read a
        // tooltip still knows where it goes.
        this.root
          .querySelectorAll(`.doll-slot[data-slot="${item.slot}"]`)
          .forEach((el) => el.classList.add('wants'));
      });
      cell.addEventListener('dragend', () => {
        this.dragItemId = null;
        cell.classList.remove('dragging');
        this.root.querySelectorAll('.doll-slot.wants').forEach((el) => el.classList.remove('wants'));
      });
      cell.addEventListener('click', () => {
        this.emit({ t: 'equip', itemId: stack.itemId });
        this.renderInventory();
      });
    } else if (learnable) {
      cell.classList.add('clickable');
      cell.addEventListener('click', () => {
        this.emit({ t: 'learnSkill', itemId: stack.itemId });
        this.renderInventory();
      });
    } else if (drinkable) {
      cell.classList.add('clickable');
      cell.addEventListener('click', () => {
        this.emit({ t: 'use', itemId: stack.itemId });
        this.renderInventory();
      });
    }
    return cell;
  }
}

/**
 * "three days", "four hours". Rounded hard on purpose: the number that matters
 * is how much of the world moved, not that you were gone 3h 47m.
 */
function describeSpan(ms: number): string {
  const hours = ms / 3600000;
  if (hours < 1) return `${Math.max(1, Math.round(ms / 60000))} minutes`;
  if (hours < 48) return `${Math.round(hours)} hours`;
  return `${Math.round(hours / 24)} days`;
}

/** #rrggbb for a faction colour. */
function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function bandClass(band: StandingBand): string {
  if (band === 'hated' || band === 'hostile') return 'band-bad';
  if (band === 'wary') return 'band-wary';
  if (band === 'neutral') return 'band-neutral';
  return 'band-good';
}

/**
 * Everything an item does, as a block a player can read.
 *
 * Every field the sim reads gets a line. An item whose tooltip lists three of
 * its six properties is worse than no tooltip: it teaches the player that the
 * numbers here are not the numbers, and then they stop reading it.
 */
function describeItem(itemId: string): string {
  const item = getItem(itemId);
  const lines: string[] = [`${item.name} — ${item.quality}${item.slot && item.slot !== 'none' ? `, ${item.slot}` : ''}`];
  if (item.reqLevel) lines.push(`Requires level ${item.reqLevel}`);
  if (item.classes) lines.push(`${item.classes.join(' / ')} only`);

  if (item.damageMin !== undefined) {
    const swing = (item.swingMs ?? 2000) / 1000;
    const dps = ((item.damageMin + (item.damageMax ?? item.damageMin)) / 2 / swing).toFixed(1);
    lines.push(`${item.damageMin}–${item.damageMax} damage, ${swing.toFixed(2)}s swing (${dps}/s)`);
    if (item.attackRange) lines.push(`${item.attackRange}m reach`);
  }
  if (item.armor) lines.push(`+${item.armor} armour`);
  for (const [k, v] of Object.entries(item.attributes ?? {})) {
    lines.push(`+${v} ${k[0]!.toUpperCase()}${k.slice(1)}`);
  }
  if (item.damageBonus) lines.push(`+${item.damageBonus} damage on every swing`);
  if (item.healthBonus) lines.push(`+${item.healthBonus} health`);
  if (item.critBonus) lines.push(`+${(item.critBonus * 100).toFixed(1)}% critical chance`);
  if (item.moveSpeedBonus) lines.push(`+${item.moveSpeedBonus} movement speed`);
  if (item.regenBonus) lines.push(`+${item.regenBonus} health per second`);
  if (item.skillPower) {
    lines.push(`Skills hit ${Math.round((item.skillPower - 1) * 100)}% harder`);
  }

  const c = item.consumable;
  if (c) {
    if (c.healPercent) lines.push(`Restores ${Math.round(c.healPercent * 100)}% of your health`);
    if (c.regen) lines.push(`+${c.regen.perSec} health a second for ${c.regen.seconds}s`);
    if (c.damageMultiplier) lines.push(`+${Math.round((c.damageMultiplier - 1) * 100)}% damage, 45s`);
    if (c.defenseBonus) lines.push(`+${c.defenseBonus} defence, 45s`);
    lines.push(c.family === 'potion' ? 'Potion — 18s between draughts' : 'Elixir — 2 minutes between');
  }

  if (item.teaches) {
    const skill = getSkill(item.teaches);
    lines.push(`Teaches ${skill.name} at level ${skill.reqLevel}`);
    lines.push(skill.description);
  }
  if (item.flavor) lines.push(item.flavor);
  lines.push(`Worth ${item.value.toLocaleString()}g`);
  return lines.join('\n');
}

function setBar(fill: HTMLElement, value: number, max: number): void {
  fill.style.width = `${Math.max(0, Math.min(1, value / max)) * 100}%`;
}

const TEMPLATE = `
  <div id="overlays"></div>

  <div id="player-frame" class="frame panel">
    <div class="frame-name"><span id="player-name"></span><span id="player-level" class="frame-level"></span></div>
    <div id="player-hp" class="bar bar-hp"><div class="bar-fill"></div><div class="bar-label"></div></div>
    <div id="player-energy" class="bar bar-energy"><div class="bar-fill"></div><div class="bar-label"></div></div>
  </div>

  <div id="target-frame" class="frame panel">
    <div class="frame-name"><span id="target-name"></span><span id="target-level" class="frame-level"></span></div>
    <div id="target-hp" class="bar bar-hp"><div class="bar-fill"></div><div class="bar-label"></div></div>
  </div>

  <div id="cast-bar" class="bar panel"><div class="bar-fill"></div><div class="bar-label"></div></div>

  <div id="telegraph-banner"></div>

  <div id="skill-bar"></div>

  <div id="xp-bar" class="bar panel"><div class="bar-fill"></div><div id="xp-debt"></div><div class="bar-label"></div></div>
  <div id="xp-level"></div>

  <div id="tracker">
    <div id="tracker-head"></div>
    <div id="tracker-body"></div>
    <div id="tracker-where"><span id="tracker-arrow">➤</span><span id="tracker-dist"></span></div>
  </div>

  <div id="log"></div>

  <div id="right-panels">
    <div id="character-window" class="window panel clickable">
      <h3>Character</h3>
      <div id="character-body"></div>
    </div>

    <div id="inventory-window" class="window panel clickable">
      <h3>Inventory</h3>
      <div id="inventory-body"></div>
    </div>
  </div>

  <div id="zone-banner"></div>

  <div id="away-report" class="panel clickable">
    <h3><span id="away-title"></span><span id="away-close">✕</span></h3>
    <div id="away-body"></div>
  </div>

  <div id="travel-prompt"></div>

  <div id="realm-window" class="window panel clickable">
    <h3>The Realm</h3>
    <div id="realm-body"></div>
  </div>

  <div id="quest-log" class="window panel clickable">
    <h3>Quest Log</h3>
    <div id="quest-log-body"></div>
  </div>

  <div id="vendor-window" class="panel clickable">
    <h3><span id="vendor-name"></span><span id="vendor-close">✕</span></h3>
    <div id="vendor-greeting"></div>
    <div id="vendor-quests"></div>
    <div id="vendor-cols">
      <div>
        <div class="vendor-col-head">For sale</div>
        <div id="vendor-stock"></div>
      </div>
      <div>
        <div class="vendor-col-head">Your bags <span id="vendor-gold"></span></div>
        <div id="vendor-bags"></div>
      </div>
    </div>
  </div>

  <div id="volume-toast"><span id="volume-icon"></span><span id="volume-bar"></span></div>

  <div id="death-overlay">
    <h2>YOU DIED</h2>
    <p id="death-cost"></p>
    <button id="respawn-btn" class="clickable">Return to the standing stones</button>
  </div>

  <div id="help">
    <b>WASD</b> move &nbsp; <b>Drag</b> or <b>←→</b> look &nbsp; <b>Scroll</b> zoom<br />
    <b>Click</b> / <b>Tab</b> target &nbsp; <b>1–0</b> / <b>⇧1–6</b> skills &nbsp; <b>T</b> auto-attack<br />
    <b>F</b> loot &nbsp; <b>E</b> trade &nbsp; <b>G</b> travel &nbsp; <b>J</b> quests<br />
    <b>H</b> take horse &nbsp; <b>R</b> ride &nbsp; <b>K</b> realm &nbsp; <b>M</b> map &nbsp; <b>V</b> reclaim &nbsp; <b>N</b> mute &nbsp; <b>[ ]</b> volume &nbsp; <b>C</b> character &nbsp; <b>I</b> inventory &nbsp; <b>Esc</b> clear target
  </div>
`;
