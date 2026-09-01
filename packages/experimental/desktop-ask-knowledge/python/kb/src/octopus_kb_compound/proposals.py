"""Proposal schema validation and append-only proposal storage."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

import jsonschema


class ProposalCollisionError(ValueError):
    """Raised when a proposal id would overwrite an existing proposal file."""


def kb_resource_root() -> Path:
    """Directory that contains `prompts/` and `schemas/` for this sidecar."""
    env = os.environ.get("OCTOPUS_KB_ROOT", "").strip()
    if env:
        return Path(env)
    here = Path(__file__).resolve()
    source = here.parents[2]
    if (source / "schemas" / "llm" / "proposal.json").is_file():
        return source
    runtime = source.parent
    if (runtime / "schemas" / "llm" / "proposal.json").is_file():
        return runtime
    return source


def _schema_path() -> Path:
    return kb_resource_root() / "schemas" / "llm" / "proposal.json"


def _load_schema() -> dict[str, Any]:
    return json.loads(_schema_path().read_text(encoding="utf-8"))


def validate_proposal_dict(data: dict[str, Any]) -> list[str]:
    """Return JSON Schema validation error messages for a proposal dictionary."""

    validator = jsonschema.Draft202012Validator(_load_schema())
    errors = sorted(validator.iter_errors(data), key=lambda error: list(error.path))
    return [error.message for error in errors]


def save_proposal(proposal: dict[str, Any], vault_root: Path | str) -> Path:
    """Atomically write an append-only proposal file under `.octopus-kb/proposals/`."""

    proposal_id = str(proposal["id"])
    if "/" in proposal_id or "\\" in proposal_id:
        raise ValueError("proposal id must not contain path separators")

    root = Path(vault_root)
    proposal_dir = root / ".octopus-kb" / "proposals"
    proposal_dir.mkdir(parents=True, exist_ok=True)
    target = proposal_dir / f"{proposal_id}.json"
    if target.exists():
        raise ProposalCollisionError(f"proposal id already exists: {proposal_id}")

    payload = json.dumps(proposal, indent=2, sort_keys=True) + "\n"
    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{proposal_id}.",
        suffix=".tmp",
        dir=proposal_dir,
        text=True,
    )
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        if target.exists():
            raise ProposalCollisionError(f"proposal id already exists: {proposal_id}")
        os.replace(tmp_path, target)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise

    return target


def load_proposal(path: Path | str) -> dict[str, Any]:
    """Load a proposal JSON file."""

    return json.loads(Path(path).read_text(encoding="utf-8"))
