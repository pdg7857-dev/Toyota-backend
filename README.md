# Emerald Isle

A single-player 3D tab-target RPG — Celtic-flavoured, grounded, original IP.
With four exceptions, which have wings.
Levels 1 to 100 across four zones, deliberately grind-heavy, with eight bosses
whose fights are decided by how you play rather than by your stat sheet.

Its architecture keeps the door open to multiplayer: the whole game simulation
is a pure, headless, deterministic module that could run as a server authority
without being rewritten. See `CLAUDE.md` for why and how.

## Running it

```bash
npm install
npm run dev            # http://127.0.0.1:5173
```

Add `?fresh` to the URL to discard your save and start over.

## Playing it

| Key | Action |
|---|---|
| `WASD` | Move (camera-relative) |
| Right-drag / Scroll | Orbit / zoom the camera |
| Click or `Tab` | Target |
| `1`–`0` | Skills (first row) |
| `Shift`+`1`–`6` | Skills (second row — what the zones taught you) |
| `T` | Toggle auto-attack |
| `F` | Loot a nearby corpse |
| `H` | Take a weakened wild horse |
| `R` | Mount up / dismount |
| `E` | Trade with a nearby vendor |
| `G` | Take the road to the next zone |
| `J` | Quest log |
| `K` | The realm — who holds what, and what they make of you |
| `C` / `I` | Character / Inventory |
| `Esc` | Clear target |

Progress autosaves to `localStorage` every 10 seconds.

## The war

Five factions hold eight stretches of ground between them, and the map is not
decoration. Kill a faction's people and their claim weakens **where you are
standing**; do enough of it and the ground changes hands — the banner changes,
and the guards at the posts are replaced by the new holder's. Every front also
drifts on its own, so walking away for an hour means walking back into a
different map. Press `K` for the realm panel.

Factions remember what you did. The consequence that matters most: a faction
that has come to terms with you **stops attacking you**, and one you have
wronged notices you from half again as far off.

And it keeps moving with the game closed. Come back after a week and the game
opens on **what changed while you were away** — the ground that fell, and any
dragon that is out right now. Walk away long enough and the map goes back to
what it wants to be; pushing against that is what your kills are for.

## The old things

Four dragons, one per zone, and they are not bosses. A dragon lives in world
state rather than in a zone's spawn list: it sleeps in a lair for half an hour,
wakes, and works its territory — and the ground it lands on **empties**, because
whoever was garrisoning it runs. That front stops dead until the dragon moves on
or somebody kills it.

It cannot be tamed, farmed or camped. There is no spawn roll and no respawn
timer; the only thing that produces a dragon is time. It sits at the top of its
zone's band, it is the hardest fight there, and it carries the best weapon in
the game.

## Other people

The zone has four other adventurers in it, and they are the only part of this
game pretending to be an MMO. They walk between camps, fight them, level with
the band they are in, occasionally lose, and say things — about a hundred
seconds apart, never more. Stand near one when you level and they will say
grats.

Three rules keep them from being a lie. They **never touch your loot or your
kills** — their fights are abstract and never reach a real mob's health, so
an adventurer is never a competitor for the creature you needed. They are
always **plausible**: their level tracks the zone, and what they talk about is
what is actually happening — the front that just flipped, the dragon that just
landed. And they are **quiet**, which is the one that took a rewrite: chatter
runs through a single shared floor, so adding something new for them to say
never makes the population chattier.

You cannot group with them, trade with them or fight them. They exist to be
seen, which is most of what other people in an MMO ever were.

## Horses

Wild horses run in herds well off the road, and you do not buy or loot one.
Taking a horse is **a fight you have to lose gently**: beat it below a quarter
health and then press `H` instead of hitting it again. Kill it and you get
nothing. Fail the grab and it breaks away, heals, and turns on you.

Each herd is a different animal rather than a bigger number: the Moor Cob is
quick and steady, the Hill Courser hits harder, the Drowned Wood Destrier takes
hits. The Ashen Grey runs alone in Caer Dubh and shrugs you off eleven attempts
in twelve — it is not rare to *find*, it is rare to *keep*. Riding replaces your
movement speed and carries its bonus into combat, and a telegraphed hit throws
you out of the saddle.

## Money, eventually

Ceallach of the Long Road keeps a stall at the standing stones and stocks
nothing you can afford for the first forty levels. He is the only trader in the
game not capped at uncommon, and the reason that is not a shortcut is that
**the price is the grind**: a Sovereign piece costs tens of thousands of kills'
worth of gold.

He sells the three slots nothing else in the game fills — an **offhand** (a
blade for damage, a bulwark for armour, or a grimoire that makes everything you
cast hit harder), an **amulet**, and a **bracelet**. Deliberately a step below
what a dragon carries: if money bought the best item in the game, killing the
dragon would be a formality.

## The world

Four zones, levels 1 to 100. The bands **overlap** — the next zone opens before
the last one is done with you, so pushing on is a choice, not an eviction.

| Zone | Levels | Ends at |
|---|---|---|
| **The Fenmarch** | 1–25 | Cadfael, the Outlaw Chief ★5 · Old Scar ★6 |
| **Ardmoor** | 20–40 | Aonghus the Cattle-Lord ★5 · Muireann of the Nine Scars ★6 |
| **The Sunken Wood** | 38–70 | Fiachra the Wrecker ★5 · Old Cauldron ★6 |
| **Caer Dubh** | 66–100 | Ruadhán the Blackshield ★5 · Donnchadh, Lord of Caer Dubh ★6 |

Each zone looks like somewhere else, too: the Fenmarch is open moor, Ardmoor
is broken high crags, the Sunken Wood is a drowned forest lit by its own fungus,
and Caer Dubh is violet Otherworld twilight. Ground shape, palette, light, fog
and scatter all come from a `ZoneTheme` in `content/terrain.ts`.

Each zone also runs a second quest chain — an **armour line**. Four steps, one
slot each, each asking you to farm a trophy that drops at a known rate; then a
capstone that wants a handful of everything and pays out a weapon for your
class. It is the only gear in the game you can plan for.

Each zone also hides four **rare spawns** — named creatures that take over an
ordinary camp spawn point about once every ten to twenty minutes of camping.
Each is named for the one item it carries (`Mirefang the Bog Wolf` drops the
`Mirefang Blade`), each drops it guaranteed, and each of those items carries an
affix — crit, health, movement speed — that no ladder item has. Two more per
zone are **bounty spawns**: the same creature with a purse, worth fifteen
ordinary kills in gold or experience and turning up every few minutes.

Each zone also teaches three skills per class. The trader sells the first, its
★5 boss carries the second and its ★6 elite boss the third — so what you can
*do* changes as you travel, not just what you hit for.

Each zone has a trader who also hands out work. Their quest chain walks you band
by band toward the bosses and then points at the road onward — that is what
turns a field of camps into a route. Follow it and you will never wonder where
to go next.

Roughly **26,000 kills** to reach 100, and the cost per level keeps climbing the
whole way: about 6 kills for your first level, 90 a level through the twenties,
435 a level near the cap.

## The Fenmarch

One zone, levels 1–25, running north to south. You start at the standing stones
on the northern moor; the danger rises the further down you push.

| Band | What lives there |
|---|---|
| Northern moor | Moor Hare ★1 (1), Mossback Boar ★1 (3) |
| The wet ground | Fen Adder ★2 (5), Bog Wolf ★2 (8) |
| Open marsh | Moor Stag ★3 (11), Outlaw Bowman ★2 (13) |
| The road | Outlaw Reaver ★3 (16), Marsh Bear ★4 (19) |
| Outlaw camp | **Cadfael, the Outlaw Chief ★5 (20)** — guarded |
| Deep fen | Fen Lynx ★3 (21), Outlaw Marauder ★4 (23) |
| Southern marsh | **Old Scar ★6 (25)** — alone |

**Stars** rate difficulty: ★1–★4 are ordinary mobs, ★5 is a boss, ★6 an elite
boss. A higher star rating means more health, damage and armour at the same
level — a ★4 is a real threat without being higher level than the band it sits in.


**The grind is the point.** Roughly 2,650 kills to reach 25, and the cost per
level keeps climbing: about 6 kills for your first level, 150+ near the cap.
Grey mobs give almost nothing, so pushing south is the only way forward.

## Classes

Pick one on first launch. Add `?fresh` to the URL to re-choose, or
`?class=priest` to skip the screen.

| Class | Scales off | Plays like |
|---|---|---|
| **Warrior** | Strength | Melee, durable, steady damage |
| **Priest** | Focus | Ranged, sustains through damage, best interrupt |
| **Ranger** | Dexterity | Longest reach in the game, steady pressure |
| **Rogue** | Dexterity | Fast blades, burst, strong evasion |
| **Mage** | Focus | Heaviest damage, least health |

Every class gets an interrupt and a way to survive a spike. Weapon ladders are
held in DPS parity tier for tier, so the differences are in *feel*, not power.

Weapons are class-locked — a Priest cannot swing a greatsword — but armour and
rings are shared. **Each boss drops a guaranteed epic weapon matched to whoever
kills it**, so the reward is never something you can only vendor.

## Mechanics worth knowing

**Bosses telegraph.** A red circle grows on the ground and a warning flashes.
The boss is rooted while winding up, so the circle stays where it was drawn —
get out of it. Standing in everything loses; dodging wins.

**Interrupts answer what dodging can't.** Heavy AoEs cannot be interrupted,
only escaped. Heals and summons *can* be interrupted, and should be — let
Cadfael finish binding his wounds and you will be there a while. A missed
interrupt still burns its cooldown.

**Vendors close the economy.** Maeve trades at the standing stones, Bryn off
the road further south. They pay full value for merchant goods and a quarter for
gear, sell at 4x, and never stock above uncommon — a gold sink and a safety net,
not a shortcut past the grind.

**Loot gets better, not more frequent.** Gold and merchant goods scale steeply
with difficulty and are the reliable income. Equipment stays rare at every tier
— what improves is the quality of what drops. Epics come only from bosses.

## What's in it

- Fixed 20 Hz deterministic simulation with render interpolation
- Tab-target combat: swing timers, hit/crit rolls, armour mitigation, level-gap
  scaling, global cooldown
- Five playable classes with separate skill trees, weapon ladders and identities
- 76 skills across five classes — instant, cast-time, damage-over-time,
  heal, buff and interrupt. Six or seven per class come from levelling; the
  other nine are **taught by the zones**, from a tome you buy from that zone's
  trader or take off its bosses
- Mob abilities: telegraphed dodgeable AoEs, interruptible heals and summons,
  enrage thresholds, adds that despawn with their summoner and drop no loot
- Mob AI: aggro radius, threat tables, chase, leash-and-heal, respawn timers
- 71 creatures across ★1–★6 including 8 bosses, 4 dragons, 16 named rare
  spawns, 8 bounty spawns and 4 wild herds; 367 items; class-aware boss, rare
  and quest rewards
- Four zones with overlapping level bands and travel between them, each with
  its own terrain, palette, lighting, scatter and skills to learn
- Five factions contesting eight holdings: territory that changes hands from
  what you kill, drifts on its own, and garrisons itself with whoever holds it
- Four dragons that live in world state, sleep, wake, take ground off the
  factions holding it, and cannot be camped for
- Faction standing that decides who attacks you on sight and what you pay
- Four other adventurers per zone who walk it, fight it, talk about it and
  never once touch your kills
- Four wild herds and mounted travel, captured by knowing when to stop hitting
- A luxury merchant with the game's only offhand, amulet and bracelet slots,
  priced at the far end of a hundred levels of income
- Two quest chains per zone — a story chain that walks you through its bands
  and an armour line that outfits you — with kill, collect and travel
  objectives, chained by prerequisite, and class-matched rewards
- A world that carries on with the game closed: territory drifts and dragons
  keep their rounds against the clock, and returning opens on what changed
- Levelling to 100, spendable attribute points, skill unlocks
- Death and respawn, save/load via full world serialization

## Development

```bash
npm run verify     # typecheck + 222 unit and balance tests
npm run smoke      # plays the game in real Chromium, writes screenshots/
```

`npm test` prints a balance table (win rate, time-to-kill, health remaining,
slams hit vs dodged) for every tuned encounter, plus the full kills-per-level
grind curve. Balance is measured against those numbers rather than guessed — if
a threshold fails, the game gets fixed, not the threshold.
