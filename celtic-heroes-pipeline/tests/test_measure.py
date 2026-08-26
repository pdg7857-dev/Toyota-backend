import pytest

from chext import measure


def test_spec_worked_example_lands_in_the_recommended_band():
    """Spec §6: 2000x1600 -> 900x700 is 'right in the recommended 40-50% band'."""
    ratio = measure.compression_ratio((900, 700), (2000, 1600))
    assert ratio == pytest.approx(0.4437, abs=1e-4)
    assert measure.in_band(ratio, measure.COMPRESSION_BAND)


def test_metres_per_pixel_divides_target_by_png_width():
    assert measure.metres_per_pixel(900, 512) == pytest.approx(1.7578, abs=1e-4)
    with pytest.raises(ValueError):
        measure.metres_per_pixel(900, 0)


def test_traversal_time_uses_horizontal_distance_only():
    a, b = (0, 1000, 0), (60, 0, 0)   # 1000 m of elevation must not count
    assert measure.distance_2d(a, b) == pytest.approx(60.0)
    assert measure.traversal_seconds(measure.distance_2d(a, b)) == pytest.approx(10.0)


def test_nearest_neighbour_ignores_corner_to_corner_hops():
    pts = {"a": (0, 0, 0), "b": (300, 0, 0), "c": (600, 0, 0)}
    pairs = measure.pair_matrix(pts, ratio=1.0)
    nn = measure.nearest_neighbour_pairs(pairs)
    assert all(p.compressedMetres == 300 for p in nn)
    assert ("a", "c") not in [(p.a, p.b) for p in nn]


def test_pairs_report_both_original_and_compressed_times():
    pts = {"a": (0, 0, 0), "b": (900, 0, 0)}
    p = measure.pair_matrix(pts, ratio=0.5)[0]
    assert p.originalMetres == 900
    assert p.compressedMetres == 450
    assert p.originalSeconds == 150.0
    assert p.compressedSeconds == 75.0
    assert p.withinBand


def test_suggest_ratio_targets_the_middle_of_the_band():
    r = measure.suggest_ratio((2000, 1600), nn_distance_m=1000)
    assert r == pytest.approx(0.36, abs=1e-3)      # 60 s * 6 m/s / 1000 m
    assert measure.traversal_seconds(1000 * r) == pytest.approx(60.0, abs=0.1)


def test_normalise_to_origin_puts_zero_at_the_north_west_corner():
    # Unity +Z is north, so local z runs southward like an image's y axis.
    assert measure.normalise_to_origin((0, 0, 700), (0, 0), (900, 700)) == (0, 0, 0)
    assert measure.normalise_to_origin((900, 0, 0), (0, 0), (900, 700)) == (900, 0, 700)


def test_within_bounds_allows_a_small_tolerance():
    assert measure.within_bounds((900.5, 0, 700.5), (900, 700))
    assert not measure.within_bounds((950, 0, 100), (900, 700))


def test_plausible_zone_size_rejects_the_acceptance_criteria_failures():
    assert measure.plausible_zone_size((900, 700))
    assert not measure.plausible_zone_size((1.0, 1.0))
    assert not measure.plausible_zone_size((1e6, 1e6))


def test_compression_ratio_rejects_a_degenerate_original():
    with pytest.raises(ValueError):
        measure.compression_ratio((900, 700), (0, 1600))
