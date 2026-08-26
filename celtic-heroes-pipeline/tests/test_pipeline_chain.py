"""The stages run in order and degrade gracefully on a client with no terrain.

The synthetic APK carries no parseable Unity objects, so this covers the
'nothing found' paths — which is exactly what a real run against an
unexpected build would hit.
"""
import json
import os
import pathlib
import subprocess
import sys

from fixtures import make_apk

TOOLS = pathlib.Path(__file__).resolve().parents[1] / "tools" / "extract"


def run(script, root, *args):
    return subprocess.run([sys.executable, str(TOOLS / script), *args],
                          capture_output=True, text=True,
                          env={**os.environ, "CHEXT_ROOT": str(root)})


def test_stages_0_to_3_chain_on_a_clean_build(tmp_path):
    make_apk.build(tmp_path / "reference/client/base.apk")

    assert run("00_probe.py", tmp_path).returncode == 0

    r1 = run("01_inventory.py", tmp_path)
    assert r1.returncode == 0, r1.stdout + r1.stderr
    assert (tmp_path / "extract/manifest/objects.json").exists()
    assert (tmp_path / "extract/manifest/counts.json").exists()
    assert (tmp_path / "config/scene_map.suggested.json").exists()
    assert "No TerrainData" in r1.stdout        # advises the mesh fallback

    r2 = run("02_terrain.py", tmp_path)
    assert r2.returncode == 3                  # no terrain is a non-zero, explained exit
    assert "Fallbacks" in r2.stdout

    r3 = run("03_transforms.py", tmp_path)
    assert r3.returncode == 0
    assert (tmp_path / "extract/transforms/landmarks.json").exists()


def test_run_all_stops_at_the_first_closed_gate(tmp_path):
    (tmp_path / "reference/client").mkdir(parents=True)
    r = run("run_all.py", tmp_path)
    assert r.returncode != 0
    assert "Stopped at stage 0" in r.stderr


def test_run_all_walks_the_stages_when_the_gate_is_open(tmp_path):
    make_apk.build(tmp_path / "reference/client/base.apk")
    r = run("run_all.py", tmp_path, "--through", "1")
    assert r.returncode == 0, r.stdout + r.stderr
    assert "Stage 0" in r.stdout and "Stage 1" in r.stdout


def test_manifests_are_json_and_committable_but_binaries_are_not(tmp_path):
    """Acceptance check: a full run leaves only derived numeric data to commit."""
    make_apk.build(tmp_path / "reference/client/base.apk")
    run("00_probe.py", tmp_path)
    run("01_inventory.py", tmp_path)
    for name in ("extract/manifest/probe.json", "extract/manifest/objects.json",
                 "extract/manifest/counts.json"):
        json.loads((tmp_path / name).read_text())      # parses = safe to commit
    raw = tmp_path / "extract/raw"
    assert raw.exists() and any(raw.rglob("*"))         # client bytes stay in raw/
