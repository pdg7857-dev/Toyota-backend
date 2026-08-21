import type { ClassId, SkillDef } from '../sim/types.js';

/**
 * Skill registry.
 *
 * Unlocks are spread across the 1–25 band so a grinding player always has a
 * next thing coming, rather than finishing their kit before the halfway point.
 *
 * Both playable classes get an interrupt, but they are not the same tool: the
 * Priest's is long-ranged, comes earlier and locks out for longer — cutting a
 * cast short is the class's identity, not a bonus button.
 */
export const SKILLS: Record<string, SkillDef> = {
  // === WARRIOR =============================================================
  strike: {
    id: 'strike',
    name: 'Strike',
    classId: 'warrior',
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
    reqLevel: 15,
    energyCost: 34,
    cooldownMs: 26000,
    castMs: 0,
    interruptible: false,
    range: 2.8,
    kind: 'damage',
    weaponMultiplier: 3.2,
    flatPower: 20,
    damageType: 'physical',
    threatBonus: 35,
    description: 'Throw everything into one blow. 320% weapon damage.',
  },

  // === PRIEST ==============================================================
  smite: {
    id: 'smite',
    name: 'Smite',
    classId: 'priest',
    reqLevel: 1,
    energyCost: 10,
    cooldownMs: 4000,
    castMs: 0,
    interruptible: false,
    range: 9,
    kind: 'damage',
    weaponMultiplier: 1.5,
    flatPower: 5,
    damageType: 'nature',
    threatBonus: 8,
    description: 'A bolt of judgement at range. 150% weapon damage.',
  },
  mend_wounds: {
    id: 'mend_wounds',
    name: 'Mend Wounds',
    classId: 'priest',
    reqLevel: 3,
    energyCost: 22,
    cooldownMs: 13000,
    castMs: 1800,
    interruptible: true,
    range: 0,
    kind: 'heal',
    flatPower: 60,
    description: 'Knit your wounds closed. A strong heal, but it can be broken.',
  },
  searing_word: {
    id: 'searing_word',
    name: 'Searing Word',
    classId: 'priest',
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
};

export function getSkill(id: string): SkillDef {
  const skill = SKILLS[id];
  if (!skill) throw new Error(`Unknown skill: ${id}`);
  return skill;
}

/** Skills a class has unlocked at a given level, in unlock order. */
export function skillsForClass(classId: string, level: number): SkillDef[] {
  return Object.values(SKILLS)
    .filter((s) => s.classId === classId && s.reqLevel <= level)
    .sort((a, b) => a.reqLevel - b.reqLevel);
}

/** Every skill a class will ever have, in unlock order — the shape of its bar. */
export function skillBarFor(classId: ClassId): SkillDef[] {
  return Object.values(SKILLS)
    .filter((s) => s.classId === classId)
    .sort((a, b) => a.reqLevel - b.reqLevel);
}
