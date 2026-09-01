"""Human exception inbox for deferred proposals."""

from __future__ import annotations

import json
import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from octopus_kb_compound.apply import (
    ApplyResult,
    ValidateInputError,
    _build_vault_state,
    _builtins_rules_path,
    _rule_results_to_dicts,
    apply_proposal,
)
from octopus_kb_compound.validators.declarative import evaluate_chain, load_rules


def list_inbox(vault: Path | str) -> dict[str, Any]:
    root = _require_vault(vault)
    deferred = []
    for path in sorted(_inbox_dir(root).glob("*.json")):
        proposal = _read_json(path)
        deferred.append(
            {
                "id": proposal.get("id"),
                "created_at": proposal.get("created_at"),
                "reason": proposal.get("reason"),
                "operations": len(proposal.get("operations", [])),
                "source": proposal.get("source"),
            }
        )
    return {"deferred": deferred, "count": len(deferred)}


def review_inbox(vault: Path | str, proposal_id: str) -> dict[str, Any]:
    root, proposal, _ = _load_inbox_proposal(vault, proposal_id)
    verdict = _evaluate(root, proposal, human_override=False)
    return {
        "proposal_id": proposal_id,
        "current_verdict": verdict.final,
        "rule_results": _rule_results_to_dicts(verdict),
    }


def accept_inbox(vault: Path | str, proposal_id: str) -> ApplyResult:
    root, proposal, inbox_path = _load_inbox_proposal(vault, proposal_id)
    verdict = _evaluate(root, proposal, human_override=True)
    if verdict.final != "pass":
        _write_rejection(
            root,
            proposal,
            source="blocked_by_hard_reject",
            reason="blocked_by_hard_reject",
            rule_results=_rule_results_to_dicts(verdict),
        )
        inbox_path.unlink(missing_ok=True)
        return ApplyResult(
            status="rejected",
            verdict=verdict.final,
            rule_results=_rule_results_to_dicts(verdict),
            message="blocked_by_hard_reject",
        )

    result = apply_proposal(
        root,
        proposal,
        verdict=verdict,
        override={"overridden_rules": verdict.overridden_rules},
    )
    inbox_path.unlink(missing_ok=True)
    return result


def reject_inbox(vault: Path | str, proposal_id: str, reason: str) -> dict[str, Any]:
    root, proposal, inbox_path = _load_inbox_proposal(vault, proposal_id)
    _write_rejection(root, proposal, source="human_rejected", reason=reason)
    inbox_path.unlink(missing_ok=True)
    return {"status": "rejected", "proposal_id": proposal_id, "reason": reason}


def _evaluate(root: Path, proposal: dict[str, Any], *, human_override: bool):
    rules = load_rules(_builtins_rules_path())
    return evaluate_chain(
        proposal,
        _build_vault_state(root),
        rules,
        human_override=human_override,
    )


def _load_inbox_proposal(vault: Path | str, proposal_id: str) -> tuple[Path, dict[str, Any], Path]:
    root = _require_vault(vault)
    path = _inbox_dir(root) / f"{proposal_id}.json"
    if not path.exists() or not path.is_file():
        raise ValidateInputError(f"Inbox proposal does not exist: {proposal_id}")
    return root, _read_json(path), path


def _write_rejection(
    root: Path,
    proposal: dict[str, Any],
    *,
    source: str,
    reason: str,
    rule_results: list[dict[str, str]] | None = None,
) -> Path:
    rejection_dir = root / ".octopus-kb" / "rejections"
    rejection_dir.mkdir(parents=True, exist_ok=True)
    target = rejection_dir / f"{proposal.get('id')}.json"
    entry: dict[str, Any] = {
        "proposal_id": proposal.get("id"),
        "source": source,
        "reason": reason,
        "rejected_at": _now_utc(),
        "proposal": proposal,
    }
    if rule_results:
        entry["rule_results"] = rule_results
    _atomic_write_json(target, entry)
    return target


def _inbox_dir(root: Path) -> Path:
    path = root / ".octopus-kb" / "inbox"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _require_vault(vault: Path | str) -> Path:
    root = Path(vault)
    if not root.exists() or not root.is_dir():
        raise ValidateInputError(f"Vault is not a directory: {root}")
    return root


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _atomic_write_json(target: Path, data: dict[str, Any]) -> None:
    payload = json.dumps(data, indent=2, sort_keys=True) + "\n"
    fd, tmp_name = tempfile.mkstemp(prefix=f".{target.stem}.", suffix=".tmp", dir=target.parent, text=True)
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_path, target)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise


def _now_utc() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
