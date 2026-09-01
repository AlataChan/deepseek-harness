"""Audit state transitions for staged proposal apply.

Audit entries are stateful v1 records. A proposal has at most one audit entry,
and recovery preserves that entry by rewriting `pending` to `rolled_back`.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def find_entry(vault: Path | str, proposal_id: str) -> Path | None:
    """Return the audit entry for `proposal_id`, if one exists.

    The filename includes a timestamp prefix, so callers must resolve entries
    through this helper rather than deriving paths from the proposal id.
    """

    audit_dir = Path(vault) / ".octopus-kb" / "audit"
    if not audit_dir.exists():
        return None
    matches: list[Path] = []
    for path in sorted(audit_dir.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if data.get("proposal_id") == proposal_id:
            matches.append(path)
    if not matches:
        return None
    if len(matches) > 1:
        raise ValueError(f"multiple audit entries found for proposal {proposal_id}")
    return matches[0]


def write_pending(
    vault: Path | str,
    proposal_id: str,
    ledger: dict[str, Any],
    source: dict[str, Any],
    *,
    override: dict[str, list[str]] | None = None,
) -> Path:
    """Create a pending audit entry before the commit phase starts."""

    root = Path(vault)
    audit_dir = root / ".octopus-kb" / "audit"
    audit_dir.mkdir(parents=True, exist_ok=True)
    if find_entry(root, proposal_id) is not None:
        raise ValueError(f"audit entry already exists for proposal {proposal_id}")

    now = _now_utc()
    timestamp = now.strftime("%Y%m%d%H%M%S")
    entry = {
        "proposal_id": proposal_id,
        "status": "pending",
        "created_at": now.isoformat().replace("+00:00", "Z"),
        "source": dict(source),
        "applied_pages": sorted(set(ledger["created"]) | set(ledger["modified"])),
        "created": list(ledger["created"]),
        "modified": list(ledger["modified"]),
        "staging_path": str(ledger["staging_path"]),
        "override": override,
        "applied_at": None,
        "vault_sha_after": None,
    }
    target = audit_dir / f"{timestamp}-{proposal_id}.json"
    _atomic_write_json(target, entry)
    return target


def mark_applied(audit_path: Path | str, vault_sha_after: str) -> None:
    entry = _read_entry(audit_path)
    entry["status"] = "applied"
    entry["applied_at"] = _now_utc().isoformat().replace("+00:00", "Z")
    entry["vault_sha_after"] = vault_sha_after
    _atomic_write_json(Path(audit_path), entry)


def mark_rolled_back(audit_path: Path | str) -> None:
    entry = _read_entry(audit_path)
    entry["status"] = "rolled_back"
    _atomic_write_json(Path(audit_path), entry)


def vault_markdown_sha(vault: Path | str) -> str:
    """Return a stable SHA over non-hidden markdown files in the vault."""

    root = Path(vault)
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*.md")):
        rel = path.relative_to(root)
        if any(part.startswith(".") for part in rel.parts):
            continue
        digest.update(rel.as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def _read_entry(path: Path | str) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _atomic_write_json(target: Path, data: dict[str, Any]) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
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


def _now_utc() -> datetime:
    return datetime.now(UTC).replace(microsecond=0)
