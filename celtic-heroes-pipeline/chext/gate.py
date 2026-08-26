"""Stage gating.

The spec is explicit: nothing runs past Stage 0 without a clean bundle-magic
check, and Stage 5 does not run against an unconfirmed scene->zone mapping.
Gates read state off disk rather than being passed between processes, so each
stage script stays independently runnable.
"""
from __future__ import annotations

import sys

from . import io_utils, paths


class GateError(RuntimeError):
    pass


def require_client() -> None:
    """Stage 0 precondition: the user has supplied an APK."""
    apks = sorted(paths.CLIENT.glob("*.apk")) if paths.CLIENT.exists() else []
    if not apks:
        raise GateError(
            f"no APK found in {paths.rel(paths.CLIENT)}/.\n"
            "  This pipeline cannot obtain the client — the user must supply it:\n"
            "    adb shell pm path com.<package>\n"
            "    adb pull <path>/base.apk reference/client/\n"
            "  Include split_config.*.apk and main.*.obb if the install has them."
        )


def require_probe_ok(force: bool = False) -> dict:
    """Stages 1+ precondition: probe ran and returned a proceed verdict."""
    if not paths.PROBE_JSON.exists():
        raise GateError(
            f"{paths.rel(paths.PROBE_JSON)} not found — run tools/extract/00_probe.py first."
        )
    probe = io_utils.read_json(paths.PROBE_JSON)
    verdict = probe.get("verdict", "unknown")
    if verdict != "proceed" and not force:
        reasons = "; ".join(probe.get("blockers", [])) or "unknown"
        raise GateError(
            f"probe verdict is '{verdict}' ({reasons}).\n"
            "  Stage 0 is a hard gate — see README §Fallbacks before overriding.\n"
            "  Pass --force to run anyway."
        )
    return probe


def require_scene_map() -> dict:
    """Stage 5 precondition: a human has confirmed which scene is which zone."""
    if not paths.SCENE_MAP.exists():
        raise GateError(
            f"{paths.rel(paths.SCENE_MAP)} not found.\n"
            f"  Stage 1 writes a suggestion to {paths.rel(paths.SCENE_MAP_SUGGESTED)}.\n"
            "  Review it, correct the zone ids, and save it as scene_map.json."
        )
    return io_utils.read_json(paths.SCENE_MAP)


def run_guarded(fn) -> int:
    """Wrap a stage main() so gate failures print cleanly instead of traceback."""
    try:
        fn()
    except GateError as e:
        print(f"\nBLOCKED: {e}", file=sys.stderr)
        return 2
    return 0
