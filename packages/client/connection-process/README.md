# `@deepseek-ai/dsh-client-connection-process`

Static process-carrier library shared by the VS Code and desktop surfaces. It owns the bounded wire protocol, codec, Node IPC channel, Host gateway, and the IDE-optional `ProcessApiClient`. It is not a `dsh.client` row; surface plugins inline the browser-safe face.

The Host `apply` mounts one companion gateway on a connected `NodeIpcPort`. The client face constructs `ProcessApiClient` with an optional `GenerationPort`. Desktop passes no generation port; VS Code wraps IDE `runtime.state` events.

## Model Experience

None, as the process carrier transports existing messages but contributes no model context.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **One fragmented message per direction** — a second start or inline frame closes that decoder instead of queuing unbounded work.
- **Whole-frame memory remains bounded but not streaming** — a fragmented message reserves its declared byte length before receiving chunks.
- **Installed-runtime IPC by default** — Host apply uses an injected port, else the current process channel. Desktop claims stdio before apply.
- **`session/finishAskKnowledgeIngest` waits 180s** — that unary runs sidecar convert, LLM propose, and apply.
- **`session/finishAskKnowledgeExtract` waits 90s** — that unary runs sidecar `convert-file` only. Other methods keep the 30s default.
