# Agent Note: VS Code client surface

Status: proposed

English | [中文](2026-08-15-vscode-client.zh.md)

## Problem

DeepSeek Harness has a complete interactive Web client, but editor users must leave their working context to use it. A VS Code client should reuse the existing session, agent, approval, question, tool, and Client Plugin behavior while adding editor-owned context capture and file navigation. Building a second conversation UI or routing the product through Agent Client Protocol (ACP) would duplicate product behavior and give an automation protocol responsibilities it does not own.

The current Web composition also combines transport-neutral client behavior with HTTP, WebSocket, static-file, and browser features. Reusing that bundle inside VS Code would start an unnecessary browser server and would make the editor surface inherit Web-only assumptions. The client module registry similarly combines plugin discovery and graph construction with Web routes. Those responsibilities must separate before another interactive surface can consume them cleanly.

The editor extension introduces two additional trust boundaries. VS Code Webview messages are untrusted values, and the extension must launch an installed Harness runtime on POSIX and Windows without executing package-manager shell shims. Large attachment requests must continue to fit even though each physical IPC message stays tightly bounded. Multiple VS Code windows must not open the same non-multiprocess-safe Harness home concurrently.

## Proposal

### Composition and shared client behavior

Split the interactive composition into three bundles. `@deepseek-ai/dsh-client-app` owns ApiProxy, persistence and workspace support, the client module registry, the Client runtime, the shared `ui-*` roster, and per-session agent-preset composition. It owns no physical connection provider. `@deepseek-ai/dsh-web-app` becomes a thin Web surface containing HTTP, WebSocket, static frontend, browser export, adaptive Web directory selection, Web startup, and the Web client-module adapter. `@deepseek-ai/dsh-vscode-app` contains Node IPC, remote-safe directory selection, VS Code context UI, and VS Code startup behavior.

The shipped compositions become `web = base + client-app + web-app`, `vscode = base + client-app + vscode-app`, and `headless = base + headless`. The extraction must preserve the Web profile's ordered enabled rows and resolved configurations before VS Code feature work proceeds.

Make `@deepseek-ai/dsh-client-modules` transport-neutral. Its Node face discovers `dsh.client` packages incrementally, resolves metadata and bundle paths, hashes bundles, constructs `ClientBootGraph`, and publishes graph and rebuild changes. A new `@deepseek-ai/dsh-host-client-modules-web` adapter owns `/plugins` serving and HTML manifest injection. `WebBootEntry` and `WebBootGraph` become `ClientBootEntry` and `ClientBootGraph` without compatibility aliases.

### Process and installed runtime

The VS Code extension runs as a workspace extension and owns one retained Webview plus one companion for the selected workspace folder. It resolves a real Node executable and a compatible installed `@deepseek-ai/dsh` package on the workspace extension host. `deepseekHarness.nodePath` and `deepseekHarness.runtimePath` are explicit overrides. A `dsh` candidate on `PATH`, including npm or pnpm `.cmd` and `.ps1` files, is only a discovery clue.

The resolver canonicalizes recognized links and package-manager shims, verifies the package name, reads the declared `dsh.companions.vscode` module, and rejects unknown shim formats. It launches that JavaScript entry with `child_process.fork` and the resolved Node executable, `shell: false`, separated arguments, and the built-in IPC channel. It never executes a `dsh`, `.cmd`, or `.ps1` shim and never uses numbered child file descriptors. A versioned handshake reports actionable errors for missing or incompatible Node, runtime, companion entry, or carrier versions. Windows is a version-one supported platform with an automated local-extension integration lane.

Version one requires the installed runtime and does not bundle Node, native modules, or Harness into the extension. SSH Remote and Dev Container are manual release checks; web extension hosts are unsupported. One selected workspace root is sufficient. Switching roots restarts the companion after confirmation when a turn is running.

### Bounded carrier

The companion exposes the existing ApiProxy message and stream behavior over a versioned VS Code carrier. `ClientRequest` and `ClientResponse` still pass through `toFetchHandler(ctx.apiProxy)`, so ApiProxy remains the validation and routing authority. Mux and Host open payloads use ApiProxy-owned schemas. Server stream frames are downlink-only. The wrapper adds lifecycle and multiplexing but does not redefine Harness business methods.

The companion, extension host, and Webview share a browser-safe protocol package. Every Node IPC and `webview.postMessage` value begins as `unknown` and is parsed before routing. Physical wire records are capped at 256 KiB after serialization. A logical frame larger than one record is UTF-8 encoded once and sent as ordered base64 chunks with an exact byte count and SHA-256 digest. Only one fragmented message may be in flight per direction; interleaving, overflow, timeout, wrong order, wrong length, or wrong digest closes the bridge.

Control, stream-open, and editor messages have a 1 MiB logical limit. RPC and stream frames default to the existing 160 MiB request-body limit and reuse the aggregate image-capacity invariant. Senders apply backpressure before admitting another record, and pending RPC and editor request counts are independently bounded. This keeps control records small without rejecting legitimate attachment requests.

### Webview and editor integration

The existing Client Cordis tree runs inside the Webview. `AppWebEntry` receives a custom bundle loader: the extension copies the companion-announced bundles into a graph-revision cache after verifying identifiers and hashes, then exposes only that cache and fixed extension media through `webview.asWebviewUri`. Only the bootstrap calls `acquireVsCodeApi()`, once, and keeps the resulting object private behind a narrow in-memory port.

Webview-to-extension messages are an allowlisted union of carrier records and typed editor requests, responses, and events. A named `IdeMethodMap` owns every editor payload and result schema. The Webview cannot send an arbitrary VS Code command. The extension intercepts only `host.openPath` and the VS Code availability fields of `host.describe`; every other Host request passes unchanged to the companion. File opening is restricted to the selected workspace, and outside paths are refused.

Editor context uses the existing `@` reference pipeline. `IConversation.appendReference` provides one narrow insertion method without exposing draft revisions or compare-and-swap details. A VS Code Client Plugin explicitly captures an immutable active selection, file, or diagnostics snapshot, displays it as a removable reference chip, and serializes the exact bounded snapshot into ordinary `session.prompt` text. Capture requires a user-visible action; the extension never silently reads or attaches the repository. Missing snapshots and serialization failures block submission.

### Lifecycle, trust, and persistence

The activity-bar view uses `retainContextWhenHidden: true`. Hiding it preserves the Client tree, draft, and reference chips and does not stop the companion. Version one does not persist unsent state across a window reload, extension-host restart, or view disposal; durable sessions reconnect from the Harness log.

The extension starts no runtime and captures no editor context until the workspace is trusted. Runtime paths are restricted settings. The Webview uses a strict content security policy, no inline script or `eval`, and minimal local resource roots. Runtime logs redact environment values and prompt contents. One extension-owned lifecycle disposes listeners, pending requests, stream pumps, watchers, caches, and the child process.

Before boot, the companion acquires an exclusive lease for the resolved `DSH_HOME`. A live or indeterminate owner fails closed with `home-busy`; a proven dead owner is archived before one retry. The owner token prevents one process from removing another process's lease. The lease is home-wide because current JSON and session stores do not support multiple writer processes. Separate Web or CLI runtimes sharing that home remain unsupported.

### Localization and distribution

VS Code manifest copy uses `package.nls.json` for English and `package.nls.zh-cn.json` for Chinese. Runtime extension strings use the VS Code localization API. Client Plugin copy keeps the repository's Chinese source dictionary and a key-complete English dictionary. The extension passes the normalized VS Code language through the handshake and Webview boot so the Client locale is selected before plugins mount unless a durable user preference overrides it.

The repository package remains `@deepseek-ai/dsh-vscode`, but release packaging generates a separate staged Marketplace manifest and VSIX. The staged artifact must not contain source maps, tests, workspace manifests, credentials, the Harness runtime, or unrelated packages. Publisher id, extension name and display name, icon, and release channel require an explicit project-owner decision; release verification fails while placeholders remain. This avoids claiming an identity that the contributor does not own.

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

## Acceptance criteria

- The Web profile is behaviorally unchanged after the composition and client-module extraction.
- A trusted local workspace on Linux, macOS, or Windows launches a resolved JavaScript companion with a real Node executable, no shell shim, no TCP listener, and a successful version handshake.
- The retained Webview boots the existing Client Plugin graph and preserves a draft and context chips across hide and reveal.
- Session operations, streaming, approvals, questions, tools, plan, goals, skills, and subagents continue through ApiProxy and session events; the extension executes no Harness tool itself.
- An explicitly captured editor snapshot is immutable, bounded, previewable, removable, and logged as the exact submitted user message; untrusted or missing context is refused.
- Tool locations inside the selected workspace open through VS Code, and outside-workspace paths are refused.
- Payloads larger than one physical record reassemble under verified bounds, and the configured aggregate image capacity remains valid.
- A second companion for the same Harness home receives `home-busy` before durable providers open, and extension shutdown leaves no orphan child.
- Chinese and English installations resolve all manifest, extension, and Client Plugin strings.
- The reproducible VSIX contains only declared extension artifacts and cannot pass release verification with an unresolved Marketplace identity.

## Risks

The installed runtime and extension can drift, so bridge and runtime compatibility must fail before the client graph boots. Retaining a Webview consumes memory while hidden, but it avoids losing unsent work; serialized drafts can replace this tradeoff later without changing the carrier. The bundle cache and fragmented-message assembler handle untrusted metadata and therefore require exact identifiers, hashes, destinations, ordering, and teardown tests. Remote filesystems and Windows shims differ from local POSIX development, so platform integration evidence is part of release readiness rather than an afterthought.
