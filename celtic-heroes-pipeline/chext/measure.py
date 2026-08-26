"""Measurement maths: compression, distances, traversal times.

This is where extracted numbers become the numbers the zone files need.
Everything here is pure so it can be checked without a client.
"""
from __future__ import annotations

import dataclasses
import itertools
import math

# Defaults from the map sheet; overridable via config/zone_targets.json.
DEFAULT_RUN_SPEED_MPS = 6.0
TRAVERSAL_BAND_S = (30.0, 90.0)
COMPRESSION_BAND = (0.40, 0.50)


def compression_ratio(target_size: tuple[float, float],
                      original_size: tuple[float, float]) -> float:
    """Uniform scale factor from original world size to target size.

    Averages the two axes so a zone whose aspect ratio differs slightly
    between original and target still gets one ratio — anchors and terrain
    must share a single factor or anchors drift off the mesh.
    """
    ox, oz = original_size
    if ox <= 0 or oz <= 0:
        raise ValueError(f"original size must be positive, got {original_size}")
    return (target_size[0] / ox + target_size[1] / oz) / 2.0


def metres_per_pixel(target_size_x: float, png_width: int) -> float:
    if png_width <= 0:
        raise ValueError("heightmap PNG width must be positive")
    return target_size_x / png_width


def distance_2d(a, b) -> float:
    """Horizontal (XZ) distance. Travel time is governed by ground distance."""
    return math.hypot(a[0] - b[0], a[2] - b[2]) if len(a) > 2 else math.hypot(a[0] - b[0], a[1] - b[1])


def distance_3d(a, b) -> float:
    return math.dist(a[:3], b[:3])


def traversal_seconds(distance_m: float, speed_mps: float = DEFAULT_RUN_SPEED_MPS) -> float:
    if speed_mps <= 0:
        raise ValueError("speed must be positive")
    return distance_m / speed_mps


def in_band(value: float, band: tuple[float, float]) -> bool:
    return band[0] <= value <= band[1]


@dataclasses.dataclass
class PairMeasurement:
    a: str
    b: str
    originalMetres: float
    compressedMetres: float
    originalSeconds: float
    compressedSeconds: float
    withinBand: bool


def pair_matrix(points: dict[str, tuple[float, float, float]],
                ratio: float,
                speed_mps: float = DEFAULT_RUN_SPEED_MPS,
                band: tuple[float, float] = TRAVERSAL_BAND_S) -> list[PairMeasurement]:
    """Straight-line distance and traversal time for every pair of anchors."""
    out: list[PairMeasurement] = []
    for (na, pa), (nb, pb) in itertools.combinations(sorted(points.items()), 2):
        d0 = distance_2d(pa, pb)
        d1 = d0 * ratio
        out.append(PairMeasurement(
            a=na, b=nb,
            originalMetres=round(d0, 2),
            compressedMetres=round(d1, 2),
            originalSeconds=round(traversal_seconds(d0, speed_mps), 1),
            compressedSeconds=round(traversal_seconds(d1, speed_mps), 1),
            withinBand=in_band(traversal_seconds(d1, speed_mps), band),
        ))
    return out


def nearest_neighbour_pairs(measurements: list[PairMeasurement]) -> list[PairMeasurement]:
    """The pair set that actually matters for the acceptance band.

    Every-pair traversal includes corner-to-corner hops that will always
    exceed 90 s; the criterion is about hops between *adjacent* leystones,
    so keep each anchor's nearest neighbour.
    """
    best: dict[str, PairMeasurement] = {}
    for m in measurements:
        for key in (m.a, m.b):
            cur = best.get(key)
            if cur is None or m.compressedMetres < cur.compressedMetres:
                best[key] = m
    seen, out = set(), []
    for m in best.values():
        k = (m.a, m.b)
        if k not in seen:
            seen.add(k)
            out.append(m)
    return sorted(out, key=lambda m: m.compressedMetres)


def suggest_ratio(original_size: tuple[float, float],
                  nn_distance_m: float,
                  speed_mps: float = DEFAULT_RUN_SPEED_MPS,
                  band: tuple[float, float] = TRAVERSAL_BAND_S) -> float | None:
    """Ratio that lands the typical adjacent-leystone hop mid-band.

    Used only to advise when a configured target misses the band.
    """
    if nn_distance_m <= 0:
        return None
    mid_seconds = (band[0] + band[1]) / 2.0
    return round((mid_seconds * speed_mps) / nn_distance_m, 4)


def normalise_to_origin(pos: tuple[float, float, float],
                        bounds_min: tuple[float, float],
                        size: tuple[float, float]) -> tuple[float, float, float]:
    """World XZ -> zone-local metres with (0,0) at the NW corner.

    Unity's +Z runs north, so the NW corner is (minX, maxZ) and the local Z
    axis is flipped to run southward like an image's Y axis.
    """
    lx = pos[0] - bounds_min[0]
    lz = (bounds_min[1] + size[1]) - pos[2]
    return (lx, pos[1], lz)


def within_bounds(pos_local: tuple[float, float, float],
                  size: tuple[float, float],
                  tolerance_m: float = 1.0) -> bool:
    return (-tolerance_m <= pos_local[0] <= size[0] + tolerance_m
            and -tolerance_m <= pos_local[2] <= size[1] + tolerance_m)


def plausible_zone_size(size: tuple[float, float]) -> bool:
    """Acceptance check: hundreds to low thousands of metres, not 1.0 or 1e6."""
    return all(50.0 <= s <= 20000.0 for s in size)
