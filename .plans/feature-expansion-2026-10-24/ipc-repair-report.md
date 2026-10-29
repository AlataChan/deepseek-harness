# IPC Repair Report: IM Feishu IPC Foundation

## Executive Summary
This report summarizes the repair of the IPC foundation under `packages/experimental/im-feishu/src/ipc.ts`, verified via unit tests in `packages/experimental/im-feishu/tests/ipc.spec.ts` and typechecked using source-plane `tsconfig.ipc-check.json`.

## Key Changes
1. **Framing & Byte Bounds**:
   - `NdjsonLineBuffer` now checks raw UTF-8 byte lengths before string trimming, preventing whitespace-padded bypasses.
   - Enforced residual buffer byte bounds after extracting valid frame prefixes.
   - Preserved multibyte UTF-8 characters across chunk boundaries using `StringDecoder('utf8')`.

2. **Stream Lifecycle & EOF**:
   - Added listener for readable `'end'` events so that EOF closes `TenantIpcSession` even when streams are configured with `autoDestroy: false`.
   - Idempotent async `close()` ensures in-flight handlers quiesce within bounded deadlines and the `onClose` hook is called exactly once.

3. **Wire Schemas & Discriminants**:
   - Replaced untyped casts with strict Zod schemas (`.strict()`) for all client requests and server responses (`init`, `submit_delivery`, `get_delivery`, `cancel_delivery`, `get_approval_context`, `ping`).
   - Added truthful response status outcomes: `'admitted' | 'completed' | 'failed' | 'cancelled' | 'unknown'`.
   - Validated response kind and request ID correlation in `TenantIpcClient`.

4. **Security & Validation**:
   - `TenantIpcClient` validates socket file paths before connection, rejecting symlinks, non-socket paths, world-writable modes, and mismatched UIDs.

5. **Concurrency & Drainage**:
   - `TenantIpcServer` retains writer ownership until client disconnect drainage completes, refusing second writers during active drainage with `ERR_SECOND_WRITER_REFUSED`.
   - Bounded pending requests cap on client and active operations cap on server.

## Verification
- Unit test suite: 23 passing tests in `packages/experimental/im-feishu/tests/ipc.spec.ts`.
- Type check: Clean compilation with zero errors via `./node_modules/.bin/tsc -p packages/experimental/im-feishu/tsconfig.ipc-check.json --noEmit`.
