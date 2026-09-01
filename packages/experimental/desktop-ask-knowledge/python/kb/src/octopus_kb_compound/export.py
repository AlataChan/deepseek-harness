from __future__ import annotations

import json
import os
import shutil
import tempfile
from pathlib import Path

from octopus_kb_compound.links import build_alias_index, extract_wikilinks, frontmatter_aliases, normalize_page_name
from octopus_kb_compound.models import PageRecord
from octopus_kb_compound.profile import load_vault_profile
from octopus_kb_compound.vault import scan_markdown_files


ARTIFACT_NAMES = ("nodes.json", "edges.json", "manifest.json", "aliases.json")


def export_graph_artifacts(vault: str | Path, out_dir: str | Path) -> None:
    root = Path(vault)
    output = Path(out_dir)
    output.mkdir(parents=True, exist_ok=True)

    pages = scan_markdown_files(root, load_vault_profile(root))
    alias_index = build_alias_index(pages)
    nodes = _nodes(pages)
    node_ids = {node["id"] for node in nodes}
    edges = _edges(pages, alias_index, node_ids)
    manifest = {"pages": [page.path for page in pages]}

    with tempfile.TemporaryDirectory(prefix="octopus-export-", dir=str(output.parent)) as workspace:
        staging = Path(workspace) / "staging"
        staging.mkdir()
        _write_json(staging / "nodes.json", nodes)
        _write_json(staging / "edges.json", edges)
        _write_json(staging / "manifest.json", manifest)
        _write_json(staging / "aliases.json", alias_index)

        backup_dir = Path(workspace) / "backup"
        backup_dir.mkdir()
        pre_existing: dict[str, bool] = {}
        for name in ARTIFACT_NAMES:
            target = output / name
            pre_existing[name] = target.exists()
            if target.exists():
                shutil.copy2(target, backup_dir / name)

        committed: list[str] = []
        try:
            for name in ARTIFACT_NAMES:
                _commit_artifact(staging / name, output / name)
                committed.append(name)
        except OSError:
            for name in committed:
                backup = backup_dir / name
                target = output / name
                if pre_existing.get(name) and backup.exists():
                    shutil.copy2(backup, target)
                else:
                    try:
                        target.unlink()
                    except FileNotFoundError:
                        pass
            raise


def _commit_artifact(src: Path, dst: Path) -> None:
    os.replace(src, dst)


def _nodes(pages: list[PageRecord]) -> list[dict]:
    page_nodes: list[dict] = []
    alias_nodes: dict[str, dict] = {}
    for page in pages:
        aliases = frontmatter_aliases(page)
        page_nodes.append(
            {
                "id": _page_id(page),
                "title": page.title,
                "type": str(page.frontmatter.get("type") or page.frontmatter.get("role") or "page"),
                "role": page.frontmatter.get("role"),
                "layer": page.frontmatter.get("layer"),
                "aliases": aliases,
            }
        )
        for alias in aliases:
            node = {
                "id": _alias_id(alias),
                "title": alias,
                "type": "alias",
                "role": None,
                "layer": None,
                "aliases": [],
            }
            alias_nodes.setdefault(node["id"], node)
    return page_nodes + list(alias_nodes.values())


def _edges(pages: list[PageRecord], alias_index: dict[str, str], node_ids: set[str]) -> list[dict]:
    by_title = {page.title: page for page in pages}
    edges: list[dict] = []
    for page in pages:
        source = _page_id(page)
        for link in extract_wikilinks(page.body):
            target_title = alias_index.get(normalize_page_name(link))
            target = by_title.get(target_title or "")
            if target is None:
                continue
            edges.append({"source": source, "target": _page_id(target), "relation_type": "wikilink"})

        related = page.frontmatter.get("related_entities") or []
        if isinstance(related, list):
            for entity in related:
                if not isinstance(entity, str):
                    continue
                target_title = alias_index.get(normalize_page_name(entity))
                target = by_title.get(target_title or "")
                if target is None or target.path == page.path:
                    continue
                edges.append({"source": source, "target": _page_id(target), "relation_type": "wikilink"})

        for alias in frontmatter_aliases(page):
            alias_node = _alias_id(alias)
            if alias_node in node_ids:
                edges.append({"source": alias_node, "target": source, "relation_type": "alias"})
    return _dedupe_edges(edges)


def _page_id(page: PageRecord) -> str:
    return f"page:{page.path}"


def _alias_id(alias: str) -> str:
    return f"alias:{normalize_page_name(alias)}"


def _dedupe_edges(edges: list[dict]) -> list[dict]:
    result: list[dict] = []
    seen: set[tuple[str, str, str]] = set()
    for edge in edges:
        key = (edge["source"], edge["target"], edge["relation_type"])
        if key in seen:
            continue
        seen.add(key)
        result.append(edge)
    return result


def _write_json(path: Path, data: object) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
