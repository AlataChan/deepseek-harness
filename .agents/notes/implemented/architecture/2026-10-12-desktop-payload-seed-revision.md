# Agent Note: skip the desktop payload reseed while the bundled revision is unchanged

Status: implemented

English | [中文](2026-10-12-desktop-payload-seed-revision.zh.md)

## Problem

Every desktop launch deleted and re-copied `resources/profile-plugins/` into `$DSH_HOME/profiles/desktop/node_modules/` and `resources/bundled-skills/` into `$DSH_HOME/skills/`. The shipped payload is 12,981 files / 172 MB; on Windows that copy is the largest avoidable cost before the companion boots, and it rewrites the module files the companion loads immediately afterwards, so a warm file cache buys nothing. The WebView's 15 s handshake deadline then expired during a boot the copy had made cold, and the home page reported `desktop companion handshake timed out`.

The copy exists for upgrades — a newer installer must replace the installed copies — but nothing recorded which payload an installed tree already carried, so the shell could not tell "same payload" from "changed payload" and copied unconditionally.

## Decision

`scripts/write-seed-rev.mjs` hashes every file path and byte below `profile-plugins/` and `bundled-skills/` in sorted relative-path order and writes `resources/seed-rev.txt` (64 lowercase hex characters). `scripts/build-exe.mjs` runs it after both seed phases, `scripts/build-dmg.sh` after the same phases for the `.app`, and both payload checks reject a missing, empty, or non-hex revision, so a compile-time placeholder cannot pass.

On launch the shell reads `resources/seed-rev.txt`; a missing, empty, or malformed value behaves as no revision and every phase copies, as it does when the build staged no bundled tree. A phase skips its copy only when the installed tree carries a `.dsh-seed-rev` stamp equal to the revision and is still complete:

- profile: `package.json` parses and lists every bundled package under `dependencies`, every bundled package is installed under `node_modules/` with its own `package.json`, and `cordis.patch.yml` plus `pnpm-workspace.yaml` exist;
- skills: every bundled skill still has its `SKILL.md`.

Each stamp is written only after every copy in that phase succeeded, and only while the packaged revision exists; a failed copy leaves no stamp, so the next launch repairs it. A stamp that is a symlink is never trusted and never written through. `heal_desktop_profile_file` still runs every launch, because the leftover `dsh-client-app` / `dsh-context` rewrite must not wait for a payload change ([leftover profile heal](../bug-fix/2026-08-30-desktop-leftover-profile-heal.md)). Each launch appends one line to `companion.log` naming the revision and whether each phase reseeded, failed, skipped, or found no staged tree.

A user-removed bundle-list entry does not force a reseed: a reseed itself does not put a removed bundle back, so the skip matches the copy's behavior.

## Verification

| Coverage | Location |
|---|---|
| Stamp decision: missing, matching, and stale revision; missing destination, manifest, dependency, installed package, and template file; missing `SKILL.md`; symlinked stamp | `apps/desktop/src-tauri/src/app.rs`, `app::tests::…` |
| Revision text validation (empty, uppercase, short, non-hex) | same module |
| Revision stability and one-byte sensitivity; both build scripts invoke the recorder | `scripts/verify-desktop-exe.spec.ts` |
| Installed tree carries a 64-hex `resources/seed-rev.txt` | `scripts/verify-desktop-exe.mjs` |
| Windows runner executes the seed tests | `.github/workflows/desktop-windows.yml` runs `cargo test --lib app::tests::` beside the named runtime and carrier tests |

The macOS `verify-desktop-bundle.sh` path is unchanged.

## Alternatives considered

**Compare installed file mtimes or sizes.** Rejected: a same-version rebuild restores the same sizes, `copy_dir_recursive` does not preserve mtimes, and a partially failed copy leaves entries that look current.

**Raise the WebView deadline and keep the unconditional copy.** Rejected: the copy is the dominant cost of the Windows cold boot; a longer deadline tolerates the cost instead of removing it.

**Write the stamp before the copy so an interrupted launch still marks the payload.** Rejected: a crash mid-copy would then leave a stamped but broken profile, and the next launch would skip its repair.

**Treat a user-removed `dsh.profile.bundles` entry as an incomplete profile.** Rejected: a reseed does not restore removed bundle-list entries either, so the stricter check would force a copy on every launch without restoring anything.

**Stamp the harness tree too.** Rejected: the harness is staged outside the seeded trees and the shell never copies it into `$DSH_HOME`; its version already travels in the runtime manifest.

## Consequences

- A second launch skips both copies when the installer matches the installed revision; the first launch and every payload upgrade keep the full copy.
- The revision is content-derived, so a same-version rebuild, a changed pin, or one changed skill byte all force a copy; the stamp cannot mask a payload change.
- The shell's trust in `seed-rev.txt` is bounded by shape (64 lowercase hex characters) plus the completeness checks; the packaging gates keep the producers honest.
- The installed tree carries two stamp files, `.dsh-seed-rev` under the profile and under `$DSH_HOME/skills`; deleting a stamp or a bundled skill simply triggers the copy again.
