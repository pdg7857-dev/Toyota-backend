import * as THREE from 'three';
import { getMob } from '../content/mobs.js';
import { isBoss } from '../sim/types.js';
import { HeightField, getTheme } from '../content/terrain.js';
import type { Clearing, PropSpec, ZoneTheme } from '../content/terrain.js';
import type { ZoneDef } from '../content/zone.js';

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
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 400);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.85);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffffff, 1.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.far = 240;
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
    const s = zone.halfSize;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.camera.updateProjectionMatrix();

    const clearings = this.clearings(zone);
    this.height = new HeightField(theme.terrain, clearings);

    this.addGround(zone, theme);
    this.addScatter(zone, theme, clearings);
    this.addBoundary(zone, theme);
    this.addMotes(zone, theme);
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
  }

  /** Ground height under a world position. Everything visual sits on this. */
  heightAt(x: number, z: number): number {
    return this.height.at(x, z);
  }

  /**
   * Displaced, vertex-tinted ground.
   *
   * Resolution is per-zone-metre-ish rather than fixed: a coarse grid turns
   * Ardmoor's shelves into origami, and a fine one on the flat Fenmarch is
   * wasted vertices.
   */
  private addGround(zone: ZoneDef, theme: ZoneTheme): void {
    const segments = theme.terrain.amplitude > 4 ? 192 : 128;
    const geo = new THREE.PlaneGeometry(zone.halfSize * 2, zone.halfSize * 2, segments, segments);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position!;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, this.height.at(pos.getX(i), pos.getZ(i)));
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    tintGround(geo, theme);

    this.ground = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }),
    );
    this.ground.receiveShadow = true;
    this.zoneRoot.add(this.ground);
  }

  /**
   * Places that must stay free of scenery *and* level: the spawn point, every
   * boss arena, every shopfront. Derived from the zone rather than hardcoded —
   * a hardcoded clearing silently stopped matching when the boss moved, and a
   * tree ended up planted straight through Old Scar.
   */
  private clearings(zone: ZoneDef): Clearing[] {
    const out: Clearing[] = [{ x: zone.playerStart.x, z: zone.playerStart.z, r: 11 }];
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

  /** Trees, stones and whatever else the theme asks for. */
  private addScatter(zone: ZoneDef, theme: ZoneTheme, clearings: Clearing[]): void {
    const blocked = (x: number, z: number): boolean =>
      clearings.some((c) => Math.hypot(x - c.x, z - c.z) < c.r);
    // A local PRNG, seeded per zone so each place has its own arrangement and
    // every load of that place is identical. Deliberately NOT the sim's Rng:
    // decor must never be able to shift a gameplay roll.
    const rng = mulberry(hash(zone.id));
    const group = new THREE.Group();

    for (const spec of theme.props) {
      const built = buildProp(spec);
      for (let i = 0; i < spec.count; i++) {
        const x = (rng() * 2 - 1) * zone.halfSize * 0.95;
        const z = (rng() * 2 - 1) * zone.halfSize * 0.95;
        if (blocked(x, z)) continue;
        const scale = spec.scale * (1 + (rng() * 2 - 1) * (spec.jitter ?? 0.4) * 0.5);
        const prop = built.clone();
        prop.position.set(x, this.height.at(x, z), z);
        prop.scale.setScalar(scale);
        prop.rotation.y = rng() * Math.PI * 2;
        // Lean stones and dead wood slightly; nothing in a wild place is plumb.
        if (spec.kind === 'standingStone' || spec.kind === 'deadTree') {
          prop.rotation.z = (rng() * 2 - 1) * 0.12;
        }
        group.add(prop);
      }
    }
    this.zoneRoot.add(group);
  }

  /**
   * Slow drifting particles. Cheap, and it is most of what separates "a forest
   * at dusk" from "a forest with the brightness turned down".
   */
  private addMotes(zone: ZoneDef, theme: ZoneTheme): void {
    if (!theme.motes) return;
    const rng = mulberry(hash(zone.id) ^ 0x5eed);
    const positions = new Float32Array(theme.motes.count * 3);
    for (let i = 0; i < theme.motes.count; i++) {
      const x = (rng() * 2 - 1) * zone.halfSize * 0.9;
      const z = (rng() * 2 - 1) * zone.halfSize * 0.9;
      positions[i * 3] = x;
      positions[i * 3 + 1] = this.height.at(x, z) + 0.5 + rng() * theme.motes.height;
      positions[i * 3 + 2] = z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.motes = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: theme.motes.color,
        size: theme.motes.size,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        fog: true,
      }),
    );
    this.zoneRoot.add(this.motes);
  }

  /** A low wall marking the zone edge, so the clamp in the sim is legible. */
  private addBoundary(zone: ZoneDef, theme: ZoneTheme): void {
    const s = zone.halfSize;
    const mat = new THREE.MeshStandardMaterial({ color: theme.boundary, roughness: 1 });
    const group = new THREE.Group();
    // Segmented rather than four long boxes, so the wall follows the hills
    // instead of hovering over the valleys.
    const step = 8;
    for (let t = -s; t < s; t += step) {
      const mid = t + step / 2;
      for (const [x, z, w, d] of [
        [mid, -s, step, 0.6],
        [mid, s, step, 0.6],
        [-s, mid, 0.6, step],
        [s, mid, 0.6, step],
      ] as Array<[number, number, number, number]>) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 2.4, d), mat);
        wall.position.set(x, this.height.at(x, z) + 0.9, z);
        wall.castShadow = true;
        wall.receiveShadow = true;
        group.add(wall);
      }
    }
    this.zoneRoot.add(group);
  }

  /** Orbit the camera around a focus point. */
  updateCamera(focus: THREE.Vector3): void {
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
    if (!this.motes) return;
    this.motes.rotation.y += dtMs * 0.000018;
    this.motes.position.y = Math.sin(performance.now() * 0.0004) * 0.35;
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
 * Build one scatter prop. Placeholder geometry, same as the entity capsules —
 * the point is silhouette and colour, which is what reads at camera distance.
 */
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
function tintGround(geo: THREE.BufferGeometry, theme: ZoneTheme): void {
  const pos = geo.attributes.position!;
  const colors = new Float32Array(pos.count * 3);
  const dry = new THREE.Color(theme.ground.dry);
  const damp = new THREE.Color(theme.ground.damp);
  const jitter = mulberry(90210);
  const tmp = new THREE.Color();
  const amp = Math.max(0.5, theme.terrain.amplitude);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const n =
      Math.sin(x * 0.06) * 0.5 +
      Math.cos(z * 0.045) * 0.5 +
      Math.sin((x + z) * 0.11) * 0.25 +
      Math.cos((x - z) * 0.17) * 0.15;
    const low = -pos.getY(i) / amp; // below zero = hollow = damp
    const t = Math.max(0, Math.min(1, 0.5 + n * 0.32 + low * 0.3));
    tmp.copy(dry).lerp(damp, t);
    const v = 0.94 + jitter() * 0.12;
    colors[i * 3] = tmp.r * v;
    colors[i * 3 + 1] = tmp.g * v;
    colors[i * 3 + 2] = tmp.b * v;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
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
