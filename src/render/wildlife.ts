import * as THREE from 'three';
import type { HeightField, ZoneTheme } from '../content/terrain.js';

/**
 * The things that are alive and are not creatures.
 *
 * Between the camps this world was three kilometres of grass with trees on it.
 * Strays fixed the *emptiness* — there is now something to fight every hundred
 * metres — but everything in the zone that moved was a health bar, and a world
 * where the only motion is a thing that wants to kill you reads as a shooting
 * gallery rather than as a place.
 *
 * So: birds, midges over the water, and rings where something rose. None of it
 * can be targeted, fought, looted or counted. That is the whole point — it is
 * evidence of a world rather than content in one, and the moment any of it
 * becomes a nameplate it stops being scenery and starts being a chore.
 *
 * Three rules:
 *
 * - **Renderer-only, and it never touches `World.rng`.** The same rule roaming
 *   creatures and the weather run under, for the same reason: anything ambient
 *   that draws from the combat stream turns every figure in the balance suite
 *   into a measurement of the scenery. This file has its own PRNG and its own
 *   clock and cannot reach the sim at all.
 * - **Nothing carries an `entityId`.** The click raycast resolves against that
 *   tag, so a bird can never be targeted, and there is no code path where
 *   clicking one does anything at all.
 * - **One draw call per flock.** A flock is an `InstancedMesh`; six hundred
 *   creatures a zone already spend the budget, and a bird is not worth a draw
 *   call each.
 */

/** How many flocks are in the air at once. */
const FLOCKS = 5;

/** How far out flocks are kept, so they are always somewhere ahead of you. */
const FLOCK_SPAN = 130;

/** How close you have to get before a flock breaks up. */
const SCATTER_RANGE = 26;

/** Birds per flock. */
const BIRDS = 7;

/** Midge clouds over water, and how many specks each has. */
const MIDGE_CLOUDS = 4;
const MIDGES = 40;

/** How often something rises, in seconds, and how long a ring lasts. */
const RISE_EVERY = 2.4;
const RING_LIFE = 2.6;

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One flock, wheeling about a centre until something walks into it.
 *
 * A flock has exactly two states and the transition between them is the whole
 * feature: birds that only ever circle are wallpaper, and birds that break and
 * climb *because you walked under them* are the cheapest possible proof that
 * the world noticed you.
 */
class Flock {
  readonly mesh: THREE.InstancedMesh;
  private centre = new THREE.Vector3();
  private phase: number[] = [];
  private radius: number[] = [];
  private height: number[] = [];
  private speed: number[] = [];
  /** Above zero while breaking up: how far through the scatter it is. */
  private scattered = 0;
  private heading = 0;

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, private readonly rng: () => number) {
    this.mesh = new THREE.InstancedMesh(geometry, material, BIRDS);
    this.mesh.frustumCulled = false;
    // Nothing here is an entity, and nothing here has an id. The click
    // raycast resolves against `userData.entityId`, so there is no path by
    // which a bird can be targeted, damaged or looted.
    this.mesh.userData.ambient = true;
    for (let i = 0; i < BIRDS; i++) {
      this.phase.push(rng() * Math.PI * 2);
      this.radius.push(5 + rng() * 11);
      this.height.push(9 + rng() * 12);
      this.speed.push(0.35 + rng() * 0.35);
    }
  }

  /** Put the flock somewhere new, well away from the player. */
  reseat(px: number, pz: number, groundAt: (x: number, z: number) => number): void {
    const angle = this.rng() * Math.PI * 2;
    const away = FLOCK_SPAN * (0.45 + this.rng() * 0.55);
    const x = px + Math.sin(angle) * away;
    const z = pz + Math.cos(angle) * away;
    this.centre.set(x, groundAt(x, z), z);
    this.scattered = 0;
    this.heading = this.rng() * Math.PI * 2;
  }

  update(dt: number, px: number, pz: number, groundAt: (x: number, z: number) => number): void {
    const gap = Math.hypot(this.centre.x - px, this.centre.z - pz);
    if (this.scattered === 0 && gap < SCATTER_RANGE) this.scattered = 0.0001;

    if (this.scattered > 0) {
      this.scattered += dt;
      // Away and up, then gone: a flock that fades on the spot reads as a
      // rendering bug, and one that simply teleports reads as nothing at all.
      this.centre.x += Math.sin(this.heading) * dt * 26;
      this.centre.z += Math.cos(this.heading) * dt * 26;
      if (this.scattered > 5) this.reseat(px, pz, groundAt);
    } else if (gap > FLOCK_SPAN * 1.7) {
      // Walked away from it. Bring it back rather than leaving flocks strewn
      // across three kilometres of map for the rest of the session.
      this.reseat(px, pz, groundAt);
    }

    const climb = this.scattered > 0 ? Math.min(34, this.scattered * 16) : 0;
    const spread = this.scattered > 0 ? 1 + this.scattered * 1.6 : 1;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const scale = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < BIRDS; i++) {
      this.phase[i]! += dt * this.speed[i]! * (this.scattered > 0 ? 2.2 : 1);
      const r = this.radius[i]! * spread;
      const x = this.centre.x + Math.sin(this.phase[i]!) * r;
      const z = this.centre.z + Math.cos(this.phase[i]!) * r * 0.75;
      const y = groundAt(x, z) + this.height[i]! + climb + Math.sin(this.phase[i]! * 2) * 1.2;
      // Facing along the circle it is flying, so a bird is never sliding
      // sideways through the air.
      q.setFromAxisAngle(up, this.phase[i]! + Math.PI / 2);
      m.compose(new THREE.Vector3(x, y, z), q, scale);
      this.mesh.setMatrixAt(i, m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.dispose();
  }

  /** For `tools/wildlife.mjs`, which is the only thing that can judge this. */
  centreForTest(): { x: number; z: number } {
    return { x: this.centre.x, z: this.centre.z };
  }

  scatteredForTest(): number {
    return this.scattered;
  }
}

/**
 * Everything alive that is not a creature, for one zone.
 *
 * Built per zone and thrown away with it, exactly like the scatter — and like
 * the scatter, the geometry and materials belong to the zone rather than to
 * anything drawing them.
 */
export class Wildlife {
  readonly group = new THREE.Group();
  private flocks: Flock[] = [];
  private midges: THREE.Points[] = [];
  private rings: THREE.Mesh[] = [];
  private ringAge: number[] = [];
  private birdGeo: THREE.BufferGeometry;
  private birdMat: THREE.Material;
  private ringGeo: THREE.RingGeometry;
  private ringMat: THREE.MeshBasicMaterial;
  private sinceRise = 0;
  private rng: () => number;
  private seeded = false;

  constructor(
    private readonly theme: ZoneTheme,
    private readonly field: HeightField,
    zoneSeed: number,
  ) {
    this.rng = mulberry(zoneSeed ^ 0x71fe);

    // A bird is two triangles in a shallow V. At the heights these fly it is
    // the silhouette that reads, and a silhouette is all a bird needs.
    const wing = new THREE.BufferGeometry();
    wing.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [-1.9, 0, 0, 0, 0.4, 0.5, 0, 0, -0.5, 1.9, 0, 0, 0, 0, -0.5, 0, 0.4, 0.5],
        3,
      ),
    );
    wing.computeVertexNormals();
    this.birdGeo = wing;
    this.birdMat = new THREE.MeshBasicMaterial({
      color: 0x2b2f2c,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.75,
      fog: true,
    });

    this.ringGeo = new THREE.RingGeometry(0.85, 1, 20);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({
      color: theme.water?.color ?? 0xdfe8ea,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    for (let i = 0; i < FLOCKS; i++) {
      const flock = new Flock(this.birdGeo, this.birdMat, this.rng);
      this.flocks.push(flock);
      this.group.add(flock.mesh);
    }
  }

  /** Where the water is, if this zone has any. */
  private get waterLevel(): number | undefined {
    return this.theme.terrain.waterLevel;
  }

  /**
   * Follow the player.
   *
   * `dtMs` is clamped for the same reason every other effect in this renderer
   * clamps it: on a machine running at four frames a second an unclamped step
   * teleports a flock across the zone between two frames.
   */
  update(dtMs: number, px: number, pz: number): void {
    const dt = Math.min(dtMs, 120) / 1000;
    const groundAt = (x: number, z: number) => this.field.at(x, z);

    if (!this.seeded) {
      this.seeded = true;
      for (const flock of this.flocks) flock.reseat(px, pz, groundAt);
      this.seatMidges(px, pz);
    }
    for (const flock of this.flocks) flock.update(dt, px, pz, groundAt);

    if (this.waterLevel === undefined) return;
    this.driftMidges(dt);
    this.riseAndRing(dt, px, pz);
  }

  /** Midge clouds, over water only — which is where midges are. */
  private seatMidges(px: number, pz: number): void {
    const water = this.waterLevel;
    if (water === undefined) return;
    for (let c = 0; c < MIDGE_CLOUDS; c++) {
      const spot = this.findWater(px, pz);
      if (!spot) continue;
      const positions = new Float32Array(MIDGES * 3);
      for (let i = 0; i < MIDGES; i++) {
        positions[i * 3] = spot.x + (this.rng() * 2 - 1) * 5;
        positions[i * 3 + 1] = water + 0.3 + this.rng() * 1.6;
        positions[i * 3 + 2] = spot.z + (this.rng() * 2 - 1) * 5;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const cloud = new THREE.Points(
        geo,
        new THREE.PointsMaterial({
          color: 0xd8d2a8,
          size: 0.11,
          transparent: true,
          opacity: 0.6,
          depthWrite: false,
          fog: true,
        }),
      );
      cloud.frustumCulled = false;
      cloud.userData.ambient = true;
      this.midges.push(cloud);
      this.group.add(cloud);
    }
  }

  private driftMidges(dt: number): void {
    for (const cloud of this.midges) {
      const pos = cloud.geometry.attributes.position as THREE.BufferAttribute;
      const water = this.waterLevel!;
      for (let i = 0; i < pos.count; i++) {
        // Hashed off the index rather than randomised per frame, so a midge
        // jitters along its own path instead of teleporting every frame.
        const t = performance.now() / 1000 + i * 1.7;
        pos.setY(i, water + 0.4 + (Math.sin(t * 2.1) + 1) * 0.5);
        pos.setX(i, pos.getX(i) + Math.sin(t * 1.3) * dt * 0.7);
        pos.setZ(i, pos.getZ(i) + Math.cos(t * 1.1) * dt * 0.7);
      }
      pos.needsUpdate = true;
    }
  }

  /** Something rises, and leaves a ring. */
  private riseAndRing(dt: number, px: number, pz: number): void {
    this.sinceRise += dt;
    if (this.sinceRise >= RISE_EVERY) {
      this.sinceRise = 0;
      const spot = this.findWater(px, pz);
      if (spot) {
        const ring = new THREE.Mesh(this.ringGeo, this.ringMat.clone());
        ring.position.set(spot.x, this.waterLevel! + 0.05, spot.z);
        ring.scale.setScalar(0.4);
        ring.userData.ambient = true;
        this.rings.push(ring);
        this.ringAge.push(0);
        this.group.add(ring);
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      this.ringAge[i]! += dt;
      const t = this.ringAge[i]! / RING_LIFE;
      const ring = this.rings[i]!;
      if (t >= 1) {
        this.group.remove(ring);
        (ring.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
        this.ringAge.splice(i, 1);
        continue;
      }
      ring.scale.setScalar(0.4 + t * 3.4);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.42 * (1 - t);
    }
  }

  /** A patch of open water near the player, or nothing. */
  private findWater(px: number, pz: number): { x: number; z: number } | null {
    for (let i = 0; i < 30; i++) {
      const x = px + (this.rng() * 2 - 1) * 110;
      const z = pz + (this.rng() * 2 - 1) * 110;
      if (this.field.underwater(x, z)) return { x, z };
    }
    return null;
  }

  /** For `tools/wildlife.mjs`. */
  flocksForTest(): Flock[] {
    return this.flocks;
  }

  dispose(): void {
    for (const flock of this.flocks) flock.dispose();
    for (const cloud of this.midges) cloud.geometry.dispose();
    for (const ring of this.rings) (ring.material as THREE.Material).dispose();
    this.flocks = [];
    this.midges = [];
    this.rings = [];
    this.birdGeo.dispose();
    this.birdMat.dispose();
    this.ringGeo.dispose();
    this.ringMat.dispose();
  }
}
