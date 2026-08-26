"""Zone JSON assembly (Stage 5 logic, kept pure for testing)."""
from __future__ import annotations

import re

from . import measure, schema

LEYSTONE = re.compile(r"leystone|ley[_\-]?\d|waypoint|shrine", re.I)
BOSS = re.compile(r"boss|raid|drake|spawn[_\-]?grp|elite", re.I)
PORTAL = re.compile(r"portal|teleport|entrance|exit|door|gateway", re.I)


def slugify(name: str, fallback: str = "anchor") -> str:
    s = re.sub(r"[^a-z0-9]+", "_", (name or "").lower()).strip("_")
    return s or fallback


def classify(name: str) -> str | None:
    """Bucket a landmark by name. Returns None when nothing matches."""
    if LEYSTONE.search(name or ""):
        return "leystones"
    if BOSS.search(name or ""):
        return "bossAnchors"
    if PORTAL.search(name or ""):
        return "portals"
    return None


def _unique(base: str, taken: set[str]) -> str:
    if base not in taken:
        taken.add(base)
        return base
    n = 2
    while f"{base}_{n}" in taken:
        n += 1
    taken.add(f"{base}_{n}")
    return f"{base}_{n}"


def build_zone(zone_id: str,
               name: str,
               terrain_meta: dict,
               target_size: tuple[float, float],
               landmarks: list[dict],
               heightmap_pixels: tuple[int, int] | None = None,
               speed_mps: float = measure.DEFAULT_RUN_SPEED_MPS,
               compress_vertical: bool = False) -> dict:
    """Assemble one zone document.

    Terrain and every anchor share the *same* horizontal compressionRatio;
    scaling them independently walks anchors off the mesh.

    Vertical is deliberately not compressed by default. `heightScale` is
    carried through unchanged from TerrainData m_Scale.y, so terrain
    elevation at a given point is unchanged in metres — scaling an anchor's
    Y by the horizontal ratio as well would sink it below the mesh by
    (1 - ratio) of its height. Set compress_vertical=True only if you also
    scale heightScale, which makes the world uniformly smaller but keeps
    slope angles identical.
    """
    original = tuple(terrain_meta["sizeMetres"])
    ratio = measure.compression_ratio(tuple(target_size), original)
    size = [round(original[0] * ratio, 2), round(original[1] * ratio, 2)]

    px = tuple(heightmap_pixels or terrain_meta.get("heightmapResolution") or (0, 0))
    mpp = round(measure.metres_per_pixel(size[0], int(px[0])), 5) if px and px[0] else None

    bounds_min = tuple(terrain_meta.get("worldOriginMetres") or (0.0, 0.0))
    groups: dict[str, list[dict]] = {g: [] for g in schema.ANCHOR_GROUPS}
    taken: set[str] = set()
    unclassified: list[str] = []

    for lm in landmarks:
        pos = lm.get("worldPos") or lm.get("localPos")
        if not pos or len(pos) < 3:
            continue
        group = lm.get("group") or classify(lm.get("name", ""))
        if group not in groups:
            unclassified.append(lm.get("name", ""))
            continue
        local = measure.normalise_to_origin(tuple(pos[:3]), bounds_min, original)
        vertical_ratio = ratio if compress_vertical else 1.0
        entry = {
            "id": _unique(slugify(lm.get("name", ""), fallback=group[:-1]), taken),
            "sourceName": lm.get("name", ""),
            "posMetres": [round(local[0] * ratio, 2), round(local[2] * ratio, 2)],
            "elevationMetres": round(local[1] * vertical_ratio, 2),
        }
        groups[group].append(entry)

    height_scale = terrain_meta.get("heightScale")
    if compress_vertical and height_scale:
        height_scale = round(height_scale * ratio, 3)

    doc = {
        "id": zone_id,
        "name": name,
        "terrain": {
            "heightmap": f"{terrain_meta['name']}_height.png",
            "regionMask": terrain_meta.get("splatmap"),
            "sizeMetres": size,
            "heightmapPixels": [int(px[0]), int(px[1])] if px and px[0] else None,
            "metresPerPixel": mpp,
            "heightScale": height_scale,
        },
        **groups,
        "source": {
            "generatedBy": "tools/extract/05_emit_zones.py",
            "terrainName": terrain_meta["name"],
            "originalSizeMetres": [round(original[0], 2), round(original[1], 2)],
            "targetSizeMetres": [float(target_size[0]), float(target_size[1])],
            "compressionRatio": round(ratio, 4),
            "compressionInBand": measure.in_band(ratio, measure.COMPRESSION_BAND),
            "verticalCompressed": bool(compress_vertical),
            "runSpeedMps": speed_mps,
            "unclassifiedLandmarks": len(unclassified),
        },
    }
    # Drop keys the schema treats as optional rather than emitting nulls.
    doc["terrain"] = {k: v for k, v in doc["terrain"].items() if v is not None}
    return doc


def merge_preserving(existing: dict, generated: dict) -> dict:
    """Carry hand-authored content forward when regenerating.

    Portals are hand-authored per the spec — extraction rarely identifies
    them — so anything already present wins over an empty generated list.
    """
    out = dict(generated)
    for group in schema.ANCHOR_GROUPS:
        if existing.get(group) and not generated.get(group):
            out[group] = existing[group]
    for key in ("name", "notes", "connections"):
        if key in existing and key not in generated:
            out[key] = existing[key]
    return out
