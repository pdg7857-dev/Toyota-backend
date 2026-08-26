"""JSON read/write helpers and console output shared by all stages."""
from __future__ import annotations

import json
import pathlib
import sys
from typing import Any

from . import paths


def write_json(path: pathlib.Path, data: Any, indent: int = 2) -> pathlib.Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=indent, sort_keys=False) + "\n", encoding="utf-8")
    return path


def read_json(path: pathlib.Path, default: Any = None) -> Any:
    if not path.exists():
        if default is not None:
            return default
        raise FileNotFoundError(f"missing required input: {paths.rel(path)}")
    return json.loads(path.read_text(encoding="utf-8"))


def write_text(path: pathlib.Path, text: str) -> pathlib.Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def info(msg: str) -> None:
    print(msg)


def warn(msg: str) -> None:
    print(f"  ! {msg}", file=sys.stderr)


def stage_header(number: int, title: str) -> None:
    print(f"\n=== Stage {number} — {title} ===")


def stage_footer(written: list[pathlib.Path]) -> None:
    for p in written:
        print(f"  wrote {paths.rel(p)}")
