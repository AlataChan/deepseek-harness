from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from octopus_kb_compound.apply import (
    ValidateInputError,
    ValidateRuntimeError,
    recover_proposal,
    validate_proposal_file,
)
from octopus_kb_compound import ingest
from octopus_kb_compound.export import export_graph_artifacts
from octopus_kb_compound.frontmatter import FrontmatterError, parse_document
from octopus_kb_compound.impact import find_impacted_pages
from octopus_kb_compound.ingest import OptionalDependencyMissing
from octopus_kb_compound.inbox import (
    accept_inbox,
    list_inbox,
    reject_inbox,
    review_inbox,
)
from octopus_kb_compound.links import suggest_links
from octopus_kb_compound.lint import lint_pages
from octopus_kb_compound.lookup import lookup_term
from octopus_kb_compound.migrate import inspect_vault_for_migration, normalize_vault, render_migration_report
from octopus_kb_compound.neighbors import compute_neighbors
from octopus_kb_compound.planner import plan_maintenance, render_plan
from octopus_kb_compound.profile import load_vault_profile
from octopus_kb_compound.propose import (
    ProposeInputError,
    ProposeRuntimeError,
    propose_from_raw,
)
import octopus_kb_compound.retrieve as retrieve_mod
from octopus_kb_compound.retrieve import build_retrieval_bundle
from octopus_kb_compound.schema import validate_frontmatter
from octopus_kb_compound.summary import render_summary, summarize_vault
from octopus_kb_compound.vault import load_page, scan_markdown_files


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="octopus-kb", description="Utilities for Obsidian-backed LLM knowledge bases.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    lint_parser = subparsers.add_parser("lint", help="Lint a vault for broken links and metadata gaps.")
    lint_parser.add_argument("vault", type=Path)
    lint_parser.add_argument("--json", action="store_true")

    suggest_parser = subparsers.add_parser("suggest-links", help="Suggest wikilinks for a page using a vault index.")
    suggest_parser.add_argument("page", type=Path)
    suggest_parser.add_argument("--vault", required=True, type=Path)

    ingest_parser = subparsers.add_parser("ingest-url", help="Fetch a public URL and write it into raw/ as a markdown source.")
    ingest_parser.add_argument("url")
    ingest_parser.add_argument("--vault", required=True, type=Path)
    ingest_parser.add_argument("--tags", default="")
    ingest_parser.add_argument("--lang", default="zh")

    ingest_file_parser = subparsers.add_parser("ingest-file", help="Convert a local file and write it into raw/ as a markdown source.")
    ingest_file_parser.add_argument("path", type=Path)
    ingest_file_parser.add_argument("--vault", required=True, type=Path)
    ingest_file_parser.add_argument("--tags", default="")
    ingest_file_parser.add_argument("--lang", default="zh")

    summary_parser = subparsers.add_parser("vault-summary", help="Summarize vault structure, entries, and lint findings.")
    summary_parser.add_argument("vault", type=Path)

    impact_parser = subparsers.add_parser("impacted-pages", help="Report pages likely impacted by a page change.")
    impact_parser.add_argument("page", type=Path)
    impact_parser.add_argument("--vault", required=True, type=Path)
    impact_parser.add_argument("--json", action="store_true")

    plan_parser = subparsers.add_parser("plan-maintenance", help="Plan deterministic wiki maintenance for a changed page.")
    plan_parser.add_argument("page", type=Path)
    plan_parser.add_argument("--vault", required=True, type=Path)

    inspect_parser = subparsers.add_parser("inspect-vault", help="Inspect an existing vault before migration.")
    inspect_parser.add_argument("vault", type=Path)

    normalize_parser = subparsers.add_parser("normalize-vault", help="Normalize vault frontmatter into staging by default.")
    normalize_parser.add_argument("vault", type=Path)
    normalize_parser.add_argument("--apply", action="store_true")
    normalize_parser.add_argument("--in-place", action="store_true")

    export_parser = subparsers.add_parser("export-graph", help="Export graph-aware JSON artifacts for retrieval systems.")
    export_parser.add_argument("vault", type=Path)
    export_parser.add_argument("--out", required=True, type=Path)

    validate_frontmatter_parser = subparsers.add_parser(
        "validate-frontmatter",
        help="Validate frontmatter blocks against the PageMeta schema.",
    )
    validate_frontmatter_parser.add_argument("path", type=Path)
    validate_frontmatter_parser.add_argument("--json", action="store_true")

    lookup_parser = subparsers.add_parser("lookup", help="Resolve a term to a canonical page or alias collision.")
    lookup_parser.add_argument("term")
    lookup_parser.add_argument("--vault", required=True, type=Path)
    lookup_parser.add_argument("--json", action="store_true")

    retrieve_parser = subparsers.add_parser(
        "retrieve-bundle",
        help="Build an ordered retrieval evidence bundle for a query.",
    )
    retrieve_parser.add_argument("query")
    retrieve_parser.add_argument("--vault", required=True, type=Path)
    retrieve_parser.add_argument("--max-tokens", type=int, default=0)
    retrieve_parser.add_argument("--json", action="store_true")

    neighbors_parser = subparsers.add_parser("neighbors", help="Report graph neighbors for a page.")
    neighbors_parser.add_argument("page", type=Path)
    neighbors_parser.add_argument("--vault", required=True, type=Path)
    neighbors_parser.add_argument("--json", action="store_true")

    propose_parser = subparsers.add_parser("propose", help="Ask an LLM to propose safe KB changes from a raw source.")
    propose_parser.add_argument("raw_file", type=Path)
    propose_parser.add_argument("--vault", required=True, type=Path)
    propose_parser.add_argument("--profile")
    propose_parser.add_argument("--json", action="store_true")

    validate_parser = subparsers.add_parser("validate", help="Validate and optionally apply a proposal.")
    validate_parser.add_argument("proposal", type=Path)
    validate_parser.add_argument("--vault", required=True, type=Path)
    validate_parser.add_argument("--apply", action="store_true")
    validate_parser.add_argument("--json", action="store_true")

    recover_parser = subparsers.add_parser("recover", help="Recover a proposal apply interrupted mid-commit.")
    recover_parser.add_argument("proposal_id")
    recover_parser.add_argument("--vault", required=True, type=Path)

    inbox_parser = subparsers.add_parser("inbox", help="List, review, accept, or reject deferred proposals.")
    inbox_parser.add_argument("--vault", required=True, type=Path)
    inbox_parser.add_argument("--list", action="store_true")
    inbox_parser.add_argument("--review")
    inbox_parser.add_argument("--accept", action="store_true")
    inbox_parser.add_argument("--reject", action="store_true")
    inbox_parser.add_argument("--reason", default="")
    inbox_parser.add_argument("--json", action="store_true")

    eval_parser = subparsers.add_parser("eval", help="Run or report deterministic eval suites.")
    eval_subparsers = eval_parser.add_subparsers(dest="eval_command", required=True)
    eval_run_parser = eval_subparsers.add_parser("run", help="Run an eval task suite.")
    eval_run_parser.add_argument("--tasks", required=True, type=Path)
    eval_run_parser.add_argument("--out", required=True, type=Path)
    eval_run_parser.add_argument("--json", action="store_true")
    eval_report_parser = eval_subparsers.add_parser("report", help="Render a summary for a prior eval run.")
    eval_report_parser.add_argument("--run", required=True, type=Path)
    eval_report_parser.add_argument("--format", choices=["markdown"], default="markdown")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "lint":
        rc = _validate_vault_dir(args.vault)
        if rc is not None:
            return rc
        profile = load_vault_profile(args.vault)
        pages = scan_markdown_files(args.vault, profile)
        findings = lint_pages(pages)
        if args.json:
            print(json.dumps({"findings": [_lint_finding_to_dict(finding) for finding in findings]}, ensure_ascii=False))
        else:
            for finding in findings:
                print(f"{finding.code}\t{finding.path}\t{finding.message}")
        return 1 if findings else 0

    if args.command == "suggest-links":
        rc = _validate_vault_dir(args.vault)
        if rc is not None:
            return rc
        rc = _validate_page_file(args.page)
        if rc is not None:
            return rc
        profile = load_vault_profile(args.vault)
        pages = scan_markdown_files(args.vault, profile)
        target_page = load_page(args.page, root=args.vault)
        suggestions = suggest_links(target_page.body, pages, current_title=target_page.title)
        for suggestion in suggestions:
            print(f"{suggestion.target_title}\t{suggestion.anchor_text}\t{suggestion.reason}")
        return 0

    if args.command == "ingest-url":
        rc = _validate_vault_dir(args.vault)
        if rc is not None:
            return rc

        try:
            body, metadata = ingest.fetch_url_as_markdown(args.url)
            output_path = ingest.generate_raw_page(
                body,
                metadata,
                args.vault / "raw",
                lang=args.lang,
                tags=_parse_tags(args.tags),
            )
        except (OSError, RuntimeError, ValueError) as exc:
            print(str(exc), file=sys.stderr)
            return 2

        print(output_path)
        return 0

    if args.command == "ingest-file":
        rc = _validate_vault_dir(args.vault)
        if rc is not None:
            return rc
        rc = _validate_page_file(args.path)
        if rc is not None:
            return rc

        try:
            body, metadata = ingest.convert_file_to_markdown(str(args.path))
            output_path = ingest.generate_raw_page(
                body,
                metadata,
                args.vault / "raw",
                lang=args.lang,
                tags=_parse_tags(args.tags),
            )
        except OptionalDependencyMissing as exc:
            print(str(exc), file=sys.stderr)
            return 1
        except (OSError, RuntimeError, ValueError) as exc:
            print(str(exc), file=sys.stderr)
            return 2

        print(output_path)
        return 0

    if args.command == "vault-summary":
        rc = _validate_vault_dir(args.vault)
        if rc is not None:
            return rc

        print(render_summary(summarize_vault(args.vault)))
        return 0

    if args.command == "impacted-pages":
        rc = _validate_vault_dir(args.vault)
        if rc is not None:
            return rc
        page = _resolve_page_in_vault(args.page, args.vault)
        if page is None:
            return 2

        impacted = find_impacted_pages(page, args.vault)
        if args.json:
            print(
                json.dumps(
                    {
                        "page": page,
                        "impacted": impacted,
                        "next": [
                            f'octopus-kb lookup "{page}" --vault "{args.vault}" --json',
                            f'octopus-kb neighbors "{page}" --vault "{args.vault}" --json',
                        ],
                    },
                    ensure_ascii=False,
                )
            )
        else:
            for path in impacted:
                print(path)
        return 0

    if args.command == "plan-maintenance":
        rc = _validate_vault_dir(args.vault)
        if rc is not None:
            return rc
        rc = _validate_page_file(args.page)
        if rc is not None:
            return rc

        print(render_plan(plan_maintenance(args.page, args.vault)))
        return 0

    if args.command == "inspect-vault":
        rc = _validate_vault_dir(args.vault)
        if rc is not None:
            return rc
        report = inspect_vault_for_migration(args.vault)
        print(render_migration_report(report))
        return 2 if report.parse_failures else 0

    if args.command == "normalize-vault":
        rc = _validate_vault_dir(args.vault)
        if rc is not None:
            return rc
        try:
            report = normalize_vault(args.vault, apply=args.apply, in_place=args.in_place)
        except OSError as exc:
            print(str(exc), file=sys.stderr)
            return 1
        print(render_migration_report(report))
        return 2 if report.parse_failures else 0

    if args.command == "export-graph":
        rc = _validate_vault_dir(args.vault)
        if rc is not None:
            return rc
        if args.out.exists() and not args.out.is_dir():
            print(f"Out path is not a directory: {args.out}", file=sys.stderr)
            return 2
        try:
            export_graph_artifacts(args.vault, args.out)
        except OSError as exc:
            print(str(exc), file=sys.stderr)
            return 1
        print(args.out)
        return 0

    if args.command == "validate-frontmatter":
        try:
            findings = _collect_frontmatter_findings(args.path)
        except OSError as exc:
            print(str(exc), file=sys.stderr)
            return 2

        if args.json:
            print(json.dumps({"findings": findings}, ensure_ascii=False))
        else:
            for finding in findings:
                print(
                    f"{finding['code']}\t{finding['path']}\t"
                    f"{finding['field']}\t{finding['message']}"
                )
        return 1 if findings else 0

    if args.command == "lookup":
        rc = _validate_vault_dir(args.vault)
        if rc is not None:
            return rc

        result = lookup_term(args.term, args.vault)
        if args.json:
            print(json.dumps(result.to_dict(), ensure_ascii=False))
        else:
            _print_lookup_result(result.to_dict())
        return 0

    if args.command == "retrieve-bundle":
        rc = _validate_vault_dir(args.vault)
        if rc is not None:
            return rc

        bundle = build_retrieval_bundle(
            args.vault, args.query, max_tokens=args.max_tokens
        )
        try:
            retrieve_mod._touch_marker(args.vault)
        except OSError as exc:
            print(f"warning: could not touch retrieve-bundle marker: {exc}", file=sys.stderr)
        data = bundle.to_dict()
        if args.json:
            print(json.dumps(data, ensure_ascii=False))
        else:
            _print_retrieval_bundle(data)
        return 0

    if args.command == "neighbors":
        rc = _validate_vault_dir(args.vault)
        if rc is not None:
            return rc
        page_rel_path = _resolve_page_in_vault(args.page, args.vault)
        if page_rel_path is None:
            return 2

        try:
            result = compute_neighbors(page_rel_path, args.vault)
        except ValueError as exc:
            print(str(exc), file=sys.stderr)
            return 2
        data = result.to_dict()
        if args.json:
            print(json.dumps(data, ensure_ascii=False))
        else:
            _print_neighbors_result(data)
        return 0

    if args.command == "propose":
        try:
            result = propose_from_raw(
                args.raw_file,
                args.vault,
                profile_name=args.profile,
            ).to_dict()
        except ProposeInputError as exc:
            print(str(exc), file=sys.stderr)
            return 2
        except ProposeRuntimeError as exc:
            print(str(exc), file=sys.stderr)
            return 1

        if args.json:
            print(json.dumps(result, ensure_ascii=False))
        else:
            print(f"proposal_id: {result['proposal_id']}")
            print(f"path: {result['path']}")
            print(f"operations: {result['operations']}")
        return 0

    if args.command == "validate":
        try:
            result = validate_proposal_file(
                args.proposal,
                args.vault,
                apply=args.apply,
            ).to_dict()
        except ValidateInputError as exc:
            print(str(exc), file=sys.stderr)
            return 2
        except ValidateRuntimeError as exc:
            print(str(exc), file=sys.stderr)
            return 1

        if args.json:
            print(json.dumps(result, ensure_ascii=False))
        else:
            _print_apply_result(result)
        return 0

    if args.command == "recover":
        try:
            result = recover_proposal(args.proposal_id, args.vault).to_dict()
        except ValidateInputError as exc:
            print(str(exc), file=sys.stderr)
            return 2
        except ValidateRuntimeError as exc:
            print(str(exc), file=sys.stderr)
            return 1
        _print_apply_result(result)
        return 0

    if args.command == "inbox":
        try:
            if args.list:
                result = list_inbox(args.vault)
            elif args.review and args.accept:
                result = accept_inbox(args.vault, args.review).to_dict()
            elif args.review and args.reject:
                if not args.reason:
                    print("--reason is required with --reject", file=sys.stderr)
                    return 2
                result = reject_inbox(args.vault, args.review, args.reason)
            elif args.review:
                result = review_inbox(args.vault, args.review)
            else:
                print("Use --list or --review <id>", file=sys.stderr)
                return 2
        except ValidateInputError as exc:
            print(str(exc), file=sys.stderr)
            return 2
        except ValidateRuntimeError as exc:
            print(str(exc), file=sys.stderr)
            return 1

        if args.json:
            print(json.dumps(result, ensure_ascii=False))
        else:
            _print_inbox_result(result)
        return 0

    if args.command == "eval":
        if args.eval_command == "run":
            if not args.tasks.exists() or not args.tasks.is_file():
                print(f"Tasks file does not exist: {args.tasks}", file=sys.stderr)
                return 2
            try:
                from octopus_kb_compound.eval.runner import run_suite

                result = run_suite(args.tasks, args.out)
            except Exception as exc:
                print(str(exc), file=sys.stderr)
                return 1
            payload = {
                "summary_path": str(result["summary_path"]),
                "task_count": len(result["task_jsons"]),
                "out_dir": str(args.out),
            }
            if args.json:
                print(json.dumps(payload, ensure_ascii=False))
            else:
                print(f"summary: {payload['summary_path']}")
                print(f"tasks: {payload['task_count']}")
            return 0

        if args.eval_command == "report":
            if not args.run.exists():
                print(f"Run directory does not exist: {args.run}", file=sys.stderr)
                return 2
            if not args.run.is_dir():
                print(f"Run path is not a directory: {args.run}", file=sys.stderr)
                return 2
            try:
                summary_path = _render_eval_report(args.run)
            except Exception as exc:
                print(str(exc), file=sys.stderr)
                return 1
            print(f"summary: {summary_path}")
            return 0

    parser.error("Unknown command")
    return 2


def _validate_vault_dir(vault: Path) -> int | None:
    if not vault.exists():
        print(f"Vault does not exist: {vault}", file=sys.stderr)
        return 2
    if not vault.is_dir():
        print(f"Vault is not a directory: {vault}", file=sys.stderr)
        return 2
    return None


def _validate_page_file(page: Path) -> int | None:
    if not page.exists():
        print(f"Page does not exist: {page}", file=sys.stderr)
        return 2
    if not page.is_file():
        print(f"Page is not a file: {page}", file=sys.stderr)
        return 2
    return None


def _lint_finding_to_dict(finding) -> dict[str, str]:
    return {
        "code": finding.code,
        "path": finding.path,
        "message": finding.message,
    }


def _relative_path_for_output(path: Path, root: Path) -> str:
    resolved_root = root.resolve()
    resolved_path = path.resolve() if path.is_absolute() else (root / path).resolve()
    try:
        return resolved_path.relative_to(resolved_root).as_posix()
    except ValueError:
        return path.as_posix()


def _resolve_page_in_vault(page: Path, vault: Path) -> str | None:
    vault_root = vault.resolve()
    page_path = page.resolve() if page.is_absolute() else (vault / page).resolve()
    if not page_path.is_relative_to(vault_root):
        print(f"Page is outside vault: {page}", file=sys.stderr)
        return None
    if not page_path.exists():
        print(f"Page does not exist: {page}", file=sys.stderr)
        return None
    if not page_path.is_file():
        print(f"Page is not a file: {page}", file=sys.stderr)
        return None
    return page_path.relative_to(vault_root).as_posix()


def _parse_tags(raw_tags: str) -> list[str]:
    return [tag.strip() for tag in raw_tags.split(",") if tag.strip()]


def _print_lookup_result(result: dict) -> None:
    canonical = result["canonical"]
    if canonical is not None:
        print(f"canonical\t{canonical['path']}")
    for alias in result["aliases"]:
        print(f"alias\t{alias['text']}\t{alias['resolves_to']}")
    for collision in result["collisions"]:
        print(f"collision\t{collision}")
    for command in result["next"]:
        print(f"next\t{command}")


def _print_retrieval_bundle(result: dict) -> None:
    bundle = result["bundle"]
    for path in bundle["schema"]:
        print(f"schema\t{path}")
    for path in bundle["index"]:
        print(f"index\t{path}")
    for section in ("concepts", "entities", "raw_sources"):
        for page in bundle[section]:
            print(f"{section}\t{page['path']}\t{page['reason']}")
    for warning in result["warnings"]:
        print(f"warning\t{warning['code']}\t{warning['message']}")
    print(f"token_estimate\t{result['token_estimate']}")
    for command in result["next"]:
        print(f"next\t{command}")


def _print_neighbors_result(result: dict) -> None:
    print(f"page\t{result['page']}")
    if result["canonical_identity"] is not None:
        print(f"canonical_identity\t{result['canonical_identity']}")
    for alias in result["aliases"]:
        print(f"alias\t{alias}")
    for inbound in result["inbound"]:
        print(f"inbound\t{inbound['path']}\t{inbound['via']}\t{inbound['count']}")
    for outbound in result["outbound"]:
        print(f"outbound\t{outbound['path']}\t{outbound['via']}")
    for command in result["next"]:
        print(f"next\t{command}")


def _print_apply_result(result: dict) -> None:
    print(f"status\t{result['status']}")
    if "verdict" in result:
        print(f"verdict\t{result['verdict']}")
    if "audit_path" in result:
        print(f"audit\t{result['audit_path']}")
    if "message" in result:
        print(f"message\t{result['message']}")
    for rule in result.get("rule_results", []):
        print(f"rule\t{rule['rule_id']}\t{rule['verdict']}\t{rule['reason']}")


def _print_inbox_result(result: dict) -> None:
    if "deferred" in result:
        for item in result["deferred"]:
            print(
                f"deferred\t{item['id']}\t{item.get('created_at') or ''}\t"
                f"{item.get('reason') or ''}\t{item.get('operations') or 0}"
            )
        print(f"count\t{result['count']}")
        return
    if "current_verdict" in result:
        print(f"proposal\t{result['proposal_id']}")
        print(f"verdict\t{result['current_verdict']}")
        for rule in result.get("rule_results", []):
            print(f"rule\t{rule['rule_id']}\t{rule['verdict']}\t{rule['reason']}")
        return
    _print_apply_result(result)


def _render_eval_report(run_dir: Path) -> Path:
    task_files = sorted(
        path
        for path in run_dir.glob("*.json")
        if not path.name.endswith(".metrics.json")
    )
    rows: list[dict] = []
    for task_file in task_files:
        data = json.loads(task_file.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            continue
        rows.append(data)

    lines = [
        "# Eval Summary",
        "",
        "Tasks file: <unknown>",
        "Corpus: <unknown>",
        f"Total tasks: {len(rows)}",
        "",
        "| task_id | type | grep_score | octopus_score |",
        "|---|---|---|---|",
    ]
    for row in sorted(rows, key=lambda item: str(item.get("task_id", ""))):
        scores = {
            result.get("path_name"): float(result.get("deterministic_score", 0.0))
            for result in row.get("results", [])
            if isinstance(result, dict)
        }
        lines.append(
            f"| {row.get('task_id', '')} | {row.get('task_type', '')} | "
            f"{scores.get('grep', 0.0):.2f} | {scores.get('octopus-kb', 0.0):.2f} |"
        )

    summary_path = run_dir / "summary.md"
    summary_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return summary_path


def _collect_frontmatter_findings(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        raise OSError(f"Path does not exist: {path}")
    if path.is_file():
        return _validate_frontmatter_file(path, str(path))
    if not path.is_dir():
        raise OSError(f"Path is not a file or directory: {path}")

    findings: list[dict[str, str]] = []
    for md_path in sorted(path.rglob("*.md")):
        rel = md_path.relative_to(path)
        if any(part.startswith(".") for part in rel.parts):
            continue
        findings.extend(_validate_frontmatter_file(md_path, rel.as_posix()))
    return findings


def _validate_frontmatter_file(path: Path, display_path: str) -> list[dict[str, str]]:
    raw = path.read_text(encoding="utf-8", errors="replace")
    if not raw.replace("\r\n", "\n").replace("\r", "\n").startswith("---\n"):
        return []
    try:
        frontmatter, _ = parse_document(raw, strict=True)
    except FrontmatterError as exc:
        return [
            {
                "code": "PARSE_FAILURE",
                "path": display_path,
                "field": "",
                "message": str(exc),
            }
        ]

    return [
        {
            "code": finding.code,
            "path": display_path,
            "field": finding.field,
            "message": finding.message,
        }
        for finding in validate_frontmatter(frontmatter)
    ]


if __name__ == "__main__":
    raise SystemExit(main())
