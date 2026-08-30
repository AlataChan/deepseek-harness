# `@deepseek-ai/dsh-desktop-app`

English | [中文](README.zh.md)

The desktop surface bundle over [`dsh-web-app`](../web-app/README.md). It keeps the web Host (Typert remotes, Connection, loopback webserver) so Client modules can compose a boot graph, disables `web-startup` so `--workspace-root` is the only accepted argument, and publishes `webStartup` from `desktop-startup` (`127.0.0.1`, port `0`, no browser). The WebView installs `__DSH_TRANSPORT__` and the official `client-connection` plugin consumes it. `connection-desktop` is Host-only.

[`src/startup.ts`](src/startup.ts) owns the companion's only argument, `--workspace-root <path>`. The value must be absolute and is provided as `ctx.desktopStartup`; the runtime and carrier rows inject that service before reading it. The Tauri shell owns process discovery, the exclusive home lease, and the published companion entry.

## Model Experience

### Desktop surface context

#### What the model sees

When `surfaceContext` is true, the `harness:source` section identifies the Harness implementation checkout and the `app:desktop-surface` section identifies the dsh desktop application, the selected workspace root, and the instruction to open requested files through the Host platform opener. When `surfaceContext` is false, neither section is registered.

#### Token effect

One source line and one short surface-orientation paragraph per session; constant for the companion process.

#### KV Cache effect

Both sections sit near the system prompt's head and use the immutable startup workspace, so they remain stable across turns.

## Known Limitations and Deferred Work

- **Launch-time workspace only** — changing the root reloads the WebView; Client directory-picker rows do not change `--workspace-root`.
- **One window** — no multi-window, tray, deep links, native dialogs, or editor context.
