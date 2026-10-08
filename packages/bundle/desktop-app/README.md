---
description: "The desktop surface bundle over dsh-web-app: Typert remotes, a loopback web Host, and the companion's single --workspace-root argument."
kind: "package-bundle"
---

# `@deepseek-ai/dsh-desktop-app`

English | [中文](README.zh.md)

## Summary

`desktop-app` is the desktop surface bundle over `dsh-web-app`: it keeps the web Host for the Tauri WebView, disables `web-startup` and `client-hmr`, and publishes `webStartup` from `desktop-startup` on `127.0.0.1:0` without opening a browser. The companion accepts exactly one argument, `--workspace-root <path>`.

The desktop surface bundle over [`dsh-web-app`](../web-app/README.md). It keeps the web Host (Typert remotes, Connection, loopback webserver) so Client modules can compose a boot graph, disables `web-startup` so `--workspace-root` is the only accepted argument, and publishes `webStartup` from `desktop-startup` (`127.0.0.1`, port `0`, no browser). It disables `client-hmr` because the Tauri WebView rejects the web EventSource channel. The WebView installs `__DSH_TRANSPORT__` and the official `client-connection` plugin consumes it. `connection-desktop` is Host-only.

[`src/startup.ts`](src/startup.ts) owns the companion's only argument, `--workspace-root <path>`. The value must be absolute and is provided as `ctx.desktopStartup`; the runtime and carrier rows inject that service before reading it. The Tauri shell owns process discovery, the exclusive home lease, and the published companion entry.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="model-experience"></a>
## Model Experience

### Desktop surface context

#### What the model sees

When `surfaceContext` is true, the `harness:source` section identifies the Harness implementation checkout and the `app:desktop-surface` section identifies the dsh desktop application, the selected workspace root, and the instruction to open requested files through the Host platform opener. When `surfaceContext` is false, neither section is registered.

#### Token effect

One source line and one short surface-orientation paragraph per session; constant for the companion process.

#### KV Cache effect

Both sections sit near the system prompt's head and use the immutable startup workspace, so they remain stable across turns.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Launch-time workspace only** — changing the root reloads the WebView; Client directory-picker rows do not change `--workspace-root`.
- **One window** — no multi-window, tray, deep links, native dialogs, or editor context.

<a id="dev-note"></a>
## Dev Note

This bundle is the only supported launch composition for the desktop companion: `--workspace-root` must stay absolute and is provided as `ctx.desktopStartup`, and the runtime and carrier rows inject that service before reading it. Keep `web-startup` disabled (`--workspace-root` is the sole argument) and `client-hmr` disabled (the Tauri WebView rejects the web EventSource channel); `surfaceContext: true` adds the two head-of-prompt sections.
