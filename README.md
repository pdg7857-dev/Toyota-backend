# Emerald Isle

A single-player 3D tab-target RPG — Celtic-flavoured, grounded, original IP.
Levels 1–25 across one hand-built zone, deliberately grind-heavy, with two
bosses whose fights are decided by how you play rather than by your stat sheet.

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
| `1`–`7` | Skills |
| `T` | Toggle auto-attack |
| `F` | Loot a nearby corpse |
| `E` | Trade with a nearby vendor |
| `C` / `I` | Character / Inventory |
| `Esc` | Clear target |

Progress autosaves to `localStorage` every 10 seconds.

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
- Two playable classes with separate skill trees, weapon ladders and identities
- 31 skills across five classes — instant, cast-time, damage-over-time,
  heal, buff and interrupt — unlocking across the whole 1–25 band
- Mob abilities: telegraphed dodgeable AoEs, interruptible heals and summons,
  enrage thresholds, adds that despawn with their summoner and drop no loot
- Mob AI: aggro radius, threat tables, chase, leash-and-heal, respawn timers
- 12 mob types across ★1–★6, 65 items, 12 loot tables, class-aware boss drops
- Levelling to 25, spendable attribute points, skill unlocks
- Death and respawn, save/load via full world serialization

## Development

```bash
npm run verify     # typecheck + 104 unit and balance tests
npm run smoke      # plays the game in real Chromium, writes screenshots/
```

`npm test` prints a balance table (win rate, time-to-kill, health remaining,
slams hit vs dodged) for every tuned encounter, plus the full kills-per-level
grind curve. Balance is measured against those numbers rather than guessed — if
a threshold fails, the game gets fixed, not the threshold.
