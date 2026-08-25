import type { StarRating } from '../sim/types.js';

/**
 * A camp that notices you are farming it.
 *
 * The loop has a ten-second unit — a kill — and a forty-minute unit — a level
 * — and nothing at all in between. Everything the world layer does happens on
 * a much longer clock than that: a front slides over twenty minutes, a dragon
 * wakes every half hour. The two-minute scale, which is the one a player
 * actually *sits inside*, was empty.
 *
 * So: kill enough of one place quickly enough and the place responds. The
 * survivors nearby come at you at once, one of them is **roused** — a rating
 * higher, named for it, and carrying accordingly — and you decide whether to
 * hold the ground or walk away with what you have.
 *
 * Four rules hold it together:
 *
 * - **It is caused by the player, and only by the player.** Nothing musters
 *   because a timer went off. This is the difference between an event and a
 *   spawn: you can always see why it happened, and you could always have
 *   chosen not to cause it.
 * - **It is local.** Tallied per grid cell rather than per camp, so it needs no
 *   camp identity in the sim and it cannot rouse creatures on the other side of
 *   a hill who were never involved. `MUSTER_CELL` is a little wider than a
 *   camp, so a camp is one cell's worth of ground and the tally is about the
 *   place rather than about the creature.
 * - **It cools off.** The tally decays, so a steady grind never triggers it and
 *   a hard push does. Pace is the lever, which makes it a decision rather than
 *   a tax on playing.
 * - **It is worth something.** A roused champion drops what a creature a rating
 *   higher drops, because an event that is only harder is a punishment for
 *   playing well.
 */

/** How wide a cell is. A camp is about a hundred units across. */
export const MUSTER_CELL = 150;

/**
 * Kills in one cell that rouse it.
 *
 * Measured against the camps rather than guessed: `npm test` prints how many
 * creatures share a cell and the answer is usually eight. At seven you have
 * emptied the camp before it notices, and one survivor answering a muster is
 * not a muster — it is a creature with a longer name.
 */
export const MUSTER_AT = 5;

/**
 * How long the tally takes to fade, per kill.
 *
 * Long enough that a hard push builds it and short enough that ordinary
 * levelling — which is roughly a kill every twenty-five seconds once walking
 * and resting are counted — never does.
 */
export const MUSTER_DECAY_MS = 22_000;

/** How far from the cell's centre a creature has to be to hear it. */
export const MUSTER_RANGE = 95;

/** How long a cell stays quiet afterwards. */
export const MUSTER_COOLDOWN_MS = 150_000;

/** How long the roused stay roused, if you run rather than fight. */
export const ROUSED_MS = 60_000;

/**
 * What being roused is worth, on top of the extra rating.
 *
 * Deliberately small. The rating is already most of it — `STAR_MODIFIERS`
 * turns a ★2 into a ★3 — and stacking a big multiplier on top made a Fenmarch
 * muster kill a level-appropriate Warrior nine times in ten.
 */
export const ROUSED_DAMAGE = 1.12;

/** How many of the survivors come. Everything in range would be a wipe. */
export const MUSTER_MAX = 4;

/**
 * How many have to be left for it to be worth calling.
 *
 * An emptied camp keeps its temper rather than spending it: the tally is not
 * reset, so the ground stays angry and musters the moment enough of them are
 * back on their feet. A camp of one is not a camp.
 */
export const MUSTER_MIN = 2;

/** The name a roused creature carries, by what it was. */
export function rousedName(name: string): string {
  return `${name}, Roused`;
}

/** The rating a roused creature fights at. Never past ★4 — that is a boss. */
export function rousedStars(stars: StarRating): StarRating {
  return Math.min(4, stars + 1) as StarRating;
}
