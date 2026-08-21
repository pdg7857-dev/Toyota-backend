import type { SkillDef } from '../sim/types.js';

/**
 * Skill registry. Only the Warrior is filled in for the vertical slice — the
 * other four classes are the same shape, which is the point of keeping this
 * data-driven.
 *
 * Unlocks are spread across the 1–25 band so a grinding player always has a
 * next thing coming, rather than finishing their kit before the halfway point.
 */
export const SKILLS: Record<string, SkillDef> = {
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
