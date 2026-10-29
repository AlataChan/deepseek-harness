# TUI local macOS acceptance

Verdict: accepted for the reviewed local macOS scope on 2026-10-28. No required finding from the TUI review remains open for this scope. This record supersedes the earlier failed review verdicts after their repairs; it does not change those historical observations.

Codex independently reviewed the implementation and reran these checks during remediation:

- Full TUI suite: 87 tests in 13 files passed before the final two-file snapshot/profile repair. Following the staging and real-runtime changes, the affected installed/composition suites independently passed 11 tests in two files; these selections overlap and are not additive.
- Source and test TypeScript check: `pnpm exec tsc -p packages/tui/tui/tsconfig.check.json --pretty false` passed.
- Scoped source/test/launcher-controller/bundle/snapshot oxlint passed. After the last repair, lint on the changed snapshot and profile files passed again.
- Final snapshot and corpus: `pnpm exec vitest run --config vitest.snapshot.config.ts snapshots/tui/tui.snapshot.ts scripts/session-snapshot-corpus.corpus.ts` passed all six tests. This includes persisted Session parity, the delayed-stream premature-shutdown control, and child cleanup control.
- Final product isolation: `pnpm exec tsx scripts/verify-default-product-isolation.ts` passed. Never-released TUI compatibility aliases were removed; their earlier failure was introduced by this implementation, not an unrelated baseline.
- Scoped `git diff --check` passed.
- Repository plan/link/preservation checker passed: 14 existing documents, 107 links and all 23 protected preexisting tracked modifications hash-identical.

The real installed qualification uses a private closure outside checkout and a keyless model server. It covers actual native and Node PTC writes with approval rejection and positive allow controls, durable PTC dispatch-before-approval evidence, multiple turns, resume, model selection and an explicit custom staging profile. Source-plane Session replay is a separate check. The staging scenario establishes post-promotion equivalence; it does not claim experimental acceptance historically preceded package promotion.

The final snapshot now waits for persisted assistant/message and turn/end before /quit. The previous output-count/old-idle race was independently reproduced and repaired. Normal owner-free HUP retains its prior behavior; explicit DSH_DETACHED=1 provides detached handling, while terminal ownership takes precedence and restores the terminal on HUP. Transparent plain nohup survival is not newly promised.

Acceptance is limited to the exercised local macOS Node/PTY environment. Linux PTY, Windows ConPTY, live-provider operation, CI matrix and production release are unverified. The subsequent [local merge repair](local-merge-repairs.md) closes the repository documentation and hygiene blockers with independently recorded passing checks; native Linux and Windows qualification remains deferred. No commit, merge, push, CI dispatch or desktop package was produced by this acceptance.

AGY's implementation and targeted repair dispatches are settled. Orca reports no worker terminal requiring a cleanup decision; external AGY terminals are retained by Orca without a process action. All work stayed in the existing worktree.

The [combined completion status](completion-status.md) owns the two-plan overview and remaining Linux/Windows and external acceptance work. No platform CI was dispatched by the documentation update.
