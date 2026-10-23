---
description: "Static process-carrier library shared by the VS Code and desktop surfaces: bounded wire protocol, codec, Node IPC channel, and Host gateway."
kind: "package-reference"
---

# `@deepseek-ai/dsh-client-connection-process`

## Summary

`connection-process` is the static process-carrier library shared by the VS Code and desktop surfaces: it owns the bounded wire protocol, codec, Node IPC channel, the Host gateway, and the IDE-optional `ProcessApiClient`. Surfaces inline the browser-safe face; it is not a `dsh.client` row. The Host `apply` mounts one companion gateway on a connected `NodeIpcPort`; desktop passes no generation port, while VS Code wraps IDE `runtime.state` events.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

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

### Dev Note

One fragmented message per direction is the decoder's ceiling: a second start or inline frame closes that decoder instead of queuing unbounded work, and a fragment reserves its declared byte length before receiving chunks. Host apply uses an injected `NodeIpcPort`, else the current process channel; the carrier owns the unary deadlines (`finishAskKnowledgeIngest` 180s, `finishAskKnowledgeExtract` 90s, otherwise 30s).

The carrier preserves the optional Host release identity in the ready graph. Its version describes the Harness runtime, not the desktop shell. Legacy peers may omit it; the module loader refuses transitions between missing and present identities until the page reloads.

After the handshake, graph changes produce further complete `control/ready` snapshots with bundle paths and SHA-256 digests. The Host serializes snapshot publication and detaches its subscription before shutdown. The desktop caches newly announced artifacts in the current carrier's asset generation before passing the graph to the Client entry reconciler; it does not require the Web SSE transport. The RPC transport leaves snapshots to that surface owner and keeps pending unary calls and streams alive.
