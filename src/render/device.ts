/**
 * What we are running on.
 *
 * One question, asked once, at the top of the renderer — because the answer
 * decides two unrelated things and they must not disagree about it: which
 * controls exist, and what a frame is allowed to cost.
 *
 * It is a *capability* check and not a screen-width one on purpose. A phone in
 * landscape is 844 wide and a laptop window can be narrower than that; what
 * separates them is whether there is a finger, and `maxTouchPoints` is the only
 * thing that actually knows. A touchscreen laptop gets the touch controls as
 * well, which is the right answer — they work with a mouse too, and a player
 * who has a finger on the screen is a player who wants a thumbstick.
 */
export function isTouchDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}

/**
 * How hard the renderer is allowed to work.
 *
 * A phone's device pixel ratio is routinely 3, which is nine times the
 * fragments of a 1x buffer for a screen you hold at arm's length — and this
 * game is fill-bound rather than geometry-bound (three kilometres of ground,
 * a fog bank, and a thousand instanced trees). Capping the buffer is the
 * single biggest thing that can be done for a phone and it costs almost
 * nothing anybody can see.
 *
 * Shadows stay on. Turning them off is the other obvious lever and it is the
 * wrong one: a boss telegraph is a flat circle you read off the ground, and
 * the ground reads as flat without them. The map size comes down instead,
 * which costs sharpness at the edges of a shadow nobody is looking at.
 */
export interface Quality {
  /** Ceiling on `devicePixelRatio`. */
  pixelRatio: number;
  /** Square shadow map. */
  shadowMap: number;
  antialias: boolean;
}

export const DESKTOP_QUALITY: Quality = { pixelRatio: 2, shadowMap: 2048, antialias: true };

/**
 * 1.5 rather than 1: at 1 the nameplates and the HUD text go soft, and this
 * game asks you to read a creature's name and level before deciding whether to
 * pull it. Antialiasing goes instead — at 1.5x on a phone screen the edges are
 * already past the point anybody can see them.
 */
export const MOBILE_QUALITY: Quality = { pixelRatio: 1.5, shadowMap: 1024, antialias: false };

export function qualityFor(touch = isTouchDevice()): Quality {
  return touch ? MOBILE_QUALITY : DESKTOP_QUALITY;
}


/**
 * Whether the *interface* should read as a touch interface.
 *
 * Separate from `isTouchDevice` and settable, for two reasons. The tools force
 * the touch build on with `?touch` and the wording has to follow, or the
 * screenshots are of a phone HUD telling you to press F. And a game that says
 * "press F to loot" on a device with no F is not a small wording problem: it
 * is the only instruction on screen, and it names a thing that does not exist.
 */
let touchUiOn = false;

export function setTouchUI(on: boolean): void {
  touchUiOn = on;
}

export function touchUI(): boolean {
  return touchUiOn;
}

/**
 * "press F to loot" on a desktop, "tap to loot" on a phone.
 *
 * One helper rather than a conditional at each of the nine places that names a
 * key, because nine conditionals is nine chances for one of them to keep
 * saying F.
 */
export function verb(key: string, what: string): string {
  return touchUI() ? `tap to ${what}` : `press ${key} to ${what}`;
}
