import type { ItemDef } from '../sim/types.js';

/**
 * Item registry. Data only — no behaviour. Adding gear should never require
 * touching sim code.
 */
export const ITEMS: Record<string, ItemDef> = {
  // --- weapons ---
  rusted_blade: {
    id: 'rusted_blade',
    name: 'Rusted Blade',
    slot: 'weapon',
    quality: 'common',
    value: 4,
    damageMin: 3,
    damageMax: 6,
    damageType: 'physical',
    swingMs: 1800,
    attackRange: 2.4,
  },
  bronze_shortsword: {
    id: 'bronze_shortsword',
    name: 'Bronze Shortsword',
    slot: 'weapon',
    quality: 'common',
    value: 18,
    damageMin: 6,
    damageMax: 11,
    damageType: 'physical',
    swingMs: 1700,
    attackRange: 2.4,
    attributes: { strength: 2 },
  },
  ironbark_cudgel: {
    id: 'ironbark_cudgel',
    name: 'Ironbark Cudgel',
    slot: 'weapon',
    quality: 'uncommon',
    value: 55,
    damageMin: 11,
    damageMax: 19,
    damageType: 'physical',
    swingMs: 2100,
    attackRange: 2.6,
    attributes: { strength: 4, vitality: 2 },
  },
  fenwardens_cleaver: {
    id: 'fenwardens_cleaver',
    name: "Fenwarden's Cleaver",
    slot: 'weapon',
    quality: 'epic',
    value: 400,
    damageMin: 22,
    damageMax: 34,
    damageType: 'physical',
    swingMs: 1900,
    attackRange: 2.6,
    attributes: { strength: 9, dexterity: 4, vitality: 4 },
  },

  // --- armour ---
  tattered_hood: {
    id: 'tattered_hood',
    name: 'Tattered Hood',
    slot: 'head',
    quality: 'common',
    value: 5,
    armor: 3,
    attributes: { vitality: 1 },
  },
  boiled_leather_vest: {
    id: 'boiled_leather_vest',
    name: 'Boiled Leather Vest',
    slot: 'chest',
    quality: 'common',
    value: 14,
    armor: 8,
    attributes: { vitality: 2 },
  },
  kobold_scale_mail: {
    id: 'kobold_scale_mail',
    name: 'Kobold Scale Mail',
    slot: 'chest',
    quality: 'uncommon',
    value: 70,
    armor: 18,
    attributes: { vitality: 5, strength: 2 },
  },
  bogstrider_greaves: {
    id: 'bogstrider_greaves',
    name: 'Bogstrider Greaves',
    slot: 'legs',
    quality: 'uncommon',
    value: 60,
    armor: 14,
    attributes: { vitality: 3, dexterity: 3 },
  },
  ring_of_the_fen: {
    id: 'ring_of_the_fen',
    name: 'Ring of the Fen',
    slot: 'ring',
    quality: 'rare',
    value: 150,
    armor: 2,
    attributes: { focus: 5, dexterity: 3 },
  },

  // --- trash / vendor ---
  wolf_pelt: {
    id: 'wolf_pelt',
    name: 'Wolf Pelt',
    slot: null,
    quality: 'common',
    value: 3,
    stackable: true,
  },
  boar_tusk: {
    id: 'boar_tusk',
    name: 'Boar Tusk',
    slot: null,
    quality: 'common',
    value: 2,
    stackable: true,
  },
  kobold_fetish: {
    id: 'kobold_fetish',
    name: 'Kobold Fetish',
    slot: null,
    quality: 'uncommon',
    value: 12,
    stackable: true,
  },
};

export function getItem(id: string): ItemDef {
  const item = ITEMS[id];
  if (!item) throw new Error(`Unknown item: ${id}`);
  return item;
}

export const QUALITY_COLORS: Record<ItemDef['quality'], string> = {
  common: '#c8c8c8',
  uncommon: '#4ad66d',
  rare: '#4aa3ff',
  epic: '#c77dff',
};
