"""Re-apply propose digests that only failed page-meta."""

from __future__ import annotations

import json
from pathlib import Path

from octopus_kb_compound.apply import ValidateInputError, ValidateRuntimeError, validate_proposal_file

_PAGE_META_RULE = "schema.page_meta_invalid"


def heal_page_meta_rejections(vault: Path) -> list[str]:
    """Apply rejected proposals whose only hard fail was missing page-meta.

    Propose already wrote a standard-Chinese wiki digest. Apply had rejected
    it for missing `role` / `layer` / `summary`. Filling those fields and
    applying lands the digest so lookup and retrieve see wiki pages.

    @param vault - library root.
    @returns applied or already-applied proposal ids.
    """
    root = Path(vault)
    folder = root / ".octopus-kb" / "rejections"
    if not folder.is_dir():
        return []
    applied: list[str] = []
    for rejection in sorted(folder.glob("*.json")):
        try:
            data = json.loads(rejection.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if not isinstance(data, dict) or not _is_page_meta_reject(data):
            continue
        proposal_id = str(data.get("id") or rejection.stem)
        candidate = root / ".octopus-kb" / "proposals" / f"{proposal_id}.json"
        source = candidate if candidate.is_file() else rejection
        try:
            result = validate_proposal_file(source, root, apply=True)
        except (ValidateInputError, ValidateRuntimeError):
            continue
        if result.status in {"applied", "already_applied"}:
            applied.append(proposal_id)
    return applied


def _is_page_meta_reject(data: dict) -> bool:
    if data.get("rule_id") == _PAGE_META_RULE:
        return True
    results = data.get("rule_results")
    if not isinstance(results, list):
        return False
    return any(
        isinstance(row, dict) and row.get("rule_id") == _PAGE_META_RULE
        for row in results
    )
