import * as THREE from 'three';
import { AnimStateMachine } from './anim.js';
import { CLASSES } from '../content/zone.js';
import { getMob } from '../content/mobs.js';
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

  constructor(
    readonly id: EntityId,
    entity: Entity,
  ) {
    const view =
      entity.kind === 'mob'
        ? getMob(entity.defId!).view
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

    this.anim = new AnimStateMachine(this.body, view.height);

    // Tag every descendant so a click raycast can resolve back to an entity.
    this.group.userData.entityId = id;
    this.group.traverse((o) => {
      o.userData.entityId = id;
    });

    this.prev.set(entity.pos.x, 0, entity.pos.z);
    this.next.copy(this.prev);
    this.group.position.copy(this.prev);
  }

  /** Called once per sim tick: last tick's target becomes this tick's origin. */
  pushTick(entity: Entity): void {
    this.prev.copy(this.next);
    this.next.set(entity.pos.x, 0, entity.pos.z);
    this.prevFacing = this.nextFacing;
    this.nextFacing = entity.facing;
    this.anim.setMoving(this.prev.distanceToSquared(this.next) > 0.0004);
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
 * Owns the view collection and keeps it in sync with the sim's entity set.
 */
export class ViewManager {
  private views = new Map<EntityId, EntityView>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: World,
  ) {}

  get all(): IterableIterator<EntityView> {
    return this.views.values();
  }

  get(id: EntityId): EntityView | undefined {
    return this.views.get(id);
  }

  /** Create views for new entities; drop views whose entity is gone. */
  sync(): void {
    for (const entity of this.world.entities.values()) {
      if (this.views.has(entity.id)) continue;
      const view = new EntityView(entity.id, entity);
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

  update(alpha: number, dtMs: number): void {
    const targetId = this.world.player.targetId;
    for (const entity of this.world.entities.values()) {
      const view = this.views.get(entity.id);
      if (!view) continue;
      const baseColor =
        entity.kind === 'mob'
          ? getMob(entity.defId!).view.color
          : CLASSES[entity.classId ?? 'warrior'].color;
      view.update(alpha, dtMs, entity.id === targetId, baseColor);
      // Corpses stay visible but sink out of the way until they respawn.
      view.group.visible = !entity.dead || entity.kind === 'mob';
      if (entity.dead && entity.kind === 'mob') {
        const looted = (entity.corpseLoot?.length ?? 0) === 0 && (entity.corpseGold ?? 0) === 0;
        view.group.visible = !looted || entity.respawnInMs > 0;
      }
    }
  }
}
