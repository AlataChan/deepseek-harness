from __future__ import annotations

import re
from pathlib import PurePosixPath

from octopus_kb_compound.models import LinkSuggestion, PageRecord


def extract_wikilinks(text: str) -> list[str]:
    return re.findall(r"\[\[([^|\]]+)(?:\|[^\]]+)?\]\]", text)


def normalize_page_name(name: str) -> str:
    normalized = name.strip().casefold()
    normalized = re.sub(r"[\W_]+", "", normalized, flags=re.UNICODE)
    return normalized


def build_alias_index(pages: list[PageRecord]) -> dict[str, str]:
    alias_targets = _collect_alias_targets(pages)
    return {
        alias: titles[0]
        for alias, titles in alias_targets.items()
        if len(titles) == 1
    }


def frontmatter_aliases(page: PageRecord) -> list[str]:
    raw_aliases = page.frontmatter.get("aliases", [])
    if not isinstance(raw_aliases, list):
        return []
    return [str(item) for item in raw_aliases]


def find_alias_collisions(pages: list[PageRecord]) -> dict[str, list[str]]:
    alias_targets = _collect_alias_targets(pages)
    return {
        alias: titles
        for alias, titles in alias_targets.items()
        if len(titles) > 1
    }


def suggest_links(
    body: str,
    pages: list[PageRecord],
    max_suggestions: int = 10,
    current_title: str | None = None,
) -> list[LinkSuggestion]:
    alias_index = build_alias_index(pages)
    existing = {normalize_page_name(link) for link in extract_wikilinks(body)}
    current_key = normalize_page_name(current_title or "")
    body_casefold = body.casefold()
    hits: list[tuple[int, LinkSuggestion]] = []
    seen_targets: set[str] = set()

    for page in pages:
        for alias in _page_aliases(page):
            key = normalize_page_name(alias)
            if key in existing:
                continue
            target = alias_index.get(key)
            if target is None:
                continue
            pattern = rf"(?<!\w){re.escape(alias.casefold())}(?!\w)"
            match = re.search(pattern, body_casefold)
            if not match:
                continue
            if normalize_page_name(target) == current_key:
                continue
            if target in seen_targets:
                continue
            seen_targets.add(target)
            hits.append(
                (
                    match.start(),
                    LinkSuggestion(
                        target_title=target,
                        anchor_text=alias,
                        reason=f"Matched canonical title or alias: {alias}",
                    ),
                )
            )

    hits.sort(key=lambda item: item[0])
    return [suggestion for _, suggestion in hits[:max_suggestions]]


def _page_aliases(page: PageRecord) -> list[str]:
    aliases = [page.title]
    aliases.extend(frontmatter_aliases(page))
    aliases.extend(_path_aliases(page.path))
    return _dedupe_preserve_order(aliases)


def _path_aliases(path: str) -> list[str]:
    pure_path = PurePosixPath(path)
    aliases = [pure_path.name, pure_path.stem]
    if len(pure_path.parts) > 1:
        aliases.append(str(pure_path.with_suffix("")))
        aliases.append(str(pure_path))
    return aliases


def _collect_alias_targets(pages: list[PageRecord]) -> dict[str, list[str]]:
    alias_targets: dict[str, list[str]] = {}
    for page in pages:
        for alias in _page_aliases(page):
            key = normalize_page_name(alias)
            if not key:
                continue
            titles = alias_targets.setdefault(key, [])
            if page.title not in titles:
                titles.append(page.title)
    return alias_targets


def _dedupe_preserve_order(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        key = normalize_page_name(item)
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result
