from __future__ import annotations

from octopus_kb_compound.adapters.obsidian.codec import page_record_to_canonical
from octopus_kb_compound.adapters.obsidian.lint_obsidian import lint_obsidian_pages
from octopus_kb_compound.ckr.lint import lint_ckr_pages
from octopus_kb_compound.models import LintFinding, PageRecord


def lint_pages(pages: list[PageRecord]) -> list[LintFinding]:
    """Return CKR-level findings plus Obsidian-specific wikilink findings.

    `MISSING_ROLE` and `MISSING_SUMMARY` remain for backward compatibility;
    they are legacy equivalents of schema missing-field findings.
    """

    canonical_pages = [page_record_to_canonical(page) for page in pages]
    return lint_ckr_pages(canonical_pages) + lint_obsidian_pages(pages)
