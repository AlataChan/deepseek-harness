# Agent Note: octopus_DSH desktop rides the web-app Host

Status: implemented

English | [中文](2026-08-30-desktop-web-app-host-carrier.zh.md)

## Problem

octopus_DSH is a Tauri 2 shell plus a Node companion. Upstream 0.1.2 deleted `dsh-host-apiproxy` and `dsh-client-runtime`: Host API is Typert `@Remote` on session/settings/workspace controllers, Client boot is a `WebBootGraph` consumed by official `client-connection`, and `__ModuleLoader__` arrives from `bootInjections()`. A desktop Host that still spoke ApiProxy unary RPC, or a WebView that still called `bundleRecords()` / `configureContext()`, cannot boot that Client.

## Decision

The companion boots the web-app Host. `PROFILE_TEMPLATES.desktop` is `base + web-app + desktop-app`. [`dsh-desktop-app`](../../../../packages/bundle/desktop-app/README.md) disables `web-startup` so commander accepts only `--workspace-root`, and `desktop-startup` provides both `desktopStartup` and `webStartup` (`127.0.0.1`, port `0`, `openBrowser: false`, empty `trustedHosts`) so `webserver`, `web-runtime`, and Connection still resolve. `web-runtime` is overridden to `openBrowser: false` and `printUrl: false`. `connection-desktop` is Host-only: it re-exports process-carrier `apply` and must not publish a second `dsh.client` face. The WebView sets `globalThis.__DSH_TRANSPORT__` (`fetch`, `openStream`, `loadBundle`, `ownsHost: true`) before `AppWebEntry.run()`; official `client-connection` consumes that object.

The process carrier is protocol version 2. Unary traffic is `rpc/message` carrying `client-request` | `server-response`. Streams are `stream/open { streamId, endpoint, payload }`, `stream/frame { value }`, plus opened/close/end/error. There is no `rpc/receipt`, no `client-response`, and no `mux|host` stream tag. `control/ready.graph` is a complete `WebBootGraph` (`rev`, `entries`, `batches`). The Host announces each entry through `clientPath(id)`. Bootstrap installs the same queue facade `bootInjections()` would, flattens combo batches into per-entry cached `convertFileSrc` URLs, preloads only `@deepseek-ai/dsh-client-modules`, then runs the official web entry.

Fork overlays stay seeded. Official `desktop-app` `cordis.patch.yml` does not name [`dsh-experimental-desktop-files`](../../../../packages/experimental/desktop-files/README.md). File listing is official `session.listEntries`; the overlay is only the Provider and the `sidebar.files` occupant. See [the file-workbench note](../feature/2026-08-28-desktop-file-workbench.md).

## Alternatives considered

**Keep a private ApiProxy Host and a desktop-owned Client runtime.** Rejected: 0.1.2 Client modules require Typert remotes, `WebBootGraph` batches, and `__DSH_TRANSPORT__`. Rebuilding those three faces would fork the entire GUI stack.

**Reuse `web-startup` and add `--workspace-root` to its commander grammar.** Rejected: web-startup already owns a closed flag family; extending it would make the desktop companion accept web-only flags and would still leave `openBrowser` / printed URLs on unless every web-runtime key is overridden anyway.

**Publish `webStartup` by renaming the desktop-startup row.** Rejected: Cordis `name` is a patch guard. A name mismatch skips the row. `ctx.provide('webStartup', …)` from desktop-startup is the service the later web rows wait on; insert order does not have to place desktop-startup before `webserver`.

**Keep protocol version 1 (receipts, `client-response`, `mux|host`).** Rejected: 0.1.2 `RpcMessage` is only `client-request` | `server-response`, and Typert streams are endpoint-addressed, not mux-tagged.

**Put a `dsh.client` face on `connection-desktop`.** Rejected: official `client-connection` already consumes `__DSH_TRANSPORT__`. A second client plugin would double-bind the same services. Packages under `packages/client/*` without `dsh.client` must use `staticLinked`; the browser face is only `ProcessTransport`.

## Consequences

A packaged companion listens on loopback `127.0.0.1:0` because it is a web-app Host. Stdio remains the WebView carrier; the window never talks HTTP to that port. `scripts/desktop-profile-plugins.json` `shippedBundles` must stay `base + web-app + desktop-app`. `verify-desktop-bundle.sh` refuses a DMG whose generated `session-controller` remote face lacks `listEntries`. Changing a `@Remote` method requires rebuilding that Typert face before packaging. Course and 问数 overlays remain seed-only; they are not written into official `desktop-app` composition.

## Testing

Package tests pin the desktop profile template, the desktop-app patch (disabled web-startup, dual startup services, Host-only carrier), protocol v2 codec/gateway, WebView bootstrap (transport install, flattened graph, modules-only preload), sidebar `sidebar.files` occupancy, and `session.listEntries` mapping. `apps/cli/tests/desktop-companion.spec.ts` boots the source companion over stdio. `apps/desktop/tests/assembled-handshake.spec.ts` drives the built companion through the Rust `carrier-harness`.
