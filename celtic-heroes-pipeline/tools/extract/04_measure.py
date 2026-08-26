#!/usr/bin/env python3
"""Stage 4 — Measurement report.

The actual deliverable. Turns raw coordinates into the numbers the zone
files need, and checks them against the map sheet's acceptance criteria.

Stop here if the goal is just accurate sizing.

Usage: python tools/extract/04_measure.py [--speed 6.0]
"""
from __future__ import annotations

import argparse
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from chext import io_utils, measure, paths, report, targets as targets_cfg  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description="Stage 4 — measurement report")
    ap.add_argument("--speed", type=float, default=measure.DEFAULT_RUN_SPEED_MPS,
                    help="run speed in m/s (default 6.0)")
    args = ap.parse_args()

    io_utils.stage_header(4, "Measurement report")
    paths.ensure_dirs()

    terrains = io_utils.read_json(paths.TERRAIN_META)
    landmark_doc = io_utils.read_json(paths.LANDMARKS_JSON, default={"landmarks": []})
    landmarks = landmark_doc.get("landmarks", landmark_doc if isinstance(landmark_doc, list) else [])
    targets = targets_cfg.load()

    by_scene: dict[str, list[dict]] = {}
    for lm in landmarks:
        by_scene.setdefault(lm.get("scene", ""), []).append(lm)

    reports = []
    for t in terrains:
        entry, how = targets_cfg.match(t["name"], targets)
        target = targets_cfg.target_size(entry)
        if entry and entry.get("worldOriginMetres"):
            t = {**t, "worldOriginMetres": entry["worldOriginMetres"]}
        scene_landmarks = by_scene.get(t.get("source", ""), [])
        if not scene_landmarks and len(terrains) == 1:
            scene_landmarks = landmarks  # single-zone run: no ambiguity
        r = report.zone_report(t, scene_landmarks, target, speed_mps=args.speed)
        if target is None:
            r["warnings"].append(
                f"no target size configured for '{t['name']}' — add it to "
                f"{paths.rel(paths.ZONE_TARGETS)} (from map sheet §4) to get a ratio")
        reports.append(r)

    written = [
        io_utils.write_json(paths.REPORT_JSON,
                            {"runSpeedMps": args.speed,
                             "traversalBandSeconds": list(measure.TRAVERSAL_BAND_S),
                             "compressionBand": list(measure.COMPRESSION_BAND),
                             "zones": reports}),
        io_utils.write_text(paths.REPORT_MD, report.render_markdown(reports, args.speed)),
    ]
    io_utils.stage_footer(written)

    print()
    for r in reports:
        o = r["originalSizeMetres"]
        line = f"  {r['name']}: {o[0]:g}x{o[1]:g} m"
        if r["compressionRatio"]:
            c = r["compressedSizeMetres"]
            line += f" -> {c[0]:g}x{c[1]:g} m (ratio {r['compressionRatio']}, " \
                    f"{r['metresPerPixel']} m/px)"
        print(line)
        for w in r["warnings"]:
            io_utils.warn(w)
    flagged = sum(len(r["warnings"]) for r in reports)
    print(f"\n  {len(reports)} zone(s), {flagged} warning(s). "
          f"Full report: {paths.rel(paths.REPORT_MD)}")


if __name__ == "__main__":
    sys.exit(0 if main() is None else 1)
