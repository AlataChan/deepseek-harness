#!/usr/bin/env python3
"""JSON stdin/stdout entry for the octopus_DSH ask-knowledge sidecar."""

from __future__ import annotations

import hashlib
import io
import json
import os
import sys
import tempfile
import traceback
from pathlib import Path


def _kb_root() -> Path:
    env = os.environ.get("OCTOPUS_KB_ROOT", "").strip()
    if env:
        return Path(env)
    here = Path(__file__).resolve().parent
    vendored = here / "kb"
    if (vendored / "prompts" / "propose.md").is_file():
        return vendored
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass is not None:
        return Path(meipass)
    return here


def _ensure_path() -> Path:
    root = _kb_root()
    src = root / "src"
    if src.is_dir() and str(src) not in sys.path:
        sys.path.insert(0, str(src))
    os.environ.setdefault("OCTOPUS_KB_ROOT", str(root))
    return root


def _read_page_text(vault: Path, rel_path: str, limit: int = 4000) -> str:
    path = vault / rel_path
    if not path.is_file():
        return ""
    text = path.read_text(encoding="utf-8", errors="replace")
    return text if len(text) <= limit else text[:limit]


def _kind_for(path: str, bundle: dict) -> str:
    concepts = {item.get("path") for item in bundle.get("concepts", [])}
    entities = {item.get("path") for item in bundle.get("entities", [])}
    raws = {item.get("path") for item in bundle.get("raw_sources", [])}
    if path in concepts:
        return "concept"
    if path in entities:
        return "entity"
    if path in raws:
        return "raw"
    if path.endswith("AGENTS.md"):
        return "concept"
    return "raw"


def cmd_self_test(req: dict) -> dict:
    root = _ensure_path()
    import octopus_kb_compound  # noqa: F401

    prompt = root / "prompts" / "propose.md"
    schema = root / "schemas" / "llm" / "proposal.json"
    if not prompt.is_file():
        raise RuntimeError(f"missing {prompt}")
    if not schema.is_file():
        raise RuntimeError(f"missing {schema}")
    from octopus_kb_compound.proposals import _schema_path, kb_resource_root
    from octopus_kb_compound.apply import _builtins_rules_path
    from octopus_kb_compound.propose import fill_create_page_frontmatter

    proposal_schema = _schema_path()
    if not proposal_schema.is_file():
        raise RuntimeError(f"missing proposal schema {proposal_schema}")
    rules = _builtins_rules_path()
    if not rules.is_file():
        raise RuntimeError(f"missing apply rules {rules}")
    rules_schema = kb_resource_root() / "schemas" / "rules" / "v1.json"
    if not rules_schema.is_file():
        raise RuntimeError(f"missing rules schema {rules_schema}")
    try:
        import markitdown  # noqa: F401

        has_markitdown = True
    except ImportError:
        has_markitdown = False
    try:
        import pdfminer  # noqa: F401
        import pdfplumber  # noqa: F401

        has_pdf = True
    except ImportError:
        has_pdf = False
    try:
        import openpyxl  # noqa: F401

        has_xlsx = True
    except ImportError:
        has_xlsx = False
    try:
        import pypdf
        from documents import convert as document_convert

        has_pypdf = callable(pypdf.PdfReader)
        has_document_pdf = document_convert.pypdf is not None and callable(document_convert.inspect_pdf)
    except ImportError:
        has_pypdf = False
        has_document_pdf = False
    from documents.runtime_check import check_sqlite_runtime

    sqlite_runtime = check_sqlite_runtime()
    filled = {
        "operations": [
            {
                "op": "create_page",
                "frontmatter": {"title": "t", "type": "concept", "lang": "zh"},
                "body": "b",
            }
        ]
    }
    fill_create_page_frontmatter(filled)
    frontmatter = filled["operations"][0]["frontmatter"]
    if frontmatter.get("role") != "concept" or frontmatter.get("layer") != "wiki":
        raise RuntimeError("fill_create_page_frontmatter did not set role and layer")
    _assert_retrieve_fold()
    _assert_convert_file()
    key = os.environ.get("DEEPSEEK_API_KEY", "")
    result = {
        "ok": True,
        "compound": True,
        "prompts": True,
        "schemas": True,
        "proposalSchema": True,
        "applyRules": True,
        "rulesSchema": True,
        "pageMetaFill": True,
        "retrieveFold": True,
        "convertFile": True,
        "markitdown": has_markitdown,
        "pdf": has_pdf,
        "pypdf": has_pypdf,
        "documentPdf": has_document_pdf,
        "sqliteRuntime": sqlite_runtime["ok"],
        "xlsx": has_xlsx,
        "hasDeepseekKey": bool(key),
    }
    if req.get("expectKey") is True:
        result["hasDeepseekKey"] = bool(key)
    if os.environ.get("ASK_KNOWLEDGE_SIDECAR_KEY_HASH") == "1":
        result["keyHash"] = hashlib.sha256(key.encode("utf-8")).hexdigest()
    return result


def _assert_retrieve_fold() -> None:
    from octopus_kb_compound.retrieve import build_retrieval_bundle

    # ⾯向…“⼀⽼⼀⼩” — Kangxi radicals that NFKC-fold to 一老一小
    body = "\u2faf\u5411\u2fbc\u8d28\u91cf\u53d1\u5c55\u7684\u201c\u2f00\u2f7c\u2f00\u2f29\u201d\u653f\u7b56"
    vault = Path(tempfile.mkdtemp(prefix="kb-retrieve-fold-"))
    page = vault / "raw" / "kangxi.md"
    page.parent.mkdir(parents=True, exist_ok=True)
    page.write_text(
        "---\ntitle: policy\nrole: raw_source\n---\n" + body + "\n",
        encoding="utf-8",
    )
    bundle = build_retrieval_bundle(vault, "一老一小")
    if not bundle.raw_source_items:
        raise RuntimeError("retrieve did not fold Kangxi radicals to CJK")


def _assert_convert_file() -> None:
    folder = Path(tempfile.mkdtemp(prefix="kb-convert-"))
    source = folder / "note.md"
    source.write_text("# 仅本会话\n正文\n", encoding="utf-8")
    result = cmd_convert_file({"path": str(source)})
    if not result.get("ok") or "正文" not in result.get("body", ""):
        raise RuntimeError("convert-file did not return markdown body")
    if (folder / "raw").is_dir():
        raise RuntimeError("convert-file wrote a vault")


def cmd_bootstrap(req: dict) -> dict:
    vault = Path(req["vault"])
    vault.mkdir(parents=True, exist_ok=True)
    (vault / "wiki").mkdir(exist_ok=True)
    (vault / "raw").mkdir(exist_ok=True)
    (vault / ".octopus-kb").mkdir(exist_ok=True)
    config = vault / ".octopus-kb" / "config.toml"
    if not config.is_file():
        config.write_text(
            "version = 1\n"
            "[llm]\n"
            'default_profile = "deepseek"\n'
            "[llm.profiles.deepseek]\n"
            'base_url = "https://api.deepseek.com"\n'
            'model = "deepseek-v4-flash"\n'
            'api_key_env = "DEEPSEEK_API_KEY"\n',
            encoding="utf-8",
        )
    return {"ok": True, "vault": str(vault)}


def cmd_recover(req: dict) -> dict:
    _ensure_path()
    from octopus_kb_compound.apply import recover_proposal

    result = recover_proposal(req["proposalId"], req["vault"]).to_dict()
    return {"ok": True, **result}


def _cell_text(value: object) -> str:
    if value is None:
        return ""
    return str(value).replace("|", "\\|").replace("\n", " ")


def _markdown_table(rows: list[list[str]]) -> str:
    if not rows:
        return ""
    width = max(len(row) for row in rows)
    padded = [row + [""] * (width - len(row)) for row in rows]
    header = padded[0]
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join(["---"] * width) + " |",
    ]
    for row in padded[1:]:
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


def _decode_text_file(source: Path) -> str:
    raw = source.read_bytes()
    if raw.startswith(b"\xef\xbb\xbf"):
        return raw.decode("utf-8-sig")
    try:
        from charset_normalizer import from_bytes

        best = from_bytes(raw).best()
        if best is not None:
            return str(best)
    except ImportError:
        pass
    for encoding in ("utf-8", "gb18030", "gbk"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _csv_to_markdown(source: Path) -> tuple[str, dict[str, str]]:
    import csv
    import io

    rows = [[_cell_text(cell) for cell in row] for row in csv.reader(io.StringIO(_decode_text_file(source)))]
    return _markdown_table(rows), {
        "title": source.stem,
        "source_file": source.name,
        "original_format": "csv",
        "ingest_method": "csv",
    }


def _xlsx_to_markdown(source: Path) -> tuple[str, dict[str, str]]:
    from openpyxl import load_workbook

    workbook = load_workbook(source, read_only=True, data_only=True)
    parts: list[str] = []
    try:
        for name in workbook.sheetnames:
            sheet = workbook[name]
            rows = [[_cell_text(cell) for cell in row] for row in sheet.iter_rows(values_only=True)]
            rows = [row for row in rows if any(cell.strip() for cell in row)]
            if not rows:
                continue
            parts.append(f"## {name}\n\n{_markdown_table(rows)}")
    finally:
        workbook.close()
    body = "\n\n".join(parts)
    return body, {
        "title": source.stem,
        "source_file": source.name,
        "original_format": "xlsx",
        "ingest_method": "openpyxl",
    }


def _convert_source(source: Path, *, session_attachment: bool = False) -> dict:
    from octopus_kb_compound.ingest import OptionalDependencyMissing, convert_file_to_markdown

    ext = source.suffix.lower()
    if ext in {".md", ".txt"}:
        body = source.read_text(encoding="utf-8", errors="replace")
        metadata = {
            "title": source.stem,
            "source_file": source.name,
            "original_format": ext.lstrip("."),
            "ingest_method": "copy",
        }
    elif ext == ".xlsx":
        try:
            body, metadata = _xlsx_to_markdown(source)
        except ImportError as exc:
            return {"ok": False, "error": str(exc), "code": "type-unsupported"}
        except Exception as exc:  # noqa: BLE001 — sidecar ingest boundary
            return {"ok": False, "error": str(exc), "code": "ingest-failed"}
    elif ext == ".csv":
        try:
            body, metadata = _csv_to_markdown(source)
        except Exception as exc:  # noqa: BLE001 — sidecar ingest boundary
            return {"ok": False, "error": str(exc), "code": "ingest-failed"}
    else:
        try:
            body, metadata = convert_file_to_markdown(str(source))
        except OptionalDependencyMissing as exc:
            return {"ok": False, "error": str(exc), "code": "type-unsupported"}
        except Exception as exc:  # noqa: BLE001 — sidecar ingest boundary
            return {"ok": False, "error": str(exc), "code": "ingest-failed"}
    if body.strip() == "":
        if ext == ".pdf":
            empty = (
                "这份 PDF 没有可提取的文字。扫描件还不能作为会话附件。"
                if session_attachment
                else "这份 PDF 没有可提取的文字。扫描件还不能入库。"
            )
        elif ext in {".csv", ".xlsx"}:
            empty = "这份表格是空的。"
        else:
            empty = "这份文件没有可提取的文字。"
        return {"ok": False, "error": empty, "code": "ingest-failed"}
    return {"ok": True, "body": body, "metadata": metadata}


def cmd_ingest_file(req: dict) -> dict:
    _ensure_path()
    from octopus_kb_compound.ingest import generate_raw_page

    source = Path(req["path"])
    vault = Path(req["vault"])
    converted = _convert_source(source)
    if not converted.get("ok"):
        return converted
    dest = generate_raw_page(converted["body"], converted["metadata"], vault / "raw", lang="zh")
    rel = dest.relative_to(vault).as_posix()
    return {"ok": True, "rawRelPath": rel}


def cmd_convert_file(req: dict) -> dict:
    _ensure_path()
    source = Path(req["path"])
    ext = source.suffix.lower()
    if ext not in {".md", ".txt", ".html", ".htm", ".pdf"}:
        return {
            "ok": False,
            "error": "仅支持 Markdown、TXT、HTML、PDF。表格请走问数据。",
            "code": "type-unsupported",
        }
    converted = _convert_source(source, session_attachment=True)
    if not converted.get("ok"):
        return converted
    metadata = converted["metadata"]
    return {
        "ok": True,
        "body": converted["body"],
        "title": metadata["title"],
        "sourceFile": metadata["source_file"],
    }


def cmd_propose(req: dict) -> dict:
    _ensure_path()
    from octopus_kb_compound.propose import ProposeInputError, ProposeRuntimeError, propose_from_raw

    try:
        result = propose_from_raw(req["rawFile"], req["vault"]).to_dict()
    except (ProposeInputError, ProposeRuntimeError) as exc:
        return {"ok": False, "error": str(exc)}
    return {"ok": True, **result}


def cmd_validate_apply(req: dict) -> dict:
    _ensure_path()
    from octopus_kb_compound.apply import ValidateInputError, ValidateRuntimeError, validate_proposal_file

    try:
        result = validate_proposal_file(req["proposal"], req["vault"], apply=True).to_dict()
    except (ValidateInputError, ValidateRuntimeError) as exc:
        return {"ok": False, "error": str(exc)}
    return {"ok": True, **result}


def cmd_retrieve_bundle(req: dict) -> dict:
    _ensure_path()
    from octopus_kb_compound import retrieve as retrieve_mod
    from octopus_kb_compound.retrieve import build_retrieval_bundle

    vault = Path(req["vault"])
    query = req["query"]
    from octopus_kb_compound.heal import heal_page_meta_rejections

    heal_page_meta_rejections(vault)
    bundle = build_retrieval_bundle(vault, query)
    try:
        retrieve_mod._touch_marker(vault)
    except OSError:
        pass
    data = bundle.to_dict()
    inner = data.get("bundle", {})
    items = []
    seen: set[str] = set()
    for group, kind in (
        (inner.get("concepts", []), "concept"),
        (inner.get("entities", []), "entity"),
    ):
        for item in group:
            path = item.get("path")
            if not path or path in seen:
                continue
            seen.add(path)
            items.append(
                {
                    "path": path,
                    "title": item.get("title") or path,
                    "reason": item.get("reason") or "",
                    "kind": kind,
                    "text": _read_page_text(vault, path),
                }
            )

    # Integrated full-text passage retrieval for raw pages
    try:
        from documents.search import search_passages
        passage_res = search_passages(vault, [query], limit=12)
        p_items = passage_res.get("items", [])
        if p_items:
            for p in p_items:
                p_key = p.get("passageId") or p.get("path")
                if p_key in seen:
                    continue
                seen.add(p_key)
                items.append({
                    "path": p.get("path"),
                    "title": p.get("title"),
                    "reason": "passage_match",
                    "kind": "raw",
                    "text": p.get("text", ""),
                    "passageId": p.get("passageId"),
                })
        else:
            for item in inner.get("raw_sources", []):
                path = item.get("path")
                if not path or path in seen:
                    continue
                seen.add(path)
                items.append(
                    {
                        "path": path,
                        "title": item.get("title") or path,
                        "reason": item.get("reason") or "",
                        "kind": "raw",
                        "text": _read_page_text(vault, path),
                    }
                )
    except Exception:
        for item in inner.get("raw_sources", []):
            path = item.get("path")
            if not path or path in seen:
                continue
            seen.add(path)
            items.append(
                {
                    "path": path,
                    "title": item.get("title") or path,
                    "reason": item.get("reason") or "",
                    "kind": "raw",
                    "text": _read_page_text(vault, path),
                }
            )

    return {
        "ok": True,
        "query": query,
        "items": items,
        "warnings": data.get("warnings", []),
        "token_estimate": data.get("token_estimate", 0),
    }


def cmd_passage_search(req: dict) -> dict:
    _ensure_path()
    from documents.search import search_passages

    vault = Path(req["vault"])
    queries = req.get("queries") or ([req["query"]] if "query" in req else [])
    limit = int(req.get("limit", 12))
    cursor = req.get("cursor")
    doc_filter = req.get("documentFilter") or req.get("document_filter")
    max_chars = int(req.get("maxChars", 24000))
    return search_passages(
        vault,
        queries,
        limit=limit,
        cursor=cursor,
        document_filter=doc_filter,
        max_chars=max_chars,
        max_bytes=int(req.get("maxBytes", 5000)),
    )


def cmd_index_vault(req: dict) -> dict:
    _ensure_path()
    from documents.search import index_raw_vault

    vault = Path(req["vault"])
    return index_raw_vault(vault)


def cmd_runtime_check(req: dict) -> dict:
    _ensure_path()
    from documents.runtime_check import check_sqlite_runtime

    return check_sqlite_runtime()


def cmd_register_source_revision(req: dict) -> dict:
    _ensure_path()
    from documents.store import register_source_revision

    vault = Path(req["vault"])
    db_path = vault / ".octopus-kb" / "documents.sqlite"
    return register_source_revision(
        db_path,
        document_id=req["documentId"],
        library_id=req["libraryId"],
        filename=req["filename"],
        sha256_hash=req["sha256"],
        byte_length=int(req["byteLength"]),
        object_path=req["objectPath"],
        mime_type=req.get("mimeType"),
    )


def cmd_get_document(req: dict) -> dict:
    _ensure_path()
    from documents.store import get_document

    vault = Path(req["vault"])
    db_path = vault / ".octopus-kb" / "documents.sqlite"
    doc = get_document(db_path, req["documentId"])
    return {"ok": True, "document": doc}


def cmd_list_documents(req: dict) -> dict:
    _ensure_path()
    from documents.store import list_documents

    vault = Path(req["vault"])
    db_path = vault / ".octopus-kb" / "documents.sqlite"
    docs = list_documents(db_path, req["libraryId"])
    return {"ok": True, "documents": docs}


def cmd_get_source_revision(req: dict) -> dict:
    _ensure_path()
    from documents.store import get_source_revision

    vault = Path(req["vault"])
    db_path = vault / ".octopus-kb" / "documents.sqlite"
    rev = get_source_revision(db_path, req["revisionId"])
    return {"ok": True, "revision": rev}


def cmd_verify_source_integrity(req: dict) -> dict:
    _ensure_path()
    from documents.store import verify_source_integrity

    vault = Path(req["vault"])
    return verify_source_integrity(vault, req["revisionId"])


def cmd_lookup(req: dict) -> dict:
    _ensure_path()
    from octopus_kb_compound.lookup import lookup_term

    vault = Path(req["vault"])
    term = req["term"]
    from octopus_kb_compound.heal import heal_page_meta_rejections

    heal_page_meta_rejections(vault)
    result = lookup_term(term, vault).to_dict()
    canonical = result.get("canonical")
    text = ""
    path = None
    if isinstance(canonical, dict):
        path = canonical.get("path")
        if path:
            text = _read_page_text(vault, path)
    return {
        "ok": True,
        "term": term,
        "canonicalPath": path,
        "text": text or None,
        "ambiguous": result.get("ambiguous", False),
        "collisions": result.get("collisions", []),
    }


def cmd_inbox_list(req: dict) -> dict:
    _ensure_path()
    from octopus_kb_compound.inbox import list_inbox

    result = list_inbox(req["vault"])
    if isinstance(result, dict):
        items = result.get("items") or result.get("deferred") or []
        return {"ok": True, "deferredCount": len(items), "items": items}
    if isinstance(result, list):
        return {"ok": True, "deferredCount": len(result), "items": result}
    return {"ok": True, "deferredCount": 0, "items": []}


def cmd_get_startup_attempt(req: dict) -> dict:
    _ensure_path()
    from documents.jobs import get_or_increment_startup_attempt

    vault = Path(req["vault"])
    db_path = vault / ".octopus-kb" / "documents.sqlite"
    attempt = get_or_increment_startup_attempt(db_path, req["libraryId"], req.get("increment", False))
    return {"ok": True, "startupAttempt": attempt}


def cmd_increment_startup_attempt(req: dict) -> dict:
    _ensure_path()
    from documents.jobs import get_or_increment_startup_attempt

    vault = Path(req["vault"])
    db_path = vault / ".octopus-kb" / "documents.sqlite"
    attempt = get_or_increment_startup_attempt(db_path, req["libraryId"], increment=True)
    return {"ok": True, "startupAttempt": attempt}


def cmd_create_job(req: dict) -> dict:
    _ensure_path()
    from documents.jobs import create_job

    vault = Path(req["vault"])
    db_path = vault / ".octopus-kb" / "documents.sqlite"
    return create_job(
        db_path,
        req["jobId"],
        req["libraryId"],
        req["documentId"],
        req["revisionId"],
        req["startupAttempt"],
        req.get("stage", "queued"),
        req.get("totalChunks", 0),
        req.get("tokenEstimate", 0),
    )


def cmd_update_job_checkpoint(req: dict) -> dict:
    _ensure_path()
    from documents.jobs import update_job_checkpoint

    vault = Path(req["vault"])
    db_path = vault / ".octopus-kb" / "documents.sqlite"
    return update_job_checkpoint(
        db_path,
        req["jobId"],
        req["expectedStartupAttempt"],
        req["completedChunks"],
        req["currentChunkIndex"],
        req["tokensUsed"],
        req.get("checkpointJson"),
        req.get("stage"),
    )


def cmd_finish_job(req: dict) -> dict:
    _ensure_path()
    from documents.jobs import finish_job

    vault = Path(req["vault"])
    db_path = vault / ".octopus-kb" / "documents.sqlite"
    return finish_job(
        db_path,
        req["jobId"],
        req["expectedStartupAttempt"],
        req.get("status", "completed"),
        req.get("error"),
    )


def cmd_mark_job_uncertain(req: dict) -> dict:
    _ensure_path()
    from documents.jobs import mark_job_uncertain

    vault = Path(req["vault"])
    db_path = vault / ".octopus-kb" / "documents.sqlite"
    return mark_job_uncertain(
        db_path,
        req["jobId"],
        req.get("reason", "uncertain paid request response"),
    )


def cmd_cancel_job(req: dict) -> dict:
    _ensure_path()
    from documents.jobs import cancel_job

    vault = Path(req["vault"])
    db_path = vault / ".octopus-kb" / "documents.sqlite"
    return cancel_job(db_path, req["jobId"])


def cmd_get_job(req: dict) -> dict:
    _ensure_path()
    from documents.jobs import get_job

    vault = Path(req["vault"])
    db_path = vault / ".octopus-kb" / "documents.sqlite"
    job = get_job(db_path, req["jobId"])
    return {"ok": True, "job": job}


def cmd_list_jobs(req: dict) -> dict:
    _ensure_path()
    from documents.jobs import list_jobs

    vault = Path(req["vault"])
    db_path = vault / ".octopus-kb" / "documents.sqlite"
    jobs = list_jobs(db_path, req["libraryId"])
    return {"ok": True, "jobs": jobs}


def cmd_convert_document(req: dict) -> dict:
    _ensure_path()
    from documents.convert import convert_file

    path = req.get("path")
    max_bytes = req.get("maxOutputBytes", 50 * 1024 * 1024)
    res = convert_file(path, max_bytes)
    return {"ok": True, **res}


def cmd_create_chunks(req: dict) -> dict:
    _ensure_path()
    from documents.chunks import create_chunks_from_blocks

    doc_id = req["documentId"]
    rev_id = req["revisionId"]
    blocks = req.get("blocks", [])
    full_text = req.get("fullText", "")
    max_chars = req.get("maxChunkChars", 1500)
    overlap = req.get("overlapChars", 200)

    manifest = create_chunks_from_blocks(doc_id, rev_id, blocks, full_text, max_chars, overlap)
    return {"ok": True, **manifest}


def cmd_verify_chunks(req: dict) -> dict:
    _ensure_path()
    from documents.chunks import verify_chunk_coverage

    full_text = req.get("fullText", "")
    chunks = req.get("chunks", [])
    res = verify_chunk_coverage(full_text, chunks)
    return {
        "ok": True,
        "valid": res["ok"],
        "coveredChars": res["coveredChars"],
        "totalChars": res["totalChars"],
        "errors": res["errors"],
    }


def cmd_calculate_budget(req: dict) -> dict:
    _ensure_path()
    from documents.token_budget import calculate_manifest_budget

    chunks = req.get("chunks", [])
    policy = req.get("policy", "byte-fallback")
    approved = req.get("approvedBudget")

    try:
        budget = calculate_manifest_budget(chunks, policy=policy, approved_budget=approved)
        return {"ok": True, **budget}
    except ValueError as exc:
        return {"ok": False, "error": str(exc), "code": "unknown-policy"}


def cmd_enrich_chunks(req: dict) -> dict:
    _ensure_path()
    from documents.enrich import enrich_document_chunks

    vault = Path(req["vault"])
    lib_id = req["libraryId"]
    job_id = req["jobId"]
    doc_id = req["documentId"]
    rev_id = req["revisionId"]
    chunks = req.get("chunks", [])
    attempt = req["expectedStartupAttempt"]
    budget = req.get("maxTokensBudget")

    res = enrich_document_chunks(
        vault, lib_id, job_id, doc_id, rev_id, chunks, attempt, budget
    )
    return res


def cmd_migrate_library(req: dict) -> dict:
    _ensure_path()
    from documents.migrate import migrate_legacy_library

    vault = Path(req["vault"])
    library_id = req["libraryId"]
    return migrate_legacy_library(vault, library_id)


def cmd_cancel_library_jobs(req: dict) -> dict:
    _ensure_path()
    from documents.jobs import cancel_all_library_jobs

    vault = Path(req["vault"])
    db_path = vault / ".octopus-kb" / "documents.sqlite"
    return cancel_all_library_jobs(db_path, req["libraryId"])


def cmd_passage_read(req: dict) -> dict:
    _ensure_path()
    from documents.search import read_passage
    return read_passage(Path(req['vault']), req['passageId'], req.get('cursor'))


def cmd_record_conversion(req: dict) -> dict:
    _ensure_path()
    from documents.pipeline import record_conversion
    return record_conversion(req)


def cmd_document_location(req: dict) -> dict:
    _ensure_path()
    from documents.pipeline import document_location
    return document_location(req)


def cmd_plan_document(req: dict) -> dict:
    _ensure_path()
    from documents.pipeline import plan_document
    return plan_document(req)


def cmd_execute_document(req: dict) -> dict:
    _ensure_path()
    from documents.pipeline import execute_document
    return execute_document(req)


def cmd_document_status(req: dict) -> dict:
    _ensure_path()
    from documents.pipeline import document_status
    return document_status(req)


def cmd_document_action(req: dict) -> dict:
    _ensure_path()
    from documents.pipeline import document_action
    return document_action(req)


COMMANDS = {
    "passage-read": cmd_passage_read,
    "record-conversion": cmd_record_conversion,
    "document-location": cmd_document_location,
    "plan-document": cmd_plan_document,
    "execute-document": cmd_execute_document,
    "document-status": cmd_document_status,
    "document-action": cmd_document_action,
    "self-test": cmd_self_test,
    "bootstrap": cmd_bootstrap,
    "recover": cmd_recover,
    "ingest-file": cmd_ingest_file,
    "convert-file": cmd_convert_file,
    "convert-document": cmd_convert_document,
    "create-chunks": cmd_create_chunks,
    "verify-chunks": cmd_verify_chunks,
    "calculate-budget": cmd_calculate_budget,
    "enrich-chunks": cmd_enrich_chunks,
    "migrate-library": cmd_migrate_library,
    "cancel-library-jobs": cmd_cancel_library_jobs,
    "propose": cmd_propose,
    "validate-apply": cmd_validate_apply,
    "retrieve-bundle": cmd_retrieve_bundle,
    "lookup": cmd_lookup,
    "inbox-list": cmd_inbox_list,
    "passage-search": cmd_passage_search,
    "index-vault": cmd_index_vault,
    "runtime-check": cmd_runtime_check,
    "register-source-revision": cmd_register_source_revision,
    "get-document": cmd_get_document,
    "list-documents": cmd_list_documents,
    "get-source-revision": cmd_get_source_revision,
    "verify-source-integrity": cmd_verify_source_integrity,
    "get-startup-attempt": cmd_get_startup_attempt,
    "increment-startup-attempt": cmd_increment_startup_attempt,
    "create-job": cmd_create_job,
    "update-job-checkpoint": cmd_update_job_checkpoint,
    "finish-job": cmd_finish_job,
    "mark-job-uncertain": cmd_mark_job_uncertain,
    "cancel-job": cmd_cancel_job,
    "get-job": cmd_get_job,
    "list-jobs": cmd_list_jobs,
}


def main() -> int:
    # Node encodes this process channel as UTF-8, independently of OS locale.
    # StringIO callers already supply decoded text and do not expose reconfigure.
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(encoding="utf-8")
    raw = sys.stdin.read()
    try:
        req = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as exc:
        json.dump({"ok": False, "error": f"invalid json: {exc}"}, sys.stdout, ensure_ascii=False)
        sys.stdout.write("\n")
        return 2
    command = req.get("command") or req.get("cmd")
    handler = COMMANDS.get(command)
    if handler is None:
        json.dump({"ok": False, "error": f"unknown command: {command}"}, sys.stdout, ensure_ascii=False)
        sys.stdout.write("\n")
        return 2
    try:
        result = handler(req)
    except Exception as exc:  # noqa: BLE001 — sidecar boundary
        traceback.print_exc(file=sys.stderr)
        json.dump({"ok": False, "error": str(exc)}, sys.stdout, ensure_ascii=False)
        sys.stdout.write("\n")
        return 1
    if "ok" not in result:
        result = {"ok": True, **result}

    result_path = req.get("resultPath") or req.get("result_file")
    if result_path and result.get("ok"):
        p = Path(result_path)
        p.parent.mkdir(parents=True, exist_ok=True)
        content_bytes = json.dumps(result, ensure_ascii=False).encode("utf-8")
        fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as output:
            output.write(content_bytes)
            output.flush()
            os.fsync(output.fileno())
        envelope = {
            "ok": True,
            "protocol": "file-result-v1",
            "resultPath": str(p),
            "byteLength": len(content_bytes),
            "sha256": hashlib.sha256(content_bytes).hexdigest(),
        }
        json.dump(envelope, sys.stdout, ensure_ascii=False)
        sys.stdout.write("\n")
        return 0

    json.dump(result, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
