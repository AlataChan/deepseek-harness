---
description: "Configure Feishu and DingTalk private-chat connections from desktop Settings."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-desktop-im

English | [中文](README.zh.md)

## Summary

This fork-owned desktop overlay adds Settings → IM integrations. Feishu and DingTalk have separate saved settings and enable choices. The Host reuses the experimental durable ingress and Agent delivery services under the desktop user's permissions. The desktop payload pin includes this overlay; integrations remain off until configured and enabled.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Open Settings → IM integrations. Follow the channel card's developer-console instructions, then enter the app ID, secret, organization ID, authorized private-chat ID and user ID. Select an existing model provider, model and absolute workspace directory owned by the desktop user. The identity fields must match the platform event; group chats and other operators are rejected.

Save settings, test the connection, then enable the channel. Saving changes stops that channel and requires an explicit enable. Leave the secret blank to retain the stored value. Connection testing authenticates the official transport but admits no messages and invokes no model. It does not verify your platform's event subscriptions or a full round trip.

Keep the desktop running while connected. Disable closes admission, cancels owned Agent work and awaits disposal. An enabled choice restores on relaunch; failed startup remains visible as an error. The existing credential provider stores secrets, while configuration reads return only presence. No secret is written to the connection JSON.

<a id="understand-the-implementation"></a>
## Understand the implementation

The patch inserts the `desktop-im` Host service; its Client half contributes a localized settings section and shell-owned toast. `src/controller.ts` serializes settings transactions and connection lifetimes. `im-feishu/desktop` supplies direct single-user composition with SQLite inbox/outbox, receipts, exact operator bindings and existing Session reconciliation. It opens no tenant TCP server and does not claim cross-UID isolation.

Configuration files live under `$DSH_HOME/profiles/desktop/im/`. One desktop Host owns the settings directory; each platform owns a delivery database. Changing the authorized identity or workspace selects separate delivery state. Deployment limits, dispatch interval and shutdown deadline are configurable on the Host row. A corrupt settings file is retained and reported for its channel. The overlay bundles its IM adapters and storage libraries; stable application defaults do not acquire experimental dependencies.

### Remote data

| Type | Meaning |
|---|---|
| `ImChannel` | Feishu or DingTalk channel selector |
| `ConnectionConfig` | Non-secret app, operator, workspace and model settings |
| `ImSnapshot` | Saved configuration, enabled choice, secret presence, socket phase and sanitized error category |

<a id="model-experience"></a>
## Model Experience

Indirectly, through the [IM delivery service](../im-feishu/README.md), which owns human prompt admission and model requests.

#### KV Cache effect

None from settings operations; the IM delivery service and selected Agent preset own request tokens and cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- This is a single-user desktop connection, not the Linux systemd multi-tenant deployment. IDs currently come from the platform developer console. The first desktop integration supports one authorized private-chat/user tuple per channel. It does not install an IM approval/card answerer; existing tool approval policy still applies. Real Feishu/DingTalk app permissions, subscriptions and end-to-end replies require an authorized test application; synthetic transport tests do not establish those results.

<a id="dev-note"></a>
### Dev Note

The existing [IM service](../im-feishu/README.md) owns delivery semantics. The [desktop settings design](../../../.plans/feature-expansion-2026-10-24/desktop-im-settings-design.md) records the local execution model.
