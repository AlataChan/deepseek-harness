---
description: "Commerce capability definition for provider authors and Consumers that import, bind, read, analyze, and render commerce data."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-commerce

English | [中文](README.zh.md)

## Summary

`dsh-host-commerce` defines the `ctx.commerce` capability for commerce source discovery and import, one-time Session binding, provider-neutral reads and analysis, and platform export rendering. It owns the durable `commerce/bound` event and its `commerceBinding` projection. The package is a release-group Service Definition; Providers and Consumers live in separate packages.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Provider authors subclass `Commerce`, implement source import, bounded reads, read-only analysis, and CSV rendering, then mount that Provider in a Cordis composition. Unknown source identities must fail with `CommerceError('source-missing', ...)`. Provider configuration resolves platform identifiers and owns storage and query enforcement.

Consumers inject `commerce`, call its provider-neutral methods, and map the closed `CommerceErrorCode` vocabulary onto their own tool, Remote, or UI protocol. A Consumer binds an existing `Agent` by calling `ctx.commerce.bind(agent, sourceId)`; it must not append `commerce/bound` directly. Client aggregates import `@deepseek-ai/dsh-host-commerce/client` to receive the projection declarations without loading the Host service.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`Commerce.bind` checks the live `commerceBinding` projection, verifies the source through the Provider, rechecks the projection at the commit point, and appends exactly one `commerce/bound` event. The second check prevents two concurrent calls in one process from committing two bindings. A failed or aborted verification appends nothing.

`platforms` lists the platform mapping ids the provider accepts for imports and exports. The read methods use branded source, listing, and change identities. `runAnalysisQuery` remains Provider-enforced and read-only; `renderExport` only returns CSV text, leaving approval, path policy, and file creation to the Consumer that owns the write.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Service Definition, branded identities, provider-neutral operations, and errors |
| [`src/types.ts`](src/types.ts) | Identity, value, and change-kind types, the durable event, and Host/Client projection declarations |
| [`src/session.ts`](src/session.ts) | Replayable `commerceBinding` projection definition |
| [`src/client.ts`](src/client.ts) | Types-only Client entry point |
| — | No runtime invariant companion is published because this stateless Service Definition has no independently observed state that can diverge. |

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as this Service Definition owns only capability types and a log-only Session binding event.

#### KV Cache effect

None; this package neither assembles nor sends a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One binding per Session** — `Commerce.bind` rejects rebinding with `already-bound`; this package defines no unbind or replacement event.
- **No implementation or presentation** — this package does not store source data, enforce SQL, expose tools or Remotes, render UI, approve exports, or write files; installed Providers and Consumers own those behaviors.
