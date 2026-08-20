# @deepseek-ai/dsh-client-connection-vscode

English | [中文](README.zh.md)

Bounded carrier shared by the dsh companion process, VS Code extension host, and embedded Webview. The protocol keeps API Proxy RPC validation authoritative, preserves the existing `events.mux` resume payload, and restricts the host stream to an empty open payload. Its wire codec serializes each logical frame once, sends physical records sequentially for backpressure, admits one fragmented message per direction, verifies declared length and SHA-256 before parsing, and closes a decoder after any violation. Physical records default to 256 KiB; control messages default to 1 MiB; RPC and stream-data frames reuse the browser connection package's 160 MiB request capacity so the default 100 MiB aggregate image allowance remains usable.

The browser-safe `protocol` and `codec` entry points remain independent of Node. The root Host plugin consumes a process IPC channel, validates the launch handshake against its configured `workspaceRoot` (or `process.cwd()` when embedded without one), announces verified Client Plugin artifacts, routes existing ApiProxy envelopes, and drains stream pumps through its Cordis fiber. The `client` entry consumes private shell-provided record and IDE-event ports, extends the existing `AbstractApiClient`, and publishes the standard `ctx.connection` handle. It correlates bounded unary calls and receipts, opens only `mux` and Host lifecycle frames upstream, and receives all stream data downlink-only. A stopping, restarting, or failed runtime generation rejects its pending unary calls and ends its streams without permanently closing the API client, leaving the shared `ConnectionController` to reopen both streams against the next ready generation.

## Model Experience

None, as the VS Code carrier transports existing messages but contributes no model context.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **One fragmented message per direction** — a second start or inline frame closes that decoder instead of queuing unbounded work.
- **Whole-frame memory remains bounded but not streaming** — a fragmented message reserves its declared byte length before receiving chunks; attachments share the logical RPC cap rather than a separate streaming route.
- **Installed-runtime IPC only** — the Host plugin requires a connected Node IPC channel; the extension launcher owns process discovery, startup buffering, and workspace lease handling.
