# Platform Transport Report: Feishu and DingTalk Stream Transports

## Executive Summary
This report documents the implementation, real-SDK integration, and verification of concrete Feishu and DingTalk Stream platform transports for the DeepSeek Harness feature expansion. The implementation incorporates durable inbox ACK synchronization, strict input normalizers with UTF-8 byte bounds and clock-skew defenses, SSRF mitigations, outbound sanitization, and non-retrying ambiguous timeout semantics for network drops and uncertain server states.

Following coordinator handoff `msg_fbd22676a61e`, ownership of `feishu-outbound.ts` and `im-dingtalk` normalizer/transport/outbound was transferred to the coordinator to unify route persistence, deduplication, and outbox integration. The transport lane retained `im-feishu/src/feishu-transport.ts`, `im-feishu/src/feishu-normalizer.ts`, both test suites (`packages/experimental/im-feishu/tests/feishu-transport.spec.ts` and `packages/experimental/im-dingtalk/tests/dingtalk-transport.spec.ts`), `im-dingtalk/src/types.ts`, `package.json`, `tsconfig.json`, and documentation. All 62 tests across both test suites pass (33 Feishu + 29 DingTalk) in under 1 second.

## Architecture & Implementation Details

### 1. Feishu Platform Transport (`packages/experimental/im-feishu/`)
- **Normalized Inbound Event Handling (`src/feishu-normalizer.ts`)**:
  - Transparently normalizes both flattened SDK `EventDispatcher` outputs (produced by Lark Node SDK) and raw nested `{ header, event }` wire format payloads.
  - Strict security and boundary validation: Drops bot senders (`sender_type !== 'user'`), non-p2p chats (`chat_type !== 'p2p'`), foreign application IDs (`app_id`), foreign enterprise tenants (`tenant_key`), and non-text message formats.
  - Enforces UTF-8 byte bounds (`maxMessageBytes`), character counts (`maxMessageLength`), message age expiration (`maxMessageAgeMs`), and future clock-skew caps (`maxFutureSkewMs`).
  - Card 2.0 Normalization: `normalizeFeishuCardAction` supports Card 2.0 interactive callbacks and form components, extracting direct `operator.open_id`, `actionName` (from `action.name`), `formValue` (from `action.form_value`), and verified app/tenant/chat/operator identities without trusting client-supplied tenant, session, or parameter payloads.
  - Outbound text sanitization: `sanitizeOutboundText` strips `<think>...</think>` internal reasoning tags, redacts authorization tokens/keys, and bounds output character length.
- **WebSocket Transport Lifecycle (`src/feishu-transport.ts`)**:
  - Coordinates official `@larksuiteoapi/node-sdk` `WSClient` and `EventDispatcher`.
  - Start/close latch and race protection with bounded graceful teardown (`shutdownTimeoutMs`).
  - Durable Inbound ACK Gate: Awaits `inboundAcceptor.handleIncomingMessage` before returning `{ code: 0 }`. On write rejection or database failure, re-throws to bubble up through `EventDispatcher.invoke`, triggering HTTP 500 ACK to the Feishu gateway for safe platform retry without duplicate processing.
  - Interactive card action handling: In `onCardActionEvent`, deterministic refusals return a negative static toast acknowledgement (`{ toast: { type: 'warning', content: '...' } }`) rather than throwing an error that would cause transport-level 500 retries.
- **Outbound HTTP Client Controls (`src/feishu-outbound.ts`, coordinator-maintained)**:
  - Official HTTPS origin validation restricting domains to `open.feishu.cn` and `open.larksuite.com`.
  - Full round-trip request and response body read timeout via `AbortController`.
  - Ambiguous Network and Response Handling: Network disconnects, socket resets, HTTP 500/408 status codes, malformed JSON bodies, and 200 OK responses with missing `message_id` throw `FeishuAmbiguousTimeoutError` with `status: 'unknown'` and zero automatic retries.
- **Test Suite (`tests/feishu-transport.spec.ts`)**:
  - 33 passing unit and integration tests.
  - Real `@larksuiteoapi/node-sdk` EventDispatcher and WSClient integration:
    - Parses real v2 event frames, invokes transport, and awaits durable inbox persistence.
    - Re-throws when durable write fails to ensure HTTP 500 response.
    - Negative controls: Drops bot messages cleanly with `{ code: 0, msg: 'Ignored...' }`; propagates app ID mismatch; verifies clean WSClient disposal.
    - Card 2.0 controls: Tests real v2 card action trigger normalization and app ID mismatch rejection.
    - Outbound controls: Verifies UNKNOWN classification on timeouts, resets, HTTP 500/408, malformed JSON, missing message ID, and domain validation.

### 2. DingTalk Platform Transport (`packages/experimental/im-dingtalk/`)
- **Package Foundation & Cycle Elimination**:
  - Removed circular references to `im-feishu` from `package.json`, `tsconfig.json`, and `tsconfig.check.json`, ensuring clean standalone compilation without project reference cycles.
- **Type System (`src/types.ts`)**:
  - Branded types for `DingTalkClientId`, `DingTalkCorpId`, `DingTalkConversationId`, `DingTalkSenderId`, and `DingTalkMessageId`.
  - Normalized `IncomingImMessage` with optional `replyRoute` (`dingtalk-session-webhook`) matching coordinator's ingress route ABI.
- **Inbound Normalizer (`src/dingtalk-normalizer.ts`, coordinator-maintained)**:
  - Validates 1-on-1 private chat sessions (`conversationType === '1'`).
  - Stable business message ID deduplication: Uses `msgId` directly as `eventId` and `messageId` (no invented fallback identities).
  - Validates `senderCorpId`, `sessionWebhookExpiredTime` (finite future timestamp), UTF-8 byte limits, and clock skew.
  - SSRF Mitigation: Strict validation of `sessionWebhook` against approved HTTPS hosts (`oapi.dingtalk.com`, `api.dingtalk.com`), rejecting non-HTTPS protocols, loopback/private IP addresses, and custom ports.
- **Outbound Client (`src/dingtalk-outbound.ts`, coordinator-maintained)**:
  - Dispatches replies to validated `sessionWebhook` endpoints with `redirect: 'error'`, full round-trip timeouts, and ambiguous timeout classification (`status: 'unknown'`).
  - Honest reply confirmation: Confirms receipt with `{ status: 'sent' }` without inventing fake platform message IDs.
- **Stream Transport Lifecycle (`src/dingtalk-transport.ts`, coordinator-maintained)**:
  - Manages `DWClient` stream lifecycle and registers listener on `TOPIC_ROBOT` (`/v1.0/im/bot/messages/get`).
  - Real SDK Callback Handling: Because `DWClient.prototype.onCallback` synchronously emits events via Node `EventEmitter` and ignores returned promises, the transport explicitly calls `dwClient.socketCallBackResponse(messageId, {})` only after durable inbox persistence succeeds.
  - On durable write failure or exception, socket ACK is withheld, allowing the DingTalk gateway to redeliver the message without duplicate execution.
  - Connect lifecycle validation: Checks `dwClient.connected` and rejects `start()` when `connect()` resolves without establishing a stream connection.
- **Test Suite (`tests/dingtalk-transport.spec.ts`)**:
  - 29 passing unit and integration tests.
  - Real `dingtalk-stream` `DWClient` integration & negative controls:
    - Instantiates real `DWClient` and verifies constants (`TOPIC_ROBOT`, `EventAck`).
    - Dispatches downstream frame through real `DWClient.prototype.onDownStream`, awaiting durable inbox persistence and verifying explicit socket response ACK (`send` spy called with `('event_stream_msg_001', { response: {} })`).
    - Negative control: When durable write fails, socket ACK is strictly withheld (`send` spy not called), ensuring platform redelivery.
    - Connect failure control: Verifies that `start()` rejects if `connect()` resolves while `connected === false`.
    - Outbound controls: SSRF destination rejection, ambiguous timeouts, socket resets, HTTP 500/408, malformed JSON bodies, and platform rejection errors.

## Outstanding Coordinator-Owned Items
1. In `packages/experimental/im-dingtalk/src/dingtalk-transport.ts:174`:
   `autoReconnect: this.config.autoReconnect` triggers TS2353 error on the `DWClient` constructor options; requires coordinator adjustment.
2. Shared root ingress composition and integration across platform packages.

## Verification Evidence
- **Vitest Unit & Integration Suites**:
  - `packages/experimental/im-feishu/tests/feishu-transport.spec.ts`: **33 passed** (0 failed).
  - `packages/experimental/im-dingtalk/tests/dingtalk-transport.spec.ts`: **29 passed** (0 failed).
  - Total: **62 passed** (0 failed) in 0.71s.
- **JSDoc Validation**:
  - All owned exports in `feishu-transport.ts`, `feishu-normalizer.ts`, and `im-dingtalk/src/types.ts` pass `verify-export-jsdoc` with zero violations.
