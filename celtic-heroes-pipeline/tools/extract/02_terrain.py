#!/usr/bin/env python3
"""Stage 2 — Terrain heightmaps.

Produces the single most useful artefact: the true world size of each zone.

Usage: python tools/extract/02_terrain.py [--force] [--no-splat]
"""
from __future__ import annotations

import argparse
import pathlib
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from chext import gate, heights, io_utils, measure, paths, unity  # noqa: E402


def save_splat(splat, name: str) -> str | None:
    """Write the splat/alphamap as a PNG; it maps onto the zone regionMask."""
    if not splat:
        return None
    textures = splat.get("m_AlphaTextures") if isinstance(splat, dict) else \
        getattr(splat, "m_AlphaTextures", None)
    if not textures:
        return None
    for i, ptr in enumerate(textures):
        try:
            tex = ptr.read() if hasattr(ptr, "read") else ptr.deref_parse_as_object()
            img = tex.image
        except Exception:
            continue
        out = paths.TERRAIN / f"{name}_splat{i}.png"
        img.save(out)
        return out.name
    return None


def main() -> None:
    ap = argparse.ArgumentParser(description="Stage 2 — extract terrain heightmaps")
    ap.add_argument("--force", action="store_true", help="run despite a blocked probe verdict")
    ap.add_argument("--no-splat", action="store_true", help="skip splat/alphamap export")
    args = ap.parse_args()

    io_utils.stage_header(2, "Terrain heightmaps")
    gate.require_probe_ok(force=args.force)
    paths.ensure_dirs()

    meta: list[dict] = []
    seen: set[str] = set()

    for f in unity.loadable_files(paths.RAW):
        env = unity.safe_load(f)
        if env is None:
            continue
        source = str(f.relative_to(paths.RAW))
        for rec in unity.terrain_records(env, source):
            name = str(rec["name"])
            if name in seen:  # the same TerrainData can appear in several containers
                continue
            hm = rec["heightmap"]
            try:
                w, h = heights.resolution_from_tree(hm)
                field = heights.decode(hm.get("m_Heights"), w, h)
            except Exception as e:
                io_utils.warn(f"{name}: unreadable heightmap ({e})")
                continue
            seen.add(name)

            scale = hm.get("m_Scale")
            scale = scale if isinstance(scale, dict) else \
                {k: getattr(scale, k, 0.0) for k in ("x", "y", "z")}
            size = heights.world_size(scale, w, h)

            png_path = paths.TERRAIN / f"{name}_height.png"
            Image.fromarray(heights.to_png16(field), mode="I;16").save(png_path)

            splat_name = None if args.no_splat else save_splat(rec["splat"], name)

            entry = {
                "name": name,
                "source": source,
                "heightmap": png_path.name,
                "splatmap": splat_name,
                "heightmapResolution": [w, h],
                "sizeMetres": [round(size[0], 2), round(size[1], 2)],
                "heightScale": round(float(scale["y"]), 3),
                "metresPerPixelOriginal": round(float(scale["x"]), 4),
                "minHeightNorm": round(float(np.min(field.heights)), 5),
                "maxHeightNorm": round(float(np.max(field.heights)), 5),
                "minElevationMetres": round(float(np.min(field.heights)) * float(scale["y"]), 2),
                "maxElevationMetres": round(float(np.max(field.heights)) * float(scale["y"]), 2),
                "heightEncoding": field.encoding,
                "notes": field.notes,
            }
            if not measure.plausible_zone_size(tuple(entry["sizeMetres"])):
                entry["notes"] = entry["notes"] + [
                    f"implausible sizeMetres {entry['sizeMetres']} — check m_Scale parsing"]
                io_utils.warn(f"{name}: implausible size {entry['sizeMetres']}")
            meta.append(entry)
            io_utils.info(f"  {name}: {entry['sizeMetres'][0]}x{entry['sizeMetres'][1]} m "
                          f"@ {w}x{h} ({field.encoding})")

    io_utils.stage_footer([io_utils.write_json(paths.TERRAIN_META, meta)])
    if not meta:
        print("\n  ! No TerrainData found. See README 'Fallbacks'.")
        sys.exit(3)
    print(f"\n  {len(meta)} terrain(s). Heightmap PNGs in {paths.rel(paths.TERRAIN)} "
          "(gitignored — they stay local).")


if __name__ == "__main__":
    sys.exit(gate.run_guarded(main))
