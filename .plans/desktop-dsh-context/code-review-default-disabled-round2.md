# Second code review: default-disabled dsh-context

Decision: changes required. Prior R1–R4 are addressed for the reviewed installer paths; R5 remains open. Reviewed relevant working-tree changes against HEAD `47675a706f4f1cf3ce20b78d4d3e8a46e993d0ca`, including the new untracked installed-flow verifier. Unrelated documentation/site changes were excluded. No product code was changed.

## Required findings

### R5 — P1: the new acceptance gate passes cold boots as hot activation and changes the agreed criteria

Location: `scripts/verify-dsh-context-installed-flows.mjs:235–275`, and its READY claim at line 307.

The verifier writes bundles directly with `seedProfile`, starts the companion, waits only for `control/ready`, then stops it. It never calls `setBundleEnabled`, never asserts `applied` rather than `restart-required`, never mounts the native Client, and never observes context contributions or their disposal. Each alleged toggle uses a new process, so leaked contributions across live cycles cannot be detected. Even the restart case checks only readiness, not the persisted bundle selection or actual projections.

The G labels have also changed meaning: original G1 was offline isolation, but the new G1 checks files while network access remains available; original G7 required payload-revision refresh preserving ON/OFF, but the new G7 only boots twice; original G8 required an activation error without false UI success, but the new G8 heals a legacy fixture using the checkout JS helper. That import also contradicts the module claim that no checkout product code is used. A broken live toggle, missing Client contribution, unexpected network fetch or missing activation-error feedback can all still produce the final G1–G8 READY result.

Keep these checks as packaged cold-boot compatibility evidence, but restore the agreed criteria and exercise the actual installed toggle path with one running companion and the desktop Client. Assert default-OFF discovery, applied ON/OFF, actual contribution creation/removal, repeated live cycles, restart and revision-refresh preservation for both states, and activation-error feedback. Prove offline behavior with network enforcement/observation. Add negative controls that make the appropriate criterion fail. Do not label the current smoke as complete G1–G8 acceptance.

### R6 — P2: failure cleanup can leave the verifier's companion running

Location: `scripts/verify-dsh-context-installed-flows.mjs:308–310` (also `start():177–188`).

The runner is declared inside the try block, while finally only deletes tempRoot. If startup times out while the child is alive, `await runner.start()` rejects before any `runner.stop()` call. The timeout finally clears its timer without terminating the child, and the top-level catch exits the verifier. The companion can remain alive with its profile tree removed, retaining processes or other resources after a failed release check. Register cleanup immediately after runner creation and always await `runner.stop()` in finally before removing its directories; ensure shutdown-send errors still reach termination and awaited exit. Add a bounded startup-timeout failure control that observes the child's exit and cleanup.

## Prior-finding disposition

- R1: the initial safety-heal error now propagates as Err to setup's `?` before DesktopShell construction. The new named test uses invalid JSON rather than an actual write failure; the propagation path itself covers write errors too.
- R2: production JS and Rust healing now read installed package identity/version and require agreement before preserving ON. Rust completeness checks verify recorded and installed inventory versions.
- R3: Rust validates schema, expected package identity/version and explicit flags before matching-stamp checks. The earlier missing-field and mismatched-version acceptance defects are resolved.
- R4: JS writes the safety heal before destination checks and replacement. The new failure regression verifies the persisted manifest.
- R5: packaged file assertions and cold boots improve evidence, but do not satisfy the original installed UI/lifecycle acceptance criteria.

## Verification

- `pnpm vitest run scripts/seed-desktop-profile-plugin.spec.ts`: 15/15 passed.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`: 42/42 passed.
- `codesign --verify --deep --strict apps/desktop/src-tauri/target/release/bundle/macos/octopus_DSH.app`: passed.
- Scoped `git diff --check`: passed.
- `node scripts/verify-dsh-context-installed-flows.mjs apps/desktop/src-tauri/target/release/bundle/macos/octopus_DSH.app`: exited 0 and printed G1–G8 READY. This establishes the implemented file checks and cold boots, with the acceptance limitations in R5. Log: `/tmp/dsh-context-review2-installed.log`.

The full bundle gate was not rerun: focused changes and the newly added installed-flow gate were checked directly. No UI automation, live toggles, network isolation, DMG build, or installation was performed in this review.
