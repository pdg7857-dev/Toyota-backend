"""UnityPy adapters.

All engine I/O is confined to this module so the rest of the pipeline stays
testable without a client. Every reader is defensive: mobile builds ship a
mix of typetree-bearing and stripped serialised files, and a single
unreadable object must not abort a stage.
"""
from __future__ import annotations

import pathlib
from typing import Iterator

import UnityPy

from .hierarchy import IDENTITY_ROT, UNIT_SCALE, TransformRecord

# Suffixes that are never Unity containers; skipping them keeps scans quick.
SKIP_SUFFIXES = {".png", ".json", ".md", ".csv", ".xml", ".txt", ".so", ".dex",
                 ".arsc", ".properties", ".kotlin_builtins", ".version", ".pro"}

INTERESTING_TYPES = ("TerrainData", "GameObject", "Transform", "MeshRenderer",
                     "MeshFilter", "Texture2D", "Mesh")


def loadable_files(root: pathlib.Path) -> list[pathlib.Path]:
    """Every file under `root` worth handing to UnityPy, most-likely first."""
    out: list[pathlib.Path] = []
    for p in sorted(root.rglob("*")):
        if not p.is_file() or p.suffix.lower() in SKIP_SUFFIXES:
            continue
        if p.suffix in (".resS", ".resource"):
            continue  # payload side-cars, opened via their owning .assets
        out.append(p)
    scenes = [p for p in out if p.name.startswith("level")]
    assets = [p for p in out if p.suffix in (".assets", ".bundle", ".unity3d")]
    rest = [p for p in out if p not in set(scenes) | set(assets)]
    return scenes + assets + rest


def safe_load(path: pathlib.Path):
    """UnityPy.load that returns None instead of raising on a non-Unity file."""
    try:
        env = UnityPy.load(str(path))
    except Exception:
        return None
    try:
        if not env.objects:
            return None
    except Exception:
        return None
    return env


def iter_objects(env) -> Iterator:
    try:
        yield from env.objects
    except Exception:
        return


def type_name(obj) -> str:
    try:
        return obj.type.name
    except Exception:
        return "Unknown"


def read_tree(obj) -> dict | None:
    """Typetree dict for an object, falling back to the parsed object's fields.

    IL2CPP release builds often strip typetrees; UnityPy then needs its
    generated classes, which expose the same field names via attributes.
    """
    try:
        return obj.read_typetree()
    except Exception:
        pass
    try:
        parsed = obj.read()
    except Exception:
        return None
    tree = {}
    for key in dir(parsed):
        if not key.startswith("m_"):
            continue
        try:
            tree[key] = getattr(parsed, key)
        except Exception:
            continue
    return tree or None


def object_name(obj) -> str:
    for reader in (lambda: obj.peek_name(),
                   lambda: getattr(obj.read(), "m_Name", "")):
        try:
            name = reader()
            if name:
                return str(name)
        except Exception:
            continue
    return ""


def _vec(value, default) -> tuple:
    """Read a Vector3f/Quaternionf from either a dict or an object."""
    if value is None:
        return default
    if isinstance(value, dict):
        keys = ("x", "y", "z", "w")[: len(default)]
        try:
            return tuple(float(value[k]) for k in keys)
        except (KeyError, TypeError, ValueError):
            return default
    try:
        return tuple(float(getattr(value, k)) for k in ("x", "y", "z", "w")[: len(default)])
    except (AttributeError, TypeError, ValueError):
        return default


def _pptr_path_id(value) -> int | None:
    """Path id from a PPtr, whether it arrived as a dict or an object.

    A non-zero m_FileID means the target lives in another serialised file;
    it is returned anyway so the caller can report the broken chain rather
    than silently treating the node as a root.
    """
    if value is None:
        return None
    if isinstance(value, dict):
        pid = value.get("m_PathID")
    else:
        pid = getattr(value, "m_PathID", None)
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return None
    return pid or None


def terrain_records(env, source: str) -> Iterator[dict]:
    """Yield raw TerrainData trees with their heightmap and splat sections."""
    for obj in iter_objects(env):
        if type_name(obj) != "TerrainData":
            continue
        tree = read_tree(obj)
        if not tree:
            continue
        hm = tree.get("m_Heightmap")
        if hm is None:
            continue
        if not isinstance(hm, dict):
            hm = {k: getattr(hm, k, None) for k in
                  ("m_Heights", "m_Scale", "m_Width", "m_Height", "m_Resolution")}
        yield {
            "source": source,
            "pathId": obj.path_id,
            "name": tree.get("m_Name") or f"terrain_{obj.path_id}",
            "heightmap": hm,
            "splat": tree.get("m_SplatDatabase"),
        }


def transform_records(env) -> tuple[dict[int, TransformRecord], dict[int, str]]:
    """Every Transform in a file, keyed by path id, plus GameObject names.

    Returned separately from name resolution because a Transform's name
    lives on its GameObject, and the two are linked by PPtr.
    """
    transforms: dict[int, TransformRecord] = {}
    go_names: dict[int, str] = {}
    go_of_transform: dict[int, int] = {}

    for obj in iter_objects(env):
        tname = type_name(obj)
        if tname == "GameObject":
            go_names[obj.path_id] = object_name(obj)
        elif tname in ("Transform", "RectTransform"):
            tree = read_tree(obj)
            if not tree:
                continue
            go_id = _pptr_path_id(tree.get("m_GameObject"))
            if go_id:
                go_of_transform[obj.path_id] = go_id
            transforms[obj.path_id] = TransformRecord(
                path_id=obj.path_id,
                parent_id=_pptr_path_id(tree.get("m_Father")),
                local_pos=_vec(tree.get("m_LocalPosition"), (0.0, 0.0, 0.0)),
                local_rot=_vec(tree.get("m_LocalRotation"), IDENTITY_ROT),
                local_scale=_vec(tree.get("m_LocalScale"), UNIT_SCALE),
                game_object_id=go_id,
            )

    for tid, rec in transforms.items():
        rec.name = go_names.get(go_of_transform.get(tid, -1), "")
    return transforms, go_names
