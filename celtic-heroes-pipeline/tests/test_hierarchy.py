import math

import pytest

from chext.hierarchy import TransformRecord, compose, depth_of, quat_rotate, resolve

Y90 = (0.0, math.sin(math.radians(45)), 0.0, math.cos(math.radians(45)))


def approx(v):
    return pytest.approx(v, abs=1e-6)


def test_quat_rotate_maps_x_to_negative_z_for_a_90_degree_yaw():
    assert quat_rotate(Y90, (1.0, 0.0, 0.0)) == approx((0.0, 0.0, -1.0))


def test_nested_child_uses_parent_rotation_and_scale():
    recs = {
        1: TransformRecord(1, None, (100, 0, 100), Y90, (2, 2, 2)),
        2: TransformRecord(2, 1, (10, 0, 0)),
    }
    world, warnings = resolve(recs)
    # local x=10, parent scale 2 -> 20, yawed 90deg -> -z
    assert world[2] == approx((100.0, 0.0, 80.0))
    assert warnings == []


def test_grandchild_composes_the_whole_chain():
    recs = {
        1: TransformRecord(1, None, (100, 0, 100), Y90, (2, 2, 2)),
        2: TransformRecord(2, 1, (10, 0, 0)),
        3: TransformRecord(3, 2, (0, 0, 5)),
    }
    world, _ = resolve(recs)
    assert world[3] == approx((110.0, 0.0, 80.0))


def test_flat_local_position_would_be_wrong():
    """The whole reason this module exists."""
    recs = {
        1: TransformRecord(1, None, (500, 0, 500)),
        2: TransformRecord(2, 1, (10, 0, 10), name="Leystone_A"),
    }
    world, _ = resolve(recs)
    assert world[2] == approx((510.0, 0.0, 510.0))
    assert world[2] != recs[2].local_pos


def test_missing_parent_is_reported_not_silently_rooted():
    recs = {9: TransformRecord(9, 77, (5, 0, 5))}
    world, warnings = resolve(recs)
    assert world[9] == (5, 0, 5)
    assert any("unresolved" in w for w in warnings)


def test_parent_cycle_is_broken_and_reported():
    recs = {
        1: TransformRecord(1, 2, (1, 0, 0)),
        2: TransformRecord(2, 1, (0, 0, 1)),
    }
    world, warnings = resolve(recs)
    assert len(world) == 2
    assert any("cycle" in w for w in warnings)


def test_deep_chain_does_not_hit_the_recursion_limit():
    depth = 5000
    recs = {0: TransformRecord(0, None, (0, 0, 0))}
    for i in range(1, depth):
        recs[i] = TransformRecord(i, i - 1, (1, 0, 0))
    world, _ = resolve(recs)
    assert world[depth - 1] == approx((float(depth - 1), 0.0, 0.0))


def test_depth_of_counts_ancestors():
    recs = {
        1: TransformRecord(1, None),
        2: TransformRecord(2, 1),
        3: TransformRecord(3, 2),
    }
    assert depth_of(recs, 1) == 0
    assert depth_of(recs, 3) == 2


def test_compose_scales_before_rotating():
    pos, rot, scale = compose((0, 0, 0), Y90, (3, 1, 1), (2, 0, 0), (0, 0, 0, 1), (1, 1, 1))
    assert pos == approx((0.0, 0.0, -6.0))
    assert scale == (3, 1, 1)
