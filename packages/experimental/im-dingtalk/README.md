---
description: "DingTalk Stream private-chat delivery with durable acknowledgement and bounded replies."
kind: "package-library"
---

# @deepseek-ai/dsh-experimental-im-dingtalk

English | [中文](README.zh.md)

## Summary

Receive authenticated DingTalk bot private messages, acknowledge durable acceptance, and reply through the message’s session webhook. The transport rejects unsupported identities and message formats before admission. It is consumed by the experimental IM ingress composition and does not launch an application by itself.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

### When to use it

Use the transport from an explicitly configured IM ingress profile. Its acceptor must persist messages before resolving acceptance; a storage exception withholds the SDK socket acknowledgement. The SDK ignores returned callback acknowledgements, so the transport explicitly calls `socketCallBackResponse` only after durable acceptance or definitive rejection.

### Entry point

The [module exports](src/index.ts) provide `DingTalkTransport`, its configuration schema, normalizer and outbound client. `start()` verifies the SDK connected flag; a resolved SDK connection promise alone does not establish readiness. `close()` blocks admission and awaits owned work within its configured deadline.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [normalizer](src/dingtalk-normalizer.ts) binds the configured application and organization to the sender and private conversation. Stable message IDs deduplicate delivery; socket message IDs correlate acknowledgements. The private ingress database retains the official HTTPS reply capability and expiry; neither is forwarded into the tenant Session. The [outbound client](src/dingtalk-outbound.ts) requires explicit successful platform response fields, rejects redirects and foreign origins, and treats ambiguous network outcomes as unknown. Accepted webhook replies have no platform message ID.

</details>

<a id="model-experience"></a>
## Model Experience

### Normalized private text

#### What the model sees

This library does not construct model requests. The consuming ingress decides whether to admit normalized `text` as an authenticated human prompt. Transport credentials and session-webhook URLs remain outside model context.

#### Token effect

Admitted message text contributes ordinary user prompt tokens; transport metadata contributes none.

#### KV Cache effect

The transport does not alter the model request prefix; the consuming runtime owns context assembly.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Qualification scope** — local source and installed disposable Linux checks passed independent review. Live platform delivery, production deployment, physical two-host SSH and CI execution remain separate unrun gates; see the [expansion acceptance](../../../.plans/feature-expansion-2026-10-24/expansion-completion.md).

- Private text chats only; group messages and attachments are rejected.
- Replies require an unexpired official session-webhook capability. Unknown sends are never automatically replayed.
- Human approval cards are not implemented for this channel. Sensitive tools require an independently trusted answerer or fail closed.
- Local SDK and loopback HTTP tests do not establish live application authorization or delivery. A designated test application and operator must be verified separately.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
