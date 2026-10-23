# Code review: default-disabled dsh-context

Decision: changes required. Reviewed the relevant uncommitted changes against HEAD `47675a706f4f1cf3ce20b78d4d3e8a46e993d0ca`, not the unrelated documentation/site changes in this dirty workspace. No product code was changed during review.

## Required findings

### R1 — P1: a failed safety heal does not stop companion startup

`apps/desktop/src-tauri/src/app.rs:472–474` returns `SeedOutcome::Failed` when the manifest cannot be healed/written. Setup at lines 816–830 only logs that result and still constructs `DesktopShell`; the carrier commands remain available. A readable but unwritable legacy profile can therefore retain selected 0.36.0 and reach companion launch. This contradicts the revised plan's explicit requirement to abort setup on heal/write failure. Propagate a safety-heal failure to setup or otherwise prevent carrier startup until the unsafe selection has been durably removed. Test the actual startup decision with a heal-write failure, rather than only the pure manifest helper.

### R2 — P1: recorded 0.74.0 is mistaken for a verified installed version

Rust `app.rs:273–277` and JS `scripts/seed-desktop-profile-plugin.mjs:178–179` preserve selection solely from `dependencies["dsh-context"] === "0.74.0"`. Neither reads the installed package version, despite the revised plan requiring both values to equal 0.74.0. A recorded 0.74.0 with installed 0.36.0 remains selected if payload replacement is unavailable; a matching stamp also skips replacement because completeness checks only file existence. The JS helper independently reproduced preservation of this recorded selection. Resolve installed and recorded versions before preserving ON, and cover their disagreement and missing installed metadata in both implementations.

### R3 — P2: resource metadata validation is incomplete and skipped on a matching stamp

`app.rs:500–524` checks expected paths for package.json existence, enumerates parsable package names, and calls `desktop_profile_seeded` before validating per-plugin booleans at lines 528–531. A matching stamp can therefore return `Skipped` with a missing plugin row or invalid boolean. On an unstamped profile, `version` and `schemaVersion` are never checked at all; malformed package.json files can be silently omitted by `filter_map`. For example, an inventory claiming context 0.74.0 alongside a directory containing 0.36.0 with the same package name is accepted for installation. Validate the entire inventory, explicit flags, package identities and versions before any skip or mutation; derive completeness from that validated inventory. Add negative controls through the Rust orchestration path.

### R4 — P2: JS healing is not durable before a rejected installation

`scripts/seed-desktop-profile-plugin.mjs:239` heals only an in-memory manifest. It writes that manifest only after destination checks, removal, copying and validation at line 254. An installation failure leaves the original legacy selection on disk. Reproduced through `installPluginIntoProfile` using the actual packaged 0.74.0 source and a legacy profile whose package destination is a symlink: the expected symlink rejection occurred, but package.json still selected and depended on 0.36.0. Persist the safety heal before fallible replacement operations, with a regression proving the disk state after failure. Fixture: `/tmp/dsh-context-review-3kZ4Q3`.

### R5 — P2: release verification does not establish the promised desktop behavior

The changed check at `scripts/verify-desktop-bundle.sh:236–245` checks the source pin, not exported plugins.json. The lifecycle smoke at lines 137–150 seeds with the JS CLI rather than Rust. Thus the gate cannot catch a missing or inconsistent resource manifest or the Rust defects above. Context remains OFF during the smoke, so it also does not establish ON compatibility, native Client mounting, disposal, repeated cycles, restart persistence or error feedback. The added tests exercise helper behavior; neither suite implements G1–G8 or the missing/malformed-inventory and heal-failure startup cases. Add packaged metadata validation and the agreed installed-desktop acceptance evidence before claiming release qualification.

## Verification

- Rust: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` passed all 40 tests.
- JS: `pnpm vitest run scripts/seed-desktop-profile-plugin.spec.ts` passed 13/14; the existing third-party file-dependency/npm-install fixture exceeded its 5000 ms timeout. This is not attributed to the context changes. A focused retry stalled in npm install for over two minutes and was terminated together with its npm child.
- Ran the actual JS safety-heal rejection reproduction above; legacy selection remained on disk.
- `bash scripts/verify-desktop-bundle.sh apps/desktop/src-tauri/target/release/bundle/macos/octopus_DSH.app` finished NOT READY: 109 passed, 2 failed. Ask Knowledge hit nested `sandbox-exec: sandbox_apply: Operation not permitted`; the unchanged affected `node scripts/verify-ask-knowledge-installed-flows.mjs apps/desktop/src-tauri/target/release/bundle/macos/octopus_DSH.app` check passed on the host with 29 criteria and invalid controls. Composer predictions failed on an atomic-write writer-lock timeout for the isolated desktop profile's package.json. That failure was not attributed to context. Logs: `/tmp/dsh-context-review-bundle.log`, `/tmp/dsh-context-review-kb-host.log`.
- Scoped `git diff --check` passed for the six changed implementation/pin/test/gate files.
- Confirmed the built resource tree contains context and exported plugins.json with version 0.74.0 and defaultEnabled false. This is file inspection, not G1–G8 acceptance.

No live user-profile edits, UI toggles, DMG build or installation were performed.
