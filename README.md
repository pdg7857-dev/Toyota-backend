# Emerald Isle

A single-player 3D tab-target RPG — Celtic-flavoured, grounded, original IP.
With four exceptions, which have wings.

Levels 1 to 100 across four zones three kilometres wide, deliberately
grind-heavy, with eight bosses whose fights are decided by how you play rather
than by your stat sheet — and a world that carries on with the game closed.

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
| Drag, or `←` `→` | Look around |
| Scroll | Zoom |
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
| `M` | The map |
| `N` | Mute |
| `[` `]` | Volume |
| `V` | Take back what dying cost you, standing where you fell |
| `C` / `I` | Character / Backpack |
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

## Mounts

Wild herds run well off the road, and you do not buy or loot one.
Taking a horse is **a fight you have to lose gently**: beat it below a quarter
health and then press `H` instead of hitting it again. Kill it and you get
nothing. Fail the grab and it breaks away, heals, and turns on you.

Three families, in rarity order — **horse**, then **dire wolf**, then
**unicorn**. Each herd is a different animal rather than a bigger number: the
Moor Cob is quick and steady, a dire wolf hits harder and takes hits, a unicorn
is faster than anything else in the game. The Caer Dubh unicorn runs alone
where anyone can walk to it and shrugs you off twenty-four attempts in
twenty-five — it is not rare to *find*, it is rare to *keep*.

Riding replaces your movement speed and carries its bonus into combat, and a
telegraphed hit throws you out of the saddle — ordinary swings never do, or
nobody would ever ride into a fight.

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

Four zones, levels 1 to 100. Each is **three kilometres across** — ten minutes
to walk end to end, just under three on the best mount — with hills, mountains
and standing water, and around five hundred creatures in it. Nowhere in a zone
is more than about 290 units from something alive; the country between the
camps is full of solitary creatures you meet on the way somewhere, which is
different from being full of camps.

The bands **overlap** — the next zone opens before the last one is done with
you, so pushing on is a choice, not an eviction.

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

Roughly **28,800 kills** to reach 100, and the cost per level keeps climbing the
whole way: about 6 kills for your first level, 147 a level at 25, 569 a level
near the cap.

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

The rating in the table is what a creature is *usually*. A camp is a
population, not eight copies of one animal: the same creature turns up as a
runt, an ordinary one, a scarred one and occasionally something much bigger,
and the name says which — a **Starveling** Bog Wolf and a **Storm-Fed** Bog
Wolf are the same animal at ★1 and ★4. About a fifth of a fresh zone is ★1 and
about a tenth is ★4.

**Everything can kill you.** A ★1 at your level is a real fight; a ★4 will kill
you unless you play it well, have the gear, and carry something to drink. Pull
two and you will almost certainly die.


**The grind is the point.** Roughly 1,600 kills to reach 25, and the cost per
level keeps climbing: about 6 kills for your first level, 147 by the twenties.
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

## Sound

Every noise in the game is synthesised as it plays — there is not one audio
file in the project. Swings, impacts, crits, spells, coins, a level-up
fanfare, a boss's warning, and wind that lifts at night and turns to rain when
the weather does.

Distance decides volume: your own fight is always audible, somebody else's
fades with distance and is silent past seventy metres. `N` mutes, `[` and `]`
set the level, and it remembers.

## Dying

Death used to cost the walk back and nothing else, which in a game where a ★4
kills you about one attempt in five makes a bad pull free. It now costs a
**debt**: experience you owe, paid down out of the same stream that levels you.

Nothing is ever taken away. A level you earned is not revocable and the bar
never moves backwards — progress slows, then stops slowing, and you can always
see the end of it. It is capped at one level's worth, and it is **free below
level 10**, because the first ten levels are where you learn which fights are
survivable.

And **your body is on the map**. Walk back to where you fell, press `V`, and
the rest of it is cleared. That is what makes the walk a decision — through the
thing that killed you, or pay it off in kills somewhere safer.

## The road

Every zone is built along one, north to south, with the level bands walking
down it and the camps either side. It is worn into the ground — pale, dry, and
nothing grows on it — and it is on the map and the minimap too. Follow it and
you will pass everything the zone has, in the order it was meant to be met.

## The map

Press `M`. A minimap sits in the corner; both are drawn from one relief bitmap
per zone, so they can never disagree about what the ground looks like.

Camps are coloured against your level on the same five-step scale as a
nameplate — a dot's position is a fact, its colour is a decision. Holdings are
drawn in the colour of whoever holds them right now. Bosses, traders, roads out
and landmarks are all on it, and so is the spot where you last died.

## Day, night and weather

A full day is twenty-four minutes, and it is *world* state — it runs while the
game is closed, so coming back after a while puts you down at a different hour
under different weather. The clock is under the minimap.

Night is a mood, not a legibility problem: the sun goes out, the ambient light
turns the colour of moonlight and never drops below half, and you can still
read a telegraph circle. It has exactly one consequence, and one is enough —
**in the dark, everything notices you from further off**.

Weather is per zone and per hour: the Fenmarch gets rain and mist, Ardmoor gets
snow, the Sunken Wood is mostly mist. Mist is the one that changes how far you
can see, which is the whole point of it as a thing that happens to you.

## Landmarks

Watchtowers, ruins, stone circles, wrecks, farmsteads, cairns, camps and
bridges, sited so that seeing one from four hundred metres is information. A
watchtower stands on a holding, a ruin marks a boss's ground, a farmstead is
where a trader set up. Which kinds a zone gets is a table entry, so the
Fenmarch has farmsteads and cairns because people live there and Caer Dubh has
ruins because whatever lived there is gone.

## Training an ability

Every level gives you **five attribute points and one skill point**. Attribute
points go into Strength, Dexterity, Focus or Vitality; skill points rank up an
individual skill, up to ten times.

A ranked skill hits harder and **crits more often**, and a crit is a flat
doubling of whatever the skill was going to do — damage or healing. It never
becomes common; it becomes noticeable, which is the difference between a
build and a slot machine.

## Consumables

Potions heal instantly; elixirs buff for a while. Two cooldown families rather
than one per item, so a bag full of different potions is still one potion every
eighteen seconds. They drop from ordinary creatures and every trader stocks
them, and they are the difference between a ★4 killing you a third of the time
and one in fifty.

## Mechanics worth knowing

**Bosses telegraph, and no two ask the same thing.** A shape appears on the
ground and a warning flashes. The boss is rooted while winding up, so what is
drawn is what lands.

| What you see | What it means |
|---|---|
| A circle on the boss | Get further away |
| A **wedge** in front of it | Get round the side — backing off keeps you in it |
| A circle **on your own feet** | Keep moving; it lands where you were standing |
| A dark stain that stays | Get out, and stay out — this one does not end |

All eight bosses have a different combination, and none of them can be beaten
standing still. `npm test` prints the table of every boss played badly and
played well; the gap is the mechanic.

**Interrupts answer what dodging can't.** Heavy AoEs cannot be interrupted,
only escaped. Heals and summons *can* be interrupted, and should be — let
Cadfael finish binding his wounds and you will be there a while. A missed
interrupt still burns its cooldown.

**Vendors close the economy.** Maeve trades at the standing stones, Bryn off
the road further south. They pay full value for merchant goods and a quarter for
gear, sell at 4x, and never stock above uncommon — a gold sink and a safety net,
not a shortcut past the grind.

**Your cast is not equally fragile to everything.** A mob's spell or heavy
attack always breaks it. An ordinary auto-attack *rolls* against your armour
and level — which is what makes gear read as composure rather than just a
bigger health bar. A damage-over-time tick never breaks it, because nobody
would ever attribute a silently disabled cast bar to the bleed they are
standing in.

**The backpack is drag-and-drop.** Press `I`, drag an item onto the slot it
belongs in. Every item shows what it does and what it would replace.

**Loot gets better, not more frequent.** Gold and merchant goods scale steeply
with difficulty and are the reliable income. Equipment stays rare at every tier
— what improves is the quality of what drops. Epics come only from bosses.

## What's in it

- Fixed 20 Hz deterministic simulation with render interpolation
- Tab-target combat: swing timers, hit/crit rolls, armour mitigation, level-gap
  scaling, global cooldown, and cast-break rules that differ by what hit you
- Five playable classes with separate skill trees, weapon ladders and identities
- 76 skills across five classes — instant, cast-time, damage-over-time,
  heal, buff and interrupt. Six or seven per class come from levelling; the
  other nine are **taught by the zones**, from a tome you buy from that zone's
  trader or take off its bosses
- Ten ranks per skill, bought with a skill point a level: more power, and a
  critical chance that doubles what a skill does
- Mob abilities: telegraphed dodgeable AoEs, interruptible heals and summons,
  enrage thresholds, adds that despawn with their summoner and drop no loot
- Mob AI: aggro radius, threat tables, chase, leash-and-heal, five-minute
  respawns, and idle creatures that amble around their camp
- 75 distinct creatures across ★1–★6 — 8 bosses, 4 dragons, 24 named rare and
  bounty spawns, 8 wild herds — each ordinary one appearing at four different
  star ratings under four different names, for 168 in all
- 383 items and 46 quests; class-aware boss, rare and quest rewards
- Potions and elixirs on two cooldown families, dropped and sold everywhere
- Four zones three kilometres across with overlapping level bands and travel
  between them, each with its own terrain, palette, lighting, weather, scatter,
  landmarks and skills to learn
- Hills, mountains and standing water, streamed as you walk, with boss arenas
  and shopfronts levelled flat so a telegraph circle reads
- A day cycle that runs while the game is closed, and weather per zone
- A minimap and a world map drawn from one relief bitmap per zone, with camps
  coloured against your level and fronts in the colour of whoever holds them
- Five factions contesting eight holdings: territory that changes hands from
  what you kill, drifts on its own, and garrisons itself with whoever holds it
- Four dragons that live in world state, sleep, wake, take ground off the
  factions holding it, and cannot be camped for
- Faction standing that decides who attacks you on sight and what you pay
- Four other adventurers per zone who walk it, fight it, talk about it and
  never once touch your kills
- Eight wild herds in three families and mounted travel, captured by knowing
  when to stop hitting
- A luxury merchant with the game's only offhand, amulet and bracelet slots,
  priced at the far end of a hundred levels of income
- Two quest chains per zone — a story chain that walks you through its bands
  and an armour line that outfits you — with kill, collect and travel
  objectives, chained by prerequisite, and class-matched rewards
- A drag-and-drop backpack and paper doll, with what every item does on it
- Death that costs an experience debt rather than a level, cleared by walking
  back to your body
- A world that carries on with the game closed: territory drifts, dragons keep
  their rounds and the sun goes round against the clock, and returning opens on
  what changed
- Levelling to 100, five attribute points and a skill point a level
- Save/load via full world serialization
- An art pipeline: drop a `.glb` into `public/models/`, add a line to
  `src/content/models.ts`, and that creature stops being a capsule

## Development

```bash
npm run verify     # typecheck + 266 unit and balance tests
npm run smoke      # plays the game in real Chromium, writes screenshots/
npm run look       # stands the camera at each landmark and takes a picture
npm run models     # scans public/models/ and prints the manifest lines
```

`npm test` prints tables rather than only asserting: win rate, time-to-kill,
health remaining and slams hit vs dodged for every tuned encounter; the full
kills-per-level curve; what a death costs at each band; how empty each zone's
country is; a day's worth of light levels; and eight days of weather. Balance is
measured against those numbers rather than guessed — if a threshold fails, the
game gets fixed, not the threshold.

`npm run smoke` does the same for the things unit tests cannot see: it prints a
frame's draw-call count and bounds it, checks that night never goes too dark to
play in, and proves the art pipeline by writing a small animated glTF, loading
it, and deleting it again.
