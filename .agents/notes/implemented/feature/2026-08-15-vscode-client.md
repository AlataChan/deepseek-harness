# Agent Note: VS Code client surface

Status: implemented

English | [中文](2026-08-15-vscode-client.zh.md)

## Problem

DeepSeek Harness has a complete interactive Web client, but editor users must leave their working context to use it. A VS Code client should reuse the existing session, agent, approval, question, tool, and Client Plugin behavior while adding editor-owned context capture and file navigation. Building a second conversation UI or routing the product through Agent Client Protocol (ACP) would duplicate product behavior and give an automation protocol responsibilities it does not own.

Before this change, the Web composition combined transport-neutral client behavior with HTTP, WebSocket, static-file, and browser features. Reusing that bundle inside VS Code would have started an unnecessary browser server and made the editor surface inherit Web-only assumptions. The client module registry similarly combined plugin discovery and graph construction with Web routes. The implementation separates those responsibilities so another interactive surface can consume them cleanly.

The editor extension introduces two additional trust boundaries. VS Code Webview messages are untrusted values, and the extension must launch an installed Harness runtime on POSIX and Windows without executing package-manager shell shims. Large attachment requests must continue to fit even though each physical IPC message stays tightly bounded. Multiple VS Code windows must not open the same non-multiprocess-safe Harness home concurrently.

## Decision

### Composition and shared client behavior

The interactive composition uses three bundles. `@deepseek-ai/dsh-client-app` owns ApiProxy, persistence and workspace support, the client module registry, the Client runtime, the shared `ui-*` roster, and per-session agent-preset composition. It owns no physical connection provider. `@deepseek-ai/dsh-web-app` is a thin Web surface containing HTTP, WebSocket, static frontend, browser export, adaptive Web directory selection, Web startup, and the Web client-module adapter. `@deepseek-ai/dsh-vscode-app` contains Node IPC, remote-safe directory selection, VS Code context UI, and VS Code startup behavior.

The shipped compositions are `web = base + client-app + web-app`, `vscode = base + client-app + vscode-app`, and `headless = base + headless`. A profile-equivalence test preserves the Web profile's ordered enabled rows and resolved configurations.

`@deepseek-ai/dsh-client-modules` is transport-neutral. Its Node face discovers `dsh.client` packages incrementally, resolves metadata and bundle paths, hashes bundles, constructs `ClientBootGraph`, and publishes graph and rebuild changes. Module dependencies constrain graph order, while Loader entry order breaks unrelated ties and orders the matching bundle records; asynchronous fiber activation cannot change a surface handshake. `@deepseek-ai/dsh-host-client-modules-web` owns `/plugins` serving and HTML manifest injection. `ClientBootEntry` and `ClientBootGraph` replace the former Web-specific names without compatibility aliases.

### Process and installed runtime

The VS Code extension runs as a workspace extension and owns one retained Webview plus one companion for the selected workspace folder. It resolves a real Node executable and a compatible installed `@deepseek-ai/dsh` package on the workspace extension host. `harnessClient.nodePath` and `harnessClient.runtimePath` are explicit overrides. A `dsh` candidate on `PATH`, including npm or pnpm `.cmd` and `.ps1` files, is only a discovery clue.

The resolver canonicalizes recognized links and package-manager shims, verifies the package name, reads the declared `dsh.companions.vscode` module, and rejects unknown shim formats. It launches that JavaScript entry with `child_process.fork` and the resolved Node executable, `shell: false`, separated arguments, and the built-in IPC channel. It never executes a `dsh`, `.cmd`, or `.ps1` shim and never uses numbered child file descriptors. A versioned handshake reports actionable errors for missing or incompatible Node, runtime, companion entry, or carrier versions. Windows is a version-one supported platform with an automated local-extension integration lane.

Version one requires the installed runtime and does not bundle Node, native modules, or Harness into the extension. SSH Remote and Dev Container are manual release checks; web extension hosts are unsupported. One selected workspace root is sufficient. Switching roots restarts the companion after confirmation when a turn is running.

### Bounded carrier

The companion exposes the existing ApiProxy and Typert Remote behavior over a versioned VS Code carrier. Its Host plugin publishes `ctx.connection` and routes `/api` requests through the shared Connection handler: the Typert gateway validates and dispatches claimed `namespace/method` endpoints before unclaimed requests and `ClientResponse` values fall back to `toFetchHandler(ctx.apiProxy)`. The carrier preserves endpoint path segments instead of encoding the slash into one segment. Mux and Host open payloads use ApiProxy-owned schemas. Server stream frames are downlink-only. The wrapper adds lifecycle and multiplexing but does not redefine Harness business methods.

The companion, extension host, and Webview share a browser-safe protocol package. Every Node IPC and `webview.postMessage` value begins as `unknown` and is parsed before routing. Physical wire records are capped at 256 KiB after serialization. A logical frame larger than one record is UTF-8 encoded once and sent as ordered base64 chunks with an exact byte count and SHA-256 digest. Only one fragmented message may be in flight per direction; interleaving, overflow, timeout, wrong order, wrong length, or wrong digest closes the bridge.

Control, stream-open, and editor messages have a 1 MiB logical limit. RPC and stream frames default to the existing 160 MiB request-body limit and reuse the aggregate image-capacity invariant. Senders apply backpressure before admitting another record, and pending RPC and editor request counts are independently bounded. This keeps control records small without rejecting legitimate attachment requests.

### Webview and editor integration

The existing Client Cordis tree runs inside the Webview. `AppWebEntry` receives a custom bundle loader: the extension copies the companion-announced bundles into a graph-revision cache after verifying identifiers and hashes, then exposes only that cache and fixed extension media through `webview.asWebviewUri`. The Webview installs the shared module registration facade and executes the module-system and runtime rows from that cache before constructing `AppWebEntry`. Its `configureContext` seam publishes the narrow carrier and IDE ports before any graph entry activates. Only the bootstrap calls `acquireVsCodeApi()`, once, and keeps the resulting object private behind those ports.

Client graph configs cross into the Webview as JSON and cannot carry Loader JavaScript expressions. The VS Code Vite build replaces the vendored Loader evaluator with an explicit refusal, while the VSIX verifier rejects Function constructors and direct `eval` in every Webview JavaScript asset. A VS Code Webview does not provide the Node `process` global, so the build substitutes a compile-time `process.env` object containing only the production marker and the verifier rejects every remaining `process` access. These checks preserve an eval-free content security policy and browser-only module initialization without weakening ordinary Loader activation.

Webview-to-extension messages are an allowlisted union of carrier records and typed editor requests, responses, and events. A named `IdeMethodMap` owns every editor payload and result schema. The Webview cannot send an arbitrary VS Code command. The extension intercepts only `host.openPath` and the VS Code availability fields of `host.describe`; every other Host request passes unchanged to the companion. File opening is restricted to the selected workspace, and outside paths are refused.

Editor context uses the existing `@` reference pipeline. `IConversation.appendReference` provides one narrow insertion method without exposing draft revisions or compare-and-swap details. A VS Code Client Plugin explicitly captures an immutable active selection, file, or diagnostics snapshot, displays it as a removable reference chip, and serializes the exact bounded snapshot into ordinary `session.prompt` text. Capture requires a user-visible action; the extension never silently reads or attaches the repository. Missing snapshots and serialization failures block submission.

### Lifecycle, trust, and persistence

The activity-bar view uses `retainContextWhenHidden: true`. Hiding it preserves the Client tree, draft, and reference chips and does not stop the companion. Version one does not persist unsent state across a window reload, extension-host restart, or view disposal; durable sessions reconnect from the Harness log.

The extension starts no runtime and captures no editor context until the workspace is trusted. Runtime paths are restricted settings. The Webview uses a strict content security policy, no inline script or `eval`, and minimal local resource roots. Runtime logs redact environment values and prompt contents. One extension-owned lifecycle disposes listeners, pending requests, stream pumps, watchers, caches, and the child process.

Before boot, the companion acquires an exclusive lease for the resolved `DSH_HOME`. A live or indeterminate owner fails closed with `home-busy`; a proven dead owner is archived before one retry. The owner token prevents one process from removing another process's lease. The lease is home-wide because current JSON and session stores do not support multiple writer processes. Separate Web or CLI runtimes sharing that home remain unsupported.

### Localization and distribution

VS Code manifest copy uses `package.nls.json` for English and `package.nls.zh-cn.json` for Chinese. Runtime extension strings use the VS Code localization API. Client Plugin copy keeps the repository's Chinese source dictionary and a key-complete English dictionary. The extension passes the normalized VS Code language through the handshake and Webview boot so the Client locale is selected before plugins mount unless a durable user preference overrides it.

The repository package remains `@deepseek-ai/dsh-vscode`, but release packaging generates a separate staged Marketplace manifest and VSIX. The staged artifact must not contain source maps, tests, workspace manifests, credentials, the Harness runtime, or unrelated packages. The Marketplace artifact uses extension name `harness-client`, display name **Harness Client for VS Code**, the neutral terminal-chat icon, and the pre-release channel. Publisher id remains `__PUBLISHER_ID__` until an authorized owner registers a neutral identity; release verification fails while that placeholder remains. This avoids claiming an identity that the contributor does not own.

## Alternatives considered

### A terminal UI first

A terminal UI would improve shell-only use, but it cannot reuse editor selection, diagnostics, URI handling, Remote Development placement, or VS Code file navigation. The existing Client Plugin UI also maps more directly to a Webview than to a second terminal renderer.

### ACP as the editor protocol

ACP is automation-only and does not own the full interactive Host API, Client Plugin graph, or presentation behavior. Reusing ApiProxy and session events preserves one authoritative product protocol.

### A localhost Web server inside the extension

Starting `dsh web` would add port selection, origin and authentication policy, and browser-only dependencies without product value. Direct Node IPC keeps the companion private to the extension host and works in remote workspace hosts.

### Inheriting Web composition and disabling rows

Negative composition would leave VS Code coupled to browser ownership and let future Web rows leak into the editor profile. Separate surface bundles make each dependency explicit.

### One large IPC frame limit

A control-sized cap would reject attachments, while an attachment-sized physical record would weaken memory bounds. Fragmenting bounded logical frames preserves both invariants.

### A general editor command tunnel

Passing arbitrary VS Code command identifiers would grant plugin code an open-ended authority channel. A closed, schema-owned editor method map keeps the extension surface reviewable.

## Verification

- The profile-equivalence test compares the Web profile's ordered rows and resolved configurations before and after the composition extraction.
- Resolver, process, carrier, shared `/api` interception, runtime-generation race, Webview, editor-context, path-opening, trust, lease, localization, and teardown tests cover the owned lifecycle and security rules.
- The keyless `vscode-agent` assembled snapshot boots the companion from source and built artifacts against one graph snapshot, fragments an image prompt with editor context, streams through ApiProxy, persists the exact text, and rejects a second home owner.
- The local Electron integration boots the staged extension, captures editor state, opens an in-workspace location, reconnects the runtime, and releases the companion lease.
- The VS Code workflow defines native local-extension lanes for Linux, macOS, and Windows; SSH Remote and Dev Container remain manual release checks.
- The packaging tests and VSIX verifier enforce the artifact allowlist, localization completeness, external companion declaration, 128-pixel PNG icon, pre-release metadata, resolved publisher identity, and Webview scripts without dynamic code or Node `process` access.

## Consequences

The installed runtime and extension can drift, so bridge and runtime compatibility must fail before the client graph boots. Retaining a Webview consumes memory while hidden, but it avoids losing unsent work; serialized drafts can replace this tradeoff later without changing the carrier. The bundle cache and fragmented-message assembler handle untrusted metadata and therefore require exact identifiers, hashes, destinations, ordering, and teardown tests. Remote filesystems and Windows shims differ from local POSIX development, so platform integration evidence is part of release readiness rather than an afterthought.
