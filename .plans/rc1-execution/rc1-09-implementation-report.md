# RC1-09 implementation report

Worker scope is implemented and owner tests pass; this is not root acceptance or a shipping claim.

## Identity and scope

- Task: `task_2a0e989a1a3d`; Dispatch: `ctx_a5e818e4b1b7`.
- Worktree: `/Users/apple/deepseek-harness/.worktrees/p0-upstream-022-2026-11-04`.
- M2 checkpoint: `f10cfa2ca102715bfc41cea9b60f9741042c7025`; implementation resumed after coordinator message `msg_ef26fce7ac8a`.
- Source ceiling: `dsh-v0.2.2-rc.1`, commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`; no origin/master source used.
- `UPSTREAM_PIN` / selected `basePin` remain `dsh-v0.2.1-alpha.1`, product version remains `0.2.1-alpha.1`.
- Filename authority: candidate JSON/manifest plus coordinator approvals for `lockedBundles`, `InstallBundleOptions.saveExact`, client event subscription and the guide pair (`msg_468134ba0a7d`). Shared manifests, generated files, pin composition, API event forwarding and dependency installation stayed root-owned.

## Delivered user and Host behavior

The existing Plugins detail page has one Versions section only when the Host reports `updatable`. Opening the page, refreshing inventory and the agent tool do not check registries. A user checks versions, sees tags, publication dates, prerelease/deprecation and compatibility details, selects a compatible newer version, reviews from/to versions and confirms. The dialog displays checking/removing/installing/restoring, restart-required, update/restore failures or an unknown transport outcome. Repeated confirmation after a lost response cannot start another install, and disposed stores ignore late answers. Chinese and English copy stay locale-owned.

The current PluginManager gains listVersions/updateBundle without wholesale replacement. Metadata uses the existing profile invocation and registry plan; inspect retains its default fields. Validated versionListLimit is 1–100 (default 20) and versionLookupConcurrency is 1–16 (default 4). Both remotes refuse management, installation-supplied, locked, non-semver, file/link/workspace/Git/tarball and alias packages before writes. Root composes shipped and desktop-pinned names into lockedBundles.

The update checks target identity, newer semver, bundle declaration and compatibility through existing peers. It rechecks installed version/source after lookup for both HMR and install-over paths. HMR removes then installs the selected exact version with saved enablement; target install/activation failure removes a failed activated target as needed and attempts exactly one previous exact-version restore. Restore has no request id and ignores the update signal. Its separate result reports failed restore. Without HMR there is no removal and the existing install-over method reports restart-required. First-install activation failure retains the saved package; the three existing activation cases remain unchanged.

Progress uses plugin-manager/update-state, with no Session event/version change. plugin-manager/operation emits correlated started/settled/unknown observations without raw specs/config/output; optional consumers remain explicit. diagnostic.ts validates whitelisted durable-record fields, known phases/results, sizes and a complete 64 KiB JSON limit, rejecting unsupported/oversized/cyclic records. No default persistent collector was added and no persistence claim is made. StartupError carries a configuration-free Loader/service snapshot captured while the Loader exists before disposal, with omitted-row counts and URL credentials/query/fragment removal. Provider ownership follows the nearest Loader ancestor. Original failure.ts and desktop/native pins were not edited by this worker.

## Upstream material used

All source inspection used git show at the fixed tag. Adapted bounded portions of plugin-manager/src/index.ts (version methods, registry lookup and concurrent mapping), plugin-manager/src/types.ts (only the approved version/progress/operation types), and app-boot/src/index.ts startup-capture placement. New versions.ts, diagnostic.ts, startup-diagnostics.ts and their tests start from their tag counterparts and are adapted for current peers, bounded diagnostic records, sanitized URLs and current provider ownership. The Client version-check/update state is adapted from the tag's manager-store.ts; the new versions.tsx uses current primitives/locales and explicit checks. No existing fork source file was replaced wholesale. The browser case and updated UI are adapted to the current page and APIs; excluded tag marketplace/official/detail/restart/feed types and packages were not imported.

## Verification actually run

1. Reader tests initially failed on absent modules; 17 initial update behavior cases initially failed on absent methods. Client action cases and page rendering also failed before their implementations. The no-HMR stale-version regression failed with an install/restart outcome before moving the recheck and passed afterward.
2. Final full owner command: `node node_modules/vitest/vitest.mjs run packages/boot/plugin-manager/tests packages/boot/app-boot/tests/startup-diagnostics.spec.ts packages/client/ui-plugin-manager/tests` — **20 files passed, 524 passed, 4 existing skips**, exit 0. Log: `.plans/rc1-execution/rc1-09-worker-owner-tests.log`. The four skips are existing real Git/pnpm cases whose upstream bundled pnpm fixture is unavailable in this Tauri checkout.
3. Focused manager selection additionally ran 32 passing cases including all new behavior, all eight updated inventory assertions and the three preserved first-install activation cases (74 tests filtered, not claimed passed). Log: `.plans/rc1-execution/rc1-09-worker-manager-tests.log`.
4. The model-visible additive updatable field is covered through the real Loader-booted manager and real ToolRuntime/plugin_manager executor in owned manager.spec.ts: core false, registry dependency true, unknown update action rejected, tool registration removed on disposal. No fake manager or update tool action was added.
5. Root lint wrapper: `node --import tsx/esm scripts/run-oxlint.ts <19 owned TypeScript/TSX source/test files> --format json` — **0 diagnostics**, exit 0. Exact files are the 19 TypeScript/TSX rows in the inventory below; result `.plans/rc1-execution/rc1-09-lint.json` records number_of_files 19.
6. Scoped `git diff --check` passed. No pnpm invocation/install, source emit/build/generator, paid API, browser/TCC action, real IM send, .env read, Git write/commit or original checkout edit was performed by this worker. Root separately ran dependency installation, remote generation and its earlier independent owner review.

## Root-only acceptance and wiring

Root already reported semver ^7.8.5 / @types/semver ^7.8.0 installation, new remote generation with semantic checks, API type reexports and update-state forwarding, shipped/desktop pin composition, and a published ./diagnostic subpath. Confirm those shared edits and final closure in the integrated build; they are not worker-authored files in this report.

Root still owns bilingual pairing records (two README pairs and the guide pair), generated catalogs, BackportEntry/registry changes, compiler/build/distribution gates and final acceptance. The browser case `RC1-09 explicitly checks, confirms and reports restart while locked pins stay unavailable` in apps/web/tests/plugin-manager.e2e.ts is ready for root to run after building: scripted Host registry/update answers, real Client navigation/remotes, locked file-pin refusal and restart sentence; no live registry. No browser run, screenshot/theme/viewport acceptance, installer run, exhaustive coverage or independent final acceptance is claimed here. Root also owns the end-to-end startup diagnostic writer assertion through its existing reportStartupFailure path; this worker covered the boot snapshot and public record reader.

## Final worker file identity

SHA-256 below excludes root-owned package.json/API/pin/generated edits. Source/test/doc hashes reflect this report's creation time; report and log files are evidence artifacts.

| File | SHA-256 | Bytes |
| --- | --- | ---: |
| `packages/boot/plugin-manager/src/index.ts` | `89d331185357432f26b90b2218edaceb32093b00d10e799f47f9b39b446bd503` | 66123 |
| `packages/boot/plugin-manager/src/operations.ts` | `941f5481444ca9461f02b9f31247393d9ae7aa457fd3e3874c685177d4958794` | 32807 |
| `packages/boot/plugin-manager/src/types.ts` | `e524687286fd768f5a68fe5b926c49e6895df9c22cfe9b5376843634890ef1f6` | 17118 |
| `packages/boot/plugin-manager/tests/manager.spec.ts` | `65723896c33c3edb89b26fed48172f6f3f07602e99fe3b5f6157bcb05c4859f5` | 112588 |
| `packages/boot/app-boot/src/index.ts` | `204e3e3e69e99e1576b36e2cea6ab61a1737a79350e1815045c1e8cedd612b8e` | 52038 |
| `packages/client/ui-plugin-manager/src/client/manager-store.ts` | `251028752d4fe9e323e8867b37427e962308a3c585a36e4c2b7218b541365032` | 59815 |
| `packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx` | `6a0bf99d3e9277a4f2dcb7c6ab86410d5b47b77ae2ed7958f1416152c75cc091` | 73916 |
| `packages/client/ui-plugin-manager/src/client/PluginManagerPage.module.css` | `25a21e9ccbc9aa64fb15e738674ddaf73d7ba0475560fff4cc37606ad573ea51` | 31251 |
| `packages/client/ui-plugin-manager/src/client/locales.ts` | `7be5ff2ffcbf779657305383e097f80bbdd2b8cdf2abec464873d1b18e35a3d2` | 27245 |
| `packages/client/ui-plugin-manager/tests/manager-store.client.spec.ts` | `fcc9a201eb2303e478473801c5acc094a31188cdfd0c6c23ce7973d092c84fda` | 96656 |
| `packages/client/ui-plugin-manager/tests/components.client.spec.tsx` | `7dce7d31d6820d87b4281cc03dfd0e61c327c59c9273cdc1d5546db72ce09fed` | 127640 |
| `apps/web/tests/plugin-manager.e2e.ts` | `b99ee84c3625fd5ae6f02881ed08f53d6361f7956e385cac5e5c8f8b00fc39b7` | 63062 |
| `packages/boot/plugin-manager/README.md` | `38d73de72dc5b55e23228f64dbc78472f55c11882d10240154623e136b0aad9b` | 24678 |
| `packages/boot/plugin-manager/README.zh.md` | `ffc9a22522075578e25af345dc060080a644f517ad57d4cc8158c45315e64303` | 22532 |
| `packages/client/ui-plugin-manager/README.md` | `b4b35cb68b04e1967cbbe9732ffd37221c700a07347f2a4fb5b71e68a5f47e1c` | 27000 |
| `packages/client/ui-plugin-manager/README.zh.md` | `785a0ed312c10c74a768d3e66eeed96ececa17b6ee1150e712f5857c8a28ad88` | 24246 |
| `packages/boot/plugin-manager/src/versions.ts` | `ffde36514263fcadd370e9e2d783143f7dc5101752703f19d81187511a1360d5` | 3839 |
| `packages/boot/plugin-manager/tests/versions.spec.ts` | `18a6a07f8b241b6e4a18cabbd9f9f2fe7b6de39d8b988ff354c423bb2f80298a` | 1315 |
| `packages/boot/plugin-manager/src/diagnostic.ts` | `231e16523e0feaee3cbed9cdd069586c34d3909e13b70987774e975f8f468da7` | 3157 |
| `packages/boot/plugin-manager/tests/diagnostic.spec.ts` | `7c505d54c8a33c3e527b785a498bc9cc43f736bcd9255f6bbfa47b5b86991044` | 2260 |
| `packages/boot/app-boot/src/startup-diagnostics.ts` | `7a0e53e70df3c791d711ff276c86a92309d6981941d8e9acf80b815f2acccc5d` | 5143 |
| `packages/boot/app-boot/tests/startup-diagnostics.spec.ts` | `dbc68158cbaffe23a6bf087f4ab5276979cd7d66776234e992869692a55edd8e` | 8177 |
| `packages/client/ui-plugin-manager/src/client/versions.tsx` | `59c41c9d2bc2462d36e847b9b361a809bf793522a71e9ffe290e35d2cbe607e8` | 5663 |
| `packages/client/ui-plugin-manager/src/client/index.ts` | `ce1029073774810977e87324870a53427df55db4181c39590785a49f56d41f63` | 7075 |
| `docs/upgrade-guide/v0.2.1-alpha.1/plugin-version-management/guide.md` | `5fc2618569b597a63c69e6c9a66eeb4566eda9c2e39aac008b690f3fe32fadbc` | 1247 |
| `docs/upgrade-guide/v0.2.1-alpha.1/plugin-version-management/guide.zh.md` | `08b485b8facdddde35b780fe71aeb96333f51a594eb47eeb51e4afaddc724c8b` | 1072 |
