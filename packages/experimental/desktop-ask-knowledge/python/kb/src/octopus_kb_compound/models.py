from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class PageMeta:
    title: str
    page_type: str
    lang: str
    tags: list[str] = field(default_factory=list)
    role: str | None = None
    layer: str | None = None
    workflow: list[str] | None = None
    summary: str | None = None
    publisher: str | None = None
    published: str | None = None
    authors: list[str] | None = None
    aliases: list[str] | None = None
    source_url: str | None = None
    source_file: str | None = None
    original_format: str | None = None
    ingest_method: str | None = None
    fetched_at: str | None = None
    converted_at: str | None = None
    canonical_name: str | None = None
    status: str | None = None
    source_of_truth: str | None = None
    related_entities: list[str] = field(default_factory=list)
    changelog: list[str] = field(default_factory=list)


@dataclass(slots=True)
class PageRecord:
    path: str
    title: str
    body: str
    frontmatter: dict[str, Any]


@dataclass(slots=True)
class LinkSuggestion:
    target_title: str
    anchor_text: str
    reason: str


@dataclass(slots=True)
class LintFinding:
    code: str
    path: str
    message: str


@dataclass(slots=True)
class VaultProfile:
    schema: str | None = None
    index: str | None = None
    exclude_globs: list[str] = field(default_factory=list)
