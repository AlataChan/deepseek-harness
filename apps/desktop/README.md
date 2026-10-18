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
- Development uses a real `node` executable; distributable DMG and Windows EXE installers bundle Node and the matching Harness runtime.
- macOS builds `.app` and `.dmg` through `scripts/build-dmg.sh`; `.github/workflows/desktop-windows.yml` builds the Windows NSIS `.exe` through `scripts/build-exe.mjs`. Both formats use the same desktop plugins. Windows readiness includes installed-runtime resolution and companion handshake through the Rust shell with canonical Windows paths, then waits for companion shutdown before deleting the test workspace.

## Build and run

From the repository root:

```sh
pnpm install
pnpm run build:desktop:frontend
pnpm run verify:desktop
pnpm run build:desktop
```

`build:desktop:frontend` builds Host libraries and the WebView assets. `verify:desktop` rejects `eval(`, `new Function(`, and remaining `process` access in those assets. `build:desktop` then runs `cargo tauri build`. The first window is the product home. An empty workspace root becomes the user home directory. A binary that still lives in this checkout uses `apps/cli` instead of a `PATH` `dsh` that may lack the desktop companion. Settings stores those values in `$configDir/runtime-config.json`. Changing a live workspace root reloads the WebView so the next page load performs exactly one `carrier_open`.

Assembled tests that drive the Rust relay need `pnpm run build:desktop:test-deps` (or the spec `beforeAll`) so `apps/cli/lib/desktop-companion.js` and `carrier-harness` exist. The harness-only `carrier_close` command runs the production shutdown flow, including closing the companion's input pipe; harness EOF also stops its owned companion.

Release window binaries require Tauri's production asset protocol. Use `cargo tauri build`; a plain `cargo build --release` is rejected because it selects the development URL instead of the packaged frontend.

Cached Client script URLs encode the entire absolute path and use the platform's asset protocol, so loading is independent of the application's working directory.

## Launch behavior

The window paints a shell-owned status line from the static `index.html` markup before any bundle runs, un-hides a first-start hint after 20 seconds, and replaces both with the failure reason when the boot rejects. The WebView waits up to 120 s for `control/ready` (`DEFAULT_HANDSHAKE_TIMEOUT_MS`); a timeout reports a failed connection, it does not bound a healthy boot.

On launch the shell copies `resources/profile-plugins/` into `$DSH_HOME/profiles/desktop/node_modules/` and `resources/bundled-skills/` into `$DSH_HOME/skills/`. The packaging scripts hash both trees into `resources/seed-rev.txt` (`scripts/write-seed-rev.mjs`); a completed copy stamps the installed tree with `.dsh-seed-rev`, and the next launch skips that copy while the revision matches and the installed tree stays complete — a parseable profile manifest listing every bundled package, each of those packages installed under `node_modules/`, both profile template files, and every skill's `SKILL.md`. Any payload change, including a same-version rebuild, changes the revision and forces a copy. Each launch appends its seed decision to `companion.log` under the app-data directory.

On Windows every child process is spawned with `CREATE_NO_WINDOW` because the desktop window is a GUI process with no console of its own, so Windows would otherwise open a console window whose closure terminates the child mid-session.

## Known Limitations and Deferred Work

- **Unsigned installers** — no signing, notarization, updater, or public download.
- **Source development requires a runtime** — distributable installers carry Node and Harness; source builds use the checkout runtime.
- **Launch-time workspace only** — Client directory-picker rows do not change `--workspace-root`.
- **One window** — no multi-window, tray, deep links, native dialogs, or editor context.
- **Shared home lease** — a second companion against the same `$DSH_HOME` fails with `home-busy`.

The pre-boot runtime-version check detects inconsistent installations. The boot graph additionally carries the Host runtime release, preserved when script URLs move into the local cache. A graph with a different runtime version is refused before any factory loads. After boot, the shared module system refuses graph updates from another release and offers a localized reload prompt; deferring preserves the running page and sessions. The shell version remains independent.
