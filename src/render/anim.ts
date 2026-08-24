import * as THREE from 'three';
import type { Joint } from '../content/bodies.js';

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
 * With no art it drives procedural transforms on placeholder capsules. Give it
 * a rigged model through `attachModel` and it crossfades that model's clips
 * instead, from the same states, driven by the same sim events. Nothing outside
 * this file knows which of the two is happening — which is the whole point of
 * the seam, and why dropping a `.glb` into `public/models/` is a content change
 * rather than a renderer change.
 */
export class AnimStateMachine {
  private state: AnimState = 'idle';
  private elapsedMs = 0;
  private locomotion: 'idle' | 'walk' | 'run' = 'idle';
  private phase = 0;

  // Set once a rigged model arrives. Null means capsules and procedural bob.
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<AnimState, THREE.AnimationAction>();
  private playing: THREE.AnimationAction | null = null;

  constructor(
    private readonly root: THREE.Object3D,
    private readonly baseHeight: number,
    /**
     * Limbs that can move on their own. Empty for an ordinary creature, whose
     * whole body is one welded geometry — see `render/body.ts` for why.
     */
    private readonly joints: ReadonlyMap<Joint, THREE.Object3D> = new Map(),
    /** How much of the body's height is legs, from its `BodyPlan`. */
    private readonly legFraction = 0.5,
  ) {
    for (const [joint, limb] of this.joints) this.rest.set(joint, limb.rotation.clone());
  }

  /** Where each limb hangs when nothing is driving it. */
  private readonly rest = new Map<Joint, THREE.Euler>();

  /** How much of the gait the trunk itself carries. See `applyPlaceholder`. */
  private get trunkGait(): number {
    return this.joints.size > 0 ? 0.35 : 1;
  }

  /**
   * Hand it a model and the clips for each state.
   *
   * A state with no clip is simply absent from the map; `play` falls through to
   * whatever is already running rather than snapping to a T-pose, because a
   * model with only an idle animation is still an enormous improvement on a
   * capsule and should not be punished for being incomplete.
   */
  attachModel(model: THREE.Object3D, clips: Map<AnimState, THREE.AnimationClip>): void {
    if (clips.size === 0) return;
    this.mixer = new THREE.AnimationMixer(model);
    for (const [state, clip] of clips) {
      const action = this.mixer.clipAction(clip);
      if (STATES[state].oneShot) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions.set(state, action);
    }
    // Reset the procedural transforms: they are baked into the body node and
    // would otherwise sit under the animation as a permanent lean. The
    // placeholder's own limbs go with it — real art brings its own.
    this.root.rotation.set(0, 0, 0);
    this.root.position.y = 0;
    for (const limb of this.joints.values()) limb.visible = false;
    this.play(this.state);
  }

  /** Crossfade to a state's clip, if there is one. */
  private play(state: AnimState): void {
    const next = this.actions.get(state);
    if (!next || next === this.playing) return;
    const blend = STATES[state].blendMs / 1000;
    next.reset().setEffectiveWeight(1).fadeIn(blend).play();
    if (this.playing) this.playing.fadeOut(blend);
    this.playing = next;
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
      this.play(this.state);
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
    this.play(state);
  }

  update(dtMs: number): void {
    this.elapsedMs += dtMs;
    this.phase += dtMs / 1000;

    const spec = STATES[this.state];
    if (spec.oneShot && this.state !== 'death' && this.elapsedMs >= spec.durationMs) {
      this.state = this.locomotion;
      this.elapsedMs = 0;
      this.play(this.state);
    }

    if (this.mixer) {
      this.mixer.update(dtMs / 1000);
      return;
    }
    this.applyPlaceholder();
    if (this.joints.size > 0) this.applyLimbs();
  }

  /** Procedural stand-in for real clips: bob, lunge, stagger, topple. */
  private applyPlaceholder(): void {
    const t = this.elapsedMs / 1000;
    this.root.rotation.x = 0;
    this.root.rotation.z = 0;
    this.root.position.y = 0;

    switch (this.state) {
      case 'walk': {
        // Same gait as the run, at a third the rate and half the lean. Damped
        // right down on a body with real legs: the limbs are already carrying
        // the gait, and both at full strength reads as a bounce.
        const bob = Math.abs(Math.sin(this.phase * 3.4)) * 0.05 * this.trunkGait;
        this.root.position.y = bob;
        this.root.rotation.x = Math.sin(this.phase * 3.4) * 0.025 * this.trunkGait;
        break;
      }
      case 'run': {
        const bob = Math.abs(Math.sin(this.phase * 9)) * 0.12 * this.trunkGait;
        this.root.position.y = bob;
        this.root.rotation.x = Math.sin(this.phase * 9) * 0.06 * this.trunkGait;
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
        // Ease-out topple onto the side, coming down by however much of the
        // body was legs. A stag on long legs has further to fall than an adder
        // that was already lying on the ground, and a single constant made one
        // of those two hang in the air and the other sink through the hill.
        const eased = 1 - Math.pow(1 - p, 3);
        this.root.rotation.z = eased * (Math.PI / 2);
        this.root.position.y = -eased * this.baseHeight * this.legFraction * 0.8;
        break;
      }
    }
  }

  /**
   * The gait.
   *
   * Two-legged and four-legged bodies walk from the same numbers: a phase, a
   * swing amplitude, and which limbs are out of step with which. Legs on
   * opposite corners move together — that is a trot, it is what every animal
   * in this game does, and it is the difference between a wolf running and a
   * wolf shuffling.
   */
  private applyLimbs(): void {
    const rate = this.state === 'run' ? 9 : this.state === 'walk' ? 3.4 : 1.6;
    const swing =
      this.state === 'run' ? 0.85 : this.state === 'walk' ? 0.4 : this.state === 'idle' ? 0.03 : 0.12;
    const p = this.phase * rate;
    const a = Math.sin(p) * swing;
    const b = Math.sin(p + Math.PI) * swing;

    // A one-shot overrides the arms without touching the legs, so a figure can
    // swing at something while still moving its feet.
    const oneShot = this.state === 'attack' || this.state === 'hit';
    const t = this.elapsedMs / Math.max(1, STATES[this.state].durationMs);
    const strike =
      this.state === 'attack'
        ? (t < 0.35 ? -t * 2.6 : 1.6 - (t - 0.35) * 3.4)
        : this.state === 'hit'
          ? Math.sin(Math.min(1, t) * Math.PI) * 0.7
          : 0;

    for (const [joint, limb] of this.joints) {
      const rest = this.rest.get(joint);
      if (!rest) continue;
      let x = rest.x;
      let z = rest.z;
      switch (joint) {
        // Diagonal pairs. A biped's two legs are simply the front pair.
        case 'legL':
        case 'legFL':
        case 'legBR':
          x = rest.x + a;
          break;
        case 'legR':
        case 'legFR':
        case 'legBL':
          x = rest.x + b;
          break;
        // Arms counter-swing against the legs, which is most of what makes a
        // walk read as a walk rather than a slide.
        case 'armL':
          x = rest.x + (oneShot ? strike * 0.3 : b * 0.75);
          break;
        case 'armR':
          x = rest.x + (oneShot ? strike : a * 0.75);
          break;
        case 'wingL':
          z = rest.z - Math.abs(a) * 0.9;
          break;
        case 'wingR':
          z = rest.z + Math.abs(a) * 0.9;
          break;
        case 'tail':
          // A tail follows the body a beat late rather than keeping time with
          // it, which is the whole reason it reads as slack rather than rigid.
          x = rest.x + Math.sin(p - 0.9) * swing * 0.35;
          break;
        case 'head':
          x = rest.x + (this.state === 'cast' ? Math.sin(this.phase * 12) * 0.06 : a * 0.12);
          break;
      }
      limb.rotation.x = x;
      limb.rotation.z = z;
    }
  }

  reset(): void {
    this.state = 'idle';
    this.elapsedMs = 0;
    this.root.rotation.set(0, 0, 0);
    this.root.position.y = 0;
    // A respawn has to clear the death clip, or a creature comes back lying
    // down — `clampWhenFinished` is exactly what makes death read, and exactly
    // what makes this necessary.
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.playing = null;
      this.play('idle');
    }
  }
}
