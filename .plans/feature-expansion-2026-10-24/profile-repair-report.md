# Profile Repair Report: Production IM Composition

## Executive Summary
This report summarizes the repair and hardening of the production IM composition in `packages/experimental/im-feishu/`, specifically focusing on `src/session-provider.ts` and the four owner test suites (`tests/session-provider.spec.ts`, `tests/runtime-plugin.spec.ts`, `tests/ingress-plugin.spec.ts`, and `tests/profile-composition.spec.ts`). Ownership of `src/ingress-plugin.ts` and `src/runtime-plugin.ts` was coordinated with and handed off to the coordinator for interaction composition completion. All 17 unit and integration tests pass, and source-plane typechecking compiles cleanly with zero errors.

## Key Changes & Verifications

### 1. Session Provider (`packages/experimental/im-feishu/src/session-provider.ts`)
- **Canonical Private Working Directory**:
  - Validates `cwd` via `realpathSync` and `lstatSync`, requiring an existing directory owned by the current process UID with private `0700` permissions (`(mode & 0o077) === 0`). Rejects relative, missing, symlinked, and world/group-accessible paths.
- **Durable Mapping Before Agent Publication**:
  - Writes `conversationKey` -> `SessionId` mapping to the durable `conversations` KV table *before* publishing or registering the agent.
- **Fail-Loud Mapping & Operator Validation**:
  - Validates `operatorId` on both active in-memory lookups and restored durable lookups.
  - Fails loud if an active handle has a missing or mismatched durable mapping record or session ID.
- **Crash Recovery & Reconciliation**:
  - Consults `ctx.sessionPersistence.stat(sessionId)` to choose `ctx.agents.resume` when a session exists in persistence, or `ctx.agents.create` with the pre-mapped `sessionId` when unmaterialized. This transparently recovers from crashes occurring between mapping persistence and initial creation without catching arbitrary errors.
- **Bounded Async Session Log Snapshot**:
  - Implements `readSessionLog(id): Promise<SessionLogSnapshot | undefined>` satisfying the `AgentSessionProvider` contract.
  - Verifies durable conversation ownership, checks `stat(sessionId)`, opens the log in `'read'` mode, and bounds event reads to `maxReconciliationEvents + 1`. Fails loud if events exceed the limit, and guarantees `handle.close()` in `finally`.
  - Requires resolved `maxReconciliationEvents: number` at construction.
- **Durability Barrier & Teardown Quiescence**:
  - `flushSessions()` verifies that `ctx.sessions.flush(agent.session)` returns `true` before confirming durability.
  - `dispose()` cancels all active agent handles first (`handle.agent.cancel({ kind: 'user' })`), clears `this.handles`, and awaits all handle disposals using `Promise.allSettled`. Aggregates and propagates any disposal rejections without early false quiescence.

### 2. Owner Test Suites Adaptation
- **`tests/session-provider.spec.ts`**:
  - 7 unit tests verifying canonical cwd validation, crash recovery via `stat`, cold resume with stable session IDs, flush durability enforcement, durable mapping consistency, and `allSettled` disposal error aggregation.
- **`tests/runtime-plugin.spec.ts`**:
  - 3 integration tests verifying single-writer lease lifecycle, delivery persistence, Phase 2 unapproved tool fail-closed behavior, and config-level transport validation.
- **`tests/ingress-plugin.spec.ts`**:
  - Unit test verifying writer lease acquisition, canonical JSON tuple binding keys via `encodeOperatorBindingKey`, typed IPC client factory injection, and authorization.
- **`tests/profile-composition.spec.ts`**:
  - 6 end-to-end integration tests verifying end-to-end prompt execution and outbox reply delivery, duplicate retry idempotency, multi-turn session resumption across restarts, in-flight turn cancellation, second-writer refusal on active tenant state directories, and clean kernel lease release on disposal.

### 3. Handoff Coordination
- Handed off `src/ingress-plugin.ts` and `src/runtime-plugin.ts` to coordinator via `orca orchestration send` (`msg_db91dbc4868c` and `msg_724aa3f2d1ec`).
- Retained and completed `src/session-provider.ts`, all four owner test suites, and this report.

## Verification
- **Typecheck**:
  ```sh
  ./node_modules/.bin/tsc --project packages/experimental/im-feishu/tsconfig.check.json --noEmit --pretty false
  # Exit code: 0 (zero errors)
  ```
- **Owner Test Suites**:
  ```sh
  ./node_modules/.bin/vitest run packages/experimental/im-feishu/tests/{session-provider.spec.ts,runtime-plugin.spec.ts,ingress-plugin.spec.ts,profile-composition.spec.ts}
  # Test Files  4 passed (4)
  # Tests       17 passed (17)
  ```
