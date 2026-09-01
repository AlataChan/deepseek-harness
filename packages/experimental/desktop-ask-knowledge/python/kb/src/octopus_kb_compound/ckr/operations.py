from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any, TypeAlias

from octopus_kb_compound.ckr.models import CanonicalPage, CanonicalRef, SourceSpan, StorageRef
from octopus_kb_compound.links import normalize_page_name


@dataclass(frozen=True, slots=True)
class CreatePageOp:
    page: CanonicalPage
    rationale: str
    confidence: float
    source_span: SourceSpan | None = None

    def __post_init__(self) -> None:
        _validate_confidence(self.confidence)

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "op": "create_page",
            "page": self.page.to_dict(),
            "rationale": self.rationale,
            "confidence": self.confidence,
        }
        if self.source_span is not None:
            data["source_span"] = self.source_span.to_dict()
        return data

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> CreatePageOp:
        span = data.get("source_span")
        return cls(
            page=CanonicalPage.from_dict(data["page"]),
            rationale=str(data.get("rationale") or ""),
            confidence=float(data.get("confidence", 1.0)),
            source_span=SourceSpan.from_dict(span) if span else None,
        )


@dataclass(frozen=True, slots=True)
class AddAliasOp:
    target: StorageRef
    alias: str
    rationale: str
    confidence: float
    source_span: SourceSpan | None = None

    def __post_init__(self) -> None:
        _validate_confidence(self.confidence)
        if not self.alias.strip():
            raise ValueError("alias must be a non-empty string")

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "op": "add_alias",
            "target": self.target.to_dict(),
            "alias": self.alias,
            "rationale": self.rationale,
            "confidence": self.confidence,
        }
        if self.source_span is not None:
            data["source_span"] = self.source_span.to_dict()
        return data

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> AddAliasOp:
        span = data.get("source_span")
        return cls(
            target=StorageRef.from_dict(data["target"]),
            alias=str(data["alias"]),
            rationale=str(data.get("rationale") or ""),
            confidence=float(data.get("confidence", 1.0)),
            source_span=SourceSpan.from_dict(span) if span else None,
        )


@dataclass(frozen=True, slots=True)
class AppendLogOp:
    target: StorageRef
    entry: str
    rationale: str
    confidence: float

    def __post_init__(self) -> None:
        _validate_confidence(self.confidence)

    def to_dict(self) -> dict[str, Any]:
        return {
            "op": "append_log",
            "target": self.target.to_dict(),
            "entry": self.entry,
            "rationale": self.rationale,
            "confidence": self.confidence,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> AppendLogOp:
        return cls(
            target=StorageRef.from_dict(data["target"]),
            entry=str(data["entry"]),
            rationale=str(data.get("rationale") or ""),
            confidence=float(data.get("confidence", 1.0)),
        )


CanonicalOp: TypeAlias = CreatePageOp | AddAliasOp | AppendLogOp


def operation_from_dict(data: dict[str, Any]) -> CanonicalOp:
    op = data.get("op")
    if op == "create_page":
        return CreatePageOp.from_dict(data)
    if op == "add_alias":
        return AddAliasOp.from_dict(data)
    if op == "append_log":
        return AppendLogOp.from_dict(data)
    raise ValueError(f"unsupported canonical operation: {op}")


def operations_from_proposal(proposal: dict[str, Any], *, adapter: str = "obsidian") -> list[CanonicalOp]:
    result: list[CanonicalOp] = []
    for op in proposal.get("operations", []):
        op_name = op.get("op")
        if op_name == "create_page":
            frontmatter = deepcopy(op.get("frontmatter", {}))
            title = str(frontmatter.get("title") or "")
            kind = str(frontmatter.get("role") or frontmatter.get("type") or "page")
            path = str(op["path"])
            page = CanonicalPage(
                ref=CanonicalRef(
                    id=_canonical_id(frontmatter, path),
                    kind=kind,
                    title=str(frontmatter.get("canonical_name") or title),
                ),
                title=title,
                kind=kind,
                language=str(frontmatter.get("lang") or ""),
                body=str(op.get("body", "")),
                body_format="markdown",
                aliases=[str(alias) for alias in frontmatter.get("aliases", [])]
                if isinstance(frontmatter.get("aliases"), list)
                else [],
                storage=StorageRef(adapter=adapter, locator=path),
                metadata=frontmatter,
            )
            result.append(
                CreatePageOp(
                    page=page,
                    rationale=str(op.get("rationale") or ""),
                    confidence=float(op.get("confidence", 1.0)),
                    source_span=_source_span(op),
                )
            )
            continue

        if op_name == "add_alias":
            result.append(
                AddAliasOp(
                    target=StorageRef(adapter=adapter, locator=str(op["target_page"])),
                    alias=str(op["alias"]),
                    rationale=str(op.get("rationale") or ""),
                    confidence=float(op.get("confidence", 1.0)),
                    source_span=_source_span(op),
                )
            )
            continue

        if op_name == "append_log":
            result.append(
                AppendLogOp(
                    target=StorageRef(adapter=adapter, locator=str(op["path"])),
                    entry=str(op["entry"]),
                    rationale=str(op.get("rationale") or ""),
                    confidence=float(op.get("confidence", 1.0)),
                )
            )
            continue

        raise ValueError(f"unsupported canonical operation: {op_name}")
    return result


def _validate_confidence(value: float) -> None:
    if value < 0 or value > 1:
        raise ValueError("confidence must be between 0 and 1")


def _canonical_id(frontmatter: dict[str, Any], path: str) -> str:
    for candidate in (
        frontmatter.get("canonical_name"),
        frontmatter.get("title"),
        path,
    ):
        if not isinstance(candidate, str):
            continue
        normalized = normalize_page_name(candidate)
        if normalized:
            return normalized
    return path


def _source_span(op: dict[str, Any]) -> SourceSpan | None:
    span = op.get("source_span")
    if not isinstance(span, dict):
        return None
    return SourceSpan.from_dict(span)
