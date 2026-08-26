"""Zone JSON validation.

NOTE ON PROVENANCE: the companion map sheet (§7) is the authority on this
schema. It was not available in this repo when the pipeline was built, so
the shape below is reconstructed from the fields the specs reference by
name (terrain.sizeMetres / metresPerPixel / heightScale / regionMask,
leystones, bossAnchors, portals). Reconcile it against the map sheet before
treating emitted files as final — see README §Assumptions.
"""
from __future__ import annotations

import dataclasses
import re

from . import measure

SLUG = re.compile(r"^[a-z0-9]+(?:[-_][a-z0-9]+)*$")
ANCHOR_GROUPS = ("leystones", "bossAnchors", "portals")


@dataclasses.dataclass
class Issue:
    severity: str   # "error" | "warn"
    path: str
    message: str

    def __str__(self) -> str:
        return f"[{self.severity}] {self.path}: {self.message}"


def _num(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _pair(value) -> bool:
    return isinstance(value, (list, tuple)) and len(value) == 2 and all(_num(v) for v in value)


def validate_zone(doc: dict) -> list[Issue]:
    issues: list[Issue] = []
    err = lambda p, m: issues.append(Issue("error", p, m))
    warn = lambda p, m: issues.append(Issue("warn", p, m))

    if not isinstance(doc, dict):
        return [Issue("error", "$", "zone document must be an object")]

    zone_id = doc.get("id")
    if not isinstance(zone_id, str) or not SLUG.match(zone_id):
        err("id", f"must be a lower-case slug, got {zone_id!r}")
    if not isinstance(doc.get("name"), str) or not doc.get("name"):
        err("name", "must be a non-empty string")

    terrain = doc.get("terrain")
    if not isinstance(terrain, dict):
        err("terrain", "missing or not an object")
        return issues

    size = terrain.get("sizeMetres")
    if not _pair(size):
        err("terrain.sizeMetres", "must be [x, z] numbers")
        return issues
    if any(s <= 0 for s in size):
        err("terrain.sizeMetres", f"must be positive, got {size}")
        return issues
    if not measure.plausible_zone_size(tuple(size)):
        warn("terrain.sizeMetres", f"{size} is outside the plausible 50..20000 m range")

    mpp = terrain.get("metresPerPixel")
    if not _num(mpp) or mpp <= 0:
        err("terrain.metresPerPixel", f"must be a positive number, got {mpp!r}")
    px = terrain.get("heightmapPixels")
    if _pair(px) and _num(mpp) and mpp > 0:
        implied = size[0] / px[0] if px[0] else 0
        if implied and abs(implied - mpp) / mpp > 0.02:
            err("terrain.metresPerPixel",
                f"{mpp} disagrees with sizeMetres/heightmapPixels ({implied:.4f})")

    hs = terrain.get("heightScale")
    if not _num(hs) or hs <= 0:
        err("terrain.heightScale", f"must be a positive number, got {hs!r}")
    elif hs > 5000:
        warn("terrain.heightScale", f"{hs} m of vertical range looks implausible")

    seen_ids: set[str] = set()
    for group in ANCHOR_GROUPS:
        anchors = doc.get(group, [])
        if not isinstance(anchors, list):
            err(group, "must be an array")
            continue
        for i, a in enumerate(anchors):
            path = f"{group}[{i}]"
            if not isinstance(a, dict):
                err(path, "must be an object")
                continue
            aid = a.get("id")
            if not isinstance(aid, str) or not SLUG.match(aid):
                err(f"{path}.id", f"must be a lower-case slug, got {aid!r}")
            elif aid in seen_ids:
                err(f"{path}.id", f"duplicate anchor id {aid!r}")
            else:
                seen_ids.add(aid)
            pos = a.get("posMetres")
            if not _pair(pos):
                err(f"{path}.posMetres", "must be [x, z] numbers in zone-local metres")
                continue
            if not measure.within_bounds((pos[0], 0.0, pos[1]), tuple(size)):
                err(f"{path}.posMetres",
                    f"{pos} falls outside terrain bounds {list(size)}")
            if "elevationMetres" in a and not _num(a["elevationMetres"]):
                err(f"{path}.elevationMetres", "must be a number when present")

    if not doc.get("leystones"):
        warn("leystones", "no leystones — traversal cannot be validated for this zone")
    return issues


def traversal_issues(doc: dict,
                     speed_mps: float = measure.DEFAULT_RUN_SPEED_MPS,
                     band: tuple[float, float] = measure.TRAVERSAL_BAND_S) -> list[Issue]:
    """Acceptance check: adjacent-leystone hops land in the 30-90 s band."""
    leys = doc.get("leystones") or []
    pts = {l["id"]: (l["posMetres"][0], 0.0, l["posMetres"][1])
           for l in leys if isinstance(l, dict) and _pair(l.get("posMetres")) and l.get("id")}
    if len(pts) < 2:
        return []
    pairs = measure.pair_matrix(pts, ratio=1.0, speed_mps=speed_mps, band=band)
    out = []
    for m in measure.nearest_neighbour_pairs(pairs):
        if not m.withinBand:
            side = "under" if m.compressedSeconds < band[0] else "over"
            out.append(Issue("warn", "leystones",
                             f"{m.a}->{m.b} is {m.compressedSeconds}s ({side} the "
                             f"{band[0]:g}-{band[1]:g}s band) at {speed_mps:g} m/s"))
    return out


def validate(doc: dict, check_traversal: bool = True) -> list[Issue]:
    issues = validate_zone(doc)
    if check_traversal and not any(i.severity == "error" for i in issues):
        issues += traversal_issues(doc)
    return issues


def errors(issues: list[Issue]) -> list[Issue]:
    return [i for i in issues if i.severity == "error"]
