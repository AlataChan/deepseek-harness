# Cordis Catalog & Merge Blocker Repair Report

## 1. Executive Summary

This report documents the resolution of merge blockers for task `task_a6280d48fb18` (dispatch `ctx_1992a256bb62`). All 12 unclassified IM types (`IncomingImMessage`, `IngressAcceptResult`, `OperatorBindingRecord`, `SubmitDeliveryRequest`, `SubmitDeliveryResponse`, `TenantReceiptRecord`, `GetDeliveryRequest`, `GetDeliveryResponse`, `CancelDeliveryRequest`, `CancelDeliveryResponse`, `GetApprovalContextRequest`, `GetApprovalContextResponse`) were reproduced and classified under `TYPE_LINK_EXEMPTIONS` with accurate semantic contracts and real source owners documented in `packages/experimental/im-feishu/README.md`. The `imIngress` and `imRuntime` services were mapped to their owning subsystem document `docs/subsystems/im.md`, while `terminalRestore` was registered as a launcher-installed controller in `SERVICE_WALK_EXEMPTIONS`. All four independent review findings, the forbidden `as unknown` assertion in `session-provider.spec.ts:441`, and downstream doc-graph/inspect-catalog synchronizations have been verified and pass.

---

## 2. Reproduction of Catalog Violations

Initial reproduction via `pnpm exec tsx scripts/gen-cordis-catalog.ts --check` confirmed:
1. **12 signature type-link coverage violations** across `ctx.imIngress` and `ctx.imRuntime` method signatures.
2. **Missing JSDoc description prose** for `ctx.imRuntime.handleClientDisconnected` in `packages/experimental/im-feishu/src/runtime-service.ts`.
3. **Partition problem** for unmapped rendered keys `imIngress` and `imRuntime` and unexempted declared key `terminalRestore`.

---

## 3. Implemented Policy & Architecture Classifications

### A. Service & Exemption Classifications
- **`terminalRestore`**: Declared as an optional property on `Context` in `packages/boot/app-boot/src/terminal-restore.ts` (`terminalRestore?: TerminalRestoreController`). It is an optional launcher-installed controller rather than an instantiated Cordis service class. Classified in `SERVICE_WALK_EXEMPTIONS` in `scripts/gen-cordis-catalog.ts`:
  ```ts
  terminalRestore: 'not a service: optional launcher-installed terminal restore controller (TerminalRestoreController | undefined) — packages/boot/app-boot/README.md owns the boot contract',
  ```
- **`imIngress` & `imRuntime`**: Instantiated and exported service classes (`IngressService` and `TenantRuntimeService`). Rendered by Cordis catalog projector and mapped in `SERVICE_PAGE` to the dedicated subsystem page:
  ```ts
  imIngress: 'im.md',
  imRuntime: 'im.md',
  ```
- **`SERVICE_ROLES` in `scripts/gen-doc-graphs.ts`**:
  Classified both services with mode `'service'` and owner `experimental-im-feishu`:
  - `imIngress`: Durable IM message admission and dispatch.
  - `imRuntime`: Isolated tenant IM conversation runtime.

### B. 12 IM Types Registration & Accurate Documentation
Registered in `TYPE_LINK_EXEMPTIONS` in `scripts/gen-cordis-catalog.ts` with explicit semantics and owner reference `packages/experimental/im-feishu/README.md`:
1. `CancelDeliveryRequest`: IM runtime delivery cancellation request.
2. `CancelDeliveryResponse`: IM runtime delivery cancellation response.
3. `GetApprovalContextRequest`: IM approval context request.
4. `GetApprovalContextResponse`: IM approval context response.
5. `GetDeliveryRequest`: IM runtime delivery lookup request.
6. `GetDeliveryResponse`: IM runtime delivery lookup response.
7. `IncomingImMessage`: IM ingress message payload.
8. `IngressAcceptResult`: IM ingress admission result.
9. `OperatorBindingRecord`: IM operator binding contract.
10. `SubmitDeliveryRequest`: IM runtime delivery request.
11. `SubmitDeliveryResponse`: IM runtime delivery acknowledgement.
12. `TenantReceiptRecord`: IM tenant delivery receipt storage.

Documented in `packages/experimental/im-feishu/README.md` and `README.zh.md` under `### Non-catalog types` with exact source pointers:
- `src/types.ts`: `IncomingImMessage`, `IngressAcceptResult`.
- `src/storage.ts`: `OperatorBindingRecord` (persisted operator authorization in storage), `TenantReceiptRecord` (persisted delivery receipt record).
- `src/ipc.ts`: `SubmitDeliveryRequest`, `SubmitDeliveryResponse`, `GetDeliveryRequest` (selects by `deliveryKey` with optional `sessionId`), `GetDeliveryResponse`, `CancelDeliveryRequest`, `CancelDeliveryResponse` (returns outcome status enum: `cancelled`, `not_found`, `completed`, `failed`, or `unknown`), `GetApprovalContextRequest`, `GetApprovalContextResponse` (Phase-2 IPC returning strictly null context as approval arguments are intentionally unavailable over IPC).
- Replaced all legacy webhook deliveries wording with platform WebSocket messages in package READMEs and subsystem docs.

### C. Subsystem Documentation & Site Navigation
- Created `docs/subsystems/im.md`, paired Chinese `docs/subsystems/im.zh.md`, and translation pairing manifest `docs/subsystems/im.i18n.yaml`.
- Injected generated Cordis API surfaces for `ctx.imIngress` and `ctx.imRuntime`.
- Added `| [im.md](im.md) | ...` table row in `docs/subsystems/README.md` and `docs/subsystems/README.zh.md`, satisfying `scripts/project-doc-site.spec.ts`.
- Added canonical subsystem links to `../../docs/subsystems/terminal.md` and `boot.md` in `packages/tui/README.md` and `packages/tui/README.zh.md`, satisfying `verify-subsystem-pages`.

### D. Typed Disposal Interception in Session Provider Test
- Replaced forbidden `as unknown` cast in `packages/experimental/im-feishu/tests/session-provider.spec.ts:441` with typed `ctx.agents.create` interception.
- Handled disposal cleanly: first wrapped handle awaits its bound real original dispose before throwing the simulated failure, preventing resource leaks while verifying `Promise.allSettled` joins all disposals.

### E. Upstream Intake Registry Patch Registration
- Registered `packages/extensions/cordis-client-runner/src/client/api-catalog.ts` in `PATCHES` in `scripts/upstream-intake-registry.ts`.
- Verified `pnpm exec tsx scripts/verify-upstream-intake.ts` passes with exit code 0.

### F. Negative Policy Controls
- Added two regression unit tests to `scripts/gen-cordis-catalog-partition.spec.ts`:
  1. `rejects a declared launcher controller when missing from serviceWalkExemptions`: Verifies that undeclared controller keys fail fail-closed.
  2. `rejects an exemption for a service that the projection actually renders`: Verifies that rendered services cannot masquerade as exemptions in `SERVICE_WALK_EXEMPTIONS`.
- All 12 tests in `scripts/gen-cordis-catalog-partition.spec.ts` pass.

---

## 4. Verification Evidence Matrix

| Gate / Test | Command | Outcome | Details |
|---|---|---|---|
| Cordis Catalog | `tsx scripts/gen-cordis-catalog.ts --check` | **PASS** | 131 files/regions up to date |
| Doc Graphs | `pnpm run gen-doc-graphs --check` | **PASS** | 7 graph docs up to date |
| Inspect Catalog | `pnpm run gen-cordis-inspect-catalog --check` | **PASS** | `api-catalog.ts` up to date |
| Client Catalog | `pnpm run gen-client-catalog --check` | **PASS** | `slot-catalog.ts` up to date |
| Plugin Packages | `pnpm run gen-plugin-packages --check` | **PASS** | `packages.md` up to date |
| Subsystem Pages | `pnpm run verify-subsystem-pages` | **PASS** | 55 groups checked, all conform |
| Doc Site Spec | `vitest run scripts/project-doc-site.spec.ts -t "subsystem"` | **PASS** | Index row test passes |
| Partition Policy Tests | `vitest run scripts/gen-cordis-catalog-partition.spec.ts` | **PASS** | 12/12 unit tests pass |
| IM Session Provider Tests | `vitest run packages/experimental/im-feishu/tests/session-provider.spec.ts` | **PASS** | 7/7 unit tests pass (149ms) |
| No Unknown Casts | `tsx scripts/verify-no-unknown-casts.ts` | **PASS** | 0 new unknown assertions |
| Upstream Intake | `tsx scripts/verify-upstream-intake.ts` | **PASS** | 4 recorded changes, intake complete |
| Translation Pairing | `tsx scripts/verify-translation-pairing.ts ...` | **PASS** | 4 modified pairs consistent |

---

## 5. Scope & State Audit
- **Memory Integrity**: Restored `.memory/active_context.md` to exact pre-edit bytes. No external memory modified.
- **Git State**: No git commits or pushes made. Untracked compiler residues preserved per root archive instructions.

## 6. Independent integration follow-up

Codex independently reproduced seven session-provider passes and twelve partition-policy passes. The old contract suite selected alongside the partition test skips 28 cases; those are not credited as passes. The full documentation run passed 41 checks and found one remaining stale bilingual capability reference. Codex copied only the new IM graph nodes/edges into the Chinese counterpart, translated the two service rows and refreshed `docs/capability-seams.i18n.yaml`. The final aggregate result is owned by [local merge repairs](local-merge-repairs.md).

The worker restoration statement above is worker-reported; Codex did not inspect private memory content. The settled worker was released before acknowledging its completion delivery; its external terminal was retained idle, and no worker cleanup decision remains outstanding.
