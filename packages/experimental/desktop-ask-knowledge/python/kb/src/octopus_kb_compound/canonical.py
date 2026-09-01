from __future__ import annotations

from pathlib import Path

from octopus_kb_compound.links import normalize_page_name
from octopus_kb_compound.models import PageRecord


def _canonical_pages_by_key(pages: list[PageRecord]) -> dict[str, list[PageRecord]]:
    result: dict[str, list[PageRecord]] = {}
    for page in pages:
        key = _canonical_key(page)
        if not key:
            continue
        result.setdefault(key, []).append(page)
    return result


def _canonical_key(page: PageRecord) -> str | None:
    frontmatter = page.frontmatter
    role = frontmatter.get("role")
    page_type = frontmatter.get("type")
    layer = frontmatter.get("layer")
    source_of_truth = frontmatter.get("source_of_truth")
    is_raw = role == "raw_source" or page_type == "raw_source"

    if is_raw and source_of_truth != "canonical":
        return None

    canonical_name = frontmatter.get("canonical_name")
    if isinstance(canonical_name, str) and normalize_page_name(canonical_name):
        return normalize_page_name(canonical_name)

    title = str(frontmatter.get("title") or page.title or "")
    if source_of_truth == "canonical" and normalize_page_name(title):
        return normalize_page_name(title)

    if is_raw:
        return None

    if layer != "wiki":
        return None

    if normalize_page_name(title):
        return normalize_page_name(title)

    stem = Path(page.path).stem
    if normalize_page_name(stem):
        return normalize_page_name(stem)

    return None
