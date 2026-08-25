import * as THREE from 'three';
import { getMob } from '../content/mobs.js';
import type { Command, EntityId } from '../sim/types.js';
import type { World } from '../sim/world.js';
import type { Hud } from './hud.js';
import type { MapView } from './map.js';
import type { GameAudio } from './audio.js';
import type { SceneRig } from './scene.js';

const LOOT_RANGE = 4.5;

/**
 * How close a creature has to be before the game selects it for you.
 *
 * Deliberately shorter than the Tab-cycle range: Tab is "show me what is out
 * there", and this is "you are standing in a camp". A generous auto-select
 * range on a map this size means the reticle jumps to something over a hill.
 */
const AUTO_TARGET_RANGE = 22;

/** How far the arrow keys swing the camera per tick. A full turn takes about a second. */
const CAMERA_TURN_PER_TICK = 0.055;

/** Must match VENDOR_RANGE in the sim, or the UI offers trades it will refuse. */
const VENDOR_RANGE = 5.5;

/**
 * Translates raw browser input into sim Commands. Nothing here touches world
 * state — it only ever calls `emit`.
 */
/** Slot index the second hotkey row starts at — Shift+1 is the eleventh skill. */
const SECOND_ROW_START = 10;

export class InputController {
  private keys = new Set<string>();
  private lastMove = { x: 0, z: 0 };
  private dragging = false;
  /** Where a left press started, and whether it has travelled far enough to be a look. */
  private dragStart: { x: number; y: number } | null = null;
  private dragged = false;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  /** Index into the sorted hostile list, for Tab cycling. */
  private tabIndex = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly world: World,
    private readonly rig: SceneRig,
    private readonly hud: Hud,
    private readonly emit: (cmd: Command) => void,
    private readonly map: MapView,
    private readonly audio: GameAudio,
  ) {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointerup', (e) => {
      const wasDrag = this.dragged;
      this.dragging = false;
      this.dragged = false;
      // A left press that did not travel is a click, and a click selects.
      if (e.button === 0 && !wasDrag && this.dragStart) this.selectAt(e.clientX, e.clientY);
      this.dragStart = null;
    });
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
  }

  private onKeyDown(e: KeyboardEvent): void {
    // Let the browser have its own shortcuts; only claim keys we actually use.
    if (e.code === 'Tab') e.preventDefault();
    if (this.keys.has(e.code)) return; // ignore auto-repeat
    this.keys.add(e.code);

    switch (e.code) {
      case 'Digit1':
      case 'Digit2':
      case 'Digit3':
      case 'Digit4':
      case 'Digit5':
      case 'Digit6':
      case 'Digit7':
      case 'Digit8':
      case 'Digit9':
      case 'Digit0': {
        // 1-9 then 0 fire the first row; holding shift reaches the second,
        // which is where a zone's taught skills land.
        const digit = Number(e.code.slice(5));
        const slot = digit === 0 ? 9 : digit - 1;
        const skillId = this.hud.skillForSlot(e.shiftKey ? SECOND_ROW_START + slot : slot);
        if (skillId) this.emit({ t: 'useSkill', skillId });
        break;
      }
      case 'Tab':
        this.cycleTarget();
        break;
      case 'KeyT':
        this.emit({ t: 'autoAttack', on: !this.world.player.autoAttack });
        break;
      case 'KeyF':
        this.lootNearest();
        break;
      case 'KeyE':
        this.talkToNearestVendor();
        break;

      case 'KeyG':
        this.travelIfOnRoad();
        break;
      case 'KeyJ':
        this.hud.toggleQuestLog();
        break;
      case 'KeyK':
        this.hud.toggleRealm();
        break;
      case 'KeyH':
        this.captureNearestHorse();
        break;
      case 'KeyR':
        this.toggleRide();
        break;
      case 'KeyC':
        this.hud.toggleCharacter();
        break;
      case 'KeyI':
        this.hud.toggleInventory();
        break;
      case 'KeyM':
        this.map.toggle();
        break;
      case 'KeyV':
        this.emit({ t: 'reclaim' });
        break;
      case 'KeyN':
        this.hud.showVolume(this.audio.toggleMute(), this.audio.level);
        break;
      case 'BracketLeft':
        this.hud.showVolume(this.audio.isMuted, this.audio.nudge(-0.05));
        break;
      case 'BracketRight':
        this.hud.showVolume(this.audio.isMuted, this.audio.nudge(0.05));
        break;
      case 'Escape':
        // Back out one layer at a time. The away report is the outermost thing
        // on screen when it is up, so it goes first.
        if (this.hud.awayReportOpen) this.hud.hideAwayReport();
        else if (this.map.isOpen) this.map.close();
        else if (this.hud.vendorOpen) this.hud.closeVendor();
        else this.emit({ t: 'target', id: null });
        break;
    }
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button === 2) {
      this.dragging = true;
      return;
    }
    if (e.button !== 0) return;

    // Left-drag looks around too. Right-drag alone meant a player on a laptop
    // trackpad, or anybody who simply did not think to try it, could only ever
    // face the way they were pointed — and on a map three kilometres across,
    // "I cannot look around" is not a control problem, it is not being able to
    // see the game. The click still targets: `onPointerUp` only treats it as a
    // click if the pointer did not actually travel.
    this.dragging = true;
    this.dragStart = { x: e.clientX, y: e.clientY };
    this.dragged = false;

  }

  /**
   * Select whatever is under the cursor.
   *
   * Split out of the press handler because a press is now ambiguous until it
   * ends: the same button looks around and selects, and which one it was is
   * only knowable once you see whether the pointer moved.
   */
  private selectAt(clientX: number, clientY: number): void {
    this.pointer.set(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.rig.camera);
    const hits = this.raycaster.intersectObjects(this.rig.scene.children, true);
    for (const hit of hits) {
      const id = hit.object.userData.entityId as EntityId | undefined;
      if (id === undefined || id === this.world.playerId) continue;
      const entity = this.world.entity(id);

      if (entity?.kind === 'vendor') {
        this.hud.openVendor(id);
        return;
      }
      this.emit({ t: 'target', id });
      // Clicking a corpse in range loots it — one less keypress in the common case.
      if (entity?.dead) this.lootNearest();
      // Clicking another adventurer selects them and stops there. Swinging at
      // somebody the sim will never let you hurt is the click that makes the
      // whole population read as broken scenery.
      else if (entity?.kind !== 'npc') this.emit({ t: 'autoAttack', on: true });
      return;
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.dragging) return;
    // A few pixels of travel is a shaky click, not a look.
    if (Math.abs(e.movementX) + Math.abs(e.movementY) > 1) this.dragged = true;
    this.rig.yaw -= e.movementX * 0.005;
    this.rig.pitch = Math.max(0.15, Math.min(1.35, this.rig.pitch + e.movementY * 0.004));
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.rig.distance = Math.max(5, Math.min(30, this.rig.distance + e.deltaY * 0.012));
  }

  /**
   * Pick a target, and fight back when something picks you.
   *
   * Runs every tick. Two separate rules, and they are not the same feature:
   *
   *  - **Auto-select** fills an *empty* selection with the nearest hostile. It
   *    never overrides a target you chose — a targeting system that argues with
   *    you is worse than one that does nothing.
   *  - **Auto-attack** turns itself on when something is actually fighting you.
   *    "A battle has started" means a creature has decided you are its target;
   *    standing there not swinging because you had not pressed T is not a
   *    decision anybody makes on purpose.
   *
   * Horses and the other adventurers are excluded from both. Auto-selecting the
   * mount you are trying to capture, and then auto-attacking it, would undo the
   * one mechanic in the game that asks you to stop hitting something.
   */
  private autoEngage(): void {
    const player = this.world.player;
    if (player.dead) return;

    let attacker: EntityId | null = null;
    let nearest: EntityId | null = null;
    let nearestDist = AUTO_TARGET_RANGE;

    for (const e of this.world.entities.values()) {
      if (e.kind !== 'mob' || e.dead) continue;
      if (getMob(e.defId!).horse) continue;
      const d = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z);
      // Whatever is already swinging at you outranks whatever is closest.
      if (e.targetId === player.id && (attacker === null || d < nearestDist)) attacker = e.id;
      if (d < nearestDist) {
        nearestDist = d;
        nearest = e.id;
      }
    }

    const current = player.targetId === null ? null : this.world.entity(player.targetId);
    // A target is stale when it is gone or dead, and not before. It used to
    // count anything that was not a mob, which meant clicking on another
    // adventurer to read their name and having auto-select yank the selection
    // onto a wolf walking past — the game arguing with something you just did.
    const stale = !current || current.dead;
    const pick = attacker ?? nearest;
    if (stale && pick !== null && pick !== player.targetId) {
      this.emit({ t: 'target', id: pick });
    }
    // "A battle has started" is either direction: something has decided you
    // are its target, or blows have already been exchanged. Standing there not
    // swinging because you had not pressed T is not a decision anybody makes
    // on purpose.
    const fighting = attacker !== null || this.world.inCombat(player.id);
    if (fighting && !player.autoAttack && player.targetId !== null) {
      this.emit({ t: 'autoAttack', on: true });
    }
  }

  /** Target the next-nearest living hostile, wrapping around. */
  private cycleTarget(): void {
    const player = this.world.player;
    const candidates = [...this.world.entities.values()]
      .filter((e) => e.kind === 'mob' && !e.dead)
      .map((e) => ({
        e,
        d: Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z),
      }))
      .filter((c) => c.d < 45)
      .sort((a, b) => a.d - b.d);

    if (candidates.length === 0) return;
    // If the current target is in the list, step past it; otherwise start at nearest.
    const currentIdx = candidates.findIndex((c) => c.e.id === player.targetId);
    this.tabIndex = currentIdx >= 0 ? (currentIdx + 1) % candidates.length : 0;
    this.emit({ t: 'target', id: candidates[this.tabIndex]!.e.id });
  }

  /** Open the shop for the closest trader in reach. */
  private talkToNearestVendor(): void {
    if (this.hud.vendorOpen) {
      this.hud.closeVendor();
      return;
    }
    const player = this.world.player;
    let best: EntityId | null = null;
    let bestDist = VENDOR_RANGE;
    for (const e of this.world.entities.values()) {
      if (e.kind !== 'vendor') continue;
      const d = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z);
      if (d <= bestDist) {
        bestDist = d;
        best = e.id;
      }
    }
    if (best !== null) this.hud.openVendor(best);
  }

  /** Take the road out, if standing on one. */
  private travelIfOnRoad(): void {
    const exit = this.world.exitInReach(this.world.player);
    if (exit) this.emit({ t: 'travel', toZoneId: exit.toZoneId });
  }

  /**
   * Grab the nearest worn-down horse.
   *
   * Targeting it first would work too, but a player who has just spent a
   * minute carefully NOT killing something should not then have to click it.
   */
  private captureNearestHorse(): void {
    const player = this.world.player;
    let best: EntityId | null = null;
    let bestDist = Infinity;
    for (const e of this.world.entities.values()) {
      if (e.kind !== 'mob' || e.dead || !getMob(e.defId!).horse) continue;
      const d = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z);
      if (d < bestDist) {
        bestDist = d;
        best = e.id;
      }
    }
    if (best !== null) this.emit({ t: 'capture', id: best });
  }

  /** Get on the last horse you caught, or off the one you are on. */
  private toggleRide(): void {
    const player = this.world.player;
    if (player.mounted) {
      this.emit({ t: 'mount', mountId: null });
      return;
    }
    const stable = player.stable ?? [];
    if (stable.length > 0) this.emit({ t: 'mount', mountId: stable[stable.length - 1]! });
  }

  private lootNearest(): void {
    const player = this.world.player;
    let best: EntityId | null = null;
    let bestDist = LOOT_RANGE;
    for (const e of this.world.entities.values()) {
      if (!e.dead || e.kind !== 'mob') continue;
      if ((e.corpseLoot?.length ?? 0) === 0 && (e.corpseGold ?? 0) === 0) continue;
      const d = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z);
      if (d <= bestDist) {
        bestDist = d;
        best = e.id;
      }
    }
    if (best !== null) {
      this.emit({ t: 'loot', id: best });
      return;
    }
    // One key, one meaning: take what is here. A separate key for searching a
    // cairn would be a fifteenth line in the help strip for something a player
    // does twice an hour, and the two can never both apply — you are either
    // standing on a corpse or you are not.
    this.emit({ t: 'search' });
  }

  /**
   * Emit a movement command when the intent changes. Direction is camera-
   * relative, which is what makes WASD feel right in a third-person orbit view.
   */
  update(): void {
    this.autoEngage();

    // The arrow keys turn the camera rather than strafing, which is the older
    // and better half of the WASD-plus-arrows convention: WASD walks relative
    // to where you are looking, and the arrows decide where that is. Looking
    // around never needs a mouse at all.
    if (this.keys.has('ArrowLeft')) this.rig.yaw += CAMERA_TURN_PER_TICK;
    if (this.keys.has('ArrowRight')) this.rig.yaw -= CAMERA_TURN_PER_TICK;

    let forward = 0;
    let strafe = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) forward += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) forward -= 1;
    if (this.keys.has('KeyA')) strafe -= 1;
    if (this.keys.has('KeyD')) strafe += 1;

    // Camera-relative basis. Forward is where the camera looks, (sin, cos);
    // screen-right is that crossed with up, which is (-cos, sin) — NOT
    // (cos, -sin). Getting the sign wrong here is invisible in a screenshot
    // and unmistakable the moment you press D and walk left.
    const sin = Math.sin(this.rig.yaw);
    const cos = Math.cos(this.rig.yaw);
    const x = forward * sin - strafe * cos;
    const z = forward * cos + strafe * sin;

    if (Math.abs(x - this.lastMove.x) < 1e-6 && Math.abs(z - this.lastMove.z) < 1e-6) return;
    this.lastMove = { x, z };
    this.emit({ t: 'move', dir: { x, z } });
  }
}
