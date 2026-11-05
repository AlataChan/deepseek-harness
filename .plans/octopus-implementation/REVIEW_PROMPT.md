# Independent implementation review

Requested reviewer: Cursor with Opus 5.5. Record the actual reviewer/model if available; do not infer it from a launch label.

Review the Octopus Stage A, B0/B1, and B2 implementation against current source and the five approved documents. Do not implement fixes, change fixtures, commit, merge, push, launch workers, or send IM messages. Stage C is excluded.

Read these documents first:

1. `docs/plans/2026-11-03-octopus-implementation-roadmap.md`
2. `docs/plans/2026-11-03-octopus-human-led-orchestration-design.md`
3. `docs/plans/2026-11-03-octopus-stage-a-native-teamwork-plan.md`
4. `docs/plans/2026-11-03-octopus-stage-b0-b1-persistent-questions-plan.md`
5. `docs/plans/2026-11-03-octopus-stage-b2-feishu-decisions-plan.md`

The checkout contains unrelated pre-existing changes. Review the actual staged, unstaged, and untracked feature files; a diff against HEAD alone omits new packages. Record the live HEAD, branch, and reviewed file hashes. Use `orchestration/takeover-*` logs as execution evidence, not as substitutes for running focused independent probes. Earlier Cursor verdicts and worker reports describe earlier checkpoints.

## Source owners

- Stage A: `.agents/skills/team-orchestration/`, bundled-skill manifest, manifest-driven seed and bundle validators, their tests, native startup skill-refresh changes, filesystem skill discovery, and the Team-composed snapshots.
- Replay support: `packages/test-support/llm-replay/src/causal-team-schedule.ts`, its tests, integration with the actual replay installer, and recorded-session header expectations. Confirm the three captured Team fixture SHA-256 values remain unchanged.
- B0 evidence: `.plans/octopus-implementation/stage-b0/` and the authority, PTC, persistence, and queue dispositions.
- B1: `packages/experimental/session-decisions/`, its profile and preset composition, generated Remote declarations, desktop plugin pin, CLI dependency closure, owning documentation, and persistence-type acknowledgements.
- B2 generic IM ports: `packages/experimental/im-feishu/src/card-channel.ts`, `src/desktop.ts`, package exports and bundling, plus `packages/experimental/desktop-im/src/controller.ts` and `src/index.ts`.
- B2 feature adapter: `packages/experimental/session-decisions/src/feishu/`, the notification compare-and-set operation, optional service composition, and Client notification copy.
- Host scenarios: `apps/web/tests/persistent-questions.fixture.ts`, `persistent-questions.snapshot.ts`, `persistent-questions-feishu.snapshot.ts`, their golden files, and the narrowly changed scaffold installation-link handling.
- Distribution: the newly built application and DMG only. An older `dist/octopus_DSH.dmg` is not evidence for this implementation.

## Required probes

1. Native teamwork is explicitly human-triggered. Sessions lacking Team tools receive no recruitment instruction beyond the narrowly scoped catalog description. The installed skill includes every referenced file; a missing reference fails both seeding and package verification. Existing WeChat and Archify payload checks remain enforced through the shared validator.
2. Team replay scheduling preserves real concurrency and message causality. Installer unload restores every overridden method and releases parked promises and timers. Reject changed call order, missing children, changed model effort/configuration, and fixture drift without broad normalization.
3. One decision is one durable aggregate. No cross-record transaction or exactly-once external-effect claim is introduced. Session logs own admitted human text; the aggregate owns lifecycle, indexing, expiry, and notification references.
4. The R4 repair rejects input that arrived after the producing step began but before question creation entered its first durable write. Probe normal cleanup failure and cold restart. A refused question must never become answerable after recovery.
5. Every answer enters through `mode: 'queue'` with the feature-allocated request identity and authenticated human source. Validate revision and expiry before admission. Once admitted, never silently remove human text. Preserve late input as ordinary human text when the question becomes superseded.
6. The producing-step tool guard covers native and PTC execution. It ends at the correct step/turn or non-correlated human-input boundary. A queued or steered ordinary input must not leave a subsequent human turn permanently denied.
7. Probe duplicate and conflicting payloads, queue edits/removal/steering, a saved pending answer after restart, transcript/index disagreement, expiry, cancellation, pause/resume, shutdown, and supersession write failure. A restored pending inbox stays parked until an explicit human input wakes it; do not invent automatic recovery or re-submit the saved answer.
8. Question publication disarms Goal continuation but full-human answer authority can permit model calls to resume Goal. A truly paused Goal remains protected. UI wording must match both cases.
9. B2 reuses the sole desktop-owned Feishu connection. Generic IM code imports no question-feature types, and the Linux tenant service gains no dependency on desktop questions. Free-text IM messages retain their existing conversation routing.
10. Before sending a card, persist the publication claim in the question aggregate. A lost acknowledgment stays unknown and is never automatically replayed. Check actual message identity, publication, app, tenant, chat, authenticated operator, workspace, question revision, expiry, and authorization generation on callback. Never trust a callback-supplied Session target.
11. Desktop and card answers contend for the same B1 reservation. Write the isolated reused IM receipt after reservation and before the sole prompt. A receipt failure leaves the reservation unresolved; duplicate clicks must not send again even when no receipt exists. Admission status must not claim completion of business work.
12. Disable and credential replacement revoke the saved generation before replacement. Ordinary close preserves it. Close rejects new operations and drains admitted callbacks/sends without owning or cancelling asking Agents. Exercise cold targets and missing/subagent/wrong-workspace targets.
13. Client cards read Host state, preserve drafts on rejection, reject stale Session-switch completions, localize all product copy, distinguish notification uncertainty from answer admission, and remain answerable when IM delivery fails. Exported Session logs do not encode later storage-only card status.
14. Verify the Session entry durability barrier. Delay only the real controller's response, freeze the persistence write batch, and read the actual Session file when the aggregate commits admitted. That file must already contain the exact correlated human message. Probe overlapping checkpoints, a competing update already queued in storage, missing persistence, failed flush, and teardown. Entry evidence still outranks dismissal, but cannot become durable admission before its own Session entry is flushed. No prompt or external effect may be retried by the updater retry.
15. Probe same-batch Client submit and mutation clicks before React commits a disabled state; each must issue one Remote call. Retrying a failed card read must leave its open panel mounted. Ordinary human claims must release the producing guard; an unreserved canonical request ID must remain ordinary input.
16. Hold a real receipt write while unloading the feature. The feature must drain callbacks before either question or receipt domain closes, attempt both closes if one fails, and leave the asking Agent alive. Failed optional-channel activation must release its timer and observers.
17. Verify real installed startup, ordinary-chat control, skill discovery and precedence, native Team work, question creation/answering, persistence, and effective model selections. Package presence or empty task/mail arrays alone are insufficient acceptance evidence.

Use focused tests and negative controls. Do not lower coverage thresholds, bless changed output without explanation, introduce global exclusions, or replace public Host controllers with hand-mounted substitutes. A synthetic SDK transport is appropriate for keyless testing but cannot establish real Feishu permissions, subscriptions, offline callbacks, or platform delivery.

## Report

Write `.plans/octopus-implementation/final-independent-review.md` with:

- Verdict and score out of 10, separately identifying source, Host, replay, installer, and real-platform acceptance.
- Required findings with severity, exact file/line, reproduction, consequence, and minimal repair.
- Disposition of the earlier R4, Goal authority, queue-mode/guard, stale-answer filtering, B2 dependency-direction, publication ownership, and cold duplicate-identity findings.
- Commands actually run, exit status, passed/failed/skipped counts, and artifact identities.
- Suggested improvements separately from blockers.
- Explicit unverified or externally blocked acceptance steps. Do not turn missing real-platform evidence into a pass, and do not report a launched review as a completed review.

The final takeover evidence is indexed in `orchestration/VALIDATION.md` and `orchestration/final-gate.md`; current source identity is in `orchestration/takeover-final-source-hashes.json`. The latest 425-case feature coverage run passes all four per-file 100% thresholds with no exclusions. The final 25 Host cases and 11 strict headless/header cases are separate replay evidence. Earlier failing logs remain as red regressions or prior checkpoints. The user supplied app credentials and a private test chat. Real card callbacks passed; an ordinary-text parser defect and a stale inlined consumer were identified and repaired. Inspect the final untouched-DMG smoke separately from intermediate consumer diagnostics. Inherited-proxy startup fails inside the SDK; inspect `stage-b2/platform-qualification.md` and its sanitized evidence. A signed installer or successful socket connection cannot establish actual card delivery.

The implementation owner retains the final acceptance decision after reviewing the findings and running any required repairs.

## Live parser repair to inspect

Real Feishu SDK events supplied a valid `open_id` alongside `user_id: null`, which the previous normalizer rejected as malformed. Review the nullable identity handling, real SDK dispatcher regression, all-null and invalid-type refusals, and the added Host trace `nullable-identity-im.expected.md`. Focused transport/desktop tests: 83 passed, changed normalizer 100% per-file coverage. All 25 Host question/Feishu cases pass. Check `stage-b2/platform-qualification.md` for live and rebuilt-artifact evidence; the old DMG hash is superseded and must not be used as patched-artifact evidence. Preserve exact authentication checks and separate normal IM Session routing from answering a pending question.

The parser repair exposed an inlined consumer: `desktop-im/lib/index.js` must contain the repaired normalizer as well as the standalone `im-feishu` bundle. Check `copy-release-dmg.py` assertions for all four packaged faces and the final full-build/Tauri/package logs. The live consumer matrix explicitly marks the intermediate profile refresh as mixed-artifact diagnostic evidence; require a separate untouched final-DMG smoke before accepting final artifact correspondence. Do not mistake the earlier owner-only DMG for the final deliverable.

## Current visible-card and reference-view repair — supersedes earlier UI acceptance

The user correctly reported no visible answer card despite successful tool execution in the persistent-questions preset. Earlier Host and installed tool qualification did not prove that the answer controls appeared. The old statement that this was only a preset-selection issue is superseded.

Review `.plans/question-card-and-execution-view-2026-11-04/README.md` first for the latest UI checkpoint. `QuestionToolCard` remains read-only history; the active `QuestionComposerCard` now uses the existing `conversation.input.dock` slot above the ordinary composer, sharing `QuestionCard` logic and Host reservation. It must stay visible after a completed tool group collapses and after reload, preserve rejected drafts, disappear for terminal/no-question state and avoid stealing keyboard focus. Check registration disposal, polling/clock lifetime and Session switches. No new core slot or persistence type was needed.

Run `pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/persistent-questions-inline.e2e.ts` against the built full Client. This is the maintained browser regression: actual preset selection, real Host/AgentLoop question, no header click, visible choice controls, reload, exactly one admitted choice with persisted canonical text, then one response turn. The model is scripted. A tool-history-only form failed this test because completed tool groups hide it. Do not substitute isolated React rendering or successful tool output for this browser check.

The latest question feature suite has 425 tests with unchanged 100% coverage thresholds; Team UI has 37 tests. The complete source/Tauri builds, Host/Client compilers, locale ownership, exported JSDoc and named README pairs pass. Inspect current installer and copied-bundle assertions, since the question Client now changes and is no longer byte-identical to the earlier Feishu-qualified Client. No new real-platform run is claimed; question admission and IM transport remain unchanged.

The new Team execution view follows the public reference's Lead-to-workers hierarchy, directional message packets, recorded task progress and bounded handoff feed. Only real TeamView data may drive it; no reference confidence scores, invented timestamps, fabricated token counts or new orchestration authority are allowed. Chromium screenshots use synthetic TeamView data and are rendering evidence only. Verify reduced motion, larger rosters, missing model/task data, refresh timer ownership and absence of motion on historical edges. `TeamAction.tsx` must retain its existing summary lookup return; its intended diff is only four localization props.

The latest source and artifact identity is recorded in orchestration/final-gate.md. The fresh-copy isolated Tauri startup-refresh probe now passes; inspect installed-startup.log at the latest UI checkpoint. Earlier blocked startup attempts remain historical. Review is still pending.

## Question discovery latency repair

The latest latency checkpoint is `.plans/external-integration-2026-11-04/`. The former composer had no immediate invalidation after a question was saved and waited for its shared 15-second poll. Inspect `QuestionComposerCard` using the existing Session running selector to invalidate on the producing turn's running-to-stopped transition. The asking tool already concludes its turn. No new Session event, faster permanent poll, authority change or Host mutation is introduced.

The poll-disabled regression fails before the change (`card-delay-red.log`) and passes afterwards; the card suite has 91 tests and the unchanged feature coverage thresholds pass across 426 tests. The full built-Client/real-Host browser flow passes. No universal end-to-end latency bound is claimed. Inspect the final installer identity and retain older Feishu evidence as checkpoint-specific.

The agent-desktop and superagent source assessment at this checkpoint is research, not an installed default feature. The native desktop preflight uses a digest-verified 1.2.0 release, discovers 67 MCP tools and calls only permission/status functions. Do not mistake this direct MCP preflight for a completed DSH adapter, new-user permission qualification or a default plugin delivery. No external event consumer was activated.
