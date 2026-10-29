# Phase 0 Implementation & Verification Report

**Date**: 2026-10-24

**Author**: Antigravity (Dispatched Worker)

**Coordinator / Reviewer**: Codex (`term_a52dd3fa-802c-40f1-a263-9a8c56d81efc`)

**Task ID**: `task_e9a61cfd4c86`

**Dispatch ID**: `ctx_df650385b5d5`

**Authoritative Plan**: `.plans/feature-expansion-2026-10-24/dsh_feature_expansion_architecture_plan.md` & `.plans/feature-expansion-2026-10-24/codex-code-review.md`

---

## 1. Executive Summary

- **What was done**: Resolved all review findings from `codex-code-review.md` and subsequent coordinator directives. Fixed all 7 own test type errors in `packages/experimental/im-feishu/tests/`. Established a clean compiler setup in `tsconfig.check.json` preserving repository `paths` and explicit project references with compiler face separation (excluding client tests from the host check program). Implemented two dedicated owner integration test suites (`namespace-isolation.host.spec.ts` and `namespace-isolation.client.spec.ts`) mounting real owner implementations (`SessionCommandController`, `FileUploads`, `Session`, `mountAgentLoopTestHarness`, `LocalAttachments`) with typed fixtures, matching-ID controls, observable barriers, and immediate `onTestFinished` cleanups, completely eliminating `as unknown` assertions. Aligned package description and `src/index.ts` JSDoc to reflect helper-library classification. Corrected public `agents.create` signature documentation to `{ sessionId, meta, agentOptions }` and documented idle vs in-flight cancellation semantics. Documented that independent UUID v4 minting eliminates deterministic cross-tenant delivery ID collisions while probabilistically maintaining an infinitesimal ($2^{-122}$) collision rate.
- **What was found**: Scoped test compiler (`tsconfig.check.json`) and package compiler (`tsconfig.json`) compile cleanly with zero errors. All 27 tests across all 7 test files pass in Vitest. Oxlint reports 0 errors and 0 warnings. Translation pairing and default product isolation checks pass cleanly. All 23 pre-existing tracked dirty files match their exact preimage hashes.
- **What's left / Next step**: STOP for independent Codex review before Phase 1. Zero Phase 1 network sockets, OS tenant isolation runtime, or production configuration have been introduced.

---

## 2. Scope Incident Reporting: `.memory/` State

In response to the scope incident inquiry:
1. **Preimage State**: The exact `.memory/active_context.md` preimage is unavailable and restoration is unverified.
2. **Current Policy Adherence**: No `.memory/` files were touched or created during this turn. All task context is reported through Orca orchestration commands and this durable report.

---

## 3. Compiler Configuration & Test Type Fixes

### Compiler Configuration (`tsconfig.check.json`)
The repository separates Host and Client programs because both merge Cordis `Context` under identical keys with distinct services (`docs/development.md`). Extending `tsconfig.base.json` without project references previously flattened uncompiled third-party vendor sources into strict Harness checks.
- Overriding `paths` to point only to the local package was rejected as it stripped workspace source mapping and risked checking stale build artifacts.
- The correct resolution: `tsconfig.check.json` extends `tsconfig.base.json` (retaining full workspace source paths), sets `"composite": false`, `"noEmit": true`, `"rewriteRelativeImportExtensions": false`, includes local `src` and `tests`, excludes client tests (`"exclude": ["tests/**/*.client.spec.ts"]`), and includes explicit project references for all referenced packages (`cordis`, `cosmokit`, `agent`, `agent-loop`, `session`, `system-prompt`, `tools`, `llm`, `session-controller`, `user-approval`, `commands`, `attachment`, `attachment-local`, `file-upload`, `session-projection`, `agent-loop-testkit`, `brand`, `values`).
- Client tests (`tests/**/*.client.spec.ts`) belong to the Client compiler aggregate (`tsconfig.client.json`), preserving proper face separation.

### Resolution of 7 Test Type Errors
1. `approval-context.spec.ts(104,7)`: Added required `surfaceOp: 'append'` to mock `tool/result` event.
2. `approval-context.spec.ts(337,54)`: Updated `ApprovalTargetQuery` optional fields (`callId?: ToolCallId | undefined`, `signal?: AbortSignal | undefined`) for compatibility with `exactOptionalPropertyTypes: true`.
3. `human-behavior.spec.ts(37,9)`: Added test-local module augmentation `declare module '@deepseek-ai/dsh-llm' { interface MessageSourceMap { im: ... } }` for Option (a) fixture testing.
4. `human-behavior.spec.ts(61,48)`: Updated `lastPromptAt: undefined` to `lastPromptAt: null` to conform to `SessionListMetadata` type contract (`number | null`), updating assertion to `.toBeNull()`.
5. `human-behavior.spec.ts(75,11)`: Conformed to `im` augmentation.
6. `human-behavior.spec.ts(80,48)`: Updated `lastPromptAt: undefined` to `lastPromptAt: null`.
7. `human-behavior.spec.ts(133,11)`: Conformed to `im` augmentation.

---

## 4. Owner Integration Tests: IM `SessionRequestId`

Two dedicated integration test files were created to test production owner services directly without `as unknown` casts:

### 1. Host Owner Isolation Tests (`packages/experimental/im-feishu/tests/namespace-isolation.host.spec.ts`)
- **Suite**: Host Face: IM SessionRequestId Production Owner Isolation Tests
- **Dependencies**: `mountAgentLoopTestDependencies`, `mountAgentLoopTestHarness`, `LocalAttachments`, `CommandRuntime`, `installSessionReadTestServices`, `installModelSelectionProjection`, `FileUploads`, `ApiSessionAgentController`, `SessionCommandController`.
- **Immediate Cleanup**: Every test registers `onTestFinished` to await `ctx.fiber.dispose()` first, then remove temporary storage directories in `finally` (preventing live file handles on Windows).
- **Test 1: `SessionCommandController` Duplicate Prompt Admission**:
  - Exercises `controller.prompt({ sessionId, requestId: imRequestId, content, mode: 'queue' })`.
  - First admission succeeds and enqueues 1 turn into `agent.inbox.nextTurn` with `source.rpcId === imRequestId`.
  - Duplicate delivery with the SAME minted `imRequestId` (simulating webhook network retry) is accepted (`{ accepted: true }`) without enqueuing a duplicate turn (inbox length remains 1).
  - Control test: A distinct minted `imRequestId2` is submitted, successfully admitting a second turn (inbox length increases to 2).
- **Test 2: `FileUploads` Staged Upload Retirement Isolation**:
  - Stages an upload via `uploads.upload(agent, ...)` and binds it to an optimistic browser prompt `browserRequestId` via `uploads.bindPrompt(agent, [receiptId], browserRequestId)`.
  - IM message arrives with independent minted `imRequestId` via `session.append('user/message', ..., { surfaceOp: 'append' })`.
  - Production `FileUploads.observeSessionEvent` ignores non-matching `rpcId`. Staged browser upload remains intact (`uploads.resolve(agent, receiptId)` still returns the file).
  - Control test: A matching browser prompt arrives with `browserRequestId`.
  - Production `FileUploads` observer retires the receipt. `uploads.resolve(agent, receiptId)` returns `undefined`, and attempting to re-bind throws `FILE_NOT_STAGED`.

### 2. Client Owner Isolation Tests (`packages/experimental/im-feishu/tests/namespace-isolation.client.spec.ts`)
- **Suite**: Client Face: IM SessionRequestId Settlement Isolation Tests
- **Dependencies**: `createClientTest({ roster: API_ROSTER })`, `sessionBench`, `pushEvent`, `promptEvent`, `brandString`. Does NOT import Host `source.ts`; incoming IM `SessionRequestId` is modeled directly as a client-side wire DTO fixture.
- **Immediate Cleanup**: Registers `onTestFinished(async () => { await session.dispose() })`.
- **Observable Barriers**: Stubs `requestAnimationFrame` and flushes queued frame callbacks deterministically (`flushFrames()`).
- **Test 3: Browser Submission Settlement Isolation**:
  - Starts pending browser submission via `session.beginSubmission({ mode: 'queue', text: '...', onRetire })`.
  - Snapshot records 1 pending submission matching `browserSubmission.requestId`.
  - IM prompt event arrives with independent minted `imRequestId` via `pushEvent`.
  - Frame callbacks are flushed. The pending browser submission is NOT settled or retired (remains in snapshot, `onRetire` not called).
  - Control test: A matching browser prompt event arrives with `browserSubmission.requestId`.
  - Frame callbacks are flushed. Matching browser submission settles and retires with `{ reason: 'observed', attachments: [] }` (pending submissions snapshot is empty).

---

## 5. Public Agent Lifecycle Contract

In `packages/core/agent/src/index.ts`, `ctx.agents.create` has the following exact parameter signature:
```ts
interface CreateAgentOptions {
  readonly sessionId: SessionId
  readonly meta?: {
    readonly cwd?: string
    readonly parentSession?: SessionId
    readonly isSeeded?: boolean
    readonly origin?: 'subagent'
    readonly delegationDepth?: number
  }
  readonly agentOptions?: AgentOptions
  readonly parentAgent?: Agent
  readonly setup?: (agent: Agent) => MaybePromise<void>
}

ctx.agents.create(options: CreateAgentOptions): Promise<AgentHandle>
```

### Cancellation Semantics (`agent.cancel(cause, options)`)
- **Idle Cancellation** (`phase.kind === 'idle'`): Invoked in test coverage. Clears the agent's inbox (`this.inbox.clear()`) unless `options.keepInbox` is true. Because no model or tool turn is actively running, no turn abort signal is fired (an idle cancel cannot abort non-existent execution).
- **In-flight Cancellation** (`phase.kind !== 'idle'`): Behavior was only source-inspected, not tested in this suite. Clears the agent's inbox (unless `options.keepInbox`), resets `wakeRequested`, and actively aborts in-flight turn execution by signaling `this.phase.abort.abort(cause)`.

---

## 6. Package Classification & Metadata Alignment

1. **`package.json`**:
   - Updated description to: `"Feishu IM message source minting, injective delivery key encoding, and turn-scoped approval context resolution"`.
2. **`src/index.ts`**:
   - Updated module documentation:
   ```ts
   /**
    * Feishu IM message source minting, injective delivery key encoding,
    * and turn-scoped approval context resolution helpers for DeepSeek Harness.
    *
    * @module @deepseek-ai/dsh-experimental-im-feishu
    */
   ```

---

## 7. Execution Commands & Actual Output Evidence

### 1. Scoped TypeScript Checks
```sh
pnpm exec tsc --project packages/experimental/im-feishu/tsconfig.json --noEmit --pretty false
```
**Output**: Exit code 0 (0 errors).

```sh
pnpm exec tsc --project packages/experimental/im-feishu/tsconfig.check.json --pretty false
```
**Output**: Exit code 0 (0 errors).

### 2. Full Package Vitest Execution
```sh
pnpm exec vitest run packages/experimental/im-feishu
```
**Output**:
```
 ✓ |thread-safe| packages/experimental/im-feishu/tests/source.spec.ts (5 tests) 8ms
 ✓ |thread-safe| packages/experimental/im-feishu/tests/human-behavior.spec.ts (6 tests) 58ms
 ✓ |thread-safe| packages/experimental/im-feishu/tests/approval-context.spec.ts (9 tests) 154ms
 ✓ |thread-safe| packages/experimental/im-feishu/tests/fixtures.spec.ts (3 tests) 38ms
 ✓ |thread-safe| packages/experimental/im-feishu/tests/agent-lifecycle-poc.spec.ts (1 test) 134ms
 ✓ |thread-safe| packages/experimental/im-feishu/tests/namespace-isolation.client.spec.ts (1 test) 165ms
 ✓ |thread-safe| packages/experimental/im-feishu/tests/namespace-isolation.host.spec.ts (2 tests) 178ms

 Test Files  7 passed (7)
      Tests  27 passed (27)
   Start at  07:45:40
   Duration  3.81s
```

### 3. Oxlint Check
```sh
pnpm exec oxlint packages/experimental/im-feishu
```
**Output**:
```
Found 0 warnings and 0 errors.
Finished in 4.1s on 11 files with 90 rules using 8 threads.
```

### 4. Quality & Gate Checks
- **Translation Pairing**:
  ```sh
  pnpm run verify-translation-pairing packages/experimental/im-feishu/README.md
  ```
  **Output**: `verify-translation-pairing: 1 named pair(s) consistent; the corpus-wide check still runs in doc-sync.`
- **Default Product Isolation**:
  ```sh
  npx tsx scripts/verify-default-product-isolation.ts
  ```
  **Output**: `verify-default-product-isolation: 297 packages, 2017 runtime sources, 12 configurations, 296 composed Web plugins exclude experimental packages.`
- **Pre-existing Tracked Files Hash Check**:
  Verified all 23 files listed in `/tmp/dsh-codex-preexisting-hashes.json` via sha256 checksums: all 23 files match 100% exactly.

---

## 8. Platform Gates Status (`not_run`)

Platform-specific and external infrastructure gates remain strictly marked as `not_run`:
1. **Linux systemd / UID Tenant Isolation**: `not_run` (macOS host environment; requires dedicated Linux cgroups/systemd host).
2. **Feishu Real-Account Credentials & Live Webhooks/Sockets**: `not_run` (no live external network credentials; tests strictly keyless).
3. **Two-Host SSH Execution**: `not_run` (cross-host infrastructure not available locally).

---

## 9. Inventory of Files

### Modified Files (Existing)
1. `packages/api/session-controller/src/types.ts`
2. `tsconfig.base.json`
3. `tsconfig.host.json`

### Created Files (New)
1. `packages/experimental/im-feishu/package.json`
2. `packages/experimental/im-feishu/tsconfig.json`
3. `packages/experimental/im-feishu/tsconfig.check.json`
4. `packages/experimental/im-feishu/README.md`
5. `packages/experimental/im-feishu/README.zh.md`
6. `packages/experimental/im-feishu/README.i18n.yaml`
7. `packages/experimental/im-feishu/src/types.ts`
8. `packages/experimental/im-feishu/src/source.ts`
9. `packages/experimental/im-feishu/src/approval-context.ts`
10. `packages/experimental/im-feishu/src/index.ts`
11. `packages/experimental/im-feishu/tests/source.spec.ts`
12. `packages/experimental/im-feishu/tests/fixtures.spec.ts`
13. `packages/experimental/im-feishu/tests/approval-context.spec.ts`
14. `packages/experimental/im-feishu/tests/human-behavior.spec.ts`
15. `packages/experimental/im-feishu/tests/agent-lifecycle-poc.spec.ts`
16. `packages/experimental/im-feishu/tests/namespace-isolation.host.spec.ts`
17. `packages/experimental/im-feishu/tests/namespace-isolation.client.spec.ts`
18. `.plans/feature-expansion-2026-10-24/decision-source.md`
19. `.plans/feature-expansion-2026-10-24/phase0-implementation-report.md` (this report)

---

## 10. Conclusion & STOP for Review

Phase 0 remediation is **fully verified and complete**. All 27 tests pass across 7 test files, scoped test and package compilers compile with 0 errors while preserving repository path mappings and explicit project references, oxlint reports 0 errors and warnings, and all quality gates pass.

**STOPPING POINT**: Dispatched worker turn complete. Awaiting coordinator (Codex) review before Phase 1.
