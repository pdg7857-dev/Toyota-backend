/**
 * Art: where the real models live, and what to do with them.
 *
 * Everything in this game currently renders as a capsule with a nose on it.
 * That was always meant to be temporary, and this file is the seam that makes
 * replacing it a *data* change rather than a renderer change: put a `.glb` in
 * `public/models/`, add one line here, and that creature stops being a capsule.
 * Nothing else in the codebase moves.
 *
 * ## Why a list and not a directory scan
 *
 * The obvious design is convention: look for `public/models/mob/<id>.glb` and
 * use it if it is there. It is also the wrong one — five hundred creatures
 * means five hundred speculative fetches on load, every one of which 404s until
 * the art exists, and a browser's network panel full of red is a debugging
 * surface nobody wanted. `npm run models` scans the folder and prints the
 * lines to paste, so the convenience is kept without the cost.
 *
 * ## The one thing that matters about fitting
 *
 * A model is scaled to the creature's authored **height**, measured off its own
 * bounding box, not used at whatever scale it was exported at. Art from a
 * generator arrives in metres, centimetres or arbitrary units, and a wolf that
 * renders forty units tall is not a bug anybody enjoys finding. `scale` here is
 * a nudge on top of that fit, not the fit itself — leave it at 1 unless the
 * silhouette genuinely wants to be bigger than the hitbox it was authored for.
 */

export interface ModelDef {
  /** Path under `public/`, e.g. `models/mob/bog_wolf.glb`. */
  file: string;
  /**
   * Multiplier on the automatic height fit. 1 means "exactly as tall as the
   * capsule it replaces", which is what keeps nameplates and telegraph circles
   * lining up with the creature.
   */
  scale?: number;
  /** Extra Y rotation in radians, for a model exported facing the wrong way. */
  turn?: number;
  /** Nudge up or down, in world units, after fitting. */
  lift?: number;
  /**
   * Animation clip names inside the file, if they are not guessable.
   *
   * Left out, the loader matches clips by name against the state it needs —
   * anything containing "idle", "walk", "run", "attack", "cast", "hit" or
   * "death"/"die", case-insensitively. Most exporters name them close enough
   * that this is empty; it exists for the ones that call everything "Take 001".
   */
  clips?: Partial<Record<ModelState, string>>;
}

/** The states `render/anim.ts` can ask a model to play. */
export type ModelState = 'idle' | 'walk' | 'run' | 'attack' | 'cast' | 'hit' | 'death';

/**
 * Keys are `mob:<mobId>`, `class:<classId>` or `vendor:<vendorId>`.
 *
 * Namespaced because the three id spaces are separate and a Warrior and a
 * creature called "warrior" would otherwise collide — which is precisely the
 * sort of thing that goes unnoticed until somebody's Priest turns into a wolf.
 */
export const MODELS: Record<string, ModelDef> = {
  // Nothing yet. This is the file to add to.
  //
  //   'mob:bog_wolf':    { file: 'models/mob/bog_wolf.glb' },
  //   'class:warrior':   { file: 'models/class/warrior.glb' },
  //   'vendor:maeve':    { file: 'models/vendor/maeve.glb' },
};

export function modelKeyFor(kind: 'mob' | 'class' | 'vendor', id: string): string {
  return `${kind}:${id}`;
}

/**
 * Models set at runtime, which win over the table above.
 *
 * This exists because a manifest you cannot change without a rebuild is a
 * manifest nobody experiments with, and iterating on art means looking at forty
 * versions of a wolf. `window.__game.tryModel('mob:bog_wolf', { file: ... })`
 * re-dresses every wolf in the zone on the spot. It is also how `smoke.mjs`
 * proves this whole pipeline works without a fake creature being committed to
 * the repository.
 */
const OVERRIDES = new Map<string, ModelDef>();

export function setModelOverride(key: string, def: ModelDef | null): void {
  if (def) OVERRIDES.set(key, def);
  else OVERRIDES.delete(key);
}

/** The model for an id, or undefined — in which case the capsule stands. */
export function modelFor(kind: 'mob' | 'class' | 'vendor', id: string): ModelDef | undefined {
  const key = modelKeyFor(kind, id);
  return OVERRIDES.get(key) ?? MODELS[key];
}

/**
 * Which clip name in a file plays which state.
 *
 * Kept here rather than in the renderer so a test can check the matching rules
 * without standing up WebGL, and so the naming a person should export with is
 * written down in the same file they will be editing.
 */
const CLIP_WORDS: Record<ModelState, string[]> = {
  idle: ['idle', 'stand'],
  walk: ['walk'],
  run: ['run', 'sprint'],
  attack: ['attack', 'swing', 'strike', 'bite'],
  cast: ['cast', 'spell'],
  hit: ['hit', 'impact', 'flinch'],
  death: ['death', 'die', 'dead'],
};

/**
 * Pick the clip for a state out of whatever the file happens to contain.
 *
 * Falls back deliberately rather than failing: a model with only an idle is
 * still better than a capsule, and a missing walk should borrow the run rather
 * than freeze mid-stride.
 */
export function clipFor(
  state: ModelState,
  available: string[],
  overrides?: Partial<Record<ModelState, string>>,
): string | undefined {
  const named = overrides?.[state];
  if (named && available.includes(named)) return named;

  const match = (words: string[]): string | undefined =>
    available.find((clip) => words.some((w) => clip.toLowerCase().includes(w)));

  const direct = match(CLIP_WORDS[state]);
  if (direct) return direct;

  // Walk borrows run and vice versa; everything else falls back to idle, and
  // idle falls back to the first clip in the file, whatever it is called.
  if (state === 'walk') return match(CLIP_WORDS.run) ?? match(CLIP_WORDS.idle) ?? available[0];
  if (state === 'run') return match(CLIP_WORDS.walk) ?? match(CLIP_WORDS.idle) ?? available[0];
  if (state === 'idle') return available[0];
  return match(CLIP_WORDS.idle) ?? available[0];
}
