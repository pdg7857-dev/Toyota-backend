#!/usr/bin/env python3
"""Stage 1 — Object inventory.

Walks every asset file and catalogues what's inside, so you know where the
terrain lives before spending time on it. Also proposes a scene->zone map
for the user to confirm.

Usage: python tools/extract/01_inventory.py [--force]
"""
from __future__ import annotations

import argparse
import collections
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from chext import gate, io_utils, paths, unity, zones  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description="Stage 1 — inventory extracted objects")
    ap.add_argument("--force", action="store_true", help="run despite a blocked probe verdict")
    args = ap.parse_args()

    io_utils.stage_header(1, "Object inventory")
    gate.require_probe_ok(force=args.force)
    paths.ensure_dirs()

    rows: list[dict] = []
    counts: collections.Counter = collections.Counter()
    per_file: dict[str, collections.Counter] = {}
    unreadable: list[dict] = []

    targets = unity.loadable_files(paths.RAW)
    io_utils.info(f"  scanning {len(targets)} candidate files under {paths.rel(paths.RAW)}")

    for f in targets:
        env = unity.safe_load(f)
        if env is None:
            continue
        key = str(f.relative_to(paths.RAW))
        local: collections.Counter = collections.Counter()
        for obj in unity.iter_objects(env):
            t = unity.type_name(obj)
            counts[t] += 1
            local[t] += 1
            if t in unity.INTERESTING_TYPES:
                try:
                    rows.append({"file": key, "type": t, "pathId": obj.path_id,
                                 "name": unity.object_name(obj)})
                except Exception as e:  # one bad object must not kill the scan
                    unreadable.append({"file": key, "pathId": obj.path_id,
                                       "error": str(e)[:120]})
        if local:
            per_file[key] = local

    scenes = {k: dict(v) for k, v in per_file.items()
              if pathlib.PurePath(k).name.startswith("level") or v.get("TerrainData")}

    # Propose a scene -> zone mapping from the terrain names found in each scene.
    suggested = {}
    for scene in sorted(scenes):
        terrains = [r["name"] for r in rows if r["file"] == scene and r["type"] == "TerrainData"]
        suggested[scene] = {
            "zoneId": zones.slugify(terrains[0].replace("Terrain", "")) if terrains else "",
            "zoneName": terrains[0] if terrains else "",
            "terrainNames": terrains,
            "confirmed": False,
        }

    written = [
        io_utils.write_json(paths.OBJECTS_JSON, rows, indent=1),
        io_utils.write_json(paths.COUNTS_JSON, dict(counts.most_common())),
        io_utils.write_json(paths.SCENES_JSON,
                            {"scenes": scenes, "unreadableObjects": unreadable[:200]}),
        io_utils.write_json(paths.SCENE_MAP_SUGGESTED, suggested),
    ]
    io_utils.stage_footer(written)

    print("\n  Top object types:")
    for t, n in counts.most_common(25):
        print(f"    {n:>8}  {t}")
    terrain_count = counts.get("TerrainData", 0)
    print(f"\n  TerrainData objects: {terrain_count}")
    if terrain_count == 0:
        print("  ! No TerrainData. Zones are probably meshes, not Unity terrain —\n"
              "    see README 'Fallbacks': extract mesh bounds for sizing, trace heightmaps.")
    print(f"  Scene candidates: {len(scenes)}")
    print(f"\n  Confirm the scene->zone mapping with the user, then save\n"
          f"  {paths.rel(paths.SCENE_MAP_SUGGESTED)} as {paths.rel(paths.SCENE_MAP)}.")


if __name__ == "__main__":
    sys.exit(gate.run_guarded(main))
