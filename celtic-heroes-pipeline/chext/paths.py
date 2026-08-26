"""Canonical directory layout. Every stage resolves paths through here."""
from __future__ import annotations

import os
import pathlib

# CHEXT_ROOT relocates the whole layout — used by the tests to work in a
# temp tree, and handy for running the pipeline against a second client.
ROOT = pathlib.Path(os.environ.get("CHEXT_ROOT")
                    or pathlib.Path(__file__).resolve().parent.parent).resolve()

CLIENT = ROOT / "reference" / "client"          # user-supplied APK/OBB (read-only, gitignored)
EXTRACT = ROOT / "extract"
RAW = EXTRACT / "raw"                           # unzipped APK (gitignored)
MANIFEST = EXTRACT / "manifest"                 # object inventories (committed)
TERRAIN = EXTRACT / "terrain"                   # heightmap PNGs (gitignored)
TRANSFORMS = EXTRACT / "transforms"             # landmark tables (committed)
MEASUREMENTS = EXTRACT / "measurements"         # reports (committed)
CONFIG = ROOT / "config"
ZONES = ROOT / "content" / "zones"
ZONES_GENERATED = ZONES / "generated"

PROBE_JSON = MANIFEST / "probe.json"
OBJECTS_JSON = MANIFEST / "objects.json"
COUNTS_JSON = MANIFEST / "counts.json"
SCENES_JSON = MANIFEST / "scenes.json"
TERRAIN_META = MEASUREMENTS / "terrain_meta.json"
LANDMARKS_JSON = TRANSFORMS / "landmarks.json"
REPORT_MD = MEASUREMENTS / "report.md"
REPORT_JSON = MEASUREMENTS / "report.json"
ZONE_TARGETS = CONFIG / "zone_targets.json"
SCENE_MAP = CONFIG / "scene_map.json"
SCENE_MAP_SUGGESTED = CONFIG / "scene_map.suggested.json"

# Directories a stage may create on demand. CLIENT is never created — its
# absence is a real signal that the user has not supplied the client.
WRITABLE = (RAW, MANIFEST, TERRAIN, TRANSFORMS, MEASUREMENTS, ZONES_GENERATED)


def ensure_dirs() -> None:
    for d in WRITABLE:
        d.mkdir(parents=True, exist_ok=True)


def rel(p: pathlib.Path) -> str:
    """Path relative to the pipeline root, for readable log output."""
    try:
        return str(pathlib.Path(p).resolve().relative_to(ROOT))
    except ValueError:
        return str(p)
