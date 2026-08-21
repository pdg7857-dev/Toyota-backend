import * as THREE from 'three';
import type { Command, EntityId } from '../sim/types.js';
import type { World } from '../sim/world.js';
import type { Hud } from './hud.js';
import type { SceneRig } from './scene.js';

const LOOT_RANGE = 4.5;

/** Must match VENDOR_RANGE in the sim, or the UI offers trades it will refuse. */
const VENDOR_RANGE = 5.5;

/**
 * Translates raw browser input into sim Commands. Nothing here touches world
 * state — it only ever calls `emit`.
 */
export class InputController {
  private keys = new Set<string>();
  private lastMove = { x: 0, z: 0 };
  private dragging = false;
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
  ) {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointerup', () => {
      this.dragging = false;
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
      case 'Digit7': {
        const skillId = this.hud.skillForSlot(Number(e.code.slice(5)) - 1);
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
      case 'KeyC':
        this.hud.toggleCharacter();
        break;
      case 'KeyI':
        this.hud.toggleInventory();
        break;
      case 'Escape':
        // Close the shop first — Esc should back out one layer at a time.
        if (this.hud.vendorOpen) this.hud.closeVendor();
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

    this.pointer.set(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1,
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
      else this.emit({ t: 'autoAttack', on: true });
      return;
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.dragging) return;
    this.rig.yaw -= e.movementX * 0.005;
    this.rig.pitch = Math.max(0.15, Math.min(1.35, this.rig.pitch + e.movementY * 0.004));
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.rig.distance = Math.max(5, Math.min(30, this.rig.distance + e.deltaY * 0.012));
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
    if (best !== null) this.emit({ t: 'loot', id: best });
  }

  /**
   * Emit a movement command when the intent changes. Direction is camera-
   * relative, which is what makes WASD feel right in a third-person orbit view.
   */
  update(): void {
    let forward = 0;
    let strafe = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) forward += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) forward -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) strafe -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) strafe += 1;

    const sin = Math.sin(this.rig.yaw);
    const cos = Math.cos(this.rig.yaw);
    const x = forward * sin + strafe * cos;
    const z = forward * cos - strafe * sin;

    if (Math.abs(x - this.lastMove.x) < 1e-6 && Math.abs(z - this.lastMove.z) < 1e-6) return;
    this.lastMove = { x, z };
    this.emit({ t: 'move', dir: { x, z } });
  }
}
