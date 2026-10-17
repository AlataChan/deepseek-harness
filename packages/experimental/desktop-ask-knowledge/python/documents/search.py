"""Full-text passage indexing and lexical retrieval over raw pages.

Provides:
- Folded text / offset mapping (normalizes Kangxi radicals, ß, combining chars, full-width)
- Literal FTS quoting to safely neutralize operator injection (*, OR, AND, etc.)
- Short-term search for 1- and 2-character Chinese queries
- Ranked excerpts with exact quotation matching the original raw file
- Authorized opaque continuation cursors with cross-library and stale generation checks
- Serialized result budgeting
"""

from __future__ import annotations

from contextlib import closing
import base64
import hashlib
import hmac
import json
from pathlib import Path
import difflib
import os
import secrets
import uuid
import sqlite3
import time
import unicodedata

from .schema import ensure_schema, open_db, SCHEMA_VERSION

def cursor_key(vault: str) -> bytes:
    """Persist a private per-vault signing key; never use a public fallback."""
    path = Path(vault) / ".octopus-kb" / "cursor.key"
    if path.parent.is_symlink():
        raise ValueError("Linked cursor storage refused")
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        key = safe_read(Path(vault), path)
        if len(key) != 32:
            raise ValueError("Private cursor key is incomplete or corrupt")
        return key
    with os.fdopen(fd, "wb") as out:
        key = secrets.token_bytes(32)
        out.write(key)
        out.flush()
        os.fsync(out.fileno())
    return key


def safe_read(vault: Path, path: Path) -> bytes:
    """Refuse link components and validate the opened file's identity."""
    root = vault.resolve(strict=True)
    relative = path.absolute().relative_to(vault.absolute())
    candidate = vault
    for part in relative.parts:
        candidate = candidate / part
        if candidate.is_symlink():
            raise ValueError(f"Linked source refused: {candidate}")
    if not path.resolve(strict=True).is_relative_to(root):
        raise ValueError(f"Source outside vault refused: {path}")
    before = path.stat()
    with path.open("rb") as source:
        opened = os.fstat(source.fileno())
        if (before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino):
            raise ValueError("source changed while opening")
        content = source.read()
    if path.is_symlink() or not path.resolve(strict=True).is_relative_to(root):
        raise ValueError("source changed during read")
    return content


def fold_with_mapping(raw: str) -> tuple[str, list[tuple[int, int]]]:
    """Map expansions and canonical composition back to original character spans."""
    pieces = [unicodedata.normalize("NFKC", c).casefold() for c in raw]
    separate = "".join(pieces)
    spans = [(i, i + 1) for i, piece in enumerate(pieces) for _ in piece]
    folded = unicodedata.normalize("NFKC", raw).casefold()
    if folded == separate:
        return folded, spans
    mapped = []
    for tag, a, b, c, d in difflib.SequenceMatcher(None, separate, folded, autojunk=False).get_opcodes():
        if tag == "equal":
            mapped.extend(spans[a:b])
        elif tag != "delete":
            affected = spans[max(0, a - (a == b)):max(b, a + 1)]
            start = min((x[0] for x in affected), default=0)
            end = max((x[1] for x in affected), default=len(raw))
            mapped.extend([(start, end)] * (d - c))
    return folded, mapped


def make_cursor(
    vault_path: str,
    generation_id: str,
    query_hash: str,
    offset: int,
    document_filter: str | None = None,
    text_offset: int = 0,
    layer: str | None = None,
) -> str:
    payload = {
        "v": hashlib.sha256(vault_path.encode()).hexdigest()[:16],
        "g": generation_id,
        "q": query_hash,
        "df": document_filter or "",
        "o": offset,
        "s": text_offset,
        "t": int(time.time()),
    }
    if layer is not None:
        payload["l"] = layer
    dumped = json.dumps(payload, separators=(",", ":")).encode()
    sig = hmac.new(cursor_key(vault_path), dumped, hashlib.sha256).hexdigest()[:16]
    token = base64.urlsafe_b64encode(dumped + b"." + sig.encode()).decode()
    return token


def decode_cursor(
    token: str,
    vault_path: str,
    generation_id: str,
    query_hash: str,
    document_filter: str | None = None,
    layer: str | None = None,
) -> tuple[int, int]:
    try:
        if len(token) > 2048:
            raise ValueError("cursor too long")
        raw_token = base64.urlsafe_b64decode(token.encode())
        payload_bytes, sig_bytes = raw_token.rsplit(b".", 1)
        expected_sig = hmac.new(cursor_key(vault_path), payload_bytes, hashlib.sha256).hexdigest()[:16].encode()
        if not hmac.compare_digest(sig_bytes, expected_sig):
            raise ValueError("forged cursor signature")

        payload = json.loads(payload_bytes.decode())
        expected_vault = hashlib.sha256(vault_path.encode()).hexdigest()[:16]
        if payload.get("v") != expected_vault:
            raise ValueError("cross-library cursor refused")
        if payload.get("g") != generation_id:
            raise ValueError("stale cursor: index generation changed")
        if payload.get("q") != query_hash:
            raise ValueError("cursor query mismatch")
        if payload.get("df", "") != (document_filter or ""):
            raise ValueError("document_filter mismatch between cursor and query")
        if layer is not None and payload.get("l") and payload.get("l") != layer:
            raise ValueError("layer mismatch between cursor and query")

        offset, text_offset = payload.get("o"), payload.get("s", 0)
        if type(offset) is not int or type(text_offset) is not int or offset < 0 or text_offset < 0:
            raise ValueError("invalid cursor offset")
        return offset, text_offset
    except Exception as exc:
        raise ValueError(f"invalid continuation cursor: {exc}") from exc


def extract_wiki_frontmatter(text: str) -> dict:
    if not text.startswith("---"):
        return {}
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}
    raw_yaml = parts[1]
    res: dict[str, Any] = {}
    for line in raw_yaml.splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            k = k.strip()
            v = v.strip().strip("'\"")
            if v.startswith("[") and v.endswith("]"):
                res[k] = [x.strip().strip("'\"") for x in v[1:-1].split(",") if x.strip()]
            else:
                res[k] = v
    return res


def extract_wikilinks(text: str) -> list[str]:
    import re
    return sorted(set(re.findall(r"\[\[(.*?)\]\]", text)))


def split_into_passages(text: str, rel_path: str) -> list[dict]:
    """Split markdown text into structural passages based on headers or paragraphs."""
    lines = text.splitlines(keepends=True)
    passages: list[dict] = []
    current_title = rel_path
    current_lines: list[str] = []
    current_start = 0
    current_offset = 0

    is_wiki = rel_path.startswith("wiki/")
    frontmatter = extract_wiki_frontmatter(text) if is_wiki else {}
    aliases = frontmatter.get("aliases", [])
    if isinstance(aliases, str):
        aliases = [aliases]
    citations = frontmatter.get("citations", [])
    if isinstance(citations, str):
        citations = [citations]
    coverage_status = frontmatter.get("coverage_status", "wiki-ready") if is_wiki else ""
    wikilinks = extract_wikilinks(text) if is_wiki else []

    in_table = False

    exception_starters = (
        "但", "例外", "不过", "除外", "特别说明", "特殊情况", "特别注意",
        "Exception:", "Note:", "Exceptions:", "Special case:",
    )

    def flush_passage() -> None:
        nonlocal current_lines, current_start
        if not current_lines:
            return
        chunk_text = "".join(current_lines)
        end_offset = current_start + len(chunk_text)
        folded, _ = fold_with_mapping(chunk_text)
        if aliases:
            alias_text = " " + " ".join(aliases)
            folded_alias, _ = fold_with_mapping(alias_text)
            folded = folded + folded_alias
        pid = f"p-{hashlib.sha256(f'{rel_path}:{current_start}:{end_offset}'.encode()).hexdigest()[:12]}"
        passages.append({
            "passage_id": pid,
            "rel_path": rel_path,
            "section_title": current_title,
            "start_offset": current_start,
            "end_offset": end_offset,
            "text": chunk_text,
            "folded_text": folded,
            "citations": citations,
            "coverage_status": coverage_status,
            "related_links": wikilinks,
        })
        current_lines = []

    for idx, line in enumerate(lines):
        stripped = line.strip()

        if stripped.startswith("|") and stripped.endswith("|"):
            if not in_table:
                in_table = True
        else:
            in_table = False

        if stripped.startswith("#"):
            flush_passage()
            current_title = stripped.lstrip("#").strip()
            current_start = current_offset

        current_lines.append(line)
        current_offset += len(line)

        # Keep tables contiguous so source offsets never refer to synthetic headers.
        if not in_table and sum(len(l) for l in current_lines) >= 1500:
            next_line_is_exception = (
                idx + 1 < len(lines)
                and lines[idx + 1].strip().startswith(exception_starters)
            )
            if not next_line_is_exception:
                flush_passage()
                current_start = current_offset

    flush_passage()
    return passages


def library_text_files(vault: Path) -> list[Path]:
    """Search retained raw text and handwritten wiki entries, excluding operational indexes."""
    result = []
    db = vault / '.octopus-kb' / 'documents.sqlite'
    unpublished = set()
    if db.is_file():
        with closing(ensure_schema(db)) as con:
            revisions = con.execute('SELECT document_id, revision_id FROM source_revisions').fetchall()
        for document_id, revision_id in revisions:
            raw_path = f'raw/{document_id}-{revision_id}.md'
            plan_file = vault / '.octopus-kb' / 'document-plans' / (hashlib.sha256(document_id.encode()).hexdigest() + '.json')
            plan = json.loads(plan_file.read_text(encoding='utf-8')) if plan_file.is_file() else None
            if not plan or plan.get('rawPath') != raw_path:
                unpublished.add(raw_path)
    for directory in (vault / 'raw', vault / 'wiki'):
        if directory.is_symlink():
            raise ValueError(f'Linked document directory refused: {directory}')
        if not directory.exists():
            continue
        for path in sorted(directory.glob('**/*.md')):
            if directory.name == 'wiki' and path.name in {'INDEX.md', 'LOG.md'}:
                continue
            if path.relative_to(vault).as_posix() not in unpublished:
                result.append(path)
    return result


def index_raw_vault(vault: Path) -> dict:
    """Build or rebuild a versioned passage index from all readable pages in vault/raw/."""
    db_path = vault / ".octopus-kb" / "documents.sqlite"
    with closing(ensure_schema(db_path)) as con:
        cur = con.cursor()

        raw_dir = vault / "raw"
        if raw_dir.is_symlink():
            raise ValueError("Linked raw directory refused")
        md_files = library_text_files(vault)
        cur.execute("SELECT rel_path, content_hash, mtime FROM raw_documents")
        existing_docs = {row[0]: (row[1], row[2]) for row in cur.fetchall()}
        generation = cur.execute("SELECT generation_id FROM index_meta WHERE status='active'").fetchone()
        rebuild_spans = not generation or not generation[0].startswith('gen-source-spans-v2-')

        active_rel_paths: set[str] = set()
        newly_indexed = 0

        vault_resolved = vault.resolve()
        for file_path in md_files:
            if file_path.is_symlink():
                try:
                    resolved = file_path.resolve()
                    if not resolved.is_relative_to(vault_resolved):
                                    raise ValueError(f"Symlink outside vault refused: {file_path} -> {resolved}")
                except ValueError:
                    raise
                except Exception as exc:
                            raise ValueError(f"Symlink outside vault refused: {file_path}") from exc

            rel = file_path.relative_to(vault).as_posix()
            active_rel_paths.add(rel)

            stat = file_path.stat()
            mtime = stat.st_mtime
            content_bytes = safe_read(vault, file_path)
            content_hash = hashlib.sha256(content_bytes).hexdigest()

            if rel in existing_docs and not rebuild_spans:
                old_hash, old_mtime = existing_docs[rel]
                if old_hash == content_hash and abs(old_mtime - mtime) < 0.001:
                    continue

            text = content_bytes.decode("utf-8", errors="replace")
            passages = split_into_passages(text, rel)

            # Atomically remove old passages
            cur.execute("DELETE FROM raw_passages WHERE rel_path = ?", (rel,))
            cur.execute("DELETE FROM raw_passages_fts WHERE rel_path = ?", (rel,))
            cur.execute("DELETE FROM raw_documents WHERE rel_path = ?", (rel,))

            # Insert document record
            cur.execute(
                """
                INSERT INTO raw_documents (rel_path, content_hash, byte_length, mtime, indexed_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (rel, content_hash, len(content_bytes), mtime, time.time()),
            )

            # Insert passages
            for p in passages:
                cur.execute(
                    """
                    INSERT INTO raw_passages (passage_id, rel_path, section_title, start_offset, end_offset, text, folded_text)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        p["passage_id"],
                        p["rel_path"],
                        p["section_title"],
                        p["start_offset"],
                        p["end_offset"],
                        p["text"],
                        p["folded_text"],
                    ),
                )
                cur.execute(
                    """
                    INSERT INTO raw_passages_fts (passage_id, rel_path, section_title, text, folded_text)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        p["passage_id"],
                        p["rel_path"],
                        p["section_title"],
                        p["text"],
                        p["folded_text"],
                    ),
                )
            newly_indexed += 1

        # Cleanup deleted files
        deleted_paths = set(existing_docs.keys()) - active_rel_paths
        for d_rel in deleted_paths:
            cur.execute("DELETE FROM raw_passages WHERE rel_path = ?", (d_rel,))
            cur.execute("DELETE FROM raw_passages_fts WHERE rel_path = ?", (d_rel,))
            cur.execute("DELETE FROM raw_documents WHERE rel_path = ?", (d_rel,))

        cur.execute("SELECT count(*) FROM raw_passages")
        total_passages = cur.fetchone()[0]

        gen_id = f"gen-source-spans-v2-{uuid.uuid4().hex}"
        cur.execute("DELETE FROM index_meta")
        cur.execute(
            """
            INSERT OR REPLACE INTO index_meta (generation_id, activated_at, passage_count, status)
            VALUES (?, ?, ?, 'active')
            """,
            (gen_id, time.time(), total_passages),
        )

        con.commit()
        return {
            "ok": True,
            "indexed_files": newly_indexed,
            "total_passages": total_passages,
            "generation_id": gen_id,
        }


def is_index_stale(vault: Path, db_path: Path) -> bool:
    """Check if the raw documents index in sqlite needs to be rebuilt or refreshed."""
    if not db_path.is_file():
        return True
    raw_dir = vault / "raw"
    if raw_dir.is_symlink():
        raise ValueError("Linked raw directory refused")
    try:
        con = open_db(db_path)
        try:
            cur = con.cursor()
            cur.execute("SELECT count(*) FROM index_meta WHERE status = 'active'")
            meta_count = cur.fetchone()[0]
            if meta_count == 0:
                return True
            generation = cur.execute("SELECT generation_id FROM index_meta WHERE status='active'").fetchone()
            if not generation or not generation[0].startswith('gen-source-spans-v2-'):
                return True
            cur.execute("SELECT rel_path, content_hash, byte_length FROM raw_documents")
            indexed = {row[0]: (row[1], row[2]) for row in cur.fetchall()}
        finally:
            con.close()
    except Exception:
        return True

    current_files: set[str] = set()
    vault_resolved = vault.resolve()
    for f in library_text_files(vault):
        if f.is_symlink():
            try:
                resolved = f.resolve()
                if not resolved.is_relative_to(vault_resolved):
                    return True
            except Exception:
                return True
        rel = f.relative_to(vault).as_posix()
        current_files.add(rel)
        if rel not in indexed:
            return True
        try:
            stat = f.stat()
            old_hash, old_size = indexed[rel]
            if old_size != stat.st_size or hashlib.sha256(safe_read(vault, f)).hexdigest() != old_hash:
                return True
        except OSError:
            return True

    if set(indexed.keys()) != current_files:
        return True
    return False


def search_passages(
    vault: Path,
    queries: list[str],
    limit: int = 12,
    cursor: str | None = None,
    document_filter: str | None = None,
    max_chars: int = 24000,
    max_bytes: int = 5000,
    layer: str = "auto",
) -> dict:
    """Execute ranked passage search with folded text, excerpts, and continuation."""
    if not 1024 <= max_bytes <= 64000 or not 1 <= max_chars <= 100000 or not 1 <= limit <= 10000:
        raise ValueError("Invalid search allowance")
    db_path = vault / ".octopus-kb" / "documents.sqlite"
    if is_index_stale(vault, db_path):
        index_raw_vault(vault)

    con = open_db(db_path)
    try:
        cur = con.cursor()

        cur.execute("SELECT generation_id FROM index_meta ORDER BY activated_at DESC LIMIT 1")
        gen_row = cur.fetchone()
        generation_id = gen_row[0] if gen_row else "gen-0"

        norm_queries = [unicodedata.normalize("NFKC", q).strip() for q in queries if q.strip()]
        if not norm_queries:
            return {
                "ok": True,
                "items": [],
                "cursor": None,
                "total_matches": 0,
                "generation_id": generation_id,
                "warnings": [],
            }

        wiki_dir = vault / "wiki"
        wiki_files_exist = wiki_dir.is_dir() and any(
            f.suffix == ".md" and f.name not in {"LOG.md", "INDEX.md"} for f in wiki_dir.iterdir()
        ) if wiki_dir.exists() else False

        warnings: list[dict[str, str]] = []
        if layer == "auto":
            if wiki_files_exist:
                effective_layer = "wiki"
            else:
                effective_layer = "raw"
                warnings.append({
                    "code": "wiki_unavailable_fallback",
                    "message": "Wiki is unavailable; fell back to raw source passages.",
                })
        elif layer == "wiki":
            effective_layer = "wiki"
            if not wiki_files_exist:
                warnings.append({
                    "code": "wiki_unavailable",
                    "message": "No compiled wiki pages found in library.",
                })
        elif layer == "raw":
            effective_layer = "raw"
        else:
            effective_layer = "all"

        if effective_layer == "wiki" and not wiki_files_exist:
            warnings.append({
                "code": "no_absence_claim",
                "message": "Keyword misses and bounded searches do not prove that the whole library lacks a fact.",
            })
            return {
                "ok": True,
                "items": [],
                "cursor": None,
                "total_matches": 0,
                "generation_id": generation_id,
                "warnings": warnings,
            }

        q_hash = hashlib.sha256(json.dumps(sorted(norm_queries), ensure_ascii=False).encode()).hexdigest()[:16]
        offset, text_offset = 0, 0
        if cursor is not None and cursor != "":
            offset, text_offset = decode_cursor(cursor, str(vault), generation_id, q_hash, document_filter, layer=effective_layer)

        scored_passages: dict[str, dict] = {}

        for query in norm_queries:
            q_fold = query.casefold()

            # 1. FTS5 search for queries of 3 or more characters
            if len(q_fold) >= 3:
                quoted = '"' + q_fold.replace('"', '""') + '"'
                try:
                    if document_filter:
                        cur.execute(
                            """
                            SELECT passage_id, rel_path, section_title, text, folded_text, rank
                            FROM raw_passages_fts
                            WHERE raw_passages_fts MATCH ? AND rel_path = ?
                            ORDER BY rank
                            LIMIT 10001
                            """,
                            (quoted, document_filter),
                        )
                    else:
                        cur.execute(
                            """
                            SELECT passage_id, rel_path, section_title, text, folded_text, rank
                            FROM raw_passages_fts
                            WHERE raw_passages_fts MATCH ?
                            ORDER BY rank
                            LIMIT 10001
                            """,
                            (quoted,),
                        )
                    for pid, rel, sec, text, f_text, rank in cur.fetchall():
                        if document_filter and rel != document_filter:
                            continue
                        if effective_layer == "wiki" and not rel.startswith("wiki/"):
                            continue
                        if effective_layer == "raw" and not rel.startswith("raw/"):
                            continue
                        if pid not in scored_passages:
                            scored_passages[pid] = {
                                "passage_id": pid,
                                "rel_path": rel,
                                "section_title": sec,
                                "text": text,
                                "folded_text": f_text,
                                "score": 0.0,
                                "matched_terms": set(),
                            }
                        score = float(-rank)
                        if rel == "wiki/INDEX.md":
                            score += 60.0
                        if q_fold in unicodedata.normalize("NFKC", sec).casefold():
                            score += 50.0
                        scored_passages[pid]["score"] += score
                        scored_passages[pid]["matched_terms"].add(query)
                except sqlite3.OperationalError:
                    pass

            # 2. Short-term search or additional recall (1 or 2 characters, or exact substring)
            escaped_q = q_fold.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            if document_filter:
                cur.execute(
                    """
                    SELECT passage_id, rel_path, section_title, text, folded_text
                    FROM raw_passages
                    WHERE folded_text LIKE ? ESCAPE '\\' AND rel_path = ?
                    LIMIT 10001
                    """,
                    (f"%{escaped_q}%", document_filter),
                )
            else:
                cur.execute(
                    """
                    SELECT passage_id, rel_path, section_title, text, folded_text
                    FROM raw_passages
                    WHERE folded_text LIKE ? ESCAPE '\\'
                    LIMIT 10001
                    """,
                    (f"%{escaped_q}%",),
                )
            for pid, rel, sec, text, f_text in cur.fetchall():
                if document_filter and rel != document_filter:
                    continue
                if effective_layer == "wiki" and not rel.startswith("wiki/"):
                    continue
                if effective_layer == "raw" and not rel.startswith("raw/"):
                    continue
                if q_fold not in f_text:
                    continue
                if pid not in scored_passages:
                    scored_passages[pid] = {
                        "passage_id": pid,
                        "rel_path": rel,
                        "section_title": sec,
                        "text": text,
                        "folded_text": f_text,
                        "score": 0.0,
                        "matched_terms": set(),
                    }
                score = 10.0
                if rel == "wiki/INDEX.md":
                    score += 60.0
                if q_fold in unicodedata.normalize("NFKC", sec).casefold():
                    score += 50.0
                count = f_text.count(q_fold)
                score += min(count * 5.0, 30.0)
                scored_passages[pid]["score"] += score
                scored_passages[pid]["matched_terms"].add(query)
        source_hashes = dict(con.execute('SELECT rel_path, content_hash FROM raw_documents').fetchall())
        source_offsets = dict(con.execute('SELECT passage_id, start_offset FROM raw_passages').fetchall())
    finally:
        con.close()

    # Sort deterministically
    ranked = sorted(
        scored_passages.values(),
        key=lambda item: (-item["score"], item["rel_path"], item["passage_id"]),
    )

    # Deduplicate near-identical excerpts and retain document diversity
    diverse_ranked: list[dict] = []
    seen_texts: set[str] = set()
    doc_counts: dict[str, int] = {}
    deferred: list[dict] = []

    for item in ranked:
        norm_snippet = item["folded_text"][:100]
        if norm_snippet in seen_texts:
            continue
        seen_texts.add(norm_snippet)

        doc = item["rel_path"]
        count = doc_counts.get(doc, 0)
        if count < 3:
            doc_counts[doc] = count + 1
            diverse_ranked.append(item)
        else:
            deferred.append(item)

    diverse_ranked.extend(deferred)
    ranked = diverse_ranked

    total_matches = len(ranked)
    if total_matches >= 10001:
        warnings.append({"code": "candidate_limit", "message": "Search candidate limit reached; narrow the query or document filter."})
    if total_matches == 0:
        if effective_layer == "wiki" and wiki_files_exist:
            warnings.append({"code": "wiki_no_hit", "message": "No wiki pages matched the query terms."})
        warnings.append({"code": "no_absence_claim", "message": "Keyword misses and bounded searches do not prove that the whole library lacks a fact."})
    if offset > total_matches:
        raise ValueError("cursor offset outside results")
    result = {"ok": True, "items": [], "cursor": None, "total_matches": total_matches,
              "generation_id": generation_id, "warnings": warnings}
    byte_budget = min(max_bytes, max(4096, max_chars * 4))
    used_chars = 0
    for index in range(offset, min(total_matches, offset + min(100, max(1, limit)))):
        item = ranked[index]
        text = item["text"]
        start = text_offset if index == offset else 0
        if start > len(text):
            raise ValueError("cursor text offset outside passage")
        available = max_chars - used_chars
        if available <= 0:
            result["cursor"] = make_cursor(str(vault), generation_id, q_hash, index, document_filter, start, layer=effective_layer)
            break
        if start == 0:
            folded, mapping = fold_with_mapping(text)
            matches = []
            for term in sorted(item["matched_terms"]):
                needle = unicodedata.normalize("NFKC", term).casefold()
                hit = folded.find(needle)
                if hit >= 0:
                    raw_start = mapping[hit][0]
                    raw_end = mapping[min(len(mapping) - 1, hit + len(needle) - 1)][1]
                    matches.append((raw_start, raw_end))
            if matches:
                hit_start, hit_end = min(matches)
                start = max(0, hit_start - min(200, max(0, (available - (hit_end - hit_start)) // 2)))
        end = min(len(text), start + available, start + 2000)
        is_wiki = item["rel_path"].startswith("wiki/")
        kind = "index" if item["rel_path"] == "wiki/INDEX.md" else ("concept" if is_wiki else "raw_passage")
        entry = {
            "path": item["rel_path"],
            "title": item["section_title"][:64],
            "passageId": item["passage_id"],
            "text": text[start:end],
            "kind": kind,
            "score": round(item["score"], 2),
            "startOffset": start,
            "endOffset": end,
            "verification": "unverified-wiki-summary" if is_wiki else "source-verified",
        }
        if not is_wiki:
            entry.update(sourceRevision='sha256:' + source_hashes[item['rel_path']], sourceStart=source_offsets[item['passage_id']] + start, sourceEnd=source_offsets[item['passage_id']] + end)
        if is_wiki:
            wiki_file = vault / item["rel_path"]
            whole_wiki = wiki_file.read_text(encoding="utf-8", errors="replace") if wiki_file.is_file() else text
            meta = extract_wiki_frontmatter(whole_wiki)
            citations = meta.get("citations", [])
            if isinstance(citations, str):
                citations = [citations]
            if citations:
                entry["citations"] = citations
            coverage_status = meta.get("coverage_status", "wiki-ready")
            if coverage_status:
                entry["coverageStatus"] = coverage_status
            wikilinks = extract_wikilinks(whole_wiki)
            if wikilinks:
                entry["relatedLinks"] = wikilinks
        result["items"].append(entry)
        while end > start:
            result["cursor"] = (make_cursor(str(vault), generation_id, q_hash, index, document_filter, end, layer=effective_layer)
                                if end < len(text) else
                                make_cursor(str(vault), generation_id, q_hash, index + 1, document_filter, layer=effective_layer)
                                if index + 1 < total_matches else None)
            entry["text"], entry["endOffset"] = text[start:end], end
            if not is_wiki:
                entry["sourceEnd"] = source_offsets[item["passage_id"]] + end
            if len(json.dumps(result, ensure_ascii=False).encode()) <= byte_budget:
                break
            end -= max(1, (end - start) // 8)
        if end == start:
            result["items"].pop()
            if not result["items"]:
                raise ValueError("Passage metadata exceeds search allowance")
            result["cursor"] = make_cursor(str(vault), generation_id, q_hash, index, document_filter, start, layer=effective_layer)
            break
        used_chars += end - start
        if end < len(text):
            break
    return result


def read_passage(vault: Path, passage_id: str, cursor: str | None = None, max_chars: int = 1200, max_bytes: int = 5000) -> dict:
    """Read full passage spans through private generation-bound continuation."""
    if type(max_chars) is not int or not 1 <= max_chars <= 100000 or type(max_bytes) is not int or not 1024 <= max_bytes <= 64000:
        raise ValueError("Invalid passage read allowance")
    db = vault / '.octopus-kb' / 'documents.sqlite'
    if is_index_stale(vault, db):
        index_raw_vault(vault)
    con = open_db(db)
    try:
        row = con.execute('SELECT p.rel_path, p.text, d.content_hash, p.start_offset FROM raw_passages p JOIN raw_documents d ON p.rel_path=d.rel_path WHERE p.passage_id=?', (passage_id,)).fetchone()
        generation = con.execute('SELECT generation_id FROM index_meta ORDER BY activated_at DESC LIMIT 1').fetchone()[0]
    finally:
        con.close()
    if row is None:
        raise ValueError('Passage not found in authorized library')
    identity = hashlib.sha256(('read:' + passage_id).encode()).hexdigest()
    _, start = decode_cursor(cursor, str(vault), generation, identity) if cursor else (0, 0)
    if start >= len(row[1]):
        raise ValueError('Cursor beyond passage')
    end = min(len(row[1]), start + max_chars)
    while end > start:
        result = {'ok': True, 'items': [{'path': row[0], 'title': row[0][:160], 'passageId': passage_id,
                'text': row[1][start:end], 'kind': 'concept' if row[0].startswith('wiki/') else 'raw_passage',
                **({'sourceRevision': 'sha256:' + row[2], 'sourceStart': row[3] + start, 'sourceEnd': row[3] + end} if row[0].startswith('raw/') else {})}],
                'cursor': make_cursor(str(vault), generation, identity, 0, text_offset=end) if end < len(row[1]) else None,
                'generation_id': generation, 'total_matches': 1, 'warnings': []}
        if len(json.dumps(result, ensure_ascii=False).encode()) <= max_bytes:
            return result
        end -= max(1, (end - start) // 8)
    raise ValueError('Passage metadata exceeds read allowance')
