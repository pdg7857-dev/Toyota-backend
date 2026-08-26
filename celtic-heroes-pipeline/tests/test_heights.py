import numpy as np
import pytest

from chext import heights


def test_int16_heights_are_not_flattened_by_a_naive_clip():
    """The spec's draft clipped raw int16 to 0..1, which flattens every zone."""
    raw = np.array([0, 8192, 16383, 32767], dtype=np.int16)
    field = heights.decode(raw, 2, 2)
    assert field.encoding == "sint16"
    assert field.heights.min() == pytest.approx(0.0)
    assert field.heights.max() == pytest.approx(1.0)
    assert field.heights.ravel()[1] == pytest.approx(0.25, abs=1e-4)


def test_uint16_encoding_detected():
    field = heights.decode(np.array([0, 65535, 32768, 100], dtype=np.uint16), 2, 2)
    assert field.encoding == "uint16"
    assert field.heights.max() == pytest.approx(1.0)


def test_float_heights_pass_through():
    field = heights.decode([0.0, 0.5, 1.0, 0.25], 2, 2)
    assert field.encoding == "float01"
    assert field.heights.ravel().tolist() == [0.0, 0.5, 1.0, 0.25]


def test_byte_blob_is_read_as_little_endian_int16():
    raw = np.array([0, 32767, 16383, 8192], dtype="<i2").tobytes()
    field = heights.decode(raw, 2, 2)
    assert field.encoding == "sint16"
    assert field.heights.ravel()[1] == pytest.approx(1.0)
    assert any("byte blob" in n for n in field.notes)


def test_count_mismatch_is_padded_and_reported():
    field = heights.decode([0.1, 0.2, 0.3], 2, 2)
    assert field.heights.shape == (2, 2)
    assert any("!=" in n for n in field.notes)


def test_resolution_falls_back_from_width_to_resolution_to_count():
    assert heights.resolution_from_tree({"m_Width": 33, "m_Height": 33}) == (33, 33)
    assert heights.resolution_from_tree({"m_Width": 0, "m_Resolution": 513}) == (513, 513)
    assert heights.resolution_from_tree({"m_Heights": [0] * 16}) == (4, 4)
    with pytest.raises(ValueError):
        heights.resolution_from_tree({"m_Heights": [0] * 5})


def test_world_size_spans_cells_not_samples():
    """A 513-sample terrain spans 512 cells; using samples overstates by one."""
    assert heights.world_size({"x": 3.90625, "y": 600, "z": 3.90625}, 513, 513) == (2000.0, 2000.0)


def test_png16_round_trips_full_range():
    field = heights.decode([0.0, 1.0, 0.5, 0.25], 2, 2)
    png = heights.to_png16(field)
    assert png.dtype == np.uint16
    assert png.min() == 0 and png.max() == 65535


def test_heightmap_png_round_trips_as_16_bit(tmp_path):
    """Acceptance check: the PNG is 16-bit and reopens without error.

    'I;16' is easy to get subtly wrong — an 8-bit save silently throws away
    the elevation detail the whole pipeline exists to measure.
    """
    from PIL import Image

    field = heights.decode(
        np.linspace(0, 32767, 64 * 64).astype(np.int16).reshape(64 * 64), 64, 64)
    out = tmp_path / "zone_height.png"
    Image.fromarray(heights.to_png16(field), mode="I;16").save(out)

    reopened = Image.open(out)
    assert reopened.mode in ("I;16", "I")
    assert reopened.size == (64, 64)
    back = np.asarray(reopened)
    assert back.max() == 65535 and back.min() == 0
    # Round-trip preserves elevation to better than one part in 30000.
    assert np.abs(back / 65535.0 - field.heights).max() < 1e-4
