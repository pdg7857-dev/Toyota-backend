"""Stage 0 classification logic.

Separated from the CLI so the magic/entropy verdicts can be tested against
synthetic bundles instead of a real client.
"""
from __future__ import annotations

import collections
import math
import re

UNITY_MAGICS = {
    b"UnityFS": "UnityFS",              # standard, current
    b"UnityWeb": "UnityWeb",            # legacy web bundle
    b"UnityRaw": "UnityRaw",            # legacy uncompressed
    b"UnityArchive": "UnityArchive",
}
# Serialised files (.assets, levelN) carry no magic string; they open with a
# header whose first bytes are big-endian sizes, so they read as low entropy.
SERIALISED_HINT = re.compile(rb"^\x00{0,4}[\x00-\xff]{4}\x00{0,3}")

VERSION_RE = re.compile(rb"(\d+\.\d+\.\d+[fpbax]\d+)")
ENCRYPTED_ENTROPY = 7.5


def shannon_entropy(data: bytes) -> float:
    """Bits per byte. Encrypted and already-compressed payloads sit near 8.0."""
    if not data:
        return 0.0
    counts = collections.Counter(data)
    n = len(data)
    return -sum((c / n) * math.log2(c / n) for c in counts.values())


def classify_bundle(head: bytes, entropy: float | None = None) -> dict:
    """Classify one candidate container from its first bytes."""
    for magic, label in UNITY_MAGICS.items():
        if head.startswith(magic):
            return {"format": label, "encrypted": False, "recognised": True}

    ent = shannon_entropy(head) if entropy is None else entropy
    if ent >= ENCRYPTED_ENTROPY:
        return {"format": "unknown", "encrypted": True, "recognised": False,
                "entropy": round(ent, 3)}
    if head[:4] in (b"PK\x03\x04", b"\x7fELF") or head[:2] == b"\x1f\x8b":
        return {"format": "not-unity", "encrypted": False, "recognised": False}
    if SERIALISED_HINT.match(head):
        return {"format": "serialised?", "encrypted": False, "recognised": True,
                "entropy": round(ent, 3)}
    return {"format": "unknown", "encrypted": False, "recognised": False,
            "entropy": round(ent, 3)}


def find_unity_version(head: bytes) -> str | None:
    m = VERSION_RE.search(head)
    return m.group(1).decode("ascii", "replace") if m else None


# Containers the pipeline must be able to read: scenes carry the landmarks,
# .assets and bundles carry the TerrainData.
TARGET_CONTAINER = re.compile(
    r"(^|/)level\d+$|\.assets$|\.bundle$|\.unity3d$|StreamingAssets/", re.I)


def is_target_container(name: str) -> bool:
    return bool(TARGET_CONTAINER.search(name))


def verdict(report: dict) -> tuple[str, list[str]]:
    """Turn a probe report into a go/no-go and the reasons behind it.

    The spec makes Stage 0 a hard gate: encrypted bundles mean the whole
    extraction path is abandoned in favour of map tracing.

    The judgement is made on the containers the pipeline actually needs.
    globalgamemanagers and other small headers always read as low entropy,
    so counting them would let a fully encrypted set of scene files pass.
    """
    blockers: list[str] = []
    magics = report.get("bundleMagics", {}) or {}
    classified = [v for v in magics.values() if isinstance(v, dict)]
    encrypted = [k for k, v in magics.items() if isinstance(v, dict) and v.get("encrypted")]
    recognised = [v for v in classified if v.get("recognised")]

    targets = {k: v for k, v in magics.items()
               if isinstance(v, dict) and is_target_container(k)}
    target_encrypted = [k for k, v in targets.items() if v.get("encrypted")]
    target_readable = [k for k, v in targets.items()
                       if v.get("recognised") and not v.get("encrypted")]

    if report.get("engine") != "unity":
        blockers.append("no Unity globalgamemanagers found — not a Unity build, or assets are elsewhere")
    if targets and not target_readable:
        blockers.append(
            f"none of the {len(targets)} scene/asset container(s) are readable "
            f"({len(target_encrypted)} look encrypted) — fall back to the map-tracing pipeline"
        )
    elif target_encrypted:
        blockers.append(
            f"{len(target_encrypted)} of {len(targets)} scene/asset container(s) look "
            f"encrypted (e.g. {target_encrypted[0]}); extraction would be partial at best "
            "— prefer the map-tracing pipeline unless the readable containers cover "
            "every zone you need"
        )
    elif classified and not recognised:
        blockers.append(
            f"no container has a recognisable Unity magic ({len(encrypted)} look encrypted) "
            "— fall back to the map-tracing pipeline"
        )
    if not report.get("assetFiles") and not report.get("addressables"):
        blockers.append(
            "assets/bin/Data is empty and no Addressables catalog is present — "
            "ask the user for the OBB and split APKs"
        )
    return ("blocked" if blockers else "proceed"), blockers


def advisories(report: dict) -> list[str]:
    """Non-blocking observations worth putting in front of the user."""
    out = []
    if report.get("il2cpp"):
        out.append("IL2CPP build: game code is native ARM. Expected — no game logic to recover "
                   "(Celtic Heroes is server-authoritative), so do not go looking for it.")
    if report.get("addressables"):
        out.append("Addressables in use: content lives in StreamingAssets/aa. If the catalog or "
                   "bundles are missing, request the OBB and split_config APKs.")
    if report.get("splitApksPresent") is False:
        out.append("Only base.apk was supplied. If this install used split APKs, assets may sit "
                   "in a file that was not provided.")
    if not report.get("unityVersion"):
        out.append("Unity version string not found in globalgamemanagers; UnityPy may need a "
                   "version hint if typetree parsing misbehaves.")
    return out
