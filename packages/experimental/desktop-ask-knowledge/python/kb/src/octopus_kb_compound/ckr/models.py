from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any


CKR_VERSION = "1"


@dataclass(frozen=True, slots=True)
class CanonicalRef:
    """Endpoint-neutral identity for a knowledge object."""

    id: str
    kind: str = "page"
    title: str | None = None

    def __post_init__(self) -> None:
        _require_non_empty("id", self.id)
        _require_non_empty("kind", self.kind)

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {"id": self.id, "kind": self.kind}
        if self.title is not None:
            data["title"] = self.title
        return data

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> CanonicalRef:
        return cls(
            id=str(data["id"]),
            kind=str(data.get("kind") or "page"),
            title=_optional_str(data.get("title")),
        )


@dataclass(frozen=True, slots=True)
class StorageRef:
    """Adapter-specific storage identity, kept separate from CanonicalRef."""

    adapter: str
    locator: str

    def __post_init__(self) -> None:
        _require_non_empty("adapter", self.adapter)
        _require_non_empty("locator", self.locator)

    def to_dict(self) -> dict[str, str]:
        return {"adapter": self.adapter, "locator": self.locator}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> StorageRef:
        return cls(adapter=str(data["adapter"]), locator=str(data["locator"]))


@dataclass(frozen=True, slots=True)
class SourceSpan:
    """Line-level source evidence attached to an operation or future claim."""

    path: str
    start_line: int
    end_line: int

    def __post_init__(self) -> None:
        _require_non_empty("path", self.path)
        if self.start_line < 1:
            raise ValueError("start_line must be >= 1")
        if self.end_line < self.start_line:
            raise ValueError("end_line must be >= start_line")

    def to_dict(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "start_line": self.start_line,
            "end_line": self.end_line,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SourceSpan:
        return cls(
            path=str(data["path"]),
            start_line=int(data["start_line"]),
            end_line=int(data["end_line"]),
        )


@dataclass(slots=True)
class CanonicalPage:
    """Lossless v1 CKR page projection.

    CKR v1 keeps markdown body text and adapter storage references explicit so
    the current Obsidian-backed CLI and audit contracts can remain stable while
    callers migrate behind the adapter boundary.
    """

    ref: CanonicalRef
    title: str
    kind: str
    language: str
    body: str
    body_format: str = "markdown"
    aliases: list[str] = field(default_factory=list)
    related_refs: list[CanonicalRef] = field(default_factory=list)
    storage: StorageRef | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        _require_non_empty("kind", self.kind)
        _require_non_empty("body_format", self.body_format)

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "ref": self.ref.to_dict(),
            "title": self.title,
            "kind": self.kind,
            "language": self.language,
            "body": self.body,
            "body_format": self.body_format,
            "aliases": list(self.aliases),
            "related_refs": [ref.to_dict() for ref in self.related_refs],
            "metadata": deepcopy(self.metadata),
        }
        if self.storage is not None:
            data["storage"] = self.storage.to_dict()
        return data

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> CanonicalPage:
        storage_data = data.get("storage")
        return cls(
            ref=CanonicalRef.from_dict(data["ref"]),
            title=str(data["title"]),
            kind=str(data["kind"]),
            language=str(data.get("language") or ""),
            body=str(data.get("body") or ""),
            body_format=str(data.get("body_format") or "markdown"),
            aliases=[str(alias) for alias in data.get("aliases", [])],
            related_refs=[
                CanonicalRef.from_dict(ref)
                for ref in data.get("related_refs", [])
            ],
            storage=StorageRef.from_dict(storage_data) if storage_data else None,
            metadata=deepcopy(data.get("metadata", {})),
        )


def _optional_str(value: Any) -> str | None:
    if value is None:
        return None
    return str(value)


def _require_non_empty(name: str, value: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty string")
