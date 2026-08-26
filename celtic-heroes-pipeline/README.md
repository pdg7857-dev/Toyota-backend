# Celtic Heroes — asset extraction & measurement pipeline (v2)

Extracts terrain heightmaps and landmark coordinates from a Unity mobile
client and converts them into zone JSON.

**This is a tape measure.** The output is a folder of heightmaps and a table
of world coordinates — real distances between leystones, real terrain
elevation, real landmark positions. That data feeds `metresPerPixel`,
`sizeMetres`, `heightScale`, and every anchor position in the zone files.

**It is not a source of game logic.** Celtic Heroes is server-authoritative.
Item stats, mob stats, loot tables, XP curves, damage formulas, quest logic
and spawn timers are not in the client — they arrive from DECA's servers at
runtime. Stage 0 says so out loud when it detects an IL2CPP build, because
that is the point where it is tempting to go looking. Don't.

Everything runs locally on files you supply. Nothing is fetched, nothing is
published, nothing leaves the machine.

---

## Status — read this first

| Area | State |
|---|---|
| Stage 0 probe | **Verified end-to-end** against synthetic APKs (clean, encrypted, Addressables, empty, malicious-entry) |
| Measurement / compression / traversal maths | **Verified** — 19 unit tests, matches the spec's worked example |
| Transform hierarchy resolution | **Verified** — 9 unit tests incl. rotation, scale, cycles, 5000-deep chains |
| Height decoding | **Verified** — 8 unit tests across int16 / uint16 / float / byte-blob encodings |
| Zone emit + validator | **Verified end-to-end** — Stages 4→5 run as real scripts over synthetic Stage 2/3 output |
| **UnityPy adapter (`chext/unity.py`)** | **UNVERIFIED against a real client** — no APK was available. The layer is thin and defensive, but the field names it reads (`m_Heightmap`, `m_Father`, `m_LocalPosition`, `m_SplatDatabase`) have not been exercised against a real Unity file. Expect to adjust it on the first real run. |

78 tests pass. `python -m pytest`.

The pipeline has **never been run against a real Celtic Heroes client** —
none was supplied and one cannot be obtained from here. Stage 0 will tell
you within seconds of getting one whether the rest is viable.

---

## Inputs you must supply

This pipeline cannot obtain the client, and a cloud session cannot either —
no USB, no hardware virtualisation for an emulator, and outbound network
reaching package registries only. **Run the pipeline on the machine your
device plugs into.** Put the files here:

```
reference/client/
  base.apk                     # required
  split_config.arm64_v8a.apk   # if the install uses split APKs
  split_config.xxhdpi.apk      # if the install uses split APKs
  main.<version>.obb           # if an OBB expansion exists
```

```bash
tools/extract/pull_client.sh         # finds the device, pulls every APK + the OBB
```

It auto-detects the install, pulls **all** the split APKs (not just `base.apk`)
and the OBB, and launches the app once first because many mobile games download
most of their content on first run. Pass a package name to skip auto-detection:
`tools/extract/pull_client.sh com.example.game`.

By hand, if you prefer:

```bash
adb shell pm path com.<package>      # more than one line = split APK install
adb pull /data/app/.../base.apk reference/client/
```

See `reference/client/README.md`. iOS `.ipa` also works but is more awkward;
prefer Android. If only `base.apk` is supplied and the build turns out to
use split APKs or Addressables, Stage 0 flags it — the assets may be in a
file you didn't provide.

---

## Setup

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

UnityPy is pinned. AssetStudio is a Windows GUI and AssetRipper needs a full
Unity install; UnityPy is a scriptable pure-Python library that reads
`.assets` and `.bundle` directly, which is the right shape for this job.

---

## Running

```bash
python tools/extract/run_all.py            # stages 0-4: the sizing run
python tools/extract/run_all.py --through 5  # also emit zone JSON
```

Or one stage at a time:

| Stage | Script | Produces |
|---|---|---|
| — | `pull_client.sh` | pulls the client off a connected Android device |
| 0 | `00_probe.py` | `extract/manifest/probe.json` — **hard gate** |
| 1 | `01_inventory.py` | `objects.json`, `counts.json`, `scene_map.suggested.json` |
| 2 | `02_terrain.py` | heightmap PNGs + `terrain_meta.json` — **the most useful artefact** |
| 3 | `03_transforms.py` | `landmarks.json` with world positions |
| 4 | `04_measure.py` | `report.md` + `report.json` — **the deliverable** |
| 5 | `05_emit_zones.py` | `content/zones/generated/<id>.json` |
| — | `validate_zones.py` | validates any zone file against the schema |

**Build order:** stages 0–4 are one session and stop where the spec says to
stop. Stage 5 depends entirely on what Stage 1 reveals about landmark names.

### Gates

Two gates are enforced, both readable off disk so each stage stays
independently runnable:

1. **Stage 0 → 1.** Nothing runs past the probe without a `proceed` verdict.
   Encrypted containers mean there is nothing to extract; `--force`
   overrides, but read Fallbacks first.
2. **Stage 1 → 5.** Stage 5 refuses to run without `config/scene_map.json`
   with `"confirmed": true` entries. Stage 1 writes a *suggestion*; a human
   confirms which scene is which zone.

Exit codes: `0` success, `2` gate closed, `3` stage found nothing usable.

---

## Configuration

`config/zone_targets.json` — **you must fill this in.** Target sizes come
from the map sheet §4. Only the Stonevale figure quoted in the extraction
spec (900×700) is present. Without an entry, Stage 4 reports a zone's true
size but no compression ratio, and Stage 5 skips it rather than guessing.

Terrain names are matched forgivingly: `Stonevale_Terrain`, `TER_stonevale_01`
and `stonevale` all find the `stonevale` entry. Set `terrainNames` explicitly
when a zone's asset name shares nothing with its id.

Set `worldOriginMetres` when a terrain isn't placed at the world origin —
otherwise every anchor in that zone reports as outside its bounds.

---

## What the numbers mean

```
compressionRatio = targetSizeMetres / originalSizeMetres     (averaged over both axes)
metresPerPixel   = compressedSizeMetres[0] / heightmapPixels[0]
```

Stonevale coming back as 2000×1600 against a 900×700 target is a 0.44 ratio —
in the recommended 40–50% band. Much larger and the compression target needs
revisiting; Stage 4 says so and suggests a ratio that lands the typical
adjacent-leystone hop mid-band.

Traversal is checked between **adjacent** leystones (each anchor's nearest
neighbour), not every pair — corner-to-corner hops will always exceed 90 s
and aren't what the acceptance criterion is about.

---

## Assumptions worth challenging

1. **The zone schema is reconstructed, not authoritative.** The map sheet §7
   was not in this repo. `chext/schema.py` is built from the field names the
   specs reference (`terrain.sizeMetres`, `metresPerPixel`, `heightScale`,
   `regionMask`, `leystones`, `bossAnchors`, `portals`). Reconcile it against
   the map sheet before treating emitted files as final.

2. **Vertical is not compressed by default.** The spec says `heightScale`
   comes straight from `m_Scale.y` *and* that all positions scale by the
   compression ratio. Those two together sink every anchor below the mesh by
   (1 − ratio) of its height. Default: horizontal scales, vertical passes
   through unchanged, so terrain elevation in metres is unchanged and anchors
   sit where they should. `--vertical-compress` scales both together, which
   keeps slope angles identical and makes the world uniformly smaller.

3. **Heights are decoded, not assumed.** The spec's draft treated
   `m_Heights` as float 0..1 and clipped it. Unity serialises heights as
   packed int16 (0..32767); clipping that yields a solid white plate and a
   flat zone. The encoding is detected per terrain and reported in
   `terrain_meta.json`.

4. **`sizeMetres` spans cells, not samples.** A 513-sample terrain spans 512
   cells: `scale.x * (width - 1)`. Using `width` overstates every zone.

---

## Fallbacks

**The map-tracing pipeline (map sheet §6) remains the primary path.** This
whole pipeline is an optional accuracy upgrade. If a stage blocks for more
than a session, drop it and keep building — the greybox world graph doesn't
depend on any of it.

| Failure | Fallback |
|---|---|
| Bundles encrypted | Abandon extraction; trace maps instead. Stage 0 exits 3 and says so. |
| Addressables, catalog unreadable | Ask for the OBB and split APKs; if still blocked, trace. |
| `TerrainData` absent | Zones are meshes, not Unity terrain. Stage 1 and 2 both say so. Use mesh bounds for sizing; heightmaps come from tracing. |
| Landmark names meaningless | Stage 3 reports when nothing classified. Use terrain dimensions only; place anchors from CHDB marker pixels. |
| UnityPy typetree mismatch | `chext/unity.py` already falls back from `read_typetree()` to the parsed object's `m_*` attributes. If that fails too, pin a different UnityPy. |

---

## What is safe to commit

Manifests, transform tables and measurement reports are derived numeric data
(names, positions, dimensions) and are committed. Extracted meshes, textures
and heightmap images are not — they stay local.

`.gitignore` blocks `reference/client/`, `extract/raw/`, `extract/terrain/`,
and every `*.apk`, `*.obb`, `*.assets`, `*.bundle`. After a full run,
`git status` shows only manifests, measurements and scripts.

---

## Layout

```
reference/client/     user-supplied APK/OBB — READ ONLY, gitignored
extract/
  raw/                unzipped APK — gitignored
  manifest/           object inventories — committed
  terrain/            heightmap PNGs — gitignored
  transforms/         landmark coordinate tables — committed
  measurements/       distance/bounds reports — committed
tools/extract/        the stage scripts
chext/                pipeline logic (pure; UnityPy confined to unity.py)
config/               zone targets, scene map
content/zones/        hand-authored zone JSON
content/zones/generated/  emitted zone JSON — diff and merge by hand
tests/                78 tests, no client required
```

`CHEXT_ROOT` relocates the whole layout — used by the tests, and handy for
running against a second client.

---

## Acceptance checks

- [x] `.gitignore` blocks every client-derived binary
- [x] Every heightmap PNG is 16-bit and opens without error
- [x] Emitted zone JSON passes the validator
- [x] Landmark positions are checked against terrain bounds
- [x] Traversal band checked post-compression
- [ ] `probe.json` shows valid bundle magic and a known Unity version — *needs a client*
- [ ] `counts.json` lists at least one `TerrainData` — *needs a client*
- [ ] `terrain_meta.json` gives plausible `sizeMetres` — *needs a client*
