from __future__ import annotations

from pathlib import Path

from octopus_kb_compound.adapters.obsidian.codec import canonical_to_page_record
from octopus_kb_compound.adapters.obsidian.store import ObsidianStore
from octopus_kb_compound.ckr.models import StorageRef
from octopus_kb_compound.links import build_alias_index, extract_wikilinks, normalize_page_name
from octopus_kb_compound.models import PageRecord


def find_impacted_pages(page: str | Path, vault: str | Path) -> list[str]:
    vault_path = Path(vault)
    store = ObsidianStore(vault_path)
    target_ref = StorageRef(adapter="obsidian", locator=_relative_page_path(page, vault_path))
    target = canonical_to_page_record(store.read_page(target_ref))
    pages = store.list_page_records()
    by_title = {page.title: page for page in pages}
    alias_index = build_alias_index(pages)

    impacted: list[str] = []
    _append(impacted, target.path)
    _append_entry(impacted, pages, "index")
    _append_entry(impacted, pages, "log")

    for related in _related_targets(target, alias_index, by_title):
        _append(impacted, related.path)

    target_key = normalize_page_name(target.title)
    for candidate in pages:
        if candidate.path == target.path:
            continue
        for link in extract_wikilinks(candidate.body):
            if normalize_page_name(alias_index.get(normalize_page_name(link), "")) == target_key:
                _append(impacted, candidate.path)

    return impacted


def _related_targets(
    page: PageRecord,
    alias_index: dict[str, str],
    by_title: dict[str, PageRecord],
) -> list[PageRecord]:
    targets: list[PageRecord] = []
    for link in extract_wikilinks(page.body):
        title = alias_index.get(normalize_page_name(link))
        if title and title in by_title:
            targets.append(by_title[title])
    raw_related = page.frontmatter.get("related_entities", [])
    if isinstance(raw_related, list):
        for related in raw_related:
            title = alias_index.get(normalize_page_name(str(related)))
            if title and title in by_title:
                targets.append(by_title[title])
    return targets


def _append_entry(paths: list[str], pages: list[PageRecord], role: str) -> None:
    for page in pages:
        if page.frontmatter.get("role") == role:
            _append(paths, page.path)
            return


def _append(paths: list[str], path: str) -> None:
    if path not in paths:
        paths.append(path)


def _relative_page_path(page: str | Path, vault: Path) -> str:
    page_path = Path(page)
    if not page_path.is_absolute():
        return page_path.as_posix()
    try:
        return page_path.resolve().relative_to(vault.resolve()).as_posix()
    except ValueError:
        return page_path.as_posix()
