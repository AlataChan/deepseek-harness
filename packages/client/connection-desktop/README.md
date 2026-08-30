# `@deepseek-ai/dsh-client-connection-desktop`

Desktop companion Host carrier. This package re-exports the process-carrier Host apply and adds no protocol of its own. It does not publish a `dsh.client` face: the WebView installs `__DSH_TRANSPORT__` and the official `client-connection` plugin consumes it.

## Model Experience

None, as the desktop carrier transports existing messages but contributes no model context.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Claimed stdio only** — Host apply uses the process-wide claimed stdio port; this plugin does not construct a second `StdioLinePort`.
- **Launch-time workspace only** — the companion reads `--workspace-root` once; Client directory-picker rows do not restart it.
