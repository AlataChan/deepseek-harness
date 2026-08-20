# Use Harness Client in VS Code

English | [中文](vscode.zh.md)

Harness Client for VS Code is a developer-preview workspace extension that runs the existing interactive Client inside a retained activity-bar view. The extension contains no Harness runtime: it launches a matching installed `@deepseek-ai/dsh` package with a real Node executable on the workspace extension host.

## Requirements

- VS Code 1.96 or newer on desktop, SSH Remote, or Dev Container; browser-based extension hosts are unsupported.
- Node.js `^22.19.0` or `>=24.0.0` on the workspace extension host.
- A matching installed or source-built `@deepseek-ai/dsh` runtime.
- A trusted workspace. The extension does not discover a runtime or capture editor context before trust is granted.

## Install the developer VSIX

The extension is not published under a project-owned Marketplace publisher yet. Build a local VSIX from this checkout:

```sh
pnpm install
pnpm run build
DSH_VSCODE_PUBLISHER=harness-client-local pnpm run package:vscode
code --install-extension .artifacts/vscode/harness-client.vsix
```

In PowerShell, set the packaging identity separately before running the final two commands:

```powershell
$env:DSH_VSCODE_PUBLISHER = "harness-client-local"
pnpm run package:vscode
code --install-extension .artifacts/vscode/harness-client.vsix
```

For the same source checkout, open VS Code Settings JSON and point the extension at the built application package:

```json
{
  "harnessClient.runtimePath": "/absolute/path/to/deepseek-harness/apps/cli"
}
```

For a published runtime, install the matching `@deepseek-ai/dsh` version globally and leave `harnessClient.runtimePath` empty so discovery can use `PATH`:

```sh
npm install --global @deepseek-ai/dsh
```

## Start a session

Open a trusted folder and select the Harness Client icon in the activity bar. A window with multiple workspace folders asks you to select one; changing it later restarts the companion and asks for confirmation when a turn is running.

Configure a model in **Settings → Models**, create a session, and send a prompt. The panel uses the same session, approval, question, tool, plan, goal, skill, and subagent behavior as the Web UI.

The command palette exposes localized Harness Client commands for focusing the panel, creating a session, adding editor context, selecting the workspace root, restarting the runtime, and showing runtime logs.

## Add editor context

Use **Add Selection to Prompt**, **Add Active File to Prompt**, or **Add Problems to Prompt** from the composer or command palette. Each action captures an immutable snapshot and adds a removable reference chip. The active-file capture includes unsaved edits, and diagnostics come only from the active file.

The extension never reads or attaches editor content implicitly. Captures are restricted to the selected workspace and bounded by `harnessClient.context.maxSelectionBytes`, `harnessClient.context.maxFileBytes`, and `harnessClient.context.maxDiagnostics`. Submitted snapshots become ordinary prompt text in the durable session log and are sent to the configured model provider under the same policy as other user messages.

Harness file locations inside the selected workspace open in VS Code. Missing targets, symbolic links, different remote authorities, and paths outside the selected workspace are refused instead of falling back to a desktop opener.

## Runtime discovery and remote use

`harnessClient.runtimePath` accepts an installed package root, package manifest, published JavaScript bin, or recognized npm/pnpm shim as a discovery clue. `harnessClient.nodePath` selects the real Node executable. On Windows, `.cmd` and `.ps1` files are never executed: the extension resolves the package-declared JavaScript companion and forks it directly with Node.

SSH Remote and Dev Container run the workspace extension, Node, and Harness companion in the remote environment beside the workspace files. Install the runtime and Node there, then set the two path overrides in that remote window if `PATH` discovery is insufficient. These two remote modes remain manual release checks in version one.

## Persistence and recovery

Hiding the activity-bar view preserves its Client tree, unsent draft, context chips, and companion. A window reload, extension-host restart, or view disposal loses unsent state, but durable sessions reconnect from the Harness log.

Use **Harness Client: Show Runtime Logs** for redacted lifecycle output and **Harness Client: Restart Runtime** after repairing a path or version problem. A version or carrier mismatch fails before the Client starts. `home-busy` means another VS Code companion may own the same Harness home; stop it or configure a separate `DSH_HOME`, then restart. Web and CLI processes do not participate in this lease, so stop them before a companion uses the same home. Concurrent writers sharing one home are unsupported.

An empty panel with no Harness runtime log means the Webview bootstrap did not run. Reinstall a VSIX that passes `pnpm run verify:vscode`, run **Developer: Reload Window**, and retry. If the panel remains empty, run **Developer: Toggle Developer Tools** and capture the first Webview console error.

Version one selects one workspace root, does not export session archives from the editor, and does not support browser extension hosts. Use the Web UI when session download is required.

## Marketplace release identity

The staged artifact already uses extension name `harness-client`, display name **Harness Client for VS Code**, the neutral terminal-chat icon, and the pre-release channel. Only the Marketplace publisher ID remains unresolved.

The release owner should create a neutral publisher it controls on the [Visual Studio Marketplace publisher management page](https://marketplace.visualstudio.com/manage/publishers/). The ID is unique and cannot be changed after creation, so do not use a DeepSeek AI identity without authorization. Then package and verify the artifact with that exact ID:

```sh
DSH_VSCODE_PUBLISHER=<publisher-id> pnpm run package:vscode
pnpm run verify:vscode
```

Keep version-one uploads on the pre-release channel. The [official VS Code publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) owns publisher authentication and Marketplace upload steps; do not commit credentials or publisher tokens.
