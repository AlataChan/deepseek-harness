# RC1-09 independent coverage review

Qualification review is complete with explicit remaining findings; strict changed-source coverage is **not accepted**. The final instrumented owner run passes 715 tests with four inherited skips but exits 1 on two remaining branches. Root retains final review, repair/qualification and integrated acceptance authority.

## Identity and limits

- Task `task_6b550c2ae67f`, dispatch `ctx_8e8ac64570f7`; worktree `/Users/apple/deepseek-harness/.worktrees/p0-upstream-022-2026-11-04`.
- Read the root/package instructions, architecture, defensive patterns, documentation rules, selected-intake plan, frozen candidate manifest and RC1-09 implementation report. Read root `rc1-09-root-owner-suite-final.log`: 21 files, 531 passed, four skipped; this review does not reuse those counts as new evidence.
- Source ceiling remains `dsh-v0.2.2-rc.1`, implementation-reported commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`; basePin/UPSTREAM_PIN remain alpha and product version remains `0.2.1-alpha.1`. No upstream tag material was copied or fetched in this review; all work adapts the current owners. Source origins are inherited from the read implementation report, not independently revalidated against Git.
- No Git command/write/commit, pnpm invocation/install, emit/build/generator, browser/TCC action, paid API, real IM send, .env read, original-checkout edit, subworker, snapshot or built-browser-test edit occurred.
- Actual CLI source is `apps/cli/src/startup-diagnostics.ts`; no `startup-failure.ts` exists. Types-only `plugin-manager/src/types.ts` is excluded by the existing repository configuration and is not an executable coverage owner.

## Baseline and per-file results

Baseline ran before any source edit: 22 files, 616 passed, four skipped; exit 1 from unchanged per-file thresholds. Baseline includes the real app-boot owner suite, beyond root's 531-test initial owner set. Exact source hashes are in `rc1-09-coverage-review/baseline-source-hashes.json`; raw V8 maps, summaries and log are under `baseline/` and `baseline.log`.

The table is statements / branches / functions / lines in percent. No global thresholds, exclusions, skip lists, recorded fixtures or Vitest configuration changed. Both runs use repository `vitest.config.ts` and its V8 provider, with CLI coverage includes restricted to these 20 executable source files. Final raw maps are `rc1-09-coverage-review/final/coverage-final.json` and `coverage-summary.json`.

| Exact executable path | Baseline S/B/F/L | Final S/B/F/L |
| --- | --- | --- |
| `apps/cli/src/startup-diagnostics.ts` | 100/100/100/100 | 100/100/100/100 |
| `packages/boot/app-boot/src/index.ts` | 82.72/90.86/85.71/83.49 | 99.72/99.49/100/100 |
| `packages/boot/app-boot/src/startup-diagnostics.ts` | 100/96.42/100/100 | 100/100/100/100 |
| `packages/boot/plugin-manager/src/build-approval.ts` | 100/100/100/100 | 100/100/100/100 |
| `packages/boot/plugin-manager/src/diagnostic.ts` | 100/100/100/100 | 100/100/100/100 |
| `packages/boot/plugin-manager/src/failure.ts` | 100/100/100/100 | 100/100/100/100 |
| `packages/boot/plugin-manager/src/github-connection.ts` | 100/100/100/100 | 100/100/100/100 |
| `packages/boot/plugin-manager/src/index.ts` | 96.94/95.64/97.08/98.43 | 99.84/99.81/100/100 |
| `packages/boot/plugin-manager/src/install-failure.ts` | 100/100/100/100 | 100/100/100/100 |
| `packages/boot/plugin-manager/src/install-spec.ts` | 100/100/100/100 | 100/100/100/100 |
| `packages/boot/plugin-manager/src/operations.ts` | 100/100/100/100 | 100/100/100/100 |
| `packages/boot/plugin-manager/src/patch.ts` | 100/100/100/100 | 100/100/100/100 |
| `packages/boot/plugin-manager/src/registry.ts` | 100/100/100/100 | 100/100/100/100 |
| `packages/boot/plugin-manager/src/run-tree.ts` | 100/100/100/100 | 100/100/100/100 |
| `packages/boot/plugin-manager/src/tools.ts` | 100/100/100/100 | 100/100/100/100 |
| `packages/boot/plugin-manager/src/versions.ts` | 100/96.87/100/100 | 100/100/100/100 |
| `packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx` | 100/100/100/100 | 100/100/100/100 |
| `packages/client/ui-plugin-manager/src/client/index.ts` | 97.77/100/95/96.87 | 100/100/100/100 |
| `packages/client/ui-plugin-manager/src/client/manager-store.ts` | 97.75/96.82/97.16/99.26 | 100/100/100/100 |
| `packages/client/ui-plugin-manager/src/client/versions.tsx` | 88.23/54.83/85.71/92.85 | 100/100/100/100 |

Final totals: statements 2521/2523 (99.92%), branches 2299/2301 (99.91%), functions 530/530 (100%), lines 2053/2053 (100%). Eighteen executable files meet all four 100% thresholds; app-boot and plugin-manager index files do not. A 100% line metric does not override the uncovered statement/branch gate.

## Remaining findings

1. **New RC1-09 coverage gap — `packages/boot/plugin-manager/src/index.ts:608`.** The cancellation return after the second awaited inventory read has zero executions; the other branch ran 12 times. Pre-check cancellation, registry cancellation, cancellation announced before removal, active install cancellation, install-start observer cancellation and independent restoration are tested, but cancellation specifically during this resolved-Promise inventory gap is not. This is a retained valid cancellation guard, not a demonstrated product defect or a waiver. Artificial scheduling callbacks, mocked manager internals, hostile signal getters and private-state mutation were not used to manufacture a pass. Root must add an accepted real owner-harness mechanism or otherwise resolve the strict coverage requirement before acceptance.
2. **Inherited whole-file owner gap — `packages/boot/app-boot/src/index.ts:302`.** The throw for a previously nonfailed fiber whose `await()` rejects during reconciliation has zero executions; the other branch ran 555 times. This predates RC1-09 startup diagnostic capture. Existing `user-patches` tests cover pending activation failure, unchanged failed entries, resource-release waiting and missing-root Include; none hits this rejection combination. No source change or weakened assertion was made there. Startup diagnostic changes around `captureStartupComposition` and fallback capture are covered; whole-file strict coverage nevertheless fails on this inherited path.

## Tests and review evidence

The final owner list is plugin-manager/tests, app-boot/tests/{startup-diagnostics,app-boot,config-dump,config-reload,config-pattern,user-patches}.spec.ts, ui-plugin-manager/tests and apps/cli/tests/startup-diagnostics.spec.ts. Existing config-dump/reload/pattern/user-patches tests were included to measure their actual app-boot code; they were not duplicated or edited. The four skips are unchanged existing real Git/pnpm cases requiring upstream's absent bundled pnpm fixture. They are not passes.

Added or strengthened meaningful owner cases cover single-version registry encoding; malformed JSON/missing versions/invalid peer metadata and refused detail lookups; identity and bundle-declaration mismatch; registry exceptions and exhausted registry errors; concurrent update reservation and release; private registry selection without public fallthrough; saved-registry rollback; failed removal without installation; cancellation before removal, during actual target installation and through an operation observer; disposal during checking and interrupted removal; independent restore outcomes; diagnostic subscriber rejection; stable compatible candidate selection; failed and stale version selection; duplicate/correlated progress; refusal to close/recheck/reconfirm a running update; disposed late completion; checking/refused/current version rendering; prerelease/publication/deprecation/compatibility/omitted-version rendering; Escape while confirming versus running; separate update/restore failures and restart status; and the real Client Remote update event plus disposal.

Root-requested missing `updatable` fixture fields were populated with actual eligibility: protected/shipped/unversioned fixtures false, registry-installed sortable fixtures true. Required production fields remain required. The focused root lint wrapper reports zero diagnostics across all ten changed TypeScript/TSX files; no lint waiver was introduced.

Rollback review confirms exact target and previous-version installs, preserved enablement, failed activated target removal, exactly one independent previous-version restoration, explicit failed restore, and no first-install rollback-policy change. No-HMR update retains install-over/restart behavior and revalidates inventory. Locked shipped/desktop pins, nonregistry sources, alias/nonsemver packages and management owners refuse version operations before writes. Compatibility continues through existing peer checks; malformed and incompatible peers refuse before removal. The model tool remains inventory/management only and gains no version update action.

Durable claims remain bounded: operation-record parsing whitelists fields, validates UUID/phase/result, rejects complete-record byte overflow and cycles; no default durable operation collector was added. CLI startup reports retain raw original errors in a private unique file and explicitly warn about secrets; the composition snapshot itself strips URL credentials/query/fragments and excludes configurations. The public CLI writer path was exercised by its real file tests, not inferred from metadata. Operation observations are process-local and are not Session events or evidence of completed persistence. Provider rows are capped without a separate provider-omission count; existing plugin/service omission counters do not describe provider truncation.

No built browser, installation/DMG, real registry/network, paid provider, SDK or strict recorded-session run is claimed. Root owns the separate strict keyless inventory scenario and its acceptance.

## Authorized source cleanup

Coordinator message `msg_80fb61eef4d9` authorized these production cleanups after findings were reported:

- `startup-diagnostics.ts`: replace unreachable fallback after string split with equivalent query/fragment stripping by regex, retaining multiline handling and the 512-character cap.
- `registry.ts`: express `registryPlan`'s existing never-empty promise as a nonempty tuple. `index.ts` consumes that promise in `askRegistries` rather than retaining an unreachable empty-plan throw. Existing `inspect` behavior was retained.
- `index.ts`: concurrent mapper now filters absent stopped slots before returning completed results. Since map calls claim indexes monotonically, any absent slot follows a refusal that the ordered consumer returns immediately; removing its unreachable consumer skip preserves refusal/cancellation behavior. Refusal tests with concurrency one exercise the mapper's absent-slot filtering.

Coordinator message `msg_b87531042136` authorized removal of the impossible completed-update request mismatch guard: open/close cannot replace a running update and disposal returns above it. Completion spreads captured running state then current progress, preserving latest steps without asserting null away. Incoming progress correlation and disposal guards remain. The real jsdom Remote test filename was separately approved in `msg_84c1184c5865`.

These changes do not add product behavior, public configuration or user copy, so no README or upgrade guide change was needed for this qualification. Existing RC1-09 README/guide pairs remain for root's pairing checks.

## Exact commands and outcomes

Final coverage command (exit 1 solely from the two strict coverage findings):

```sh
node node_modules/vitest/vitest.mjs run packages/boot/plugin-manager/tests packages/boot/app-boot/tests/startup-diagnostics.spec.ts packages/boot/app-boot/tests/app-boot.spec.ts packages/boot/app-boot/tests/config-dump.spec.ts packages/boot/app-boot/tests/config-reload.spec.ts packages/boot/app-boot/tests/config-pattern.spec.ts packages/boot/app-boot/tests/user-patches.spec.ts packages/client/ui-plugin-manager/tests apps/cli/tests/startup-diagnostics.spec.ts --coverage --coverage.include='packages/boot/plugin-manager/src/**/*.ts' --coverage.include='packages/boot/app-boot/src/startup-diagnostics.ts' --coverage.include='packages/boot/app-boot/src/index.ts' --coverage.include='packages/client/ui-plugin-manager/src/client/manager-store.ts' --coverage.include='packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx' --coverage.include='packages/client/ui-plugin-manager/src/client/versions.tsx' --coverage.include='packages/client/ui-plugin-manager/src/client/index.ts' --coverage.include='apps/cli/src/startup-diagnostics.ts' --coverage.reporter=text --coverage.reporter=json --coverage.reporter=json-summary --coverage.reportsDirectory=.plans/rc1-execution/rc1-09-coverage-review/final
```

Baseline command uses the same source includes/reporters with reportsDirectory ending `baseline`, omitting config-dump/config-reload/config-pattern/user-patches tests and the newly created versions UI test file. No threshold override is present.

Final uninstrumented command is the identical final owner list without coverage flags; **27 files, 715 passed, four inherited skips, exit 0**; result is recorded in `rc1-09-coverage-review/owner-final.log`.

Lint command (exit 0, zero diagnostics):

```sh
node --import tsx/esm scripts/run-oxlint.ts packages/boot/plugin-manager/src/index.ts packages/boot/plugin-manager/src/registry.ts packages/boot/app-boot/src/startup-diagnostics.ts packages/client/ui-plugin-manager/src/client/manager-store.ts packages/boot/plugin-manager/tests/manager.spec.ts packages/boot/plugin-manager/tests/versions.spec.ts packages/client/ui-plugin-manager/tests/manager-store.client.spec.ts packages/client/ui-plugin-manager/tests/components.client.spec.tsx packages/client/ui-plugin-manager/tests/versions.client.spec.tsx packages/client/ui-plugin-manager/tests/browser-plugin.client.spec.tsx --format json
```

Intermediate logs are retained for audit; they include test-authoring mistakes subsequently corrected (fixture eligibility omitted from one BundleInfo, expected package-operation argument representation, and an external runner initially failing removal before reaching install). They are not final passing evidence and were not hidden by retries, weaker assertions or changed deadlines. Expected inactive-plugin warnings appear from negative owner cases. One earlier run emitted Node's FileHandle GC warning; it was not used as a pass criterion.

## File identities and root follow-up

Final source/test identities are also machine-readable in `rc1-09-coverage-review/final-identities.json`. No workspace wiring, dependency installation, manifest change or generator is needed for these edits. Root must independently inspect the four source diffs, refresh any intake identities referring to those sources, run its compilers/build/strict recorded-session and browser/installer checks, record relevant pairs, and close both remaining strict coverage findings before accepting RC1-09.

Changed source and tests (evidence artifacts are additional):

| File | SHA-256 |
| --- | --- |
| `packages/boot/plugin-manager/src/index.ts` | `c1478c55b6e26defbca96907f203bcd7176477ac67fab6e5ee33c0491fd1b7d9` |
| `packages/boot/plugin-manager/src/registry.ts` | `be63d06603f0bb25036d19d748f04c7ee4f1f98f06e156e5bae3f22e201ec33f` |
| `packages/boot/app-boot/src/startup-diagnostics.ts` | `3881ebadcf0f583788861b4c695adff7b5b93ed326ac628e8c8bf8a9e8760f32` |
| `packages/client/ui-plugin-manager/src/client/manager-store.ts` | `4429d2afad4d926cc0291675d685d58c0b83ed2d692790f208293c16b6d83b3f` |
| `packages/boot/plugin-manager/tests/manager.spec.ts` | `03ee9416cee2e6943979231a51f35bc0d5d3609352c17e6907a0232e22ebe02d` |
| `packages/boot/plugin-manager/tests/versions.spec.ts` | `9626e9bad179956b5827e744c228d54cab1ce58ddaa151872d6ad26449288265` |
| `packages/client/ui-plugin-manager/tests/manager-store.client.spec.ts` | `3da0fbbda76dd934ead65304b6f243268be9848cb93e6390bff41f2e0b11e38a` |
| `packages/client/ui-plugin-manager/tests/components.client.spec.tsx` | `f920ab00920b820fdef37892b4d79cb6e58c64f6c9a41c4db767177278e4b8fe` |
| `packages/client/ui-plugin-manager/tests/versions.client.spec.tsx` | `c420ca05934bb61bc3bb732e285c343ab5a5593161e423ef196acd401a467bd3` |
| `packages/client/ui-plugin-manager/tests/browser-plugin.client.spec.tsx` | `0affa6ba76f9b20f487a263ecacea7b33748d993ea5fb5423ba3b4a2518e64b7` |

All measured executable sources:

| File | SHA-256 |
| --- | --- |
| `apps/cli/src/startup-diagnostics.ts` | `8242b472467f7efbf5ae46804080e101702a71d8be382c6d96e402a51eb1ab95` |
| `packages/boot/app-boot/src/index.ts` | `204e3e3e69e99e1576b36e2cea6ab61a1737a79350e1815045c1e8cedd612b8e` |
| `packages/boot/app-boot/src/startup-diagnostics.ts` | `3881ebadcf0f583788861b4c695adff7b5b93ed326ac628e8c8bf8a9e8760f32` |
| `packages/boot/plugin-manager/src/build-approval.ts` | `5b4574b0f5373dff212125cbb6ddf1dd6749938895982074545cdab90aa10174` |
| `packages/boot/plugin-manager/src/diagnostic.ts` | `231e16523e0feaee3cbed9cdd069586c34d3909e13b70987774e975f8f468da7` |
| `packages/boot/plugin-manager/src/failure.ts` | `28eff38fbd9cf39b81138e7391bcf5ee32c22b76ab7d98d49a195160b730951a` |
| `packages/boot/plugin-manager/src/github-connection.ts` | `b3ac3f2a13feee34b6abd3c72753f077823ed0131ebb0d2ba451bd57865a280f` |
| `packages/boot/plugin-manager/src/index.ts` | `c1478c55b6e26defbca96907f203bcd7176477ac67fab6e5ee33c0491fd1b7d9` |
| `packages/boot/plugin-manager/src/install-failure.ts` | `bee66d2ca7056b4560c02f1a4ac7a7ddb2d0ea1bfd02fb6a403837e8be8a1194` |
| `packages/boot/plugin-manager/src/install-spec.ts` | `2a0ad0179bf8475096b002b942195163cdee5b1fd70370114458eba9537709c1` |
| `packages/boot/plugin-manager/src/operations.ts` | `941f5481444ca9461f02b9f31247393d9ae7aa457fd3e3874c685177d4958794` |
| `packages/boot/plugin-manager/src/patch.ts` | `87c539e7171b04c2bc51bbd1b4c75d0aeef98d9b6b7a7e39e1cbceb266143f66` |
| `packages/boot/plugin-manager/src/registry.ts` | `be63d06603f0bb25036d19d748f04c7ee4f1f98f06e156e5bae3f22e201ec33f` |
| `packages/boot/plugin-manager/src/run-tree.ts` | `d3da95db5f30882ed1a7dfb499de7b35cb9fd71eb137fc2384ebc2a5d18c38cd` |
| `packages/boot/plugin-manager/src/tools.ts` | `469b061d280614dc185dbef456a38b00d890ab8380356f470347ae02b8c5a234` |
| `packages/boot/plugin-manager/src/versions.ts` | `ffde36514263fcadd370e9e2d783143f7dc5101752703f19d81187511a1360d5` |
| `packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx` | `6a0bf99d3e9277a4f2dcb7c6ab86410d5b47b77ae2ed7958f1416152c75cc091` |
| `packages/client/ui-plugin-manager/src/client/index.ts` | `ce1029073774810977e87324870a53427df55db4181c39590785a49f56d41f63` |
| `packages/client/ui-plugin-manager/src/client/manager-store.ts` | `4429d2afad4d926cc0291675d685d58c0b83ed2d692790f208293c16b6d83b3f` |
| `packages/client/ui-plugin-manager/src/client/versions.tsx` | `59c41c9d2bc2462d36e847b9b361a809bf793522a71e9ffe290e35d2cbe607e8` |
