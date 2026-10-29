# Instant messaging subsystem

English | [中文](im.zh.md)

The instant messaging (IM) subsystem provides multi-tenant chat admission, authenticated operator bindings, receipt tracking, and runtime execution isolation. Ingress plugins validate incoming platform events and WebSocket messages and admit them into durable queues before returning platform ACKs. Runtime services manage isolated agent sessions with strict fail-closed operator verification and durable conversation mappings. The [Feishu IM package](../../packages/experimental/im-feishu/README.md) implements the Feishu adapter.

## Ingress admission

The ingress service listens for incoming platform messages, authenticates operator bindings, and commits messages into durable storage before acknowledging the platform delivery. Ingress and runtime run in separate isolated processes.

## Tenant runtime

The tenant runtime manages active agent sessions mapped to external conversations. It validates operator authorization, enforces private working directories, reconciles session logs asynchronously, and flushes sessions on shutdown.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctximingress--ingressservice"></a>

### `ctx.imIngress` — `IngressService`

Durable inbound admission and an explicitly owned dispatcher.

```ts cordis-catalog
/**
 * Authorize every delivery, including retries; persist before returning the platform ACK.
 * @param event - Platform-authenticated, normalized human private-chat message.
 * @returns Stable request ID and whether this delivery already existed.
 */
handleIncomingMessage(event: IncomingImMessage): Promise<IngressAcceptResult>

/**
 * Run one recovery/dispatch pass. The profile owns scheduling and error reporting.
 * @returns Completion of the shared pass; concurrent calls never start duplicate dispatchers.
 */
dispatchPending(): Promise<void>

/**
 * Serialize live binding administration and card decisions at one ingress authority.
 * @param deliveryKey - Canonical identity selected from a stored delivery.
 * @param operation - Bounded work authorized for the current binding.
 * @returns Operation result; queued revocation takes effect before subsequent decisions.
 */
withAuthorizedBinding<T>(deliveryKey: string, operation: (binding: OperatorBindingRecord) => Promise<T>): Promise<T>

/**
 * Revoke through this method, rather than directly editing the live backing domain.
 * @param bindingKey - Administrator-selected binding key.
 * @returns Durable revocation; active-delivery cancellation failures propagate without undoing revocation.
 */
revokeBinding(bindingKey: string): Promise<void>

/**
 * Stop accepting messages and await the owned admission queue and dispatcher.
 * @returns Completion after owned work stops; child deadlines belong to their providers.
 */
async close(): Promise<void>
```

Source: [`packages/experimental/im-feishu/src/ingress.ts`](../../packages/experimental/im-feishu/src/ingress.ts)

<a id="ctximruntime--tenantruntimeservice"></a>

### `ctx.imRuntime` — `TenantRuntimeService`

Race-safe tenant admission using public Agent and Session methods.

```ts cordis-catalog
/**
 * Admit a fresh delivery once. Existing uncertain receipts return unknown without replay.
 * @param request - Validated IPC submission.
 * @returns Admission status correlated with the caller's frame ID.
 */
async handleSubmitDelivery(request: SubmitDeliveryRequest): Promise<SubmitDeliveryResponse>

/**
 * Resolve the current owned delivery for an exact live Agent instance.
 * @param agent - Calling Agent; a matching Session ID alone is insufficient.
 * @returns Active receipt, or undefined outside this runtime's owned interval.
 */
ownerOf(agent: Agent): TenantReceiptRecord | undefined

/**
 * Query the receipt-bound session; owned live deliveries remain admitted until settlement.
 * @param request - Delivery lookup.
 * @returns Reconciled durable result or explicit uncertainty.
 */
async handleGetDelivery(request: GetDeliveryRequest): Promise<GetDeliveryResponse>

/**
 * Cancel only the Agent owned by this delivery and await its settlement.
 * @param request - Receipt-scoped cancellation.
 * @returns Actual settlement; absent and uncertain work is never reported cancelled.
 */
async handleCancelDelivery(request: CancelDeliveryRequest): Promise<CancelDeliveryResponse>

/**
 * Phase 2 has no trusted interactive responder; raw tool arguments never cross IPC.
 * @param request - Context request.
 * @returns Explicitly unavailable context.
 */
handleGetApprovalContext(request: GetApprovalContextRequest): Promise<GetApprovalContextResponse>

/**
 * Close admission and cancel owned Agents when the ingress connection ends.
 * @returns Bounded quiescence and persistence of the owned runtime work.
 */
handleClientDisconnected(): Promise<void>
```

Types: [Agent](core.md)

Source: [`packages/experimental/im-feishu/src/runtime-service.ts`](../../packages/experimental/im-feishu/src/runtime-service.ts)
<!-- END GENERATED cordis-surface -->
