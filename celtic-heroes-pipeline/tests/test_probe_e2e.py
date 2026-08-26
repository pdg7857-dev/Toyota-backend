"""Stage 0 end-to-end against synthetic APKs."""
import json
import os
import pathlib
import subprocess
import sys

from fixtures import make_apk

TOOLS = pathlib.Path(__file__).resolve().parents[1] / "tools" / "extract"


def run_stage(script: str, root: pathlib.Path, *args):
    env = {**os.environ, "CHEXT_ROOT": str(root)}
    return subprocess.run([sys.executable, str(TOOLS / script), *args],
                          capture_output=True, text=True, env=env)


def probe_report(root: pathlib.Path) -> dict:
    return json.loads((root / "extract/manifest/probe.json").read_text())


def test_probe_blocks_when_no_client_is_supplied(tmp_path):
    (tmp_path / "reference/client").mkdir(parents=True)
    r = run_stage("00_probe.py", tmp_path)
    assert r.returncode == 2
    assert "no APK found" in r.stderr
    assert not (tmp_path / "extract/manifest/probe.json").exists()


def test_probe_proceeds_on_a_clean_unencrypted_build(tmp_path):
    make_apk.build(tmp_path / "reference/client/base.apk")
    r = run_stage("00_probe.py", tmp_path)
    assert r.returncode == 0, r.stdout + r.stderr
    rep = probe_report(tmp_path)
    assert rep["verdict"] == "proceed"
    assert rep["engine"] == "unity"
    assert rep["unityVersion"] == "2021.3.16f1"
    assert rep["il2cpp"] is True
    assert rep["blockers"] == []
    assert any(v["format"] == "UnityFS" for v in rep["bundleMagics"].values())


def test_probe_blocks_on_encrypted_containers(tmp_path):
    make_apk.build(tmp_path / "reference/client/base.apk", encrypted=True)
    r = run_stage("00_probe.py", tmp_path)
    assert r.returncode == 3
    rep = probe_report(tmp_path)
    assert rep["verdict"] == "blocked"
    assert any("encrypted" in b for b in rep["blockers"])
    assert "map-tracing" in " ".join(rep["blockers"])


def test_downstream_stages_refuse_to_run_behind_a_closed_gate(tmp_path):
    make_apk.build(tmp_path / "reference/client/base.apk", encrypted=True)
    run_stage("00_probe.py", tmp_path)
    for script in ("01_inventory.py", "02_terrain.py", "03_transforms.py"):
        r = run_stage(script, tmp_path)
        assert r.returncode == 2, script
        assert "verdict is 'blocked'" in r.stderr


def test_force_overrides_the_gate(tmp_path):
    make_apk.build(tmp_path / "reference/client/base.apk", encrypted=True)
    run_stage("00_probe.py", tmp_path)
    r = run_stage("01_inventory.py", tmp_path, "--force")
    assert r.returncode == 0, r.stdout + r.stderr


def test_il2cpp_and_addressables_are_reported_as_advisories_not_blockers(tmp_path):
    make_apk.build(tmp_path / "reference/client/base.apk", addressables=True)
    r = run_stage("00_probe.py", tmp_path)
    assert r.returncode == 0
    rep = probe_report(tmp_path)
    assert rep["addressables"] is True
    assert rep["verdict"] == "proceed"
    assert any("IL2CPP" in a for a in rep["advisories"])
    assert any("Addressables" in a for a in rep["advisories"])


def test_missing_assets_directory_blocks_and_asks_for_the_obb(tmp_path):
    make_apk.build(tmp_path / "reference/client/base.apk", empty_data=True)
    r = run_stage("00_probe.py", tmp_path)
    assert r.returncode == 3
    rep = probe_report(tmp_path)
    assert any("OBB" in b for b in rep["blockers"])


def test_zip_slip_entry_cannot_escape_extract_raw(tmp_path):
    """An APK is an untrusted archive; ../ entries must not write outside."""
    make_apk.build(tmp_path / "reference/client/base.apk", unsafe_entry=True)
    r = run_stage("00_probe.py", tmp_path)
    assert r.returncode == 0
    assert not (tmp_path.parent / "escaped.txt").exists()
    assert not (tmp_path / "escaped.txt").exists()
    assert "unsafe archive path" in r.stderr


def test_split_apk_absence_is_flagged(tmp_path):
    make_apk.build(tmp_path / "reference/client/base.apk")
    run_stage("00_probe.py", tmp_path)
    rep = probe_report(tmp_path)
    assert rep["splitApksPresent"] is False
    assert any("split APK" in a for a in rep["advisories"])
