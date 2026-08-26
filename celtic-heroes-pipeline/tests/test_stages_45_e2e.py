"""Stages 4 and 5 end-to-end, fed synthetic Stage 2/3 output.

This exercises the real CLI scripts and the real file contract between
stages without needing a game client.
"""
import json
import os
import pathlib
import subprocess
import sys

import pytest

TOOLS = pathlib.Path(__file__).resolve().parents[1] / "tools" / "extract"

TERRAIN_META = [{
    "name": "Stonevale_Terrain", "source": "assets/bin/Data/level3",
    "heightmap": "Stonevale_Terrain_height.png", "splatmap": None,
    "heightmapResolution": [513, 513], "sizeMetres": [2000, 1600],
    "heightScale": 120.0, "metresPerPixelOriginal": 3.9063,
    "minHeightNorm": 0.0, "maxHeightNorm": 0.75,
    "minElevationMetres": 0.0, "maxElevationMetres": 90.0,
    "heightEncoding": "sint16", "notes": [],
}]

LANDMARKS = {"landmarks": [
    {"scene": "assets/bin/Data/level3", "name": "Leystone_North",
     "worldPos": [400, 20, 1300], "group": "leystones", "depth": 1},
    {"scene": "assets/bin/Data/level3", "name": "Leystone_Mid",
     "worldPos": [900, 25, 900], "group": "leystones", "depth": 1},
    {"scene": "assets/bin/Data/level3", "name": "Leystone_South",
     "worldPos": [1400, 18, 500], "group": "leystones", "depth": 2},
    {"scene": "assets/bin/Data/level3", "name": "Boss_Drake_Anchor",
     "worldPos": [1000, 30, 800], "group": "bossAnchors", "depth": 1},
    {"scene": "assets/bin/Data/level3", "name": "Rock_Decor_12",
     "worldPos": [10, 0, 10], "group": None, "depth": 0},
]}


def run_stage(script, root, *args):
    env = {**os.environ, "CHEXT_ROOT": str(root)}
    return subprocess.run([sys.executable, str(TOOLS / script), *args],
                          capture_output=True, text=True, env=env)


@pytest.fixture
def staged(tmp_path):
    for sub in ("extract/measurements", "extract/transforms", "config",
                "content/zones/generated"):
        (tmp_path / sub).mkdir(parents=True, exist_ok=True)
    (tmp_path / "extract/measurements/terrain_meta.json").write_text(json.dumps(TERRAIN_META))
    (tmp_path / "extract/transforms/landmarks.json").write_text(json.dumps(LANDMARKS))
    (tmp_path / "config/zone_targets.json").write_text(json.dumps({
        "zones": {"stonevale": {"targetSizeMetres": [900, 700],
                                "terrainNames": ["Stonevale_Terrain"]}}}))
    (tmp_path / "config/scene_map.json").write_text(json.dumps({
        "assets/bin/Data/level3": {"zoneId": "stonevale", "zoneName": "Stonevale",
                                   "terrainNames": ["Stonevale_Terrain"], "confirmed": True}}))
    return tmp_path


def test_stage4_produces_the_measurement_report(staged):
    r = run_stage("04_measure.py", staged)
    assert r.returncode == 0, r.stdout + r.stderr
    report = json.loads((staged / "extract/measurements/report.json").read_text())
    z = report["zones"][0]
    assert z["originalSizeMetres"] == [2000, 1600]
    assert z["compressionRatio"] == pytest.approx(0.4437, abs=1e-3)
    assert z["compressionInBand"] is True
    assert z["compressedSizeMetres"] == pytest.approx([887.5, 710.0], abs=0.1)
    assert z["metresPerPixel"] == pytest.approx(887.5 / 513, abs=1e-4)
    assert z["leystoneCount"] == 3
    md = (staged / "extract/measurements/report.md").read_text()
    assert "Stonevale_Terrain" in md and "compressionRatio" in md


def test_stage4_traversal_lands_in_the_acceptance_band(staged):
    run_stage("04_measure.py", staged)
    z = json.loads((staged / "extract/measurements/report.json").read_text())["zones"][0]
    # ~640 m apart originally -> ~284 m compressed -> ~47 s at 6 m/s
    assert z["traversalInBand"] is True
    for p in z["adjacentPairs"]:
        assert 30 <= p["compressedSeconds"] <= 90


def test_stage4_flags_a_zone_whose_compression_misses_the_band(staged):
    (staged / "config/zone_targets.json").write_text(json.dumps({
        "zones": {"stonevale": {"targetSizeMetres": [1900, 1520]}}}))   # barely compressed
    run_stage("04_measure.py", staged)
    z = json.loads((staged / "extract/measurements/report.json").read_text())["zones"][0]
    assert z["compressionInBand"] is False
    assert z["traversalInBand"] is False
    assert z["suggestedRatio"] is not None
    assert any("band" in w for w in z["warnings"])


def test_stage4_reports_unconfigured_zones_instead_of_guessing(staged):
    (staged / "config/zone_targets.json").write_text(json.dumps({"zones": {}}))
    r = run_stage("04_measure.py", staged)
    assert r.returncode == 0
    z = json.loads((staged / "extract/measurements/report.json").read_text())["zones"][0]
    assert z["compressionRatio"] is None
    assert any("no target size configured" in w for w in z["warnings"])


def test_stage4_flags_anchors_outside_terrain_bounds(staged):
    doc = json.loads((staged / "extract/transforms/landmarks.json").read_text())
    doc["landmarks"].append({"scene": "assets/bin/Data/level3", "name": "Leystone_Strayed",
                             "worldPos": [9999, 0, 9999], "group": "leystones"})
    (staged / "extract/transforms/landmarks.json").write_text(json.dumps(doc))
    run_stage("04_measure.py", staged)
    z = json.loads((staged / "extract/measurements/report.json").read_text())["zones"][0]
    assert any("outside terrain bounds" in w for w in z["warnings"])


def test_stage5_emits_a_valid_zone_file(staged):
    r = run_stage("05_emit_zones.py", staged)
    assert r.returncode == 0, r.stdout + r.stderr
    out = staged / "content/zones/generated/stonevale.json"
    assert out.exists()
    doc = json.loads(out.read_text())
    assert doc["id"] == "stonevale"
    assert len(doc["leystones"]) == 3
    assert len(doc["bossAnchors"]) == 1
    assert doc["source"]["unclassifiedLandmarks"] == 1
    v = subprocess.run([sys.executable, str(TOOLS / "validate_zones.py"), str(out)],
                       capture_output=True, text=True, env={**os.environ,
                                                            "CHEXT_ROOT": str(staged)})
    assert v.returncode == 0, v.stdout


def test_stage5_refuses_to_run_without_a_confirmed_scene_map(staged):
    (staged / "config/scene_map.json").unlink()
    r = run_stage("05_emit_zones.py", staged)
    assert r.returncode == 2
    assert "scene_map.json" in r.stderr


def test_stage5_skips_scenes_the_user_has_not_confirmed(staged):
    doc = json.loads((staged / "config/scene_map.json").read_text())
    doc["assets/bin/Data/level3"]["confirmed"] = False
    (staged / "config/scene_map.json").write_text(json.dumps(doc))
    r = run_stage("05_emit_zones.py", staged)
    assert r.returncode == 0
    assert not (staged / "content/zones/generated/stonevale.json").exists()
    assert "not marked confirmed" in r.stderr


def test_stage5_never_overwrites_a_hand_authored_zone_file(staged):
    hand = staged / "content/zones/stonevale.json"
    hand.write_text(json.dumps({"id": "stonevale", "name": "Stonevale",
                                "notes": "hand authored — do not clobber",
                                "terrain": {"sizeMetres": [900, 700], "metresPerPixel": 1.75,
                                            "heightScale": 120.0},
                                "portals": [{"id": "portal_lir", "posMetres": [50, 50]}]}))
    before = hand.read_text()
    r = run_stage("05_emit_zones.py", staged)
    assert r.returncode == 0
    assert hand.read_text() == before
    generated = json.loads((staged / "content/zones/generated/stonevale.json").read_text())
    assert generated["portals"] == [{"id": "portal_lir", "posMetres": [50, 50]}]
    assert generated["notes"] == "hand authored — do not clobber"


def test_stage5_dry_run_writes_nothing(staged):
    r = run_stage("05_emit_zones.py", staged, "--dry-run")
    assert r.returncode == 0
    assert not (staged / "content/zones/generated/stonevale.json").exists()
    assert "dry run" in r.stdout
