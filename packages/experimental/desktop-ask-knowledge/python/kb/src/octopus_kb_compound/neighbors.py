from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from octopus_kb_compound.adapters.obsidian.store import ObsidianStore
from octopus_kb_compound.canonical import _canonical_key
from octopus_kb_compound.links import (
    build_alias_index,
    extract_wikilinks,
    frontmatter_aliases,
    normalize_page_name,
)
from octopus_kb_compound.models import PageRecord


@dataclass(frozen=True, slots=True)
class NeighborsResult:
    page: str
    inbound: list[dict]
    outbound: list[dict]
    aliases: list[str]
    canonical_identity: str | None
    next: list[str]

    def to_dict(self) -> dict:
        return {
            "page": self.page,
            "inbound": self.inbound,
            "outbound": self.outbound,
            "aliases": self.aliases,
            "canonical_identity": self.canonical_identity,
            "next": self.next,
        }


def compute_neighbors(page_rel_path: str, vault: Path) -> NeighborsResult:
    pages = ObsidianStore(vault).list_page_records()
    target = _page_by_path(pages, page_rel_path)
    if target is None:
        raise ValueError(f"Page not found in vault: {page_rel_path}")

    alias_index = build_alias_index(pages)
    by_title = {page.title: page for page in pages}
    target_keys = _target_keys(target)

    inbound = _inbound_neighbors(pages, target.path, target_keys)
    outbound = _outbound_neighbors(target, alias_index, by_title)
    return NeighborsResult(
        page=target.path,
        inbound=inbound,
        outbound=outbound,
        aliases=frontmatter_aliases(target),
        canonical_identity=_canonical_identity(target),
        next=[f'octopus-kb impacted-pages "{target.path}" --vault "{vault}" --json'],
    )


def _page_by_path(pages: list[PageRecord], path: str) -> PageRecord | None:
    for page in pages:
        if page.path == path:
            return page
    return None


def _target_keys(page: PageRecord) -> set[str]:
    keys = {normalize_page_name(page.title), normalize_page_name(Path(page.path).stem)}
    keys.update(normalize_page_name(alias) for alias in frontmatter_aliases(page))
    return {key for key in keys if key}


def _inbound_neighbors(
    pages: list[PageRecord],
    target_path: str,
    target_keys: set[str],
) -> list[dict]:
    inbound: list[dict] = []
    for page in pages:
        if page.path == target_path:
            continue
        count = sum(
            1
            for link in extract_wikilinks(page.body)
            if normalize_page_name(link) in target_keys
        )
        if count:
            inbound.append({"path": page.path, "via": "wikilink", "count": count})
    return sorted(inbound, key=lambda item: (-item["count"], item["path"]))


def _outbound_neighbors(
    target: PageRecord,
    alias_index: dict[str, str],
    by_title: dict[str, PageRecord],
) -> list[dict]:
    outbound: list[dict] = []
    for link in extract_wikilinks(target.body):
        resolved = _resolve_page(link, alias_index, by_title)
        if resolved is not None:
            outbound.append({"path": resolved.path, "via": "wikilink"})

    related = target.frontmatter.get("related_entities", [])
    if isinstance(related, list):
        for item in related:
            resolved = _resolve_page(str(item), alias_index, by_title)
            if resolved is not None:
                outbound.append({"path": resolved.path, "via": "related_entities"})

    return sorted(_dedupe_outbound(outbound), key=lambda item: (item["path"], item["via"]))


def _resolve_page(
    name: str,
    alias_index: dict[str, str],
    by_title: dict[str, PageRecord],
) -> PageRecord | None:
    title = alias_index.get(normalize_page_name(name))
    if title is None:
        return None
    return by_title.get(title)


def _dedupe_outbound(outbound: list[dict]) -> list[dict]:
    result: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for item in outbound:
        key = (item["path"], item["via"])
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def _canonical_identity(page: PageRecord) -> str | None:
    if not _canonical_key(page):
        return None
    value = page.frontmatter.get("canonical_name") or page.frontmatter.get("title") or page.title
    if value is None:
        return None
    return " ".join(str(value).strip().casefold().split())
