import * as THREE from 'three';
import { getMob } from '../content/mobs.js';
import { isBoss } from '../sim/types.js';
import { HeightField, getTheme } from '../content/terrain.js';
import type { Clearing, PropSpec, ZoneTheme } from '../content/terrain.js';
import type { ZoneDef } from '../content/zone.js';
import { holdingStructure, structuresFor, type StructureDef, type StructureKind } from '../content/structures.js';
import type { Vec2 } from '../sim/types.js';
import { NIGHT_FLOOR, type Daylight, type Weather } from '../content/daylight.js';

/**
 * How much ground the moving terrain tile covers, and at what resolution.
 *
 * Sized against the fog rather than the zone: the tile only has to reach past
 * where you can see, and everything beyond it is not built at all.
 */
const TILE_SIZE = 880;
const TILE_SEGMENTS = 320;

/** Scenery is built and dropped in squares this big. */
const CELL_SIZE = 155;

/** How many cells out from the player stay built. */
const CELL_RADIUS = 3;

/**
 * The patch a theme's prop counts are authored against.
 *
 * Themes say "110 broadleaf", which used to mean "in this zone". Zones are now
 * a hundred times bigger, so it means "in a patch this size" instead — the
 * numbers keep the density they were tuned to and the table did not have to be
 * rewritten in units nobody can picture.
 */
const REFERENCE_AREA = 290 * 290;

/**
 * Half-width of the sun's shadow frustum, which follows the player.
 *
 * Wide enough that its edge sits out in the fog rather than across the middle
 * of the screen, and no wider: this is 2048 texels across, so every metre added
 * here is resolution taken off the shadows you can actually see.
 */
const SHADOW_HALF = 150;

/** Half-width of the box the ambient motes drift in. */
const MOTE_SPAN = 90;

/** How big a box of weather follows the player, and how tall. */
const PRECIP_HALF = 42;
const PRECIP_TOP = 34;

/** What the light turns into at the bottom of the night. */
const MOONLIGHT = new THREE.Color(0x8ea8d8);

/** How long a raindrop's streak is, and how far it leans. */
const RAIN_STREAK = 1.6;
const RAIN_SLANT = 0.22;

/**
 * Scene, lighting, terrain and the follow camera.
 *
 * Everything here is presentation. The sim has no idea any of it exists, and
 * swapping placeholder geometry for real art means editing this file and
 * `views.ts` only.
 *
 * How a zone looks is *data* — see `content/terrain.ts`. This file knows how to
 * build a hill, a tree and a fog bank; it does not know that Ardmoor is grey or
 * that Caer Dubh glows. That is what makes "give each zone its own look" an
 * edit to a table rather than a rewrite of the renderer.
 */
export class SceneRig {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  ground!: THREE.Mesh;
  theme!: ZoneTheme;
  /** Which zone is currently built. The frame loop reconciles against this. */
  zoneId = '';
  /** Samples ground height. Renderer-only — the sim is flat. */
  height!: HeightField;

  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  /** Everything belonging to the current zone, dropped wholesale on travel. */
  private zoneRoot = new THREE.Group();
  private motes: THREE.Points | null = null;
  private water: THREE.Mesh | null = null;
  /** The zone being streamed, kept for the cell builders. */
  private zone!: ZoneDef;
  private clearingList: Clearing[] = [];
  /**
   * This theme's scatter, flattened into instanceable parts.
   *
   * Built once per zone and shared by every cell — which is the whole point.
   * Aligned by index with `theme.props`.
   */
  private propParts: PropPart[][] = [];
  /** Cell key -> the scenery standing in it. Built and dropped as you walk. */
  private cells = new Map<string, THREE.Group>();
  /**
   * This zone's landmarks. Placed once on load, built and dropped per cell.
   *
   * Public because the map draws them: a landmark whose whole job is telling
   * you where you are should be on the thing you look at to find out.
   */
  structures: StructureDef[] = [];
  /** Where the ground tile is currently centred, snapped to the vertex grid. */
  private tileAt = { x: Infinity, z: Infinity };
  private motesAt = { x: Infinity, z: Infinity };
  /** Rain or snow. Rebuilt when the kind changes, moved every frame. */
  private precip: THREE.Points | THREE.LineSegments | null = null;
  private precipKind = '';
  private skyColor = new THREE.Color();
  private fogColor = new THREE.Color();
  private nightSky = new THREE.Color(0x0d1420);
  /** Where the sun sits above the ground right now. Set by `setSky`. */
  private sunHeight = 0;
  /** Last camera focus, so weather can follow the player without being told. */
  private lastFocus = new THREE.Vector3();

  /**
   * Camera orbit state, driven by right-drag and scroll.
   * Starts looking down -Z so the player spawns facing into the zone rather
   * than at the boundary wall behind them.
   */
  yaw = Math.PI;
  pitch = 0.46;
  distance = 13;

  constructor(container: HTMLElement, zone: ZoneDef) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1200);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.85);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffffff, 1.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 400;
    // Without a bias, a shadow frustum this size self-shadows the ground it is
    // lighting: the whole near field renders as one dark band with the lit
    // world beyond it, which reads as dusk falling in a circle around you.
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target);

    this.scene.add(this.zoneRoot);
    this.loadZone(zone);

    window.addEventListener('resize', () => this.onResize());
  }

  /**
   * Tear the current zone down and build the new one.
   *
   * Travel used to leave the old scenery standing: only the entities were
   * rebuilt, so you walked out of the Fenmarch and arrived in a zone that still
   * had the Fenmarch's hills, trees and sky. With four distinct themes that is
   * not a subtle bug.
   */
  loadZone(zone: ZoneDef): void {
    this.disposeZone();
    const theme = getTheme(zone.theme);
    this.theme = theme;
    this.zoneId = zone.id;

    this.scene.background = new THREE.Color(theme.sky);
    this.scene.fog = new THREE.Fog(theme.fog.color, theme.fog.near, theme.fog.far);

    this.hemi.color.setHex(theme.hemisphere.sky);
    this.hemi.groundColor.setHex(theme.hemisphere.ground);
    this.hemi.intensity = theme.hemisphere.intensity;

    this.sun.color.setHex(theme.sun.color);
    this.sun.intensity = theme.sun.intensity;
    this.sun.position.set(...theme.sun.position);
    // The shadow camera follows the player rather than covering the zone. Over
    // three kilometres of ground a zone-wide shadow map is one and a half
    // metres per texel, which is not a shadow, it is a smear.
    const s = SHADOW_HALF;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.camera.updateProjectionMatrix();

    this.zone = zone;
    this.propParts = theme.props.map((spec) => propParts(spec));
    this.structures = this.siteStructures(zone);
    this.clearingList = this.clearings(zone);
    this.height = new HeightField(theme.terrain, this.clearingList);

    this.buildGroundTile(theme);
    this.buildWater(theme);
    this.stream(zone.playerStart.x, zone.playerStart.z, true);
  }

  /**
   * Build the world around a point, and drop what is behind you.
   *
   * A zone is three kilometres across. One ground mesh at a resolution worth
   * looking at would be millions of vertices, and a zone's worth of trees is
   * tens of thousands of objects — so neither exists. The ground is a single
   * tile that re-centres on the player, and the scenery is built per cell from
   * a hash of that cell's coordinates, which is what makes it identical every
   * time you walk back and free when you are not there.
   *
   * The fog is doing the other half of the job: it is set closer than the tile
   * edge, so the place where the world stops being built is never on screen.
   */
  stream(x: number, z: number, force = false): void {
    this.recentreGround(x, z, force);
    this.streamCells(x, z);
    this.recentreMotes(x, z, force);
    // Keep the shadow frustum on the player, and the sun's direction fixed.
    const dir = this.theme.sun.position;
    this.sun.position.set(x + dir[0], this.sunHeight || dir[1], z + dir[2]);
    this.sun.target.position.set(x, 0, z);
    this.sun.target.updateMatrixWorld();
  }

  private disposeZone(): void {
    this.zoneRoot.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.scene.remove(this.zoneRoot);
    this.zoneRoot = new THREE.Group();
    this.scene.add(this.zoneRoot);
    this.motes = null;
    this.water = null;
    // The shared scatter belongs to the zone being torn down, and `disposeTree`
    // was told to leave it alone — so it is freed here instead.
    for (const parts of this.propParts) {
      for (const part of parts) {
        part.geometry.dispose();
        part.material.dispose();
      }
    }
    this.propParts = [];
    this.structures = [];
    this.cells.clear();
    this.tileAt = { x: Infinity, z: Infinity };
    this.motesAt = { x: Infinity, z: Infinity };
  }

  /** Ground height under a world position. Everything visual sits on this. */
  heightAt(x: number, z: number): number {
    return this.height.at(x, z);
  }

  /**
   * The ground: one displaced, vertex-tinted tile that follows the player.
   *
   * Resolution is per-metre rather than per-zone, which is the whole reason a
   * zone can be any size at all. `TILE_SEGMENTS` across `TILE_SIZE` metres is
   * the same vertex density the old whole-zone mesh had over a small one.
   */
  private buildGroundTile(theme: ZoneTheme): void {
    const geo = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE, TILE_SEGMENTS, TILE_SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    geo.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(geo.attributes.position!.count * 3), 3),
    );
    this.ground = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }),
    );
    this.ground.receiveShadow = true;
    this.ground.frustumCulled = false;
    this.zoneRoot.add(this.ground);
    void theme;
  }

  /**
   * The water surface: one flat sheet the size of the ground tile, riding along
   * with it at the theme's water line.
   *
   * The ground is carved down to meet it (see `terrainHeight`), so this is only
   * ever the top of something that already has a bed and a shore. A sheet laid
   * over untouched terrain gives you puddles on hillsides.
   */
  private buildWater(theme: ZoneTheme): void {
    const level = theme.terrain.waterLevel;
    if (level === undefined || !theme.water) return;
    const geo = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: theme.water.color,
        transparent: true,
        opacity: theme.water.opacity,
        roughness: 0.12,
        metalness: 0.35,
        depthWrite: false,
      }),
    );
    this.water.position.y = level;
    this.water.renderOrder = 1;
    this.water.frustumCulled = false;
    this.zoneRoot.add(this.water);
  }

  /**
   * Move the tile under the player and re-sample it.
   *
   * Snapped to whole vertex spacings. Sliding it smoothly would make every hill
   * swim as the grid slid through the height function — the noise is anchored
   * to the world, so the sampling grid has to be too.
   */
  private recentreGround(x: number, z: number, force: boolean): void {
    const step = TILE_SIZE / TILE_SEGMENTS;
    const cx = Math.round(x / step) * step;
    const cz = Math.round(z / step) * step;
    if (!force && cx === this.tileAt.x && cz === this.tileAt.z) return;
    this.tileAt = { x: cx, z: cz };

    const geo = this.ground.geometry as THREE.BufferGeometry;
    const pos = geo.attributes.position!;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, this.height.at(pos.getX(i) + cx, pos.getZ(i) + cz));
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    tintGround(geo, this.theme, cx, cz);
    this.ground.position.set(cx, 0, cz);
    if (this.water) {
      this.water.position.x = cx;
      this.water.position.z = cz;
    }
  }

  /**
   * Places that must stay free of scenery *and* level: the spawn point, every
   * boss arena, every shopfront. Derived from the zone rather than hardcoded —
   * a hardcoded clearing silently stopped matching when the boss moved, and a
   * tree ended up planted straight through Old Scar.
   */
  private clearings(zone: ZoneDef): Clearing[] {
    const out: Clearing[] = [{ x: zone.playerStart.x, z: zone.playerStart.z, r: 11 }];
    // Landmarks are levelled with the ground under them, the same as arenas
    // and shopfronts. A watchtower on a slope has one corner buried and one in
    // the air, which is the single most obvious way for a building to look
    // like placeholder geometry.
    for (const st of this.structures) out.push({ x: st.pos.x, z: st.pos.z, r: st.clearing });
    for (const spawn of zone.spawns) {
      const def = getMob(spawn.mobId);
      if (!isBoss(def.stars)) continue;
      // Wide enough to keep the whole telegraph circle readable.
      out.push({ x: spawn.pos.x, z: spawn.pos.z, r: 18 });
    }
    // Traders need room to stand in and be walked up to.
    for (const vendor of zone.vendors ?? []) {
      out.push({ x: vendor.pos.x, z: vendor.pos.z, r: 9 });
    }
    for (const exit of zone.exits ?? []) {
      out.push({ x: exit.pos.x, z: exit.pos.z, r: 8 });
    }
    return out;
  }

  /**
   * Build every cell within sight and drop the rest.
   *
   * A cell's contents come from a hash of its coordinates, so walking away and
   * back rebuilds exactly what was there. Nothing is remembered, which is what
   * keeps a three-kilometre zone the same cost to stand in as a small one.
   */
  private streamCells(x: number, z: number): void {
    const cx = Math.floor(x / CELL_SIZE);
    const cz = Math.floor(z / CELL_SIZE);
    const wanted = new Set<string>();

    for (let dz = -CELL_RADIUS; dz <= CELL_RADIUS; dz++) {
      for (let dx = -CELL_RADIUS; dx <= CELL_RADIUS; dx++) {
        const key = `${cx + dx},${cz + dz}`;
        wanted.add(key);
        if (this.cells.has(key)) continue;
        const group = this.buildCell(cx + dx, cz + dz);
        this.cells.set(key, group);
        this.zoneRoot.add(group);
      }
    }

    for (const [key, group] of this.cells) {
      if (wanted.has(key)) continue;
      this.zoneRoot.remove(group);
      disposeTree(group);
      this.cells.delete(key);
    }
  }

  /** Everything standing in one cell: scenery, landmarks, and the zone wall. */
  private buildCell(cx: number, cz: number): THREE.Group {
    const group = new THREE.Group();
    const x0 = cx * CELL_SIZE;
    const z0 = cz * CELL_SIZE;
    const limit = this.zone.halfSize;
    // Cells entirely outside the wall hold nothing but the wall itself.
    const inside = x0 + CELL_SIZE > -limit && x0 < limit && z0 + CELL_SIZE > -limit && z0 < limit;

    if (inside) {
      this.addCellScatter(group, x0, z0);
      this.addCellStructures(group, x0, z0);
    }
    this.addCellBoundary(group, x0, z0);
    return group;
  }

  /**
   * Where this zone's landmarks stand.
   *
   * Anchored ones first — a tower on every guard post, a ruin over every boss,
   * a farmstead at every shopfront — then the rest fill the empty country. The
   * anchors are what make a landmark information rather than decoration: you
   * see a tower on the ridge and you know there is a front over there.
   */
  private siteStructures(zone: ZoneDef): StructureDef[] {
    const anchors: Array<{ pos: Vec2; kind: StructureKind; scale?: number }> = [];
    const keepClear: Vec2[] = [];
    const seenHoldings = new Set<string>();

    for (const spawn of zone.spawns) {
      keepClear.push(spawn.pos);
      const def = getMob(spawn.mobId);
      if (isBoss(def.stars)) {
        anchors.push({ pos: { x: spawn.pos.x, z: spawn.pos.z - 26 }, kind: 'ruin', scale: 1.3 });
      } else if (spawn.holding && !seenHoldings.has(spawn.holding)) {
        seenHoldings.add(spawn.holding);
        anchors.push({
          pos: { x: spawn.pos.x + 22, z: spawn.pos.z - 18 },
          kind: holdingStructure(zone.id),
          scale: 1.15,
        });
      }
    }
    for (const vendor of zone.vendors ?? []) {
      anchors.push({ pos: { x: vendor.pos.x + 17, z: vendor.pos.z + 5 }, kind: 'farmstead' });
      keepClear.push(vendor.pos);
    }
    keepClear.push(zone.playerStart);
    for (const exit of zone.exits ?? []) keepClear.push(exit.pos);

    return structuresFor(zone.id, zone.theme, anchors, zone.halfSize, keepClear, 26);
  }

  private addCellStructures(group: THREE.Group, x0: number, z0: number): void {
    for (const st of this.structures) {
      if (st.pos.x < x0 || st.pos.x >= x0 + CELL_SIZE) continue;
      if (st.pos.z < z0 || st.pos.z >= z0 + CELL_SIZE) continue;
      const built = buildStructure(st, this.theme);
      built.position.set(st.pos.x, this.height.at(st.pos.x, st.pos.z), st.pos.z);
      built.rotation.y = st.facing;
      built.scale.setScalar(st.scale);
      group.add(built);
    }
  }

  /**
   * Fill one cell with scenery, as instanced meshes.
   *
   * This used to clone a `Group` per prop, which is the obvious thing and
   * costs 2,627 draw calls a frame at the density this game runs at — a reed
   * alone is seven meshes, and there are fifty-five of them per reference
   * patch. One `InstancedMesh` per prop part per cell turns a cell's worth of
   * trees into two draws, and because an instanced mesh has one bounding
   * sphere the frustum culls a whole cell at a time rather than a tree at a
   * time.
   */
  private addCellScatter(group: THREE.Group, x0: number, z0: number): void {
    const blocked = (x: number, z: number): boolean =>
      this.clearingList.some((c) => Math.hypot(x - c.x, z - c.z) < c.r);
    // Seeded from the cell and the zone, never from the sim's Rng: decor must
    // not be able to shift a gameplay roll, and this runs as you walk.
    const rng = mulberry(hash(`${this.zone.id}:${x0}:${z0}`));
    const limit = this.zone.halfSize;
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scaleV = new THREE.Vector3();
    const world = new THREE.Matrix4();

    for (const [index, spec] of this.theme.props.entries()) {
      // `count` is authored against a reference patch, so a theme table written
      // for a small zone keeps meaning the same thing on a large one.
      const expected = (spec.count * CELL_SIZE * CELL_SIZE) / REFERENCE_AREA;
      const n = Math.floor(expected) + (rng() < expected % 1 ? 1 : 0);
      if (n <= 0) continue;
      const parts = this.propParts[index];
      if (!parts || parts.length === 0) continue;

      // Place first, draw second: the count an InstancedMesh is built with is
      // fixed, and how many of the n candidates survive water and clearings is
      // not knowable until they have all been tried.
      const placed: THREE.Matrix4[] = [];
      for (let i = 0; i < n; i++) {
        const x = x0 + rng() * CELL_SIZE;
        const z = z0 + rng() * CELL_SIZE;
        const spin = rng() * Math.PI * 2;
        const jitter = rng() * 2 - 1;
        const lean = rng() * 2 - 1;
        if (Math.abs(x) > limit * 0.98 || Math.abs(z) > limit * 0.98) continue;
        if (blocked(x, z)) continue;
        // Reeds stand in the shallows; nothing else grows under a lake.
        if (spec.kind !== 'reed' && this.height.underwater(x, z)) continue;
        const scale = spec.scale * (1 + jitter * (spec.jitter ?? 0.4) * 0.5);
        // Lean stones and dead wood slightly; nothing in a wild place is plumb.
        const tilt = spec.kind === 'standingStone' || spec.kind === 'deadTree' ? lean * 0.12 : 0;
        pos.set(x, this.height.at(x, z), z);
        euler.set(0, spin, tilt, 'YXZ');
        quat.setFromEuler(euler);
        scaleV.setScalar(scale);
        placed.push(new THREE.Matrix4().compose(pos, quat, scaleV));
      }
      if (placed.length === 0) continue;

      for (const part of parts) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, placed.length);
        for (let i = 0; i < placed.length; i++) {
          world.copy(placed[i]!).multiply(part.matrix);
          mesh.setMatrixAt(i, world);
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        group.add(mesh);
      }
    }
  }

  /** A low wall marking the zone edge, so the clamp in the sim is legible. */
  private addCellBoundary(group: THREE.Group, x0: number, z0: number): void {
    const s = this.zone.halfSize;
    const step = 8;
    const mat = new THREE.MeshStandardMaterial({ color: this.theme.boundary, roughness: 1 });
    let used = false;

    // Segmented rather than four long boxes, so the wall follows the hills
    // instead of hovering over the valleys — and built per cell, because a
    // three-kilometre perimeter at this spacing is fifteen hundred boxes.
    const run = (along: 'x' | 'z', edge: number): void => {
      const from = along === 'x' ? x0 : z0;
      for (let t = from; t < from + CELL_SIZE; t += step) {
        const mid = t + step / 2;
        if (Math.abs(mid) > s) continue;
        const x = along === 'x' ? mid : edge;
        const z = along === 'x' ? edge : mid;
        const wall = new THREE.Mesh(
          new THREE.BoxGeometry(along === 'x' ? step : 0.6, 2.4, along === 'x' ? 0.6 : step),
          mat,
        );
        wall.position.set(x, this.height.at(x, z) + 0.9, z);
        wall.castShadow = true;
        wall.receiveShadow = true;
        group.add(wall);
        used = true;
      }
    };

    for (const edge of [-s, s]) {
      if (edge >= z0 && edge < z0 + CELL_SIZE) run('x', edge);
      if (edge >= x0 && edge < x0 + CELL_SIZE) run('z', edge);
    }
    if (!used) mat.dispose();
  }

  /**
   * Slow drifting particles, in a box that follows the player.
   *
   * Cheap, and it is most of what separates "a forest at dusk" from "a forest
   * with the brightness turned down". Nobody can tell they are local: they are
   * ambient by definition and the fog eats the edge.
   */
  private recentreMotes(x: number, z: number, force: boolean): void {
    const spec = this.theme.motes;
    if (!spec) return;
    if (!force && Math.hypot(x - this.motesAt.x, z - this.motesAt.z) < MOTE_SPAN * 0.25) return;
    this.motesAt = { x, z };

    const rng = mulberry(hash(this.zone.id) ^ 0x5eed);
    const positions = new Float32Array(spec.count * 3);
    for (let i = 0; i < spec.count; i++) {
      const px = x + (rng() * 2 - 1) * MOTE_SPAN;
      const pz = z + (rng() * 2 - 1) * MOTE_SPAN;
      positions[i * 3] = px;
      positions[i * 3 + 1] = this.height.at(px, pz) + 0.5 + rng() * spec.height;
      positions[i * 3 + 2] = pz;
    }
    if (this.motes) {
      this.zoneRoot.remove(this.motes);
      this.motes.geometry.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.motes = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: spec.color,
        size: spec.size,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        fog: true,
      }),
    );
    this.motes.frustumCulled = false;
    this.zoneRoot.add(this.motes);
  }

  /** Orbit the camera around a focus point. */
  updateCamera(focus: THREE.Vector3): void {
    this.lastFocus.copy(focus);
    const p = Math.max(0.15, Math.min(1.35, this.pitch));
    const horiz = Math.cos(p) * this.distance;
    const x = focus.x - Math.sin(this.yaw) * horiz;
    const z = focus.z - Math.cos(this.yaw) * horiz;
    // Never let the camera end up inside a hill: keep it above the ground it is
    // standing over as well as above the player.
    const y = Math.max(focus.y + Math.sin(p) * this.distance, this.heightAt(x, z) + 1.5);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(focus.x, focus.y + 1.0, focus.z);
  }

  /** Drift the motes. Purely decorative, so frame time is the only budget. */
  update(dtMs: number): void {
    if (this.motes) {
      this.motes.rotation.y += dtMs * 0.000018;
      this.motes.position.y = Math.sin(performance.now() * 0.0004) * 0.35;
    }
    if (this.precip) this.fallPrecipitation(dtMs);
  }

  /**
   * Put the sun where the hour says, and the weather over the top of it.
   *
   * Every number here is a *multiplier on the theme*, never a replacement for
   * it: Caer Dubh at noon is still violet twilight and the Fenmarch at
   * midnight is still a moor. A day cycle that overwrote the palette would
   * make four zones that look like one zone at four times of day.
   */
  setSky(light: Daylight, weather: Weather): void {
    const theme = this.theme;
    // 0 at midnight, 1 at noon, so the two lights can be moved independently.
    // They have to be: what makes night read as night is losing the *sun*, and
    // what keeps it playable is keeping the *ambient*.
    //
    // Weather dims by a fraction of the day rather than by subtracting from
    // the light, which is how a first attempt had rain at half past seven in
    // the morning rendering as midnight.
    const gloom = weather.kind === 'clear' ? 0 : weather.intensity * 0.3;
    const day = ((light.light - NIGHT_FLOOR) / (1 - NIGHT_FLOOR)) * (1 - gloom);
    const dark = 1 - day;

    // Directional light nearly goes out. Flat ground and no shadows are most
    // of what a person actually reads as "it is night".
    this.sun.intensity = theme.sun.intensity * (0.2 + 0.8 * day);
    // Ambient never drops below half, and turns the colour of moonlight rather
    // than simply dimming. This line is what keeps the rule in
    // `content/daylight.ts`: night is a mood, not a legibility problem.
    this.hemi.intensity = theme.hemisphere.intensity * (0.5 + 0.5 * day);
    this.hemi.color.setHex(theme.hemisphere.sky).lerp(MOONLIGHT, dark * 0.8);
    this.sun.color.setHex(theme.sun.color).lerp(MOONLIGHT, dark * 0.85);

    // Sky and fog move toward night colour rather than to black, so a horizon
    // still exists to read silhouettes against.
    this.skyColor.setHex(theme.sky).lerp(this.nightSky, dark * 0.88);
    this.fogColor.setHex(theme.fog.color).lerp(this.nightSky, dark * 0.88);
    (this.scene.background as THREE.Color).copy(this.skyColor);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(this.fogColor);
    // Mist is the only weather that changes how far you can see, and it does
    // it hard — that is the whole point of it as a thing that happens to you.
    const closeness =
      weather.kind === 'mist' ? 1 - weather.intensity * 0.62 : 1 - weather.intensity * 0.18;
    fog.near = theme.fog.near * closeness;
    fog.far = theme.fog.far * closeness;

    // The sun rides lower morning and evening, which is most of what sells the
    // hour before anything else does.
    this.sunHeight = theme.sun.position[1] * (0.3 + day * 0.7);

    this.setPrecipitation(weather);
  }

  /**
   * One buffer of weather that follows the camera and wraps.
   *
   * Rain over three kilometres of ground is not a thing anybody can afford;
   * rain in a forty-metre box around the player is indistinguishable from it
   * and costs two thousand vertices.
   */
  private setPrecipitation(weather: Weather): void {
    const wants = weather.kind === 'rain' || weather.kind === 'snow' ? weather.kind : '';
    if (wants !== this.precipKind) {
      if (this.precip) {
        this.precip.geometry.dispose();
        (this.precip.material as THREE.Material).dispose();
        this.scene.remove(this.precip);
        this.precip = null;
      }
      this.precipKind = wants;
      if (wants) {
        this.precip = wants === 'rain' ? buildRain() : buildSnow();
        this.precip.frustumCulled = false;
        this.scene.add(this.precip);
      }
    }
    if (this.precip) {
      (this.precip.material as THREE.Material & { opacity: number }).opacity =
        0.15 + weather.intensity * (this.precipKind === 'rain' ? 0.4 : 0.6);
    }
  }

  private fallPrecipitation(dtMs: number): void {
    const pos = this.precip!.geometry.attributes.position as THREE.BufferAttribute;
    const rain = this.precipKind === 'rain';
    const fall = (rain ? 42 : 6) * (dtMs / 1000);
    const drift = (rain ? 2.5 : 3.5) * (dtMs / 1000);
    // Rain is line segments: two vertices per drop that must move together, or
    // the streaks stretch to the ground and the sky fills with white bars.
    const stride = rain ? 2 : 1;
    for (let i = 0; i < pos.count; i += stride) {
      let y = pos.getY(i) - fall;
      let x = pos.getX(i) + drift;
      if (y < 0) {
        y += PRECIP_TOP;
        x = (Math.random() * 2 - 1) * PRECIP_HALF;
      }
      if (x > PRECIP_HALF) x -= PRECIP_HALF * 2;
      pos.setX(i, x);
      pos.setY(i, y);
      if (rain) {
        pos.setX(i + 1, x - RAIN_SLANT);
        pos.setY(i + 1, y - RAIN_STREAK);
        pos.setZ(i + 1, pos.getZ(i));
      }
    }
    pos.needsUpdate = true;
    // Follows the player, snapped so drops do not slide sideways when you walk.
    this.precip!.position.set(
      Math.round(this.lastFocus.x),
      this.lastFocus.y,
      Math.round(this.lastFocus.z),
    );
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}

/**
 * Rain is line segments, not points.
 *
 * The first version used a point cloud and rendered as a field of large white
 * squares hanging in the air — which is what a screen-facing quad of constant
 * world size looks like up close, and reads as neither rain nor snow. Rain is
 * a streak; the only cheap way to draw a streak is a line.
 */
function buildRain(): THREE.LineSegments {
  const drops = 1800;
  const pos = new Float32Array(drops * 6);
  for (let i = 0; i < drops; i++) {
    const x = (Math.random() * 2 - 1) * PRECIP_HALF;
    const y = Math.random() * PRECIP_TOP;
    const z = (Math.random() * 2 - 1) * PRECIP_HALF;
    pos[i * 6] = x;
    pos[i * 6 + 1] = y;
    pos[i * 6 + 2] = z;
    pos[i * 6 + 3] = x - RAIN_SLANT;
    pos[i * 6 + 4] = y - RAIN_STREAK;
    pos[i * 6 + 5] = z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({
      color: 0xa8bcd0,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    }),
  );
}

function buildSnow(): THREE.Points {
  const flakes = 1400;
  const pos = new Float32Array(flakes * 3);
  for (let i = 0; i < flakes; i++) {
    pos[i * 3] = (Math.random() * 2 - 1) * PRECIP_HALF;
    pos[i * 3 + 1] = Math.random() * PRECIP_TOP;
    pos[i * 3 + 2] = (Math.random() * 2 - 1) * PRECIP_HALF;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      color: 0xf2f6ff,
      size: 0.17,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      sizeAttenuation: true,
    }),
  );
}

/** Free every geometry and material under an object, before dropping it. */
function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    // Scatter geometry and materials belong to the zone, not to the cell that
    // happens to be drawing them: every cell's trees are instances of the same
    // two meshes. Freeing them when one cell scrolls off would take the trees
    // out of every other cell at the same time.
    if (mesh.geometry && !mesh.geometry.userData.shared) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    const free = (m: THREE.Material): void => {
      if (!m.userData.shared) m.dispose();
    };
    if (Array.isArray(mat)) mat.forEach(free);
    else if (mat) free(mat);
  });
}

/**
 * One drawable piece of a prop: geometry, material, and where it sits inside
 * the prop. Harvested from `buildProp` rather than authored separately, so the
 * shapes stay written once and instancing is a thing done *to* them.
 */
interface PropPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** The part's transform inside the prop — a crown four metres up a trunk. */
  matrix: THREE.Matrix4;
}

/**
 * Flatten a prop into its parts, once per zone.
 *
 * This is what makes instancing possible without rewriting every shape: build
 * the prop exactly as before, walk it, and keep the meshes. Geometry and
 * material are then shared by every copy in the zone rather than cloned per
 * copy — which is also why `disposeTree` has to be told to leave them alone.
 */
function propParts(spec: PropSpec): PropPart[] {
  const root = buildProp(spec);
  root.updateMatrixWorld(true);
  const parts: PropPart[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as THREE.Material;
    mesh.geometry.userData.shared = true;
    material.userData.shared = true;
    parts.push({ geometry: mesh.geometry, material, matrix: mesh.matrixWorld.clone() });
  });
  return parts;
}

/**
 * Build one scatter prop. Placeholder geometry, same as the entity capsules —
 * the point is silhouette and colour, which is what reads at camera distance.
 */
/**
 * Build one landmark.
 *
 * Placeholder geometry like everything else, but built to read at distance
 * rather than close up: a landmark's whole job is being recognisable from four
 * hundred metres through fog, so these are about silhouette and almost nothing
 * else. Stone takes the theme's boundary colour, so a ruin in Caer Dubh is
 * violet rock and a ruin in the Fenmarch is grey, without a second table.
 */
function buildStructure(def: StructureDef, theme: ZoneTheme): THREE.Object3D {
  const group = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: theme.boundary, roughness: 0.95 });
  const dark = new THREE.MeshStandardMaterial({
    color: new THREE.Color(theme.boundary).multiplyScalar(0.62),
    roughness: 1,
  });
  const timber = new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 1 });
  const thatch = new THREE.MeshStandardMaterial({ color: 0x8a7a4a, roughness: 1 });

  const block = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material = stone,
  ): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };

  switch (def.kind) {
    case 'watchtower': {
      // Square, tapering, with a broken top: tall enough to see over a ridge,
      // and unmistakable in silhouette against fog.
      block(6.4, 3.2, 6.4, 0, 1.6, 0);
      block(5.4, 4.6, 5.4, 0, 5.5, 0);
      block(4.6, 3.8, 4.6, 0, 9.7, 0);
      // A parapet with one corner fallen in, so it never reads as a chess rook.
      for (const [dx, dz, h] of [
        [-2, -2, 1.4],
        [2, -2, 1.4],
        [-2, 2, 0.5],
        [2, 2, 1.2],
      ] as Array<[number, number, number]>) {
        block(1.1, h, 1.1, dx, 11.6 + h / 2, dz, dark);
      }
      break;
    }
    case 'ruin': {
      // Three standing walls and a fallen one. The gap is the point: a ruin
      // with four walls is a building.
      block(11, 4.4, 0.9, 0, 2.2, -5);
      block(0.9, 3.6, 10, -5.5, 1.8, 0);
      block(0.9, 2.4, 6, 5.5, 1.2, -2);
      block(7, 0.7, 0.8, 1.5, 0.35, 5, dark);
      for (const [x, z] of [
        [-3, 4],
        [3.5, 3],
        [-1, 6],
      ] as Array<[number, number]>) {
        const rubble = new THREE.Mesh(new THREE.DodecahedronGeometry(0.8, 0), dark);
        rubble.position.set(x, 0.35, z);
        rubble.rotation.set(0.4, x, 0.7);
        rubble.castShadow = true;
        group.add(rubble);
      }
      break;
    }
    case 'stoneCircle': {
      // Nine stones, one fallen. Read from above it is a ring; read from the
      // ground it is a horizon full of uprights, which is the better view.
      const n = 9;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = 9;
        if (i === 5) {
          const fallen = block(1.2, 0.8, 4.4, Math.cos(a) * r, 0.4, Math.sin(a) * r, dark);
          fallen.rotation.y = a;
          continue;
        }
        const h = 3.6 + ((i * 37) % 10) / 6;
        const s = block(1.1, h, 0.7, Math.cos(a) * r, h / 2, Math.sin(a) * r);
        s.rotation.y = a;
        s.rotation.z = (((i * 13) % 7) - 3) * 0.02;
      }
      break;
    }
    case 'wreck': {
      // A hull on its side, ribs showing. Only ever sited near water.
      const hull = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 1.6, 13, 7, 1, true), timber);
      hull.rotation.set(Math.PI / 2, 0, 0.5);
      hull.position.y = 1.8;
      hull.castShadow = true;
      group.add(hull);
      for (let i = 0; i < 5; i++) {
        const rib = block(0.35, 3.4, 0.35, -4 + i * 2.1, 1.9, 0.6, timber);
        rib.rotation.z = 0.5 + i * 0.06;
      }
      block(0.5, 7, 0.5, 1.5, 3, -0.5, timber).rotation.z = 0.9;
      break;
    }
    case 'farmstead': {
      // A longhouse and a wall. Somebody lives here, which is why it is the
      // structure that stands next to a trader.
      block(9, 3.2, 5.5, 0, 1.6, 0, timber);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(5.6, 3, 4), thatch);
      roof.position.y = 4.7;
      roof.rotation.y = Math.PI / 4;
      roof.scale.set(1, 1, 0.62);
      roof.castShadow = true;
      group.add(roof);
      for (let i = 0; i < 7; i++) block(1.5, 0.9, 0.6, -5 + i * 1.7, 0.45, 6, dark);
      break;
    }
    case 'cairn': {
      // The cheapest landmark there is, and the most useful: a pile of stones
      // at a junction, which is exactly what they were for.
      for (let i = 0; i < 7; i++) {
        const r = 1.5 * (1 - i / 8);
        const s = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), i % 2 ? dark : stone);
        s.position.set(Math.sin(i * 2.4) * 0.3, 0.3 + i * 0.55, Math.cos(i * 2.4) * 0.3);
        s.rotation.set(i, i * 1.7, i * 0.6);
        s.castShadow = true;
        group.add(s);
      }
      break;
    }
    case 'camp': {
      // Tents and a fire. This is what a holding looks like when the people
      // holding it are outlaws rather than an army.
      for (const [x, z] of [
        [-3.5, -2],
        [3, -3],
        [0, 3.5],
      ] as Array<[number, number]>) {
        const tent = new THREE.Mesh(new THREE.ConeGeometry(2.1, 2.6, 4), timber);
        tent.position.set(x, 1.3, z);
        tent.rotation.y = x + z;
        tent.castShadow = true;
        group.add(tent);
      }
      const fire = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.7, 0),
        new THREE.MeshStandardMaterial({
          color: 0xff8a3a,
          emissive: new THREE.Color(0xff6a20),
          emissiveIntensity: 1.4,
          roughness: 0.4,
        }),
      );
      fire.position.y = 0.5;
      group.add(fire);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        block(0.9, 0.5, 0.9, Math.cos(a) * 1.6, 0.25, Math.sin(a) * 1.6, dark);
      }
      break;
    }
    case 'bridge': {
      // A crossing that goes nowhere any more, which is most of what a bridge
      // in a drowned wood is.
      block(4.4, 0.8, 15, 0, 2.4, 0, timber);
      for (const z of [-5.5, 0, 5.5]) {
        block(1, 4.8, 1, -1.9, 1.2, z, stone);
        block(1, 4.8, 1, 1.9, 1.2, z, stone);
      }
      for (const z of [-6.5, -2, 3, 6.5]) block(0.35, 1.4, 0.35, -2.1, 3.5, z, timber);
      break;
    }
  }
  return group;
}

function buildProp(spec: PropSpec): THREE.Object3D {
  const solid = (color: number, glow = 0): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({
      color,
      roughness: glow > 0 ? 0.4 : 1,
      emissive: glow > 0 ? new THREE.Color(color) : new THREE.Color(0x000000),
      emissiveIntensity: glow,
    });

  const group = new THREE.Group();
  const accent = spec.accent ?? spec.color;

  switch (spec.kind) {
    case 'broadleaf': {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 3.4, 6), solid(spec.color));
      trunk.position.y = 1.7;
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.9, 0), solid(accent, spec.glow ?? 0));
      crown.position.y = 4.4;
      crown.scale.set(1, 0.8, 1);
      group.add(trunk, crown);
      break;
    }
    case 'conifer': {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 2.6, 6), solid(spec.color));
      trunk.position.y = 1.3;
      const top = new THREE.Mesh(new THREE.ConeGeometry(1.5, 5, 7), solid(accent, spec.glow ?? 0));
      top.position.y = 4.6;
      group.add(trunk, top);
      break;
    }
    case 'deadTree': {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.3, 4.2, 5), solid(spec.color));
      trunk.position.y = 2.1;
      group.add(trunk);
      for (const [ry, tilt] of [
        [0.4, 0.9],
        [2.4, -0.8],
      ] as Array<[number, number]>) {
        const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, 1.8, 4), solid(spec.color));
        branch.position.set(Math.sin(ry) * 0.5, 3 + ry * 0.3, Math.cos(ry) * 0.5);
        branch.rotation.z = tilt;
        group.add(branch);
      }
      break;
    }
    case 'rock': {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7, 0), solid(spec.color));
      rock.position.y = 0.25;
      rock.rotation.set(0.7, 1.1, 0.3);
      group.add(rock);
      break;
    }
    case 'boulder': {
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 0), solid(spec.color));
      rock.position.y = 0.7;
      rock.scale.set(1, 0.75, 1.1);
      rock.rotation.set(0.3, 0.8, 0.5);
      group.add(rock);
      break;
    }
    case 'standingStone': {
      const stone = new THREE.Mesh(new THREE.BoxGeometry(0.9, 4.6, 0.55), solid(spec.color));
      stone.position.y = 2.2;
      group.add(stone);
      if (spec.glow) {
        // A band of light around the stone: the cheapest possible "this place
        // is not ordinary" signal, and it reads even in fog.
        const band = new THREE.Mesh(
          new THREE.TorusGeometry(0.75, 0.07, 6, 16),
          new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.8 }),
        );
        band.rotation.x = Math.PI / 2;
        band.position.y = 3.1;
        group.add(band);
      }
      break;
    }
    case 'reed': {
      for (let i = 0; i < 7; i++) {
        const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.06, 1.5, 3), solid(spec.color));
        const a = (i / 7) * Math.PI * 2;
        blade.position.set(Math.cos(a) * 0.3, 0.75, Math.sin(a) * 0.3);
        blade.rotation.z = Math.cos(a) * 0.25;
        blade.rotation.x = Math.sin(a) * 0.25;
        group.add(blade);
      }
      break;
    }
    case 'mushroom': {
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 1.1, 6), solid(spec.color));
      stalk.position.y = 0.55;
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.55, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
        solid(accent, spec.glow ?? 0),
      );
      cap.position.y = 1.05;
      cap.scale.set(1, 0.7, 1);
      group.add(stalk, cap);
      break;
    }
    case 'crystal': {
      const shard = new THREE.Mesh(new THREE.OctahedronGeometry(1.1, 0), solid(accent, spec.glow ?? 0.8));
      shard.position.y = 1.2;
      shard.scale.set(0.5, 1.6, 0.5);
      const base = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6, 0), solid(spec.color));
      base.position.y = 0.25;
      group.add(base, shard);
      break;
    }
  }

  group.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return group;
}

/**
 * Paint per-vertex colour variation onto the ground: broad damp/dry patches
 * from layered sine noise, plus fine per-vertex jitter to break up banding.
 *
 * Height feeds into it too — hilltops read dry, hollows read wet — which is the
 * cheapest way to make displaced ground look like it was shaped by water.
 */
function tintGround(
  geo: THREE.BufferGeometry,
  theme: ZoneTheme,
  /**
   * Where the tile currently sits. Vertex positions are tile-LOCAL, and the
   * tile slides under the player — so tinting from them painted the same
   * pattern of dry ground and wet hollows around wherever you happened to be
   * standing. On screen that is a dark halo that follows the character across
   * the entire zone, which is exactly how every screenshot of this game looked
   * until somebody went and stood in it.
   */
  originX: number,
  originZ: number,
): void {
  const pos = geo.attributes.position!;
  const colors = new Float32Array(pos.count * 3);
  const dry = new THREE.Color(theme.ground.dry);
  const damp = new THREE.Color(theme.ground.damp);
  const tmp = new THREE.Color();
  // Normalised against the FULL relief, not the rolling hills alone. With
  // mountains forty metres up and lake beds thirteen down, dividing by the hill
  // amplitude pinned every hollow to fully damp and every rise to fully dry —
  // so the ground stopped being a gradient and became a hard contour line
  // drawn across the middle distance.
  const t = theme.terrain;
  const amp = Math.max(0.5, t.amplitude + (t.mountains?.amplitude ?? 0) * (t.mountains?.mask ?? 0));

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + originX;
    const z = pos.getZ(i) + originZ;
    const n =
      Math.sin(x * 0.06) * 0.5 +
      Math.cos(z * 0.045) * 0.5 +
      Math.sin((x + z) * 0.11) * 0.25 +
      Math.cos((x - z) * 0.17) * 0.15;
    const low = -pos.getY(i) / amp; // below zero = hollow = damp
    const mix = Math.max(0, Math.min(1, 0.5 + n * 0.32 + low * 0.55));
    tmp.copy(dry).lerp(damp, mix);
    // Jitter is hashed from the world position for the same reason: a
    // per-index sequence is a fixed speckle pattern nailed to the tile.
    const v = 0.94 + hashUnit(x, z) * 0.12;
    colors[i * 3] = tmp.r * v;
    colors[i * 3 + 1] = tmp.g * v;
    colors[i * 3 + 2] = tmp.b * v;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/** A number in [0, 1) from a world position. Same point, same value, forever. */
function hashUnit(x: number, z: number): number {
  let h = Math.imul(Math.round(x * 8) ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13) ^ Math.round(z * 8), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Stable string hash, so a zone's scatter is the same on every load. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Local PRNG for scatter, kept out of the sim's Rng so decor never shifts gameplay. */
function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
