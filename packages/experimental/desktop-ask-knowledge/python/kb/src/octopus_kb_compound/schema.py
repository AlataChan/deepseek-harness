from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from jsonschema import Draft202012Validator


Severity = Literal["error", "warning"]


@dataclass(frozen=True, slots=True)
class SchemaFinding:
    code: str
    field: str
    message: str
    severity: Severity = "error"


_SCHEMA_CACHE: dict[str, dict] = {}


def _ensure_format_checkers() -> None:
    checker = Draft202012Validator.FORMAT_CHECKER

    if "uri" not in checker.checkers:

        @checker.checks("uri")
        def _is_uri(value: object) -> bool:
            if not isinstance(value, str):
                return True
            parts = urlsplit(value)
            return bool(parts.scheme) and not any(ch.isspace() for ch in value)

    if "date-time" not in checker.checkers:

        @checker.checks("date-time")
        def _is_date_time(value: object) -> bool:
            if not isinstance(value, str):
                return True
            candidate = value.replace("Z", "+00:00")
            try:
                parsed = datetime.fromisoformat(candidate)
            except ValueError:
                return False
            return "T" in value and parsed.tzinfo is not None


_ensure_format_checkers()


def _load_builtin_schema() -> dict:
    """Load the shipped PageMeta schema via importlib.resources."""
    from importlib.resources import files

    resource = (
        files("octopus_kb_compound")
        .joinpath("_schemas")
        .joinpath("page-meta.json")
    )
    return json.loads(resource.read_text(encoding="utf-8"))


def load_page_meta_schema(path: Path | None = None) -> dict:
    if path is not None:
        key = str(path)
        if key not in _SCHEMA_CACHE:
            _SCHEMA_CACHE[key] = json.loads(path.read_text(encoding="utf-8"))
        return _SCHEMA_CACHE[key]
    if "__builtin__" not in _SCHEMA_CACHE:
        _SCHEMA_CACHE["__builtin__"] = _load_builtin_schema()
    return _SCHEMA_CACHE["__builtin__"]


def validate_frontmatter(
    data: dict, *, schema_path: Path | None = None
) -> list[SchemaFinding]:
    schema = load_page_meta_schema(schema_path)
    validator = Draft202012Validator(
        schema, format_checker=Draft202012Validator.FORMAT_CHECKER
    )
    findings: list[SchemaFinding] = []
    for error in sorted(validator.iter_errors(data), key=lambda e: list(e.absolute_path)):
        field = ".".join(str(p) for p in error.absolute_path) or _missing_required_field(
            error
        )
        findings.append(
            SchemaFinding(code=_code_for(error), field=field, message=error.message)
        )
    return findings


def _code_for(error) -> str:
    if error.validator == "required":
        return "SCHEMA_MISSING_FIELD"
    if error.validator in {"if", "then", "else", "allOf"}:
        return "SCHEMA_INVALID_CONDITIONAL"
    return "SCHEMA_INVALID_FIELD"


def _missing_required_field(error) -> str:
    if error.validator == "required":
        marker = "'"
        msg = error.message
        if marker in msg:
            parts = msg.split(marker)
            if len(parts) >= 2:
                return parts[1]
    return ""
