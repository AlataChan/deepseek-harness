---
description: "An explicit experimental profile bundle for isolated IM tenant runtimes."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-im-service-bundle

English | [中文](README.zh.md)

## Summary

This declarative bundle mounts the IM tenant runtime over `dsh-base`. The profile composer reads `dsh.bundle.patch`; the module exports no runtime API. Ingress runs in a separate profile with an empty bundle list.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

### Runtime profile composition

Copy the [tenant profile examples](../im-feishu/examples/profiles/tenant-a/package.json) into the selected private `DSH_HOME/profiles/` directory and configure their patch for the authorized tenant, operator and workspace. The profile lists `@deepseek-ai/dsh-base` followed by this bundle, with explicit dependencies matching the deployed build. Launch through `dsh --profile tenant-a`.

### Separate ingress profile

The [ingress example](../im-feishu/examples/profiles/ingress/package.json) lists no bundles and declares only the storage hub and IM transport package. Its patch mounts `storage` and `im-ingress`. Credentials and authenticated operator bindings are administrator configuration; incoming messages cannot choose tenant processes or executable commands.

<a id="understand-the-implementation"></a>
## Understand the implementation

The [bundle patch](cordis.patch.yml) disables development HMR and mounts the tenant runtime. Required environment settings are `DSH_IM_TENANT_ID`, comma-separated `DSH_IM_OPERATOR_IDS`, and `DSH_IM_STATE_DIR`; a profile patch may provide these settings explicitly. `DSH_IM_CWD` selects the workspace. Without `DSH_IM_SOCKET_PATH`, the runtime uses inherited systemd stdio. Invalid or missing runtime settings fail at startup.

The [deployment examples](../im-feishu/examples/README.md) define per-tenant socket/service pairs, private state and executable temporary directories, resource limits and separate UIDs. They require administrator provisioning and target qualification.

<a id="further-exploration"></a>
## Further Exploration

- [IM services and interactions](../im-feishu/README.md)
- [Expansion acceptance record](../../../.plans/feature-expansion-2026-10-24/expansion-completion.md)

<a id="model-experience"></a>
## Model Experience

### Runtime composition

#### What the model sees

Authenticated operator prompts retain the standard human `user` source. Transport identifiers stay in the ingress database.

#### Token effect

The bundle adds no model instruction text. Prompts, interaction notices and ordinary preset context remain logged Session inputs.

#### KV Cache effect

Turns append to the selected Session. Cache behavior follows the configured preset and model provider.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Qualification scope** — local source and installed disposable Linux checks passed independent review. Live platform delivery, production deployment, physical two-host SSH and CI execution remain separate unrun gates; see the [expansion acceptance](../../../.plans/feature-expansion-2026-10-24/expansion-completion.md).

This package is experimental and requires explicit profile installation. Live platform accounts and physical remote hosts need separate qualification. With systemd `Accept=yes`, losing the ingress connection cancels active tenant work and flushes terminal state before exit; an ingress restart therefore requires durable reconciliation. Sensitive operations without a configured approval answerer fail closed.

<a id="dev-note"></a>
### Dev Note

The bundle is configured by the profile composer; its module exports no service. Runtime behavior and lifecycle tests belong to the IM package.
