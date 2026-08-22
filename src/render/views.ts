import * as THREE from 'three';
import { AnimStateMachine } from './anim.js';
import { CLASSES } from '../content/zone.js';
import { getMob } from '../content/mobs.js';
import { getVendor } from '../content/vendors.js';
import type { Entity, EntityId } from '../sim/types.js';
import type { World } from '../sim/world.js';

/**
 * One visual representation per sim entity.
 *
 * Views hold *no* gameplay state. They read the sim each frame and interpolate
 * between the last two tick positions, which is exactly what a network client
 * does with snapshots — so this loop already has the right shape for multiplayer.
 */
export class EntityView {
  readonly group = new THREE.Group();
  readonly anim: AnimStateMachine;
  /** Inner node the animator transforms, so group position stays authoritative. */
  private readonly body = new THREE.Group();
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly selectionRing: THREE.Mesh;

  prev = new THREE.Vector3();
  next = new THREE.Vector3();
  prevFacing = 0;
  nextFacing = 0;

  /** Seconds of red flash remaining after taking damage. */
  private flash = 0;
  /** Overhead "interact with me" marker; vendors only. */
  private marker: THREE.Mesh | null = null;

  constructor(
    readonly id: EntityId,
    entity: Entity,
    /**
     * Ground height under a world position. The sim is flat — this is the only
     * thing that puts an entity on a hill rather than through it.
     */
    private readonly groundAt: (x: number, z: number) => number,
  ) {
    const view =
      entity.kind === 'mob'
        ? getMob(entity.defId!).view
        : entity.kind === 'vendor'
          ? getVendor(entity.vendorId!).view
          : { color: CLASSES[entity.classId ?? 'warrior'].color, height: 1.8, radius: 0.42 };

    const geo = new THREE.CapsuleGeometry(view.radius, Math.max(0.1, view.height - view.radius * 2), 4, 12);
    this.material = new THREE.MeshStandardMaterial({ color: view.color, roughness: 0.7, metalness: 0.05 });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.castShadow = true;
    this.mesh.position.y = view.height / 2;

    // Facing wedge — with capsules there is otherwise no way to read direction.
    const noseGeo = new THREE.ConeGeometry(view.radius * 0.42, view.radius * 1.5, 8);
    noseGeo.rotateX(Math.PI / 2);
    const nose = new THREE.Mesh(noseGeo, this.material);
    nose.position.set(0, view.height * 0.62, view.radius * 1.05);
    nose.castShadow = true;

    this.body.add(this.mesh, nose);
    this.group.add(this.body);

    const ringGeo = new THREE.RingGeometry(view.radius * 1.3, view.radius * 1.6, 24);
    ringGeo.rotateX(-Math.PI / 2);
    this.selectionRing = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: 0xffcc44, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.selectionRing.position.y = 0.03;
    this.selectionRing.visible = false;
    this.group.add(this.selectionRing);

    if (entity.kind === 'vendor') {
      // A slowly turning gold marker overhead: the only thing on screen that
      // says "walk here and press E".
      const markerGeo = new THREE.OctahedronGeometry(0.28, 0);
      this.marker = new THREE.Mesh(
        markerGeo,
        new THREE.MeshBasicMaterial({ color: 0xf0c94c, transparent: true, opacity: 0.95 }),
      );
      this.marker.position.y = view.height + 0.9;
      this.group.add(this.marker);
    }

    this.anim = new AnimStateMachine(this.body, view.height);

    // Tag every descendant so a click raycast can resolve back to an entity.
    this.group.userData.entityId = id;
    this.group.traverse((o) => {
      o.userData.entityId = id;
    });

    this.prev.set(entity.pos.x, this.groundAt(entity.pos.x, entity.pos.z), entity.pos.z);
    this.next.copy(this.prev);
    this.group.position.copy(this.prev);
  }

  /** Called once per sim tick: last tick's target becomes this tick's origin. */
  pushTick(entity: Entity): void {
    this.prev.copy(this.next);
    this.next.set(entity.pos.x, this.groundAt(entity.pos.x, entity.pos.z), entity.pos.z);
    this.prevFacing = this.nextFacing;
    this.nextFacing = entity.facing;
    const dx = this.next.x - this.prev.x;
    const dz = this.next.z - this.prev.z;
    this.anim.setMoving(dx * dx + dz * dz > 0.0004);
  }

  onDamaged(): void {
    this.flash = 0.18;
    this.anim.request('hit');
  }

  /** `alpha` is the fraction of the way through the current sim tick. */
  update(alpha: number, dtMs: number, selected: boolean, baseColor: number): void {
    this.group.position.lerpVectors(this.prev, this.next, alpha);
    this.group.rotation.y = lerpAngle(this.prevFacing, this.nextFacing, alpha);
    this.selectionRing.visible = selected;

    if (this.flash > 0) {
      this.flash -= dtMs / 1000;
      this.material.color.setHex(0xff5555);
    } else {
      this.material.color.setHex(baseColor);
    }
    if (this.marker) {
      this.marker.rotation.y += dtMs * 0.0022;
      this.marker.position.y += Math.sin(performance.now() * 0.0022) * 0.0025;
    }
    this.anim.update(dtMs);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/** Shortest-path angular interpolation, so facing never spins the long way. */
function lerpAngle(a: number, b: number, t: number): number {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * The danger circle drawn on the ground while a boss winds up an AoE.
 *
 * This is the entire point of telegraphed abilities: the player has to be able
 * to see the radius and judge whether they are clear of it. It fills from the
 * centre outwards over the cast so the remaining time is readable at a glance.
 */
class TelegraphRing {
  readonly group = new THREE.Group();
  private readonly fill: THREE.Mesh;
  private readonly rim: THREE.Mesh;
  private elapsed = 0;

  constructor(
    readonly sourceId: EntityId,
    readonly radius: number,
    readonly durationMs: number,
  ) {
    const fillGeo = new THREE.CircleGeometry(1, 40);
    fillGeo.rotateX(-Math.PI / 2);
    this.fill = new THREE.Mesh(
      fillGeo,
      new THREE.MeshBasicMaterial({
        color: 0xff2a1a,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      }),
    );
    this.fill.position.y = 0.05;

    const rimGeo = new THREE.RingGeometry(radius * 0.95, radius, 48);
    rimGeo.rotateX(-Math.PI / 2);
    this.rim = new THREE.Mesh(
      rimGeo,
      new THREE.MeshBasicMaterial({
        color: 0xff6a4a,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );
    this.rim.position.y = 0.06;

    this.group.add(this.fill, this.rim);
  }

  /** Returns false once the telegraph has run its course and should be removed. */
  update(dtMs: number, center: THREE.Vector3): boolean {
    this.elapsed += dtMs;
    const t = Math.min(1, this.elapsed / this.durationMs);
    // Sit on the ground under the caster. Boss arenas are levelled by the
    // height field precisely so this circle reads as a circle.
    this.group.position.set(center.x, center.y, center.z);
    this.fill.scale.setScalar(Math.max(0.001, this.radius * t));
    // Pulse faster as it approaches detonation.
    const pulse = 0.6 + 0.4 * Math.sin(this.elapsed * 0.012 * (1 + t * 2));
    (this.rim.material as THREE.MeshBasicMaterial).opacity = 0.5 + pulse * 0.45;
    // Linger briefly after resolution so the hit reads.
    return this.elapsed < this.durationMs + 160;
  }

  dispose(): void {
    this.fill.geometry.dispose();
    this.rim.geometry.dispose();
    (this.fill.material as THREE.Material).dispose();
    (this.rim.material as THREE.Material).dispose();
  }
}

/**
 * Owns the view collection and keeps it in sync with the sim's entity set.
 */
export class ViewManager {
  private views = new Map<EntityId, EntityView>();
  private telegraphs: TelegraphRing[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: World,
    private readonly groundAt: (x: number, z: number) => number = () => 0,
  ) {}

  /** Draw the danger zone for a winding-up AoE. */
  addTelegraph(sourceId: EntityId, radius: number, durationMs: number): void {
    if (radius <= 0) return;
    const ring = new TelegraphRing(sourceId, radius, durationMs);
    this.telegraphs.push(ring);
    this.scene.add(ring.group);
  }

  get all(): IterableIterator<EntityView> {
    return this.views.values();
  }

  get(id: EntityId): EntityView | undefined {
    return this.views.get(id);
  }

  /**
   * Drop every view and telegraph. Called on zone change: the entities are all
   * new and the ground under them is a different shape, so interpolating from
   * where things were is meaningless — and looks like the whole zone sliding
   * into place.
   */
  reset(): void {
    for (const view of this.views.values()) {
      this.scene.remove(view.group);
      view.dispose();
    }
    this.views.clear();
    for (const ring of this.telegraphs) {
      this.scene.remove(ring.group);
      ring.dispose();
    }
    this.telegraphs = [];
  }

  /** Create views for new entities; drop views whose entity is gone. */
  sync(): void {
    for (const entity of this.world.entities.values()) {
      if (this.views.has(entity.id)) continue;
      const view = new EntityView(entity.id, entity, this.groundAt);
      this.views.set(entity.id, view);
      this.scene.add(view.group);
    }
    for (const [id, view] of this.views) {
      if (this.world.entity(id)) continue;
      this.scene.remove(view.group);
      view.dispose();
      this.views.delete(id);
    }
  }

  pushTick(): void {
    for (const entity of this.world.entities.values()) {
      this.views.get(entity.id)?.pushTick(entity);
    }
  }

  private updateTelegraphs(dtMs: number): void {
    this.telegraphs = this.telegraphs.filter((ring) => {
      const source = this.views.get(ring.sourceId);
      const alive = source ? ring.update(dtMs, source.group.position) : false;
      if (!alive) {
        this.scene.remove(ring.group);
        ring.dispose();
      }
      return alive;
    });
  }

  update(alpha: number, dtMs: number): void {
    const targetId = this.world.player.targetId;
    for (const entity of this.world.entities.values()) {
      const view = this.views.get(entity.id);
      if (!view) continue;
      const baseColor =
        entity.kind === 'mob'
          ? getMob(entity.defId!).view.color
          : entity.kind === 'vendor'
            ? getVendor(entity.vendorId!).view.color
            : CLASSES[entity.classId ?? 'warrior'].color;
      view.update(alpha, dtMs, entity.id === targetId, baseColor);
      // Corpses stay visible but sink out of the way until they respawn.
      view.group.visible = !entity.dead || entity.kind === 'mob';
      if (entity.dead && entity.kind === 'mob') {
        const looted = (entity.corpseLoot?.length ?? 0) === 0 && (entity.corpseGold ?? 0) === 0;
        view.group.visible = !looted || entity.respawnInMs > 0;
      }
    }
    this.updateTelegraphs(dtMs);
  }
}
