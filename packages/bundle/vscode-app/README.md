# `@deepseek-ai/dsh-vscode-app`

English | [中文](README.zh.md)

The VS Code surface bundle over [`dsh-client-app`](../client-app/README.md). Its [`cordis.patch.yml`](cordis.patch.yml) keeps the shared interactive Host and complete `ui-*` roster, sets the API gateway's `nativeOpen` capability to false, mounts the remote-safe browse directory picker, parses the extension-selected workspace root, registers VS Code surface context, mounts the [`connection-vscode`](../../client/connection-vscode/README.md) process-IPC carrier, and adds the [`ui-vscode`](../../client/ui-vscode/README.md) editor-context controls. It intentionally mounts no HTTP server, static frontend adapter, Web connection, client-plugin HMR, native Host directory picker, or browser Session download action.

[`src/startup.ts`](src/startup.ts) owns the companion's only argument, `--workspace-root <path>`. The value must be absolute and is provided as `ctx.vscodeStartup`; the runtime and carrier rows inject that service before reading it. The installed `@deepseek-ai/dsh` application owns process discovery, the exclusive home lease, and the published companion entry.

## Model Experience

### VS Code surface context

#### What the model sees

When `surfaceContext` is true, the `harness:source` section identifies the Harness implementation checkout and the `app:vscode-surface` section identifies Visual Studio Code, the selected workspace root, the meaning of editor-related references, and the absence of implicit selection, open-document, diagnostic, or unsaved-text context. It directs file-opening requests back to the existing editor. When `surfaceContext` is false, neither section is registered.

#### Token effect

One source line and one short surface-orientation paragraph per session; constant for the companion process.

#### KV Cache effect

Both sections sit near the system prompt's head and use the immutable startup workspace, so they remain stable across turns.

## Known Limitations and Deferred Work

- **One selected workspace root** — changing the root requires restarting the companion; multi-root aggregation is not implemented.
- **No browser-only integrations** — Session archive download, native Host folder dialogs, and Web HMR remain outside this surface.
