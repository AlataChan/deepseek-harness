from __future__ import annotations

from copy import deepcopy
from typing import Any

from octopus_kb_compound.adapters.obsidian.paths import (
    require_obsidian_storage_ref,
    storage_ref_from_path,
)
from octopus_kb_compound.canonical import _canonical_key
from octopus_kb_compound.ckr.models import CanonicalPage, CanonicalRef
from octopus_kb_compound.links import frontmatter_aliases, normalize_page_name
from octopus_kb_compound.models import PageRecord


def page_record_to_canonical(page: PageRecord) -> CanonicalPage:
    frontmatter = deepcopy(page.frontmatter)
    kind = str(frontmatter.get("role") or frontmatter.get("type") or "page")
    title = str(frontmatter.get("title") or page.title)
    related_refs = [
        _related_ref(name)
        for name in _frontmatter_string_list(frontmatter.get("related_entities"))
    ]
    return CanonicalPage(
        ref=CanonicalRef(
            id=_canonical_key(page) or _fallback_ref_id(page),
            kind=kind,
            title=str(frontmatter.get("canonical_name") or title),
        ),
        title=title,
        kind=kind,
        language=str(frontmatter.get("lang") or ""),
        body=page.body,
        body_format="markdown",
        aliases=frontmatter_aliases(page),
        related_refs=related_refs,
        storage=storage_ref_from_path(page.path),
        metadata=frontmatter,
    )


def canonical_to_page_record(page: CanonicalPage) -> PageRecord:
    storage = require_obsidian_storage_ref(page.storage)
    frontmatter = deepcopy(page.metadata)
    frontmatter.setdefault("title", page.title)
    frontmatter.setdefault("type", page.kind)
    if page.language:
        frontmatter.setdefault("lang", page.language)
    frontmatter.setdefault("role", page.kind)
    if page.aliases and "aliases" not in frontmatter:
        frontmatter["aliases"] = list(page.aliases)
    if page.related_refs and "related_entities" not in frontmatter:
        frontmatter["related_entities"] = [
            ref.title or ref.id
            for ref in page.related_refs
        ]
    return PageRecord(
        path=storage.locator,
        title=str(frontmatter.get("title") or page.title),
        body=page.body,
        frontmatter=frontmatter,
    )


def canonical_page_to_markdown(page: CanonicalPage) -> str:
    record = canonical_to_page_record(page)
    return f"---\n{_render_frontmatter(record.frontmatter)}---\n{record.body}"


def _related_ref(name: str) -> CanonicalRef:
    return CanonicalRef(
        id=normalize_page_name(name) or name,
        kind="entity",
        title=name,
    )


def _frontmatter_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value]


def _fallback_ref_id(page: PageRecord) -> str:
    candidates = [
        page.frontmatter.get("canonical_name"),
        page.frontmatter.get("title"),
        page.title,
        page.path,
    ]
    for candidate in candidates:
        if not isinstance(candidate, str):
            continue
        normalized = normalize_page_name(candidate)
        if normalized:
            return normalized
    return page.path


def _render_frontmatter(frontmatter: dict[str, Any]) -> str:
    lines: list[str] = []
    for key, value in frontmatter.items():
        if value is None:
            continue
        if isinstance(value, list):
            if not value:
                lines.append(f"{key}: []")
                continue
            lines.append(f"{key}:")
            for item in value:
                lines.append(f"  - {_quote_scalar(item)}")
            continue
        if isinstance(value, str) and "\n" in value:
            lines.append(f"{key}: |")
            for line in value.splitlines():
                lines.append(f"  {line}")
            continue
        lines.append(f"{key}: {_quote_scalar(value)}")
    return "\n".join(lines) + "\n"


def _quote_scalar(value: Any) -> str:
    text = str(value)
    escaped = text.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'
