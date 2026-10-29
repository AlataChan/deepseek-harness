# 即时通信子系统

[English](im.md) | 中文

即时通信（IM）子系统提供多租户聊天接入准入、已认证操作员绑定、投递回执跟踪以及运行时执行隔离。接入（ingress）插件校验传入的平台事件与 WebSocket 消息并在返回平台 ACK 之前将其持久化存入队列。运行时服务管理隔离的 Agent 会话，执行严格的故障闭锁操作员校验与持久化会话映射。[飞书 IM 包](../../packages/experimental/im-feishu/README.zh.md)实现了飞书适配器。

## 接入准入

接入服务监听传入的平台消息，验证操作员绑定，并在确认平台投递前将消息提交至持久化存储。接入层与运行时层在独立的隔离进程中运行。

## 租户运行时

租户运行时管理映射到外部会话的活跃 Agent 会话。它验证操作员授权，强制执行私有工作目录，异步对齐会话日志，并在关闭时刷新会话。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Agent](core.zh.md)

Source: [`packages/experimental/im-feishu/src/runtime-service.ts`](../../packages/experimental/im-feishu/src/runtime-service.ts)
<!-- END GENERATED cordis-surface -->
