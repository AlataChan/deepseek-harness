# Feishu Transport Lifecycle & Test Evidence Repair Report

## Executive Summary
This report documents the completion of the Feishu transport lifecycle repair under `packages/experimental/im-feishu/src/feishu-transport.ts`, `src/feishu-normalizer.ts`, `tests/feishu-transport.spec.ts`, and paired bilingual documentation. All 60 unit and negative lifecycle tests pass deterministically (55 in `feishu-transport.spec.ts` and 5 in `feishu-lifecycle-negative.spec.ts`), oxlint reports 0 warnings and 0 errors across all owned files, and both production and check project TypeScript builds compile with exit code 0. Full expansion qualification remains owned by the root coordinator.

## Key Changes Implemented

1. **Deferred Startup Registration & Asynchronous Lifecycle Ownership**:
   - `start()` places the deferred startup operation (`Promise.resolve().then(() => this.doStart(generation))`) directly into `rawStartupPromises` before any startup microtasks run.
   - Startup sequence bounds dynamic SDK import, event registration, client initialization, `wsClient.start()`, and `'connected'` state polling under `startupTimeoutMs` (10,000ms default).
   - Readiness polling interval is explicitly configurable via `connectionStatusPollIntervalMs` (1ms–5,000ms, default 10ms).
   - If `transport.close()` is invoked immediately after `start()` (prior to microtask execution), `isClosed` is already set; `doStart` immediately throws expected cancellation (`'Cannot start closed FeishuTransport'`), preventing orphaned SDK connections.
   - If `transport.close()` is invoked while polling readiness after `wsClient.start()` resolves, `waitForConnectionConnected` immediately aborts the poll interval and rejects with expected cancellation (`'FeishuTransport was closed while waiting for connection'`), enabling clean drain without timeout delay.

2. **Index-Aware Selective Cancellation & Truthful Error Propagation**:
   - Blanket `/closed|aborted/i` regex suppression is completely eliminated.
   - Teardown drain partitions results into startup operations (`index < startupOpCount`) and in-flight operations (`index >= startupOpCount`).
   - Startup operations only ignore exact internal expected cancellation messages:
     - `'Cannot start closed FeishuTransport'`
     - `'FeishuTransport was closed while waiting for connection'`
     - `'FeishuTransport was closed during startup'`
     - `'Cannot start closed FeishuTransport: instance is terminal'`
   - In-flight callback, persistence, and outbound operations never suppress errors: any callback error (e.g. `'database closed'`, network errors) propagates truthfully to the caller and causes `close()` to reject.

3. **Client Ownership Preservation, Persistent Failure & Force-Close Error Merging**:
   - Every instantiated SDK client is immediately tracked in `ownedClients`.
   - On startup failure or timeout, `isTerminal` is set to `true`, permanently barring retry on the failed instance.
   - If client force-close throws during startup teardown or active closure, the error is retained in `startupCloseError` or captured during teardown.
   - Drainage under `shutdownTimeoutMs` completes fully before clearing resources, and any captured force-close or in-flight error is merged into the final rejection.

4. **Regex Token Sanitization**:
   - Retained complete case-insensitive redaction for Bearer tokens (`/Bearer\s+[a-z0-9_.-]+/gi`) across uppercase, lowercase, and mixed-case variants without duplicate-range linter issues, aligning with the DingTalk normalizer pattern.

5. **Card 2.0 Identity & Structured Approvals**:
   - Direct `operator.open_id` in Card 2.0 is supported directly, while preserving `operator.operator_id.open_id` fallback.
   - Strictly enforces complete approval identity (`appId`, `tenantKey`, `chatId`, `operatorId`, `openMessageId`) and action tag/name before any grant.
   - Preserves `action.name` and `action.form_value` from both nested wire and SDK flattened formats.
   - Deterministic stale, duplicate, or malformed card clicks return a negative static warning toast (`{ toast: { type: 'warning' } }`) rather than triggering SDK 500 retry storms; persistence/transport errors remain thrown.

6. **Bilingual Documentation Pairing**:
   - Updated `packages/experimental/im-feishu/README.md` and `README.zh.md` with exact line parity and identical code blocks.
   - Documented explicit `./runtime` and `./ingress` entry points, default Phase 2 fail-closed behaviors, opt-in card interactions, terminal SDK failure semantics, and configurable readiness polling intervals.
   - Validated against repository bilingual rules via `scripts/verify-translation-pairing.ts`.

## Test & Gate Verification

1. **Vitest Unit & Integration Suites**:
   ```sh
   ./node_modules/.bin/vitest run packages/experimental/im-feishu/tests/feishu-transport.spec.ts packages/experimental/im-feishu/tests/feishu-lifecycle-negative.spec.ts
   ```
   - **Result**: 60 passed (0 failed, 0 unhandled rejections) in 1.02s.
   - **Suites**:
     - `feishu-transport.spec.ts`: 55 passed (including immediate close after start, close during readiness polling, configurable poll intervals, terminal instance blocking retries, late force-close retention, throwing close, database closed callback propagation, and SDK dispatcher integration).
     - `feishu-lifecycle-negative.spec.ts`: 5 passed (testing late start resolution after timeout, persistent client tracking, throwing close rejections, late start error swallowing, and asynchronous SDK loading ownership).

2. **Repository Linter**:
   ```sh
   ./node_modules/.bin/tsx scripts/run-oxlint.ts packages/experimental/im-feishu/src/feishu-transport.ts packages/experimental/im-feishu/src/feishu-normalizer.ts packages/experimental/im-feishu/tests/feishu-transport.spec.ts
   ```
   - **Result**: Found 0 warnings and 0 errors across 3 files with 90 rules.

3. **TypeScript Typecheck**:
   ```sh
   ./node_modules/.bin/tsc --project packages/experimental/im-feishu/tsconfig.json --noEmit --pretty false
   ./node_modules/.bin/tsc --project packages/experimental/im-feishu/tsconfig.check.json --noEmit --pretty false
   ```
   - **Result**: Both exit code 0, 0 diagnostics across production and check projects.

4. **Bilingual Documentation Validation**:
   ```sh
   ./node_modules/.bin/tsx scripts/verify-translation-pairing.ts packages/experimental/im-feishu/README.md
   ```
   - **Result**: 1 named pair consistent, 0 errors.
