---
description: "Desktop companion Host carrier: re-exports the process-carrier Host apply and adds no protocol of its own; the WebView consumes __DSH_TRANSPORT__."
kind: "package-reference"
---

# `@deepseek-ai/dsh-client-connection-desktop`

## Summary

`connection-desktop` is the desktop companion's Host carrier: it re-exports the process-carrier Host apply and adds no protocol of its own. It publishes no `dsh.client` face; the WebView installs `__DSH_TRANSPORT__` and the official `client-connection` plugin consumes it.

The Host build inlines `connection-process` from its emitted `lib/types` input, which is complete before parallel bundling starts. The relationship remains a development dependency; published runtime libraries are not build inputs.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Model Experience

None, as the desktop carrier transports existing messages but contributes no model context.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Claimed stdio only** — Host apply uses the process-wide claimed stdio port; this plugin does not construct a second `StdioLinePort`.
- **Launch-time workspace only** — the companion reads `--workspace-root` once; Client directory-picker rows do not restart it.

### Dev Note

Wire changes belong in `dsh-client-connection-process`, not here — this package only re-exports its Host apply and owns no protocol. Host apply uses the process-wide claimed stdio port, so it must not construct a second `StdioLinePort`, and the companion reads `--workspace-root` once at launch.
