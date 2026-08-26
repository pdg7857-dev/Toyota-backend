from chext import targets

CFG = {"stonevale": {"targetSizeMetres": [900, 700]},
       "lir": {"targetSizeMetres": [600, 600], "terrainNames": ["TER_lir_main_01"]}}


def test_exact_zone_id_wins():
    entry, how = targets.match("stonevale", CFG)
    assert entry["targetSizeMetres"] == [900, 700] and how == "exact"


def test_explicit_terrain_name_alias():
    entry, how = targets.match("TER_lir_main_01", CFG)
    assert entry["targetSizeMetres"] == [600, 600] and how == "terrainNames alias"


def test_artist_decoration_is_stripped_so_the_obvious_config_works():
    """'Stonevale_Terrain' must find the 'stonevale' entry without an alias."""
    entry, how = targets.match("Stonevale_Terrain", CFG)
    assert entry["targetSizeMetres"] == [900, 700]
    assert how in ("slug", "canonical name")


def test_prefix_and_trailing_index_are_stripped():
    assert targets.canonical("TER_stonevale_01") == "stonevale"
    assert targets.canonical("Stonevale_Terrain") == "stonevale"
    assert targets.canonical("stonevale") == "stonevale"


def test_explicit_zone_id_beats_name_matching():
    entry, how = targets.match("Anything_At_All", CFG, zone_id="lir")
    assert entry["targetSizeMetres"] == [600, 600] and how == "zoneId"


def test_unmatched_returns_none_rather_than_guessing():
    entry, how = targets.match("Gustav_Woods_Terrain", CFG)
    assert entry is None and how == "unmatched"


def test_target_size_handles_missing_and_malformed_entries():
    assert targets.target_size(None) is None
    assert targets.target_size({}) is None
    assert targets.target_size({"targetSizeMetres": [900]}) is None
    assert targets.target_size({"targetSizeMetres": [900, 700]}) == (900, 700)
