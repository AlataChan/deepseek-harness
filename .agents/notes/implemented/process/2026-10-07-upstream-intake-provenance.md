# Agent Note: Upstream intake provenance lives in the machine-checked registry

Status: implemented

English | [中文](2026-10-07-upstream-intake-provenance.zh.md)

## Problem

The fork's deltas against upstream were undocumented patch debt. Fork edits to upstream-authored files existed with no record of what changed or why, so every upstream merge re-discovered them as conflicts and could silently drop fork behavior. Declined surfaces had the same gap: nothing recorded that `apps/desktop` is fork-authored rather than evolved from upstream's Electron application, or that upstream's shell, account, telemetry, and release surface must not enter the fork.

The [selective-upgrade plan](../../../../docs/plans/2026-10-06-upstream-selective-upgrade.md) made this a Phase 0 requirement: every fork delta must exist as an overlay package, a registered patch, or a recorded composition decision, and the record must be checkable. The root `AGENTS.md` states the `apps/desktop` fact; this note supplies the reasoning so the question is not reopened.

## Decision

**The provenance record is machine-checked data in [`scripts/upstream-intake-registry.ts`](../../../../scripts/upstream-intake-registry.ts), not a markdown ledger.** [`scripts/verify-upstream-intake.ts`](../../../../scripts/verify-upstream-intake.ts) reads the registry as its single authority and fails on any delta the registry does not admit. The plan's Phase 0 originally named a markdown ledger under `docs/plans/`; that deviation was accepted on the round 3 review recommendation, and no generated ledger view exists — the registry's field documentation and the plan carry the prose.

### What the registry records

- `UPSTREAM_PIN` (`dsh-v0.1.5-alpha.1`): the upstream tag the gate diffs the working tree against to compute the upstream files the fork edits, so the merge-time rules always run rather than depend on a hand-maintained list.
- `PATCHES`: every upstream file the fork edits — 59 entries at the 2026-10-07 repair checkpoint, 40 `A` rows kept as fork edits and 19 `B` rows pending the Phase 3 overlay move-down — each with a reason. A patch without a reason is the defect this table exists to catch.
- `NEVER_MERGE`, `UPSTREAM_ONLY_DIRECTORIES`, `REMOVALS`: upstream surfaces the fork structurally declines, each with a class and a disposition. The E-class rows (`packages/e2b`, `packages/code-runtime`, `packages/runtime-diagnostics`) carry `follow-upstream-deletion`, owner-confirmed on 2026-10-07.
- `MOUNTS`, `GATED_PACKAGE_NAMES`, `FORBIDDEN_ENDPOINTS`, and `FORBIDDEN_DEPENDENCIES` with `GUARDED_MANIFESTS`: composition decisions and their enforcement — which telemetry and account rows exist, what must change, and which upstream collectors a mounted row must never resolve to.
- `IGNORABLE_INSPECTION`: the inspection of 152 real user logs that established the fork's nine session events are written without `ignorable: true`, so every migration edge must admit them as required events or refuse the log.
- `FORK_OWNED_PATHS`: `apps/desktop/` and `packages/experimental/`, subtracted before the patch check. `apps/desktop` is the provenance finding Phase 0 action 3 named: the fork authored a Tauri shell on that path, upstream's Electron `apps/desktop` arrived after the 2026-09-03 merge base, and the path therefore collides with fork code rather than evolving from it. The collided tree is guarded by exact `NEVER_MERGE` files plus the `FORBIDDEN_DEPENDENCIES` rule — `electron`, `electron-builder`, `electron-updater` in `apps/desktop/package.json` — because an enumeration of upstream's Electron tree would rot on the next upstream commit while the dependency rule does not.

## Alternatives considered

- **The plan's markdown ledger** (`docs/plans/2026-10-06-upstream-intake-registry.md`). Rejected: prose cannot be executed, so drift between the ledger and the tree stays unnoticed until a merge fails or silently drops fork behavior. The registry holds the same content as typed data the gate runs.
- **Rely on git history and merge conflicts.** Rejected: a conflict re-surfaces an edit without its reason, and a clean merge is not evidence that fork behavior survived. Conflicts are per-merge rediscovery, not a provenance record.
- **Enumerate upstream's `apps/desktop` tree in the registry.** Rejected because the enumeration rots on the next upstream commit. The exact `NEVER_MERGE` files plus the dependency rule hold the same invariant without tracking upstream's churn.
- **Admit only overlays and refuse every in-place fork edit.** Rejected: Phase 3 works the `B` rows down to overlays, and recording outstanding debt with a class and disposition keeps it visible instead of failing the tree before the change lands.

## Consequences

- Selective upgrade is enforceable, not aspirational. The gate fails on an unregistered upstream edit, an undefined removal disposition in merge-time mode, or a telemetry row resolving to a forbidden endpoint; failing-case specs prove each rejection path.
- The registry grows with every hop. Hop 3's first action registers the new fork edits the merge surfaces, so provenance is maintained at merge time rather than audited afterwards.
- The record is code: it typechecks, it is reviewed in the diff that ships it, and renaming a field breaks the gate rather than a document. The cost is that the reader sees TypeScript rather than a ledger page, and counts quoted in prose must move with the registry.
- The telemetry rows cross-link to the [fork telemetry default](../feature/2026-10-06-fork-telemetry-disabled-default.md); the [handover](../../../../docs/plans/2026-10-06-upstream-upgrade-handover.md) tracks the remaining hop work.
