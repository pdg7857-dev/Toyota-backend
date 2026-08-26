"""Build synthetic APKs so Stage 0 can be exercised without a real client.

These are not playable Unity builds — they carry just enough structure for
the probe to classify: a globalgamemanagers header with a version string,
containers with (or without) valid Unity magic, and the marker files the
probe looks for.
"""
from __future__ import annotations

import os
import pathlib
import zipfile


def build(dest: pathlib.Path,
          unity_version: str = "2021.3.16f1",
          encrypted: bool = False,
          il2cpp: bool = True,
          addressables: bool = False,
          empty_data: bool = False,
          unsafe_entry: bool = False) -> pathlib.Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
        if not empty_data:
            z.writestr("assets/bin/Data/globalgamemanagers",
                       b"\x00" * 20 + unity_version.encode() + b"\x00" * 64)
            body = os.urandom(2048) if encrypted else b"UnityFS\x00" + b"\x00" * 2040
            z.writestr("assets/bin/Data/level0", body)
            z.writestr("assets/bin/Data/level1", body)
            z.writestr("assets/bin/Data/resources.assets", b"\x00\x00\x00\x10" + b"\x00" * 1024)
        if il2cpp:
            z.writestr("lib/arm64-v8a/libil2cpp.so", b"\x7fELF" + b"\x00" * 128)
        else:
            z.writestr("assets/bin/Data/Managed/Assembly-CSharp.dll", b"MZ" + b"\x00" * 128)
        if addressables:
            z.writestr("assets/aa/catalog.json", b'{"m_LocatorId":"AddressablesMainContentCatalog"}')
            z.writestr("assets/aa/StreamingAssets/aa/Android/zone_assets.bundle",
                       os.urandom(2048) if encrypted else b"UnityFS\x00" + b"\x00" * 2040)
        if unsafe_entry:
            z.writestr("../../escaped.txt", b"should never be written outside extract/raw")
    return dest
