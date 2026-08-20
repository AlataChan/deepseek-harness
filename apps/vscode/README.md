# `@deepseek-ai/dsh-vscode`

English | [中文](README.zh.md)

Workspace-extension shell for the Harness Client. The activity-bar `WebviewView` starts no companion until a trusted view resolves, selects one folder from the current VS Code window, and retains the live Client tree while hidden. View disposal and extension deactivation drain the companion; changing the selected root restarts it and asks before interrupting a running turn.

The composer menu and matching extension commands can explicitly attach the current non-empty selection, the active document including unsaved edits, or diagnostics for the active document. Every capture is restricted to the selected root and becomes an immutable reference chip; the extension never adds editor content implicitly.

Harness file-location actions stay on the existing `host.openPath` RPC. The extension opens files with VS Code, reveals directories in Explorer, and accepts an optional one-based `:line[:column]` or `#Lline[:column]` suffix. Filesystem paths and URIs must resolve inside the selected root with the same URI scheme and authority; symbolic links, missing targets, and outside-root targets return ordinary Host RPC failures and never fall back to a desktop opener. The forwarded `host.describe` response reports this VS Code opener through `canOpenPath`.

The extension uses an installed `@deepseek-ai/dsh` runtime on the workspace extension host. Discovery accepts a package root, package manifest, published JavaScript bin, or recognized npm/pnpm shim as a clue, then resolves the package-declared VS Code companion and a real Node executable. Launch uses direct `child_process.fork` with the IPC channel and never executes a shell shim. This keeps Local, SSH Remote, and Dev Container processes beside their workspace files. Web extension hosts are unsupported.

The companion handshake announces the Client Plugin graph and bundle hashes. The extension copies verified bytes into revision-scoped global storage, grants the Webview access only to that cache and fixed extension media, and boots the existing Client shell with a strict content security policy. The only `acquireVsCodeApi()` call remains private behind validated carrier and IDE ports. Companion generation changes end active Client streams without permanently closing the Webview API client, so the shared connection controller can reconnect durable sessions.

Workspace Trust blocks runtime discovery and execution. The executable-path settings are restricted in untrusted workspaces. Process output passes through bounded credential redaction; carrier records and editor snapshots have no logging API. The companion owns the exclusive Harness-home lease and reports `home-busy` when another process may be using the same durable store.

The [VS Code user guide](../../docs/user/guide/vscode.md) covers source installation, remote placement, context privacy, recovery, and current limitations.

## Configuration

- `harnessClient.runtimePath` overrides runtime discovery with an installed package location or recognized discovery clue.
- `harnessClient.nodePath` selects the real Node executable used for direct fork.
- `harnessClient.context.maxSelectionBytes` bounds UTF-8 text captured by **Add Selection**.
- `harnessClient.context.maxFileBytes` bounds UTF-8 text captured by **Add Active File** and the serialized **Add Problems** payload.
- `harnessClient.context.maxDiagnostics` bounds diagnostic records captured by **Add Problems**; diagnostics come from the active file only.
- `harnessClient.runtime.restartAttempts` and `harnessClient.runtime.shutdownTimeoutMs` bound automatic recovery and forced shutdown.

Run `pnpm --filter @deepseek-ai/dsh-vscode run build` to emit `dist/extension.js` and the Webview assets. [`manifest.vscode.json`](manifest.vscode.json) is the source manifest for staged extension packaging. It fixes the extension name as `harness-client`, display name as **Harness Client for VS Code**, icon as [`media/icon.png`](media/icon.png), and channel as pre-release; only the Marketplace publisher remains an explicit placeholder.

An authorized release owner creates a neutral publisher through the [official Marketplace flow](https://code.visualstudio.com/api/working-with-extensions/publishing-extension), then stages and verifies the VSIX with `DSH_VSCODE_PUBLISHER=<publisher-id> pnpm run package:vscode` and `pnpm run verify:vscode`. The verifier rejects the placeholder, bundled Harness or Node code, source maps, tests, credentials, missing locale resources, and undeclared files. Do not use a DeepSeek AI publisher identity without authorization.

## Model Experience

None. This shell selects a workspace and transports existing Client messages; model-visible VS Code surface orientation belongs to [`@deepseek-ai/dsh-vscode-app`](../../packages/bundle/vscode-app/README.md), and explicit editor snapshots belong to the context Client Plugin.

#### KV Cache effect

None; this package does not assemble provider requests.

## Known Limitations and Deferred Work

- Unsent drafts and context chips survive hide and reveal, but not a view disposal, window reload, or extension-host restart.
- SSH Remote and Dev Container are manual release checks; the automated integration lane covers the local extension host on each supported operating system.
- Session export remains a browser feature; file locations open in the editor instead.
