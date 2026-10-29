# Feature expansion and TUI task plan

Status (2026-10-29): both plans have local implementation and independent review acceptance. Expansion includes disposable Linux qualification; TUI acceptance is limited to local macOS. Linux native TUI PTY, Windows ConPTY, external IM/physical-host and production release gates remain unverified. The [combined status](completion-status.md), [expansion record](expansion-completion.md) and [TUI acceptance](codex-tui-acceptance.md) define the current scope. Source inspection baseline: the parent of the initial design commit (subject: fix(ci): allow Windows installer qualification to finish), 2026-10-24. This directory owns the plans; external artifact copies are navigation pointers only.

## Authoritative documents

- [Expansion plan](dsh_feature_expansion_architecture_plan.md): single-operator Feishu first, authenticated tenant IPC, persistence, then multi-tenant operations and SSH Worker composition.
- [TUI plan](dsh_tui_implementation_plan.md): independent experimental frontend, T0–T5 validation, T6 promotion.
- [Round-2 disposition](review-round2-response.md): historical corrections.
- [Round-3 disposition](review-round3-response.md): current source decision and four fixes.

## Completed design work

- [x] Check the review against the named source baseline; distinguish existing APIs from proposed ones.
- [x] Specify Unix socket authentication and systemd stdio activation; require a real different-UID refusal test.
- [x] Evaluate ACP for IM transport, record its source/reconciliation limitations, and bound the proposed private IM adapter.
- [x] Prioritize subagent-acp plus isolated subprocess-ssh; evaluate restricted command:ssh before any new provider package.
- [x] Define client/server SSH detection and separate remote process cleanup evidence.
- [x] Specify human-source decision gate, storage-domain/storage-sqlite, actual type-change acknowledgements and both SDK outputs.
- [x] Fix TUI promotion ordering, signal ownership, approval argument lookup, shared tool views and automated terminal tests.
- [x] Place canonical plans and this task record in the repository; retain previous artifacts as historical backups.

## Execution gates

- [x] Apply round-3 fixes: human source decision, PTC argument lookup, terminal-scoped HUP/nohup, Accept=yes limitation and tmpfiles.d.
- [x] agy produced Phase 0 code and fixtures in this worktree; Codex independently reviewed the repaired snapshot.
- [x] Local Phase 0 helper/source review: all seven findings closed with 27 tests, Host/Client compilation, lint and report checks; see [Codex review](codex-code-review.md). Remaining deployment gates still control Phase 1 acceptance.
- [x] T0: compile against current Agent/interaction APIs; real profile + keyless mock + PTY/emulator PoC; fatal/signal restoration with launcher regressions.
- [x] Local Phase 0 IM: verify official SDK ACK semantics/interface mapping and delivery reconciliation PoC without real messages. Source-choice fixtures, the specified namespace owner checks and keyless Agent persistence/resume evidence have passed local review.
- [x] Disposable Linux qualification: fixed UID systemd socket activation, unauthorized UID refusal, malformed permissions, handshake and single-instance teardown. The actual installed runtime passed on a disposable Docker Linux target; production-host acceptance remains separate.
- [x] Local SSH feasibility: isolated provider resolution, local versus remote cwd/env, A/B limitations. The disposable installed qualifier passes nine mandatory failure/cleanup controls and the Loader suite passes four cases. Physical two-host validation remains a separate unrun target gate.
- [x] T1–T4: experimental composition, input/rendering, sessions and interactions; focused tests and documentation with each implementation.
- [x] T5 local macOS qualification: installed staging profile, cross-process writer lock, node-pty and @xterm/headless evidence. Staging equivalence was verified after promotion; the original T5-before-T6 sequencing was not followed.
- [x] T6 local macOS qualification: stable package paths, built-in profile and CLI dependency are implemented; independent installed-artifact review passes. Cross-platform support is not accepted. Final local qualification on macOS completes T5 installed-staging equivalence, authoritative turn persistence synchronization with delayed-streaming controls, product isolation gate clean pass, quiescent child join, and baseline gate recording; see tui-implementation-report.md.
- [x] Local Expansion Phases 1–2: isolated single runtime and Feishu text MVP; real platform testing requires a specifically authorized test app/identity and bounded budget.
- [x] Local Expansion Phases 3–5: actual two-tenant Linux isolation, native/PTC interactions, DingTalk SDK integration and installed SSH ACP controls pass their named disposable/synthetic-I/O gates. Real app/operator, production host and physical two-host acceptance remain not run.

## Overall completion ownership

The user explicitly requires agy and Codex to finish the full expansion rather than stop after one phase. agy implements the delegated IPC/profile, platform and SSH scopes; Codex reviews those changes and repairs the separately owned runtime, ingress, storage and writer-lease services. Each milestone immediately leads to remaining implementation or corrections. A passing milestone does not complete the expansion. TUI remains a separate workstream.

The initial broad tasks produced partial source and were followed by bounded repair dispatches. The platform follow-up `task_d7e91b560965` / `ctx_1d3d926f1036` and profile-assets follow-up `task_17c26632f414` / `ctx_9a036703d751` settled and were released through Orca before their completion deliveries were acknowledged. Codex owns the IM source, assets and independent qualification now. SSH follow-up `task_03660008d278` / `ctx_8820d998a99b` settled successfully after nine mandatory installed/disconnect/lease controls and final source/document review. Its terminal was released before completion acknowledgement. Root owns its disposable qualification harness. No new worktree was created.


## Execution boundaries

The implementation authorization covers expansion and TUI code and focused local tests through supervised agy dispatches. It does not authorize creating a new worktree, changing accounts/units on the operator or existing production hosts, connecting undesignated remote Workers, using real credentials, sending real messages, rebuilding desktop packages or altering desktop defaults. Qualification harnesses may create ephemeral test identities and units inside a disposable CI runner after code review; this does not authorize changes on an existing target. Unrelated dirty work is preserved. Approval of the plan is not evidence that a runtime gate passed.

Codex repaired the source-CLI live-admission race, bounded IPC shutdown, transport startup ownership, durable interaction failure handling, artifact dependency resolution and installed composition. Current independently reproduced evidence includes 256 IM/DingTalk source tests, 60 Feishu lifetime controls, three installed-profile controls, four declarative-bundle tests and four hermetic recorded-session/corpus checks. These counts describe separate selections and must not be summed as unique cases. Scoped IM compilation passes. The [completion record](expansion-completion.md) owns the current gate matrix and remaining limitations.

Final SSH qualification selects the strict forced-command Path B for the plan's no-arbitrary-TCP-forwarding requirement. The combined disposable gate passes nine Path A functional cases plus five strict Path B groups; the updated-image IM matrix passes ten groups. AGY completed review-only follow-up task_55feb49d9695 / ctx_92e6e4ed3463 with no required findings; valid settlement was processed and the worker released before acknowledgement. No permission or safety requirement is relaxed.

## Local merge checks

- [x] Repository documentation integration and local merge repairs: named IM type owners, generated references, publication closure and bilingual synchronization pass; full doc-sync 42/42 and hygiene 16/16. See [local merge repairs](local-merge-repairs.md).

## Remaining platform and external gates

- [ ] Linux native TUI PTY qualification.
- [ ] Windows native ConPTY qualification.
- [ ] Cross-platform CI runs and independent artifact/log review.
- [ ] Authorized real IM applications, production Linux and physical two-host SSH acceptance.
- [ ] Production release and packaging.

These are unrun gates, not failed tests. See the [combined completion summary](completion-status.md).

Linux and Windows native qualification are explicitly deferred by the user for this local repair pass. External-account and production acceptance remain separate.
