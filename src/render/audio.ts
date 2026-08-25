import type { DamageType, Entity, EntityId, SimEvent } from '../sim/types.js';
import type { World } from '../sim/world.js';
import { getItem } from '../content/items.js';

/**
 * Sound.
 *
 * Every noise in this game is **synthesised at runtime** — there is not one
 * audio file in the repository. That is not a purity exercise; it is what makes
 * sound affordable on a project where the art is placeholder capsules. A decent
 * library of combat samples is tens of megabytes and somebody else's licence,
 * and the alternative to synthesis was not "better sound", it was **silence**,
 * which is what the game shipped with until now.
 *
 * ## Where this sits
 *
 * Audio is a *third subscriber* to the same `SimEvent` stream the HUD and the
 * views already read. It calls nothing, mutates nothing, and the sim has no
 * idea it exists — so a muted game and a loud one run identically, and the
 * whole file could be deleted without the simulation noticing. That is the same
 * rule the renderer runs under, and it is why sound could be added in an
 * afternoon rather than a week.
 *
 * ## The two rules that stop it being a nuisance
 *
 * - **Distance decides volume.** Six hundred creatures are alive in a zone and
 *   most of them are fighting nobody, but a camp two hundred metres away that
 *   is audible at all is a camp you can hear through a hill. Anything not
 *   involving the player fades with distance and is silent past `EARSHOT`.
 * - **Nothing plays twice in the same instant.** A boss with adds can emit six
 *   damage events in one tick; six identical thuds stacked on one sample is not
 *   six hits, it is a click. Each voice has a floor on how often it can retrigger.
 */

/** How far away a sound involving somebody else can still be heard. */
const EARSHOT = 70;

/** Nothing is ever this quiet — below it, do not spend a voice at all. */
const SILENT_BELOW = 0.02;

const STORE_KEY = 'emerald-isle:audio';

/** Sounds that can retrigger no faster than this, per voice, in ms. */
const RETRIGGER_MS: Record<string, number> = {
  swing: 55,
  hit: 45,
  miss: 70,
  heal: 90,
  step: 200,
};

type Voice =
  | 'swing'
  | 'hit'
  | 'crit'
  | 'hurt'
  | 'miss'
  | 'dodge'
  | 'cast'
  | 'castDone'
  | 'heal'
  | 'levelUp'
  | 'coin'
  | 'loot'
  | 'death'
  | 'playerDeath'
  | 'telegraph'
  | 'enrage'
  | 'hazard'
  | 'interrupt'
  | 'quest'
  | 'learn'
  | 'drink'
  | 'error';

export class GameAudio {
  private ctx: BaseAudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private ambient!: GainNode;
  /** One shared noise buffer — regenerating white noise per shot is wasteful. */
  private noise!: AudioBuffer;

  private windSource: AudioBufferSourceNode | null = null;
  private windFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private rainFilter!: BiquadFilterNode;
  private rainGain!: GainNode;

  private lastAt = new Map<string, number>();
  private muted = false;
  private volume = 0.7;
  private started = false;
  private analyser: AnalyserNode | null = null;
  private peaks: Float32Array<ArrayBuffer> | null = null;

  constructor(private readonly world: World) {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as {
        muted?: boolean;
        volume?: number;
      };
      if (typeof saved.muted === 'boolean') this.muted = saved.muted;
      if (typeof saved.volume === 'number') this.volume = Math.max(0, Math.min(1, saved.volume));
    } catch {
      // A corrupt preference is not worth a broken game.
    }
  }

  /**
   * Build the graph on the first real gesture.
   *
   * Browsers refuse to start an `AudioContext` before the user has interacted,
   * and a context created too early stays suspended forever with no error — the
   * game is simply silent and nothing says why. Class select is a click, so
   * that is where this gets called from.
   */
  start(given?: BaseAudioContext): void {
    if (this.started) return;
    this.started = true;
    if (given) {
      // An injected context is how this gets tested at all. A machine with no
      // sound card — every CI runner, and the browser `smoke` drives — has an
      // `AudioContext` whose clock does not reliably advance, so measuring a
      // live one reports a working synthesiser as silence about half the time.
      // Rendered offline the same graph is exact and repeatable.
      this.ctx = given;
    } else {
      try {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
      } catch {
        return; // No audio available. The game is exactly as playable.
      }
    }
    const ctx = this.ctx;

    // A compressor on the master, because combat is bursty: a crit landing on
    // the same frame as a telegraph and a level-up will clip an untouched bus.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.16;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);

    this.ambient = ctx.createGain();
    this.ambient.gain.value = 0.5;
    this.ambient.connect(this.master);

    this.noise = this.makeNoise(ctx);
    this.buildWeatherBeds(ctx);
    // `instanceof`, not a `'resume' in ctx` duck-check: an OfflineAudioContext
    // *has* a resume method and throws when it is called before rendering.
    if (typeof AudioContext !== 'undefined' && ctx instanceof AudioContext) void ctx.resume();
  }

  // ------------------------------------------------------------------ mixing

  get isMuted(): boolean {
    return this.muted;
  }

  get level(): number {
    return this.volume;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.applyMaster();
    return this.muted;
  }

  /** Step the volume. Returns the new level, 0 to 1. */
  nudge(delta: number): number {
    this.volume = Math.max(0, Math.min(1, Math.round((this.volume + delta) * 20) / 20));
    // Turning it up off zero is obviously meant to unmute it.
    if (this.volume > 0 && delta > 0) this.muted = false;
    this.applyMaster();
    return this.volume;
  }

  private applyMaster(): void {
    if (this.ctx) {
      // Ramped rather than set: a gain jump on a running noise bed is a click.
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.02);
    }
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ muted: this.muted, volume: this.volume }));
    } catch {
      // Not being able to remember the setting is not worth an exception.
    }
  }

  // ------------------------------------------------------------------ events

  /**
   * React to a tick's worth of events.
   *
   * Deliberately takes the whole array rather than being called per event: the
   * retrigger floor needs to see a burst as a burst.
   */
  handleEvents(events: SimEvent[]): void {
    if (!this.ctx || this.muted) return;
    const me = this.world.playerId;

    for (const ev of events) {
      switch (ev.t) {
        case 'swing':
          this.play('swing', this.gainFor(ev.sourceId) * 0.5);
          break;
        case 'damage': {
          const mine = ev.sourceId === me;
          const atMe = ev.targetId === me;
          const g = this.gainFor(atMe ? ev.sourceId : ev.targetId);
          if (atMe) this.play('hurt', Math.min(1, 0.5 + ev.amount / 400));
          else if (ev.crit) this.play('crit', g);
          else this.play('hit', g, ev.damageType);
          // Somebody else's fight in the distance is texture, not information.
          void mine;
          break;
        }
        case 'miss':
          this.play('miss', this.gainFor(ev.targetId) * 0.6);
          break;
        case 'dodged':
          if (ev.targetId === me) this.play('dodge', 0.85);
          break;
        case 'heal':
          this.play('heal', this.gainFor(ev.targetId) * 0.8);
          break;
        case 'castBegin':
          if (ev.sourceId === me) this.play('cast', 0.4);
          break;
        case 'castComplete':
          if (ev.sourceId === me && ev.kind === 'skill') this.play('castDone', 0.45);
          break;
        case 'telegraph':
          // The one sound that is always full volume regardless of distance:
          // it is a warning, and a warning you might not hear is not one.
          this.play('telegraph', 1);
          break;
        case 'hazard':
          this.play('hazard', this.gainFor(ev.sourceId));
          break;
        case 'enraged':
          this.play('enrage', this.gainFor(ev.entityId));
          break;
        case 'interrupted':
          if (ev.sourceId === me) this.play('interrupt', 0.9);
          break;
        case 'death':
          if (ev.entityId === me) this.play('playerDeath', 1);
          else this.play('death', this.gainFor(ev.entityId) * 0.8);
          break;
        case 'lootGained': {
          if (ev.gold > 0) this.play('coin', 0.7);
          if (ev.items.length === 0) break;
          // A rare or an epic is the one drop in a thousand a player is
          // actually listening for. Same voice, full volume — a whole new
          // sound for it would be a second thing to learn, and the point is
          // that this one is unmistakably the good version of the one they
          // hear four hundred times an hour.
          const prize = ev.items.some((st) => {
            const q = getItem(st.itemId).quality;
            return q === 'rare' || q === 'epic';
          });
          this.play('loot', prize ? 1 : 0.7);
          break;
        }
        case 'levelUp':
          this.play('levelUp', 1);
          break;
        case 'skillRanked':
        case 'skillUnlocked':
          this.play('learn', 0.8);
          break;
        case 'questCompleted':
        case 'questReady':
          this.play('quest', 0.8);
          break;
        case 'consumed':
          this.play('drink', 0.8);
          break;
        case 'error':
          this.play('error', 0.5);
          break;
      }
    }
  }

  /** Ambient beds follow the weather and the hour. Called once a frame. */
  update(): void {
    if (!this.ctx) return;
    const weather = this.world.weather();
    const light = this.world.daylight();
    const t = this.ctx.currentTime;

    // Wind is always there and lifts at night, which is most of what makes an
    // empty moor at midnight feel different from the same moor at noon.
    const nightLift = light.dark ? 1.5 : 1;
    const windTarget = (weather.kind === 'clear' ? 0.05 : 0.09) * nightLift;
    this.windGain.gain.setTargetAtTime(this.muted ? 0 : windTarget, t, 1.2);
    this.windFilter.frequency.setTargetAtTime(light.dark ? 320 : 480, t, 2);

    // Rain is a brighter, denser bed on top. Mist gets a whisper of it, because
    // silence under thick mist reads as the sound engine having stopped.
    const rainTarget =
      weather.kind === 'rain'
        ? 0.16 * weather.intensity
        : weather.kind === 'mist'
          ? 0.03 * weather.intensity
          : weather.kind === 'snow'
            ? 0.02 * weather.intensity
            : 0;
    this.rainGain.gain.setTargetAtTime(this.muted ? 0 : rainTarget, t, 1.5);
  }

  // ------------------------------------------------------------------ voices

  /** How loud something happening at this entity should be, 0 to 1. */
  private gainFor(id: EntityId): number {
    if (id === this.world.playerId) return 1;
    const entity: Entity | undefined = this.world.entity(id);
    if (!entity) return 0;
    const player = this.world.player;
    const d = Math.hypot(entity.pos.x - player.pos.x, entity.pos.z - player.pos.z);
    if (d >= EARSHOT) return 0;
    // Squared falloff, so a fight ten metres off is present and one forty
    // metres off is a rumour.
    const near = 1 - d / EARSHOT;
    return near * near;
  }

  private play(voice: Voice, gain: number, damageType?: DamageType): void {
    const ctx = this.ctx;
    if (!ctx || gain < SILENT_BELOW) return;

    const floor = RETRIGGER_MS[voice];
    if (floor !== undefined) {
      const now = ctx.currentTime * 1000;
      const last = this.lastAt.get(voice) ?? -Infinity;
      if (now - last < floor) return;
      this.lastAt.set(voice, now);
    }

    const t = ctx.currentTime;
    switch (voice) {
      case 'swing':
        // A whoosh: filtered noise sweeping down, gone in a tenth of a second.
        this.noiseShot(t, gain * 0.5, 0.11, 'bandpass', 1400, 500);
        break;
      case 'hit': {
        // Thud plus click. The tone follows the damage school, so a fire spell
        // and a sword do not land on the same note.
        const base = damageType === 'frost' ? 150 : damageType === 'fire' ? 90 : 110;
        this.tone(t, gain * 0.55, 0.13, base, base * 0.5, 'sine');
        this.noiseShot(t, gain * 0.3, 0.05, 'highpass', 1800, 2600);
        break;
      }
      case 'crit':
        // Louder, brighter, and with a second layer a shade later so it reads
        // as a bigger event rather than the same event turned up.
        this.tone(t, gain * 0.7, 0.18, 140, 60, 'sine');
        this.noiseShot(t, gain * 0.45, 0.09, 'highpass', 2600, 3600);
        this.tone(t + 0.035, gain * 0.35, 0.2, 520, 240, 'triangle');
        break;
      case 'hurt':
        this.tone(t, gain * 0.5, 0.2, 190, 70, 'sawtooth', 420);
        break;
      case 'miss':
        this.noiseShot(t, gain * 0.28, 0.14, 'bandpass', 900, 380);
        break;
      case 'dodge':
        this.noiseShot(t, gain * 0.5, 0.26, 'bandpass', 700, 220);
        break;
      case 'cast':
        this.tone(t, gain * 0.3, 0.5, 220, 460, 'sine');
        break;
      case 'castDone':
        this.tone(t, gain * 0.35, 0.28, 620, 300, 'triangle');
        break;
      case 'heal':
        this.chord(t, gain * 0.4, [523.25, 659.25, 783.99], 0.5, 'sine');
        break;
      case 'drink':
        this.tone(t, gain * 0.4, 0.3, 300, 640, 'sine');
        break;
      case 'levelUp':
        // The one fanfare in the game. Four notes, because five is a jingle.
        this.arpeggio(t, gain * 0.45, [392, 523.25, 659.25, 783.99], 0.11, 0.55);
        break;
      case 'learn':
        this.arpeggio(t, gain * 0.35, [523.25, 698.46], 0.1, 0.4);
        break;
      case 'quest':
        this.arpeggio(t, gain * 0.4, [440, 554.37, 659.25], 0.1, 0.45);
        break;
      case 'coin':
        this.arpeggio(t, gain * 0.28, [1046.5, 1396.9], 0.05, 0.16, 'triangle');
        break;
      case 'loot':
        this.noiseShot(t, gain * 0.3, 0.16, 'bandpass', 2200, 1400);
        break;
      case 'death':
        this.tone(t, gain * 0.5, 0.45, 160, 45, 'sine');
        break;
      case 'playerDeath':
        this.tone(t, gain * 0.6, 1.3, 130, 32, 'sine');
        this.tone(t + 0.06, gain * 0.35, 1.1, 96, 24, 'triangle');
        break;
      case 'telegraph':
        // Two rising notes. Deliberately not a klaxon: it fires several times a
        // fight and anything harsher becomes a reason to mute the game.
        this.tone(t, gain * 0.3, 0.22, 330, 392, 'square', 1200);
        this.tone(t + 0.16, gain * 0.34, 0.3, 392, 466, 'square', 1200);
        break;
      case 'enrage':
        this.tone(t, gain * 0.5, 0.6, 110, 220, 'sawtooth', 900);
        break;
      case 'hazard':
        // A wet, low churn — not a bang. The ground did not explode, it went
        // bad, and it is going to stay bad.
        this.noiseShot(t, gain * 0.4, 0.7, 'lowpass', 700, 180);
        this.tone(t, gain * 0.3, 0.55, 80, 55, 'triangle', 400);
        break;
      case 'interrupt':
        this.noiseShot(t, gain * 0.5, 0.14, 'bandpass', 3200, 1600);
        this.tone(t, gain * 0.3, 0.1, 880, 440, 'square');
        break;
      case 'error':
        this.tone(t, gain * 0.25, 0.12, 180, 150, 'square', 700);
        break;
    }
  }

  // ---------------------------------------------------------------- synthesis

  private makeNoise(ctx: BaseAudioContext): AudioBuffer {
    const seconds = 2;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** A pitched blip with an exponential sweep and a fast decay. */
  private tone(
    at: number,
    gain: number,
    seconds: number,
    from: number,
    to: number,
    type: OscillatorType,
    lowpass?: number,
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + seconds);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), at + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, at + seconds);

    let tail: AudioNode = env;
    if (lowpass !== undefined) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = lowpass;
      env.connect(lp);
      tail = lp;
    }
    osc.connect(env);
    tail.connect(this.sfx);
    osc.start(at);
    osc.stop(at + seconds + 0.02);
  }

  /** A burst of the shared noise buffer through a sweeping filter. */
  private noiseShot(
    at: number,
    gain: number,
    seconds: number,
    filter: BiquadFilterType,
    from: number,
    to: number,
  ): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    // Start somewhere random in the buffer, or every swing is the same swing.
    const offset = Math.random() * (this.noise.duration - seconds - 0.05);

    const band = ctx.createBiquadFilter();
    band.type = filter;
    band.frequency.setValueAtTime(from, at);
    band.frequency.exponentialRampToValueAtTime(Math.max(40, to), at + seconds);
    band.Q.value = filter === 'bandpass' ? 1.4 : 0.7;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), at + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, at + seconds);

    src.connect(band);
    band.connect(env);
    env.connect(this.sfx);
    src.start(at, Math.max(0, offset), seconds + 0.05);
  }

  private chord(at: number, gain: number, notes: number[], seconds: number, type: OscillatorType): void {
    for (const note of notes) this.tone(at, gain / notes.length, seconds, note, note, type);
  }

  private arpeggio(
    at: number,
    gain: number,
    notes: number[],
    step: number,
    seconds: number,
    type: OscillatorType = 'sine',
  ): void {
    notes.forEach((note, i) => this.tone(at + i * step, gain, seconds, note, note, type));
  }

  /**
   * Two looping noise beds that never stop.
   *
   * Started once and left running with the gain at zero rather than started and
   * stopped with the weather: a `BufferSource` cannot be restarted once
   * stopped, and rebuilding one every time a shower passes is how you get a
   * click on every weather change.
   */
  private buildWeatherBeds(ctx: BaseAudioContext): void {
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 440;
    this.windFilter.Q.value = 0.6;
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.ambient);

    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    this.rainFilter = ctx.createBiquadFilter();
    this.rainFilter.type = 'highpass';
    this.rainFilter.frequency.value = 1100;
    this.rainFilter.connect(this.rainGain);
    this.rainGain.connect(this.ambient);

    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    source.connect(this.windFilter);
    source.connect(this.rainFilter);
    source.start();
    this.windSource = source;

    // A slow wander on the wind's cutoff, so it breathes instead of hissing.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 140;
    lfo.connect(lfoDepth);
    lfoDepth.connect(this.windFilter.frequency);
    lfo.start();
  }

  /**
   * Current output level, 0 to 1, or null if there is no audio at all.
   *
   * Exists because "did it make a sound" is otherwise unanswerable: a synthesis
   * graph that throws no exception and produces pure silence looks identical
   * from the outside to one that works, and every earlier attempt at checking
   * this asserted on the *existence* of nodes rather than on signal. `smoke`
   * fires a level-up and watches this move.
   */
  meter(): number | null {
    if (!this.ctx) return null;
    if (!this.analyser) {
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      // Tapped off the master *before* the mute gain would be useless — the
      // question is whether the player can hear it, not whether a node ran.
      this.master.connect(this.analyser);
      this.peaks = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
    }
    this.analyser.getFloatTimeDomainData(this.peaks!);
    let peak = 0;
    for (const v of this.peaks!) peak = Math.max(peak, Math.abs(v));
    return peak;
  }

  dispose(): void {
    this.windSource?.stop();
    const ctx = this.ctx;
    if (typeof AudioContext !== 'undefined' && ctx instanceof AudioContext) void ctx.close();
    this.ctx = null;
  }
}
