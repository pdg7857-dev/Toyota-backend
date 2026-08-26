import copy

from chext import schema

GOOD = {
    "id": "stonevale", "name": "Stonevale",
    "terrain": {"sizeMetres": [900, 700], "heightmapPixels": [512, 512],
                "metresPerPixel": 1.7578, "heightScale": 120.0},
    "leystones": [{"id": "ley_a", "posMetres": [100, 100]},
                  {"id": "ley_b", "posMetres": [400, 300]}],
}


def issues_for(mutate):
    doc = copy.deepcopy(GOOD)
    mutate(doc)
    return schema.validate(doc)


def test_a_good_document_is_clean():
    assert schema.validate(copy.deepcopy(GOOD)) == []


def test_anchor_outside_terrain_bounds_is_an_error():
    out = issues_for(lambda d: d["leystones"].append({"id": "ley_c", "posMetres": [9999, 5]}))
    assert any("outside terrain bounds" in i.message for i in schema.errors(out))


def test_duplicate_anchor_ids_are_an_error():
    out = issues_for(lambda d: d["leystones"].append({"id": "ley_a", "posMetres": [10, 10]}))
    assert any("duplicate" in i.message for i in schema.errors(out))


def test_metres_per_pixel_must_agree_with_size_over_pixels():
    out = issues_for(lambda d: d["terrain"].update(metresPerPixel=99.0))
    assert any("disagrees" in i.message for i in schema.errors(out))


def test_implausible_size_warns_but_does_not_fail():
    def shrink(d):
        d["terrain"].update(sizeMetres=[1.0, 1.0], heightmapPixels=[1, 1], metresPerPixel=1.0)
        d["leystones"] = []      # anchors would legitimately fall outside a 1x1 m zone
    out = issues_for(shrink)
    assert schema.errors(out) == []
    assert any("plausible" in i.message for i in out)


def test_non_positive_size_is_a_hard_error():
    assert schema.errors(issues_for(lambda d: d["terrain"].update(sizeMetres=[0, 700])))


def test_missing_terrain_block_is_an_error():
    assert schema.errors(issues_for(lambda d: d.pop("terrain")))


def test_bad_slug_ids_are_rejected():
    assert schema.errors(issues_for(lambda d: d.update(id="Stone Vale")))


def test_traversal_outside_the_band_warns():
    doc = copy.deepcopy(GOOD)
    doc["leystones"] = [{"id": "ley_a", "posMetres": [0, 0]},
                        {"id": "ley_b", "posMetres": [890, 690]}]  # ~1100 m -> 185 s
    warns = [i for i in schema.validate(doc) if i.severity == "warn"]
    assert any("30-90s band" in i.message for i in warns)


def test_traversal_inside_the_band_is_silent():
    doc = copy.deepcopy(GOOD)
    doc["leystones"] = [{"id": "ley_a", "posMetres": [100, 100]},
                        {"id": "ley_b", "posMetres": [400, 100]}]  # 300 m -> 50 s
    assert schema.validate(doc) == []


def test_zone_with_no_leystones_warns_about_unverifiable_traversal():
    out = issues_for(lambda d: d.update(leystones=[]))
    assert any("traversal cannot be validated" in i.message for i in out)
