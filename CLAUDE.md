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
| `src/render/` | three.js, DOM, input. Nothing gameplay-authoritative. |
| `src/render/scene.ts` | Builds a zone from its theme. Knows *how*, not *which*. |
| `src/render/anim.ts` | Animation state machine — see "Animation" below. |
| `tools/smoke.mjs` | Boots the real game in Chromium, plays it, screenshots it. |

Adding a mob, item or skill should mean editing `src/content/` only.

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
  *quality* of the piece, not the odds. Epics come only from bosses.

A loot-table `goldMultiplier` is a flavour bonus (outlaws carry coin). A test
asserts the dominance relation — if one mob is no easier on both level and stars
and strictly harder on one, it must pay more — which already caught an outlaw
bonus letting a level-16 mob out-earn a level-21 one.

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
npm run verify        # typecheck + 135 unit and balance tests
npm run build && npm run preview &
npm run smoke         # real browser, plays the game, writes screenshots/
```

The balance suite is also where four separate HARNESS bugs were caught, each of
which had looked like a game balance problem: `levelPlayer` spending points into
an attribute three classes do not use; the setup tick killing low-Vitality
classes before the fight began; firing heals on cooldown at full health; and
spamming the kit so the global cooldown was never free for an interrupt. When a
class looks weak, suspect the harness before retuning content.

Always run `smoke` for renderer or HUD changes. Unit tests cannot see a panel
overlapping another panel, nameplate clutter, or a tree planted through a boss —
`smoke` caught all three. It drives to the boss fight through the `window.__game`
debug handle exposed in `main.ts`.

## Deliberately not built yet

Dialogue, crafting, real art, **gameplay-authoritative terrain**, pathfinding
(mobs walk straight lines) and entity collision. Vendor stock is static too —
traders never run out and never restock, which wants an inventory model if the
economy ever grows past four zones.
