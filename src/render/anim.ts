import * as THREE from 'three';

export type AnimState = 'idle' | 'walk' | 'run' | 'attack' | 'cast' | 'hit' | 'death';

interface StateSpec {
  /** How long a one-shot state plays before falling back to idle/run. */
  durationMs: number;
  /** One-shot states cannot be interrupted by locomotion changes. */
  oneShot: boolean;
  /** Crossfade time into this state, in ms. */
  blendMs: number;
}

const STATES: Record<AnimState, StateSpec> = {
  idle: { durationMs: 0, oneShot: false, blendMs: 200 },
  walk: { durationMs: 0, oneShot: false, blendMs: 180 },
  run: { durationMs: 0, oneShot: false, blendMs: 150 },
  attack: { durationMs: 420, oneShot: true, blendMs: 60 },
  cast: { durationMs: 0, oneShot: false, blendMs: 120 },
  hit: { durationMs: 220, oneShot: true, blendMs: 40 },
  death: { durationMs: 900, oneShot: true, blendMs: 100 },
};

/** Below this it is standing still; above WALK_ABOVE it is running. */
const STILL = 0.35;
const WALK_ABOVE = 2.4;

/**
 * Animation state machine.
 *
 * Right now it drives procedural transforms on placeholder capsules. The
 * important part is the *interface*: sim events call `request()`, and `update()`
 * advances whatever is playing. When rigged glTF models arrive, the body of
 * `applyPlaceholder` is replaced by `THREE.AnimationMixer` actions —
 * `this.actions[state].reset().fadeIn(spec.blendMs / 1000).play()` — and
 * nothing outside this file changes.
 */
export class AnimStateMachine {
  private state: AnimState = 'idle';
  private elapsedMs = 0;
  private locomotion: 'idle' | 'walk' | 'run' = 'idle';
  private phase = 0;

  // Populated once real models exist. Kept here so the seam is obvious.
  private mixer: THREE.AnimationMixer | null = null;

  constructor(
    private readonly root: THREE.Object3D,
    private readonly baseHeight: number,
  ) {}

  /** Attach a mixer when a rigged model replaces the placeholder mesh. */
  attachMixer(mixer: THREE.AnimationMixer): void {
    this.mixer = mixer;
  }

  get current(): AnimState {
    return this.state;
  }

  /**
   * Locomotion is continuous and yields to any one-shot currently playing.
   *
   * Takes a speed rather than a boolean because a creature grazing across its
   * camp and one running you down are the same movement to a threshold test,
   * and a wolf sprinting in a slow circle around a bush reads as broken.
   */
  setMoving(unitsPerSecond: number): void {
    this.locomotion =
      unitsPerSecond < STILL ? 'idle' : unitsPerSecond < WALK_ABOVE ? 'walk' : 'run';
    if (!STATES[this.state].oneShot && this.state !== 'cast' && this.state !== 'death') {
      this.state = this.locomotion;
    }
  }

  request(state: AnimState): void {
    if (this.state === 'death') return; // death wins over everything
    // Don't let a hit reaction stomp an attack mid-swing; it reads as a stutter.
    if (state === 'hit' && this.state === 'attack' && this.elapsedMs < STATES.attack.durationMs) {
      return;
    }
    this.state = state;
    this.elapsedMs = 0;
  }

  update(dtMs: number): void {
    this.elapsedMs += dtMs;
    this.phase += dtMs / 1000;

    const spec = STATES[this.state];
    if (spec.oneShot && this.state !== 'death' && this.elapsedMs >= spec.durationMs) {
      this.state = this.locomotion;
      this.elapsedMs = 0;
    }

    if (this.mixer) {
      this.mixer.update(dtMs / 1000);
      return;
    }
    this.applyPlaceholder();
  }

  /** Procedural stand-in for real clips: bob, lunge, stagger, topple. */
  private applyPlaceholder(): void {
    const t = this.elapsedMs / 1000;
    this.root.rotation.x = 0;
    this.root.rotation.z = 0;
    this.root.position.y = 0;

    switch (this.state) {
      case 'walk': {
        // Same gait as the run, at a third the rate and half the lean.
        const bob = Math.abs(Math.sin(this.phase * 3.4)) * 0.05;
        this.root.position.y = bob;
        this.root.rotation.x = Math.sin(this.phase * 3.4) * 0.025;
        break;
      }
      case 'run': {
        const bob = Math.abs(Math.sin(this.phase * 9)) * 0.12;
        this.root.position.y = bob;
        this.root.rotation.x = Math.sin(this.phase * 9) * 0.06;
        break;
      }
      case 'idle': {
        this.root.position.y = Math.sin(this.phase * 1.8) * 0.03;
        break;
      }
      case 'attack': {
        // Quick wind-up then a snap forward.
        const p = Math.min(1, this.elapsedMs / STATES.attack.durationMs);
        const swing = p < 0.35 ? -p * 0.9 : (p - 0.35) * 1.6 - 0.31;
        this.root.rotation.x = swing * 0.55;
        break;
      }
      case 'cast': {
        this.root.position.y = Math.sin(this.phase * 12) * 0.04;
        break;
      }
      case 'hit': {
        const p = Math.min(1, this.elapsedMs / STATES.hit.durationMs);
        this.root.rotation.x = Math.sin(p * Math.PI) * -0.22;
        break;
      }
      case 'death': {
        const p = Math.min(1, t / (STATES.death.durationMs / 1000));
        // Ease-out topple onto the side, sinking slightly into the ground.
        const eased = 1 - Math.pow(1 - p, 3);
        this.root.rotation.z = eased * (Math.PI / 2);
        this.root.position.y = -eased * this.baseHeight * 0.35;
        break;
      }
    }
  }

  reset(): void {
    this.state = 'idle';
    this.elapsedMs = 0;
    this.root.rotation.set(0, 0, 0);
    this.root.position.y = 0;
  }
}
