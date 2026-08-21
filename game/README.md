# Emerald Isle

A single-player 3D tab-target RPG — Celtic-flavoured, original IP — built as a
vertical slice to prove out the combat loop before any content gets made.

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
| `1`–`5` | Skills |
| `T` | Toggle auto-attack |
| `F` | Loot a nearby corpse |
| `C` / `I` | Character / Inventory |
| `Esc` | Clear target |

You start at level 1 on the north edge of the Fenmarch. Boars are the safe
opener, wolves are the next band, the kobold camp guards the south, and
Grualach — the boss — waits alone at the far end. He will kill you at his own
level; come back around 16.

Progress autosaves to `localStorage` every 10 seconds.

## What's in the slice

- Fixed 20 Hz deterministic simulation with render interpolation
- Tab-target combat: auto-attack swing timers, hit/crit rolls, armour
  mitigation, level-gap scaling, global cooldown
- 5 Warrior skills — instant, cast-time, damage-over-time, heal and buff — with
  cast interruption
- Mob AI: aggro radius, threat tables, chase, leash-and-heal, respawn timers
- 4 mob types across normal / elite / boss ranks, with rank combat modifiers
- Levelling to 40, spendable attribute points, skill unlocks
- Loot tables, gold, inventory, equipment with live stat recalculation
- Death and respawn
- Save / load via full world serialization

## Development

```bash
npm run verify     # typecheck + 33 unit and balance tests
npm run smoke      # plays the game in real Chromium, writes screenshots/
```

`npm test` prints a balance table (win rate, time-to-kill, health remaining) for
every tuned encounter. Balance is measured against that table rather than
guessed — if a threshold fails, the game gets fixed, not the threshold.
