import type { StarRating } from '../sim/types.js';

/**
 * One thing each creature does that a stat block cannot.
 *
 * Eight bosses in this game are excellent, and every one of the twenty-eight
 * thousand other fights was identical: a health bar with a swing timer.
 * "Decided by play, not stats" was true of ★5 and ★6 and of nothing else, and
 * a hundred hours of a hundred-level game are spent on the *other* ratings.
 *
 * A trait is the trash-mob answer to the same problem, and it is deliberately
 * **not** a smaller telegraph. A telegraph costs a wind-up, a circle on the
 * ground and a decision, which is right once a fight and absurd forty times a
 * minute. A trait is a standing fact about a creature that changes how you
 * fight it and costs nothing to read.
 *
 * The rule for adding one is the rule the boss kits already run under: **it
 * must have a different answer.** Two traits that both mean "kill it faster"
 * are one trait with two names.
 *
 * | Trait | What it does | What you do about it |
 * |---|---|---|
 * | `pack` | Hits harder for every friend of its own kind nearby | Fight it where they are thin, or pull one off |
 * | `skittish` | Breaks and runs when badly hurt | Finish it, or let it go — chasing costs more than it pays |
 * | `venomous` | Its hits stack a poison that outlives them | Shorten the fight; a long one is lost to the stacks |
 * | `stubborn` | Hits much harder once badly hurt | Hold the defensive for the end rather than opening with it |
 *
 * Assigned by **creature family**, not per mob, for the same reason body plans
 * are: most of the bestiary south of the Fenmarch is generated, and the point
 * is that a family reads as itself — wolves are dangerous in numbers, adders
 * poison you, bears get worse when you hurt them, hares run. That is a thing a
 * player can learn once and use for a hundred levels.
 */
export type TraitId = 'pack' | 'skittish' | 'venomous' | 'stubborn';

export interface TraitDef {
  id: TraitId;
  /** Shown on the nameplate and the target frame. One word. */
  name: string;
  /** What it does, in the target frame's tooltip. */
  line: string;
  /** What to do about it. This is the half that makes it a mechanic. */
  answer: string;
}

export const TRAITS: Record<TraitId, TraitDef> = {
  pack: {
    id: 'pack',
    name: 'Pack',
    line: 'Fights harder with its own kind beside it.',
    answer: 'Pull one away, or fight where they are thin.',
  },
  skittish: {
    id: 'skittish',
    name: 'Skittish',
    line: 'Breaks and runs once it is badly hurt.',
    answer: 'Finish it before it turns, or let it go.',
  },
  venomous: {
    id: 'venomous',
    name: 'Venomous',
    line: 'Its bite stacks, and the poison outlives it.',
    answer: 'Shorten the fight. A long one is lost to the stacks.',
  },
  stubborn: {
    id: 'stubborn',
    name: 'Stubborn',
    line: 'Hits far harder once it is cornered.',
    answer: 'Hold your defence for the end, not the opening.',
  },
};

/* ------------------------------------------------------------------ */
/* The numbers                                                         */
/*                                                                     */
/* Deliberately modest. A trait is meant to change the SHAPE of a       */
/* fight, not its difficulty: played well each one is close to neutral  */
/* and played badly each one costs something, which is exactly the gap  */
/* the boss telegraphs measure. `balance.test.ts` prints both.          */
/* ------------------------------------------------------------------ */

/** How far a packmate counts from. Roughly one camp's spacing. */
export const PACK_RANGE = 11;

/** Extra damage per friend of the same kind in range, and the ceiling. */
export const PACK_PER_ALLY = 0.06;
export const PACK_MAX_ALLIES = 3;

/** Health share below which a skittish creature turns and runs. */
export const SKITTISH_AT = 0.28;
/** How long it runs before it turns back. */
export const SKITTISH_MS = 3200;

/**
 * How fast it runs, as a share of its own speed.
 *
 * Below one, and deliberately so. A `beast` moves at exactly the player's base
 * speed, so a creature fleeing at full pelt can never be caught: the chase is
 * a stalemate until something times out, which the balance suite reported as a
 * fight with no length at all. "You cannot kill this" is not a mechanic.
 *
 * A panicked scramble instead. The trait costs you the seconds and the ground
 * you cover chasing it — which inside a camp is the real cost, because the
 * ground you cover is toward everything else standing in it.
 */
export const SKITTISH_SPEED = 0.72;

/** How much of its leash a fleeing creature may spend. */
export const SKITTISH_LEASH = 0.85;

/**
 * Poison stack: damage a tick as a share of the creature's own swing.
 *
 * Much smaller than it looks like it should be, because **a dot lands without
 * mitigation**. At the first pass — a sixth of a swing per stack — five stacks
 * were adding more than half the creature's mitigated output again as raw
 * damage, and the progression suite reported a Warrior losing nine times in
 * ten to a Blackwater Eel at level 42. Fitted so a full stack is worth about a
 * quarter of what the creature does with its teeth.
 */
export const VENOM_SHARE = 0.035;

/**
 * Ceiling on one stack, as a share of the victim's own maximum health.
 *
 * A share of the *creature's swing* is the right shape and the wrong scale on
 * anything whose swing is not ordinary: a rare spawn hits for `RARE_TOUGHNESS`
 * times its host, so `Deepmaw the Great Pike` was poisoning a Warrior to death
 * eleven times in twelve. The same lesson the impact bursts had to learn — a
 * raw number means different things to different victims — so the tick is
 * whichever of the two is smaller, and venom always costs a readable share of
 * whoever it is in.
 */
export const VENOM_MAX_TICK = 0.005;
export const VENOM_TICK_MS = 2000;
export const VENOM_MS = 12000;
export const VENOM_MAX_STACKS = 5;

/**
 * Health share below which a stubborn creature hits harder, and by how much.
 *
 * The window is short and the multiplier is modest, because this one lands at
 * exactly the moment the player is most likely to be low themselves — the same
 * reason a boss `enrage` is a timer rather than a wall. At 1.5 a Clan
 * Berserker at level 40 won every fight in the suite.
 */
export const STUBBORN_AT = 0.28;
export const STUBBORN_DAMAGE = 1.28;

/**
 * Which family gets which.
 *
 * Keyword-matched on the creature's id, longest first, exactly like the body
 * plans — and for the same reason. A test walks every spawn in every zone and
 * prints the table, because "every creature in Ardmoor is Stubborn" is
 * invisible to any assertion made one creature at a time.
 */
const BY_WORD: [string, TraitId][] = [
  // Animals that hunt together.
  ['warhound', 'pack'],
  ['mastiff', 'pack'],
  ['hound', 'pack'],
  ['wolf', 'pack'],
  ['lynx', 'pack'],
  // And people, who do the same thing for different reasons.
  ['bowman', 'pack'],
  ['raider', 'pack'],
  ['reaver', 'pack'],
  ['marauder', 'pack'],
  ['levy', 'pack'],
  ['spearman', 'pack'],
  ['axeman', 'pack'],
  ['outlaw', 'pack'],
  ['warband', 'pack'],
  ['blackshield', 'pack'],
  ['scavenger', 'pack'],
  ['smuggler', 'pack'],
  ['enforcer', 'pack'],

  // Prey, and anything else with more sense than fight in it.
  ['hare', 'skittish'],
  ['rabbit', 'skittish'],
  ['goat', 'skittish'],
  ['stag', 'skittish'],
  ['deer', 'skittish'],
  ['heron', 'skittish'],
  ['eagle', 'skittish'],
  ['hawk', 'skittish'],
  ['seal', 'skittish'],

  // Things that bite.
  ['adder', 'venomous'],
  ['serpent', 'venomous'],
  ['snake', 'venomous'],
  ['eel', 'venomous'],
  ['pike', 'venomous'],
  ['engineer', 'venomous'],

  // Things that only get worse.
  ['bear', 'stubborn'],
  ['boar', 'stubborn'],
  ['berserker', 'stubborn'],
  ['champion', 'stubborn'],
  ['warden', 'stubborn'],
];

const SORTED = [...BY_WORD].sort((a, b) => b[0].length - a[0].length);

/**
 * The trait a creature has, if any.
 *
 * Takes the definition rather than the id so `rareOf` and `starOf` are
 * unwrapped here and cannot be forgotten — a Snarling Bog Wolf is still a wolf
 * and `Mirefang the Bog Wolf` is still a wolf, and the lesson that a variant's
 * own id says nothing about the creature has been learned twice already.
 *
 * **Bosses never have one.** They have kits, which are a bigger version of the
 * same idea, and stacking a trait on top of four telegraphed abilities is
 * another number on the one fight in the game that does not need one.
 */
/**
 * Memoised on the creature's id.
 *
 * `traitFor` is called from `statsOf`, which runs many times per entity per
 * tick, and the lookup is forty `includes` calls over a keyword table. A
 * definition's trait cannot change, so the answer is worth keeping: without
 * this the sim tick went from 1.4ms to 2.4ms and `smoke` was right to notice.
 */
const CACHE = new Map<string, TraitDef | null>();

export function traitFor(mob: {
  id: string;
  stars: StarRating;
  rareOf?: string;
  starOf?: string;
  dragon?: boolean;
  horse?: string;
  summonedBy?: string;
}): TraitDef | null {
  const cached = CACHE.get(mob.id);
  if (cached !== undefined) return cached;
  const found = resolveTrait(mob);
  CACHE.set(mob.id, found);
  return found;
}

function resolveTrait(mob: Parameters<typeof traitFor>[0]): TraitDef | null {
  if (mob.stars >= 5 || mob.dragon) return null;
  // A horse is a fight you are meant to leave something in; a trait would make
  // that harder to read, and a bolting horse is the mount system's job.
  if (mob.horse) return null;
  // Summons belong to a boss fight and are already part of somebody's kit.
  if (mob.summonedBy) return null;

  const key = (mob.rareOf ?? mob.starOf ?? mob.id).toLowerCase();
  for (const [word, trait] of SORTED) {
    if (key.includes(word)) return TRAITS[trait];
  }
  return null;
}
