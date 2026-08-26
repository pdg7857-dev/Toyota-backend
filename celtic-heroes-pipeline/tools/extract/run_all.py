#!/usr/bin/env python3
"""Run the pipeline in build order, stopping at the first closed gate.

Usage: python tools/extract/run_all.py [--through 4] [--force]

Stages 0-4 are the sizing run and stop where the spec says to stop.
Stage 5 needs a user-confirmed config/scene_map.json, so it is opt-in.
"""
from __future__ import annotations

import argparse
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
STAGES = [
    (0, "00_probe.py"),
    (1, "01_inventory.py"),
    (2, "02_terrain.py"),
    (3, "03_transforms.py"),
    (4, "04_measure.py"),
    (5, "05_emit_zones.py"),
]


def main() -> int:
    ap = argparse.ArgumentParser(description="Run pipeline stages in order")
    ap.add_argument("--through", type=int, default=4,
                    help="last stage to run (default 4 — the sizing deliverable)")
    ap.add_argument("--force", action="store_true", help="pass --force to gated stages")
    args = ap.parse_args()

    for number, script in STAGES:
        if number > args.through:
            break
        cmd = [sys.executable, str(HERE / script)]
        if args.force and number in (1, 2, 3):
            cmd.append("--force")
        rc = subprocess.call(cmd)
        if rc != 0:
            print(f"\nStopped at stage {number} (exit {rc}).", file=sys.stderr)
            return rc
    return 0


if __name__ == "__main__":
    sys.exit(main())
