"""Heightmap decoding.

The spec's draft assumed `m_Heights` is float 0..1. In practice Unity
serialises TerrainData heights as a packed 16-bit integer array, and the
encoding differs by Unity version:

  * SInt16 0..32767   -- the common case (0x7FFF is full height)
  * UInt16 0..65535   -- some newer versions
  * float   0..1      -- what you get from a typetree that already normalised

Feeding raw int16 into `np.clip(h, 0, 1)` would flatten every zone to a solid
white plate, so the encoding is detected rather than assumed.
"""
from __future__ import annotations

import dataclasses
import math

import numpy as np

INT16_FULL = 32767.0
UINT16_FULL = 65535.0


@dataclasses.dataclass
class HeightField:
    heights: np.ndarray          # float32, normalised 0..1, shape (h, w)
    encoding: str                # "float01" | "sint16" | "uint16"
    resolution: tuple[int, int]  # (width, height) in samples
    notes: list[str] = dataclasses.field(default_factory=list)


def detect_encoding(values: np.ndarray) -> str:
    """Classify a raw height array by its value range."""
    if values.size == 0:
        return "float01"
    vmax = float(np.nanmax(values))
    vmin = float(np.nanmin(values))
    if np.issubdtype(values.dtype, np.floating) and vmax <= 1.0 + 1e-6 and vmin >= -1e-6:
        return "float01"
    if vmax > INT16_FULL:
        return "uint16"
    if vmax > 1.0 + 1e-6:
        return "sint16"
    return "float01"


def normalise(values: np.ndarray, encoding: str) -> np.ndarray:
    divisor = {"float01": 1.0, "sint16": INT16_FULL, "uint16": UINT16_FULL}[encoding]
    return np.clip(values.astype(np.float32) / divisor, 0.0, 1.0)


def decode(raw, width: int, height: int) -> HeightField:
    """Turn a serialised m_Heights blob into a normalised 2-D field.

    `raw` may be a list of numbers, a numpy array, or raw bytes (typetrees
    sometimes hand back a byte blob for the packed int16 vector).
    """
    notes: list[str] = []

    if isinstance(raw, (bytes, bytearray, memoryview)):
        values = np.frombuffer(bytes(raw), dtype="<i2").astype(np.float32)
        notes.append("m_Heights arrived as a byte blob; read as little-endian int16")
    else:
        values = np.asarray(raw)
        if values.dtype == object:
            values = values.astype(np.float32)

    encoding = detect_encoding(values)
    flat = normalise(values.ravel(), encoding)

    expected = int(width) * int(height)
    if expected <= 0:
        raise ValueError(f"invalid heightmap resolution {width}x{height}")
    if flat.size != expected:
        notes.append(f"height count {flat.size} != {width}x{height}={expected}; padded/truncated")
        fitted = np.zeros(expected, dtype=np.float32)
        fitted[: min(flat.size, expected)] = flat[:expected]
        flat = fitted

    return HeightField(
        heights=flat.reshape((int(height), int(width))),
        encoding=encoding,
        resolution=(int(width), int(height)),
        notes=notes,
    )


def to_png16(field: HeightField) -> np.ndarray:
    """Normalised field -> uint16 array ready for PIL mode 'I;16'."""
    return (np.clip(field.heights, 0.0, 1.0) * 65535.0).round().astype(np.uint16)


def resolution_from_tree(hm: dict) -> tuple[int, int]:
    """Heightmap resolution, tolerating the m_Width/m_Height vs m_Resolution split.

    Older Unity carries m_Width and m_Height; newer carries a single square
    m_Resolution and may leave the other two at zero.
    """
    w = int(hm.get("m_Width") or 0)
    h = int(hm.get("m_Height") or 0)
    if w > 0 and h > 0:
        return w, h
    res = int(hm.get("m_Resolution") or 0)
    if res > 0:
        return res, res
    # Last resort: infer a square field from the sample count.
    heights = hm.get("m_Heights") or []
    n = len(heights) if not isinstance(heights, (bytes, bytearray)) else len(heights) // 2
    side = int(math.isqrt(n))
    if side > 0 and side * side == n:
        return side, side
    raise ValueError("cannot determine heightmap resolution")


def world_size(scale: dict, width: int, height: int) -> tuple[float, float]:
    """Terrain footprint in metres.

    Unity stores per-cell scale, so the span is scale * (samples - 1); using
    `samples` instead overstates a 513-sample zone by one cell.
    """
    return (float(scale["x"]) * (width - 1), float(scale["z"]) * (height - 1))
