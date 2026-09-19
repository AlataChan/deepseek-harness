# Agent Note: Restore a hollow octopus_DSH .app skeleton before signing

Status: implemented

English | [中文](2026-09-18-desktop-bundle-skeleton-restore.zh.md)

## Problem

`build-dmg.sh` treated any existing `octopus_DSH.app` directory as a Tauri bundle. A Contents tree can hold `Info.plist` and `Resources` after a partial `tauri build` or a later loss of `Contents/MacOS`, while `CFBundleExecutable` still names `dsh-desktop` and `CFBundleIconFile` still names `icon.icns`. Embedding Node, harness, plugins, and kb-runtime then runs for a long time, after which `verify-desktop-bundle.sh` records `FAIL` for a missing executable and a missing nested `installed-runtime-cli.js` and refuses the DMG. The window cannot launch without `Contents/MacOS/dsh-desktop`. Finder and the Dock show a generic icon without `Contents/Resources/icon.icns`. The Host already accepts a flat or nested CLI; the readiness check only accepts `Contents/Resources/resources/installed-runtime-cli.js`. A workspace pin copy that includes `motion/` and `src/` also inflates the DMG and can leave a live profile copy without `package.json` when first-launch recopy is interrupted.

## Decision

`build-dmg.sh` restores the skeleton files before it embeds anything. When `Contents/MacOS/dsh-desktop` is not executable, it copies `apps/desktop/src-tauri/target/release/dsh-desktop` into that path and sets the executable bit. When that cargo binary is also missing, the script exits. When the nested CLI is missing, it copies the first file that exists among the flat Tauri resource, `apps/desktop/src-tauri/resources/installed-runtime-cli.js`, and `packages/boot/installed-runtime/lib/cli.js`. When `Contents/Resources/icon.icns` is missing, it copies `apps/desktop/src-tauri/icons/icon.icns`. Official `apps/desktop` product code stays unchanged. `seed-desktop-profile-plugin.mjs` copies `lib/`, `media/`, patches, and samples, and omits `src/`, `tests/`, `motion/`, and `node_modules/.bin`. Staged npm installs used to leave `.bin` stubs pointing at the deleted `dsh-seed-deps-` tempdir; first-launch `copy_dir_recursive` then failed and left `~/.dsh/profiles/desktop` without `package.json`. `verify-desktop-bundle.sh` still requires `-x` on the MacOS binary and `-f` on the nested CLI and `icon.icns`, refuses a Hero pin that still contains `motion/`, and distinguishes a non-executable binary from a missing one and a flat CLI from an absent CLI.

## Alternatives considered

**Fail immediately and tell the operator to rerun `cargo tauri build`.** Rejected when the cargo release binary is already on disk: that file is the same executable the bundler would copy, and a full Tauri rebuild is tens of minutes after a hollow `.app` has already been assembled around it.

**Teach the readiness check to accept a flat CLI only.** Rejected: the Host already accepts both paths; the gate's job is to keep the nested copy that `build-dmg.sh` owns, not to paper over a missing embed.

**Change official `tauri.conf.json` or `build.rs`.** Rejected: course and overlay packaging must not change official desktop product logic; the hollow skeleton is a packaging-script failure.

## Consequences

A hollow `.app` that still has a cargo release binary and the checkout icon becomes a signed bundle with its Dock icon instead of a readiness `FAIL` after a long embed. A machine that has no `target/release/dsh-desktop` still fails before embed. First-launch recopy no longer writes 100MB of oil-motion frames into `~/.dsh`. The readiness gate remains the last word on whether a DMG is written.

## Testing

Verification is `pnpm exec vitest run scripts/seed-desktop-profile-plugin.spec.ts` for the payload filter, `bash scripts/verify-desktop-bundle.sh` against the restored `octopus_DSH.app`, then the DMG step in `scripts/build-dmg.sh`. There is no unit fixture for a hollow `.app`.
