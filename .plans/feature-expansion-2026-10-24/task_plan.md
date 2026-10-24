# Feature expansion and TUI task plan

Status: design revision v3 awaits review. Implementation has not started. Source inspection baseline: the parent of this design commit (subject: fix(ci): allow Windows installer qualification to finish), 2026-10-24. This directory owns the plans; external artifact copies are navigation pointers only.

## Authoritative documents

- [Expansion plan](dsh_feature_expansion_architecture_plan.md): single-operator Feishu first, authenticated tenant IPC, persistence, then multi-tenant operations and SSH Worker composition.
- [TUI plan](dsh_tui_implementation_plan.md): independent experimental frontend, T0–T5 validation, T6 promotion.
- [Review disposition](review-round2-response.md): six required corrections, warnings, evidence scope and remaining gates.

## Completed design work

- [x] Check the review against the named source baseline; distinguish existing APIs from proposed ones.
- [x] Specify Unix socket authentication and systemd stdio activation; require a real different-UID refusal test.
- [x] Evaluate ACP for IM transport, record its source/reconciliation limitations, and bound the proposed private IM adapter.
- [x] Prioritize subagent-acp plus isolated subprocess-ssh; evaluate restricted command:ssh before any new provider package.
- [x] Define client/server SSH detection and separate remote process cleanup evidence.
- [x] Name IM source persistence, storage-domain/storage-sqlite, migration acknowledgements and both SDK outputs.
- [x] Fix TUI promotion ordering, signal ownership, approval argument lookup, shared tool views and automated terminal tests.
- [x] Place canonical plans and this task record in the repository; retain previous artifacts as historical backups.

## Next execution gates — not yet run

- [ ] Review v3, including the private IM wire choice and launcher-owned SIGHUP change; resolve Required findings before locking.
- [ ] T0: compile against current Agent/interaction APIs; real profile + keyless mock + PTY/emulator PoC; fatal/signal restoration with launcher regressions.
- [ ] Phase 0 IM: verify official SDK ACK semantics and interface mapping without credentials or real messages; source persistence and delivery reconciliation PoC.
- [ ] Phase 0 Linux: fixed UID systemd socket activation, unauthorized UID refusal, malformed permissions, handshake and single-instance teardown. macOS cannot supply this result.
- [ ] Phase 0 SSH feasibility: isolated provider resolution, local versus remote cwd/env, A/B limitations. Complete real two-host failure/cleanup tests before Phase 5 delivery; this does not block independent IM work.
- [ ] T1–T4: experimental composition, input/rendering, sessions and interactions; focused tests and documentation with each implementation.
- [ ] T5: full experimental profile acceptance from built artifacts, cross-process writer lock, node-pty and @xterm/headless evidence.
- [ ] T6: review stable ownership/limitations/payload, promote atomically, add built-in profile and CLI dependency, then verify installed stable artifact.
- [ ] Expansion Phases 1–2: isolated single runtime and Feishu text MVP; real platform testing requires a specifically authorized test app/identity and bounded budget.
- [ ] Expansion Phases 3–5: two-tenant isolation, cards, actual second channel, remote Workers; separate evidence per deployment target.

## Execution boundaries

This revision changes planning files only. It does not install packages, add product code, create OS accounts/units, connect to remote Workers, use credentials, send platform messages, rebuild desktop packages or alter desktop defaults. Unrelated dirty work is preserved. Approval of the plan is not evidence that a runtime gate passed.
