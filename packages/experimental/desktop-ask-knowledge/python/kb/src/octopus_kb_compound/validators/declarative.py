"""Declarative YAML rule evaluation for proposal safety gates.

`schema.proposal_invalid` is evaluated before any `applies_to` filtering so an
unsupported operation such as `delete_page` cannot bypass the validator chain.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any

import jsonschema
import yaml

from octopus_kb_compound.links import normalize_page_name
from octopus_kb_compound.proposals import kb_resource_root, validate_proposal_dict
from octopus_kb_compound.schema import validate_frontmatter


SUPPORTED_OPS = {"create_page", "add_alias", "append_log"}
SUPPORTED_PRIMITIVES = {
    "op_count",
    "any_op_confidence_below",
    "vault_has_canonical_key_for_new_page",
    "proposal_schema_invalid",
    "new_frontmatter_schema_invalid",
    "op_target_outside_vault",
    "op_target_in_forbidden_area",
}
VERDICT_RANK = {"pass": 0, "downgrade": 1, "defer": 2, "reject": 3}
FORBIDDEN_ROOTS = {".octopus-kb", ".git", ".venv"}


class RuleSchemaError(ValueError):
    """Raised when a declarative rule file is not supported by the v1 DSL."""


@dataclass(frozen=True)
class VaultState:
    canonical_keys: set[str]
    page_titles: set[str]


@dataclass(frozen=True)
class Rule:
    id: str
    applies_to: list[str]
    check: dict[str, Any]
    verdict: str
    reason_template: str
    description: str | None = None
    downgrade_to: str | None = None
    human_overridable: bool = False


@dataclass(frozen=True)
class RuleResult:
    rule_id: str
    verdict: str
    reason: str


@dataclass
class Verdict:
    final: str
    rule_results: list[RuleResult]
    overridden_rules: list[str] = field(default_factory=list)


def load_rules(builtin_path: Path, user_rules_path: Path | None = None) -> list[Rule]:
    rules = _load_rule_file(Path(builtin_path))
    if user_rules_path is not None:
        rules.extend(_load_rule_file(Path(user_rules_path)))
    return rules


def evaluate_chain(
    proposal: dict[str, Any],
    vault: VaultState,
    rules: list[Rule],
    *,
    human_override: bool = False,
) -> Verdict:
    results: list[RuleResult] = []
    overridden: list[str] = []

    for rule in _schema_first(rules):
        if not _rule_applies(rule, proposal):
            continue
        context = _evaluation_context(proposal)
        if not all(_primitive_fires(name, value, proposal, vault) for name, value in rule.check.items()):
            continue

        if human_override and rule.human_overridable and rule.verdict in {"downgrade", "defer"}:
            overridden.append(rule.id)
            continue

        if rule.verdict == "pass":
            continue
        results.append(
            RuleResult(
                rule_id=rule.id,
                verdict=rule.verdict,
                reason=_render_reason(rule.reason_template, context),
            )
        )

    final = "pass"
    for result in results:
        if VERDICT_RANK[result.verdict] > VERDICT_RANK[final]:
            final = result.verdict
    return Verdict(final=final, rule_results=results, overridden_rules=overridden)


def _schema_first(rules: list[Rule]) -> list[Rule]:
    schema_rules = [rule for rule in rules if "proposal_schema_invalid" in rule.check]
    other_rules = [rule for rule in rules if "proposal_schema_invalid" not in rule.check]
    return schema_rules + other_rules


def _rule_applies(rule: Rule, proposal: dict[str, Any]) -> bool:
    if "proposal_schema_invalid" in rule.check:
        return True
    ops = proposal.get("operations", [])
    if not isinstance(ops, list):
        return False
    return any(isinstance(op, dict) and op.get("op") in rule.applies_to for op in ops)


def _primitive_fires(
    name: str,
    value: Any,
    proposal: dict[str, Any],
    vault: VaultState,
) -> bool:
    if name == "op_count":
        threshold = value.get("gt") if isinstance(value, dict) else None
        return _op_count(proposal) > int(threshold)
    if name == "any_op_confidence_below":
        return any(_confidence(op) < float(value) for op in _ops(proposal))
    if name == "vault_has_canonical_key_for_new_page":
        return bool(value) and _vault_has_canonical_key_for_new_page(proposal, vault)
    if name == "proposal_schema_invalid":
        return bool(value) and bool(validate_proposal_dict(proposal))
    if name == "new_frontmatter_schema_invalid":
        return bool(value) and any(
            validate_frontmatter(op.get("frontmatter", {}))
            for op in _ops(proposal)
            if op.get("op") == "create_page"
        )
    if name == "op_target_outside_vault":
        return bool(value) and any(_target_outside_vault(path) for path in _op_targets(proposal))
    if name == "op_target_in_forbidden_area":
        return bool(value) and any(_target_in_forbidden_area(path) for path in _op_targets(proposal))
    raise RuleSchemaError(f"unsupported check primitive: {name}")


def _vault_has_canonical_key_for_new_page(proposal: dict[str, Any], vault: VaultState) -> bool:
    for op in _ops(proposal):
        if op.get("op") != "create_page":
            continue
        frontmatter = op.get("frontmatter", {})
        if not isinstance(frontmatter, dict):
            continue
        candidate = frontmatter.get("canonical_name") or frontmatter.get("title")
        if not isinstance(candidate, str):
            continue
        key = normalize_page_name(candidate)
        if key and key in vault.canonical_keys:
            return True
    return False


def _target_outside_vault(path: str) -> bool:
    if not path:
        return True
    pure = PurePosixPath(path)
    return pure.is_absolute() or ".." in pure.parts or any(part.startswith(".") for part in pure.parts)


def _target_in_forbidden_area(path: str) -> bool:
    if not path:
        return False
    parts = PurePosixPath(path).parts
    return any(part in FORBIDDEN_ROOTS for part in parts)


def _op_targets(proposal: dict[str, Any]) -> list[str]:
    targets: list[str] = []
    for op in _ops(proposal):
        target = op.get("path") or op.get("target_page")
        if isinstance(target, str):
            targets.append(target)
    return targets


def _ops(proposal: dict[str, Any]) -> list[dict[str, Any]]:
    ops = proposal.get("operations", [])
    if not isinstance(ops, list):
        return []
    return [op for op in ops if isinstance(op, dict)]


def _op_count(proposal: dict[str, Any]) -> int:
    ops = proposal.get("operations", [])
    return len(ops) if isinstance(ops, list) else 0


def _confidence(op: dict[str, Any]) -> float:
    try:
        return float(op.get("confidence", 1.0))
    except (TypeError, ValueError):
        return 0.0


def _evaluation_context(proposal: dict[str, Any]) -> dict[str, Any]:
    return {"op_count": _op_count(proposal)}


def _render_reason(template: str, context: dict[str, Any]) -> str:
    try:
        return template.format(**context)
    except (KeyError, ValueError):
        return template


def _load_rule_file(path: Path) -> list[Rule]:
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise RuleSchemaError(f"cannot read rule file {path}: {exc}") from exc
    if data is None:
        data = {}
    _validate_rule_file(data, path)
    return [
        Rule(
            id=str(item["id"]),
            description=item.get("description"),
            applies_to=list(item["applies_to"]),
            check=dict(item["check"]),
            verdict=str(item["verdict"]),
            downgrade_to=item.get("downgrade_to"),
            reason_template=str(item["reason_template"]),
            human_overridable=bool(item.get("human_overridable", False)),
        )
        for item in data["rules"]
    ]


def _validate_rule_file(data: Any, path: Path) -> None:
    schema_path = kb_resource_root() / "schemas" / "rules" / "v1.json"
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    validator = jsonschema.Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(data), key=lambda error: list(error.absolute_path))
    if errors:
        first = errors[0]
        location = ".".join(str(part) for part in first.absolute_path) or "<root>"
        raise RuleSchemaError(f"{path}: {location}: {first.message}")

    for rule in data.get("rules", []):
        unknown = set(rule.get("check", {})) - SUPPORTED_PRIMITIVES
        if unknown:
            raise RuleSchemaError(f"{path}: unsupported check primitive: {sorted(unknown)[0]}")
