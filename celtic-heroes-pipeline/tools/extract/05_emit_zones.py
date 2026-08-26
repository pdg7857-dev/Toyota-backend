#!/usr/bin/env python3
"""Stage 5 — Emit zone JSON.

Reads terrain_meta.json + landmarks.json, writes content/zones/generated/.

Never overwrites a hand-edited zone file: output always lands in
generated/ for the user to diff and merge. Every file must pass the zone
validator before it is written.

Usage: python tools/extract/05_emit_zones.py [--dry-run] [--vertical-compress]
"""
from __future__ import annotations

import argparse
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from chext import gate, io_utils, measure, paths, schema, targets as targets_cfg, zones  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description="Stage 5 — emit zone JSON")
    ap.add_argument("--dry-run", action="store_true", help="validate without writing")
    ap.add_argument("--vertical-compress", action="store_true",
                    help="also scale heightScale and anchor elevation by the ratio")
    ap.add_argument("--speed", type=float, default=measure.DEFAULT_RUN_SPEED_MPS)
    args = ap.parse_args()

    io_utils.stage_header(5, "Emit zone JSON")
    scene_map = gate.require_scene_map()
    paths.ensure_dirs()

    terrains = io_utils.read_json(paths.TERRAIN_META)
    landmark_doc = io_utils.read_json(paths.LANDMARKS_JSON, default={"landmarks": []})
    landmarks = landmark_doc.get("landmarks", []) if isinstance(landmark_doc, dict) else landmark_doc
    targets = targets_cfg.load()

    # scene -> zone identity, as confirmed by the user in Stage 1.
    by_terrain: dict[str, dict] = {}
    for scene, entry in scene_map.items():
        if not entry.get("confirmed"):
            io_utils.warn(f"scene '{scene}' is not marked confirmed; skipping")
            continue
        for tn in entry.get("terrainNames") or []:
            by_terrain[tn] = {**entry, "scene": scene}

    by_scene: dict[str, list[dict]] = {}
    for lm in landmarks:
        by_scene.setdefault(lm.get("scene", ""), []).append(lm)

    written, skipped = [], []
    for t in terrains:
        ident = by_terrain.get(t["name"])
        if ident is None:
            skipped.append((t["name"], "no confirmed scene_map entry"))
            continue
        zone_id = ident.get("zoneId") or zones.slugify(t["name"])
        target_cfg, _how = targets_cfg.match(t["name"], targets, zone_id=zone_id)
        target_cfg = target_cfg or {}
        target = targets_cfg.target_size(target_cfg)
        if not target:
            skipped.append((t["name"], f"no targetSizeMetres for '{zone_id}' in "
                                       f"{paths.rel(paths.ZONE_TARGETS)}"))
            continue
        if target_cfg.get("worldOriginMetres"):
            t = {**t, "worldOriginMetres": target_cfg["worldOriginMetres"]}

        doc = zones.build_zone(
            zone_id=zone_id,
            name=ident.get("zoneName") or zone_id.replace("_", " ").title(),
            terrain_meta=t,
            target_size=tuple(target),
            landmarks=by_scene.get(t.get("source", ""), []),
            speed_mps=args.speed,
            compress_vertical=args.vertical_compress,
        )

        out_path = paths.ZONES_GENERATED / f"{zone_id}.json"
        hand_authored = paths.ZONES / f"{zone_id}.json"
        if hand_authored.exists():
            existing = io_utils.read_json(hand_authored)
            doc = zones.merge_preserving(existing, doc)
            io_utils.info(f"  {zone_id}: hand-authored file exists — generated copy only, "
                          "diff and merge by hand")

        issues = schema.validate(doc)
        for i in issues:
            io_utils.warn(f"{zone_id}: {i}")
        if schema.errors(issues):
            skipped.append((t["name"], f"{len(schema.errors(issues))} validation error(s)"))
            continue
        if args.dry_run:
            io_utils.info(f"  {zone_id}: valid (dry run, not written)")
            continue
        written.append(io_utils.write_json(out_path, doc))

    io_utils.stage_footer(written)
    for name, why in skipped:
        io_utils.warn(f"skipped {name}: {why}")
    print(f"\n  {len(written)} zone(s) written, {len(skipped)} skipped.")
    if written:
        print(f"  Output is in {paths.rel(paths.ZONES_GENERATED)} — diff against "
              f"{paths.rel(paths.ZONES)} and merge by hand.\n"
              "  Portals are hand-authored; extraction rarely identifies them.")


if __name__ == "__main__":
    sys.exit(gate.run_guarded(main))
