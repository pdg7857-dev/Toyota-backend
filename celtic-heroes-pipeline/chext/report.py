"""Stage 4 report assembly (pure)."""
from __future__ import annotations

from . import measure


def zone_report(terrain: dict,
                landmarks: list[dict],
                target_size: tuple[float, float] | None,
                speed_mps: float = measure.DEFAULT_RUN_SPEED_MPS,
                band: tuple[float, float] = measure.TRAVERSAL_BAND_S) -> dict:
    """Everything the zone files need, derived from one terrain + its anchors."""
    original = tuple(terrain["sizeMetres"])
    ratio = measure.compression_ratio(tuple(target_size), original) if target_size else None
    size = [round(original[0] * ratio, 2), round(original[1] * ratio, 2)] if ratio else None
    px = terrain.get("heightmapResolution") or [0, 0]

    leys = {l["name"]: tuple(l["worldPos"]) for l in landmarks
            if l.get("group") == "leystones" and l.get("worldPos")}
    pairs = measure.pair_matrix(leys, ratio or 1.0, speed_mps, band) if len(leys) > 1 else []
    nn = measure.nearest_neighbour_pairs(pairs)

    out = {
        "name": terrain["name"],
        "originalSizeMetres": [round(original[0], 2), round(original[1], 2)],
        "heightmapResolution": px,
        "heightScale": terrain.get("heightScale"),
        "elevationRangeMetres": [terrain.get("minElevationMetres"),
                                 terrain.get("maxElevationMetres")],
        "targetSizeMetres": list(target_size) if target_size else None,
        "compressionRatio": round(ratio, 4) if ratio else None,
        "compressionInBand": measure.in_band(ratio, measure.COMPRESSION_BAND) if ratio else None,
        "compressedSizeMetres": size,
        "metresPerPixel": round(measure.metres_per_pixel(size[0], int(px[0])), 5)
                          if size and px and px[0] else None,
        "leystoneCount": len(leys),
        "pairs": [p.__dict__ for p in pairs],
        "adjacentPairs": [p.__dict__ for p in nn],
        "traversalInBand": all(p.withinBand for p in nn) if nn else None,
        "anchors": [],
        "warnings": [],
    }

    if nn and not out["traversalInBand"]:
        typical = sorted(p.originalMetres for p in nn)[len(nn) // 2]
        suggested = measure.suggest_ratio(original, typical, speed_mps, band)
        out["suggestedRatio"] = suggested
        if suggested:
            out["suggestedTargetSizeMetres"] = [round(original[0] * suggested, 1),
                                                round(original[1] * suggested, 1)]
        out["warnings"].append(
            f"adjacent-leystone traversal misses the {band[0]:g}-{band[1]:g}s band; "
            f"try ratio ~{suggested}")
    if ratio and not out["compressionInBand"]:
        out["warnings"].append(
            f"compression ratio {ratio:.3f} is outside the recommended "
            f"{measure.COMPRESSION_BAND[0]:.0%}-{measure.COMPRESSION_BAND[1]:.0%} band")
    if not measure.plausible_zone_size(original):
        out["warnings"].append(f"original size {list(original)} is implausible; check extraction")

    # Anchor positions normalised to the zone origin (0,0 at the NW corner).
    bounds_min = tuple(terrain.get("worldOriginMetres") or (0.0, 0.0))
    for lm in landmarks:
        pos = lm.get("worldPos")
        if not pos:
            continue
        local = measure.normalise_to_origin(tuple(pos), bounds_min, original)
        inside = measure.within_bounds(local, original)
        out["anchors"].append({
            "name": lm.get("name"),
            "group": lm.get("group"),
            "localMetres": [round(local[0], 2), round(local[1], 2), round(local[2], 2)],
            "compressedMetres": [round(local[0] * ratio, 2), round(local[2] * ratio, 2)]
                                if ratio else None,
            "insideTerrainBounds": inside,
        })
    outside = [a["name"] for a in out["anchors"] if not a["insideTerrainBounds"]]
    if outside:
        out["warnings"].append(
            f"{len(outside)} anchor(s) fall outside terrain bounds "
            f"(e.g. {', '.join(outside[:3])}) — wrong scene, or the terrain has a "
            "non-zero world origin; set worldOriginMetres in config/zone_targets.json")
    return out


def render_markdown(zones_report: list[dict], speed_mps: float) -> str:
    lines = ["# Zone measurement report", "",
             f"Run speed assumed: **{speed_mps:g} m/s**. "
             f"Traversal acceptance band: **{measure.TRAVERSAL_BAND_S[0]:g}-"
             f"{measure.TRAVERSAL_BAND_S[1]:g} s** between adjacent leystones.", ""]
    if not zones_report:
        lines += ["_No terrain measured._", ""]
        return "\n".join(lines)

    lines += ["## Summary", "",
              "| Zone | Original (m) | Target (m) | Ratio | m/px | Elevation (m) | Leystones | Traversal |",
              "|---|---|---|---|---|---|---|---|"]
    for z in zones_report:
        o = z["originalSizeMetres"]
        t = z["compressedSizeMetres"]
        elev = z["elevationRangeMetres"]
        traversal = {True: "in band", False: "OUT OF BAND", None: "n/a"}[z["traversalInBand"]]
        lines.append(
            f"| {z['name']} | {o[0]:g}x{o[1]:g} | "
            f"{f'{t[0]:g}x{t[1]:g}' if t else '—'} | "
            f"{z['compressionRatio'] or '—'} | {z['metresPerPixel'] or '—'} | "
            f"{elev[0]}–{elev[1]} | {z['leystoneCount']} | {traversal} |")
    lines.append("")

    for z in zones_report:
        lines += [f"## {z['name']}", "",
                  f"- Heightmap: {z['heightmapResolution'][0]}x{z['heightmapResolution'][1]} samples",
                  f"- True world size: **{z['originalSizeMetres'][0]:g} x "
                  f"{z['originalSizeMetres'][1]:g} m**",
                  f"- heightScale (m_Scale.y): {z['heightScale']} m",
                  f"- Elevation range: {z['elevationRangeMetres'][0]} to "
                  f"{z['elevationRangeMetres'][1]} m"]
        if z["compressionRatio"]:
            lines += [f"- Target size: {z['targetSizeMetres'][0]:g} x {z['targetSizeMetres'][1]:g} m",
                      f"- **compressionRatio = {z['compressionRatio']}**"
                      f" ({'in' if z['compressionInBand'] else 'OUTSIDE'} the recommended band)",
                      f"- **metresPerPixel = {z['metresPerPixel']}**"]
        lines.append("")

        if z["adjacentPairs"]:
            lines += ["### Adjacent leystone hops", "",
                      "| From | To | Original (m) | Compressed (m) | Original (s) | Compressed (s) | In band |",
                      "|---|---|---|---|---|---|---|"]
            for p in z["adjacentPairs"]:
                lines.append(f"| {p['a']} | {p['b']} | {p['originalMetres']} | "
                             f"{p['compressedMetres']} | {p['originalSeconds']} | "
                             f"{p['compressedSeconds']} | {'yes' if p['withinBand'] else 'NO'} |")
            lines.append("")
        if z["anchors"]:
            lines += ["### Landmarks (zone-local metres, 0,0 = NW corner)", "",
                      "| Name | Group | Local x,y,z | Compressed x,z | In bounds |",
                      "|---|---|---|---|---|"]
            for a in z["anchors"]:
                lm, cm = a["localMetres"], a["compressedMetres"]
                lines.append(f"| {a['name']} | {a['group'] or '—'} | "
                             f"{lm[0]}, {lm[1]}, {lm[2]} | "
                             f"{f'{cm[0]}, {cm[1]}' if cm else '—'} | "
                             f"{'yes' if a['insideTerrainBounds'] else 'NO'} |")
            lines.append("")
        if z["warnings"]:
            lines += ["### Warnings", ""] + [f"- {w}" for w in z["warnings"]] + [""]
    return "\n".join(lines)
