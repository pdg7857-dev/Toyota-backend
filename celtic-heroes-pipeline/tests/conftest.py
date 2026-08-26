import os
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))


@pytest.fixture
def pipeline_root(tmp_path, monkeypatch):
    """A throwaway pipeline tree, so tests never write into the repo."""
    monkeypatch.setenv("CHEXT_ROOT", str(tmp_path))
    for sub in ("reference/client", "extract/manifest", "config", "content/zones"):
        (tmp_path / sub).mkdir(parents=True, exist_ok=True)
    import importlib

    from chext import paths
    importlib.reload(paths)
    yield tmp_path
    monkeypatch.delenv("CHEXT_ROOT", raising=False)
    importlib.reload(paths)
