# Review: pre-bundle dsh-context with default-disabled activation

Decision: changes required before execution. Review only; no implementation, installation into the user's profile, build, or release was performed.

Reviewed artifact: `/Users/apple/.gemini/antigravity-cli/brain/ff101cbc-ec78-47c8-a834-bf5ec98e7abd/plan-bundle-dsh-context-default-disabled.md`, lines 1–100. Source checkout: current working tree, including existing uncommitted changes. This is a plan review, not a bounded commit-diff review.

## Required findings

### R1 — P1: the defaultEnabled value never reaches either installer

Artifact lines 54–65 propose checking `plugin.defaultEnabled` in `mergeProfileManifest`, while separately hardcoding a Rust `DEFAULT_DISABLED_BUNDLES` list. The actual JS entry point `installPluginIntoProfile()` in `scripts/seed-desktop-profile-plugin.mjs:190` reconstructs the plugin from the installed package as `{name, version}`. Its callers pass only `pin.shippedBundles`. Consequently, adding the proposed merge condition alone still sees `undefined` and enables the package on first install. Rust's `install_bundled_profile_plugins()` discovers resource directories, and `install_one_profile_plugin()` receives only directory/name; neither receives pin activation metadata. The Rust hardcoded list also duplicates the JSON policy rather than implementing the claimed seeding contract.

Required revision: specify a single authoritative activation-default representation, its validated schema, its build/export into Resources, and its delivery to both JS and Rust installation calls. Define missing as enabled for existing pins and reject invalid flag values. Test through the actual install entry points, not only a direct merge helper. Changing the flag must invalidate the relevant packaged payload revision. Keep enabled state out of profile-completeness checks: an installed disabled plugin is complete.

### R2 — P1: retiring the crash guard has no definite legacy migration rule

Artifact lines 59 and 63 leave both the version policy (`<0.74.0` or exactly `0.36.0`) and the Rust behavior (remove guard or restrict it) unresolved. These alternatives differ materially. Rust heals the manifest before checking the seed stamp and before copying packages (`apps/desktop/src-tauri/src/app.rs:440`); JS also heals existing profiles before installing. Simply deleting the guard can leave the known-broken selected package bootable if the new payload is unavailable or seeding fails. A broad version comparison cannot be assumed to work on dependency specs such as ranges or file references, and dependency text need not match the installed package version. Re-running the old unconditional guard would erase a modern user's ON selection every launch.

Required revision: choose exact legacy detection inputs and ordering, define behavior on absent payload, stale stamps and copy failure, and preserve modern ON/OFF choices across successful refresh. Known-broken legacy activation must be prevented until a compatible replacement is installed; an installation failure must not be represented as successful migration. Add JS and Rust regression cases covering clean first install, legacy selected 0.36.0, modern ON, modern OFF, same-revision relaunch, changed-revision refresh and missing/copy-failing payload. This is a request to make the migration deterministic, not a recommendation to ban all older plugin versions.

### R3 — P2: the stated instant/offline behavior exceeds the planned acceptance checks

Artifact lines 16–21 infer safety largely from removed APIs and package size; lines 85–91 test helper behavior, file presence and one manual enable action. The published 0.74.0 tarball actually imports `deriveEventMessage` and `interruptedTurnClosers` from `@deepseek-ai/dsh-session`, and the default schema from `@deepseek-ai/schemastery`, in addition to zod and Node built-ins. Thus “only imports standard Context” is inaccurate. The old API's absence does not establish compatibility of every new Host/Client dependency or lifecycle path. Its advertised peer ranges admit this checkout, but that is not a successful packaged-runtime test.

The manager can list unselected installed dependencies (`packages/boot/plugin-manager/src/index.ts:280`). Its activation result is conditional on Host HMR (`change()` / `reload()`), and desktop explicitly disables `client-hmr` in its bundle patch. This does not prove hot activation fails; it means Host apply and native WebView module mounting must both be checked rather than inferred from a manifest toggle.

Required revision: make the delivered desktop path an acceptance gate: fresh isolated profile and packaged payload, network unavailable, card/icon/localized metadata visible while OFF, no context rows or tabs active while OFF, ON creates the actual dashboard/projections, OFF removes owned contributions, repeated ON/OFF has no duplicate routes/listeners/projections, and ON/OFF persist across restart and upgrade. Verify the result reports applied rather than restart-required, and test an activation error without a falsely successful UI. Include Rust tests for the Rust installer and an installable DMG plus installed-companion smoke; the Python/TypeScript helper or manifest alone cannot validate Rust first launch. Pin exactly 0.74.0 rather than approving every future >=0.74.0 release based on this review.

## Confirmed supporting facts

- Installed dependencies are included in the plugin manager's discovery even when absent from `dsh.profile.bundles`; a default-OFF card fits the existing manager design.
- The published package declares a Host bundle patch, a web Client, and compatibility peers; its only declared production dependency is zod. Runtime imports still include Harness peers.
- Current projection registration is effect-owned, so direct register calls alone are not evidence of a disposal defect. Actual repeated activation remains the appropriate acceptance test.

## Evidence and limits

Read the artifact, both seeding paths, packaging gates, bundle patches, plugin manager discovery/activation, compatibility evaluator and projection registry. Retrieved `npm view dsh-context@0.74.0 ... --json` and `npm pack` into an isolated `/tmp/dsh-context-plan-review.*` directory and inspected the unpacked package without importing or executing it. No unit tests, live toggles, builds or DMG checks were run; package compatibility and hot activation are unverified, not reported as failed. No product code or original plan artifact was modified.
