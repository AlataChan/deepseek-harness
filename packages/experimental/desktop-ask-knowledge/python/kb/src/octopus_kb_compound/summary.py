from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from octopus_kb_compound.lint import lint_pages
from octopus_kb_compound.models import PageRecord
from octopus_kb_compound.profile import load_vault_profile
from octopus_kb_compound.vault import scan_markdown_files


@dataclass(slots=True)
class VaultSummary:
    total_pages: int
    types: Counter[str] = field(default_factory=Counter)
    roles: Counter[str] = field(default_factory=Counter)
    layers: Counter[str] = field(default_factory=Counter)
    lint_findings: Counter[str] = field(default_factory=Counter)
    entries: dict[str, str] = field(default_factory=dict)


def summarize_vault(root: str | Path) -> VaultSummary:
    root_path = Path(root)
    profile = load_vault_profile(root_path)
    pages = scan_markdown_files(root_path, profile)
    findings = lint_pages(pages)
    return VaultSummary(
        total_pages=len(pages),
        types=Counter(_field(page, "type") for page in pages),
        roles=Counter(_field(page, "role") for page in pages),
        layers=Counter(_field(page, "layer") for page in pages),
        lint_findings=Counter(finding.code for finding in findings),
        entries=_entry_presence(pages),
    )


def render_summary(summary: VaultSummary) -> str:
    lines = [f"total_pages\t{summary.total_pages}"]
    lines.extend(_render_counter("type", summary.types))
    lines.extend(_render_counter("role", summary.roles))
    lines.extend(_render_counter("layer", summary.layers))
    lines.extend(_render_counter("lint", summary.lint_findings))
    for name in sorted(summary.entries):
        lines.append(f"entry\t{name}\t{summary.entries[name]}")
    return "\n".join(lines)


def _field(page: PageRecord, name: str) -> str:
    value = page.frontmatter.get(name)
    if value:
        return str(value)
    return "missing"


def _render_counter(prefix: str, values: Counter[str]) -> list[str]:
    return [f"{prefix}\t{name}\t{values[name]}" for name in sorted(values)]


def _entry_presence(pages: list[PageRecord]) -> dict[str, str]:
    roles = {str(page.frontmatter.get("role") or "") for page in pages}
    paths = {page.path for page in pages}
    return {
        "schema": "present" if "schema" in roles or "AGENTS.md" in paths else "missing",
        "index": "present" if "index" in roles or "wiki/INDEX.md" in paths else "missing",
        "log": "present" if "log" in roles or "wiki/LOG.md" in paths else "missing",
    }
