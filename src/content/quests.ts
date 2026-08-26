import { xpToNext } from '../sim/formulas.js';
import {
  ARMOUR_LINES,
  questArmourId,
  questWeapons,
  trophyId,
  type ArmourLine,
} from './questgear.js';
import type { QuestDef } from '../sim/types.js';

/**
 * Quest chains, one per zone.
 *
 * These exist to give a zone DIRECTION. The Fenmarch without them is a field of
 * camps with nothing to say the interesting thing is south; with them it is a
 * route. Each chain walks band by band toward the zone's bosses and ends by
 * pointing at the next zone, which is also how a player learns the zones
 * overlap rather than replace each other.
 *
 * `requires` links each step to the last, so a chain is strictly ordered and a
 * player can never pick up "kill the boss" before "clear the road to him".
 */
/**
 * Quest reward, derived from the level it is set at.
 *
 * Hand-picked numbers do not survive a hundred levels: the same "feels big"
 * figure is a fortune at 20 and a rounding error at 90. Scaling off the level's
 * own xp requirement keeps every chain worth a similar slice of its band —
 * enough to be worth following, never enough to skip the grind it signposts.
 */
function reward(level: number, weight: number, gold = 0.4): { xp: number; gold: number } {
  const xp = Math.round(xpToNext(level) * weight);
  return { xp, gold: Math.round(xp * gold) };
}

export const QUESTS: Record<string, QuestDef> = {
  fen_01: {
    id: 'fen_01',
    name: 'Thin the Moor',
    zoneId: 'fenmarch',
    chain: 'fenmarch_story',
    giverVendorId: 'maeve',
    minLevel: 1,
    summary: 'Maeve wants the hares off the moor before they strip it bare.',
    objectives: [
      { kind: 'kill', mobId: 'moor_hare', count: 8, text: 'Cull Moor Hares' },
    ],
    rewards: {
      ...reward(1, 0.7),
    },
  },
  fen_02: {
    id: 'fen_02',
    name: 'Tusk and Hide',
    zoneId: 'fenmarch',
    chain: 'fenmarch_story',
    giverVendorId: 'maeve',
    minLevel: 3,
    requires: 'fen_01',
    summary: 'The boars south of the stones have grown bold. Bring proof.',
    objectives: [
      { kind: 'kill', mobId: 'mossback_boar', count: 10, text: 'Kill Mossback Boars' },
      { kind: 'collect', itemId: 'boar_tusk', count: 4, text: 'Collect Boar Tusks' },
    ],
    rewards: {
      ...reward(3, 0.7),
    },
  },
  fen_03: {
    id: 'fen_03',
    name: 'Wet Ground',
    zoneId: 'fenmarch',
    chain: 'fenmarch_story',
    giverVendorId: 'maeve',
    minLevel: 6,
    requires: 'fen_02',
    summary: 'Adders have taken the low ground. Clear a path through.',
    objectives: [
      { kind: 'kill', mobId: 'fen_adder', count: 12, text: 'Kill Fen Adders' },
    ],
    rewards: {
      ...reward(6, 0.7),
    },
  },
  fen_04: {
    id: 'fen_04',
    name: 'The Wolves of the Bog',
    zoneId: 'fenmarch',
    chain: 'fenmarch_story',
    giverVendorId: 'maeve',
    minLevel: 9,
    requires: 'fen_03',
    summary: 'A wolf pack is working the middle of the fen. Break it.',
    objectives: [
      { kind: 'kill', mobId: 'bog_wolf', count: 14, text: 'Kill Bog Wolves' },
      { kind: 'collect', itemId: 'wolf_pelt', count: 6, text: 'Collect Wolf Pelts' },
    ],
    rewards: {
      ...reward(9, 0.7),
    },
  },
  fen_05: {
    id: 'fen_05',
    name: 'The Road Watch',
    zoneId: 'fenmarch',
    chain: 'fenmarch_story',
    giverVendorId: 'maeve',
    minLevel: 13,
    requires: 'fen_04',
    summary: 'Outlaws have set a watch on the south road. Clear it.',
    objectives: [
      { kind: 'kill', mobId: 'outlaw_bowman', count: 12, text: 'Kill Outlaw Bowmen' },
      { kind: 'kill', mobId: 'outlaw_reaver', count: 10, text: 'Kill Outlaw Reavers' },
    ],
    rewards: {
      ...reward(13, 0.7),
    },
  },
  fen_06: {
    id: 'fen_06',
    name: 'The Cattle-Thief',
    zoneId: 'fenmarch',
    chain: 'fenmarch_story',
    giverVendorId: 'maeve',
    minLevel: 18,
    requires: 'fen_05',
    summary: 'Cadfael\'s band has bled the Fenmarch long enough. End him.',
    objectives: [
      { kind: 'kill', mobId: 'cadfael', count: 1, text: 'Kill Cadfael, the Outlaw Chief' },
    ],
    rewards: {
      ...reward(18, 2),
      classItems: {
        warrior: 'boar_spear',
        druid: 'prayerwood_stave',
        ranger: 'fenstalker_bow',
        rogue: 'fenblade',
        mage: 'fenlight_rod',
      },
    },
  },
  fen_07: {
    id: 'fen_07',
    name: 'Old Scar',
    zoneId: 'fenmarch',
    chain: 'fenmarch_story',
    giverVendorId: 'maeve',
    minLevel: 22,
    requires: 'fen_06',
    summary: 'The bear in the southern marsh has killed three traders. Finish it.',
    objectives: [
      { kind: 'kill', mobId: 'old_scar', count: 1, text: 'Kill Old Scar' },
    ],
    rewards: {
      ...reward(22, 2),
    },
  },
  fen_08: {
    id: 'fen_08',
    name: 'The Hill Road',
    zoneId: 'fenmarch',
    chain: 'fenmarch_story',
    giverVendorId: 'maeve',
    minLevel: 20,
    requires: 'fen_07',
    summary: 'Ardmoor lies east along the hill road. Sorcha keeps the trade there.',
    objectives: [
      { kind: 'reach', zoneId: 'ardmoor', text: 'Travel to Ardmoor' },
    ],
    rewards: {
      ...reward(20, 0.7),
    },
  },
  ard_01: {
    id: 'ard_01',
    name: 'Goats and Grudges',
    zoneId: 'ardmoor',
    chain: 'ardmoor_story',
    giverVendorId: 'sorcha',
    minLevel: 20,
    summary: 'The crag goats are eating Sorcha out of a living. Thin them.',
    objectives: [
      { kind: 'kill', mobId: 'crag_goat', count: 12, text: 'Kill Crag Goats' },
    ],
    rewards: {
      ...reward(20, 0.7),
    },
  },
  ard_02: {
    id: 'ard_02',
    name: 'Hill Wolves',
    zoneId: 'ardmoor',
    chain: 'ardmoor_story',
    giverVendorId: 'sorcha',
    minLevel: 23,
    requires: 'ard_01',
    summary: 'Wolves follow the herds down the hill road. Break the pack.',
    objectives: [
      { kind: 'kill', mobId: 'hill_wolf', count: 14, text: 'Kill Hill Wolves' },
    ],
    rewards: {
      ...reward(23, 0.7),
    },
  },
  ard_03: {
    id: 'ard_03',
    name: 'Cattle Raiders',
    zoneId: 'ardmoor',
    chain: 'ardmoor_story',
    giverVendorId: 'sorcha',
    minLevel: 26,
    requires: 'ard_02',
    summary: 'The clans are lifting cattle again. Make it expensive.',
    objectives: [
      { kind: 'kill', mobId: 'cattle_raider', count: 14, text: 'Kill Cattle Raiders' },
      { kind: 'collect', itemId: 'clan_torc', count: 5, text: 'Collect Clan Torcs' },
    ],
    rewards: {
      ...reward(26, 0.7),
    },
  },
  ard_04: {
    id: 'ard_04',
    name: 'The Cattle-Lord',
    zoneId: 'ardmoor',
    chain: 'ardmoor_story',
    giverVendorId: 'sorcha',
    minLevel: 30,
    requires: 'ard_03',
    summary: 'Aonghus holds the fold and calls it his birthright. Take it back.',
    objectives: [
      { kind: 'kill', mobId: 'aonghus', count: 1, text: 'Kill Aonghus the Cattle-Lord' },
    ],
    rewards: {
      ...reward(30, 2),
      classItems: {
        warrior: 'gravebound_warrior_weapon',
        druid: 'gravebound_druid_weapon',
        ranger: 'gravebound_ranger_weapon',
        rogue: 'gravebound_rogue_weapon',
        mage: 'gravebound_mage_weapon',
      },
    },
  },
  ard_05: {
    id: 'ard_05',
    name: 'Nine Scars',
    zoneId: 'ardmoor',
    chain: 'ardmoor_story',
    giverVendorId: 'sorcha',
    minLevel: 38,
    requires: 'ard_04',
    summary: 'Muireann has united the hill clans. She cannot be allowed to march.',
    objectives: [
      { kind: 'kill', mobId: 'clan_berserker', count: 10, text: 'Kill Clan Berserkers' },
      { kind: 'kill', mobId: 'muireann', count: 1, text: 'Kill Muireann of the Nine Scars' },
    ],
    rewards: {
      ...reward(38, 2),
      classItems: {
        warrior: 'gravebound_warrior_weapon',
        druid: 'gravebound_druid_weapon',
        ranger: 'gravebound_ranger_weapon',
        rogue: 'gravebound_rogue_weapon',
        mage: 'gravebound_mage_weapon',
      },
    },
  },
  ard_06: {
    id: 'ard_06',
    name: 'The Drowned Causeway',
    zoneId: 'ardmoor',
    chain: 'ardmoor_story',
    giverVendorId: 'sorcha',
    minLevel: 40,
    requires: 'ard_05',
    summary: 'The causeway east runs into the Sunken Wood. Odhrán trades there.',
    objectives: [
      { kind: 'reach', zoneId: 'reach', text: 'Travel to the Sunken Wood' },
    ],
    rewards: {
      ...reward(40, 0.7),
    },
  },
  rch_01: {
    id: 'rch_01',
    name: 'Eels in the Shallows',
    zoneId: 'reach',
    chain: 'reach_story',
    giverVendorId: 'odhran',
    minLevel: 40,
    summary: 'The eels have made the shallows impassable. Clear them.',
    objectives: [
      { kind: 'kill', mobId: 'reach_eel', count: 14, text: 'Kill Blackwater Eels' },
    ],
    rewards: {
      ...reward(40, 0.7),
    },
  },
  rch_02: {
    id: 'rch_02',
    name: 'Wreckers\' Work',
    zoneId: 'reach',
    chain: 'reach_story',
    giverVendorId: 'odhran',
    minLevel: 46,
    requires: 'rch_01',
    summary: 'Scavengers are stripping wrecks Odhrán has a claim on.',
    objectives: [
      { kind: 'kill', mobId: 'wrecker_scavenger', count: 14, text: 'Kill Wrecker Scavengers' },
      { kind: 'collect', itemId: 'wreckers_salvage', count: 6, text: 'Recover Wreckers\' Salvage' },
    ],
    rewards: {
      ...reward(46, 0.7),
    },
  },
  rch_03: {
    id: 'rch_03',
    name: 'The Enforcers',
    zoneId: 'reach',
    chain: 'reach_story',
    giverVendorId: 'odhran',
    minLevel: 52,
    requires: 'rch_02',
    summary: 'Smugglers have started collecting tolls. Discourage them.',
    objectives: [
      { kind: 'kill', mobId: 'smuggler_enforcer', count: 12, text: 'Kill Smuggler Enforcers' },
    ],
    rewards: {
      ...reward(52, 0.7),
    },
  },
  rch_04: {
    id: 'rch_04',
    name: 'Fiachra the Wrecker',
    zoneId: 'reach',
    chain: 'reach_story',
    giverVendorId: 'odhran',
    minLevel: 55,
    requires: 'rch_03',
    summary: 'Fiachra lights false fires to bring ships onto the rocks.',
    objectives: [
      { kind: 'kill', mobId: 'fiachra', count: 1, text: 'Kill Fiachra the Wrecker' },
    ],
    rewards: {
      ...reward(55, 2),
      classItems: {
        warrior: 'gravebound_warrior_weapon',
        druid: 'gravebound_druid_weapon',
        ranger: 'gravebound_ranger_weapon',
        rogue: 'gravebound_rogue_weapon',
        mage: 'gravebound_mage_weapon',
      },
    },
  },
  rch_05: {
    id: 'rch_05',
    name: 'Old Cauldron',
    zoneId: 'reach',
    chain: 'reach_story',
    giverVendorId: 'odhran',
    minLevel: 68,
    requires: 'rch_04',
    summary: 'Something in the deep channel takes whole boats. Find out what.',
    objectives: [
      { kind: 'kill', mobId: 'great_pike', count: 8, text: 'Kill Great Pike' },
      { kind: 'kill', mobId: 'old_cauldron', count: 1, text: 'Kill Old Cauldron' },
    ],
    rewards: {
      ...reward(68, 2),
      classItems: {
        warrior: 'gravebound_warrior_weapon',
        druid: 'gravebound_druid_weapon',
        ranger: 'gravebound_ranger_weapon',
        rogue: 'gravebound_rogue_weapon',
        mage: 'gravebound_mage_weapon',
      },
    },
  },
  rch_06: {
    id: 'rch_06',
    name: 'The Black Road',
    zoneId: 'reach',
    chain: 'reach_story',
    giverVendorId: 'odhran',
    minLevel: 70,
    requires: 'rch_05',
    summary: 'Caer Dubh sits at the end of the black road. Aoife walks with the warband.',
    objectives: [
      { kind: 'reach', zoneId: 'caer_dubh', text: 'Travel to Caer Dubh' },
    ],
    rewards: {
      ...reward(70, 0.7),
    },
  },
  cdb_01: {
    id: 'cdb_01',
    name: 'The Outer Kennels',
    zoneId: 'caer_dubh',
    chain: 'caer_dubh_story',
    giverVendorId: 'aoife',
    minLevel: 70,
    summary: 'The fort mastiffs range far past the walls. Cut them down.',
    objectives: [
      { kind: 'kill', mobId: 'fort_mastiff', count: 14, text: 'Kill Fort Mastiffs' },
    ],
    rewards: {
      ...reward(70, 0.7),
    },
  },
  cdb_02: {
    id: 'cdb_02',
    name: 'The Levy',
    zoneId: 'caer_dubh',
    chain: 'caer_dubh_story',
    giverVendorId: 'aoife',
    minLevel: 76,
    requires: 'cdb_01',
    summary: 'Donnchadh has pressed the villages into service. Break their nerve.',
    objectives: [
      { kind: 'kill', mobId: 'warband_levy', count: 16, text: 'Kill Warband Levies' },
    ],
    rewards: {
      ...reward(76, 0.7),
    },
  },
  cdb_03: {
    id: 'cdb_03',
    name: 'Blackshields',
    zoneId: 'caer_dubh',
    chain: 'caer_dubh_story',
    giverVendorId: 'aoife',
    minLevel: 80,
    requires: 'cdb_02',
    summary: 'The spearmen hold the approach in a wall. Open it.',
    objectives: [
      { kind: 'kill', mobId: 'blackshield_spearman', count: 14, text: 'Kill Blackshield Spearmen' },
      { kind: 'collect', itemId: 'blackshield_boss', count: 6, text: 'Collect Blackshield Bosses' },
    ],
    rewards: {
      ...reward(80, 0.7),
    },
  },
  cdb_04: {
    id: 'cdb_04',
    name: 'Ruadhán the Blackshield',
    zoneId: 'caer_dubh',
    chain: 'caer_dubh_story',
    giverVendorId: 'aoife',
    minLevel: 85,
    requires: 'cdb_03',
    summary: 'Donnchadh\'s captain holds the gate. He will not stand aside.',
    objectives: [
      { kind: 'kill', mobId: 'ruadhan', count: 1, text: 'Kill Ruadhán the Blackshield' },
    ],
    rewards: {
      ...reward(85, 2),
      classItems: {
        warrior: 'gravebound_warrior_weapon',
        druid: 'gravebound_druid_weapon',
        ranger: 'gravebound_ranger_weapon',
        rogue: 'gravebound_rogue_weapon',
        mage: 'gravebound_mage_weapon',
      },
    },
  },
  cdb_05: {
    id: 'cdb_05',
    name: 'The Warden and the Champion',
    zoneId: 'caer_dubh',
    chain: 'caer_dubh_story',
    giverVendorId: 'aoife',
    minLevel: 93,
    requires: 'cdb_04',
    summary: 'The inner fort is held by his best. Clear the way to the hall.',
    objectives: [
      { kind: 'kill', mobId: 'blackshield_champion', count: 8, text: 'Kill Blackshield Champions' },
      { kind: 'kill', mobId: 'fort_warden', count: 8, text: 'Kill Fort Wardens' },
    ],
    rewards: {
      ...reward(93, 0.7),
    },
  },
  cdb_06: {
    id: 'cdb_06',
    name: 'Lord of Caer Dubh',
    zoneId: 'caer_dubh',
    chain: 'caer_dubh_story',
    giverVendorId: 'aoife',
    minLevel: 98,
    requires: 'cdb_05',
    summary: 'Donnchadh waits in the hall. There is nothing after this.',
    objectives: [
      { kind: 'kill', mobId: 'donnchadh', count: 1, text: 'Kill Donnchadh, Lord of Caer Dubh' },
    ],
    rewards: {
      ...reward(98, 2),
      classItems: {
        warrior: 'gravebound_warrior_weapon',
        druid: 'gravebound_druid_weapon',
        ranger: 'gravebound_ranger_weapon',
        rogue: 'gravebound_rogue_weapon',
        mage: 'gravebound_mage_weapon',
      },
    },
  },
};

export function getQuest(id: string): QuestDef {
  const quest = QUESTS[id];
  if (!quest) throw new Error(`Unknown quest: ${id}`);
  return quest;
}

/** Quests a vendor can offer right now, given who the player is and what they have done. */
export function questsAvailableFrom(
  vendorId: string,
  level: number,
  done: string[],
  active: string[],
): QuestDef[] {
  return Object.values(QUESTS).filter(
    (q) =>
      q.giverVendorId === vendorId &&
      level >= q.minLevel &&
      !done.includes(q.id) &&
      !active.includes(q.id) &&
      (!q.requires || done.includes(q.requires)),
  );
}


// --------------------------------------------------------------------------
// The armour lines.
//
// A second chain per zone, generated from `content/questgear.ts`. Where the
// story chain pays in experience and points you at the next band, this one
// pays in GEAR and asks you to stand still and farm for it.
//
// Its rewards are deliberately xp-light. The levelling curve is tuned against
// the story chain plus the grind; a second chain paying story-sized experience
// would quietly shorten every band by a third. What you get here is a piece of
// armour you could not otherwise plan for.
// --------------------------------------------------------------------------

/** Quest ids for one armour line, in order. */
function armourQuestId(line: ArmourLine, index: number): string {
  return `${line.zoneId}_kit_${String(index + 1).padStart(2, '0')}`;
}

function buildArmourLines(): Record<string, QuestDef> {
  const out: Record<string, QuestDef> = {};

  for (const line of ARMOUR_LINES) {
    line.steps.forEach((step, i) => {
      const id = armourQuestId(line, i);
      out[id] = {
        id,
        name: step.name,
        zoneId: line.zoneId,
        chain: `${line.zoneId}_kit`,
        giverVendorId: line.giverVendorId,
        minLevel: step.level,
        ...(i > 0 ? { requires: armourQuestId(line, i - 1) } : {}),
        summary: step.summary,
        objectives: [
          {
            kind: 'collect',
            itemId: trophyId(step),
            count: step.count,
            text: `Collect ${step.trophy}`,
          },
        ],
        rewards: {
          ...reward(step.level, 0.15, 0.3),
          items: [questArmourId(line, step)],
        },
      };
    });

    // The capstone: a handful of every trophy the line taught you to farm,
    // for a weapon that matches the set.
    const id = armourQuestId(line, line.steps.length);
    out[id] = {
      id,
      name: line.capstone.name,
      zoneId: line.zoneId,
      chain: `${line.zoneId}_kit`,
      giverVendorId: line.giverVendorId,
      minLevel: line.capstone.level,
      requires: armourQuestId(line, line.steps.length - 1),
      summary: line.capstone.summary,
      objectives: line.steps.map((step) => ({
        kind: 'collect' as const,
        itemId: trophyId(step),
        count: line.capstone.each,
        text: `Collect ${step.trophy}`,
      })),
      rewards: {
        ...reward(line.capstone.level, 0.25, 0.3),
        classItems: questWeapons(line),
      },
    };
  }
  return out;
}

Object.assign(QUESTS, buildArmourLines());
