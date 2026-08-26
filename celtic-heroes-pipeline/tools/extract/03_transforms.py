#!/usr/bin/env python3
"""Stage 3 — Landmark transforms.

Extracts names and *world* positions for anything that looks like an anchor.
Positions come from a full parent-chain walk, not raw m_LocalPosition — a
flat local dump is wrong for anything nested, and scene props usually are.

Usage: python tools/extract/03_transforms.py [--force] [--all] [--keywords RE]
"""
from __future__ import annotations

import argparse
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from chext import gate, hierarchy, io_utils, paths, unity, zones  # noqa: E402

DEFAULT_KEYWORDS = (
    r"leystone|ley_|portal|teleport|spawn|boss|npc|vendor|merchant|"
    r"waypoint|marker|entrance|exit|door|bridge|camp|shrine"
)


def main() -> None:
    ap = argparse.ArgumentParser(description="Stage 3 — extract landmark world positions")
    ap.add_argument("--force", action="store_true", help="run despite a blocked probe verdict")
    ap.add_argument("--all", action="store_true",
                    help="emit every named transform, not just keyword matches")
    ap.add_argument("--keywords", default=DEFAULT_KEYWORDS, help="landmark name regex")
    args = ap.parse_args()

    io_utils.stage_header(3, "Landmark transforms")
    gate.require_probe_ok(force=args.force)
    paths.ensure_dirs()

    keywords = re.compile(args.keywords, re.I)
    rows: list[dict] = []
    warnings: list[str] = []
    scanned = 0

    for f in unity.loadable_files(paths.RAW):
        env = unity.safe_load(f)
        if env is None:
            continue
        transforms, _ = unity.transform_records(env)
        if not transforms:
            continue
        scanned += 1
        world, warns = hierarchy.resolve(transforms)
        source = str(f.relative_to(paths.RAW))
        warnings += [f"{source}: {w}" for w in warns]

        for tid, rec in transforms.items():
            if not rec.name:
                continue
            if not args.all and not keywords.search(rec.name):
                continue
            pos = world.get(tid)
            rows.append({
                "scene": source,
                "name": rec.name,
                "pathId": tid,
                "worldPos": [round(v, 3) for v in pos] if pos else None,
                "localPos": [round(v, 3) for v in rec.local_pos],
                "depth": hierarchy.depth_of(transforms, tid),
                "group": zones.classify(rec.name),
            })

    grouped: dict[str, int] = {}
    for r in rows:
        grouped[r["group"] or "unclassified"] = grouped.get(r["group"] or "unclassified", 0) + 1

    io_utils.stage_footer([io_utils.write_json(
        paths.LANDMARKS_JSON,
        {"landmarks": rows, "filesScanned": scanned,
         "keywords": args.keywords, "warnings": sorted(set(warnings))},
        indent=1)])

    print(f"\n  {len(rows)} candidate landmarks across {scanned} file(s)")
    for g, n in sorted(grouped.items(), key=lambda kv: -kv[1]):
        print(f"    {n:>6}  {g}")
    nested = sum(1 for r in rows if r["depth"] > 0)
    print(f"  {nested} of them are nested (world != local position)")
    for w in sorted(set(warnings))[:5]:
        io_utils.warn(w)
    if rows and all(r["group"] is None for r in rows):
        print("\n  ! No name matched a known anchor type. Names may be internal/cryptic —\n"
              "    cross-reference against the CHDB marker lists (map sheet §4) rather\n"
              "    than trusting them. See README 'Fallbacks'.")


if __name__ == "__main__":
    sys.exit(gate.run_guarded(main))
