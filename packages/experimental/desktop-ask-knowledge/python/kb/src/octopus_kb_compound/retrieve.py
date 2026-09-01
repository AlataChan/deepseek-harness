from __future__ import annotations

import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

from octopus_kb_compound.adapters.obsidian.store import ObsidianStore
from octopus_kb_compound.links import build_alias_index, extract_wikilinks, frontmatter_aliases, normalize_page_name
from octopus_kb_compound.models import PageRecord


def fold_query_text(text: str) -> str:
    """NFKC + casefold so PDF Kangxi radicals match typed CJK."""
    return unicodedata.normalize("NFKC", text).casefold()


def _name_key(name: str) -> str:
    return normalize_page_name(unicodedata.normalize("NFKC", name))


def _contains_term(haystack: str, needle: str) -> bool:
    folded = fold_query_text(needle)
    return bool(folded) and folded in fold_query_text(haystack)


@dataclass(slots=True)
class RetrievalBundle:
    query: str
    schema: str | None
    index: str | None
    concepts: list[str]
    entities: list[str]
    raw_sources: list[str]
    ordered_pages: list[str]
    warnings: list[dict[str, str]] = field(default_factory=list)
    token_estimate: int = 0
    concept_items: list[dict[str, str]] = field(default_factory=list)
    entity_items: list[dict[str, str]] = field(default_factory=list)
    raw_source_items: list[dict[str, str]] = field(default_factory=list)
    next: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "query": self.query,
            "bundle": {
                "schema": [self.schema] if self.schema else [],
                "index": [self.index] if self.index else [],
                "concepts": self.concept_items,
                "entities": self.entity_items,
                "raw_sources": self.raw_source_items,
            },
            "warnings": self.warnings,
            "token_estimate": self.token_estimate,
            "next": self.next,
        }


def build_retrieval_bundle(
    vault: str | Path, query: str, *, max_tokens: int = 0
) -> RetrievalBundle:
    root = Path(vault)
    store = ObsidianStore(root)
    pages = store.list_page_records()
    alias_index = build_alias_index(pages)
    by_title = {page.title: page for page in pages}
    markdown_by_path = store.markdown_by_path(pages)

    warnings: list[dict[str, str]] = []
    schema = _first_path_by_role_or_path(pages, "schema", "AGENTS.md")
    index = _first_path_by_role_or_path(pages, "index", "wiki/INDEX.md")
    if index is None:
        warnings.append(
            {
                "code": "NO_INDEX",
                "message": "wiki/INDEX.md is missing from the vault.",
            }
        )

    concepts = _matching_concepts(pages, query)
    entity_matches = _related_entities(concepts, alias_index, by_title)
    entities = [page for page, _reason in entity_matches]
    raw_sources = _raw_sources(pages, query, concepts)
    concept_items = [_page_item(page, _concept_reason(page, query)) for page in concepts]
    entity_items = [_page_item(page, reason) for page, reason in entity_matches]
    raw_source_items = [
        _page_item(page, "backlink" if concepts else "title_match")
        for page in raw_sources
    ]
    ordered = _dedupe([schema, index] + [p.path for p in concepts] + [p.path for p in entities] + [p.path for p in raw_sources])
    bundle = RetrievalBundle(
        query=query,
        schema=schema,
        index=index,
        concepts=[page.path for page in concepts],
        entities=[page.path for page in entities],
        raw_sources=[page.path for page in raw_sources],
        ordered_pages=ordered,
        warnings=warnings,
        concept_items=concept_items,
        entity_items=entity_items,
        raw_source_items=raw_source_items,
        next=[
            f'octopus-kb impacted-pages "{page.path}" --vault "{root}"'
            for page in concepts
        ],
    )
    bundle.token_estimate = _token_estimate(bundle, markdown_by_path)
    if max_tokens > 0:
        _trim_bundle(bundle, markdown_by_path, max_tokens)
    return bundle


def _touch_marker(vault: Path) -> None:
    marker = vault / ".octopus-kb" / ".retrieve-bundle-marker"
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.touch()


def _first_path_by_role_or_path(
    pages: list[PageRecord], role: str, fallback_path: str
) -> str | None:
    for page in pages:
        if page.frontmatter.get("role") == role:
            return page.path
    for page in pages:
        if page.path == fallback_path:
            return page.path
    return None


def _matching_concepts(pages: list[PageRecord], query: str) -> list[PageRecord]:
    query_key = _name_key(query)
    concepts = [
        page
        for page in pages
        if page.frontmatter.get("role") == "concept"
        and (
            query_key == _name_key(page.title)
            or query_key in _name_key(page.title)
            or query_key in {_name_key(alias) for alias in frontmatter_aliases(page)}
            or _contains_term(page.body, query)
            or _contains_term(page.title, query)
        )
    ]
    return sorted(concepts, key=lambda page: page.path)


def _related_entities(
    concepts: list[PageRecord],
    alias_index: dict[str, str],
    by_title: dict[str, PageRecord],
) -> list[tuple[PageRecord, str]]:
    entities: list[tuple[PageRecord, str]] = []
    for concept in concepts:
        for name in _frontmatter_entity_names(concept):
            page = _entity_page_for_name(name, alias_index, by_title)
            if page is not None:
                entities.append((page, "related_entities"))
        for name in extract_wikilinks(concept.body):
            page = _entity_page_for_name(name, alias_index, by_title)
            if page is not None:
                entities.append((page, "backlink"))
    return sorted(_dedupe_entity_matches(entities), key=lambda item: item[0].path)


def _frontmatter_entity_names(page: PageRecord) -> list[str]:
    names: list[str] = []
    related = page.frontmatter.get("related_entities", [])
    if isinstance(related, list):
        names.extend(str(item) for item in related)
    return names


def _entity_page_for_name(
    name: str,
    alias_index: dict[str, str],
    by_title: dict[str, PageRecord],
) -> PageRecord | None:
    title = alias_index.get(normalize_page_name(name))
    page = by_title.get(title or "")
    if page is not None and page.frontmatter.get("role") == "entity":
        return page
    return None


def _raw_sources(pages: list[PageRecord], query: str, concepts: list[PageRecord]) -> list[PageRecord]:
    raw_pages = [page for page in pages if page.frontmatter.get("role") == "raw_source"]
    if concepts:
        return sorted(raw_pages, key=lambda page: page.path)
    return sorted(
        [
            page
            for page in raw_pages
            if _contains_term(page.body, query) or _contains_term(page.title, query)
        ],
        key=lambda page: page.path,
    )


def _dedupe(values: list[str | None]) -> list[str]:
    result: list[str] = []
    for value in values:
        if value and value not in result:
            result.append(value)
    return result


def _dedupe_entity_matches(
    entities: list[tuple[PageRecord, str]],
) -> list[tuple[PageRecord, str]]:
    result: list[tuple[PageRecord, str]] = []
    seen: set[str] = set()
    for page, reason in entities:
        if page.path in seen:
            continue
        seen.add(page.path)
        result.append((page, reason))
    return result


def _concept_reason(page: PageRecord, query: str) -> str:
    query_key = _name_key(query)
    title_key = _name_key(page.title)
    if query_key == title_key or query_key in title_key or _contains_term(page.title, query):
        return "title_match"
    aliases = {_name_key(alias) for alias in frontmatter_aliases(page)}
    if query_key in aliases:
        return "alias_match"
    return "backlink"


def _page_item(page: PageRecord, reason: str) -> dict[str, str]:
    return {"path": page.path, "title": page.title, "reason": reason}


def _markdown_by_path(root: Path, pages: list[PageRecord]) -> dict[str, str]:
    result: dict[str, str] = {}
    for page in pages:
        result[page.path] = (root / page.path).read_text(
            encoding="utf-8", errors="replace"
        )
    return result


def _token_estimate(bundle: RetrievalBundle, markdown_by_path: dict[str, str]) -> int:
    total_chars = sum(
        len(markdown_by_path[path])
        for path in bundle.ordered_pages
        if path in markdown_by_path
    )
    return (total_chars + 3) // 4


def _trim_bundle(
    bundle: RetrievalBundle,
    markdown_by_path: dict[str, str],
    max_tokens: int,
) -> None:
    while bundle.raw_sources and bundle.token_estimate > max_tokens:
        bundle.raw_sources.pop()
        bundle.raw_source_items.pop()
        bundle.ordered_pages = _ordered_after_trim(bundle)
        bundle.token_estimate = _token_estimate(bundle, markdown_by_path)

    while bundle.entities and bundle.token_estimate > max_tokens:
        bundle.entities.pop()
        bundle.entity_items.pop()
        bundle.ordered_pages = _ordered_after_trim(bundle)
        bundle.token_estimate = _token_estimate(bundle, markdown_by_path)


def _ordered_after_trim(bundle: RetrievalBundle) -> list[str]:
    return _dedupe(
        [bundle.schema, bundle.index]
        + bundle.concepts
        + bundle.entities
        + bundle.raw_sources
    )
