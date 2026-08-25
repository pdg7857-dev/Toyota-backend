import type { ClassId } from '../sim/types.js';

/**
 * Other adventurers: the part of an MMO that is not a mechanic.
 *
 * The systems an MMO is usually praised for — clans, trade, raids — all need
 * other people, and this game has none. But almost none of what makes a
 * populated world *feel* populated is those systems. It is the ambient
 * evidence that other people are here and getting on with it: somebody
 * fighting a camp you were heading for, somebody running past you toward
 * something, somebody asking in chat whether anyone has seen the dragon.
 *
 * So these are not companions, party members or quest givers. You cannot talk
 * to them, group with them or trade with them, and they will not help you.
 * They exist to be *seen*. They pick a camp, fight it, level up over the hours,
 * die sometimes, and say things.
 *
 * Three rules keep them from being a lie:
 *
 *  - **They never touch your loot or your kills.** An adventurer that tags the
 *    mob you needed is not atmosphere, it is a competitor, and competing with
 *    a script is miserable. They pull real creatures now — see below — and the
 *    creature always goes home to full before you can reach it.
 *  - **They are always plausible.** Their level tracks the zone they are in,
 *    so you never see a level 4 in Caer Dubh, and their chat is about things
 *    that are actually happening — the front that just flipped, the dragon
 *    that just woke.
 *  - **They are quiet.** A line every few minutes, not a scrolling wall. The
 *    fastest way to make a fake population feel fake is to make it chatty.
 */

export interface AdventurerName {
  name: string;
  classId: ClassId;
}

/**
 * The roster. Hand-written because names are the whole point: a generated
 * name reads as generated, and the illusion is doing all the work here.
 */
export const ADVENTURERS: AdventurerName[] = [
  { name: 'Bearach', classId: 'warrior' },
  { name: 'Sile', classId: 'priest' },
  { name: 'Tadhg', classId: 'ranger' },
  { name: 'Nuala', classId: 'rogue' },
  { name: 'Eimhin', classId: 'mage' },
  { name: 'Rónán', classId: 'warrior' },
  { name: 'Aoibhe', classId: 'priest' },
  { name: 'Cormac', classId: 'ranger' },
  { name: 'Deirbhile', classId: 'rogue' },
  { name: 'Lorcan', classId: 'mage' },
  { name: 'Fionnuala', classId: 'warrior' },
  { name: 'Cathal', classId: 'priest' },
];

/** How many are out in a zone at once. */
export const ADVENTURERS_PER_ZONE = 4;

/** Seconds between one of them saying something, roughly. */
export const CHATTER_INTERVAL_SEC = 95;

/**
 * The shortest gap between two ambient lines, from anybody.
 *
 * Without this the volume is whatever the sources happen to add up to, and
 * adding a source makes the whole population chattier — which is exactly what
 * happened the first time: idle chatter plus death chatter measured at two and
 * a half times the intended rate, and the intended rate was the design. One
 * floor in `say()` is what keeps "quiet" a property of the feature rather than
 * an accident of how many things can talk.
 *
 * Reactions to real events — a front falling, a dragon landing, your level —
 * ignore it. Those are rare by nature and are the half that makes them feel
 * like people rather than wallpaper.
 */
export const CHATTER_MIN_GAP_MS = 30000;

/** How long they take to clear a camp before moving to the next one. */
export const CAMP_MINUTES = 2.5;

/**
 * How often one of them loses a fight, per person.
 *
 * Somebody dying every four minutes is not a populated world, it is a badly
 * played one — and it made them talk twice as much as they were supposed to.
 */
export const DEATH_INTERVAL_SEC = 600;

/**
 * What they say.
 *
 * Split by whether it is about the world right now or just filler, because a
 * population that only ever says filler is wallpaper, and one that only ever
 * reacts to events is a notification feed.
 */
export const IDLE_CHATTER = [
  'anyone selling a decent chest piece?',
  'lfg for the boss, need a healer',
  'that camp respawns way too fast',
  'still 200 short for the wrought blade lol',
  'how is everyone finding this grind',
  'anyone seen a wild courser out here?',
  'wtb tome, paying well',
  'this zone is dead tonight',
  'took me an hour to find that rare',
  'careful south, the guards hit like a cart',
  'grats',
  'thanks for the res earlier',
  'anyone know where the herd spawns',
  'nearly there. one more level',
];

/** Said when a holding changes hands. `%s` is the holding. */
export const FRONT_CHATTER = [
  'did %s just flip?',
  'looks like %s changed hands',
  '%s is ours now apparently',
  'good luck getting through %s tonight',
];

/** Said when a dragon is out. `%s` is its name. */
export const DRAGON_CHATTER = [
  '%s is up',
  '%s is out. everyone off the road',
  'is anyone actually going for %s',
  'saw %s land. absolutely not',
  '%s up, forming a group, need bodies',
];

/** Said when one of them dies. `%s` is the mob that did it. */
export const DEATH_CHATTER = [
  'well that %s got me',
  'ouch. %s',
  'pulled two %s. my fault',
  'ugh, %s again',
];

/**
 * Said when *you* level, by somebody standing close enough to have seen it.
 * `%s` is your name.
 *
 * The proximity check is the whole trick. A congratulation from nobody in
 * particular is a system message wearing a name; a congratulation from the
 * ranger who has been shooting the same camp as you for ten minutes is the
 * single cheapest moment of company in the game.
 */
export const GRATS_CHATTER = [
  'grats %s',
  'gz %s',
  'grats! %s',
  'nice one %s',
];

/** How close one of them has to be to congratulate you. */
export const GRATS_RANGE = 34;


/**
 * What happens when one of them fights something.
 *
 * They used to stand in a camp and *abstractly* fight it: a spin, a timer, and
 * a line when they lost. From sixty metres that is a person turning slowly on
 * the spot beside eight creatures that have not noticed them, which is worse
 * than nobody being there — it says out loud that the population is a script.
 *
 * So they pull. A real creature leaves its mark, walks over, and the two of
 * them trade real blows with real numbers. The rule they exist under is
 * unchanged and is enforced three ways rather than by pretending:
 *
 * - **They can never finish one.** An adventurer's damage stops at
 *   `FIGHT_FLOOR` of the creature's health. Nothing they do can call `kill`,
 *   so there is no path by which a kill, a drop, a quest tick or a scrap of
 *   territory can go to somebody who is not you.
 * - **The creature you walk up to is the creature you would have found.** The
 *   moment the player is anywhere near, the adventurer breaks off and the
 *   creature leashes — which sends it home and heals it to full, exactly as it
 *   does when *you* run out of its reach. It is the game's own existing answer
 *   to "that fight is over", not a special case pretending to be one.
 * - **They lose.** Not always, but they cannot win, so eventually they are
 *   worn down and walk away saying so. Other people failing is a much bigger
 *   part of a world feeling inhabited than other people succeeding, and now it
 *   is something you can watch rather than a line in a log.
 */

/**
 * How far into a creature's health an adventurer can ever get.
 *
 * Reaching it **ends the fight** rather than capping it. The first version
 * simply clamped the damage, and the measured result was every fight driving
 * the creature onto the floor and then sitting on it for another half a minute
 * — a health bar visibly refusing to move, which is the one thing a backstop
 * must never be. Now they beat it down, it breaks off, and they get to say so.
 */
export const FIGHT_FLOOR = 0.3;

/** How low they let themselves get before giving it up as a bad job. */
export const GIVE_UP_AT = 0.35;

/** How near the player has to be for them to leave the creature alone. */
export const YIELD_MARGIN = 26;

/** How long one of them will stay on a creature before wandering off. */
export const FIGHT_MS = 45_000;

/**
 * Said when one of them drove a creature off. `%s` is the creature.
 *
 * The counterpart to `DEATH_CHATTER`, and needed the moment the fights became
 * real: a population that only ever reports losing is not people, it is a
 * running joke.
 */
export const DROVE_OFF_CHATTER = [
  'that %s has had enough',
  '%s legged it',
  'saw off a %s, that will do',
  'and stay off, %s',
];

/** How fast they get their wind back afterwards, as a share of health a second. */
export const REST_SHARE = 0.02;
