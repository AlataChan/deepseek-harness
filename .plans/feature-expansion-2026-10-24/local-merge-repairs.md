# Local merge repair record

Status: local merge blockers repaired and independently reviewed on 2026-10-29. Linux native TUI PTY and Windows ConPTY qualification are explicitly deferred by the user. No commit, merge, push, CI dispatch or external credential use is part of this repair pass.

## Changes

- Preserve historical proposed API sketches under `.plans/archived-designs/` and replace obsolete public examples with bilingual navigation entries. The relocation manifest records original hashes.
- Archive 772 verified untracked compiler outputs from source directories with their original bytes and hashes. Source declarations now resolve once; authored or tracked source files are retained.
- Keep maintained source and public documentation under repository-reference validation; exclude local execution records and binary assets. Tests reject equivalent invalid references in current documentation, IM source and TUI source.
- Declare exact Chinese-only course-resource and generated media-workspace translation exceptions, document their scope, repair affected paragraph separation, and refresh bilingual records.
- Preserve the independently launched knowledge converter worker in the publication payload. Publish the empty runtime module for the type-only barrel without shipping the unbundled Client implementation tree. Package constraints reject omission and unintended broad publication.
- Document the twelve IM signature types at their actual package source owners, generate both service APIs, classify the optional launcher restore controller, update subsystem navigation and validate the typed disposal fixture. AGY implemented the repairs; Codex reviewed them, corrected the remaining bilingual capability graph and independently reproduced the affected tests.

## Evidence already completed

| Command | Result |
|---|---|
| `pnpm vitest run scripts/check-workspace-constraints.spec.ts scripts/verify-repository-references.spec.ts` | 123 tests passed |
| `pnpm vitest run scripts/check-workspace-constraints.spec.ts` after adding the broad-payload rejection control | 111 tests passed |
| `pnpm exec tsx scripts/verify-repository-references.ts` | Passed |
| `pnpm run verify-md-wrap` | 1,983 files passed |
| `pnpm run verify-persistence-catalog` | Passed |
| `pnpm run verify-export-jsdoc` | Passed |
| `pnpm run doc-typecheck:contracts-ready` | 79 blocks compiled; passed |
| `pnpm run verify-package-paths` | 6,174 files passed |
| `pnpm run publint` | Passed |
| `pnpm --filter @deepseek-ai/dsh-experimental-desktop-ask-knowledge run bundle` | Passed |
| `pnpm pack --pack-destination /tmp/dsh-knowledge-publication-review` in the knowledge package | Archive created; required worker present, empty type-barrel import passed under Node, unbundled Client JS absent |
| Focused oxlint for the repaired constraint/reference scripts and tests | Passed |

## Final verification

| Check | Result | Evidence |
|---|---|---|
| `pnpm run doc-sync` | 42 passed; zero failed or skipped | `/tmp/dsh-merge-docsync-pass.log`, 382.74 seconds |
| `pnpm run hygiene` | 16 passed; zero failed or skipped | `/tmp/dsh-merge-hygiene-recheck.log`, 497.35 seconds |
| IM session-provider owner tests | 7 passed | `/tmp/dsh-merge-im-disposal-review.log` |
| Catalog partition controls | 12 passed | `/tmp/dsh-merge-catalog-policy-review.log`; 28 pre-existing skipped legacy contract cases are not counted |
| Constraint/reference policy tests | 123 passed; constraint file rerun with the additional payload rejection assertion: 111 passed | `/tmp/dsh-merge-policy-tests.log`, `/tmp/dsh-merge-publication-policy-tests.log`; overlapping selections are not summed |
| `pnpm exec tsx scripts/verify-upstream-intake.ts` | Passed | `/tmp/dsh-merge-intake-final.log` |
| Focused catalog/script/fixture oxlint | Passed | `/tmp/dsh-merge-catalog-lint.log`, `/tmp/dsh-merge-policy-lint.log` |
| Knowledge package build, pack and unpacked empty type-barrel import | Passed | `/tmp/dsh-merge-knowledge-build.log`; `/tmp/dsh-knowledge-publication-review/` |

The earlier 38/42 and 41/42 documentation runs exposed required integration defects; they are superseded by the final 42/42 run. The final fix synchronizes the Chinese capability graph and service descriptions before recording the translation pair, rather than merely accepting stale content. No required local finding remains open. The [worker repair record](catalog-repair-report.md) identifies the supervised implementation and subsequent independent correction.

Linux native TUI PTY and Windows ConPTY remain unverified and explicitly deferred by the user. Real IM accounts, production Linux, physical two-host SSH, live providers and production packaging remain separate external acceptance gates. This result permits local source integration review; it is not a cross-platform or production release approval. No commit, merge, push or CI dispatch was performed.

The expected AGY dispatch settled successfully, was reviewed, and was released before its completion delivery was acknowledged. The external terminal remains idle; the reclaimable-worker list is empty.


## Recoverability

The repair backup is identified by `/tmp/dsh-merge-repairs-location.json`; its directory holds `tracked-before/`, `tracked-hashes.json`, `source-emit-archive/` and `source-emit-archive-manifest.json`. All 62 initially dirty tracked files remain present. Before final status edits, only the two intentionally repaired constraint scripts and the intake registry differ from that backup. The backup does not redefine unrelated user work as repair output. All 772 archived compiler artifacts and five preserved historical source records match their recorded hashes.

Final preservation audit: all 62 initially dirty tracked files remain present; 55 are hash-identical and the seven changed files are the authorized constraint/intake repairs and four plan/status records. `final-preservation-audit.json` in the backup directory records the exact paths. All ten updated status documents pass relative-link and anchor validation, and `git diff --check` passes. No additional runtime source change followed the passing aggregates.
