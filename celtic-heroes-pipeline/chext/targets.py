"""Matching TerrainData names to configured zone targets.

Config keys are zone ids ("stonevale") but TerrainData names are whatever
the artist called the asset ("Stonevale_Terrain", "TER_stonevale_01").
Requiring an exact match makes the obvious config silently do nothing, so
matching walks from strictest to loosest and reports which rule fired.
"""
from __future__ import annotations

import re

from . import io_utils, paths, zones

TERRAIN_NOISE = re.compile(r"(^ter[_\-]?)|([_\-]?terrain)|([_\-]?\d+$)", re.I)


def load(path=None) -> dict:
    cfg = io_utils.read_json(path or paths.ZONE_TARGETS, default={})
    return cfg.get("zones", {}) if isinstance(cfg, dict) else {}


def canonical(name: str) -> str:
    """Strip the decoration artists add around a zone name."""
    return zones.slugify(TERRAIN_NOISE.sub("", name or ""))


def match(terrain_name: str, targets: dict, zone_id: str | None = None) -> tuple[dict | None, str]:
    """Find the config entry for a terrain. Returns (entry, how_it_matched)."""
    if zone_id and zone_id in targets:
        return targets[zone_id], "zoneId"
    if terrain_name in targets:
        return targets[terrain_name], "exact"
    for key, val in targets.items():
        for alias in val.get("terrainNames") or []:
            if alias.lower() == (terrain_name or "").lower():
                return val, "terrainNames alias"
    slug = zones.slugify(terrain_name)
    if slug in targets:
        return targets[slug], "slug"
    canon = canonical(terrain_name)
    for key, val in targets.items():
        if canonical(key) == canon and canon:
            return val, "canonical name"
    return None, "unmatched"


def target_size(entry: dict | None) -> tuple[float, float] | None:
    if not entry:
        return None
    size = entry.get("targetSizeMetres")
    return tuple(size) if size and len(size) == 2 else None
