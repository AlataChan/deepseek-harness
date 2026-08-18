# @deepseek-ai/dsh-client-connection-vscode

English | [中文](README.zh.md)

Bounded carrier shared by the dsh companion process, VS Code extension host, and embedded Webview. The protocol keeps API Proxy RPC validation authoritative, preserves the existing `events.mux` resume payload, and restricts the host stream to an empty open payload. Its wire codec serializes each logical frame once, sends physical records sequentially for backpressure, admits one fragmented message per direction, verifies declared length and SHA-256 before parsing, and closes a decoder after any violation. Physical records default to 256 KiB; control messages default to 1 MiB; RPC and stream-data frames reuse the browser connection package's 160 MiB request capacity so the default 100 MiB aggregate image allowance remains usable.

The package exposes browser-safe `protocol` and `codec` entry points. The root plugin, Node IPC adapter, Webview port, and client controller are added by the later VS Code runtime tasks; the codec itself owns no process or Webview lifecycle.

## Model Experience

None, as the VS Code carrier transports existing messages but contributes no model context.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **One fragmented message per direction** — a second start or inline frame closes that decoder instead of queuing unbounded work.
- **Whole-frame memory remains bounded but not streaming** — a fragmented message reserves its declared byte length before receiving chunks; attachments share the logical RPC cap rather than a separate streaming route.
