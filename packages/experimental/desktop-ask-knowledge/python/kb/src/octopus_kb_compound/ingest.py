from __future__ import annotations

from datetime import datetime
import ipaddress
from pathlib import Path
import urllib.error
import urllib.request
from urllib.parse import urlparse

from octopus_kb_compound.frontmatter import render_frontmatter
from octopus_kb_compound.models import PageMeta

_MAX_RESPONSE_BYTES = 5 * 1024 * 1024


class OptionalDependencyMissing(RuntimeError):
    pass


def _validate_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"Only http/https URLs are allowed, got: {parsed.scheme or 'missing'}")

    host = parsed.hostname or ""
    if not host or host.lower() == "localhost":
        raise ValueError("localhost URLs are not allowed")

    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return

    if address.is_loopback or address.is_private:
        raise ValueError(f"Private network URLs are not allowed: {host}")


def fetch_url_as_markdown(url: str, *, timeout: int = 30) -> tuple[str, dict[str, str]]:
    _validate_url(url)

    req = urllib.request.Request(
        f"https://r.jina.ai/{url}",
        headers={
            "Accept": "text/markdown",
            "User-Agent": "octopus-kb/0.6",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            payload = response.read(_MAX_RESPONSE_BYTES + 1)
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Failed to fetch markdown from Jina Reader: {exc}") from exc

    if len(payload) > _MAX_RESPONSE_BYTES:
        raise RuntimeError("Fetched markdown exceeded the 5 MB response limit")

    body = payload.decode("utf-8")
    title = _extract_title(body) or _slug_from_url(url)
    return body, {
        "title": title,
        "source_url": url,
        "ingest_method": "jina-reader",
        "fetched_at": _now_iso(),
    }


def convert_file_to_markdown(file_path: str) -> tuple[str, dict[str, str]]:
    try:
        from markitdown import MarkItDown
    except ImportError as exc:
        raise OptionalDependencyMissing(
            "markitdown is required for file conversion. "
            "Install with: pip install octopus-kb[ingest]"
        ) from exc

    source_path = Path(file_path)
    result = MarkItDown().convert(str(source_path))
    body = result.text_content
    title = _extract_title(body) or source_path.stem
    return body, {
        "source_file": source_path.name,
        "original_format": source_path.suffix.lstrip("."),
        "converted_at": _now_iso(),
        "ingest_method": "markitdown",
        "title": title,
    }


def generate_raw_page(
    body: str,
    metadata: dict[str, str],
    dest_dir: Path,
    *,
    lang: str = "zh",
    tags: list[str] | None = None,
) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)

    title = metadata.get("title") or _extract_title(body) or _slug_from_url(metadata.get("source_url", "source"))
    meta = PageMeta(
        title=title,
        page_type="raw_source",
        lang=lang,
        role="raw_source",
        layer="source",
        tags=tags or [],
        summary=_first_paragraph(body),
        source_url=metadata.get("source_url"),
        source_file=metadata.get("source_file"),
        original_format=metadata.get("original_format"),
        ingest_method=metadata.get("ingest_method"),
        fetched_at=metadata.get("fetched_at"),
        converted_at=metadata.get("converted_at"),
    )

    path = _resolve_unique_path(dest_dir, _slugify(title))
    rendered_body = body.rstrip()
    content = f"{render_frontmatter(meta)}\n{rendered_body}\n" if rendered_body else f"{render_frontmatter(meta)}\n"
    path.write_text(content, encoding="utf-8")
    return path


def _extract_title(body: str) -> str | None:
    for line in body.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            title = stripped[2:].strip()
            if title:
                return title
    return None


def _slug_from_url(url: str) -> str:
    parsed = urlparse(url)
    segments = []
    if parsed.hostname:
        segments.append(parsed.hostname)
    segments.extend(part for part in parsed.path.split("/") if part)
    raw = "-".join(segments) or "source"
    return _slugify(raw)


def _slugify(title: str) -> str:
    chars: list[str] = []
    last_was_dash = False
    for char in title.strip().lower():
        if char.isalnum():
            chars.append(char)
            last_was_dash = False
            continue
        if not last_was_dash:
            chars.append("-")
            last_was_dash = True

    slug = "".join(chars).strip("-")
    return slug or "source"


def _first_paragraph(body: str) -> str:
    lines = body.replace("\r\n", "\n").replace("\r", "\n").splitlines()
    paragraph: list[str] = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            if paragraph:
                break
            continue
        if stripped.startswith("#"):
            if paragraph:
                break
            continue
        paragraph.append(stripped)
    return " ".join(paragraph).strip()


def _now_iso() -> str:
    return datetime.now().astimezone().replace(microsecond=0).isoformat()


def _resolve_unique_path(dest_dir: Path, slug: str) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)

    candidate = dest_dir / f"{slug}.md"
    if not candidate.exists():
        return candidate

    index = 2
    while True:
        candidate = dest_dir / f"{slug}-{index}.md"
        if not candidate.exists():
            return candidate
        index += 1
