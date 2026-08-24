import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { ModelDef } from '../content/models.js';

/**
 * Loads the real art, when there is any.
 *
 * One loader, one cache, one clone per entity. Everything here is best-effort:
 * a file that is missing, malformed or slow does not stop a creature existing,
 * it just leaves the capsule standing. That is the property that makes this
 * safe to leave switched on with an empty `MODELS` table — the game is exactly
 * what it was, and the moment somebody drops a file in, it is not.
 *
 * ## Fitting
 *
 * Every model is scaled so its bounding box is exactly the height the creature
 * was authored at, then dropped so its feet sit on y=0. Art arrives in metres,
 * centimetres, or whatever the exporter felt like; without this a wolf renders
 * forty units tall and standing in the ground, and the person who made the
 * wolf has no way to know it was their exporter and not the game.
 */

export interface LoadedModel {
  /** A fresh clone, fitted and ready to add to an `EntityView`. */
  root: THREE.Object3D;
  /** Animation clips, if the file carried any. */
  clips: THREE.AnimationClip[];
}

interface CacheEntry {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  /** Scale that makes this model exactly one unit tall. */
  unitScale: number;
}

export class ModelLibrary {
  private readonly loader = new GLTFLoader();
  private readonly cache = new Map<string, Promise<CacheEntry | null>>();
  /** Files already reported as missing, so one typo is one console line. */
  private readonly complained = new Set<string>();

  /**
   * Fetch and fit a model.
   *
   * Resolves to null for anything that does not load. Callers treat that as
   * "keep the capsule" rather than as an error, because on a project where the
   * art arrives one creature at a time, most of the table is missing most of
   * the time and that is the normal state of the world.
   */
  async get(def: ModelDef, height: number): Promise<LoadedModel | null> {
    const entry = await this.load(def.file);
    if (!entry) return null;

    // SkeletonUtils rather than Object3D.clone: a plain clone of a skinned
    // mesh shares the skeleton, so every wolf in a camp plays whichever
    // animation the last one was told to play.
    const root = cloneSkinned(entry.scene);
    const fit = entry.unitScale * height * (def.scale ?? 1);
    root.scale.setScalar(fit);
    root.position.y = def.lift ?? 0;
    if (def.turn) root.rotation.y = def.turn;

    root.traverse((o: THREE.Object3D) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });

    return { root, clips: entry.clips };
  }

  private load(file: string): Promise<CacheEntry | null> {
    const cached = this.cache.get(file);
    if (cached) return cached;

    const pending = new Promise<CacheEntry | null>((resolve) => {
      this.loader.load(
        file,
        (gltf) => {
          const scene = gltf.scene;
          // Measure before anything is scaled or moved, and normalise to one
          // unit tall so the per-creature fit is a single multiply.
          const box = new THREE.Box3().setFromObject(scene);
          const size = new THREE.Vector3();
          box.getSize(size);
          const tall = Math.max(0.0001, size.y);
          // Drop it so its feet are at the origin. A model authored around its
          // hips renders half-buried, and "sunk into the ground" is the single
          // most common thing wrong with a first export.
          scene.position.y -= box.min.y;
          resolve({ scene, clips: gltf.animations ?? [], unitScale: 1 / tall });
        },
        undefined,
        () => {
          if (!this.complained.has(file)) {
            this.complained.add(file);
            console.warn(`No model at ${file} — that creature stays a capsule.`);
          }
          resolve(null);
        },
      );
    });

    this.cache.set(file, pending);
    return pending;
  }
}
