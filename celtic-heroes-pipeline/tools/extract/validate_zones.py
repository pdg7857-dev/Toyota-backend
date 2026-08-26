#!/usr/bin/env python3
"""Validate zone JSON files against the schema and acceptance criteria.

Usage: python tools/extract/validate_zones.py [paths...]
Defaults to content/zones/ and content/zones/generated/.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from chext import paths, schema  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description="Validate zone JSON")
    ap.add_argument("targets", nargs="*", help="files or directories (default: content/zones)")
    ap.add_argument("--strict", action="store_true", help="treat warnings as failures")
    args = ap.parse_args()

    roots = [pathlib.Path(t) for t in args.targets] or [paths.ZONES, paths.ZONES_GENERATED]
    files: list[pathlib.Path] = []
    for r in roots:
        if r.is_dir():
            files += sorted(p for p in r.glob("*.json"))
        elif r.is_file():
            files.append(r)

    if not files:
        print("No zone files found.")
        return 0

    total_errors = total_warnings = 0
    for f in files:
        try:
            doc = json.loads(f.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            print(f"{paths.rel(f)}: [error] not valid JSON — {e}")
            total_errors += 1
            continue
        issues = schema.validate(doc)
        errs = schema.errors(issues)
        warns = [i for i in issues if i.severity == "warn"]
        total_errors += len(errs)
        total_warnings += len(warns)
        status = "FAIL" if errs else ("warn" if warns else "ok")
        print(f"{paths.rel(f)}: {status}")
        for i in issues:
            print(f"    {i}")

    print(f"\n{len(files)} file(s): {total_errors} error(s), {total_warnings} warning(s)")
    return 1 if total_errors or (args.strict and total_warnings) else 0


if __name__ == "__main__":
    sys.exit(main())
