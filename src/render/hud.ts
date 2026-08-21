import * as THREE from 'three';
import { getSkill, skillBarFor } from '../content/skills.js';
import { QUALITY_COLORS, canEquip, getItem } from '../content/items.js';
import { getMob } from '../content/mobs.js';
import { buyPrice, getVendor, sellPrice } from '../content/vendors.js';
import { xpToNext } from '../sim/formulas.js';
import { BOSS_STARS, ELITE_BOSS_STARS } from '../sim/types.js';
import type { Attributes, Command, Entity, EntityId, SimEvent } from '../sim/types.js';
import type { World } from '../sim/world.js';

const MAX_LOG_LINES = 9;
/**
 * How far away a mob can be and still show a nameplate, in world units.
 *
 * Kept tight on purpose. Camps are dense so the grind has throughput, which
 * means a generous plate range buries the screen in labels — the plates you
 * actually need are your target, whatever is hitting you, and what is close
 * enough to pull next.
 */
const NAMEPLATE_RANGE = 13;

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
    log: HTMLElement;
    skillBar: HTMLElement;
    characterWindow: HTMLElement;
    characterBody: HTMLElement;
    inventoryWindow: HTMLElement;
    inventoryBody: HTMLElement;
    deathOverlay: HTMLElement;
    overlays: HTMLElement;
    telegraph: HTMLElement;
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

  private slots = new Map<string, { el: HTMLElement; cd: HTMLElement; name: HTMLElement }>();
  /** Hotkey order for this character's class, filled in at construction. */
  private skillOrder: string[] = [];
  private nameplates = new Map<EntityId, HTMLElement>();
  private projected = new THREE.Vector3();

  constructor(
    container: HTMLElement,
    private readonly world: World,
    private readonly emit: Emit,
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
      log: this.q('#log'),
      skillBar: this.q('#skill-bar'),
      characterWindow: this.q('#character-window'),
      characterBody: this.q('#character-body'),
      inventoryWindow: this.q('#inventory-window'),
      inventoryBody: this.q('#inventory-body'),
      deathOverlay: this.q('#death-overlay'),
      overlays: this.q('#overlays'),
      telegraph: this.q('#telegraph-banner'),
      vendorWindow: this.q('#vendor-window'),
      vendorName: this.q('#vendor-name'),
      vendorGreeting: this.q('#vendor-greeting'),
      vendorStock: this.q('#vendor-stock'),
      vendorBags: this.q('#vendor-bags'),
      vendorGold: this.q('#vendor-gold'),
    };
  }

  private buildSkillBar(): void {
    const bar = skillBarFor(this.world.player.classId ?? 'warrior');
    this.skillOrder = bar.map((s) => s.id);
    bar.forEach((skill, i) => {
      const skillId = skill.id;
      const el = document.createElement('div');
      el.className = 'slot clickable';
      el.title = `${skill.name} — ${skill.description} (${skill.energyCost} energy)`;
      el.innerHTML =
        `<span class="slot-key">${i + 1}</span>` +
        `<span class="slot-name">${skill.name}</span>` +
        `<div class="slot-cd" style="display:none"></div>`;
      el.addEventListener('click', () => this.emit({ t: 'useSkill', skillId }));
      this.els.skillBar.appendChild(el);
      this.slots.set(skillId, {
        el,
        cd: el.querySelector<HTMLElement>('.slot-cd')!,
        name: el.querySelector<HTMLElement>('.slot-name')!,
      });
    });
  }

  /** Skill id bound to a 1-5 hotkey, or null. */
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
          this.log(`You gain ${ev.amount} experience.`, 'log-xp');
          break;
        case 'levelUp':
          this.log(`You have reached level ${ev.level}!`, 'log-good');
          break;
        case 'skillUnlocked':
          this.log(`New skill learned: ${getSkill(ev.skillId).name}.`, 'log-good');
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
    const screen = this.toScreen(camera, entity.pos.x, height + 1.5, entity.pos.z);
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

    this.els.deathOverlay.style.display = player.dead ? 'flex' : 'none';

    if (this.openVendorId !== null) {
      const vendor = this.world.entity(this.openVendorId);
      const d = vendor
        ? Math.hypot(vendor.pos.x - player.pos.x, vendor.pos.z - player.pos.z)
        : Infinity;
      // Walking away ends the conversation, rather than leaving a shop open
      // across the map that would reject every click.
      if (!vendor || d > 7 || player.dead) this.closeVendor();
    }
    if (this.els.characterWindow.style.display === 'block') this.renderCharacter();
    if (this.els.inventoryWindow.style.display === 'block') this.renderInventory();
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
      (stars ? ` <span class="stars ${starClass(stars)}">${starText(stars)}</span>` : '');
    // A boss frame should be unmistakable before the fight starts.
    this.els.targetFrame.classList.toggle('is-boss', stars >= BOSS_STARS);
    setBar(this.els.targetHp, target.health, stats.maxHealth);
    this.els.targetHpLabel.textContent = `${Math.ceil(Math.max(0, target.health))} / ${stats.maxHealth}`;
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
    this.els.xpFill.style.width = `${Math.min(100, (have / need) * 100)}%`;
    this.els.xpLabel.textContent = `${have} / ${need} XP`;
  }

  private updateSkillBar(player: Entity): void {
    for (const [skillId, slot] of this.slots) {
      const skill = getSkill(skillId);
      const locked = player.level < skill.reqLevel;
      slot.el.classList.toggle('locked', locked);
      slot.el.classList.toggle('unaffordable', !locked && player.energy < skill.energyCost);
      slot.name.textContent = locked ? `Lv ${skill.reqLevel}` : skill.name;

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
      const screen = this.toScreen(camera, entity.pos.x, height + 0.35, entity.pos.z);
      const distance = Math.hypot(entity.pos.x - player.pos.x, entity.pos.z - player.pos.z);

      const lootable =
        entity.dead && ((entity.corpseLoot?.length ?? 0) > 0 || (entity.corpseGold ?? 0) > 0);

      // Plates are the noisiest thing on screen in a populated camp, and they
      // have no depth occlusion, so keep them tight: only what you are fighting,
      // what is fighting you, or what is close enough to matter.
      const relevant =
        entity.id === player.targetId ||
        entity.targetId === player.id ||
        distance < NAMEPLATE_RANGE ||
        (lootable && distance < NAMEPLATE_RANGE * 1.5);

      if (!screen || !relevant || (entity.dead && !lootable)) {
        plate.style.display = 'none';
        continue;
      }
      // Fade with distance so the near ones read as the important ones.
      plate.style.opacity = `${Math.max(0.35, Math.min(1, 1.4 - distance / NAMEPLATE_RANGE))}`;

      plate.style.display = 'block';
      plate.style.left = `${screen.x}px`;
      plate.style.top = `${screen.y}px`;
      plate.classList.toggle('dead', entity.dead);
      plate.classList.toggle('lootable', lootable);

      const stars = def?.stars ?? 0;
      const name = plate.querySelector<HTMLElement>('.np-name')!;
      if (lootable) {
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

    const screen = this.toScreen(camera, entity.pos.x, 2.9, entity.pos.z);
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
    info.innerHTML = `<span>Unspent points</span><span class="v">${points}</span>`;
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
  }

  private renderInventory(): void {
    const player = this.world.player;
    const body = this.els.inventoryBody;
    body.innerHTML = '';

    const equipped = Object.entries(player.equipment ?? {}).filter(([, id]) => id);
    const head = document.createElement('div');
    head.className = 'muted';
    head.style.cssText = 'font-size:10px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px';
    head.textContent = 'Equipped';
    body.appendChild(head);

    if (equipped.length === 0) {
      const none = document.createElement('div');
      none.className = 'empty';
      none.textContent = 'Nothing equipped';
      body.appendChild(none);
    }
    for (const [slot, itemId] of equipped) {
      const item = getItem(itemId!);
      const row = document.createElement('div');
      row.className = 'inv-row clickable';
      row.innerHTML =
        `<span style="color:${QUALITY_COLORS[item.quality]}">${item.name}</span>` +
        `<span class="equipped">${slot} ✕</span>`;
      row.title = 'Click to unequip';
      row.addEventListener('click', () => {
        this.emit({ t: 'unequip', slot: slot as never });
        this.renderInventory();
      });
      body.appendChild(row);
    }

    const sep = document.createElement('div');
    sep.className = 'muted';
    sep.style.cssText =
      'font-size:10px;text-transform:uppercase;letter-spacing:.5px;margin:9px 0 3px;' +
      'border-top:1px solid rgba(190,168,110,.28);padding-top:7px';
    sep.textContent = `Bags — ${player.gold ?? 0} gold`;
    body.appendChild(sep);

    const inv = player.inventory ?? [];
    if (inv.length === 0) {
      const none = document.createElement('div');
      none.className = 'empty';
      none.textContent = 'Your bags are empty';
      body.appendChild(none);
      return;
    }
    for (const stack of inv) {
      const item = getItem(stack.itemId);
      const usable = canEquip(item, player.classId);
      const row = document.createElement('div');
      row.className = `inv-row${item.slot && usable ? ' clickable' : ''}${usable ? '' : ' unusable'}`;

      // Right-hand tag: the slot, or why you can't use it, or its vendor value.
      let tag: string;
      if (item.slot && !usable) tag = `<span class="locked-class">${item.classes?.join('/')} only</span>`;
      else if (item.slot) tag = item.slot;
      else tag = `${item.value}g`;

      row.innerHTML =
        `<span style="color:${QUALITY_COLORS[item.quality]}">${item.name}` +
        `${stack.qty > 1 ? ` <span class="muted">x${stack.qty}</span>` : ''}</span>` +
        `<span class="muted">${tag}</span>`;

      if (item.slot && usable) {
        row.title = `Click to equip — ${describeItem(stack.itemId)}`;
        row.addEventListener('click', () => {
          this.emit({ t: 'equip', itemId: stack.itemId });
          this.renderInventory();
        });
      } else {
        row.title = describeItem(stack.itemId);
      }
      body.appendChild(row);
    }
  }
}

function describeItem(itemId: string): string {
  const item = getItem(itemId);
  const parts: string[] = [];
  if (item.damageMin !== undefined) {
    parts.push(`${item.damageMin}–${item.damageMax} dmg, ${(item.swingMs ?? 2000) / 1000}s swing`);
  }
  if (item.armor) parts.push(`${item.armor} armour`);
  for (const [k, v] of Object.entries(item.attributes ?? {})) parts.push(`+${v} ${k}`);
  parts.push(`worth ${item.value}g`);
  return parts.join(', ');
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

  <div id="xp-bar" class="bar panel"><div class="bar-fill"></div><div class="bar-label"></div></div>

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

  <div id="vendor-window" class="panel clickable">
    <h3><span id="vendor-name"></span><span id="vendor-close">✕</span></h3>
    <div id="vendor-greeting"></div>
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

  <div id="death-overlay">
    <h2>YOU DIED</h2>
    <button id="respawn-btn" class="clickable">Return to the standing stones</button>
  </div>

  <div id="help">
    <b>WASD</b> move &nbsp; <b>Right-drag</b> look &nbsp; <b>Scroll</b> zoom<br />
    <b>Click</b> / <b>Tab</b> target &nbsp; <b>1–7</b> skills &nbsp; <b>T</b> auto-attack<br />
    <b>F</b> loot &nbsp; <b>E</b> trade &nbsp; <b>C</b> character &nbsp; <b>I</b> inventory &nbsp; <b>Esc</b> clear target
  </div>
`;
