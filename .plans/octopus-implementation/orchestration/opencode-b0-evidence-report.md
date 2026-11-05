# OpenCode B0 evidence implementation report

Date: 2026-11-03. Task: close R1–R6 of [cursor-b0-review.md](cursor-b0-review.md) in B0 documents against current DSH source, without writing B1 code. No Stage A file, skill, script, manifest, credential, lockfile, or generated file was touched; no commits, pushes, paid recordings, Feishu actions, or installer builds. B0 is **not** declared accepted here: the coordinator and a fresh Cursor review own that gate.

## Edited paths (complete list)

New:

- `.plans/octopus-implementation/stage-b0/composition.md`
- `.plans/octopus-implementation/stage-b0/guard-and-queue-oracles.md`
- `.plans/octopus-implementation/stage-b0/persistence-and-host-tests.md`
- `.plans/octopus-implementation/orchestration/opencode-b0-evidence-report.md` (this file)

Updated:

- `.plans/octopus-implementation/stage-b0/authority-matrix.md` (R1: helper/cast consumers, model-authored-echo rule, coverage note)
- `.plans/octopus-implementation/stage-b0/review-exit-evidence.md` (R1–R6 disposition table, R6 section, B2 pins, exit disposition)
- `docs/plans/2026-11-03-octopus-human-led-orchestration-design.md` (B sections: `withdrawn` admission-index value; answer-text composition rule in the authority section)
- `docs/plans/2026-11-03-octopus-implementation-roadmap.md` (current-execution-evidence paragraph only)
- `docs/plans/2026-11-03-octopus-stage-b0-b1-persistent-questions-plan.md` (B0.1/B0.2/B0.3 artifact pointers; B1.3 read tool; B1.4 composed answer text + withdrawn barrier; B1.5 durable-roots extension)
- `docs/plans/2026-11-03-octopus-stage-b2-feishu-decisions-plan.md` (B2.1 item 8: delivery-admission, receipt-namespace, handle-ownership, bounded-reader pins)

## R1–R6 disposition

| Finding | Disposition | Home |
| --- | --- | --- |
| R1 | Closed. Matrix extended with `tool-skill`'s cast-indirected `invokedSkillNames` (`packages/skill/tool-skill/src/index.ts:409-431`) and session-reference expansion. Chosen rule: the answer Remote composes `Answer to question <uuid>: option <n>` from server data only — UUIDv4 decision IDs via `crypto.randomUUID()` (alphabet `[0-9a-f-]`, proven inert against `SKILL_GESTURE` and the `@[label](dsh-session:…)` mention grammar); model-authored labels are never echoed, and quoting is explicitly rejected as insufficient because both scanners inspect every text block. Model retrieval of question context, including post-compaction, uses a specified read-only `read_persistent_question` tool returning the saved record as an ordinary logged tool result (no new source kind, no injection hook, no persistence review). Six B1 authority tests specified. | composition.md; authority-matrix.md |
| R2 | Closed. Legitimate QueueDock edit/remove/steer preserved; official QueueDock untouched. Durable event shapes corrected against source (`replace` is one atomic splice carrying removal+replacement; steer is two splices). Per-event handling table with batch-aware replacement resolution on the serialized write chain — no transient durable withdrawn barrier; a crash leaves the safe unresolved side, never a false withdrawal. `withdrawn` admission-index value pinned (design updated). Stale retries cannot re-admit a withdrawn answer because the answer Remote checks the durable index before `prompt()`. Claimed-but-rejected = `needs_reconciliation` (no requeue; verified at `agent-loop/src/agent.ts:272,284,317-320`). Seven B1 tests specified. | guard-and-queue-oracles.md |
| R3 | Closed. Exported fields, aggregate envelope with frozen `formatVersion: 1` as the declared domain version (any other version is `invalid-record` at open, fail loud, no runtime conversion — future versions ship with their own owner-run conversion), decoder = record schema, no-new-`SessionEventMap`-member statement split into the two payload families (a new `meta` *value* under the existing `meta?: JsonValue` field changes no declared Session type shape → no acknowledgement, conditioned on unchanged declared type shapes rather than a blanket JsonValue exemption; the decision aggregate envelope is feature-owned, never a Session type), 30-day closed-record retention with unresolved-evidence protection, a frozen 1,000-record capacity default with refusal-not-eviction, and a fail-loud invalid-record policy matching storage-domain whole-domain open validation — no unsupported quarantine promise. | persistence-and-host-tests.md |
| R4 | Closed. Producing-step identity pinned to the logged `tool/call {turn, step}` of the question call, resolved in the guard through `exec.rootCallId` (registry-resolved for root and nested calls; PTC children map to the outer `run_code` call) — no invented `ToolExecution.step`. Synchronous registration inside the tool body after durable save, before `concludeTurn`; reset on matching `step/end`/`turn/end` via the scoped `session/event` listener and on non-correlated human claims. Four oracle families specified: same-step leftover denial, non-human continuation, ordinary steering release, PTC child denial. | guard-and-queue-oracles.md |
| R5 | Closed. Read owners: pending side via `ctx.sessionProjections.snapshot(session, ['inbox'])` (standard fold of all historical splices = current pending state); entered side via the public `SessionQueryEngine` service (`packages/session-query/session-query/src/index.ts:98`; `readEvent` at `:355` with `readWindowMax`-clamped windows, default 50; `readSession` at `:184` for full replay-validated snapshots; search-with-limit for seq location, `needs_reconciliation` on limit exhaustion), with the cost honesty that bounded returned windows are not bounded backend work; `hasPromptRequest` explicitly recorded as not public. Flush owner: `sessions.flush(session)` (the single `session/flush` entry point). Launch path: `dsh web` / `dsh --profile web` + `apps/web/tests/scaffold.ts` under `vitest.web.config.ts`; scaffold extension specified (caller-owned `durableRoots` in `LaunchOptions`, cleanup ownership shifts to the caller for those paths). Cold-restore duplicate-request tests remain **unrun** and are recorded as explicit B1 acceptance obligations; static plausibility is not a pass. | persistence-and-host-tests.md |
| R6 | Closed. Eligible scopes: enabled root-session native-tool scopes only. PTC exclusion is structural: under `mode: 'ptc'` the wire listing collapses to `run_code` (`tools/src/index.ts:1010-1026`) and model-direct native calls are denied (`:1348-1353`); nested sub-dispatches hit the body, which refuses `DECISION_PTC_UNSUPPORTED` when `exec.parent !== undefined` before save/disarm; `tools.restrict` is unusable here because it cannot name scoped tools. Honest gap recorded: no public registration-time presentation-mode reader (`modeFor` is private). Busy predicates named with exact APIs and fields: `jobs.list(caller)` running/stopping, `subagents.listChildren` open-turn timing projection, `teams.listMembers` running/provisioning — checked inside the exclusive tool body before save/disarm. | review-exit-evidence.md |

B2 suggestions (generic capability direction, single publication owner, non-idle target/`maxActiveDeliveries: 1`, receipt writer/namespace, non-ownership of asking-session handles, bounded reconciliation) are pinned in the B2 plan B2.1 item 8; no IM pipeline was implemented.

## Verification performed

Scoped checks only, per the brief:

- Targeted source verification of every cited API/line while writing (grep/sed reads; no builds, no test runs — the brief forbids broad builds/tests and the 218-test Cursor result stays historical).
- Markdown/link/whitespace pass over the seven edited files: relative links resolve to existing files; no trailing whitespace; single trailing newline (checked below).

```sh
# scoped checks actually run
grep -rnE ' +$' .plans/octopus-implementation/stage-b0/*.md .plans/octopus-implementation/orchestration/opencode-b0-evidence-report.md
for f in .plans/octopus-implementation/stage-b0/*.md .plans/octopus-implementation/orchestration/opencode-b0-evidence-report.md; do
  [ "$(tail -c1 "$f" | wc -l)" = 1 ] || echo "missing final newline: $f"
done
```

## Remaining unresolved gaps (honest list)

- All B1 tests named across the three evidence files remain uncreated and unrun; none is claimed as passed.
- The persistent cold-restart duplicate-request test does not exist anywhere yet; single admission across restart is a design property until B1.5 passes it.
- The `durableRoots` scaffold extension and the `read_persistent_question` tool are specified, not implemented.
- No public presentation-mode reader exists at tool-registration time; the PTC exclusion relies on core's mode collapse plus the body-level parent check.
- The 218-test Cursor run is historical evidence of existing behavior, not a fresh pass and not B1 acceptance.

## Coordinator follow-ups incorporated

- Composition draft: pinned the concrete UUIDv4 ID factory/alphabet with per-grammar inertness proof; replaced the underspecified claimed-event injection with the `read_persistent_question` tool; removed the "Host-authored" claim for transported question text; retained unconditional preservation of admitted human input.
- Queue draft: corrected R2 oracle 2 so only replacement text is admitted after an edit; corrected the claimed-rejected outcome to `needs_reconciliation` against `agent.ts:272,284,317-320` (no requeue); pinned the batch-aware edit/promotion-vs-remove distinction and the no-transient-withdrawn-barrier write ordering.
- Persistence draft: replaced the client-helper entered-side citation with the exact public Host reader (`SessionQueryEngine.readEvent`/`readSession`, `packages/session-query/session-query`; window clamp and cost honesty); froze the R3 capacity default (1,000 records) and the domain version/decoder decision instead of deferring them; separated new Session payload meta from new aggregate payload and conditioned the no-acknowledgement on unchanged declared Session type shapes, not a blanket JsonValue exemption; incorporated the located `readEvent` window types and bounded-vs-backend-work distinction.
