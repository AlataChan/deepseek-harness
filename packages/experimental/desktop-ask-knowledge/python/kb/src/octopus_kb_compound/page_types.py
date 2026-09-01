from __future__ import annotations

from octopus_kb_compound.models import PageMeta


def make_concept_meta(
    title: str,
    *,
    lang: str = "en",
    aliases: list[str] | None = None,
    related_entities: list[str] | None = None,
    summary: str | None = None,
    tags: list[str] | None = None,
    status: str = "active",
) -> PageMeta:
    return _make_wiki_meta(
        title,
        page_type="concept",
        role="concept",
        lang=lang,
        aliases=aliases,
        related_entities=related_entities,
        summary=summary,
        tags=tags,
        status=status,
    )


def make_entity_meta(
    title: str,
    *,
    lang: str = "en",
    aliases: list[str] | None = None,
    related_entities: list[str] | None = None,
    summary: str | None = None,
    tags: list[str] | None = None,
    status: str = "active",
) -> PageMeta:
    return _make_wiki_meta(
        title,
        page_type="entity",
        role="entity",
        lang=lang,
        aliases=aliases,
        related_entities=related_entities,
        summary=summary,
        tags=tags,
        status=status,
    )


def make_comparison_meta(
    title: str,
    *,
    lang: str = "en",
    aliases: list[str] | None = None,
    related_entities: list[str] | None = None,
    summary: str | None = None,
    tags: list[str] | None = None,
    status: str = "active",
) -> PageMeta:
    return _make_wiki_meta(
        title,
        page_type="comparison",
        role="comparison",
        lang=lang,
        aliases=aliases,
        related_entities=related_entities,
        summary=summary,
        tags=tags,
        status=status,
    )


def make_timeline_meta(
    title: str,
    *,
    lang: str = "en",
    aliases: list[str] | None = None,
    related_entities: list[str] | None = None,
    summary: str | None = None,
    tags: list[str] | None = None,
    status: str = "active",
) -> PageMeta:
    return _make_wiki_meta(
        title,
        page_type="timeline",
        role="timeline",
        lang=lang,
        aliases=aliases,
        related_entities=related_entities,
        summary=summary,
        tags=tags,
        status=status,
    )


def make_changelog_meta(
    title: str,
    *,
    lang: str = "en",
    aliases: list[str] | None = None,
    changelog: list[str] | None = None,
    summary: str | None = None,
    tags: list[str] | None = None,
    status: str = "active",
) -> PageMeta:
    return PageMeta(
        title=title,
        page_type="log",
        lang=lang,
        role="log",
        layer="wiki",
        aliases=aliases or [],
        changelog=changelog or [],
        summary=summary,
        tags=tags or [],
        canonical_name=title,
        status=status,
        source_of_truth="canonical",
    )


def _make_wiki_meta(
    title: str,
    *,
    page_type: str,
    role: str,
    lang: str,
    aliases: list[str] | None,
    related_entities: list[str] | None,
    summary: str | None,
    tags: list[str] | None,
    status: str,
) -> PageMeta:
    return PageMeta(
        title=title,
        page_type=page_type,
        lang=lang,
        role=role,
        layer="wiki",
        tags=tags or [],
        aliases=aliases or [],
        summary=summary,
        canonical_name=title,
        status=status,
        source_of_truth="canonical",
        related_entities=related_entities or [],
    )
