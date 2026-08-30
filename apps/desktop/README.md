# `@deepseek-ai/dsh-desktop`

Unsigned local Tauri 2 window that runs the existing browser Client against one Node companion. The Rust process discovers a real Node executable, runs the bundled installed-runtime CLI, spawns `dsh.companions.desktop`, and relays bounded carrier records. The WebView bootstrap owns `control/hello`, caches announced Client bundles, then mounts the Client tree. The companion boots `desktop = dsh-base + dsh-web-app + dsh-desktop-app`. The Host keeps a loopback webserver (`127.0.0.1`, port `0`); stdio carries handshake, bundle cache, and the `__DSH_TRANSPORT__` tunnel.

## Toolchain

Recorded while implementing this tree:

- Rust stable `1.97.0` through rustup
- `cargo` `1.97.0`
- `tauri-cli` `2.11.4` (`cargo install tauri-cli --version '^2'`)
- Node.js `^22.19.0` or `>=24.0.0`

## Requirements

- A matching installed or source-built `@deepseek-ai/dsh` runtime on the same machine.
- A real `node` executable. The application does not bundle Node, native modules, or a Harness copy.
- macOS for the shipped local `.app`. Continuous integration compiles the crate on Linux and macOS and `cargo check`s Windows; those extra targets are not released.

## Build and run

From the repository root:

```sh
pnpm install
pnpm run build:desktop:frontend
pnpm run verify:desktop
pnpm run build:desktop
```

`build:desktop:frontend` builds Host libraries and the WebView assets. `verify:desktop` rejects `eval(`, `new Function(`, and remaining `process` access in those assets. `build:desktop` then runs `cargo tauri build`. The first window is the product home. An empty workspace root becomes the user home directory. A binary that still lives in this checkout uses `apps/cli` instead of a `PATH` `dsh` that may lack the desktop companion. Settings stores those values in `$configDir/runtime-config.json`. Changing a live workspace root reloads the WebView so the next page load performs exactly one `carrier_open`.

Assembled tests that drive the Rust relay need `pnpm run build:desktop:test-deps` (or the spec `beforeAll`) so `apps/cli/lib/desktop-companion.js` and `carrier-harness` exist.

## Known Limitations and Deferred Work

- **Unsigned local macOS build only** — no signed installer, notarization, updater, or public download.
- **Preinstalled runtime required** — resolution fails until a real Node executable and an accepted Harness package are configured.
- **Launch-time workspace only** — Client directory-picker rows do not change `--workspace-root`.
- **One window** — no multi-window, tray, deep links, native dialogs, or editor context.
- **Shared home lease** — a second companion against the same `$DSH_HOME` fails with `home-busy`.
