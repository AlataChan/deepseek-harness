---
description: "Helper functions for Feishu IM message source minting, injective delivery key encoding, and approval context resolution."
kind: "package-library"
---

# @deepseek-ai/dsh-experimental-im-feishu

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-experimental-im-feishu` provides human prompt sources, durable IM delivery storage, ingress admission and tenant runtime services. Authenticated operator messages retain `kind: user` with fresh UUID request IDs; external identities stay in the business database. Service constructors alone start no platform connections or execution processes. Explicit profile composition and deployment qualification are required before use.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

### When to use it

Import this helper library inside Feishu IM ingress handlers or approval adapters when converting incoming platform WebSocket messages into Harness user prompt sources or handling admission for pending approvals. The root entry is a library. The separate `./runtime` and `./ingress` exports provide the isolated process plugins; they require explicit deployment configuration and must never be mounted together in one tenant process.

### Entry point

Import helper functions or isolated process plugins from their explicit entry points:

```ts
// Library helpers: prompt source minting and key encoding
import { createImPromptSource, mintImSessionRequestId } from '@deepseek-ai/dsh-experimental-im-feishu'

// Ingress plugin entry: mounts WebSocket transport and durable admission queue
import * as ingressPlugin from '@deepseek-ai/dsh-experimental-im-feishu/ingress'

// Runtime plugin entry: mounts tenant session mapping and execution service
import * as runtimePlugin from '@deepseek-ai/dsh-experimental-im-feishu/runtime'
```

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

| File | Role |
|---|---|
| [`src/types.ts`](src/types.ts) | Branded Feishu external identifiers and resolved approval context types |
| [`src/source.ts`](src/source.ts) | Option (c) user prompt source construction and injective JSON-tuple key encoding |
| [`src/storage.ts`](src/storage.ts) | Single-writer inbox/outbox and receipt domains with crash reconciliation |
| [`src/ingress.ts`](src/ingress.ts) | ACK after durable admission; separately driven dispatch and reply delivery |
| [`src/feishu-transport.ts`](src/feishu-transport.ts) | WebSocket transport with bounded startup, configurable polling, and graceful drain |
| [`src/feishu-normalizer.ts`](src/feishu-normalizer.ts) | Bidirectional frame normalization, Bearer token redaction, and Card 2.0 parsing |
| [`src/feishu-outbound.ts`](src/feishu-outbound.ts) | Origin checks, timeouts, sanitization, returned message IDs and uncertain-send classification |
| [`src/runtime-service.ts`](src/runtime-service.ts) | Tenant-owned session mapping, duplicate suppression and bounded cancellation |
| [`src/approval-context.ts`](src/approval-context.ts) | Turn-scoped native and PTC tool approval context resolution failing closed on malformed or settled calls |

While the runtime owns an active delivery, status remains admitted even before its prompt is readable from persistence. After settlement, status comes from the receipt and correlated Session log; a recovered receipt with no matching prompt remains unknown and is never replayed automatically.

</details>

### Non-catalog types

The package defines twelve IPC, admission, and receipt types documented outside the subsystem Cordis catalog:

- [`src/types.ts`](src/types.ts):
  - `IncomingImMessage` — canonical validated incoming platform IM message payload.
  - `IngressAcceptResult` — durable ingress admission result recording the minted request ID and retry status.
- [`src/storage.ts`](src/storage.ts):
  - `OperatorBindingRecord` — authenticated operator binding record in storage managing authorization state.
  - `TenantReceiptRecord` — persisted delivery receipt record in tenant storage with execution outcomes and timestamps.
- [`src/ipc.ts`](src/ipc.ts):
  - `SubmitDeliveryRequest` — IPC request submitting an admitted delivery to the tenant runtime.
  - `SubmitDeliveryResponse` — IPC response acknowledging delivery submission status.
  - `GetDeliveryRequest` — IPC request querying runtime delivery status by delivery key with optional session ID.
  - `GetDeliveryResponse` — IPC response returning delivery state and execution result.
  - `CancelDeliveryRequest` — IPC request requesting bounded cancellation of active delivery processing.
  - `CancelDeliveryResponse` — IPC response returning cancellation outcome status (`cancelled`, `not_found`, `completed`, `failed`, or `unknown`).
  - `GetApprovalContextRequest` — Phase-2 IPC request querying approval context for a pending tool decision.
  - `GetApprovalContextResponse` — Phase-2 IPC response returning strictly null context as approval arguments are intentionally unavailable over IPC.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Feature Expansion Architecture Plan](../../../.plans/feature-expansion-2026-10-24/dsh_feature_expansion_architecture_plan.md) — multi-tenant IM and isolation architecture.
- [Source Decision Record](../../../.plans/feature-expansion-2026-10-24/decision-source.md) — empirical comparison of source format options (a), (b), and (c).
- [Expansion Completion Record](../../../.plans/feature-expansion-2026-10-24/expansion-completion.md) — scoped test evidence and remaining deployment gates.

-----

<a id="model-experience"></a>
## Model Experience

### Ingress prompt source

#### What the model sees

Messages formatted with `createImPromptSource` carry `kind: 'user'` and a minted `SessionRequestId` in `rpcId`. The model observes incoming messages as standard human user prompts without platform-specific delivery identifiers or platform transport metadata.

#### Token effect

Adds the prompt message text to the conversation context without additional overhead from external delivery keys or protocol headers.

#### KV Cache effect

Appends standard user prompt tokens following the established conversation prefix, preserving cache reuse across sequential turns.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Qualification scope** — local source and installed disposable Linux checks passed independent review. Live platform delivery, production deployment, physical two-host SSH and CI execution remain separate unrun gates; see the [expansion acceptance](../../../.plans/feature-expansion-2026-10-24/expansion-completion.md).

- **Deployment remains separate** — service classes do not install systemd units, configure OS users or start profiles. Linux socket permissions and process isolation require target acceptance. The runtime waits for durable delivery cancellation and storage drain before requesting launcher exit. With the shipped `Accept=yes` socket units, an ingress disconnect ends its tenant runtime and cancels active turns; reconnect waits for that runtime to drain. Runtime native modules use a private executable `TMPDIR` under tenant state.
- **Delivery uncertainty is explicit** — a receipt without a correlated logged prompt is never replayed automatically. Unconfirmed external sends become unknown and require reconciliation or operator resolution.
- **Limits and polling are deployment configuration** — readiness polling interval (`connectionStatusPollIntervalMs`), startup, send, and shutdown timeouts are validated config fields. Ingress bounds retained deliveries, prompt/reply bytes, message age and send attempts.
- **Fail-closed Phase 2 defaults and terminal SDK failure** — unconfigured card acceptors, stale actions, or malformed payloads fail closed with warning toasts. SDK connection exhaustion or permanent failure transitions the transport into a terminal state requiring instance re-creation.
- **Approval authority is explicit** — the default runtime exposes no approval arguments over IPC. Optional interaction brokers require exact live request identity, a current authenticated binding and a single-use durable decision; timed structured questions are delegated to another answerer or fail closed.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Experimental library under `@deepseek-ai/dsh-experimental-*`.

</details>
