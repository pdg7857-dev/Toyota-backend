import type { Attributes, ClassId, SkillDef } from '../sim/types.js';

/**
 * Skill registry.
 *
 * Two halves. The starting kit below is granted by LEVEL and is spread across
 * the Fenmarch's 1–25 band, so a grinding player always has a next thing coming
 * rather than finishing their kit before the halfway point. Everything after
 * that is TAUGHT by a zone — see the second half of this file.
 *
 * Every class gets an interrupt, but they are not the same tool: the Priest's
 * is long-ranged, comes earlier and locks out for longer — cutting a cast short
 * is the class's identity, not a bonus button.
 */
export const SKILLS: Record<string, SkillDef> = {
  // === WARRIOR =============================================================
  strike: {
    id: 'strike',
    name: 'Strike',
    classId: 'warrior',
    scalesWith: 'strength',
    reqLevel: 1,
    energyCost: 8,
    cooldownMs: 4000,
    castMs: 0,
    interruptible: false,
    range: 2.6,
    kind: 'damage',
    weaponMultiplier: 1.6,
    flatPower: 4,
    damageType: 'physical',
    threatBonus: 10,
    description: 'A heavy overhead blow. 160% weapon damage.',
  },
  rend: {
    id: 'rend',
    name: 'Rend',
    classId: 'warrior',
    scalesWith: 'strength',
    reqLevel: 2,
    energyCost: 12,
    cooldownMs: 9000,
    castMs: 0,
    interruptible: false,
    range: 2.6,
    kind: 'dot',
    flatPower: 6,
    damageType: 'physical',
    durationMs: 8000,
    tickMs: 2000,
    description: 'Opens a bleeding wound. Damage over 8s, ignores armour.',
  },
  rally: {
    id: 'rally',
    name: 'Rally',
    classId: 'warrior',
    scalesWith: 'vitality',
    reqLevel: 4,
    energyCost: 20,
    cooldownMs: 22000,
    castMs: 1500,
    interruptible: true,
    range: 0,
    kind: 'heal',
    flatPower: 45,
    description: 'Catch your breath. Restores health over a 1.5s cast.',
  },
  bulwark: {
    id: 'bulwark',
    name: 'Bulwark',
    classId: 'warrior',
    scalesWith: 'vitality',
    reqLevel: 6,
    energyCost: 18,
    cooldownMs: 30000,
    castMs: 0,
    interruptible: false,
    range: 0,
    kind: 'buff',
    defenseBonus: 40,
    durationMs: 12000,
    tickMs: 1000,
    description: 'Raise your guard. +40 defence for 12s.',
  },
  sunder: {
    id: 'sunder',
    name: 'Sunder',
    classId: 'warrior',
    scalesWith: 'vitality',
    reqLevel: 9,
    energyCost: 25,
    cooldownMs: 14000,
    castMs: 0,
    interruptible: false,
    range: 2.6,
    kind: 'damage',
    weaponMultiplier: 2.4,
    flatPower: 12,
    damageType: 'physical',
    threatBonus: 25,
    description: 'A crushing two-handed swing. 240% weapon damage.',
  },
  bash: {
    id: 'bash',
    name: 'Bash',
    classId: 'warrior',
    reqLevel: 12,
    energyCost: 15,
    cooldownMs: 16000,
    castMs: 0,
    interruptible: false,
    range: 2.8,
    kind: 'interrupt',
    lockoutMs: 6000,
    threatBonus: 15,
    description: 'Shield-slam a caster. Stops the spell and locks it out for 6s.',
  },
  onslaught: {
    id: 'onslaught',
    name: 'Onslaught',
    classId: 'warrior',
    scalesWith: 'strength',
    reqLevel: 15,
    energyCost: 34,
    cooldownMs: 26000,
    castMs: 0,
    interruptible: false,
    range: 2.8,
    kind: 'damage',
    weaponMultiplier: 3.2,
    flatPower: 20,
    // Held for the kill. Onslaught off cooldown is an opener that happens to
    // be big; Onslaught on something nearly dead is a decision.
    when: { kind: 'finisher', below: 0.3, multiplier: 1.75 },
    damageType: 'physical',
    threatBonus: 35,
    description: 'Throw everything into one blow. 320% weapon damage.',
  },

  // === PRIEST ==============================================================
  smite: {
    id: 'smite',
    name: 'Smite',
    classId: 'priest',
    scalesWith: 'focus',
    reqLevel: 1,
    energyCost: 10,
    cooldownMs: 4000,
    castMs: 0,
    interruptible: false,
    range: 9,
    kind: 'damage',
    weaponMultiplier: 1.6,
    flatPower: 5,
    damageType: 'nature',
    threatBonus: 8,
    description: 'A bolt of judgement at range. 160% weapon damage.',
  },
  mend_wounds: {
    id: 'mend_wounds',
    name: 'Mend Wounds',
    classId: 'priest',
    scalesWith: 'focus',
    reqLevel: 3,
    energyCost: 22,
    cooldownMs: 13000,
    castMs: 1400,
    interruptible: true,
    range: 0,
    kind: 'heal',
    flatPower: 75,
    // Worth far more when it is worth anything. A heal that pays the same at
    // 90% health as at 20% is a heal you press on cooldown; this one is a
    // reason to let a fight get frightening before you spend it.
    when: { kind: 'desperate', below: 0.35, multiplier: 1.8 },
    description: 'Knit your wounds closed. A strong heal, and far stronger when you are nearly gone.',
  },
  searing_word: {
    id: 'searing_word',
    name: 'Searing Word',
    classId: 'priest',
    scalesWith: 'focus',
    reqLevel: 5,
    energyCost: 16,
    cooldownMs: 10000,
    castMs: 0,
    interruptible: false,
    range: 9,
    kind: 'dot',
    flatPower: 9,
    damageType: 'nature',
    durationMs: 9000,
    tickMs: 3000,
    description: 'A word that keeps burning. Damage over 9s, ignores armour.',
  },
  rebuke: {
    id: 'rebuke',
    name: 'Rebuke',
    classId: 'priest',
    reqLevel: 7,
    energyCost: 14,
    cooldownMs: 12000,
    castMs: 0,
    interruptible: false,
    range: 12,
    kind: 'interrupt',
    lockoutMs: 9000,
    threatBonus: 10,
    description: 'Command a caster to be silent. Stops the spell, locks it out 9s.',
  },
  spirit_shield: {
    id: 'spirit_shield',
    name: 'Spirit Shield',
    classId: 'priest',
    scalesWith: 'focus',
    reqLevel: 10,
    energyCost: 24,
    cooldownMs: 28000,
    castMs: 0,
    interruptible: false,
    range: 0,
    kind: 'buff',
    defenseBonus: 55,
    durationMs: 14000,
    tickMs: 1000,
    description: 'A ward against harm. +55 defence for 14s.',
  },
  judgement: {
    id: 'judgement',
    name: 'Judgement',
    classId: 'priest',
    scalesWith: 'focus',
    reqLevel: 15,
    energyCost: 38,
    cooldownMs: 26000,
    castMs: 0,
    interruptible: false,
    range: 9,
    kind: 'damage',
    weaponMultiplier: 3.0,
    flatPower: 22,
    damageType: 'nature',
    threatBonus: 30,
    description: 'Call down a reckoning. 300% weapon damage.',
  },

  // === RANGER — Dexterity, ranged, steady pressure =========================
  quick_shot: {
    id: 'quick_shot',
    name: 'Quick Shot',
    classId: 'ranger',
    scalesWith: 'dexterity',
    reqLevel: 1,
    energyCost: 9,
    cooldownMs: 4000,
    castMs: 0,
    interruptible: false,
    range: 14,
    kind: 'damage',
    weaponMultiplier: 1.5,
    flatPower: 4,
    damageType: 'physical',
    threatBonus: 8,
    description: 'A snapped-off shot. 150% weapon damage at long range.',
  },
  hunters_mark: {
    id: 'hunters_mark',
    name: "Hunter's Mark",
    classId: 'ranger',
    scalesWith: 'dexterity',
    reqLevel: 3,
    energyCost: 13,
    cooldownMs: 9000,
    castMs: 0,
    interruptible: false,
    range: 14,
    kind: 'dot',
    flatPower: 7,
    damageType: 'physical',
    durationMs: 9000,
    tickMs: 3000,
    description: 'Mark the quarry. Bleeding damage over 9s, ignores armour.',
  },
  steady_aim: {
    id: 'steady_aim',
    name: 'Steady Aim',
    classId: 'ranger',
    scalesWith: 'strength',
    reqLevel: 5,
    energyCost: 20,
    cooldownMs: 28000,
    castMs: 0,
    interruptible: false,
    range: 0,
    kind: 'buff',
    damageMultiplier: 1.35,
    durationMs: 12000,
    tickMs: 1000,
    description: 'Settle your breathing. +35% weapon damage for 12s.',
  },
  pinning_shot: {
    id: 'pinning_shot',
    name: 'Pinning Shot',
    classId: 'ranger',
    reqLevel: 8,
    energyCost: 14,
    cooldownMs: 14000,
    castMs: 0,
    interruptible: false,
    range: 16,
    kind: 'interrupt',
    lockoutMs: 7000,
    threatBonus: 10,
    description: 'Pin a caster mid-spell. Stops it and locks it out for 7s.',
  },
  field_dressing: {
    id: 'field_dressing',
    name: 'Field Dressing',
    classId: 'ranger',
    scalesWith: 'strength',
    reqLevel: 11,
    energyCost: 22,
    cooldownMs: 20000,
    castMs: 1600,
    interruptible: true,
    range: 0,
    kind: 'heal',
    flatPower: 45,
    description: 'Bind your wounds in the field. Moderate heal, breakable.',
  },
  volley: {
    id: 'volley',
    name: 'Volley',
    classId: 'ranger',
    scalesWith: 'strength',
    reqLevel: 15,
    energyCost: 36,
    cooldownMs: 26000,
    castMs: 0,
    interruptible: false,
    range: 14,
    kind: 'damage',
    weaponMultiplier: 3.1,
    flatPower: 20,
    damageType: 'physical',
    threatBonus: 30,
    // Untouched. A Ranger who has kept their distance shoots straighter, which
    // is the one thing the class is *for* and which no number said until now.
    when: { kind: 'steady', above: 0.8, multiplier: 1.55 },
    description: 'Empty the quiver. 310% weapon damage, and more while you are unhurt.',
  },

  // === ROGUE — Dexterity, melee, burst =====================================
  backstab: {
    id: 'backstab',
    name: 'Backstab',
    classId: 'rogue',
    scalesWith: 'dexterity',
    reqLevel: 1,
    energyCost: 9,
    cooldownMs: 4000,
    castMs: 0,
    interruptible: false,
    range: 2.5,
    kind: 'damage',
    weaponMultiplier: 1.75,
    flatPower: 4,
    damageType: 'physical',
    threatBonus: 6,
    description: 'A blade where the armour is not. 175% weapon damage.',
  },
  rupture: {
    id: 'rupture',
    name: 'Rupture',
    classId: 'rogue',
    scalesWith: 'strength',
    reqLevel: 2,
    energyCost: 12,
    cooldownMs: 9000,
    castMs: 0,
    interruptible: false,
    range: 2.5,
    kind: 'dot',
    flatPower: 8,
    damageType: 'physical',
    durationMs: 8000,
    tickMs: 2000,
    description: 'A wound that will not close. Damage over 8s, ignores armour.',
  },
  evade: {
    id: 'evade',
    name: 'Evade',
    classId: 'rogue',
    scalesWith: 'dexterity',
    reqLevel: 5,
    energyCost: 18,
    cooldownMs: 22000,
    castMs: 0,
    interruptible: false,
    range: 0,
    kind: 'buff',
    defenseBonus: 75,
    durationMs: 14000,
    tickMs: 1000,
    description: 'Slip every second blow. +75 defence for 14s.',
  },
  kidney_strike: {
    id: 'kidney_strike',
    name: 'Kidney Strike',
    classId: 'rogue',
    reqLevel: 8,
    energyCost: 14,
    cooldownMs: 13000,
    castMs: 0,
    interruptible: false,
    range: 2.5,
    kind: 'interrupt',
    lockoutMs: 7000,
    threatBonus: 8,
    description: 'Drive the wind out of a caster. Stops it, locks it out 7s.',
  },
  adrenaline: {
    id: 'adrenaline',
    name: 'Adrenaline',
    classId: 'rogue',
    scalesWith: 'strength',
    reqLevel: 11,
    energyCost: 26,
    cooldownMs: 34000,
    castMs: 0,
    interruptible: false,
    range: 0,
    kind: 'buff',
    damageMultiplier: 1.5,
    durationMs: 9000,
    tickMs: 1000,
    description: 'Everything sharpens. +50% weapon damage for 9s.',
  },
  assassinate: {
    id: 'assassinate',
    name: 'Assassinate',
    classId: 'rogue',
    scalesWith: 'dexterity',
    reqLevel: 15,
    energyCost: 34,
    cooldownMs: 26000,
    castMs: 0,
    interruptible: false,
    range: 2.5,
    kind: 'damage',
    weaponMultiplier: 3.4,
    flatPower: 18,
    // On something that has not noticed you. A skill called Assassinate that
    // is worth no more on an unaware target than on one already swinging at
    // you is a skill with a lie for a name.
    when: { kind: 'opener', multiplier: 2.1 },
    damageType: 'physical',
    threatBonus: 25,
    description: 'One committed strike. 340% weapon damage.',
  },

  // === MAGE — Focus, ranged burst, fragile =================================
  frostbolt: {
    id: 'frostbolt',
    name: 'Frostbolt',
    classId: 'mage',
    scalesWith: 'focus',
    reqLevel: 1,
    energyCost: 11,
    cooldownMs: 4000,
    castMs: 0,
    interruptible: false,
    range: 12,
    kind: 'damage',
    weaponMultiplier: 1.7,
    flatPower: 5,
    damageType: 'frost',
    threatBonus: 9,
    description: 'A shard of cold at range. 170% weapon damage.',
  },
  ember: {
    id: 'ember',
    name: 'Ember',
    classId: 'mage',
    scalesWith: 'focus',
    reqLevel: 3,
    energyCost: 15,
    cooldownMs: 10000,
    castMs: 0,
    interruptible: false,
    range: 12,
    kind: 'dot',
    flatPower: 10,
    damageType: 'fire',
    durationMs: 9000,
    tickMs: 3000,
    description: 'Set them burning. Damage over 9s, ignores armour.',
  },
  counterspell: {
    id: 'counterspell',
    name: 'Counterspell',
    classId: 'mage',
    reqLevel: 6,
    energyCost: 13,
    cooldownMs: 12000,
    castMs: 0,
    interruptible: false,
    range: 15,
    kind: 'interrupt',
    lockoutMs: 10000,
    threatBonus: 10,
    description: 'Unmake a spell as it forms. Locks it out for 10s.',
  },
  mana_shield: {
    id: 'mana_shield',
    name: 'Mana Shield',
    classId: 'mage',
    scalesWith: 'focus',
    reqLevel: 9,
    energyCost: 26,
    cooldownMs: 26000,
    castMs: 0,
    interruptible: false,
    range: 0,
    kind: 'buff',
    defenseBonus: 70,
    durationMs: 12000,
    tickMs: 1000,
    description: 'A skin of woven force. +70 defence for 12s.',
  },
  arcane_surge: {
    id: 'arcane_surge',
    name: 'Arcane Surge',
    classId: 'mage',
    scalesWith: 'focus',
    reqLevel: 12,
    energyCost: 28,
    cooldownMs: 32000,
    castMs: 0,
    interruptible: false,
    range: 0,
    kind: 'buff',
    damageMultiplier: 1.45,
    durationMs: 10000,
    tickMs: 1000,
    description: 'Draw deep. +45% spell damage for 10s.',
  },
  meteor: {
    id: 'meteor',
    name: 'Meteor',
    classId: 'mage',
    scalesWith: 'focus',
    reqLevel: 15,
    energyCost: 42,
    cooldownMs: 28000,
    castMs: 1400,
    interruptible: true,
    range: 12,
    kind: 'damage',
    weaponMultiplier: 3.8,
    flatPower: 24,
    // Ember first, then this. A two-button order the Mage actually has to
    // think about, rather than a cooldown queue.
    when: { kind: 'onDot', dotId: 'ember', multiplier: 1.6 },
    damageType: 'fire',
    threatBonus: 35,
    description: 'Call something down. 380% weapon damage, but it must be cast.',
  },
};

// === ZONE-TAUGHT SKILLS ====================================================
//
// The starting kit above is granted by level and finishes at 15. Across a
// hundred-level game that meant seventy-five levels during which nothing new
// ever appeared on the bar — you got bigger numbers and no new decisions.
//
// So every zone past the Fenmarch TEACHES three skills per class, and a skill
// is taught by an item, not by a level:
//
//   | Tome | Where it comes from |
//   |---|---|
//   | uncommon | the zone's trader sells it |
//   | rare | the zone's ★5 boss, or rarely from its ★3–★4 camps |
//   | epic | the zone's ★6 elite boss, and nowhere else |
//
// That is deliberately the same shape as the gear rule — quality climbs with
// difficulty, the vendor never stocks above uncommon — so learning a zone's
// kit is a reason to fight its bosses rather than a reason to grind its trash.
//
// Generated rather than hand-written for the same reason the late weapon
// ladders are: five classes times nine skills is forty-five sets of numbers,
// and a hand-typed one that lands 20% high is a class that quietly outscales
// the rest. Every class runs the same table, so parity is structural.

/** What one zone teaches: three tiers, at the levels its bosses sit at. */
interface TaughtTier {
  zoneId: string;
  /** Level the skill unlocks at — set just past the boss that drops its tome. */
  level: number;
  quality: 'uncommon' | 'rare' | 'epic';
  role: 'buff-defense' | 'buff-damage' | 'damage' | 'heavy' | 'dot' | 'heal' | 'interrupt';
}

const TAUGHT_TIERS: TaughtTier[] = [
  // Ardmoor: hold the line on open ground, then hit harder.
  { zoneId: 'ardmoor', level: 22, quality: 'uncommon', role: 'buff-defense' },
  { zoneId: 'ardmoor', level: 31, quality: 'rare', role: 'damage' },
  { zoneId: 'ardmoor', level: 40, quality: 'epic', role: 'dot' },
  // The Sunken Wood: attrition. Sustain, pressure, then a burst window.
  { zoneId: 'reach', level: 44, quality: 'uncommon', role: 'heal' },
  { zoneId: 'reach', level: 56, quality: 'rare', role: 'damage' },
  { zoneId: 'reach', level: 70, quality: 'epic', role: 'buff-damage' },
  // Caer Dubh: control, then everything you have.
  { zoneId: 'caer_dubh', level: 72, quality: 'uncommon', role: 'interrupt' },
  { zoneId: 'caer_dubh', level: 86, quality: 'rare', role: 'damage' },
  { zoneId: 'caer_dubh', level: 100, quality: 'epic', role: 'heavy' },
];

/**
 * The two attributes a class's bar is written across.
 *
 * `power` is what its offensive skills draw on and `guard` is what its
 * defensive ones do — except where a skill deliberately crosses over, which is
 * the whole point. A Rogue's Rupture is a Strength skill on a Dexterity class,
 * so a Rogue who buys Strength has a bar worth pressing rather than a build
 * that is simply worse.
 *
 * The casters name Focus for both. A Druid is a Druid, and their decision is
 * how much Focus they give up for Vitality rather than which half of the bar
 * they use.
 */
export const CLASS_ATTRIBUTES: Record<ClassId, { power: keyof Attributes; guard: keyof Attributes }> = {
  warrior: { power: 'strength', guard: 'vitality' },
  rogue: { power: 'dexterity', guard: 'strength' },
  ranger: { power: 'dexterity', guard: 'strength' },
  mage: { power: 'focus', guard: 'focus' },
  priest: { power: 'focus', guard: 'focus' },
};

/**
 * Which attribute a taught skill draws on.
 *
 * Damage and dots go on the class's power attribute, heals and buffs on its
 * guard — and every third damage skill crosses over, so the guard build is not
 * left with nothing to press. Interrupts name nothing: an interrupt is an
 * interrupt at any Strength.
 */
function taughtScaling(
  classId: ClassId,
  role: TaughtTier['role'],
  index: number,
): keyof Attributes | undefined {
  const pair = CLASS_ATTRIBUTES[classId];
  if (role === 'interrupt') return undefined;
  if (role === 'buff-defense' || role === 'heal') return pair.guard;
  // Exactly one crossover, and it is the first dot: enough that the guard
  // build has something to press in a fight, not so much that the power
  // attribute stops being the one the class is built around. The first pass
  // sent the capstone and the damage buff across too and left a Warrior with
  // more Vitality skills than Strength ones.
  if (index === 2) return pair.guard;
  return pair.power;
}

/** How each class delivers a skill: reach, damage school, and its buff floor. */
const CLASS_FEEL: Record<
  ClassId,
  { range: number; damageType: SkillDef['damageType']; baseDefense: number; tomeNoun: string }
> = {
  warrior: { range: 2.8, damageType: 'physical', baseDefense: 40, tomeNoun: 'Warscroll' },
  priest: { range: 9, damageType: 'nature', baseDefense: 55, tomeNoun: 'Psalter' },
  ranger: { range: 14, damageType: 'physical', baseDefense: 45, tomeNoun: 'Field Notes' },
  rogue: { range: 2.5, damageType: 'physical', baseDefense: 75, tomeNoun: 'Cipher' },
  mage: { range: 12, damageType: 'fire', baseDefense: 70, tomeNoun: 'Grimoire' },
};

/**
 * Names, nine per class, in tier order. Hand-written because this is the one
 * part a player actually reads — generated names all sound like each other,
 * and the whole point is that Ardmoor's kit feels like Ardmoor's.
 */
const TAUGHT_NAMES: Record<ClassId, string[]> = {
  warrior: [
    'Cairn Stance', 'Hillbreaker', 'Grudge Wound',
    'Second Breath', 'Drowned Cleave', 'Blood Rising',
    'Iron Silence', 'Blackshield Blow', 'Last Word',
  ],
  priest: [
    'Stone Vigil', 'Highland Rite', 'Slow Penance',
    'Wellspring', 'Drowned Litany', 'Kindled Faith',
    'Binding Word', 'Duskfall Judgement', 'Final Prayer',
  ],
  ranger: [
    'Crag Cover', 'Scree Shot', 'Bleeding Mark',
    'Field Suture', 'Bogmire Volley', 'Hunting Fever',
    'Snarecall', 'Duskloosed Arrow', 'Last Quiver',
  ],
  rogue: [
    'Scree Step', 'Cutthroat', 'Slow Bleed',
    'Stolen Breath', 'Drowned Blade', 'Feverwork',
    'Throatlock', 'Duskstrike', 'Last Cut',
  ],
  mage: [
    'Hoarfrost Ward', 'Craglance', 'Witchfire',
    'Kindled Ember', 'Bogmire Bolt', 'Wildsurge',
    'Unmaking', 'Duskbolt', 'Last Star',
  ],
};

/** Flavour line per role, filled with the class's own noun. */
function taughtDescription(role: TaughtTier['role'], power: string): string {
  switch (role) {
    case 'buff-defense':
      return `Set yourself against what is coming. ${power}`;
    case 'buff-damage':
      return `Everything lands harder for a moment. ${power}`;
    case 'damage':
      return `A committed blow taught in this country. ${power}`;
    case 'heavy':
      return `The last thing you have. ${power}`;
    case 'dot':
      return `A wound that keeps working. ${power}`;
    case 'heal':
      return `Buy yourself the time to finish this. ${power}`;
    case 'interrupt':
      return `Cut a spell off at the root. ${power}`;
  }
}

/** The tome item id for a taught skill. `items.ts` builds the item from it. */
export function tomeIdFor(skillId: string): string {
  return `tome_${skillId}`;
}

function buildTaughtSkills(): Record<string, SkillDef> {
  const out: Record<string, SkillDef> = {};

  for (const classId of Object.keys(CLASS_FEEL) as ClassId[]) {
    const feel = CLASS_FEEL[classId];
    TAUGHT_TIERS.forEach((tier, i) => {
      const name = TAUGHT_NAMES[classId][i]!;
      const id = `${classId}_${slug(name)}`;
      const level = tier.level;
      const common = {
        id,
        name,
        classId,
        reqLevel: level,
        zoneId: tier.zoneId,
        taughtBy: tomeIdFor(id),
        scalesWith: taughtScaling(classId, tier.role, i),
      };

      switch (tier.role) {
        case 'buff-defense':
          out[id] = {
            ...common,
            energyCost: 22,
            cooldownMs: 30000,
            castMs: 0,
            interruptible: false,
            range: 0,
            kind: 'buff',
            // A FLAT base, deliberately: `scaledDefenseBonus` already grows a
            // buff with level. Scaling the base too was what previously made
            // high-level characters unhittable.
            defenseBonus: feel.baseDefense + 25,
            durationMs: 14000,
            tickMs: 1000,
            description: taughtDescription(tier.role, `+${feel.baseDefense + 25} defence for 14s.`),
          };
          break;
        case 'buff-damage':
          out[id] = {
            ...common,
            energyCost: 30,
            cooldownMs: 40000,
            castMs: 0,
            interruptible: false,
            range: 0,
            kind: 'buff',
            damageMultiplier: 1.55,
            durationMs: 10000,
            tickMs: 1000,
            description: taughtDescription(tier.role, '+55% damage for 10s.'),
          };
          break;
        case 'damage':
        case 'heavy': {
          const heavy = tier.role === 'heavy';
          const wm = heavy ? 4.4 : 2.6 + Math.floor(i / 3) * 0.4;
          out[id] = {
            ...common,
            // Deliberately expensive and slow to come back. A taught damage
            // skill is a spike, not filler: with three zones' worth of them
            // plus the level-15 capstone, cheap short-cooldown nukes let a
            // Ranger open with four in a row and delete a level-appropriate
            // ★3 in three seconds. Energy is what stops the opener being the
            // whole fight.
            energyCost: heavy ? 52 : 40,
            cooldownMs: heavy ? 45000 : 24000,
            castMs: heavy ? 1500 : 0,
            interruptible: heavy,
            range: feel.range,
            kind: 'damage',
            weaponMultiplier: wm,
            flatPower: Math.round(level * (heavy ? 1.3 : 0.9)),
            damageType: feel.damageType,
            threatBonus: heavy ? 40 : 25,
            description: taughtDescription(
              tier.role,
              `${Math.round(wm * 100)}% weapon damage${heavy ? ', but it must be cast.' : '.'}`,
            ),
          };
          break;
        }
        case 'dot':
          out[id] = {
            ...common,
            energyCost: 24,
            cooldownMs: 15000,
            castMs: 0,
            interruptible: false,
            range: feel.range,
            kind: 'dot',
            flatPower: Math.round(level * 0.6),
            damageType: feel.damageType,
            durationMs: 12000,
            tickMs: 3000,
            description: taughtDescription(tier.role, 'Damage over 12s, ignores armour.'),
          };
          break;
        case 'heal':
          out[id] = {
            ...common,
            energyCost: 30,
            cooldownMs: 18000,
            castMs: 1600,
            interruptible: true,
            range: 0,
            kind: 'heal',
            flatPower: Math.round(level * 3),
            description: taughtDescription(tier.role, 'A strong heal, but it can be broken.'),
          };
          break;
        case 'interrupt':
          out[id] = {
            ...common,
            energyCost: 18,
            cooldownMs: 11000,
            castMs: 0,
            interruptible: false,
            range: feel.range + 3,
            kind: 'interrupt',
            lockoutMs: 12000,
            threatBonus: 12,
            description: taughtDescription(tier.role, 'Stops it and locks it out for 12s.'),
          };
          break;
      }
    });
  }
  return out;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

Object.assign(SKILLS, buildTaughtSkills());

/** Every skill a zone teaches, for vendors, loot tables and tests. */
export function skillsTaughtBy(zoneId: string): SkillDef[] {
  return Object.values(SKILLS)
    .filter((s) => s.zoneId === zoneId)
    .sort((a, b) => a.reqLevel - b.reqLevel);
}

/** The tome that teaches a zone's tier, per class: [uncommon, rare, epic]. */
export function zoneTomes(zoneId: string, quality: 'uncommon' | 'rare' | 'epic'): Partial<Record<ClassId, string>> {
  const index = { uncommon: 0, rare: 1, epic: 2 }[quality];
  const out: Partial<Record<ClassId, string>> = {};
  for (const classId of Object.keys(CLASS_FEEL) as ClassId[]) {
    const forClass = skillsTaughtBy(zoneId).filter((s) => s.classId === classId);
    const skill = forClass[index];
    if (skill?.taughtBy) out[classId] = skill.taughtBy;
  }
  return out;
}

/** Noun for the item that teaches a class its skills — flavour only. */
export function tomeNoun(classId: ClassId): string {
  return CLASS_FEEL[classId].tomeNoun;
}

export function getSkill(id: string): SkillDef {
  const skill = SKILLS[id];
  if (!skill) throw new Error(`Unknown skill: ${id}`);
  return skill;
}

/**
 * Skills a class can actually cast right now.
 *
 * Level is necessary but not sufficient: a taught skill also has to have been
 * learned from its tome. `known` defaults to empty, which means "level-granted
 * kit only" — the right answer for a fresh character and for any caller that
 * does not care about tomes.
 */
export function skillsForClass(
  classId: string,
  level: number,
  known: readonly string[] = [],
): SkillDef[] {
  return Object.values(SKILLS)
    .filter(
      (s) =>
        s.classId === classId &&
        s.reqLevel <= level &&
        (!s.taughtBy || known.includes(s.id)),
    )
    .sort((a, b) => a.reqLevel - b.reqLevel);
}

/** Every skill a class will ever have, in unlock order — the shape of its bar. */
export function skillBarFor(classId: ClassId): SkillDef[] {
  return Object.values(SKILLS)
    .filter((s) => s.classId === classId)
    .sort((a, b) => a.reqLevel - b.reqLevel);
}
