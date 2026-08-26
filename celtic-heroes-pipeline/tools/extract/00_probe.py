#!/usr/bin/env python3
"""Stage 0 — Probe the supplied client.

Decides whether the rest of the pipeline is viable. This is a hard gate:
if the containers are encrypted there is nothing to extract and the map
tracing pipeline is the answer instead.

Usage: python tools/extract/00_probe.py [--keep] [--limit N]
"""
from __future__ import annotations

import argparse
import pathlib
import shutil
import sys
import zipfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from chext import gate, io_utils, paths, probe  # noqa: E402

HEAD_BYTES = 4096


def safe_extract(zf: zipfile.ZipFile, dest: pathlib.Path) -> int:
    """Extract with path-traversal protection.

    An APK is an untrusted archive; a crafted entry name like ../../x would
    otherwise write outside extract/raw.
    """
    dest = dest.resolve()
    count = 0
    for member in zf.infolist():
        if member.is_dir():
            continue
        target = (dest / member.filename).resolve()
        if not str(target).startswith(str(dest) + "/") and target != dest:
            io_utils.warn(f"skipped unsafe archive path: {member.filename}")
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        with zf.open(member) as src, open(target, "wb") as out:
            shutil.copyfileobj(src, out)
        count += 1
    return count


def candidate_containers(root: pathlib.Path, limit: int) -> list[pathlib.Path]:
    """Files most likely to be Unity containers, deduped and capped."""
    seen: list[pathlib.Path] = []
    patterns = ("assets/bin/Data/*", "assets/bin/Data/**/*",
                "**/StreamingAssets/**/*", "**/*.bundle", "**/*.unity3d")
    for pat in patterns:
        for p in sorted(root.glob(pat)):
            if p.is_file() and p not in seen and p.suffix.lower() not in (".png", ".txt", ".json"):
                seen.append(p)
            if len(seen) >= limit:
                return seen
    return seen


def main() -> None:
    ap = argparse.ArgumentParser(description="Stage 0 — probe the client")
    ap.add_argument("--keep", action="store_true",
                    help="keep an existing extract/raw instead of re-extracting")
    ap.add_argument("--limit", type=int, default=60, help="containers to sample (default 60)")
    args = ap.parse_args()

    io_utils.stage_header(0, "Probe")
    gate.require_client()
    paths.ensure_dirs()

    apks = sorted(paths.CLIENT.glob("*.apk"))
    obbs = sorted(paths.CLIENT.glob("*.obb"))
    splits = [p for p in apks if p.name.startswith("split_")]
    report: dict = {
        "suppliedFiles": [p.name for p in apks + obbs],
        "splitApksPresent": bool(splits),
        "obbPresent": bool(obbs),
    }

    names: list[str] = []
    if args.keep and any(paths.RAW.iterdir()):
        io_utils.info(f"  reusing {paths.rel(paths.RAW)}")
    else:
        for archive in apks + obbs:  # OBBs are usually zips too
            try:
                with zipfile.ZipFile(archive) as z:
                    names += z.namelist()
                    n = safe_extract(z, paths.RAW)
                io_utils.info(f"  extracted {n} entries from {archive.name}")
            except zipfile.BadZipFile:
                io_utils.warn(f"{archive.name} is not a zip archive; skipped")
                report.setdefault("unreadableArchives", []).append(archive.name)

    # 1. Is this Unity, and which version?
    ggm = paths.RAW / "assets/bin/Data/globalgamemanagers"
    if ggm.exists():
        report["engine"] = "unity"
        report["unityVersion"] = probe.find_unity_version(ggm.read_bytes()[:512])
    else:
        report["engine"] = "unknown"
        report["unityVersion"] = None

    # 2. Scripting backend
    all_names = names or [str(p.relative_to(paths.RAW)) for p in paths.RAW.rglob("*") if p.is_file()]
    report["il2cpp"] = any("libil2cpp.so" in n for n in all_names)
    report["mono"] = any("assets/bin/Data/Managed/" in n for n in all_names)

    # 3. Asset file inventory
    data_dir = paths.RAW / "assets/bin/Data"
    report["assetFiles"] = sorted(
        p.name for p in data_dir.glob("*")
        if p.is_file() and p.suffix in ("", ".assets", ".resS", ".resource")
    )[:60] if data_dir.exists() else []

    # 4. Addressables?
    report["addressables"] = any("StreamingAssets/aa" in n for n in all_names)

    # 5. Encryption probe — do the containers have valid magic?
    magics: dict[str, dict] = {}
    for b in candidate_containers(paths.RAW, args.limit):
        head = b.read_bytes()[:HEAD_BYTES]
        info = probe.classify_bundle(head)
        info["headHex"] = head[:8].hex()
        magics[str(b.relative_to(paths.RAW))] = info
    report["bundleMagics"] = magics
    report["containersSampled"] = len(magics)

    report["verdict"], report["blockers"] = probe.verdict(report)
    report["advisories"] = probe.advisories(report)

    io_utils.stage_footer([io_utils.write_json(paths.PROBE_JSON, report)])
    print(f"\n  Unity {report['unityVersion']} | il2cpp={report['il2cpp']} | "
          f"addressables={report['addressables']} | containers={len(magics)}")
    for a in report["advisories"]:
        print(f"  note: {a}")
    print(f"\n  VERDICT: {report['verdict'].upper()}")
    for b in report["blockers"]:
        print(f"    - {b}")
    if report["verdict"] != "proceed":
        print("\n  Stage 0 gate is closed. Report this to the user and stop.\n"
              "  See README section 'Fallbacks' for the map-tracing path.")
        sys.exit(3)
    print("  Report this to the user and wait for go/no-go before Stage 1.")


if __name__ == "__main__":
    sys.exit(gate.run_guarded(main))
