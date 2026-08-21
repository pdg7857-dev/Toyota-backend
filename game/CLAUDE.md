# Emerald Isle — working notes

A single-player 3D tab-target RPG. Celtic-flavoured, original IP. Built so that
the combat simulation could later run on a server if the project goes
multiplayer.

Read this before changing anything under `game/`.

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
                                             animation state machines
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
| `src/sim/formulas.ts` | **All** balance math. Tune here, not in the resolver. |
| `src/sim/types.ts` | Entities, Commands, Events. |
| `src/sim/rng.ts` | Seeded, serializable PRNG. |
| `src/content/` | Pure data: items, skills, mobs, loot tables, the zone, classes. |
| `src/render/` | three.js, DOM, input. Nothing gameplay-authoritative. |
| `src/render/anim.ts` | Animation state machine — see "Animation" below. |
| `tools/smoke.mjs` | Boots the real game in Chromium, plays it, screenshots it. |

Adding a mob, item or skill should mean editing `src/content/` only.

## Balance is measured, not guessed

`npm test` prints a table:

```
lv1 starting kit vs Mossback Boar (2) win 100%  ttk 8.0s  hp left 69%
lv6 geared vs Bog Wolf (5)            win 100%  ttk 6.6s  hp left 76%
lv16 geared vs Grualach (12, boss)    win 100%  ttk 33.8s hp left 66%
```

When a balance test fails, **fix the game, not the threshold.** Widening a bound
to get green is how balance rots. Two mechanics exist purely because these tests
caught their absence:

- **Global cooldown** (`GCD_MS`) — without it the optimal opener is "press every
  skill on the same tick", and every fight collapsed to ~2 seconds.
- **Rank modifiers** (`RANK_MODIFIERS`) — elites and bosses hit above their
  level. This lets level scaling stay gentle enough that encounters have a
  "close fight" band instead of flipping from impossible to trivial in 4 levels.

## Animation

Currently procedural placeholders on capsules. `render/anim.ts` is the seam:
sim events call `request(state)`, and `update()` advances whatever is playing.

To move to real art, replace the body of `applyPlaceholder()` with
`THREE.AnimationMixer` actions and call `attachMixer()`. **Nothing outside that
file changes** — the events that drive animation (`swing`, `castBegin`,
`damage`, `death`) already fire.

## Verifying a change

```bash
npm run verify        # typecheck + 33 unit and balance tests
npm run build && npm run preview &
npm run smoke         # real browser, plays the game, writes screenshots/
```

Always run `smoke` for renderer or HUD changes. Unit tests cannot see a panel
overlapping another panel, a HUD element behind the terrain, or a black screen —
`smoke` catches all three, and its screenshots are the fastest way to check a
visual change actually landed.

## Deliberately not built yet

Quests, dialogue, crafting, vendors, more than one zone, the four unimplemented
classes (data stubs exist in `content/zone.ts`), real terrain height, pathfinding
(mobs currently walk straight lines), and entity collision.

Boss fights have very low outcome variance — a fight is decided by the stat
spread, not by play. Real variance needs telegraphed mechanics (a heavy hit to
interrupt or move out of), which is the next thing worth building if the boss
should feel like a boss rather than a long normal mob.
