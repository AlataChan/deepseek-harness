from __future__ import annotations

import re

from octopus_kb_compound.links import build_alias_index, extract_wikilinks, normalize_page_name
from octopus_kb_compound.models import LintFinding, PageRecord


def lint_obsidian_pages(pages: list[PageRecord]) -> list[LintFinding]:
    """Return Obsidian-specific wikilink and orphan findings."""

    findings: list[LintFinding] = []
    alias_index = build_alias_index(pages)
    title_lookup = {page.title: page for page in pages}
    inbound_counts = {page.path: 0 for page in pages}

    for page in pages:
        for link in extract_wikilinks(_strip_code_blocks(page.body)):
            if _should_ignore_link_target(link):
                continue
            key = normalize_page_name(link)
            canonical_title = alias_index.get(key)
            if canonical_title is None:
                findings.append(LintFinding("BROKEN_LINK", page.path, f"Broken wikilink: [[{link}]]"))
                continue
            target = title_lookup[canonical_title]
            inbound_counts[target.path] += 1

    for page in pages:
        if page.frontmatter.get("role") == "concept" and inbound_counts.get(page.path, 0) == 0:
            findings.append(LintFinding("ORPHAN_PAGE", page.path, "Concept page has no inbound wikilinks."))

    return findings


def _strip_code_blocks(text: str) -> str:
    text = re.sub(r"```[\s\S]*?```", "", text)
    text = re.sub(r"`[^`\n]+`", "", text)
    return text


def _should_ignore_link_target(target: str) -> bool:
    if target.endswith("/"):
        return True
    if "[" in target or "]" in target:
        return True
    if '"' in target or "'" in target:
        return True
    if "\n" in target:
        return True
    if "," in target and "/" not in target and ".md" not in target:
        segments = [segment.strip() for segment in target.split(",")]
        if segments and all(segment and segment == segment.lower() for segment in segments):
            return True
    if not any(char.isalpha() for char in target):
        return True
    return False
