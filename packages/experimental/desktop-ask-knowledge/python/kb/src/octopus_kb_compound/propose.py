"""LLM-backed proposal generation for raw source ingestion."""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from octopus_kb_compound.config import ConfigError, load_config
from octopus_kb_compound.frontmatter import parse_document
from octopus_kb_compound.llm import (
    ChatClient,
    ChatRequest,
    LLMError,
    LLMInvalidOutputError,
    parse_json_content,
)
from octopus_kb_compound.proposals import kb_resource_root, save_proposal, validate_proposal_dict
from octopus_kb_compound.retrieve import build_retrieval_bundle


class ProposeInputError(ValueError):
    """Invalid user input for `octopus-kb propose`."""


class ProposeRuntimeError(RuntimeError):
    """Runtime failure while producing a proposal."""


@dataclass(frozen=True)
class ProposeResult:
    proposal_id: str
    path: str
    operations: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "proposal_id": self.proposal_id,
            "path": self.path,
            "operations": self.operations,
        }


def propose_from_raw(
    raw_file: Path,
    vault: Path,
    *,
    profile_name: str | None = None,
) -> ProposeResult:
    root = Path(vault)
    source = Path(raw_file)
    _validate_inputs(source, root)

    raw_bytes = source.read_bytes()
    raw_body = raw_bytes.decode("utf-8", errors="replace")
    raw_sha = hashlib.sha256(raw_bytes).hexdigest()
    raw_frontmatter, _ = parse_document(raw_body)
    raw_title = str(raw_frontmatter.get("title") or source.stem)
    raw_rel_path = _relative_path(source, root)

    try:
        config = load_config(root)
        profile_key = profile_name or config.default_profile
        profile = config.resolve_profile(profile_name)
    except ConfigError as exc:
        raise ProposeInputError(str(exc)) from exc

    prompt_path = _prompt_path()
    prompt_bytes = prompt_path.read_bytes()
    prompt_sha = hashlib.sha256(prompt_bytes).hexdigest()
    prompt_template = prompt_bytes.decode("utf-8")
    existing_bundle = build_retrieval_bundle(root, raw_title).to_dict()
    prompt = _render_template(
        prompt_template,
        {
            "raw_path": raw_rel_path,
            "raw_body": clip_raw_body(raw_body),
            "existing_bundle": json.dumps(existing_bundle, ensure_ascii=False, indent=2),
            "proposal_schema": _proposal_schema_path().read_text(encoding="utf-8"),
        },
    )

    kwargs = profile.as_client_kwargs()
    kwargs["timeout"] = max(int(kwargs["timeout"]), 180)
    client = ChatClient(**kwargs)
    try:
        proposal = _request_proposal_json(client, prompt, root)
    except LLMError as exc:
        raise ProposeRuntimeError(str(exc)) from exc
    if not isinstance(proposal, dict):
        _write_rejection(
            root,
            "schema_invalid",
            {"reason": "schema_invalid", "errors": ["proposal must be a JSON object"], "proposal": proposal},
        )
        raise ProposeRuntimeError("proposal schema invalid")

    proposal["source"] = {
        "kind": "raw_file",
        "path": raw_rel_path,
        "sha256": raw_sha,
    }
    proposal["produced_by"] = {
        "provider_profile": profile_key,
        "model": profile.model,
        "prompt_version": f"prompts/propose.md@sha256:{prompt_sha}",
    }
    proposal["status"] = "pending"
    fill_create_page_frontmatter(proposal)

    errors = validate_proposal_dict(proposal)
    if errors:
        _write_rejection(
            root,
            "schema_invalid",
            {"reason": "schema_invalid", "errors": errors, "proposal": proposal},
        )
        raise ProposeRuntimeError("proposal schema invalid")

    saved = save_proposal(proposal, root)
    return ProposeResult(
        proposal_id=str(proposal["id"]),
        path=saved.relative_to(root).as_posix(),
        operations=len(proposal.get("operations", [])),
    )


RAW_PROPOSE_CHARS = 12_000
PROPOSE_MAX_TOKENS = 8000
_WIKI_ROLES = frozenset(
    {"concept", "entity", "comparison", "timeline", "log", "note", "raw_source"}
)


def fill_create_page_frontmatter(proposal: dict[str, Any]) -> None:
    """Fill role, layer, and wiki summary so apply is not rejected for missing page-meta."""
    operations = proposal.get("operations")
    if not isinstance(operations, list):
        return
    for op in operations:
        if not isinstance(op, dict) or op.get("op") != "create_page":
            continue
        frontmatter = op.get("frontmatter")
        if not isinstance(frontmatter, dict):
            continue
        page_type = str(frontmatter.get("type") or "concept")
        if not str(frontmatter.get("role") or "").strip():
            frontmatter["role"] = page_type if page_type in _WIKI_ROLES else "concept"
        if not str(frontmatter.get("layer") or "").strip():
            frontmatter["layer"] = "wiki"
        if frontmatter.get("layer") == "wiki" and not str(frontmatter.get("summary") or "").strip():
            title = str(frontmatter.get("title") or "").strip()
            body = str(op.get("body") or "").strip()
            frontmatter["summary"] = (body[:200] if body else title) or "entry"
        tags = frontmatter.get("tags")
        if isinstance(tags, list):
            aliases = frontmatter.get("aliases")
            if not isinstance(aliases, list):
                aliases = []
            seen = {str(item) for item in aliases}
            for tag in tags:
                name = str(tag).strip()
                if name and name not in seen:
                    aliases.append(name)
                    seen.add(name)
            if aliases:
                frontmatter["aliases"] = aliases


def clip_raw_body(raw_body: str, limit: int = RAW_PROPOSE_CHARS) -> str:
    """Keep propose prompts short enough that the model can finish a JSON object."""
    if len(raw_body) <= limit:
        return raw_body
    return (
        raw_body[:limit]
        + "\n\n[raw truncated for propose; the vault still has the full raw file]\n"
    )


def _request_proposal_json(client: ChatClient, prompt: str, vault: Path) -> Any:
    messages = [{"role": "user", "content": prompt}]
    last_output = ""
    for attempt in range(1, 3):
        try:
            response = client.chat(
                ChatRequest(
                    messages=messages,
                    json_object=True,
                    temperature=0.1,
                    max_tokens=PROPOSE_MAX_TOKENS,
                )
            )
            last_output = response.content
            if response.finish_reason == "length":
                raise LLMInvalidOutputError(
                    "Model response was cut off",
                    content=response.content,
                )
            return parse_json_content(response.content)
        except LLMInvalidOutputError as exc:
            last_output = exc.content or str(exc)
        except json.JSONDecodeError as exc:
            last_output = str(exc)
        except LLMError:
            raise

        if attempt == 1:
            messages.append(
                {
                    "role": "user",
                    "content": _retry_schema_reminder(),
                }
            )
            continue

        _write_rejection(
            vault,
            "llm_non_json",
            {
                "reason": "llm_non_json",
                "last_output": last_output[:4000],
                "attempts": 2,
            },
        )
        raise ProposeRuntimeError("LLM returned non-JSON output")

    raise ProposeRuntimeError("LLM returned non-JSON output")


def _retry_schema_reminder() -> str:
    schema = _proposal_schema_path().read_text(encoding="utf-8")
    return (
        "<retry-schema-reminder>\n"
        "Your previous response was not valid JSON. Return only a single JSON "
        "object matching this proposal schema, without markdown fences or prose. "
        "If the previous output was cut off, emit at most 2 create_page operations "
        "and keep each body under 400 characters.\n\n"
        f"{schema}\n"
        "</retry-schema-reminder>"
    )


def _validate_inputs(raw_file: Path, vault: Path) -> None:
    if not vault.exists():
        raise ProposeInputError(f"Vault does not exist: {vault}")
    if not vault.is_dir():
        raise ProposeInputError(f"Vault is not a directory: {vault}")
    if not raw_file.exists():
        raise ProposeInputError(f"Raw file does not exist: {raw_file}")
    if not raw_file.is_file():
        raise ProposeInputError(f"Raw file is not a file: {raw_file}")


def _relative_path(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def _render_template(template: str, values: dict[str, str]) -> str:
    def replace(match: re.Match[str]) -> str:
        return values.get(match.group(1).strip(), "")

    return re.sub(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}", replace, template)


def _write_rejection(vault: Path, suffix: str, payload: dict[str, Any]) -> Path:
    directory = vault / ".octopus-kb" / "rejections"
    directory.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
    target = directory / f"{timestamp}-{suffix}.json"
    content = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{target.stem}.",
        suffix=".tmp",
        dir=directory,
        text=True,
    )
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_path, target)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise
    return target


def _kb_root() -> Path:
    return kb_resource_root()


def _prompt_path() -> Path:
    return _kb_root() / "prompts" / "propose.md"


def _proposal_schema_path() -> Path:
    return _kb_root() / "schemas" / "llm" / "proposal.json"
