from __future__ import annotations

from octopus_kb_compound.canonical import _canonical_pages_by_key
from octopus_kb_compound.ckr.models import CanonicalPage
from octopus_kb_compound.links import (
    build_alias_index,
    find_alias_collisions,
    frontmatter_aliases,
    normalize_page_name,
)
from octopus_kb_compound.models import LintFinding, PageRecord
from octopus_kb_compound.schema import validate_frontmatter


def lint_ckr_pages(pages: list[CanonicalPage]) -> list[LintFinding]:
    """Return CKR-level schema, identity, and alias findings."""

    records = [_page_record(page) for page in pages]
    findings: list[LintFinding] = []
    for page in records:
        for sf in validate_frontmatter(page.frontmatter):
            findings.append(
                LintFinding(
                    code=sf.code,
                    path=page.path,
                    message=f"{sf.field}: {sf.message}",
                )
            )

    alias_index = build_alias_index(records)
    title_lookup = {page.title: page for page in records}
    canonical_by_key = _canonical_pages_by_key(records)
    alias_collisions = find_alias_collisions(records)

    for alias, titles in alias_collisions.items():
        findings.append(
            LintFinding(
                "ALIAS_COLLISION",
                ",".join(sorted(title_lookup[title].path for title in titles)),
                f"Alias `{alias}` resolves to multiple pages: {', '.join(sorted(titles))}",
            )
        )

    for key, canonical_pages in canonical_by_key.items():
        if len(canonical_pages) > 1:
            findings.append(
                LintFinding(
                    "DUPLICATE_CANONICAL_PAGE",
                    ",".join(sorted(page.path for page in canonical_pages)),
                    f"Canonical identity `{key}` is declared by multiple pages.",
                )
            )

    for page in records:
        frontmatter = page.frontmatter
        role = frontmatter.get("role")
        layer = frontmatter.get("layer")
        summary = frontmatter.get("summary")

        if not role:
            findings.append(LintFinding("MISSING_ROLE", page.path, "Page is missing `role`."))
        if layer == "wiki" and not summary:
            findings.append(LintFinding("MISSING_SUMMARY", page.path, "Wiki page is missing `summary`."))

        findings.extend(
            _lint_frontmatter_aliases(page, alias_index, alias_collisions, canonical_by_key)
        )

    return findings


def _lint_frontmatter_aliases(
    page: PageRecord,
    alias_index: dict[str, str],
    alias_collisions: dict[str, list[str]],
    canonical_by_key: dict[str, list[PageRecord]],
) -> list[LintFinding]:
    findings: list[LintFinding] = []
    for alias in frontmatter_aliases(page):
        key = normalize_page_name(alias)
        if not key:
            findings.append(LintFinding("UNRESOLVED_ALIAS", page.path, f"Frontmatter alias cannot resolve: {alias!r}"))
            continue

        canonical_targets = [target for target in canonical_by_key.get(key, []) if target.path != page.path]
        if canonical_targets:
            findings.append(
                LintFinding(
                    "CANONICAL_ALIAS_COLLISION",
                    page.path,
                    f"Frontmatter alias `{alias}` collides with canonical page `{canonical_targets[0].title}`.",
                )
            )
            continue

        if key in alias_collisions:
            continue

        if alias_index.get(key) != page.title:
            findings.append(LintFinding("UNRESOLVED_ALIAS", page.path, f"Frontmatter alias does not resolve to this page: {alias}"))
    return findings


def _page_record(page: CanonicalPage) -> PageRecord:
    path = page.storage.locator if page.storage is not None else page.ref.id
    return PageRecord(
        path=path,
        title=page.title,
        body=page.body,
        frontmatter=dict(page.metadata),
    )
