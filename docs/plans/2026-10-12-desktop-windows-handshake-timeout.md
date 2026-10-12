# Desktop Windows handshake timeout (white window) — plan

Mode: fix

Created: 2026-10-12

Architect: Cla

Plan review: Cla (Reviewer), round 1 — overall 6.75 (correctness 6, simplicity 7, security 8, conformance 6); eight required fixes integrated below.

## Symptom

On the owner's Windows machine (NSIS install under `C:\Users\admin\AppData\Local\octopus_DSH`), the window stays blank, then the home page reports `这个窗口没能开始会话。` / `desktop companion handshake timed out`. A `node.exe` companion stays alive. Most launches fail; one succeeded.

## Evidence

1. `.github/workflows/desktop-windows.yml` run 38240994748 (success) bounds the gate's pinned-overlay step at 26.9 s (`11:40:07.546` → `11:40:34.460`). That window contains the ten `seed-desktop-profile-plugin.mjs install` spawns **plus** the smoke, so it is an upper bound on the handshake, not a measurement of it. The smoke's own limit is 20 s and the desktop WebView's is 15 s (`apps/desktop/src/bootstrap.ts:375`).
2. The same run's module-graph step needed 4.7 s (`11:40:02.87` → `11:40:07.54`) just to import the companion's module graph on a healthy runner.
3. The same companion boot with a warm profile is ~2-3 s (gate step 6) and ~2 s on macOS against the shipped `.app` (measured here).
4. Owner's `companion.log`: every boot reaches `dsh: warning: 3 entries did not activate` with no fatal error, then the shell replaces generation after generation — retries, not crashes. Several generations produced no output at all before replacement. The inactive entries are `commerce-mode` (no `sqlite3` on `PATH`), its dependent `commerce-preset`, and `desktop-speech-transcribe`.
5. `apps/desktop/src-tauri/src/app.rs` deletes and re-copies the whole seeded payload into `~/.dsh/profiles/desktop/node_modules` on every launch: 12,981 files / 172 MB in the shipped payload. Every launch re-writes the module files the companion then loads.
6. Neither Windows smoke exercises the Tauri app's `setup()` seeding path (both drive the companion and `carrier-harness` directly under a temp `DSH_HOME`), so no CI check currently measures the cost in 5.

## Decisions

- **D1 — wait long enough, and say so.** Raise the desktop handshake deadline to 120 s and keep the window informative from the first frame. 15 s is below a Windows cold boot on evidence 2-4; a timeout is a failure report, not a boot budget.
- **D2 — stop the redundant reseed.** The packaging scripts write `resources/seed-rev.txt`, a content revision of the seeded trees; the shell skips the reseed when the installed profile carries that revision and is complete. Any payload change (including a same-version rebuild) changes the revision, so upgrades still refresh.
- **D3 — measure the handshake in the gate.** The Windows smokes print the elapsed time to `control/ready` and stop failing at a budget below the real boot. The gate cannot observe `setup()`'s seeding (evidence 6), so this measures the companion handshake only.
- **D4 — report-only: `commerce-mode` cannot activate without `sqlite3` on `PATH`.** Out of scope here; the CI runner has `sqlite3` and the owner's machine does not, which is why the gate passes while the same criterion fails for a user. Follow-up issue.

Sequencing: one branch, two commits (D1+D3 first, then D2), so a D2 regression can be dropped without losing the symptom fix. The shipped EXE carries both.

## Changes

### Commit 1 — deadline, status, gate budgets

1. `apps/desktop/src/bootstrap.ts`: named `DEFAULT_HANDSHAKE_TIMEOUT_MS = 120_000`, used as the deadline default. JSDoc states why it exceeds a measured Windows cold boot. The timeout message stays `desktop companion handshake timed out`.
2. `apps/desktop/index.html`: render the status line as static markup inside `#root` (`正在启动 octopus_DSH…首次启动可能需要一两分钟。`), so it paints even when the bundle fails to parse. `apps/desktop/src/main.ts`: drop the `root.textContent === ''` guard and always replace the root with the failure text on a rejected boot; add a one-shot 20 s timer that switches the text to a "still starting" line, and clear that timer when the boot settles or rewrite the text only while the status node is still in the document, so it can never replace a mounted Client tree. Both `renderHome` and the Client mount already replace root children. `desktop.css`: style `.dsh-boot-status`.
3. `apps/desktop/tests`: a case proving a rejected boot replaces the status line with the reason, and a case that the default deadline does not fire before 120 s (fake timers, no injected deadline).
4. `scripts/smoke-companion-lifecycle.mjs`: deadline 20 s → 120 s, print the elapsed time to ready in the success line, and use the same value in the failure message (no hardcoded `within 20s`).
5. `scripts/smoke-desktop-rust-launch.mjs` deadline 30 s → 120 s; `scripts/verify-desktop-exe.mjs` capture timeout 45 s → 150 s.

### Commit 2 — seed revision skip

6. `scripts/verify-desktop-exe.mjs`: assert `resources/seed-rev.txt` exists and holds 64 lowercase hex characters. It belongs to this commit, not commit 1: a dispatch on commit 1 must pass its own gate before the file exists.

7. `scripts/write-seed-rev.mjs` (new): hash `profile-plugins` + `bundled-skills` in sorted relative-path order (path + bytes), write `<resources>/seed-rev.txt`. Called by `scripts/build-exe.mjs` **after** both seed phases and by `scripts/build-dmg.sh` for the `.app`. `apps/desktop/src-tauri/tauri.windows.conf.json`: add `resources/seed-rev.txt` to `bundle.resources`; `.gitignore`: add `apps/desktop/src-tauri/resources/seed-rev.txt` beside the other staged resource entries; `build-exe.mjs` header: add it to the payload list.
8. `scripts/verify-desktop-exe.mjs`: the payload check refuses an empty or non-hex `seed-rev.txt` (a placeholder from `createResourcePlaceholders` must not pass).
9. `apps/desktop/src-tauri/src/app.rs`: read `resources/seed-rev.txt`; treat a missing, empty, or non-hex value as absent (today's always-copy behavior). Skip `install_bundled_profile_plugins` only when the revision matches the stamp `<profile>/.dsh-seed-rev` **and** the profile is complete: `package.json` parses, lists every bundled name under `dependencies`, and both `cordis.patch.yml` and `pnpm-workspace.yaml` exist. Skip `install_bundled_skills` only when the revision matches `<home>/skills/.dsh-seed-rev` and every bundled skill still has its `SKILL.md`. A user-removed bundle-list entry does not force a reseed, matching what a reseed does today. `heal_desktop_profile_file` still runs every launch. Refuse a symlinked stamp (`symlink_metadata`), like `install_one_profile_plugin` already refuses a symlinked destination. Write each stamp only after every copy in that phase succeeded; a failed copy leaves no stamp, so the next launch repairs it. Record one line in `companion.log` per launch naming whether the payload was reseeded or skipped, so the field can confirm it; `DesktopShell` does not exist yet at that point, so append directly to `cache_root.join("companion.log")` (append-only, as `carrier.rs` does).
10. Tests: Rust unit tests over a tempdir for the stamp decision (missing revision, matching revision, stale revision, missing destination, missing profile manifest) and for the revision-text validation; `scripts/verify-desktop-exe.spec.ts` gains the `write-seed-rev.mjs` behaviour cases (a one-byte change changes the revision; an identical tree is stable) and the assertion that both build scripts call it.
11. `.github/workflows/desktop-windows.yml`: add the new `app::tests::…` name to the existing named Rust test step.

### Docs

12. `apps/desktop/README.md`: launch behavior, the seed revision, the handshake budget.
13. `.agents/notes/implemented/process/2026-10-11-desktop-windows-exe-ci-only-build.md` (+ `.zh.md` + `.i18n.yaml`): add `seed-rev.txt` to the staged payload and its placeholder rule.
14. New Agent Note for the seed-revision skip (durable invariant + rejected alternatives), with its `.zh.md` counterpart and pairing record.

## Verification

- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` (new `app` tests included).
- `pnpm run test` for the desktop specs and the script specs; `pnpm --filter @deepseek-ai/dsh-desktop run build`.
- Local macOS end-to-end against the installed `.app`: run `scripts/smoke-companion-lifecycle.mjs` and read the elapsed-ready line; confirm a second launch skips the reseed (stamp present, plugin mtimes unchanged) and that `companion.log` names the decision.
- Windows: dispatch `desktop-windows.yml` on the branch; the readiness gate must pass, and its smoke must print the elapsed ready time that D1's budget is based on.
- Owner acceptance on the Windows machine: status line appears within ~1 s of the window; first launch connects without the timeout message; second launch connects quickly and `companion.log` shows the reseed skip.

## Risks

| Risk | Mitigation |
| --- | --- |
| Seed revision hides a payload change | The revision hashes file bytes and paths, so any change forces a reseed |
| Skip leaves a broken or partial profile | Skip requires a parseable manifest with every bundled dependency, both template files, and every skill's `SKILL.md`; a failed copy writes no stamp |
| 120 s hides a hang | Companion stderr still lands in `companion.log`; the timeout still reports; a retry replaces the generation |
| DMG path regressions | `write-seed-rev.mjs` is additive; `verify-desktop-bundle.sh` keeps its existing checks |
| The status line never paints during `setup()` | Tauri builds config windows before the setup hook, but the first navigation can queue behind the copy; owner acceptance checks it within ~1 s, and the copy is what commit 2 removes |

## Out of scope

`sqlite3` provisioning for `commerce-mode` (D4), speech-to-text provider, the rust smoke's informational `Node main-path comparison` line, code signing, updater, Windows arm64.
