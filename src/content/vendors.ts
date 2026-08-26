import { LUXURY_VENDOR_ID, luxuryMerchant } from './luxury.js';
import { zoneTomes } from './skills.js';
import { consumablesFor } from './consumables.js';
import { ITEMS } from './items.js';
import { ZONES } from './zone.js';
import { allSettlementPlans, settlementVendorId, type SettlementRole } from './settlements.js';
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
 *
 * With exactly one exception. The luxury merchant (`content/luxury.ts`) sells
 * epics, and the rule survives because for that shop **the price is the
 * grind**: nobody buys a Sovereign Bulwark instead of playing, they buy one
 * because they played. `MAX_STOCK_QUALITY` applies to every other trader, and
 * a test enforces both halves.
 *
 * That cap is why a trader can sell SKILLS as well as gear without becoming a
 * shortcut. Each zone teaches three skills per class; the trader stocks the
 * uncommon one, and the other two are killed for. It also finally gives gold
 * something to do late on — a level-70 player has more coin than uses for it,
 * and a tome is the one purchase that changes how the character plays.
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
      // And the bottles. A trader who does not sell potions in a world where
      // everything can kill you is a trader nobody visits twice.
      ...consumablesFor(1),
    ],
    respec: true,
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
      ...consumablesFor(20),
    ],
    respec: true,
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
  /** Zone whose uncommon skill tomes this trader teaches from. */
  zoneId: string,
  /** Level band whose potions this trader keeps. */
  consumableTier: number,
): VendorDef {
  const stock: string[] = [];
  for (const adjective of tierAdjectives) {
    const slug = adjective.toLowerCase();
    for (const classId of ['warrior', 'druid', 'ranger', 'rogue', 'mage']) {
      stock.push(`${slug}_${classId}_weapon`);
    }
    for (const slot of ['head', 'chest', 'legs', 'ring']) stock.push(`${slug}_${slot}`);
  }
  // One tome per class: the zone's first taught skill. The rare and epic ones
  // are on its bosses, and no trader anywhere carries them.
  stock.push(...Object.values(zoneTomes(zoneId, 'uncommon')));
  stock.push(...consumablesFor(consumableTier));
  // A zone's hold is where you go to be un-made and re-made. See `VendorDef`.
  return { id, name, greeting, stock, respec: true, view: { color, height: 1.82, radius: 0.45 } };
}

Object.assign(VENDORS, {
  sorcha: lateVendor(
    'sorcha',
    'Sorcha of the Hill Road',
    'The clans up here trade in cattle and grudges. I prefer coin.',
    ['Honed', 'Bloodiron'],
    0xc9b98d,
    'ardmoor',
    20,
  ),
  odhran: lateVendor(
    'odhran',
    'Odhrán the Salvager',
    'Everything the tide takes, it gives back to somebody. Usually me.',
    ['Sunken', 'Tidewrought'],
    0x9fb3a8,
    'reach',
    40,
  ),
  aoife: lateVendor(
    'aoife',
    'Sister Aoife',
    'I follow the warband and bury what it leaves. Buy something useful.',
    ['Blackstone', 'Dread'],
    0xb0a8bc,
    'caer_dubh',
    66,
  ),
});


// --------------------------------------------------------------------------
// The town keepers.
//
// A zone now has four to seven settlements in it and every one of them wants a
// trader. Fifteen hand-written stock lists is fifteen chances to forget a
// class's weapon in one town and never notice — the same argument that put the
// late weapon ladders behind one DPS budget.
//
// So a keeper's stock is *derived from what the shop is for*: the smith reads
// every weapon in the game a character in this band could carry, the armourer
// reads every coat, and both stop at uncommon like every other trader. Add an
// item to a ladder and it turns up in the right shop with nobody editing a
// list — which is the whole reason `content/` is data.
// --------------------------------------------------------------------------

/** The best few of something a trader in this band would plausibly have. */
function bestOf(
  pick: (item: ItemDef) => boolean,
  maxLevel: number,
  perGroup: number,
  group: (item: ItemDef) => string,
): string[] {
  const groups = new Map<string, ItemDef[]>();
  for (const item of Object.values(ITEMS)) {
    // The uncommon cap is the rule that keeps every trader a safety net rather
    // than a shortcut, and it is what makes this generator safe to point at
    // the whole registry: rares, epics, quest gear and signature pieces are
    // all excluded by their own quality.
    if (item.quality !== 'common' && item.quality !== 'uncommon') continue;
    if (item.merchantGood || item.consumable || item.teaches) continue;
    if ((item.reqLevel ?? 1) > maxLevel) continue;
    if (!pick(item)) continue;
    const key = group(item);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  const out: string[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => b.value - a.value);
    for (const item of list.slice(0, perGroup)) out.push(item.id);
  }
  return out;
}

const ARMOUR_SLOTS = new Set(['head', 'chest', 'legs', 'ring']);

/**
 * What a shop of this kind keeps.
 *
 * Each role answers a different question, which is the point of there being
 * more than one town: a row of general stores is one general store drawn five
 * times, and a player who can buy everything in the first town never walks to
 * the second.
 */
function roleStock(role: SettlementRole, band: [number, number]): string[] {
  const [lo, hi] = band;
  const mid = Math.round((lo + hi) / 2);
  switch (role) {
    case 'smith':
      // Two rungs per class, so every character finds something and nobody
      // finds the whole ladder.
      return bestOf((i) => i.slot === 'weapon', hi, 2, (i) => i.classes?.[0] ?? 'any');
    case 'armoury':
      return bestOf((i) => ARMOUR_SLOTS.has(i.slot ?? ''), hi, 2, (i) => i.slot ?? 'none');
    case 'apothecary':
      // Both ends of the band: a character arriving in a zone and a character
      // about to leave it want different bottles, and the walk between towns
      // is not the interesting decision.
      return [...new Set([...consumablesFor(hi), ...consumablesFor(lo)])];
    case 'scholar':
      // The one purchase that changes how a character plays. Never above
      // uncommon: the rare and epic tomes are killed for.
      return [...Object.values(zoneTomes(zoneIdOfBand(band), 'uncommon')), ...consumablesFor(mid)];
    case 'market':
      // A market is somewhere to *sell*. What it stocks is the odds and ends
      // a player forgot to buy before they left.
      return [...consumablesFor(mid), ...bestOf((i) => i.slot === 'ring', mid, 1, () => 'ring')];
    default:
      return consumablesFor(mid);
  }
}

/** Which zone a band belongs to. Only the scholar needs it, for its tomes. */
function zoneIdOfBand(band: [number, number]): string {
  for (const zone of Object.values(ZONES)) {
    if (zone.levelRange[0] === band[0] && zone.levelRange[1] === band[1]) return zone.id;
  }
  return 'fenmarch';
}

const ROLE_GREETING: Record<SettlementRole, string> = {
  hold: 'Coin or goods. I am not fussy which.',
  smith: 'Everything on that rack will hold an edge longer than you will hold a grudge.',
  armoury: 'You will want more than that shirt where you are going.',
  apothecary: 'Drink it when it is bad, not when it is over. That is the whole trick.',
  scholar: 'Anyone can swing. Reading is the harder half.',
  market: 'Whatever you dragged back, I will take it off you.',
};

const ROLE_COLOR: Record<SettlementRole, number> = {
  hold: 0xd8c79a,
  smith: 0xc08c5e,
  armoury: 0xa8a29a,
  apothecary: 0x8fbf9a,
  scholar: 0xa9a3d0,
  market: 0xd0b878,
};

for (const { zoneId, plan } of allSettlementPlans()) {
  if (plan.vendorId) continue;
  const band = ZONES[zoneId]?.levelRange ?? [1, 25];
  const id = settlementVendorId(zoneId, plan.id);
  VENDORS[id] = {
    id,
    name: plan.keeper ?? `The keeper of ${plan.name}`,
    greeting: ROLE_GREETING[plan.role],
    stock: [...new Set(roleStock(plan.role, band))],
    view: { color: ROLE_COLOR[plan.role], height: 1.8, radius: 0.45 },
  };
}

Object.assign(VENDORS, { [LUXURY_VENDOR_ID]: luxuryMerchant() });

export function getVendor(id: string): VendorDef {
  const vendor = VENDORS[id];
  if (!vendor) throw new Error(`Unknown vendor: ${id}`);
  return vendor;
}
