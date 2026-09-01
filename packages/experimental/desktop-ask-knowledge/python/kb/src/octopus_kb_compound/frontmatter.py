from __future__ import annotations

import textwrap

from octopus_kb_compound.models import PageMeta


class FrontmatterError(ValueError):
    pass


def _quote(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def render_frontmatter(meta: PageMeta) -> str:
    lines = ["---"]
    lines.append(f'title: "{_quote(meta.title)}"')
    lines.append(f"type: {meta.page_type}")
    lines.append(f"lang: {meta.lang}")

    if meta.role:
        lines.append(f"role: {meta.role}")
    if meta.layer:
        lines.append(f"layer: {meta.layer}")
    if meta.canonical_name:
        lines.append(f'canonical_name: "{_quote(meta.canonical_name)}"')
    if meta.status:
        lines.append(f'status: "{_quote(meta.status)}"')
    if meta.source_of_truth:
        lines.append(f'source_of_truth: "{_quote(meta.source_of_truth)}"')
    if meta.workflow:
        lines.append("workflow:")
        for item in meta.workflow:
            lines.append(f'  - "{_quote(item)}"')
    if meta.authors:
        lines.append("authors:")
        for author in meta.authors:
            lines.append(f'  - "{_quote(author)}"')
    if meta.aliases:
        lines.append("aliases:")
        for alias in meta.aliases:
            lines.append(f'  - "{_quote(alias)}"')
    if meta.related_entities:
        lines.append("related_entities:")
        for entity in meta.related_entities:
            lines.append(f'  - "{_quote(entity)}"')
    if meta.changelog:
        lines.append("changelog:")
        for entry in meta.changelog:
            lines.append(f'  - "{_quote(entry)}"')
    if meta.publisher:
        lines.append(f'publisher: "{_quote(meta.publisher)}"')
    if meta.published:
        lines.append(f'published: "{_quote(meta.published)}"')
    if meta.tags:
        lines.append("tags:")
        for tag in meta.tags:
            lines.append(f'  - "{_quote(tag)}"')
    else:
        lines.append("tags: []")
    if meta.source_url:
        lines.append(f'source_url: "{_quote(meta.source_url)}"')
    if meta.source_file:
        lines.append(f'source_file: "{_quote(meta.source_file)}"')
    if meta.original_format:
        lines.append(f'original_format: "{_quote(meta.original_format)}"')
    if meta.ingest_method:
        lines.append(f'ingest_method: "{_quote(meta.ingest_method)}"')
    if meta.fetched_at:
        lines.append(f'fetched_at: "{_quote(meta.fetched_at)}"')
    if meta.converted_at:
        lines.append(f'converted_at: "{_quote(meta.converted_at)}"')
    if meta.summary is not None:
        summary = meta.summary.strip()
        if summary:
            lines.append("summary: |")
            for wrapped in textwrap.wrap(summary, width=72):
                lines.append(f"  {wrapped}")
        else:
            lines.append('summary: ""')
    lines.append("---")
    return "\n".join(lines)


def parse_document(raw: str, *, strict: bool = False) -> tuple[dict, str]:
    normalized = raw.replace("\r\n", "\n").replace("\r", "\n")
    if not normalized.startswith("---\n"):
        return {}, raw

    lines = normalized.splitlines()
    fm_lines: list[str] = []
    end = None
    for idx, line in enumerate(lines[1:], start=1):
        if line == "---":
            end = idx
            break
        fm_lines.append(line)

    if end is None:
        if strict:
            raise FrontmatterError("frontmatter opened but never closed")
        return {}, raw

    frontmatter = _parse_frontmatter_lines(fm_lines)
    body = "\n".join(lines[end + 1 :])
    return frontmatter, body


def _parse_frontmatter_lines(lines: list[str]) -> dict:
    data: dict[str, object] = {}
    current_key: str | None = None
    current_list: list[str] | None = None
    in_block = False
    block_lines: list[str] = []

    for line in lines:
        if in_block:
            if line.startswith("  "):
                block_lines.append(line[2:])
                continue
            data[current_key or "summary"] = "\n".join(block_lines).strip()
            in_block = False
            block_lines = []
            current_key = None

        if current_list is not None:
            if line.startswith("  - "):
                current_list.append(_strip_value(line[4:]))
                continue
            data[current_key or ""] = current_list
            current_key = None
            current_list = None

        if ":" not in line:
            continue

        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if value == "|":
            current_key = key
            in_block = True
            continue
        if value == "":
            current_key = key
            current_list = []
            continue
        if value == "[]":
            data[key] = []
            current_key = None
            continue
        data[key] = _strip_value(value)

    if current_list is not None and current_key is not None:
        data[current_key] = current_list
    if in_block and current_key is not None:
        data[current_key] = "\n".join(block_lines).strip()
    return data


def _strip_value(value: str) -> str:
    value = value.strip()
    if value.startswith('"') and value.endswith('"'):
        return value[1:-1].replace("\\\\", "\\").replace('\\"', '"')
    if value.startswith("'") and value.endswith("'"):
        return value[1:-1].replace("''", "'")
    return value
