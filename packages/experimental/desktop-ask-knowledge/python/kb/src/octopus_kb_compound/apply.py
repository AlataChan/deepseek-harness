"""Validate, staged-apply, and recover proposal changes."""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any

from octopus_kb_compound import audit
from octopus_kb_compound.adapters.obsidian.store import ObsidianStore
from octopus_kb_compound.canonical import _canonical_pages_by_key
from octopus_kb_compound.ckr.operations import operations_from_proposal
from octopus_kb_compound.frontmatter import parse_document
from octopus_kb_compound.lint import lint_pages
from octopus_kb_compound.models import LintFinding, PageRecord
from octopus_kb_compound.propose import fill_create_page_frontmatter
from octopus_kb_compound.proposals import load_proposal
from octopus_kb_compound.validators.declarative import (
    VaultState,
    Verdict,
    evaluate_chain,
    load_rules,
)


SEVERE_LINT_CODES = {
    "SCHEMA_MISSING_FIELD",
    "SCHEMA_INVALID_FIELD",
    "SCHEMA_INVALID_CONDITIONAL",
    "BROKEN_LINK",
    "DUPLICATE_CANONICAL_PAGE",
    "CANONICAL_ALIAS_COLLISION",
    "ALIAS_COLLISION",
}


class ValidateInputError(ValueError):
    """Raised for invalid user input or unsafe retry state."""


class ValidateRuntimeError(RuntimeError):
    """Raised for unexpected apply/runtime failures."""


@dataclass
class ApplyResult:
    status: str
    verdict: str | None = None
    rule_results: list[dict[str, str]] = field(default_factory=list)
    audit_path: str | None = None
    message: str | None = None

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {"status": self.status}
        if self.verdict is not None:
            data["verdict"] = self.verdict
        if self.rule_results:
            data["rule_results"] = self.rule_results
        if self.audit_path is not None:
            data["audit_path"] = self.audit_path
        if self.message is not None:
            data["message"] = self.message
        return data


def validate_proposal_file(
    proposal_path: Path | str,
    vault: Path | str,
    *,
    apply: bool = False,
    override: dict[str, list[str]] | None = None,
) -> ApplyResult:
    root = Path(vault)
    path = Path(proposal_path)
    if not root.exists() or not root.is_dir():
        raise ValidateInputError(f"Vault is not a directory: {root}")
    if not path.exists() or not path.is_file():
        raise ValidateInputError(f"Proposal file does not exist: {path}")

    proposal = load_proposal(path)
    fill_create_page_frontmatter(proposal)
    proposal_id = str(proposal.get("id", ""))
    if not proposal_id:
        raise ValidateInputError("proposal is missing id")

    existing_audit = audit.find_entry(root, proposal_id)
    if existing_audit is not None:
        entry = _read_json(existing_audit)
        status = entry.get("status")
        if status == "applied":
            return ApplyResult(status="already_applied", audit_path=_rel(existing_audit, root))
        if status == "pending":
            raise ValidateInputError(f"pending audit exists; run kb recover {proposal_id} first")
        if status == "rolled_back":
            raise ValidateInputError(f"proposal {proposal_id} was previously rolled back")

    rules = load_rules(_builtins_rules_path())
    verdict = evaluate_chain(proposal, _build_vault_state(root), rules)
    rule_results = _rule_results_to_dicts(verdict)
    if verdict.final == "reject":
        _write_decision(root, "rejections", proposal, rule_results, status="rejected")
        return ApplyResult(status="rejected", verdict=verdict.final, rule_results=rule_results)
    if verdict.final == "defer":
        _write_decision(root, "inbox", proposal, rule_results, status="deferred")
        return ApplyResult(status="deferred", verdict=verdict.final, rule_results=rule_results)
    if not apply:
        return ApplyResult(status=verdict.final, verdict=verdict.final, rule_results=rule_results)

    return apply_proposal(root, proposal, verdict=verdict, override=override)


def apply_proposal(
    vault: Path | str,
    proposal: dict[str, Any],
    *,
    verdict: Verdict | None = None,
    override: dict[str, list[str]] | None = None,
) -> ApplyResult:
    root = Path(vault)
    proposal_id = str(proposal["id"])
    boundary_error = _write_boundary_error(root, proposal)
    if boundary_error is not None:
        _write_decision(root, "rejections", proposal, [], status="rejected_write_boundary", reason=boundary_error)
        return ApplyResult(status="rejected_write_boundary", verdict=verdict.final if verdict else None, message=boundary_error)

    store = ObsidianStore(root)
    ops = operations_from_proposal(proposal)
    staging = root / ".octopus-kb" / "staging" / proposal_id
    if staging.exists():
        shutil.rmtree(staging)
    backup_dir = staging / "backup"
    new_dir = staging / "new"
    backup_dir.mkdir(parents=True, exist_ok=True)
    new_dir.mkdir(parents=True, exist_ok=True)

    try:
        prepared = store.prepare_ops(ops)
        created = [ref.locator for ref in prepared.created]
        modified = [ref.locator for ref in prepared.modified]
        for rel_path, content in prepared.content_by_path.items():
            target = root / rel_path
            if target.exists():
                backup_target = backup_dir / rel_path
                backup_target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(target, backup_target)
            staged_target = new_dir / rel_path
            staged_target.parent.mkdir(parents=True, exist_ok=True)
            staged_target.write_text(content, encoding="utf-8")

        if _introduces_severe_lint(root, prepared.content_by_path):
            shutil.rmtree(staging, ignore_errors=True)
            _write_decision(root, "rejections", proposal, [], status="rejected_post_lint", reason="post-apply lint failed")
            return ApplyResult(status="rejected_post_lint", verdict=verdict.final if verdict else None)

        ledger = {
            "created": sorted(created),
            "modified": sorted(modified),
            "staging_path": staging.relative_to(root).as_posix(),
        }
        audit_path = audit.write_pending(
            root,
            proposal_id,
            ledger,
            proposal.get("source", {}),
            override=override,
        )

        store.apply_ops(ops, prepared=prepared, staged_dir=new_dir)

        audit.mark_applied(audit_path, audit.vault_markdown_sha(root))
        shutil.rmtree(staging, ignore_errors=True)
        return ApplyResult(
            status="applied",
            verdict=verdict.final if verdict else None,
            audit_path=_rel(audit_path, root),
        )
    except Exception as exc:
        raise ValidateRuntimeError(str(exc)) from exc


def recover_proposal(proposal_id: str, vault: Path | str) -> ApplyResult:
    root = Path(vault)
    if not root.exists() or not root.is_dir():
        raise ValidateInputError(f"Vault is not a directory: {root}")
    audit_path = audit.find_entry(root, proposal_id)
    if audit_path is None:
        return ApplyResult(status="nothing_to_recover")
    entry = _read_json(audit_path)
    status = entry.get("status")
    if status == "applied":
        return ApplyResult(status="already_applied", audit_path=_rel(audit_path, root))
    if status == "rolled_back":
        return ApplyResult(status="already_rolled_back", audit_path=_rel(audit_path, root))
    if status != "pending":
        return ApplyResult(status="nothing_to_recover", audit_path=_rel(audit_path, root))

    staging = root / entry.get("staging_path", "")
    backup = staging / "backup"
    for rel_path in entry.get("modified", []):
        source = backup / rel_path
        destination = root / rel_path
        if source.exists():
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
    for rel_path in entry.get("created", []):
        (root / rel_path).unlink(missing_ok=True)
    shutil.rmtree(staging, ignore_errors=True)
    audit.mark_rolled_back(audit_path)
    return ApplyResult(status="rolled_back", audit_path=_rel(audit_path, root))


def _build_vault_state(vault: Path) -> VaultState:
    pages = ObsidianStore(vault).list_page_records()
    canonical_keys = set(_canonical_pages_by_key(pages))
    page_titles = {page.title for page in pages}
    return VaultState(canonical_keys=canonical_keys, page_titles=page_titles)


def _introduces_severe_lint(vault: Path, staged_content: dict[str, str]) -> bool:
    before = _severe_lint_signature(lint_pages(ObsidianStore(vault).list_page_records()))
    after_pages = _overlay_pages(vault, staged_content)
    after = _severe_lint_signature(lint_pages(after_pages))
    return bool(after - before)


def _overlay_pages(vault: Path, staged_content: dict[str, str]):
    pages = ObsidianStore(vault).list_page_records()
    replaced = set(staged_content)
    result = [page for page in pages if page.path not in replaced]
    for rel_path, content in staged_content.items():
        frontmatter, body = parse_document(content)
        title = str(frontmatter.get("title") or Path(rel_path).stem)
        result.append(PageRecord(rel_path, title, body, frontmatter))
    return sorted(result, key=lambda page: page.path)


def _severe_lint_signature(findings: list[LintFinding]) -> set[tuple[str, str, str]]:
    return {
        (finding.code, finding.path, finding.message)
        for finding in findings
        if finding.code in SEVERE_LINT_CODES
    }


def _write_boundary_error(vault: Path, proposal: dict[str, Any]) -> str | None:
    root = vault.resolve()
    for op in proposal.get("operations", []):
        target = _op_target(op)
        if not target:
            continue
        pure = PurePosixPath(target)
        if pure.is_absolute():
            return f"operation target is absolute: {target}"
        if ".." in pure.parts:
            return f"operation target escapes vault: {target}"
        if any(part.startswith(".") for part in pure.parts):
            return f"operation target uses hidden path: {target}"
        resolved = (vault / target).resolve()
        if not resolved.is_relative_to(root):
            return f"operation target is outside vault: {target}"
    return None


def _op_target(op: dict[str, Any]) -> str | None:
    target = op.get("path") or op.get("target_page")
    return target if isinstance(target, str) else None


def _write_decision(
    vault: Path,
    directory: str,
    proposal: dict[str, Any],
    rule_results: list[dict[str, str]],
    *,
    status: str,
    reason: str | None = None,
) -> Path:
    decision_dir = vault / ".octopus-kb" / directory
    decision_dir.mkdir(parents=True, exist_ok=True)
    target = decision_dir / f"{proposal.get('id')}.json"
    payload = dict(proposal)
    payload["decision_status"] = status
    if rule_results:
        payload["rule_results"] = rule_results
        payload["rule_id"] = rule_results[0]["rule_id"]
        payload["reason"] = rule_results[0]["reason"]
    elif reason is not None:
        payload["reason"] = reason
    target.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return target


def _rule_results_to_dicts(verdict: Verdict) -> list[dict[str, str]]:
    return [
        {"rule_id": result.rule_id, "verdict": result.verdict, "reason": result.reason}
        for result in verdict.rule_results
    ]


def _builtins_rules_path() -> Path:
    return Path(__file__).resolve().parent / "validators" / "builtins.yaml"


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _rel(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()
