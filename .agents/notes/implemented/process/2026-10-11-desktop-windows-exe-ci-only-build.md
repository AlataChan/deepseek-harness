# Agent Note: build the Windows desktop installer on a CI-only Windows runner

Status: implemented

English | [中文](2026-10-11-desktop-windows-exe-ci-only-build.zh.md)

## Problem

The product shipped one self-contained installer: the macOS DMG built by `scripts/build-dmg.sh` and gated by `scripts/verify-desktop-bundle.sh`. Nothing in the application blocked Windows parity — the Tauri shell already resolves `resource_dir()/resources/{node.exe,harness/,profile-plugins/,bundled-skills/,presets/,kb-runtime/,installed-runtime-cli.js}` and rejects `.cmd`/`.ps1` Node shims — but no Windows artifact existed, and the crate had never been compiled for Windows in this repository.

Neither cross-compilation path exists. Tauri needs the MSVC toolchain, WebView2, and NSIS to produce a Windows bundle, and PyInstaller cannot freeze the ask-knowledge sidecar for another operating system. A macOS workstation therefore cannot produce the artifact at all, which makes the build host part of the design rather than an implementation detail.

## Decision

### Build host

`.github/workflows/desktop-windows.yml` runs on GitHub-hosted `windows-2025`, manual dispatch only, with `timeout-minutes: 60` and `permissions: contents: read`. It checks out without persisted credentials, installs pnpm with the native Windows destination, Node 24, Rust stable, and Python 3.12, then runs `pnpm install` (the ReFS block-clone branch from `ci.yml`), `pnpm run build`, `node scripts/build-exe.mjs`, a silent NSIS install into the runner temp, `node scripts/verify-desktop-exe.mjs` against the installed tree, and the `dist/octopus_DSH_Setup.exe` artifact upload. No green gate, no artifact.

### Windows build script

`scripts/build-exe.mjs` mirrors `scripts/build-dmg.sh` phase for phase: preflight (Windows platform, pnpm, cargo/rustc, Python unless `--skip-kb`, the pinned `pnpm dlx @tauri-apps/cli@2.11.4`, and the built workspace libs) → compile `dsh-desktop` in release mode before payload assembly so a Rust error surfaces in minutes → download `node-v24.14.0-win-x64.zip`, verify its SHA-256 against that release's `SHASUMS256.txt`, and extract with the System32 `tar.exe` (bsdtar reads zip; Node 24 has no built-in unzip) → `scripts/collect-runtime-deps.mjs` → seed profile plugins and bundled skills → record the seeded trees' content revision through `scripts/write-seed-rev.mjs` → freeze the KB sidecar unless `--skip-kb` → stage presets → bundle with `pnpm dlx @tauri-apps/cli@2.11.4 build --bundles nsis` → copy the installer to `dist/octopus_DSH_Setup.exe`. On Tauri CLI failure the message names the cargo fallback (`cargo install --locked tauri-cli@2.11.4`, then `cargo tauri build --bundles nsis`).

`tauri-build` resolves the merged platform config's resource paths during compilation, so the fail-fast compile cannot see missing resources; the compile step first creates each `bundle.resources` entry of `tauri.windows.conf.json` as an empty file or directory placeholder, every staging phase overwrites its placeholder, and the payload check refuses a file that is still empty, an empty seed directory, and a `resources/seed-rev.txt` that is missing or not 64 lowercase hex characters.

### Installer configuration

Payload staging lives in `apps/desktop/src-tauri/resources/`, the directory `build.rs` already writes `installed-runtime-cli.js` into. `apps/desktop/src-tauri/tauri.windows.conf.json` sets `targets: ["nsis"]`, `icon.ico`, and the list form of `bundle.resources` naming every staged entry; JSON-level platform merging replaces the base array. `resources/presets/` is always created so the entry resolves even in a build without presets. `webviewInstallMode` stays unset (the default `downloadBootstrapper` matches the product's size sensitivity), and the installer is unsigned.

### Sidecar, dependency farm, and slim mode

`scripts/build-kb-sidecar.mjs` is the platform-aware port of `scripts/build-kb-sidecar.sh`, which stays the macOS entry: venv layout per platform, `--add-data` separator `;` on Windows, `.exe` output name, the same eight self-test flags, and pip and PyInstaller pinned in the script. `scripts/collect-runtime-deps.mjs` compares copied paths with `path.relative`/`path.sep`, because its previous literal `/` prefix check silently skipped nothing on Windows and leaked nested store trees into the farm.

`--presets <dir>` copies each preset subdirectory into the installer; `--presets none` and the default print a warning and ship without presets, because the `env-ngo-project-assistant` source lives outside this repository. `--skip-kb` produces a slim installer whose gate pass criteria exclude the sidecar checks and the ask-knowledge pin in the lifecycle smoke.

### Windows readiness gate

`scripts/verify-desktop-exe.mjs` runs against the installed tree: the shell binary and resource skeleton, `node.exe --version`, the harness manifest and companion module graph, a pinned-overlay companion lifecycle, symlink and build-machine-path leaks, bundled plugins and skills, and the KB sidecar self-test plus its relocation rerun. `scripts/smoke-companion-lifecycle.mjs` gained layout detection (`Contents/Resources` versus an install root), the platform Node binary name, `os.homedir()`, and `path.isAbsolute` so both gates share one smoke; `scripts/build-dmg.sh` and `scripts/verify-desktop-bundle.sh` are untouched.

`scripts/verify-desktop-exe.spec.ts` parses the two shell scripts and asserts the values the `.mjs` builds duplicate: `NODE_VERSION`, the eight sidecar self-test flags, and the `--collect-all`/`--hidden-import` sets. It exists because the repository linter ignores `.mjs` files.

## Verification

| Coverage | Location |
|---|---|
| `NODE_VERSION`, sidecar self-test flags, and PyInstaller flag sets stay equal to the macOS scripts | `scripts/verify-desktop-exe.spec.ts` |
| Installed-tree readiness: skeleton, embedded Node, harness manifest, module graph, pinned-overlay lifecycle, leaks, plugins/skills, sidecar self-test, relocation | `scripts/verify-desktop-exe.mjs`, run by the workflow between the silent install and the artifact upload |
| The macOS bundle path is unchanged | `scripts/verify-desktop-bundle.sh` against the built `.app`, which exercises the shared smoke script's macOS branch |

Tests need no API key and make no model calls. The workflow itself is the packaging gate.

## Alternatives considered

**Build on a local Windows machine.** The owner would run the build by hand and hold the entire verification burden; rejected because the same agent must build and self-verify the artifact, which only the CI runner path provides.

**Cross-compile from macOS.** Tauri has no supported macOS-to-Windows cross-compilation (MSVC, WebView2, NSIS), and PyInstaller cannot cross-compile the sidecar. Rejected as impossible.

**Commit the `env-ngo-project-assistant` preset to this public repository so both builds ship it.** The owner chose to ship the EXE without presets in v1; `--presets` keeps the capability available without committing the content.

**Use the map form of `bundle.resources` with staging outside `src-tauri`.** The list form with staging under `src-tauri/resources/` is simpler and keeps every path relative to the config file. The map form remains the documented fallback if CI shows the list form misbehaves.

**Target MSI instead of NSIS.** MSI is out of scope; NSIS is Tauri's default Windows bundle and its `/S /D=` silent install is what the CI gate needs.

## Consequences

- The installer is unsigned, so SmartScreen may show "Windows protected your PC" until code signing enters scope; the build script prints the same class of note the DMG script prints for Gatekeeper.
- The first Windows compile of the crate is a priced risk; the build orders the compile before the expensive payload steps and the gate before the upload, so a failure costs one clean run rather than a bad artifact.
- The two sidecar freeze scripts and the Node version now duplicate facts across a shell script and a Node script; `scripts/verify-desktop-exe.spec.ts` is the mechanical guard, and the macOS scripts remain the macOS entry.
- Windows users get the same feature set as the DMG except bundled presets, which ship only when the preset is committed or passed with `--presets`.
- The macOS pipeline keeps its behavior; the only shared edit is the smoke script's platform-aware layout detection.
