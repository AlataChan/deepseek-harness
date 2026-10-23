# Upstream Compatibility and Model Labels Implementation Plan

English | [中文](2026-10-23-upstream-compatibility-and-model-labels.zh.md)

> **For implementers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` after owner approval to implement this plan task by task.

**Goal:** Align the remaining rc.2 vendor release metadata and improve provider-aware model labels while preserving the qualified Tauri desktop and existing user selections.

**Architecture:** Apply three bounded adaptations from the pinned upstream release. Preserve the fork’s model selector, source patches, profile composition, and native carrier/cache. Keep architectural runtime upgrades outside this implementation.

**Tech Stack:** TypeScript, React, Cordis, pnpm, Vitest, Playwright, Rust/Tauri, and the existing internal DMG pipeline.

**Status:** Owner-authorized local implementation after Astra review revisions. The required ownership-check revision and both verification advisories are included below; implementation and artifact acceptance remain pending.

## Summary

The next internal desktop build will use the stable vendor release identifiers, display the canonical Flash name, and support model labels that receive the exact provider/model identity. Existing model routes, reasoning selections, assistants, standing teams, and default-disabled context behavior must remain intact. Approval authorizes local implementation and internal qualification; paid API calls, external publication, public signing, and replacement of an installed application remain outside this plan.

## Table of Contents

- [Scope](#scope)
- [Baseline and source control](#baseline)
- [Implementation tasks](#tasks)
- [Acceptance](#acceptance)
- [Recovery and delivery](#delivery)
- [Separate runtime assessment](#later)
- [Dev Note](#dev-note)

<a id="scope"></a>

## Scope

This plan extends the [October 18 selected intake](2026-10-18-upstream-runtime-and-release-upgrade.md). Search/Fetch, slash-menu invalidation, Codex partial-answer handling, reasoning settings, and release-safety adaptations already exist; preserve them and verify affected consumers rather than importing them again.

| ID | Included change | Required limit |
| --- | --- | --- |
| C1 | Stable vendor versions, loader peer range, timer locale exports/files | Preserve all runtime source and local modifications. Resolve dependency changes explicitly. |
| C2 | Provider-aware model-label slot, provider memoization, and justified menu-placement adaptations | Preserve the fork’s controls, reasoning UI, keyboard handling, and custom slots. No account service dependency. |
| C3 | Default Flash display name `DeepSeek-V4.1-Flash` | Retain model ID `deepseek-flash`, provider IDs, request routing, and explicit user labels. |

Excluded: the temporary 1017 badge package; subagent or PTC architecture changes; persistent Node REPL; Electron; account notices/onboarding; telemetry defaults or collectors; marketplace defaults; CUA; Windows runner supervision; installer transaction rewrites; npm publication; and public release publication. Root Harness version and `UPSTREAM_PIN` remain unchanged. No Session format, persisted selection format, or migration change is planned.

<a id="baseline"></a>

## Baseline and source control

The source ceiling is `dsh-v0.2.1-rc.2`; the complete-integration baseline stays `dsh-v0.2.1-alpha.1`. Exact commits, selected source hashes, observed dirty paths, and the prior internal DMG identity are recorded in the [source inventory](../../.plans/upstream-compatibility-2026-10-23/source-inventory.json). Re-fetching must verify that ceiling, never silently advance it. Git source objects take precedence over PR URLs that redirect to unrelated discussions.

At planning time, the vendor runtime-source comparison against rc.2 is empty; differences are release metadata, timer locales, and documentation. Our selector already clamps menus, while its provider-aware label slot is absent. These are observations to recheck at execution, not permission to overwrite entire directories.

The [qualified context review](../../.plans/desktop-dsh-context/code-review-default-disabled-remediation.md) records the previous internal ARM64 result. Its 114 checks are historical evidence, not a result for this proposed build. The canonical checkout contains unrelated edits; implementation must start from a reviewed desktop checkpoint in a new worktree. Do not stash, reset, broadly stage, or merge unrelated work.

<a id="tasks"></a>

## Implementation tasks

Tasks 1–3 require Task 0 and use separate commits. Task 4 requires all three accepted changes. Each implementation task adds the behavior test, records its expected failure or an already-present result, applies the smallest complete adaptation, runs its checks, and commits only its reviewed files.

Implementation commits are checkpoints, not acceptance claims. On the shared host, complete the required root build once against integrated C1–C3 source after focused checks; diagnose broad-test failures with bounded workers and the repository’s shared-host test budget. All required checks remain open until they pass, and packaging acceptance must not inherit a previous artifact’s pass count.

### Task 0: Preserve the qualified release and freeze the implementation base

**Files:** update `.plans/upstream-compatibility-2026-10-23/source-inventory.json`; create `.plans/upstream-compatibility-2026-10-23/verification.md`; inspect the context review’s exact implementation files before creating its prerequisite checkpoint in an isolated worktree.

1. Verify the previous DMG and adjacent release manifest against the inventory’s separate byte hashes and retain the manifest’s dirty-source markers; preserve copies under `dist/review-baselines/2026-10-23-context-qualified/` before any packaging command can overwrite them. Do not copy application data or credentials.

2. Create an ignored isolated worktree from the observed HEAD, import only reviewed context changes, and commit the existing qualified context implementation and required transport/build fixes there as a prerequisite checkpoint. Keep the canonical branch and unrelated dirty files untouched. Record excluded dirty paths without their contents. Recheck any desktop source that changed since qualification before accepting this checkpoint. Commit the approved plan pair and source inventory separately, so the implementation worktree receives them. If that checkpoint is not reviewable, stop implementation and report the missing prerequisite.

3. Begin C1–C3 in that clean isolated worktree at the planning commit immediately following the desktop checkpoint. Record its branch, base, current source hashes, source ceiling, and artifact identity in the inventory. Compare changes with the recorded base using `pnpm --silent run change-scope --base <recorded-base> --head HEAD`.

4. Run `pnpm run verify-upstream-intake` and `pnpm exec vitest run scripts/verify-upstream-intake.spec.ts`. Record exact existing diagnostics; the four reported outstanding entries do not establish four missing releases or complete rc.2 acceptance. Establish documentation and test baselines in this worktree rather than inheriting failures from unrelated dirty files.

**Exit:** the preserved artifact verifies, the desktop prerequisite is committed, the worktree is isolated, and each baseline failure has a named disposition.

### Task 1: Align vendor release metadata without replacing runtime source

Dependency qualification also aligns `apps/cli/package.json`, `packages/boot/{app-boot,hmr}/package.json` and their owning README pairs to the native builtin minimum `^0.1.9`. The flat desktop closure must not retain an older first-resolved native builtin package. Ownership obligations use literal complete paths so directory labels cannot be mistaken for unscoped module specifiers.

**Files:** modify `vendor/{cordis,cosmokit,group,hmr,include,loader,logger-console,schemastery,timer}/package.json`, add `vendor/timer/locale/{en,zh}.json`, update `pnpm-lock.yaml` and the owning vendor documentation where facts change; create `scripts/upstream-compatibility-release.spec.ts`; update `scripts/upstream-intake-registry.ts`, `scripts/verify-upstream-intake.ts` and `scripts/verify-upstream-intake.spec.ts`; create `scripts/upstream-compatibility-policy.ts` for independently declared approved path obligations.

1. Add assertions for the exact version set below, the loader peer range `node-addon-require-builtin: ^0.1.9`, and timer’s `./locale/*.json` export and `locale` published-files entry. Confirm that stale metadata or a missing shipped locale fails the relevant assertion using disposable fixture packages, never workspace mutation.

```text
cordis 4.0.5             cosmokit 1.8.6       group 1.0.5
hmr 1.0.20               include 1.0.10       loader 1.0.6
logger-console 1.0.5     schemastery 3.18.5    timer 1.1.7
```

2. Recheck the runtime-source comparison against the ceiling, then adapt only the metadata and locale files. Preserve scoped package names, workspace dependency conventions, local patches, and published runtime exports. Retain unchanged source SHAs when updating the vendor version table. An unexpected source delta requires a revised scope before applying it.

3. Regenerate the lockfile through pnpm; inspect every changed importer and peer snapshot. Verify the installed native-loader version satisfies the new peer range. Retain justified peer-resolution changes and reject unrelated dependency upgrades.

4. Declare approved C1–C3 path obligations independently of the BACKPORTS records being checked; activate each item with its implementation commit. Update the executed verifier to enforce each required item, exact owned path and original whole-release pin, including added timer locales and vendor manifests. Add C1 ownership without weakening existing rules. Run the unchanged CLI entry point in disposable Git repositories with positive fixtures and negative controls for one omitted path, an entirely omitted required entry and a pin advance even when ownership records use that advanced pin. Helper-only tests are insufficient. Prepare a build-dependent tarball smoke that checks both timer locale files and package-export resolution after Step 5’s build; keep source-plane unit checks independent of built files.

5. Run `pnpm exec vitest run scripts/upstream-compatibility-release.spec.ts scripts/verify-upstream-intake.spec.ts`, `pnpm run rescope-vendor:check`, and `pnpm run verify-upstream-intake`. Follow the vendor sync policy with one root `pnpm run test` and `pnpm run build`; this broad check is justified by repository-wide framework dependency resolution. After building, pack timer with `pnpm --dir vendor/timer pack --pack-destination <scratch>`, inspect the extracted package and resolve its JSON exports from a disposable consumer. Do not publish it. Record and resolve required failures before accepting C1.

**Exit:** exact metadata and locale packaging pass, runtime source is preserved, dependencies resolve, and the vendor policy checks pass. Commit C1 separately.

### Task 2: Add provider-aware model labels and preserve menu behavior

Execution scope amendment: the local renderer lacks inline slot anchors. C2 also owns `packages/client/ui-slots/src/index.ts`, `packages/client/ui-renderer/src/client/scoped-slots.tsx`, the new `inline-slots.client.spec.tsx` and affected owning README pairs. Port only the inline declaration and span anchors/error placeholders; preserve other renderer behavior. Run the inline lifecycle/error-state tests and existing scoped-slot regressions before accepting C2.

**Files:** modify `packages/client/ui-model-selection/src/client/{slots.ts,ModelSelect.tsx,index.ts}`, its `README.{md,zh.md,i18n.yaml}` and `tests/{model-select.client.spec.tsx,browser-plugin.client.spec.ts}`; update `docs/subsystems/slots.{md,zh.md,i18n.yaml}`; regenerate `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`; extend `apps/web/tests/default-model.e2e.ts` and its owner-local expected files.

1. Add tests for a label contribution rendered at trigger, current-value menu, and option placements. Use two providers with the same model ID and distinct labels; selecting either must send its own provider/model pair and reasoning value. Cover fallback with no contribution and fallback after contribution disposal. The missing slot must fail the new contribution tests on the baseline.

2. Adapt the upstream slot and memoization changes together. The single session-scoped inline slot is `conversation.input.model.label`; its owner contains provider `{ id, name }`, the exact model catalog entry, placement `trigger | menu | option`, and `selected: boolean`. The default renders the catalog name. Contributions remain non-interactive and receive no credential/configuration data; model-selection controls remain the selector’s responsibility.

3. Add browser geometry checks for narrow and short windows, long localized labels, large catalogs, reasoning menus, zoom, and live resize. Verify viewport bounds, internal scrolling, search, Escape, arrow/Enter navigation, focus return, and stale asynchronous catalog responses. Preserve the existing clamp when it passes; port only demonstrated placement fixes. Do not inject style changes that conceal an overflowing production menu.

4. Register contributions through owned effects, preserve fork-defined slots, regenerate with `pnpm run gen-client-catalog`, and run `pnpm run verify-client-catalog`. Add C2 registry ownership. Keep account implementations and the temporary badge package absent from composition and dependencies. Update both README languages and the slot reference together.

5. Run `pnpm exec vitest run packages/client/ui-model-selection/tests/model-select.client.spec.tsx packages/client/ui-model-selection/tests/browser-plugin.client.spec.ts`, then `DSH_SNAPSHOT=replay pnpm run test:web:built apps/web/tests/default-model.e2e.ts apps/web/tests/model-menu-observer.e2e.ts` after rebuilding Client artifacts. Use shipped-profile scaffolds and synthetic providers; geometry and ARIA goldens remain under their app owner.

**Exit:** provider identity and fallback tests pass; real browser interactions remain usable; generated catalogs retain existing custom slots. Commit C2 separately.

### Task 3: Correct the default Flash display name

**Files:** modify `packages/llm/llm-deepseek/src/models.ts`, `tests/{adapter.spec.ts,runtime.spec.ts}`, affected owning README pairs, and affected `apps/web/tests/expected/` catalog/model goldens; create `apps/web/tests/flash-default-catalog.e2e.ts` (register in `tsconfig.host.json` and exclude from the Client program in `apps/web/tsconfig.json`) and its owner-local golden; update the intake registry with C3.

1. Add a regression expecting the shipped default name `DeepSeek-V4.1-Flash` while retaining `id: deepseek-flash` and the selected provider. Confirm it fails against the current `DeepSeek-V41-Flash` value. Add a custom-catalog case whose explicit name remains untouched.

2. Change only the default catalog display value. Do not append a date, change request model IDs, regenerate unrelated provider catalogs, rewrite stored selections, or rename explicit user entries. Review each expected-output change against its owning default-catalog scenario.

3. Run `pnpm exec vitest run packages/llm/llm-deepseek/tests/adapter.spec.ts packages/llm/llm-deepseek/tests/runtime.spec.ts`, run the new keyless built-browser `flash-default-catalog.e2e.ts` against the shipped DeepSeek adapter/default catalog with an inert synthetic credential and no model requests, review its default-name golden, and separately run `DSH_SNAPSHOT=replay pnpm run test:snapshot -t model-switch-notice`. The model-switch replay uses synthetic catalogs and establishes routing regression only, not the Flash default name. Retain committed historical session generations; UI-only expected output stays with the app. No live provider request is required.

**Exit:** only the shipped default display name changes; user labels and provider/model/reasoning selections remain stable. Commit C3 separately.

### Task 4: Qualify the integrated internal desktop

**Files:** maintain `.plans/upstream-compatibility-2026-10-23/verification.md` and source inventory; add test-only fixtures under `apps/web/tests/` if needed. Extend an owning verifier only for a demonstrated gap; do not weaken existing assertions or change production transport to make a test easier.

1. Recheck the complete diff and C1–C3 ownership. Run `pnpm run typecheck`, `pnpm run lint`, `pnpm run hygiene`, `pnpm run verify-upstream-intake`, `pnpm run verify-client-ui-i18n`, and relevant documentation checks. Confirm unchanged root version, complete-integration pin, model IDs, plugin pins/defaults, and telemetry policy. A changed required failure remains open until fixed or explicitly excluded from the approved delivery scope.

2. Commit accepted source changes before the final build and record the tested commit. Run `pnpm run build`; from `apps/desktop`, run `cargo tauri build`. Await successful bundling before starting `bash scripts/build-dmg.sh --arch arm64`. Reused caches must pass their existing freshness checks; do not force reuse of stale dependencies or sidecars.

3. Require every current bundle check, including dsh-context installed-flow acceptance. In an isolated home with synthetic settings and network confinement, use the actual Tauri WKWebView to inspect both locales, resize/zoom menus, change routes and reasoning, cold-restart, and confirm assistant/team model choices. Test default-OFF context discovery and live ON/OFF with actual Client appearance/removal.

4. Exercise existing Ask Data/Ask Knowledge entry paths and API-key setup without paid calls. Verify opt-in Search/Fetch and slash-menu refresh remain available. Compare the resulting bundle’s actual Cordis/Schemastery resolution for community plugins with the accepted baseline; reject new incompatible or unnecessary duplicate framework copies.

5. Mount the final DMG read-only, compare signed app payload digests and verify strict signatures, then copy the unchanged app into a disposable installation directory. Launch its canonical physical executable path, test the native selector and context toggle, and run `node scripts/verify-dsh-context-installed-flows.mjs <copied-app>`. Stop owned processes before removing temporary homes. Do not overwrite `/Applications` or user data.

6. Record exact commands, results, failures, screenshots, tested source identity, final artifact size/hash, cache reuse, and platform limits. Produce the updated internal DMG and adjacent release manifest. Native Windows menu checks are required before Windows qualification; macOS results do not establish them.

<a id="acceptance"></a>

## Acceptance

Each row needs a recorded positive result and the indicated regression or invalid control. Existing behavior that already passes is retained and reported as already present.

| ID | Required result | Regression or invalid control |
| --- | --- | --- |
| A1 | Exact vendor metadata and timer tarball contents | Stale version, missing locale, or incompatible peer fails. |
| A2 | Runtime source and existing fork modifications retained | An unexpected runtime-source change blocks this scope. |
| A3 | Labels distinguish identical model IDs across providers | Selecting the second provider never routes to the first. |
| A4 | Empty/disposed label contribution falls back to catalog name | Removing the contribution leaves no stale label or registration. |
| A5 | Menus remain inside short/narrow resized windows | Oversized labels/catalogs expose clipping or inaccessible controls. |
| A6 | Default name corrected; user names and selections preserved | Explicit custom labels and stored provider/model/effort survive. |
| A7 | Context live OFF/ON/OFF, cold states and payload refresh pass | Existing missing-inventory, failed activation and cleanup controls remain effective. |
| A8 | Assistants, teams, data and knowledge entry paths remain usable | Shared model IDs and unavailable providers do not silently change stored choices. |
| A9 | Copied DMG app matches tested bytes and runs natively | Signature or payload mismatch fails delivery. |
| A10 | Scope ledger remains accurate | Unregistered paths, pin advancement or excluded account/telemetry imports fail. |

<a id="delivery"></a>

## Recovery and delivery

Keep C1, C2 and C3 as separate revertible commits and retain the previous tested DMG. Failed qualification leaves the previous artifact as the delivery candidate; fix or revert only the failed intake item in the isolated branch, regenerate its derivatives, and rerun affected checks. Rebuild all coupled Client/Host/native artifacts after source changes. Never repair failure by disabling assertions, bypassing release identity, weakening network confinement, or modifying an installed user profile.

Deliver the source commits, updated intake records, verification report, internal ARM64 DMG and release manifest. State observed platform/signature scope and every unresolved required check. Public notarization, Windows/Intel qualification, paid API behavior, and running embedded runtimes directly on a mounted image are not established by this internal installation result.

<a id="later"></a>

## Separate runtime assessment

After this intake is accepted, prepare a separate proposal for subagent lifecycle and PTC guidance/persistence. Map providers and consumers, standing-team and assistant interactions, cancellation, descendant cleanup, Session compatibility, both SDKs, sandbox/resource ownership, and snapshot coverage. Split output-preserving prompt composition from persistent execution. That assessment may recommend adoption, a smaller backport, or deferral; it authorizes no implementation in this plan.

<a id="dev-note"></a>

## Dev Note

This is an owner-review plan, not a completion report. The source inventory contains current observations; implementation verification fields remain pending until executed. Plan preparation does not rerun the application build or mutate product code.
