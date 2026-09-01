from __future__ import annotations

from octopus_kb_compound.ckr.models import StorageRef


OBSIDIAN_ADAPTER = "obsidian"


def storage_ref_from_path(path: str) -> StorageRef:
    return StorageRef(adapter=OBSIDIAN_ADAPTER, locator=path)


def require_obsidian_storage_ref(ref: StorageRef | None) -> StorageRef:
    if ref is None:
        raise ValueError("Obsidian pages require a storage reference")
    if ref.adapter != OBSIDIAN_ADAPTER:
        raise ValueError(f"expected obsidian storage ref, got: {ref.adapter}")
    return ref
