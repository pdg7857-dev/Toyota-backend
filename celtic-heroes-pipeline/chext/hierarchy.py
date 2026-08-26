"""Transform hierarchy resolution.

`m_LocalPosition` is relative to the parent. Anything nested — and scene
props usually are, several levels deep — needs the parent chain composed to
get a world position. A flat local-position dump is simply wrong, so this
walks `m_Father` and applies full translate/rotate/scale composition.
"""
from __future__ import annotations

import dataclasses

Vec3 = tuple[float, float, float]
Quat = tuple[float, float, float, float]  # x, y, z, w

IDENTITY_ROT: Quat = (0.0, 0.0, 0.0, 1.0)
UNIT_SCALE: Vec3 = (1.0, 1.0, 1.0)


@dataclasses.dataclass
class TransformRecord:
    path_id: int
    parent_id: int | None = None
    local_pos: Vec3 = (0.0, 0.0, 0.0)
    local_rot: Quat = IDENTITY_ROT
    local_scale: Vec3 = UNIT_SCALE
    game_object_id: int | None = None
    name: str = ""


def quat_mul(a: Quat, b: Quat) -> Quat:
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    )


def quat_rotate(q: Quat, v: Vec3) -> Vec3:
    """Rotate v by q using the cross-product form (no matrix build)."""
    qx, qy, qz, qw = q
    ux, uy, uz = qx, qy, qz
    # t = 2 * (u x v)
    tx = 2.0 * (uy * v[2] - uz * v[1])
    ty = 2.0 * (uz * v[0] - ux * v[2])
    tz = 2.0 * (ux * v[1] - uy * v[0])
    # v' = v + w*t + (u x t)
    return (
        v[0] + qw * tx + (uy * tz - uz * ty),
        v[1] + qw * ty + (uz * tx - ux * tz),
        v[2] + qw * tz + (ux * ty - uy * tx),
    )


def compose(parent_pos: Vec3, parent_rot: Quat, parent_scale: Vec3,
            local_pos: Vec3, local_rot: Quat, local_scale: Vec3
            ) -> tuple[Vec3, Quat, Vec3]:
    """Apply a child's TRS inside its parent's frame."""
    scaled = (local_pos[0] * parent_scale[0],
              local_pos[1] * parent_scale[1],
              local_pos[2] * parent_scale[2])
    rotated = quat_rotate(parent_rot, scaled)
    world_pos = (parent_pos[0] + rotated[0],
                 parent_pos[1] + rotated[1],
                 parent_pos[2] + rotated[2])
    world_rot = quat_mul(parent_rot, local_rot)
    world_scale = (parent_scale[0] * local_scale[0],
                   parent_scale[1] * local_scale[1],
                   parent_scale[2] * local_scale[2])
    return world_pos, world_rot, world_scale


def resolve(records: dict[int, TransformRecord]) -> tuple[dict[int, Vec3], list[str]]:
    """World position for every transform, plus warnings for broken chains.

    Resolution is memoised and iterative, so a hierarchy deeper than Python's
    recursion limit still resolves. A parent that is missing (cross-file
    PPtr, stripped object) or part of a cycle is reported and its subtree is
    treated as rooted at that node.
    """
    world: dict[int, tuple[Vec3, Quat, Vec3]] = {}
    warnings: list[str] = []
    missing_parents: set[int] = set()
    cyclic: set[int] = set()

    for start in records:
        if start in world:
            continue
        # Walk up to the nearest resolved ancestor (or a root), collecting the chain.
        chain: list[int] = []
        seen: set[int] = set()
        node: int | None = start
        while node is not None and node not in world:
            if node in seen:
                cyclic.add(node)
                break
            seen.add(node)
            rec = records.get(node)
            if rec is None:
                missing_parents.add(node)
                break
            chain.append(node)
            parent = rec.parent_id
            if parent is None or parent == 0:
                node = None
                break
            if parent not in records:
                missing_parents.add(parent)
                node = None
                break
            node = parent

        # Descend the collected chain applying each local TRS in turn.
        for nid in reversed(chain):
            rec = records[nid]
            parent_state = world.get(rec.parent_id) if rec.parent_id else None
            if parent_state is None:
                world[nid] = (rec.local_pos, rec.local_rot, rec.local_scale)
            else:
                world[nid] = compose(*parent_state,
                                     rec.local_pos, rec.local_rot, rec.local_scale)

    if missing_parents:
        warnings.append(
            f"{len(missing_parents)} parent transform(s) unresolved "
            "(cross-file PPtr or stripped); those subtrees are treated as roots"
        )
    if cyclic:
        warnings.append(f"{len(cyclic)} transform(s) sit in a parent cycle; broken at first repeat")

    return {k: v[0] for k, v in world.items()}, warnings


def depth_of(records: dict[int, TransformRecord], path_id: int, limit: int = 512) -> int:
    """Nesting depth, for reporting how deep the scene graph actually goes."""
    d, node, seen = 0, records.get(path_id), set()
    while node is not None and node.parent_id and d < limit:
        if node.path_id in seen:
            break
        seen.add(node.path_id)
        node = records.get(node.parent_id)
        d += 1
    return d
