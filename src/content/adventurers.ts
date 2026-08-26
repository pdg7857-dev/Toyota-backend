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
  { name: 'Sile', classId: 'druid' },
  { name: 'Tadhg', classId: 'ranger' },
  { name: 'Nuala', classId: 'rogue' },
  { name: 'Eimhin', classId: 'mage' },
  { name: 'Rónán', classId: 'warrior' },
  { name: 'Aoibhe', classId: 'druid' },
  { name: 'Cormac', classId: 'ranger' },
  { name: 'Deirbhile', classId: 'rogue' },
  { name: 'Lorcan', classId: 'mage' },
  { name: 'Fionnuala', classId: 'warrior' },
  { name: 'Cathal', classId: 'druid' },
];

/** How many are out in a zone at once. */
export const ADVENTURERS_PER_ZONE = 4;

/**
 * Seconds between one of them starting something, roughly.
 *
 * Not the thing that actually governs how much talking there is — that is
 * `CHATTER_MIN_GAP_MS`, because the fight outcomes want to speak far more
 * often than this timer does and the floor is what turns them down. This is
 * how often somebody with nothing else to say says something anyway.
 */
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
/**
 * Something one of them says, and what somebody else says back.
 *
 * The reply is the part that took longest to arrive and is most of the value.
 * Before it, every line went from one person into the void: four people in a
 * zone saying things at nobody, which is a population that talks *past* itself
 * rather than to itself — four monologues wearing a crowd's clothes.
 *
 * `%t` in a reply is a town in this zone, filled in by the sim. "Check the
 * armoury" is a line from a game; "armoury at Moorwatch had one" is a line
 * from somebody who lives here.
 */
export interface Exchange {
  line: string;
  /** What somebody else says back. Empty means the line stands on its own. */
  replies: string[];
}

export const IDLE_CHATTER: Exchange[] = [
  {
    line: 'anyone selling a decent chest piece?',
    replies: ['armoury at %t had one earlier', 'try %t', 'sold mine an hour ago, sorry'],
  },
  {
    line: 'lfg for the boss, need a healer',
    replies: ['gl, been trying all night', 'i would but i am four levels short', 'good luck'],
  },
  {
    line: 'that camp respawns way too fast',
    replies: ['pull from the edge', 'yeah it is a bad one', 'that is the whole camp, not you'],
  },
  {
    line: 'still 200 short for the wrought blade lol',
    replies: ['sell the trophies, they add up', 'you will get there', 'been there'],
  },
  {
    line: 'how is everyone finding this grind',
    replies: ['about what it says on the tin', 'slow. worth it', 'ask me at 40'],
  },
  {
    line: 'anyone seen a wild courser out here?',
    replies: ['herd west of the road', 'saw one near %t', 'not today'],
  },
  {
    line: 'wtb tome, paying well',
    replies: ['scriptorium at %t', 'the boss drops the good one', 'the trader has the cheap one'],
  },
  { line: 'this zone is dead tonight', replies: ['it is not, i am right here', 'quiet is fine by me'] },
  {
    line: 'took me an hour to find that rare',
    replies: ['that is about right', 'an hour is lucky', 'nice'] },
  {
    line: 'careful south, the guards hit like a cart',
    replies: ['can confirm', 'thanks', 'learned that one already'],
  },
  { line: 'grats', replies: [] },
  { line: 'thanks for the res earlier', replies: ['any time', 'no bother'] },
  {
    line: 'anyone know where the herd spawns',
    replies: ['west, off the road', 'they move. keep walking'],
  },
  { line: 'nearly there. one more level', replies: ['go on then', 'grats in advance'] },
  {
    line: 'anyone at the stone in %t?',
    replies: ['heading there now', 'attuned it this morning', 'what for'],
  },
];

/** Said when a holding changes hands. `%s` is the holding. */
export const FRONT_CHATTER: Exchange[] = [
  { line: 'did %s just flip?', replies: ['looks like it', 'was going to, it has been sliding all week'] },
  { line: 'looks like %s changed hands', replies: ['about time', 'that will not last'] },
  { line: '%s is ours now apparently', replies: ['for now', 'do not get used to it'] },
  { line: 'good luck getting through %s tonight', replies: ['going round', 'i will risk it'] },
];

/** Said when a dragon is out. `%s` is its name. */
export const DRAGON_CHATTER: Exchange[] = [
  { line: '%s is up', replies: ['where', 'not again', 'on my way to look, not to fight'] },
  { line: '%s is out. everyone off the road', replies: ['noted', 'going the long way'] },
  { line: 'is anyone actually going for %s', replies: ['not a chance', 'one day', 'you first'] },
  { line: 'saw %s land. absolutely not', replies: ['sensible', 'wise'] },
  { line: '%s up, forming a group, need bodies', replies: ['i am four levels short', 'gl'] },
];

/**
 * Said when one of them dies. `%s` is the mob that did it.
 *
 * Commiseration is the most human thing anybody says to anybody, and it is the
 * cheapest reply in the game: nothing needs to know what happened, only that
 * somebody had a bad time.
 */
export const DEATH_CHATTER: Exchange[] = [
  { line: 'well that %s got me', replies: ['happens', 'that camp is rough', 'unlucky'] },
  { line: 'ouch. %s', replies: ['you alright?', 'rough'] },
  { line: 'pulled two %s. my fault', replies: ['we have all done it', 'at least you know why'] },
  { line: 'ugh, %s again', replies: ['leave it, it is not worth it', 'third time?'] },
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
 * How long somebody takes to answer.
 *
 * Long enough to read as a reply and not as a duet. Two lines on the same tick
 * are one person talking to themselves in two voices.
 */
export const REPLY_DELAY_MS = 2200;

/**
 * How often the end of one of their fights is worth mentioning.
 *
 * Four people working camps produce a beaten creature or a bad pull every
 * minute or so, and announcing every one of them is what actually made the
 * population chatty — the idle timer was never the constraint. Real people do
 * not narrate every skirmish; they mention the ones worth mentioning.
 *
 * Lowering this is also what paid for the replies: the same volume, spent on
 * something being said *to somebody* rather than on the eleventh
 * "%s legged it" of the hour.
 */
export const FIGHT_CHATTER_CHANCE = 0.45;

/**
 * How often a line that could be answered actually is.
 *
 * Not always, because a population where every question gets an answer is a
 * script running a dialogue tree. Sometimes nobody is paying attention, and a
 * question hanging unanswered is the most authentic thing in the file.
 */
export const REPLY_CHANCE = 0.62;

// --------------------------------------------------------------------------
// What they make of you.
//
// They had exactly one opinion about the player — a level — which made them a
// population that lives in the same world and has never noticed you are in it.
// Everything else they say is about the world (`FRONT_CHATTER`) or about
// themselves (`DEATH_CHATTER`), and both are anonymous: a line that could have
// been said by anybody about anybody is scenery.
//
// Four rules, and they are what stop this becoming a notification feed:
//
// - **Somebody has to have been there — unless everybody would know.** A boss
//   you pulled, a creature you found and the piece you are wearing are things
//   a person standing near you saw, so they are gated on proximity, the same
//   rule `grats` runs under. A dragon coming down and a banner changing hands
//   are public: the whole zone knows, and gating the biggest moments in the
//   game on who happened to be in the arena would make them the quietest.
// - **It names you.** Otherwise it is indistinguishable from the world chatter
//   that was already there.
// - **The personal ones are rare.** They go through one long floor of their
//   own, so a
//   player farming a rare camp gets a remark now and then rather than the same
//   four lines on a loop. `grats` is the model: the value is in it being
//   uncommon. The public ones need no floor — one dragon a zone, and a hundred
//   and fourteen kills to turn a front, is rare enough on its own.
// - **It is about something that cost you something.** A boss, a named
//   creature, a dragon, a front you turned, or a piece nobody else is wearing.
//   Nothing they say is about an ordinary kill, because four hundred of those
//   an hour is exactly what makes a line worthless.
// --------------------------------------------------------------------------

/** A boss you put down, with somebody near enough to have watched. `%s` is you. */
export const BOSS_PRAISE = [
  'did %s just solo that',
  'nice pull %s',
  '%s took it down. respectable',
  'well played %s',
];

/** A named creature. `%s` is you, `%m` is the creature. */
export const RARE_PRAISE = [
  '%s got the %m. been camping that for days',
  'is that %m down? %s you lucky thing',
  '%s found the %m before me. typical',
  'grats on the %m %s',
];

/** A dragon. Zone-wide, because everybody would know. `%s` you, `%m` the wyrm. */
export const DRAGON_PRAISE = [
  '%m is DOWN. %s did it',
  'someone tell me %s just killed %m',
  '%m dead. %s. absolute unit',
  'we are all going to hear about %s and %m for weeks',
];

/** A front you pushed over. `%s` is you, `%m` the holding. */
export const FRONT_PRAISE = [
  'that was %s at %m all afternoon',
  '%m turned. %s has been down there for hours',
  'thank %s for %m, apparently',
];

/** Something worth looking at, worn by you. `%s` is you, `%m` the piece. */
export const GEAR_PRAISE = [
  'nice %m %s',
  'where did %s get that %m',
  'that %m on %s. one day',
  'ok %s, the %m is showing off now',
];

/**
 * The shortest gap between two remarks *about the player*, from anybody.
 *
 * Six times the ambient floor. These bypass `CHATTER_MIN_GAP_MS` because they
 * are reactions to something that actually happened — but a player who farms a
 * rare camp for an hour would then be told how lucky they are twenty times,
 * and the twentieth is worse than none. This is the floor that keeps a
 * compliment a compliment.
 */
export const PRAISE_MIN_GAP_MS = 180_000;

/** How near somebody has to be to have seen you do it. */
export const SAW_RANGE = 70;

/**
 * How often somebody near you remarks on what you are wearing, per second.
 *
 * The only one of these that is not caused by an event, so it needs a rate of
 * its own — and a very low one, because unlike the others it is *always*
 * eligible once you are carrying something good. Roughly once every twenty
 * minutes of standing near somebody, and then only if the piece is worth it.
 */
export const GEAR_PRAISE_PER_SEC = 1 / 1200;


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
export const DROVE_OFF_CHATTER: Exchange[] = [
  { line: 'that %s has had enough', replies: ['nice', 'good'] },
  { line: '%s legged it', replies: ['let it go', 'they always do'] },
  { line: 'saw off a %s, that will do', replies: ['that will do', 'well in'] },
  { line: 'and stay off, %s', replies: ['ha'] },
];

/** How fast they get their wind back afterwards, as a share of health a second. */
export const REST_SHARE = 0.02;
