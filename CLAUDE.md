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
| `src/content/` | Pure data: items, skills, mobs, loot tables, the zone, classes. |
| `src/render/` | three.js, DOM, input. Nothing gameplay-authoritative. |
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
| Cadfael ★5 (20) at lv22 | 6% win | 64% win |
| Old Scar ★6 (25) at lv25 | 20% win | 100% win |

If you add a boss, add a telegraph, and add that comparison to the tests.

## Balance is measured, not guessed

When a balance test fails, **fix the game, not the threshold.** Widening a bound
to get green is how balance rots. Mechanics that exist purely because these
tests caught their absence:

- **Global cooldown** (`GCD_MS`) — without it the optimal opener was "press
  every skill on the same tick", and fights collapsed to ~2 seconds.
- **Rank/star modifiers** — so level scaling can stay gentle enough to leave a
  "close fight" band instead of flipping impossible-to-trivial in four levels.
- **A weak stat term in `hitChance`** — `defense` already drives `mitigation()`,
  so letting it also drive avoidance made armour double-dip and high-level mobs
  could barely land a hit.
- **Boss arena isolation** — a zone-layout test fails if an unrelated camp sits
  close enough that meleeing a boss pulls it in. Deliberate guard camps opt out
  with `guardOf` on the spawn.

## Animation

Currently procedural placeholders on capsules. `render/anim.ts` is the seam:
sim events call `request(state)`, and `update()` advances whatever is playing.

To move to real art, replace the body of `applyPlaceholder()` with
`THREE.AnimationMixer` actions and call `attachMixer()`. **Nothing outside that
file changes** — the events that drive animation (`swing`, `castBegin`,
`damage`, `death`) already fire.

## Verifying a change

```bash
npm run verify        # typecheck + 56 unit and balance tests
npm run build && npm run preview &
npm run smoke         # real browser, plays the game, writes screenshots/
```

Always run `smoke` for renderer or HUD changes. Unit tests cannot see a panel
overlapping another panel, nameplate clutter, or a tree planted through a boss —
`smoke` caught all three. It drives to the boss fight through the `window.__game`
debug handle exposed in `main.ts`.

## Deliberately not built yet

Quests, dialogue, crafting, vendors, a second zone, the four unimplemented
classes (data stubs exist in `content/zone.ts`), real terrain height,
pathfinding (mobs walk straight lines), entity collision, and interrupts — note
that Cadfael's `bind_wounds` is a soft DPS check rather than something to react
to precisely because no interrupt skill exists yet.
