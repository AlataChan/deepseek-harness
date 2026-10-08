# Agent Note: The upstream-upgrade repair checkpoint enforces the intake gate and proves the migration chain

Status: implemented

English | [中文](2026-10-07-upstream-upgrade-repair-checkpoint.zh.md)

## Problem

After hops 1 and 2 of the staged upstream upgrade, the handover ([`docs/plans/2026-10-06-upstream-upgrade-handover.md`](../../../../docs/plans/2026-10-06-upstream-upgrade-handover.md)) documented that the checkpoint evidence did not support the claims made for it. The intake gate had passed for the wrong reason: its merge-time rules never ran, and `FORBIDDEN_ENDPOINTS` was referenced by no rule. The 15-failure test suite had been accepted through a per-file comparison against master instead of the plan's acceptance criteria. Phase 2's migration evidence did not exist, and the pre-migration backup guard was an undecided owner decision. The owner required a repair checkpoint (handover §0.5) before hop 3 could merge.

The checkpoint had to close both failure modes the handover exposed — rules that exist but never execute, and a telemetry check that composed configuration could evade — and produce migration evidence on real session data before any further upstream hop.

## Decision

The repair landed on branch `upstream-upgrade/repair-2026-10-07`, rebaselined onto `master` first (owner-confirmed deviation recorded in handover §0.0): `master` had moved past the handover's merge base, and `bc7dd22f35` ships five `media/*` session events in a DMG, so the fork-event baseline is nine events, not four. The rebaseline merge `e0064c17df` plus `bd112611c5` and `790a447cd6` typed the desktop-media tests for the host and client aggregates and re-recorded the `conversation-media-creation` snapshot on Session v3.

The frozen v0 inventory now covers all nine fork events, and `team/member` payloads validate per schema version: v1 rejects the `model` field, v2 forbids `delivery` on queued members (`ce5f4f430b`, `774a4b3f6a`). The gap was found by the real-data run refusing 11 of 152 logs — the stop condition of the [historical unknown-event refusal decision](../architecture/2026-08-31-alpha-historical-unknown-event-refusal.md) working as designed, not a failure to suppress.

The intake gate ([`scripts/verify-upstream-intake.ts`](../../../../scripts/verify-upstream-intake.ts), rules in [`scripts/upstream-intake-registry.ts`](../../../../scripts/upstream-intake-registry.ts)) enforces its own rules instead of trusting a hand-computed diff: it computes `changedUpstreamFiles` against `upstreamPin` (`dsh-v0.1.5-alpha.1`) itself, and rule 6 resolves every mounted telemetry row's endpoint and mode from the composed `cordis` config, failing closed on a `FORBIDDEN_ENDPOINTS` hit and on an unresolvable `!!js` composition (`fd45067654`). Failing-case specs cover an unregistered patched file, an upstream-endpoint telemetry row, and an `undefined` E-class disposition; `26b935ca7b` closed two review-found evasion holes in the same gate. The three E-class dispositions are recorded as follow-upstream-deletion. The `ignorable` inspection is typed registry data: 9 events, 152 real logs, required-not-ignorable. 17 fork edits are registered in `PATCHES`, of which 4 surfaced only through the composition-surface extension — including the backup-guard commit itself.

The media surface brought in by the rebaseline is classified in the cordis catalog with 0 violations; master still reports 2 there, a `collectEvents` blind spot on master's side (`a5f8db13f2`). The slot catalog is regenerated for the merged client slots (`1124954ae1`).

The pre-migration backup guard sits at the head of `prepareStoredMigration` in `packages/session/session-persistence-jsonl`, covering both open paths and therefore the companion, the `dsh` CLI, and the Python SDK (`60684b5c60`). The guard fsyncs, verifies the written size, is idempotent, and stops startup loudly with `JsonlMigrationBackupError` when the backup fails; [`migration-backup.spec.ts`](../../../../packages/session/session-persistence-jsonl/tests/migration-backup.spec.ts) pins the stop.

The v3→v4 step is proven but not committed: on a scratch branch off `dsh-v0.1.7-alpha.1`, all nine fork event types were missing from `RELEASED_V3_EVENT_TYPES`, `team/*` including v2 payloads is already upstream-authored, and one 125-line patch on the shared constant covers both the migration stage and historical V3 reads. The patch is recorded verbatim in the upgrade plan findings for re-application as hop 3's first work item; no commit carries it.

Handover §0.0 and the plan status record the executed checkpoint; the owner retroactively authorized hops 1 and 2 once it passed (`4e6c6717b9`).

## Verification

Real-data migration evidence: 152 of 152 sessions migrate, list, open, publish v3, and reopen after the team-v2 fix; 152 of 152 backups are `cmp`-identical to a reference copy; the originals stay byte-identical throughout, pinned by a shasum manifest. A scrubbed real `ask-data` log is committed as the whole-log replay fixture [`released-v0-fork-ask-data.jsonl`](../../../../packages/session/session-persistence-jsonl/tests/fixtures/released-v0-fork-ask-data.jsonl); upstream-authored v0 coverage is the migration chain's own v0 corpus plus `released-v0-real-shapes.jsonl`. The full suite on the rebaselined tree shows 0 merge-introduced regressions: 16 failed files reduce to 14 pre-existing-on-master and 2 load-sensitive when each file runs alone on both trees. The scratch v3→v4 tree passes 384 of 384 in the session-persistence-jsonl suite. Per-step logs, the failure table, and the verbatim S8 patch are recorded in `.plans/upstream-upgrade-repair/findings.md` in the working checkout.

## Alternatives considered

**Proceed to hop 3 and fix the gaps as they surfaced.** The handover's verdict was that the execution had already ignored the plan's own acceptance criteria once; stacking a third upstream merge on unenforced gates and absent migration evidence repeats the failure with more code at risk.

**Patch the four-event baseline twice instead of rebaselining.** The owner confirmed the rebaseline so the nine-event baseline is defined once on the new branch rather than patched at hop 3, at the cost of re-typing the media tests and re-recording one snapshot now.

**Leave the gate's file list as a hand-computed input.** A hand-computed diff is exactly how the gate passed for the wrong reason; computing `changedUpstreamFiles` against `upstreamPin` inside the gate makes the unregistered-patch case a failing spec instead of an honest-man assumption.

**Check telemetry endpoints against each plugin's static config.** The `!!js` composition in the media overlay decides endpoints at load time; only resolving the composed `cordis` config — and failing closed when it does not resolve — closes the evasion the review found.

**Guard the backup at each entry point (companion, CLI, SDK).** Three entry-point guards drift; one guard at the head of `prepareStoredMigration` covers both open paths and any future caller.

**Commit the v3→v4 patch on this branch.** The patch belongs to hop 3's merge of `dsh-v0.1.7-alpha.1`; committing it ahead of that merge would land upstream-targeted changes on a tree the upgrade has not reached. Recording it verbatim preserves the proven work without reordering the hops.

## Consequences

The checkpoint's five §0.5 items pass, and the two gate failure modes — dormant rules and an evadable telemetry check — are closed with failing-case specs rather than assertions. The migration chain is proven end-to-end on real data with an integrity-checked backup copy, and Phase 2's hop-independent items (fixtures, backup test, real profile run) are done. Hop 3 is unblocked with its highest-risk item pre-solved and recorded for re-application.

The costs: the branch carries a rebaseline merge rather than the handover's assumed base, so its diff against the old base includes the master-side media work; the v3→v4 patch exists only as recorded text until hop 3 applies it; and master's two cordis-catalog violations remain master's to fix, documented here as a `collectEvents` blind spot rather than merged into this tree's accounting. Owner sign-off on the migration and the go for hop 3 were still pending when this note was written.
