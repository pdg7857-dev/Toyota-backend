import * as THREE from 'three';
import type { ZoneDef } from '../content/zone.js';

/**
 * Scene, lighting, terrain and the follow camera.
 *
 * Everything here is presentation. The sim has no idea any of it exists, and
 * swapping placeholder geometry for real art means editing this file and
 * `views.ts` only.
 */
export class SceneRig {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly ground: THREE.Mesh;

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
    this.scene.background = new THREE.Color(0x8fa9b8);
    this.scene.fog = new THREE.Fog(0x8fa9b8, 45, 130);

    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 400);

    const hemi = new THREE.HemisphereLight(0xbcd6e8, 0x4a5a3a, 0.85);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff0d0, 1.5);
    sun.position.set(30, 55, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = zone.halfSize;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.camera.far = 200;
    this.scene.add(sun);
    this.scene.add(sun.target);

    // Ground. Geometrically flat for the slice — the sim is 2D, so real terrain
    // height needs a heightmap both sides can sample. Colour is varied per
    // vertex so a large flat plane doesn't read as a billiard table.
    const groundGeo = new THREE.PlaneGeometry(zone.halfSize * 2, zone.halfSize * 2, 64, 64);
    groundGeo.rotateX(-Math.PI / 2);
    tintGround(groundGeo);
    this.ground = new THREE.Mesh(
      groundGeo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }),
    );
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.addScatter(zone);
    this.addBoundary(zone);

    window.addEventListener('resize', () => this.onResize());
  }

  /** Rocks and trees so the world reads as a place and movement has parallax. */
  private addScatter(zone: ZoneDef): void {
    const rng = mulberry(1337);
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 3.2, 6);
    const leafGeo = new THREE.ConeGeometry(1.7, 3.6, 7);
    const rockGeo = new THREE.DodecahedronGeometry(0.7, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x35562f, roughness: 1 });
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x6d6d68, roughness: 1 });

    const trees = new THREE.Group();
    for (let i = 0; i < 120; i++) {
      const x = (rng() * 2 - 1) * zone.halfSize * 0.95;
      const z = (rng() * 2 - 1) * zone.halfSize * 0.95;
      // Keep the spawn clearing and the boss arena readable.
      if (Math.hypot(x, z - zone.playerStart.z) < 10) continue;
      if (Math.hypot(x, z + 55) < 14) continue;
      const scale = 0.7 + rng() * 0.8;
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.set(x, 1.6 * scale, z);
      trunk.scale.setScalar(scale);
      trunk.castShadow = true;
      const leaves = new THREE.Mesh(leafGeo, leafMat);
      leaves.position.set(x, (3.2 + 1.4) * scale, z);
      leaves.scale.setScalar(scale);
      leaves.castShadow = true;
      trees.add(trunk, leaves);
    }
    for (let i = 0; i < 70; i++) {
      const rock = new THREE.Mesh(rockGeo, rockMat);
      rock.position.set(
        (rng() * 2 - 1) * zone.halfSize * 0.95,
        0.25,
        (rng() * 2 - 1) * zone.halfSize * 0.95,
      );
      rock.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      rock.scale.setScalar(0.4 + rng() * 0.9);
      rock.castShadow = true;
      rock.receiveShadow = true;
      trees.add(rock);
    }
    this.scene.add(trees);
  }

  /** A low wall marking the zone edge, so the clamp in the sim is legible. */
  private addBoundary(zone: ZoneDef): void {
    const s = zone.halfSize;
    const mat = new THREE.MeshStandardMaterial({ color: 0x3d4a33, roughness: 1 });
    const group = new THREE.Group();
    const specs: Array<[number, number, number, number]> = [
      [0, -s, s * 2, 0.6],
      [0, s, s * 2, 0.6],
      [-s, 0, 0.6, s * 2],
      [s, 0, 0.6, s * 2],
    ];
    for (const [x, z, w, d] of specs) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 1.6, d), mat);
      wall.position.set(x, 0.8, z);
      wall.castShadow = true;
      wall.receiveShadow = true;
      group.add(wall);
    }
    this.scene.add(group);
  }

  /** Orbit the camera around a focus point. */
  updateCamera(focus: THREE.Vector3): void {
    const p = Math.max(0.15, Math.min(1.35, this.pitch));
    const horiz = Math.cos(p) * this.distance;
    this.camera.position.set(
      focus.x - Math.sin(this.yaw) * horiz,
      focus.y + Math.sin(p) * this.distance,
      focus.z - Math.cos(this.yaw) * horiz,
    );
    this.camera.lookAt(focus.x, focus.y + 1.0, focus.z);
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
 * Paint per-vertex colour variation onto the ground: broad damp/dry patches
 * from layered sine noise, plus fine per-vertex jitter to break up banding.
 */
function tintGround(geo: THREE.BufferGeometry): void {
  const pos = geo.attributes.position!;
  const colors = new Float32Array(pos.count * 3);
  const dry = new THREE.Color(0x6d854a);
  const damp = new THREE.Color(0x3f5a33);
  const jitter = mulberry(90210);
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const n =
      Math.sin(x * 0.06) * 0.5 +
      Math.cos(z * 0.045) * 0.5 +
      Math.sin((x + z) * 0.11) * 0.25 +
      Math.cos((x - z) * 0.17) * 0.15;
    const t = Math.max(0, Math.min(1, 0.5 + n * 0.45));
    tmp.copy(dry).lerp(damp, t);
    const v = 0.94 + jitter() * 0.12;
    colors[i * 3] = tmp.r * v;
    colors[i * 3 + 1] = tmp.g * v;
    colors[i * 3 + 2] = tmp.b * v;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
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
