# Emerald Isle — working notes

A single-player 3D tab-target RPG. Celtic-flavoured, grounded (wildlife and
outlaws) with exactly one exception — see "Dragons" — original IP. Built so that the combat
simulation could later run on a server if the project goes multiplayer.

This repository is the game and nothing else. Read this before changing anything.

## The one rule that matters

**`src/sim/` is a pure, headless, deterministic module.** It must never import
from `src/render/`, never touch the DOM or three.js, and never read wall-clock
time. Every random decision goes through `World.rng`.

That is not architectural purity for its own sake. It is what makes this
possible:

- **Testable** — `test/balance.test.ts` runs thousands of fights headlessly.
- **Reproducible** — a bug replays exactly from (seed, commands).
- **Portable** — the same module can run as a server authority. If multiplayer
  ever happens, this rule is the whole reason it isn't a rewrite.

If you find yourself wanting to reach into an entity from the renderer to change
something, add a `Command` instead.

## Data flow

```
input / HUD click ──> Command ──> World.submit()
                                      │
                        World.tick()  │  fixed 50ms steps
                                      ▼
                              SimEvent[] ──> HUD log, floating text,
                                             telegraph circles, animation
```

- **Commands** (`sim/types.ts`) are the only way in. Single-player runs them
  in-process; a server would receive the identical objects over the wire and
  validate them the same way. `World.applyCommand` is that validation seam.
- **Events** are the only way out. The renderer subscribes. Sim never reads them.
- `main.ts` runs a fixed-timestep accumulator and interpolates rendering between
  the last two ticks — the same structure a network client uses on snapshots.

## Layout

| Path | What lives there |
|---|---|
| `src/sim/world.ts` | The authoritative simulation. Tick order is documented in `tick()`. |
| `src/sim/formulas.ts` | **All** balance math, including the grind dials. Tune here. |
| `src/sim/types.ts` | Entities, Commands, Events, star ratings, mob abilities. |
| `src/sim/rng.ts` | Seeded, serializable PRNG. |
| `src/content/` | Pure data: items, skills, mobs, loot tables, the zones, classes. |
| `src/content/terrain.ts` | Zone themes: ground shape, palette, light, fog, scatter. |
| `src/content/factions.ts` | Who holds what, and what they make of you. |
| `src/content/dragons.ts` | The four things the world moves around by itself. |
| `src/content/mounts.ts` | The herds, and what riding each one is worth. |
| `src/content/luxury.ts` | The one shop that is not a safety net. |
| `src/content/adventurers.ts` | Who else is out there, and what they say. |
| `src/content/structures.ts` | The things somebody built, and where they stand. |
| `src/render/` | three.js, DOM, input. Nothing gameplay-authoritative. |
| `src/render/scene.ts` | Builds a zone from its theme. Knows *how*, not *which*. |
| `src/render/anim.ts` | Animation state machine — see "Animation" below. |
| `src/render/map.ts` | The minimap and the map. Both drawn from one relief bitmap. |
| `tools/smoke.mjs` | Boots the real game in Chromium, plays it, screenshots it. |
| `tools/look.mjs` | Stands the camera somewhere and takes a picture. See below. |

Adding a mob, item or skill should mean editing `src/content/` only.

## The world answers back

Everything else in this game answers *how strong is my character*. This layer
answers a different question: **what did I change?**

Five factions, eight holdings, one number per holding saying who is winning.
Kill a faction's people and their claim weakens where you are standing; do
enough of it and the ground changes hands, the banner changes, and the guards
at the posts are replaced by the new holder's. See `content/factions.ts`.

Four rules hold it together, and each of them is load-bearing:

- **People have politics. Animals do not.** A Bog Wolf belongs to nobody and
  holds nothing. Only the human factions garrison ground, which keeps this a
  map of who controls a road rather than a bestiary with flags on it.
- **Ground changes hands. Towns do not.** Every holding can flip; no trader's
  ground is ever contested, and a test enforces the clearance. A world where
  everything can be lost is a world where nothing feels stable, and a player
  who comes back to find the shop gone has been punished for leaving.
- **Territory is taken where you are standing.** A kill counts toward the front
  it happened at — a guard's own post, or the nearest one their faction holds.
  Spreading one kill across every front they hold was the obvious alternative
  and it is worse: the map moves somewhere you are not, so a player fighting at
  the Road Watch watches the Southern Marsh fall.
- **The map moves without you.** Each front drifts at its own rate, so a zone
  has ground quietly falling and ground quietly holding rather than one uniform
  tide. Pushing back is what your kills are *for*, and it is why walking away
  for an hour means walking back into a different map.

A front is ~114 kills to flip against the drift — grind scale, deliberately, so
territory is bought in the same currency as everything else.

### What dying costs

Death used to cost the walk back and nothing else, which in a game where a ★4
kills you 18% of the time makes a bad pull free — and a fight with no downside
is a fight with no tension. Both of the obvious prices are worse than no price:

- **Losing gear** turns a bad pull into a shopping trip, and hits hardest at
  exactly the moment the player was already having a bad time.
- **Losing experience** lets a run of bad luck push a character *backwards*. A
  level you have already earned should never be revocable; twenty-eight
  thousand kills is not something to take away from somebody.

So death is priced in the currency the whole game is denominated in, without
ever subtracting from it: you take on a **debt**, and kills pay it down out of
the same stream that levels you (`DEBT_REPAY_SHARE`). Progress never reverses;
it slows, and then it stops slowing, and the player can always see the end of
it. `npm test` prints what a death costs at each band — currently 20 to 290
kills, always about 35% of the level it happened in.

Three rules around it:

- **Capped at one level's worth.** A losing streak that digs a hole deeper than
  the level took to earn is "you lost a level" wearing a different name.
- **Free below level 10.** The first ten levels are where a player learns which
  fights are survivable; charging for that lesson teaches caution before the
  game has taught competence.
- **Your body is on the map.** Walk back to where you fell and press **V** and
  the rest of the debt is cleared. This is the half that makes it a decision
  rather than a tax: go back through the thing that killed you, or pay it off
  in kills somewhere safer. Without it the walk back is dead time.

The bar draws the debt as ground still to make up, sitting *ahead* of where you
are — not as a bite taken out behind you. It has never taken anything away, and
the bar must not imply that it has.

## The map moves while the game is closed

`tickTerritory` made the war carry on without you, but only while the tab was
open — which made "the world moves without you" a claim the game honoured
exactly as long as you were watching it. `World.catchUp(elapsedMs)` closes that:
the host stamps the save with a wall-clock time, works out the gap on load, and
hands the sim a **duration**. Time is a parameter, never a reading — `sim/` must
never look at a clock, and this is also precisely how a server tells a
reconnecting client what it missed.

Three rules make a fortnight safe to run:

- **Only the world layers.** Territory drift and the dragons' routine, the two
  things that are genuinely about elapsed time. No combat, no respawns, no
  regeneration, nobody wandering. A mob that fought a hundred battles in an
  empty room is a random number generator with extra steps.
- **The same rules, at a coarser step.** `catchUp` calls the live loop's own
  `tickTerritory` and `tickDragons`; only `stepMs` differs, and a test asserts
  two hours ticked and two hours caught up land on the same map. A separate
  "offline" path is a second implementation of the world, free to disagree with
  the first one.
- **It never touches the `Rng`.** Adventurer reactions are suppressed during a
  catch-up — a test caught them drawing from the stream, which meant a front
  falling while you were logged out changed the numbers of the next fight you
  picked.

`AWAY_STEP_MS` is 30s, shorter than the shortest dragon phase, so no dragon can
hunt and roost between two samples and take ground nobody ever saw it on. The
cap is a fortnight, which is past the point drift converges: a player returning
after a year gets the same world as one returning after two weeks, because the
world they left is gone either way.

What comes back is an `AwayReport` — **net changes only**, not the event
stream. Fourteen days is hundreds of flips, and a log that opens with forty
lines of "the wyrm is moving" has buried the one line that mattered. A front
that flipped twice and came back did not change.

The card that shows it opens by itself and *only when something moved*: a panel
that says "nothing happened while you were away" teaches the player to dismiss
the thing that will one day tell them the road they levelled on belongs to
somebody else now.

### Standing is the part you feel

Factions remember. Standing moves with every kill and every quest, and the
consequence that matters is `TRUCE_AT`: **a faction that has come to terms with
you stops attacking you.** Walk through a camp that used to swarm you and
nothing moves. Go the other way past `HOSTILE_AT` and they notice you from
half again as far off.

In a game with no other players in it, that is the most legible way the world
can react to what you have done — far more legible than a number in a panel.
Traders price by it too, but gently: a shop that refuses a hated player strands
someone who picked the wrong fight at level 6 with nowhere to go.

### What was deliberately not taken

The design brief this came from is an MMO's. Clans, chat, the player economy
and PvP are all multiplayer *by definition* — they need other people, and a
faked version (NPC "clans" you can join, a simulated auction house) is a menu
pretending to be a society. What those systems actually produce is a world with
opinions about you and stakes that outlast a session, and that is what the
faction layer is: the single-player translation, not a shrunken copy.

The one part of a populated world that *is* worth faking is the ambient
evidence of it — somebody working the camp you were heading for, somebody
saying something in chat. That is not a system, it is scenery, and scenery is
exactly what a single-player game can honestly build. See "Other adventurers".

## Star ratings

Mobs are rated ★1–★6. ★1–★4 are ordinary mobs of rising danger, **★5 is a boss**,
**★6 is an elite boss** (`BOSS_STARS` / `ELITE_BOSS_STARS` in `sim/types.ts`).

Stars scale health, damage and defence via `STAR_MODIFIERS`. This exists so an
encounter can be made harder *without* raising its level — level gap drives xp
rewards and hit chance, so inflating level to add difficulty distorts
progression. Reach for stars first.

## Four zones, deliberately overlapping

| Zone | Band | Ends at |
|---|---|---|
| The Fenmarch | 1–25 | Cadfael ★5 (20), Old Scar ★6 (25) |
| Ardmoor | 20–40 | Aonghus ★5 (30), Muireann ★6 (40) |
| The Sunken Wood | 38–70 | Fiachra ★5 (55), Old Cauldron ★6 (70) |
| Caer Dubh | 66–100 | Ruadhán ★5 (85), Donnchadh ★6 (100) |

The bands **overlap on purpose**, and a test enforces it: the next zone opens
before the last is exhausted, so moving on is a choice rather than an eviction.
Exit `minLevel` sits at the bottom of the destination's band for the same reason.

Only one zone is loaded at a time. `World.travelTo` keeps the player and rebuilds
everything else from the zone definition — mobs respawn on timers anyway, so
nothing meaningful is lost and a save stays one zone's worth of state.

**The Fenmarch is hand-tuned and is the reference.** Everything from Ardmoor
south — forty-plus creatures, twelve gear tiers, four armour slots — is
generated from curves in `formulas.ts` fitted to it. Hand-writing seventy-five
levels of content is seventy-five chances to mistype a number that a player only
experiences as "this zone feels wrong".

## Quests give a zone direction

One chain per zone (`content/quests.ts`), each step `requires` the last, walking
you band by band to the bosses and then pointing at the next zone. Vendors are
the givers. Rewards are derived from `xpToNext` at the quest's level rather than
hand-picked, because the same "feels big" number is a fortune at 20 and a
rounding error at 90 — chains currently land at 22–43% of their band's grind.

Collection objectives read the bags directly rather than counting pickups, so
items gathered before accepting still count. That reads as a bug every time it
does not work.

### The armour lines

Each zone runs a **second** chain from the same trader: four steps, one armour
slot each, then a capstone that asks for a handful of every trophy the line
taught you to farm and pays out a weapon for your class. `QuestDef.chain` is
what separates the two — a zone has a `_story` chain and a `_kit` chain, and a
test walks each chain rather than each zone.

It exists because every other piece of gear in the game is a drop rate you
fight and hope against. A trophy at a **known** rate (`TROPHY_DROP_CHANCE`)
turns hope into "sixty more kills", which is the difference between a grind
that feels long and one that feels arbitrary. It also pays in the slots drops
are worst at filling: a player who never sees a chest piece can go and get one.

The gear is deliberately not best-in-slot — a hair above the ladder curve
(`QUEST_GEAR_POWER`), below what a boss or a rare spawn carries, and with no
affixes. Guaranteed gear that beat the drops would make the drops pointless.

Rewards are also **xp-light on purpose**. The levelling curve is tuned against
the story chain plus the grind; a second chain paying story-sized experience
would quietly shorten every band by a third. A test asserts the kit chain pays
under half what the story chain does.

Turning in a collection step **consumes** the items. Collection objectives read
the bags rather than counting pickups, so without that a single stack would
satisfy the same requirement twice — and the capstone, which asks for the same
trophies again, would cost nothing.

## Each zone teaches you something

The level-granted kit finishes at 15. Over a hundred-level game that meant
seventy-five levels of bigger numbers and no new decisions, so every zone past
the Fenmarch **teaches three skills per class**, and a skill is taught by an
*item*, not by a level. Reaching 44 does not hand you the Sunken Wood's kit;
going there and finding it does.

| Tome | Where it comes from |
|---|---|
| uncommon | the zone's trader sells it |
| rare | the zone's ★5 boss, or 2% from its ★3–★4 camps |
| epic | the zone's ★6 elite boss, and nowhere else |

That is deliberately the same shape as the loot rule — quality climbs with
difficulty and no trader ever stocks above uncommon — so learning a zone's kit
is a reason to fight its bosses rather than to farm its trash. It also finally
gives gold something to do: a level-70 player has more coin than uses for it,
and a tome is the one purchase that changes how the character plays.

A rare tome is on the ★5 boss **and** on the camps around it on purpose. A skill
gated behind exactly one kill is a skill a player can get permanently stuck
without.

Mechanically: `SkillDef.taughtBy` names an item, `ItemDef.teaches` names the
skill, and the pair is generated from one table so neither can exist without the
other (a test walks every taught skill and fails if its tome drops from nowhere).
`Entity.learnedSkills` is what you know; `LootTable.classTomes` resolves against
the killer's class the same way `classWeapons` does, and is suppressed if they
already know it — farming a boss for gear should not bury you in books you have
read.

The nine taught skills are **generated** for the same reason the late weapon
ladders are: five classes times nine skills is forty-five sets of numbers, and
a hand-typed one that lands 20% high is a class that quietly outscales the rest.
Only the names are hand-written, because names are the part a player reads.

Sixteen skills do not fit one row of hotkeys, so the bar is two: **1–0** and
**Shift+1–6**.

## The grind is intentional

This game is deliberately grind-heavy, and kills-per-level must keep climbing
all the way to the cap. That works because `xpToNext` grows superlinearly while
a level-appropriate mob's xp grows roughly linearly with its level.

Two dials in `sim/formulas.ts`:

- `XP_CURVE_BASE` — makes the whole game shorter or longer.
- `XP_CURVE_EXPONENT` — makes the ramp steeper or flatter.

`npm test` prints the full kills-per-level table. Currently ~2,650 kills to
reach 25, rising from ~6 kills for the first level to ~150+ near the cap. If
someone asks to "make levelling faster", change `XP_CURVE_BASE` — do not
quietly flatten the exponent, the ramp is the design.

## Five classes, one formula

All five are playable: Warrior, Priest, Ranger, Rogue, Mage.

`PRIMARY_ATTRIBUTE` is the **only** branch in combat maths — it selects which
attribute feeds attack rating (Strength, Focus or Dexterity). Every class then
runs the identical formula, so they are balanced against the same numbers rather
than five hand-tuned systems drifting apart.

Weapons are class-locked via `ItemDef.classes`; armour and rings are shared.
Warrior and Priest ladders are hand-written and act as the **reference**; the
other three are generated in `items.ts` from a shared per-tier DPS budget, so a
new class cannot quietly end up ahead. Only the *feel* differs — a Rogue swings
fast for little, a Ranger slowly from range. A test prints the parity table and
fails if any tier spreads more than 40%.

Every boss declares `classWeapons` on its loot table, resolved against whoever
lands the kill, so the guaranteed epic is always something you can actually use.

Each class has six or seven skills granted by level (all by 15) and nine more
**taught by the zones** — see "Each zone teaches you something". Sixteen skills,
two hotkey rows.

**Every class gets an interrupt** and a way to survive a spike (a heal or a
defence buff) — both asserted by test, because a class missing either cannot
answer content the others can. The answer to a mechanic is split deliberately:

| Boss does | Player answers with |
|---|---|
| Telegraphed AoE (`heavySlam`) | **Moving** out of the circle. Not interruptible. |
| Heal or summon | **Interrupting**. `interruptible: true` on the ability. |

If everything were interruptible, the interrupt would just be a strictly better
dodge and one of the two mechanics would be dead weight. A missed interrupt still
burns its cooldown, so timing it is a real decision.

### What breaks *your* cast

The mirror of the above: a cast of yours is not equally fragile to everything
that hits you. `applyDamage` takes a `castBreak` mode.

| Damage | Effect on your cast | Why |
|---|---|---|
| A mob spell or heavy attack | **Always** breaks it | The moment you are meant to plan around. Casting through a telegraphed slam should not be an option. |
| An ordinary auto-attack | **Rolls** — `castBreakChance` | Chip damage is constant. If every swing broke a cast, no caster could act in melee at all. |
| A damage-over-time tick | **Never** | Otherwise standing in a bleed silently disables casting, which no player would ever attribute to the bleed. |

A roll that fails is not free: the cast still takes pushback, capped so it
always eventually lands. `castBreakChance` is defence, level gap and nothing
else — armour is what makes you steady under fire, so gear reads as
*composure* and not just as a bigger health bar, and a mob well above your
level rattles you more than an equal one.

## Loot: better, not more

The rule, enforced by tests:

- **Gold** is derived (`goldForKill`) from level and stars and scales steeply.
  It is the reliable reward and the reason a grind still pays with no drop.
- **Merchant goods** drop often and climb sharply in value with difficulty.
- **Equipment stays rare at every tier** — total gear chance per ordinary mob is
  capped by `MAX_EQUIPMENT_DROP_CHANCE`. What improves with difficulty is the
  *quality* of the piece, not the odds. Epics come only from bosses and rare
  spawns.

A loot-table `goldMultiplier` is a flavour bonus (outlaws carry coin). A test
asserts the dominance relation — if one mob is no easier on both level and stars
and strictly harder on one, it must pay more — which already caught an outlaw
bonus letting a level-16 mob out-earn a level-21 one.

## Rare spawns: the thing you farm for

Some creatures are not in the zone layout at all. Every time a **host** camp
spawn point's respawn timer fires, the world rolls `RARE_SPAWN_CHANCE`, and on
a hit the mob comes back as a **named variant** instead — `RARE_TOUGHNESS`
times the camp mob's effective health, a star higher where it can be, and
carrying one signature item that drops nowhere else in the game.

Four per zone, sixteen in all (`content/rares.ts`). Finding one takes roughly
**9–25 minutes of deliberate camping**, and essentially never happens by
accident while levelling past — a test prints the expected wait per rare and
fails if it leaves that band.

**Every rare is named for what it carries.** One epithet names the creature and
its drop: `Mirefang the Bog Wolf` carries the `Mirefang Blade`, and a Priest
killing the same creature gets the `Mirefang Stave`. That is what makes the
class-locked weapon problem disappear — one creature, one name, an item per
class that shares it.

| It carries | What drops |
|---|---|
| `weapon` | a signature weapon, resolved against the killer's class |
| `relic` | a signature armour piece or ring — class-neutral, so a flat drop |
| `lore` | the zone's ★6 elite-boss tome, per class: a second path to the capstone skill |

The drop is **guaranteed**. Finding the creature is the grind; failing a loot
roll on top of that charges the same bad luck twice and turns a good hour into
a wasted one.

### Signature items carry affixes, and nothing else does

A signature piece is not "the next tier early" — it is `SIGNATURE_POWER` (22%)
above the ladder curve *and* carries something no ladder item has:
`critBonus`, `healthBonus` or `moveSpeedBonus`, one per slot so a full set is a
spread of small advantages rather than one stacked stat. A test walks every
ladder item and fails if one grows an affix.

Attributes alone still cap crit at 0.5; an affix can push to 0.6. Folding both
into one cap quietly raised the ceiling for high-Dexterity classes wearing
ordinary gear, and the balance suite caught it inside one run.

### Bounty spawns: the same creature with a purse

The sixteen above carry permanent rewards, which is why they are worth a long
wait. A **bounty** is spent the moment you pick it up, so it turns up more often
(`BOUNTY_SPAWN_CHANCE`, one every five to ten minutes) and — deliberately — it
is a *softer* fight than the camp, not a harder one. A jackpot you cannot cash
because it hits like a ★4 two levels up is worse than no jackpot.

Two per zone, one gold and one experience, worth `BOUNTY_MULTIPLIER` (15x) of
an ordinary kill from their camp. They sit on camps the item rares do not use,
so different camps are worth farming for different reasons — and a test asserts
one variant per host, because the spawn roll picks between "ordinary" and "the
variant" and a host carrying two would silently drop one.

Their worth is **anchored to the camp they hide in**: fifteen times a Mossback
Boar is still Mossback Boar money. That is what stops a level-90 character
farming a level-3 camp for gold, without needing a level check anywhere.

### Two rules the rest of the codebase depends on

- **Rares stop at ★4.** ★5 and ★6 mean boss and elite boss everywhere else —
  `isBoss` gates arena clearings, telegraph tests and loot rules on exactly
  that. A rare is a hard camp mob, not a boss that wanders. Because a ★4 host
  has nowhere to climb, toughness is expressed as a multiple of the host's
  *effective* stats and divided back out through `STAR_MODIFIERS`, so every
  rare lands on the same multiple whatever its host's rating.
- **Rares are not "ordinary mobs".** Every loot rule below is about what a camp
  pays out; a named creature you see once an hour runs on the opposite rules
  (guaranteed epic, 2.5x gold). The loot ladder excludes them explicitly.
  `ZoneDef.rareSpawns: false` switches the roll off entirely, which is what
  test arenas use — a duel against a creature you did not ask for measures the
  wrong thing, and the roll itself draws from the same `Rng` as combat.

## Vendors close the economy

Two traders (`content/vendors.ts`), placed clear of every camp's aggro radius —
a shop you get pulled off mid-trade is not a shop, and a test enforces it.

- **Selling**: merchant goods fetch their full listed value (that is their whole
  purpose); equipment fetches 25%, so vendoring drops never out-earns playing.
- **Buying**: 4x value, and stock is capped at *uncommon* — vendors are a gold
  sink and a safety net for a bad drop streak, never a shortcut past the grind.
  Rares and epics are killed for.
- A test asserts `buyPrice > sellPrice` on every item, so no buy-and-resell loop
  can ever print money.

### The one exception, and why it isn't one

Ceallach (`content/luxury.ts`) stocks epics, which breaks the rule above
deliberately. It works because **the price is the grind**: a Sovereign piece is
tens of thousands of kills' worth of gold, so nobody buys one *instead* of
playing. A test prints what each tier costs in kills at its own level and fails
if that number leaves the intended band — measured against *ordinary* mobs, not
bosses, because "9.7 boss kills" was how the first pass looked affordable.

He sells the three slots nothing else fills — `offhand`, `amulet`, `bracelet` —
which is also why they cannot unbalance the ladder: no drop competes for those
slots, so the whole shop is additive rather than a shortcut past a tier.

The offhand is the most build choice in the game: a blade (flat damage, so it is
worth most to whoever swings fastest), a bulwark (armour and health), or a
grimoire (`skillPower`, multiplying what you *cast*). One slot, three characters.

Priced and powered **a step below what a dragon carries**, on purpose. A dragon
is the hardest fight in its zone at a moment you did not choose; this is a thing
you decide to save up for. If money bought the best item in the game, killing the
dragon would be a formality.

## Horses are the one fight you have to leave something in

Every other creature in the game is a health bar you empty. A horse
(`content/mounts.ts`) is the one you must not: beat it under
`CAPTURE_THRESHOLD` and then send `capture` instead of hitting it again. Kill it
and the loot table is empty and the xp is below its peers' — a test asserts
both, because the stat block is what has to say "this is not what you are here
for". Every failure path names the mistake (`too strong`, `too far`, `dead`);
"nothing happened" reads as a broken command.

Each herd is a different animal rather than a bigger number — speed, damage,
armour, regen — so a mount is a choice. **The legendary is rare to keep, not
rare to find**: the Ashen Grey runs alone where anyone can walk to it and
shrugs off eleven attempts in twelve. A spawn timer would have been the obvious
alternative and it is a worse story.

A telegraphed hit unseats you; ordinary swings never do. That is the same
three-way rule `castBreak` uses, for the same reason: if chip damage threw you,
nobody would ever ride into a fight and the mount would stop existing the moment
combat started.

## Landmarks, and camps that move

Two things arrived together because they answer the same complaint: three
kilometres of ground with nothing in it, populated by animals standing on
marks.

**Landmarks** (`content/structures.ts`) are renderer-only, like terrain. Three
rules:

- **A structure means something.** A watchtower stands on a holding, a ruin
  marks a boss's ground, a farmstead is where a trader set up. Seeing one from
  four hundred metres is information, not dressing — you know there is a front
  over there.
- **They are unique enough to navigate by.** Deterministic per zone and never
  within 260 units of each other. A landmark you can confuse with another
  landmark is an anti-landmark.
- **They are levelled with the ground under them**, the same as boss arenas and
  shopfronts, for the same reason: a tower on a slope has one corner buried and
  one in the air.

Which kinds a zone gets is a table entry (`ZONE_KINDS`), so the Fenmarch has
farmsteads and cairns because people live there, and Caer Dubh has ruins
because whatever lived there is gone. Stone takes the theme's boundary colour,
so a ruin is grey on the moor and violet in the otherworld without a second
table.

**Roaming**: an idle creature ambles about within `ROAM_RADIUS` of where it
spawned, at a third of its running speed. Bosses, dragons, summons and
garrisons never do — a boss that wandered would draw its telegraph down a
hillside, and a watch that wanders is not watching anything.

The important part is where the randomness comes from. A wander destination is
**hashed from (entity id, wander count)**, never drawn from `World.rng`. The
obvious alternative was a `roaming: false` flag on every test arena, the way
`rareSpawns` and `adventurers` work; this way there is no fourth switch to
forget, and a camp grazing in the background provably cannot move a number in a
seeded fight — a test asserts the Rng state is untouched across a minute of it.

The cost is real and lands in one place: aggro is measured from where a
creature *is*, so every clearance in the game — boss arenas, shopfronts, the
arrival point — is now `aggroRadius + roam + margin`, and the tests say so.

## What dying costs

Death used to cost the walk back and nothing else, which in a game where a ★4
kills you 18% of the time makes a bad pull free — and a fight with no downside
is a fight with no tension. Both of the obvious prices are worse than no price:

- **Losing gear** turns a bad pull into a shopping trip, and hits hardest at
  exactly the moment the player was already having a bad time.
- **Losing experience** lets a run of bad luck push a character *backwards*. A
  level you have already earned should never be revocable; twenty-eight
  thousand kills is not something to take away from somebody.

So death is priced in the currency the whole game is denominated in, without
ever subtracting from it: you take on a **debt**, and kills pay it down out of
the same stream that levels you (`DEBT_REPAY_SHARE`). Progress never reverses;
it slows, and then it stops slowing, and the player can always see the end of
it. `npm test` prints what a death costs at each band — currently 20 to 290
kills, always about 35% of the level it happened in.

Three rules around it:

- **Capped at one level's worth.** A losing streak that digs a hole deeper than
  the level took to earn is "you lost a level" wearing a different name.
- **Free below level 10.** The first ten levels are where a player learns which
  fights are survivable; charging for that lesson teaches caution before the
  game has taught competence.
- **Your body is on the map.** Walk back to where you fell and press **V** and
  the rest of the debt is cleared. This is the half that makes it a decision
  rather than a tax: go back through the thing that killed you, or pay it off
  in kills somewhere safer. Without it the walk back is dead time.

The bar draws the debt as ground still to make up, sitting *ahead* of where you
are — not as a bite taken out behind you. It has never taken anything away, and
the bar must not imply that it has.

## The sun goes round, and the sky does things

Time of day is **sim state** (`World.worldTimeMs`), not a renderer clock, for
the same reason territory drift and the dragons' routine are: it is genuinely
about elapsed time. `catchUp` advances it, so a fortnight away puts you down at
a different hour — the cheapest possible proof the world did not pause when you
closed the tab. Twenty-four minutes to the day, tuned against the grind rather
than realism: a real-time cycle means most players never see night.

Weather is a **hash of (zone, spell number)** rather than a stored roll. It is
therefore free across a save, free across a fortnight's catch-up, and — the
part that matters — it cannot draw from `World.rng`. Roaming creatures learned
the same lesson: anything ambient that touches the combat stream turns every
balance figure in the suite into a measurement of the scenery.

Two rules hold it together:

- **Night is a mood, never a legibility problem.** `NIGHT_FLOOR` is a floor on
  the light multiplier and a test walks the whole cycle against it. The
  renderer spends the darkness on the *sun* — which is what a person actually
  reads as night — while holding the *ambient* above half and turning it the
  colour of moonlight. Caer Dubh already shipped once as black shapes on a
  black hill; a cycle is a much better way to make that mistake, because it
  only happens for a few minutes and only to whoever was online.
- **One gameplay consequence, and one is enough.** In the dark everything
  notices you from `NIGHT_AGGRO` further off. That makes crossing a zone at
  night a decision, and it needs no tooltip. Everything else about weather and
  the hour is atmosphere, and atmosphere is allowed to be atmosphere.

Every number the renderer applies is a *multiplier on the theme*, never a
replacement: Caer Dubh at noon is still violet twilight and the Fenmarch at
midnight is still a moor. A cycle that overwrote the palette would turn four
zones into one zone at four times of day.

## The map

Three kilometres of ground, and until now the only navigation in the game was
the quest arrow — which points at exactly one thing. Every other question a
player has ("where is a camp my level", "which way is the shop", "how far is
the boss") had no answer but walking until you found out, which is not
exploration, it is being lost.

Both views come from **one relief bitmap** rendered once per zone: the minimap
is a crop of it, the map (**M**) is the whole thing scaled down. Two separately
drawn maps are two things that can disagree about what the ground looks like.

What makes it worth reading rather than pretty:

- **Camps are coloured by how they compare to you**, on the same five-step
  scale as a nameplate. A dot's position is a fact; its colour is a decision.
- **Camps are grouped, and labelled once.** Five hundred spawn points is five
  hundred dots. The first version labelled every cluster and wrote "Bog Wolf 8"
  five times down one road.
- **Holdings are drawn in the colour of whoever holds them right now**, which
  is the territory layer's only picture of itself.
- The relief is shaded off the **slope**, not the height, because that is the
  only thing that makes a hill legible in plan.

## Looking at it

`npm run smoke` proves the game runs. `npm run look` is the other half: it
stands the camera in front of each of a zone's landmarks and takes a picture,
or at any coordinate you name.

It exists because the bugs it found were invisible to every other check — the ground's dry/damp tint was sampled in **tile-local**
coordinates, and the ground tile follows the player. The pattern of dry rises
and wet hollows was therefore nailed to the camera: a dark halo that walked
across the entire zone with the character, in every screenshot this project has
ever taken. No assertion could have caught that. Somebody had to go and stand
in it.

## Other adventurers

Four per zone (`content/adventurers.ts`), `kind: 'npc'`. They walk between
camps, stand in them "fighting", occasionally lose, and talk. That is all they
do, and it is the entire single-player translation of *other people are here*.

Three rules, each of which a test enforces:

- **They never touch your loot or your kills.** Their fights are abstract and
  never reach a real mob's health, threat or loot table. An adventurer that tags
  the creature you needed is not atmosphere, it is a competitor, and competing
  with a script is miserable.
- **They cannot be fought.** Not "take no damage" — `applyDamage` refuses them
  and `tickSwings` will not even swing, because a swing animation that can never
  land reads as a broken game. A population you *can* kill is one you will kill,
  and then the world is empty and it was your fault.
- **They are quiet.** Ambient lines go through one shared floor
  (`CHATTER_MIN_GAP_MS`) rather than each source having its own rate. The first
  version did the obvious thing — idle chatter plus death chatter, each on its
  own timer — and measured at two and a half times the intended volume, because
  volume was an accident of how many things could talk. Reactions to real events
  (a front falling, a dragon landing, your level) bypass the floor: they are rare
  by nature and are the half that makes them read as people rather than wallpaper.

A congratulation on a level is **proximity-gated** (`GRATS_RANGE`), which is the
whole trick: a "grats" from nobody in particular is a system message wearing a
name. One from the ranger who has been working the same camp as you is the
cheapest moment of company in the game.

They are deterministic from `zoneSeed()` — the same names are in the same zone
every time you walk in, because a world whose population is different strangers
every login is a lobby — and one per class where the roster allows, because a
camp where three of the four play Priest reads as a bug in the population.

`ZoneDef.adventurers: false` switches them off, and every test arena sets it,
for the same reason as `rareSpawns`: they walk and talk on the sim's `Rng`, so a
populated arena is one where every seeded fight rolls different numbers.

## Bosses must be decided by play, not stats

A boss whose only mechanic is a bigger stat block has no outcome variance: the
result is fixed before the first swing. Every boss therefore gets at least one
**telegraphed, dodgeable** ability (`MobAbilityDef`, `kind: 'heavySlam'`).

The mechanism: the mob is **rooted while casting**, so the danger circle stays
where it was drawn; on resolution anyone still inside the radius is hit, anyone
outside gets a `dodged` event. `test/balance.test.ts` asserts the gap between
playing well and playing badly:

| Fight | Standing in it | Dodging |
|---|---|---|
| Cadfael ★5 (20) at lv22 | 36% win | 100% win, 36% hp left |
| Old Scar ★6 (25) at lv25 | 47% win | 100% win, 48% hp left |

And for the interrupt — Priest vs Cadfael at 22, both dodging:

| | Win rate | Health the boss healed |
|---|---|---|
| Ignoring the heal | 51% | 57,279 |
| Interrupting it | 67% | 27,579 |

If you add a boss, add a telegraph, and add both comparisons to the tests.

## Balance is measured, not guessed

When a balance test fails, **fix the game, not the threshold.** Widening a bound
to get green is how balance rots. Mechanics that exist purely because these
tests caught their absence:

- **Global cooldown** (`GCD_MS`) — without it the optimal opener was "press
  every skill on the same tick", and fights collapsed to ~2 seconds.
- **Cast pushback instead of cast cancellation** — damage used to cancel an
  interruptible cast outright, which meant a mob swinging every 1.6s made a 1.8s
  heal impossible and silently deleted every sustain class. Damage now delays a
  cast, capped so it always eventually lands. Movement still cancels outright,
  and the three-way rule above decides which hits break rather than delay.
- **Level-scaled mitigation and defensive buffs** — both were fixed constants
  that worked to 25 and broke by 60. "+60 defence" is a third of your total at
  level 10 and nothing at level 60; a fixed mitigation constant let a level-90
  hit through at under 9%. Both now scale above level 25, leaving the Fenmarch
  numerically untouched.
- **Accuracy is level-gap only** — the old `(attack - defense)` term was a
  double-dip on `defense` and, at the cap, had mobs landing 31% of swings.
- **The late mob health curve** (`curveMobHealth` above level 20) — player
  damage climbs superlinearly and mob health was flat linear, so fights got
  *shorter* the further you got: a level-56 character killed a level-appropriate
  ★3 in three seconds. This was always true and was invisible until the harness
  started firing skills in a sensible order (below). The Fenmarch is untouched
  either way — its bestiary is hand-authored and never reads the curve.
- **Rank/star modifiers** — so level scaling can stay gentle enough to leave a
  "close fight" band instead of flipping impossible-to-trivial in four levels.
- **A weak stat term in `hitChance`** — `defense` already drives `mitigation()`,
  so letting it also drive avoidance made armour double-dip and high-level mobs
  could barely land a hit.
- **Boss arena isolation** — a zone-layout test fails if an unrelated camp sits
  close enough that meleeing a boss pulls it in. Deliberate guard camps opt out
  with `guardOf` on the spawn.

## Dragons

The world is deliberately grounded: wildlife and people, nothing that should
not exist. **Dragons are the single exception, and that is the whole design.**
Put griffons and trolls and wyrms in the same hills and a dragon is the biggest
monster on a list. Leave it as the only impossible thing in Dal Riata and it is
an event.

A dragon is **not a boss with a spawn point**. Bosses stand where the zone
layout puts them and wait for you. A dragon (`content/dragons.ts`):

- lives in world state, not in `ZoneDef.spawns`
- sleeps in a lair for ~26 minutes, wakes, and works its territory
- sits on each holding it claims for ~7 minutes, then moves on
- **drives the garrison off the ground it lands on** and stops that front dead
  — a third power the factions cannot negotiate with
- cannot be tamed, farmed or camped: no spawn roll, no host camp, no respawn
  timer. The only thing that produces a dragon is time.

The routine ticks wherever the player is, so a dragon three zones away is a
phase and a banner rather than an entity; walk into its zone mid-visit and it
is already there, on ground that is already empty.

One per zone, sitting at the **top of its zone's band** rather than above it.
Level gap drives both accuracy and mitigation, so three levels of headroom made
every dragon a cliff — unwinnable at the cap, trivial four levels later — and
it cannot work at all for Caer Dubh, where the cap is the level cap. A dragon
carries its difficulty in `toughness` and `menace` instead, as multiples of its
own zone's ★6 elite boss, hand-fitted per dragon against the printed table:

| | Win at the zone cap | Fight length |
|---|---|---|
| Saorla (25) | 75–100% | ~60–85s |
| Crannach (40) | 67–100% | ~40–58s |
| Oanach (70) | 67–100% | ~29–41s |
| Vharok (100) | 58–100% | ~19–31s |

They are ★6 rather than a new ★7: adding one would mean re-fitting
`STAR_MODIFIERS` and every rule keyed to "★5 is a boss, ★6 is an elite boss"
for four creatures. `MobDef.dragon` is what content and tests use to mean "not
a zone's boss".

Their weapons are the best in the game (`WYRM_POWER`, above the rare spawns'
signature gear) because they are the only items you cannot get by camping,
buying, questing or planning for.

## Each zone looks like somewhere else

`content/terrain.ts` holds a `ZoneTheme` per zone — sky, fog, ground palette,
light, ground shape and what is scattered across it. A zone names one with
`theme:`; the renderer does the rest.

| Zone | Theme | Reads as |
|---|---|---|
| The Fenmarch | `plains` | Open moor, low hills, broadleaf and standing stones. |
| Ardmoor | `crags` | High country: terraced shelves, boulders, thin conifers, cold grey light. |
| The Sunken Wood | `wyldwood` | A drowned forest gone strange — close canopy, standing water, fungus that glows. |
| Caer Dubh | `otherworld` | Violet twilight that never breaks, lit stones, crystal, drifting motes. |

Two rules hold this together:

- **The look is data, `render/scene.ts` is the engine.** That file knows how to
  build a hill, a tree and a fog bank; it does not know Ardmoor is grey. A new
  zone's appearance is a table entry, not renderer work.
- **Terrain is renderer-only, and a test enforces it.** The sim stays 2D:
  positions are (x, z), distances are flat, nothing in `sim/` samples a height.
  Ground height moves the *view* of an entity and nothing else. Making it
  authoritative means line-of-sight, slope costs and a heightmap both sides must
  agree on — a lot of new surface for something a follow camera barely sells.
  `HeightField` is pure, so if terrain ever does become gameplay it moves into
  `sim/` intact.

**Boss arenas and shopfronts are levelled flat** by `HeightField`, out to a
plateau and then smoothed to the surrounding ground. This is not tidiness: a
telegraph is a flat circle you dodge by reading its edge, and draped over a
slope it either clips into the hill or floats above it. A test samples the
slam radius around every boss and fails if its arena is on a slope.

Themes also carry a minimum light level, asserted by test. Caer Dubh was first
authored at true dusk and shipped with the mobs as black shapes on a black
hill — atmosphere is not worth a fight you cannot read.

## Animation

Currently procedural placeholders on capsules. `render/anim.ts` is the seam:
sim events call `request(state)`, and `update()` advances whatever is playing.

To move to real art, replace the body of `applyPlaceholder()` with
`THREE.AnimationMixer` actions and call `attachMixer()`. **Nothing outside that
file changes** — the events that drive animation (`swing`, `castBegin`,
`damage`, `death`) already fire.

## Verifying a change

```bash
npm run verify        # typecheck + 222 unit and balance tests
npm run build && npm run preview &
npm run smoke         # real browser, plays the game, writes screenshots/
```

The balance suite is also where six separate HARNESS bugs were caught, each of
which had looked like a game balance problem: `levelPlayer` spending points into
an attribute three classes do not use; the setup tick killing low-Vitality
classes before the fight began; firing heals on cooldown at full health; popping
defensive buffs at full health, which made the skills that grant them measure as
a downgrade; spamming the kit so the global cooldown was never free for an
interrupt; and submitting skills in list order, which meant only ever pressing
the lowest-level skill you own — every skill learned later in the game sat at the
end of the list and was never once tested. When a class looks weak, suspect the
harness before retuning content.

The mirror is also true: a weak harness *hides* real problems. The rotation fix
above is what finally exposed the late mob health curve.

And a printed comparison beats a passing assertion: the rare-spawn table showed
each named creature dying in *exactly* the same time as the camp mob it
replaces — because `spawnMob` was unwrapping `rareOf` on the way in and handing
back the host. Every assertion still passed. Two identical columns are what gave
it away, which is why these tests print their tables.

The same trap caught the dragons, harder. Every class read a flat 0% win rate,
and three rounds of "tuning" made no difference — because a dragon in a test
arena has no `dragonId`, the respawn guard keyed off the entity rather than the
definition, and `respawnMs: 0` meant *respawn immediately*: it healed to full on
the tick it died. A number that does not move when you change the inputs is not
a balance problem, it is a bug.

Always run `smoke` for renderer or HUD changes. Unit tests cannot see a panel
overlapping another panel, nameplate clutter, or a tree planted through a boss —
`smoke` caught all three. It drives to the boss fight through the `window.__game`
debug handle exposed in `main.ts`.

## Deliberately not built yet

Dialogue, crafting, real art, **gameplay-authoritative terrain**, pathfinding
(mobs walk straight lines) and entity collision. Vendor stock is static too —
traders never run out and never restock, which wants an inventory model if the
economy ever grows past four zones.

The adventurers are the thinnest of the world layers and the one with the most
obvious next step: they fight abstractly, so they never actually pull anything,
and they have nothing to say about the player beyond a level. Giving them real
pulls on real camps is the one change that would make them feel like people —
and it is also the change that would break the rule they exist under, so it
needs a way for them to fight *without* ever being the reason a spawn you wanted
is missing.
