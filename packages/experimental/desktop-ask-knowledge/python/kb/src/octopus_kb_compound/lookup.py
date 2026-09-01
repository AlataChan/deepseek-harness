from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from octopus_kb_compound.adapters.obsidian.store import ObsidianStore
from octopus_kb_compound.canonical import _canonical_pages_by_key
from octopus_kb_compound.links import (
    build_alias_index,
    find_alias_collisions,
    frontmatter_aliases,
    normalize_page_name,
)
from octopus_kb_compound.models import PageRecord
from octopus_kb_compound.retrieve import build_retrieval_bundle, fold_query_text


@dataclass(frozen=True, slots=True)
class LookupResult:
    term: str
    canonical: dict | None
    aliases: list[dict]
    ambiguous: bool
    collisions: list[str]
    next: list[str]

    def to_dict(self) -> dict:
        return {
            "term": self.term,
            "canonical": self.canonical,
            "aliases": self.aliases,
            "ambiguous": self.ambiguous,
            "collisions": self.collisions,
            "next": self.next,
        }


def lookup_term(term: str, vault: Path) -> LookupResult:
    pages = ObsidianStore(vault).list_page_records()
    key = normalize_page_name(term)
    title_pages = _pages_by_title(pages)
    alias_collisions = find_alias_collisions(pages)

    if key in alias_collisions:
        collisions = sorted(
            page.path
            for title in alias_collisions[key]
            for page in title_pages.get(title, [])
        )
        return LookupResult(
            term=term,
            canonical=None,
            aliases=[],
            ambiguous=True,
            collisions=collisions,
            next=[],
        )

    canonical_by_key = _canonical_pages_by_key(pages)
    canonical_matches = canonical_by_key.get(key, [])
    if len(canonical_matches) > 1:
        return LookupResult(
            term=term,
            canonical=None,
            aliases=[],
            ambiguous=True,
            collisions=sorted(page.path for page in canonical_matches),
            next=[],
        )

    alias_index = build_alias_index(pages)
    target_page = _resolve_unique_page(key, alias_index, title_pages)
    alias_rows: list[dict] = []
    if target_page is not None:
        alias_rows.append({"text": term, "resolves_to": target_page.path})
    elif len(canonical_matches) == 1:
        target_page = canonical_matches[0]

    if target_page is None:
        target_page = _resolve_containing(term, pages)
    if target_page is None:
        target_page = _resolve_from_retrieve(term, vault, pages)

    if target_page is None:
        return LookupResult(
            term=term,
            canonical=None,
            aliases=[],
            ambiguous=False,
            collisions=[],
            next=[f'octopus-kb suggest-links <page> --vault "{vault}"'],
        )

    canonical = _canonical_payload(target_page)
    return LookupResult(
        term=term,
        canonical=canonical,
        aliases=alias_rows,
        ambiguous=False,
        collisions=[],
        next=[
            f'octopus-kb retrieve-bundle "{target_page.path}" --vault "{vault}" --json',
            f'octopus-kb neighbors "{target_page.path}" --vault "{vault}" --json',
        ],
    )


def _resolve_containing(term: str, pages: list[PageRecord]) -> PageRecord | None:
    needle = fold_query_text(term)
    if not needle:
        return None
    hits: list[PageRecord] = []
    for page in pages:
        haystacks = [page.title, page.path, *frontmatter_aliases(page)]
        tags = page.frontmatter.get("tags")
        if isinstance(tags, list):
            haystacks.extend(str(tag) for tag in tags)
        if any(needle in fold_query_text(str(item)) for item in haystacks):
            hits.append(page)
    concepts = [page for page in hits if page.frontmatter.get("role") == "concept"]
    pool = concepts or hits
    if len(pool) != 1:
        return None
    return pool[0]


def _resolve_from_retrieve(term: str, vault: Path, pages: list[PageRecord]) -> PageRecord | None:
    bundle = build_retrieval_bundle(vault, term)
    ordered = bundle.concepts + bundle.entities + bundle.raw_sources
    by_path = {page.path: page for page in pages}
    for path in ordered:
        page = by_path.get(path)
        if page is not None:
            return page
    return None


def _pages_by_title(pages: list[PageRecord]) -> dict[str, list[PageRecord]]:
    by_title: dict[str, list[PageRecord]] = {}
    for page in pages:
        by_title.setdefault(page.title, []).append(page)
    return by_title


def _resolve_unique_page(
    key: str,
    alias_index: dict[str, str],
    title_pages: dict[str, list[PageRecord]],
) -> PageRecord | None:
    title = alias_index.get(key)
    if title is None:
        return None
    candidates = title_pages.get(title, [])
    if len(candidates) != 1:
        return None
    return candidates[0]


def _canonical_payload(page: PageRecord) -> dict:
    return {
        "path": page.path,
        "title": page.title,
        "source_of_truth": page.frontmatter.get("source_of_truth"),
    }
