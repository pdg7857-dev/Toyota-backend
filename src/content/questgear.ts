import type { ArmorSlot, ClassId, ItemDef } from '../sim/types.js';
import { ARMOR_SLOT_SHARE, curveArmorTotal, curveWeaponDps } from './curves.js';

/**
 * The armour lines: a zone's second quest chain, and the gear it pays out.
 *
 * The story chain gives a zone direction. This one gives it a *wardrobe*.
 * Four steps, one armour slot each, walking up the zone's bands; then a
 * capstone that asks for a handful of every trophy the line has taught you to
 * farm and pays out a weapon for your class.
 *
 * Two things make it worth doing rather than just playing on:
 *
 *  - It is the only gear in the game you can plan for. Everything else is a
 *    drop rate: you fight the camp and hope. A trophy at a known rate turns
 *    "hope" into "sixty more kills", which is the difference between a grind
 *    that feels long and one that feels arbitrary.
 *  - It pays in the slots drops are worst at filling. A player who never sees
 *    a chest piece can go and *get* one.
 *
 * Deliberately NOT best in slot. A set piece sits a little above the vendor
 * tier and below what a boss or a rare spawn carries — see `QUEST_GEAR_POWER`.
 */

export interface ArmourStep {
  slot: ArmorSlot;
  /** Level the step is set at; the piece is built for it. */
  level: number;
  /** Camp the trophy drops from. */
  mobId: string;
  /** Display name of the trophy, e.g. "Bog Wolf Fang". */
  trophy: string;
  /** How many the step asks for. */
  count: number;
  name: string;
  summary: string;
}

export interface ArmourLine {
  zoneId: string;
  giverVendorId: string;
  /** Names every piece: "Fenwarden Helm", "Fenwarden Hauberk"... */
  setName: string;
  steps: ArmourStep[];
  capstone: {
    level: number;
    /** How many of EACH of the line's four trophies the weapon costs. */
    each: number;
    name: string;
    summary: string;
  };
}

/**
 * How far above the ladder curve quest gear sits.
 *
 * A hair above, no more. This gear is guaranteed, and guaranteed gear that
 * beat what bosses and rare spawns carry would make every drop in the game
 * pointless — the grind would be the only path rather than the reliable one.
 */
const QUEST_GEAR_POWER = 1.06;

/** The capstone weapon is worth more than a set piece, but still not epic. */
const QUEST_WEAPON_POWER = 1.08;

/** Trophies drop at this rate from their camp, which is what makes the count plannable. */
export const TROPHY_DROP_CHANCE = 0.12;

const ARMOUR_NOUN: Record<ArmorSlot, string> = {
  head: 'Helm',
  chest: 'Hauberk',
  legs: 'Greaves',
  ring: 'Band',
};

const WEAPON_NOUN: Record<ClassId, string> = {
  warrior: 'Sword',
  priest: 'Crook',
  ranger: 'Longbow',
  rogue: 'Knives',
  mage: 'Wand',
};

const CLASS_FEEL: Record<
  ClassId,
  { swingMs: number; attackRange: number; damageType: ItemDef['damageType']; primary: 'strength' | 'dexterity' | 'focus' }
> = {
  warrior: { swingMs: 1850, attackRange: 2.7, damageType: 'physical', primary: 'strength' },
  priest: { swingMs: 2100, attackRange: 2.9, damageType: 'nature', primary: 'focus' },
  ranger: { swingMs: 2400, attackRange: 12, damageType: 'physical', primary: 'dexterity' },
  rogue: { swingMs: 1400, attackRange: 2.3, damageType: 'physical', primary: 'dexterity' },
  mage: { swingMs: 2000, attackRange: 10, damageType: 'fire', primary: 'focus' },
};

export const ARMOUR_LINES: ArmourLine[] = [
  {
    zoneId: 'fenmarch',
    giverVendorId: 'maeve',
    setName: 'Fenwarden',
    steps: [
      {
        slot: 'head',
        level: 6,
        mobId: 'fen_adder',
        trophy: 'Adder Fang',
        count: 6,
        name: 'What the Fen Owes',
        summary: 'Maeve has a helm half-finished and needs fangs to set in it.',
      },
      {
        slot: 'legs',
        level: 10,
        mobId: 'bog_wolf',
        trophy: 'Wolf Sinew',
        count: 7,
        name: 'Sinew and Strap',
        summary: 'Wolf sinew binds better than thread, and the bog is full of wolves.',
      },
      {
        slot: 'chest',
        level: 15,
        mobId: 'outlaw_reaver',
        trophy: 'Reaver Buckle',
        count: 8,
        name: 'Taken Back',
        summary: 'The reavers are wearing plate they stripped off honest people.',
      },
      {
        slot: 'ring',
        level: 20,
        mobId: 'fen_lynx',
        trophy: 'Lynx Claw',
        count: 8,
        name: 'A Warden\'s Band',
        summary: 'One more thing, and the set is a warden\'s kit rather than scraps.',
      },
    ],
    capstone: {
      level: 23,
      each: 4,
      name: 'The Warden\'s Own',
      summary:
        'Maeve will finish the kit properly — a weapon to match it — for a full set of everything you have been bringing her.',
    },
  },
  {
    zoneId: 'ardmoor',
    giverVendorId: 'sorcha',
    setName: 'Cragwatch',
    steps: [
      {
        slot: 'head',
        level: 24,
        mobId: 'crag_goat',
        trophy: 'Crag Horn',
        count: 6,
        name: 'Horn and Hide',
        summary: 'Sorcha wants horn for the browguard. The goats have plenty.',
      },
      {
        slot: 'legs',
        level: 29,
        mobId: 'hill_wolf',
        trophy: 'Hill Wolf Hide',
        count: 7,
        name: 'Against the Wind',
        summary: 'Nothing on this hill keeps the cold out like a hill wolf did.',
      },
      {
        slot: 'chest',
        level: 34,
        mobId: 'clan_axeman',
        trophy: 'Clan Ringmail',
        count: 8,
        name: 'Rings and Rivets',
        summary: 'The clans make good mail. They are not using all of it.',
      },
      {
        slot: 'ring',
        level: 38,
        mobId: 'highland_bear',
        trophy: 'Bear Tooth',
        count: 8,
        name: 'The Cragwatch Band',
        summary: 'A tooth for the setting, and Sorcha will call the set finished.',
      },
    ],
    capstone: {
      level: 40,
      each: 4,
      name: 'What the Hills Are Owed',
      summary:
        'Bring the lot again and Sorcha will have the smith make you something to carry with it.',
    },
  },
  {
    zoneId: 'reach',
    giverVendorId: 'odhran',
    setName: 'Wyldwarden',
    steps: [
      {
        slot: 'head',
        level: 44,
        mobId: 'reach_eel',
        trophy: 'Eel Vertebra',
        count: 6,
        name: 'Out of the Water',
        summary: 'Odhrán swears eel-bone lacquer turns a blade. Prove him right.',
      },
      {
        slot: 'legs',
        level: 52,
        mobId: 'marsh_heron',
        trophy: 'Heron Quill',
        count: 7,
        name: 'Quiet Wading',
        summary: 'Quills, layered, will keep the drowned wood out of your boots.',
      },
      {
        slot: 'chest',
        level: 60,
        mobId: 'smuggler_enforcer',
        trophy: 'Smuggler\'s Plate',
        count: 8,
        name: 'Salvage Rights',
        summary: 'The enforcers took that plate off a wreck. It was never theirs.',
      },
      {
        slot: 'ring',
        level: 66,
        mobId: 'great_pike',
        trophy: 'Pike Scale',
        count: 8,
        name: 'The Wyldwarden Band',
        summary: 'One scale off an old pike, and the set is done.',
      },
    ],
    capstone: {
      level: 68,
      each: 4,
      name: 'What the Wood Keeps',
      summary: 'A full set of everything again, and Odhrán will part with the good steel.',
    },
  },
  {
    zoneId: 'caer_dubh',
    giverVendorId: 'aoife',
    setName: 'Duskward',
    steps: [
      {
        slot: 'head',
        level: 72,
        mobId: 'fort_mastiff',
        trophy: 'Mastiff Collar',
        count: 6,
        name: 'Off the Hounds',
        summary: 'The collars are good iron, and the hounds have no use for them.',
      },
      {
        slot: 'legs',
        level: 80,
        mobId: 'warband_levy',
        trophy: 'Levy Greave',
        count: 7,
        name: 'What the Levy Wore',
        summary: 'Aoife buries them. She sees no reason to bury good greaves too.',
      },
      {
        slot: 'chest',
        level: 88,
        mobId: 'blackshield_spearman',
        trophy: 'Blackshield Scale',
        count: 8,
        name: 'Scale by Scale',
        summary: 'Blackshield scale is the best worn armour this side of the gate.',
      },
      {
        slot: 'ring',
        level: 94,
        mobId: 'warhound_alpha',
        trophy: 'Warhound Fang',
        count: 8,
        name: 'The Duskward Band',
        summary: 'A fang from the pack leader. Nothing else will set right.',
      },
    ],
    capstone: {
      level: 97,
      each: 4,
      name: 'Nothing Left to Bury',
      summary:
        'Everything again, and Sister Aoife will see you armed as well as you are armoured.',
    },
  },
];

/** Item id of the trophy a step asks for. */
export function trophyId(step: ArmourStep): string {
  return `trophy_${step.mobId}`;
}

/** Item id of the set piece a step pays out. */
export function questArmourId(line: ArmourLine, step: ArmourStep): string {
  return `quest_${line.zoneId}_${step.slot}`;
}

/** Item id of a line's capstone weapon for one class. */
export function questWeaponId(line: ArmourLine, classId: ClassId): string {
  return `quest_${line.zoneId}_${classId}_weapon`;
}

/** Capstone weapons in `classItems` shape, for the quest reward. */
export function questWeapons(line: ArmourLine): Partial<Record<ClassId, string>> {
  const out: Partial<Record<ClassId, string>> = {};
  for (const classId of Object.keys(CLASS_FEEL) as ClassId[]) {
    out[classId] = questWeaponId(line, classId);
  }
  return out;
}

/** Every trophy, keyed by the mob that drops it — for the loot tables. */
export function trophiesByMob(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of ARMOUR_LINES) {
    for (const step of line.steps) out[step.mobId] = trophyId(step);
  }
  return out;
}

/** Trophies, set pieces and capstone weapons, generated from the lines above. */
export function buildQuestGear(): Record<string, ItemDef> {
  const out: Record<string, ItemDef> = {};

  for (const line of ARMOUR_LINES) {
    for (const step of line.steps) {
      // The trophy. Worth almost nothing at a vendor on purpose: its value is
      // that a quest wants it, and a trophy you can sell for real money is a
      // trophy players sell by accident.
      out[trophyId(step)] = {
        id: trophyId(step),
        name: step.trophy,
        slot: null,
        quality: 'uncommon',
        value: Math.max(2, Math.round(Math.pow(step.level, 1.4) * 0.5)),
        stackable: true,
      };

      out[questArmourId(line, step)] = {
        id: questArmourId(line, step),
        name: `${line.setName} ${ARMOUR_NOUN[step.slot]}`,
        slot: step.slot,
        quality: 'rare',
        value: Math.round(Math.pow(step.level, 1.9) * 0.9 * 2.4),
        armor: Math.max(
          1,
          Math.round(curveArmorTotal(step.level) * ARMOR_SLOT_SHARE[step.slot] * QUEST_GEAR_POWER),
        ),
        attributes: {
          vitality: Math.round(step.level * 0.42),
          strength: Math.round(step.level * 0.19),
          focus: Math.round(step.level * 0.19),
          dexterity: Math.round(step.level * 0.19),
        },
      };
    }

    for (const classId of Object.keys(CLASS_FEEL) as ClassId[]) {
      const feel = CLASS_FEEL[classId];
      const level = line.capstone.level;
      const avg = (curveWeaponDps(level) * QUEST_WEAPON_POWER * feel.swingMs) / 1000;
      out[questWeaponId(line, classId)] = {
        id: questWeaponId(line, classId),
        name: `${line.setName} ${WEAPON_NOUN[classId]}`,
        slot: 'weapon',
        quality: 'rare',
        classes: [classId],
        value: Math.round(Math.pow(level, 1.9) * 0.9 * 2.4),
        damageMin: Math.round(avg * 0.78),
        damageMax: Math.round(avg * 1.22),
        damageType: feel.damageType,
        swingMs: feel.swingMs,
        attackRange: feel.attackRange,
        attributes: {
          [feel.primary]: Math.round(level * 0.92),
          vitality: Math.round(level * 0.5),
        },
      };
    }
  }
  return out;
}
