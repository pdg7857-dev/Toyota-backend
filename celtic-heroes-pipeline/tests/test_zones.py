import pytest

from chext import schema, zones

META = {"name": "Stonevale_Terrain", "sizeMetres": [2000, 1600],
        "heightmapResolution": [513, 513], "heightScale": 120.0}


def build(landmarks, **kw):
    return zones.build_zone("stonevale", "Stonevale", META, (900, 700), landmarks, **kw)


def test_slugify_and_classify():
    assert zones.slugify("LS_04 Leystone!") == "ls_04_leystone"
    assert zones.slugify("") == "anchor"
    assert zones.classify("Leystone_North") == "leystones"
    assert zones.classify("Boss_Drake_Spawn") == "bossAnchors"
    assert zones.classify("Portal_Exit") == "portals"
    assert zones.classify("Rock_Decor_12") is None


def test_emitted_zone_passes_the_validator():
    doc = build([{"name": "Leystone_North", "worldPos": [100, 10, 1500]},
                 {"name": "Leystone_Mid", "worldPos": [400, 10, 1200]}])
    assert schema.errors(schema.validate(doc)) == []


def test_terrain_and_anchors_share_one_ratio():
    """An anchor on the terrain's far corner must land on the compressed edge.

    This is the invariant that matters: scale terrain and anchors by
    different factors and anchors drift off the mesh.
    """
    doc = build([{"name": "Leystone_NE", "worldPos": [2000, 0, 1600]},
                 {"name": "Leystone_SW", "worldPos": [0, 0, 0]}])
    size = doc["terrain"]["sizeMetres"]
    by_id = {a["sourceName"]: a["posMetres"] for a in doc["leystones"]}
    assert by_id["Leystone_NE"] == pytest.approx([size[0], 0.0], abs=0.01)
    assert by_id["Leystone_SW"] == pytest.approx([0.0, size[1]], abs=0.01)


def test_every_anchor_lands_inside_the_compressed_bounds():
    corners = [{"name": f"Leystone_{i}", "worldPos": p} for i, p in enumerate(
        [[0, 0, 0], [2000, 0, 0], [0, 0, 1600], [2000, 0, 1600], [1000, 0, 800]])]
    doc = build(corners)
    size = doc["terrain"]["sizeMetres"]
    for a in doc["leystones"]:
        assert 0 <= a["posMetres"][0] <= size[0] + 0.01
        assert 0 <= a["posMetres"][1] <= size[1] + 0.01


def test_metres_per_pixel_matches_size_over_pixels():
    doc = build([])
    t = doc["terrain"]
    assert t["metresPerPixel"] == pytest.approx(t["sizeMetres"][0] / t["heightmapPixels"][0],
                                                abs=1e-5)


def test_vertical_is_not_compressed_by_default_so_anchors_stay_on_the_mesh():
    """heightScale passes through unscaled, so anchor Y must too."""
    doc = build([{"name": "Leystone_A", "worldPos": [100, 60, 1500]}])
    assert doc["terrain"]["heightScale"] == 120.0
    assert doc["leystones"][0]["elevationMetres"] == 60.0


def test_uniform_vertical_compression_keeps_the_same_normalised_height():
    lm = [{"name": "Leystone_A", "worldPos": [100, 60, 1500]}]
    flat = build(lm)
    uniform = build(lm, compress_vertical=True)
    ratio_flat = flat["leystones"][0]["elevationMetres"] / flat["terrain"]["heightScale"]
    ratio_uni = uniform["leystones"][0]["elevationMetres"] / uniform["terrain"]["heightScale"]
    assert ratio_flat == pytest.approx(ratio_uni, abs=1e-3)
    assert uniform["terrain"]["heightScale"] < 120.0


def test_duplicate_names_get_unique_ids():
    doc = build([{"name": "Leystone", "worldPos": [10, 0, 10]},
                 {"name": "Leystone", "worldPos": [20, 0, 20]}])
    ids = [a["id"] for a in doc["leystones"]]
    assert len(set(ids)) == 2


def test_unclassified_landmarks_are_counted_not_emitted():
    doc = build([{"name": "Rock_Decor_12", "worldPos": [10, 0, 10]}])
    assert doc["source"]["unclassifiedLandmarks"] == 1
    assert doc["leystones"] == []


def test_merge_preserves_hand_authored_portals():
    existing = {"portals": [{"id": "portal_lir", "posMetres": [10, 10]}], "notes": "by hand"}
    generated = build([])
    merged = zones.merge_preserving(existing, generated)
    assert merged["portals"] == existing["portals"]
    assert merged["notes"] == "by hand"
