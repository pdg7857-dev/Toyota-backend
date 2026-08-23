# Emerald Isle — working notes

A single-player 3D tab-target RPG. Celtic-flavoured, grounded (wildlife and
outlaws, no mythical creatures), original IP. Built so that the combat
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
| `src/render/` | three.js, DOM, input. Nothing gameplay-authoritative. |
| `src/render/scene.ts` | Builds a zone from its theme. Knows *how*, not *which*. |
| `src/render/anim.ts` | Animation state machine — see "Animation" below. |
| `tools/smoke.mjs` | Boots the real game in Chromium, plays it, screenshots it. |

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
npm run verify        # typecheck + 179 unit and balance tests
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

Always run `smoke` for renderer or HUD changes. Unit tests cannot see a panel
overlapping another panel, nameplate clutter, or a tree planted through a boss —
`smoke` caught all three. It drives to the boss fight through the `window.__game`
debug handle exposed in `main.ts`.

## Deliberately not built yet

Dialogue, crafting, real art, **gameplay-authoritative terrain**, pathfinding
(mobs walk straight lines) and entity collision. Dragons as *world entities* —
a creature with territory and a routine rather than a spawn point — is the
obvious next thing the faction layer makes possible. Vendor stock is static too —
traders never run out and never restock, which wants an inventory model if the
economy ever grows past four zones.
