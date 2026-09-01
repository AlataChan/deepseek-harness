from __future__ import annotations

from fnmatch import fnmatch
from pathlib import Path

from octopus_kb_compound.frontmatter import parse_document
from octopus_kb_compound.models import PageRecord, VaultProfile
from octopus_kb_compound.profile import load_vault_profile


def load_page(path: str | Path, root: str | Path | None = None) -> PageRecord:
    page_path = Path(path)
    raw = page_path.read_text(encoding="utf-8", errors="replace")
    frontmatter, body = parse_document(raw)
    title = str(frontmatter.get("title") or page_path.stem)
    stored_path = str(page_path)
    if root is not None:
        try:
            stored_path = page_path.relative_to(Path(root)).as_posix()
        except ValueError:
            stored_path = str(page_path)
    return PageRecord(
        path=stored_path,
        title=title,
        body=body,
        frontmatter=frontmatter,
    )


def scan_markdown_files(root: str | Path, profile: VaultProfile | None = None) -> list[PageRecord]:
    root_path = Path(root)
    profile = profile or load_vault_profile(root_path)
    pages: list[PageRecord] = []
    for path in sorted(root_path.rglob("*.md")):
        relative_path = path.relative_to(root_path)
        if _is_hidden_path(relative_path):
            continue
        if _is_excluded(relative_path, profile):
            continue
        pages.append(load_page(path, root=root_path))
    return pages


def _is_hidden_path(path: Path) -> bool:
    return any(part.startswith(".") for part in path.parts)


def _is_excluded(path: Path, profile: VaultProfile) -> bool:
    path_text = path.as_posix()
    return any(fnmatch(path_text, pattern) for pattern in profile.exclude_globs)
