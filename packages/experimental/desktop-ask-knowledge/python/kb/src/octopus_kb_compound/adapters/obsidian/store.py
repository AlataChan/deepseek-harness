from __future__ import annotations

import os
import tempfile
from pathlib import Path

from octopus_kb_compound.adapters.base import PreparedWrite, WriteReceipt
from octopus_kb_compound.adapters.obsidian.codec import (
    canonical_page_to_markdown,
    canonical_to_page_record,
    page_record_to_canonical,
)
from octopus_kb_compound.adapters.obsidian.paths import (
    require_obsidian_storage_ref,
    storage_ref_from_path,
)
from octopus_kb_compound.ckr.models import CanonicalPage, CanonicalRef, StorageRef
from octopus_kb_compound.ckr.operations import AddAliasOp, AppendLogOp, CanonicalOp, CreatePageOp
from octopus_kb_compound.frontmatter import parse_document
from octopus_kb_compound.links import build_alias_index, normalize_page_name
from octopus_kb_compound.models import PageRecord, VaultProfile
from octopus_kb_compound.profile import load_vault_profile
from octopus_kb_compound.vault import load_page, scan_markdown_files


class ObsidianStore:
    """Filesystem-backed Obsidian adapter.

    This adapter keeps path-shaped storage refs explicit so existing CLI and
    audit contracts remain stable while callers migrate to CKR operations.
    """

    def __init__(self, root: str | Path, profile: VaultProfile | None = None):
        self.root = Path(root)
        self.profile = profile or load_vault_profile(self.root)

    def list_pages(self) -> list[CanonicalPage]:
        return [
            page_record_to_canonical(page)
            for page in self.list_page_records()
        ]

    def list_page_records(self) -> list[PageRecord]:
        return scan_markdown_files(self.root, self.profile)

    def read_page(self, ref: CanonicalRef | StorageRef) -> CanonicalPage:
        if isinstance(ref, StorageRef):
            storage = require_obsidian_storage_ref(ref)
            return page_record_to_canonical(load_page(self.root / storage.locator, root=self.root))

        matches = [
            page
            for page in self.list_pages()
            if page.ref.id == ref.id
            or normalize_page_name(page.ref.title or "") == normalize_page_name(ref.title or "")
        ]
        if len(matches) != 1:
            raise KeyError(f"canonical page not found: {ref.id}")
        return matches[0]

    def resolve_alias(self, term: str) -> CanonicalRef | None:
        pages = self.list_page_records()
        alias_index = build_alias_index(pages)
        title = alias_index.get(normalize_page_name(term))
        if title is None:
            return None
        candidates = [page for page in pages if page.title == title]
        if len(candidates) != 1:
            return None
        return page_record_to_canonical(candidates[0]).ref

    def read_markdown(self, locator: str) -> str:
        return (self.root / locator).read_text(encoding="utf-8", errors="replace")

    def markdown_by_path(self, pages: list[PageRecord]) -> dict[str, str]:
        return {page.path: self.read_markdown(page.path) for page in pages}

    def prepare_ops(self, ops: list[CanonicalOp]) -> PreparedWrite:
        content_by_path: dict[str, str] = {}
        for op in ops:
            if isinstance(op, AppendLogOp):
                rel_path = require_obsidian_storage_ref(op.target).locator
                current = content_by_path.get(rel_path)
                if current is None:
                    path = self.root / rel_path
                    current = path.read_text(encoding="utf-8") if path.exists() else ""
                if current and not current.endswith("\n"):
                    current += "\n"
                content_by_path[rel_path] = current + op.entry + "\n"
                continue

            if isinstance(op, CreatePageOp):
                storage = require_obsidian_storage_ref(op.page.storage)
                content_by_path[storage.locator] = canonical_page_to_markdown(op.page)
                continue

            if isinstance(op, AddAliasOp):
                rel_path = require_obsidian_storage_ref(op.target).locator
                current = content_by_path.get(rel_path)
                if current is None:
                    current = (self.root / rel_path).read_text(encoding="utf-8")
                frontmatter, body = parse_document(current)
                aliases = frontmatter.get("aliases")
                if not isinstance(aliases, list):
                    aliases = []
                if op.alias not in aliases:
                    aliases.append(op.alias)
                frontmatter["aliases"] = aliases
                content_by_path[rel_path] = _render_page(frontmatter, body)
                continue

            raise ValueError(f"unsupported canonical operation: {op!r}")

        created: list[StorageRef] = []
        modified: list[StorageRef] = []
        for rel_path in sorted(content_by_path):
            ref = storage_ref_from_path(rel_path)
            if (self.root / rel_path).exists():
                modified.append(ref)
            else:
                created.append(ref)
        return PreparedWrite(
            content_by_path=content_by_path,
            created=created,
            modified=modified,
        )

    def apply_ops(
        self,
        ops: list[CanonicalOp],
        *,
        prepared: PreparedWrite | None = None,
        staged_dir: Path | None = None,
    ) -> WriteReceipt:
        prepared = prepared or self.prepare_ops(ops)
        for rel_path, content in prepared.content_by_path.items():
            destination = self.root / rel_path
            destination.parent.mkdir(parents=True, exist_ok=True)
            if staged_dir is not None:
                os.replace(staged_dir / rel_path, destination)
            else:
                _atomic_write_text(destination, content)
        return WriteReceipt(
            created=list(prepared.created),
            modified=list(prepared.modified),
        )


def _render_page(frontmatter: dict, body: str) -> str:
    payload = _render_yaml_floor(frontmatter)
    if body and not body.endswith("\n"):
        body += "\n"
    return f"---\n{payload}---\n{body}"


def _render_yaml_floor(frontmatter: dict) -> str:
    lines: list[str] = []
    for key, value in frontmatter.items():
        if value is None:
            continue
        if isinstance(value, list):
            if not value:
                lines.append(f"{key}: []")
            else:
                lines.append(f"{key}:")
                for item in value:
                    lines.append(f"  - {_quote_scalar(item)}")
            continue
        lines.append(f"{key}: {_quote_scalar(value)}")
    return "\n".join(lines) + "\n"


def _quote_scalar(value) -> str:
    text = str(value)
    escaped = text.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def _atomic_write_text(destination: Path, content: str) -> None:
    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{destination.stem}.",
        suffix=".tmp",
        dir=destination.parent,
        text=True,
    )
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_path, destination)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise
