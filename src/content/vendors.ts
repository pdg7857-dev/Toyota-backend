import type { ItemDef, VendorDef } from '../sim/types.js';

/**
 * Traders.
 *
 * Vendors close the economy: they are the sink that gives gold a purpose and
 * the buyer that gives merchant goods one. Without them, gold accumulates
 * forever and a Bear Claw is just inventory clutter.
 *
 * They are deliberately NOT a shortcut past the grind — stock tops out at the
 * uncommon tier, so rares and epics still come from killing things.
 */

/** What a vendor pays for an item. */
export function sellPrice(item: ItemDef): number {
  // Merchant goods exist to be sold, so they fetch their full listed value.
  // Everything else goes for a fraction — otherwise vendoring every drop would
  // out-earn actually playing, and gear would lose its meaning as a reward.
  return item.merchantGood ? item.value : Math.max(1, Math.round(item.value * 0.25));
}

/** What a vendor charges for an item from stock. */
export function buyPrice(item: ItemDef): number {
  return Math.round(item.value * 4);
}

/** Nothing above this quality is ever sold by a vendor. */
export const MAX_STOCK_QUALITY = 'uncommon';

export const VENDORS: Record<string, VendorDef> = {
  maeve: {
    id: 'maeve',
    name: 'Maeve the Trader',
    greeting: 'Standing stones make poor shelter. Buy something, or sell me your spoils.',
    stock: [
      // One starter and one second-tier weapon for every class, so nobody is
      // stuck swinging their starting stick because the drop gods said no.
      'bronze_shortsword',
      'rowan_stave',
      'hunters_bow',
      'bronze_dagger',
      'rowan_wand',
      'ironbark_cudgel',
      'blessed_mace',
      'yew_longbow',
      'poachers_knife',
      'emberwood_rod',
      // Basic protection.
      'tattered_hood',
      'boiled_leather_vest',
      'leather_coif',
    ],
    view: { color: 0xd8c79a, height: 1.8, radius: 0.44 },
  },
  bryn: {
    id: 'bryn',
    name: 'Bryn the Quartermaster',
    greeting: 'You made it this far south. Let us see what your coin is worth.',
    stock: [
      'iron_longsword',
      'vigil_stave',
      'rangers_recurve',
      'twin_fangs',
      'stormcaller_rod',
      'studded_jerkin',
      'bogstrider_greaves',
      'outlaw_hood',
      'reaver_legguards',
    ],
    view: { color: 0xb8a37e, height: 1.85, radius: 0.46 },
  },
};

/** Late-zone traders. Stock is the zone's uncommon tier — never above it. */
function lateVendor(
  id: string,
  name: string,
  greeting: string,
  tierAdjectives: [string, string],
  color: number,
): VendorDef {
  const stock: string[] = [];
  for (const adjective of tierAdjectives) {
    const slug = adjective.toLowerCase();
    for (const classId of ['warrior', 'priest', 'ranger', 'rogue', 'mage']) {
      stock.push(`${slug}_${classId}_weapon`);
    }
    for (const slot of ['head', 'chest', 'legs', 'ring']) stock.push(`${slug}_${slot}`);
  }
  return { id, name, greeting, stock, view: { color, height: 1.82, radius: 0.45 } };
}

Object.assign(VENDORS, {
  sorcha: lateVendor(
    'sorcha',
    'Sorcha of the Hill Road',
    'The clans up here trade in cattle and grudges. I prefer coin.',
    ['Honed', 'Bloodiron'],
    0xc9b98d,
  ),
  odhran: lateVendor(
    'odhran',
    'Odhrán the Salvager',
    'Everything the tide takes, it gives back to somebody. Usually me.',
    ['Sunken', 'Tidewrought'],
    0x9fb3a8,
  ),
  aoife: lateVendor(
    'aoife',
    'Sister Aoife',
    'I follow the warband and bury what it leaves. Buy something useful.',
    ['Blackstone', 'Dread'],
    0xb0a8bc,
  ),
});

export function getVendor(id: string): VendorDef {
  const vendor = VENDORS[id];
  if (!vendor) throw new Error(`Unknown vendor: ${id}`);
  return vendor;
}
