# Upstream Runtime and Release Safety Upgrade Implementation Plan

> **For implementers:** Use `superpowers:executing-plans` after owner approval and follow this plan task by task.

English | [中文](2026-10-18-upstream-runtime-and-release-upgrade.zh.md)

**Status:** Owner-authorized implementation after review corrections. Runtime and release stacks have independent acceptance; publication, application replacement, and paid provider calls remain separate decisions.

**Goal:** Bring seven selected upstream runtime/UI improvements and four selected desktop/credential workstreams into Octopus while preserving the Tauri application, existing plugins, and API-key-first setup.

**Architecture:** Backport behavior from the pinned upstream release into an isolated branch based on the verified fork release. Adapt installer and publication mechanisms to the fork's own scripts; keep account integration, remote policy, telemetry collection, hosting, and Electron outside the upgrade. Test through both package consumers and packaged Tauri entry paths.

**Tech stack:** TypeScript, Cordis, React, pi-ai, Vitest, Rust/Tauri, NSIS, PowerShell, GitHub Actions, and the existing macOS bundle verifier.

## Summary

Users receive more reliable web search, Codex delegation, model settings, plugin refresh, and desktop upgrades. Maintainers receive verifiable artifact identity, recoverable publication, and an explicit distinction between internal builds and signed public releases. Signing credentials remain an external prerequisite; no certificate is fabricated and no unsigned artifact is classified as public-ready.

## Table of Contents

- [Scope and decisions](#scope-and-decisions)
- [Baseline and integration strategy](#baseline-and-integration-strategy)
- [Implementation tasks](#implementation-tasks)
- [Acceptance and delivery](#acceptance-and-delivery)
- [Dev Note](#dev-note)

<a id="scope-and-decisions"></a>

## Scope and decisions

The selected design is a dependency-aware backport. A whole upstream merge would also import excluded product behavior; copying only visible changed lines would omit required providers, types, profile composition, and tests. Import the smallest complete dependency set for each approved behavior and record every additional prerequisite before applying it.

| ID | Approved behavior | Disposition |
|---|---|---|
| U1 | DeepSeek Search/Fetch APIs | Add opt-in providers and settings; retain existing search/fetch defaults. |
| U2 | Disable auxiliary-search thinking | Include the independent Messages-search request fix. |
| U3 | Schema-derived model reasoning settings | Preserve the fork's pi-ai version, patch, providers, and persisted values. |
| U4 | Codex `partial_answer` | Accept the phase without claiming it establishes successful task completion. |
| U5 | Skill-menu cache refresh | Invalidate open-session catalogs after plugin changes and prevent stale in-flight responses from restoring them. |
| U6 | Right-sidebar overflow | Prevent keyboard-induced frame displacement without clipping floating panels. |
| U7 | Client/Host release compatibility | Block mixed-release updates before interpreting or installing the new graph. |
| D1 | Windows installer recovery | Adapt bounded lock retries, rollback preservation, and useful diagnostics to Tauri NSIS. |
| D2 | Release identity and signing qualification | Bind artifacts to an exact build attempt; separate internal builds from public releases. |
| D3 | Safe publication | Publish verified immutable binaries before updating release metadata; make interrupted publication resumable. |
| D4 | Credential improvements | Adopt stored-key precedence, truthful authentication hints, and safe preservation of unrelated credential-file fields. |

Signing-policy work belongs to D2. D3 implements publication safety against a local test transport and an explicitly configured fork GitHub release destination; it does not add an automatic updater or publish a release during development. GitHub is the initial artifact destination because the fork already builds and retains Windows artifacts there; the Gitee source mirror remains unchanged.

Excluded: Electron, DeepSeek account onboarding/notice stacks, account-based defaults, machine/product analytics, upstream collectors, COS deployment, mandatory-update services, self-hosted Windows runner supervision, unrelated upstream features, and replacement of the Tauri shell. Preserve telemetry's disabled default and existing forbidden-endpoint checks. Do not repair or re-extract existing user Wikis, invoke paid providers, modify live credentials, or remove documents as part of this upgrade.

<a id="baseline-and-integration-strategy"></a>

## Baseline and integration strategy

Use upstream tag `dsh-v0.2.1-rc.2` as the source ceiling. Exact source/base commit IDs, tag ref kind, and source-file hashes belong in `.plans/upstream-runtime-release-2026-10-18/source-inventory.json`, not maintained prose. Re-fetching later must not silently advance the source ceiling.

The canonical checkout currently has substantial unrelated modifications. The verified release is on `fork/codex/ask-knowledge-task7-20261017`, with a separate existing release worktree. Create a new implementation worktree from its verified local/remote tip; do not repurpose existing worktrees, stash user changes, or start from the older canonical HEAD. If the release tip moves, review the new delta and update the recorded base before starting. Pending assistant/composer/voice work is outside this backport; any requested consolidation is a separate reviewed step.

The [earlier selective-upgrade plan](2026-10-06-upstream-selective-upgrade.md) owns advancement of `UPSTREAM_PIN`. The existing intake registry still names `dsh-v0.2.1-alpha.1`. Preserve that whole-upstream baseline: selected backports do not establish complete integration through rc.2. Add `BackportEntry` records in `BACKPORTS` with item ID, source tag, source commits, disposition, owning paths, prerequisites, and verification references, plus freshness checks that distinguish imported, adapted, already-present, prerequisite, and excluded changes. Keep the existing policy checks active and record any inherited failure separately.

| Behavior | Upstream discovery entry | Main dependency concern |
|---|---|---|
| U1/U2 | PR #6103 | Web service, provider package, settings controller, bundle composition, endpoint/authentication diagnostics. |
| U3 | PR #6261 and its reasoning-editor follow-ups | Current fork lacks the full editor; schema and provider-metadata prerequisites must travel together. |
| U4 | PR #6272 | Wire parser, answer selection, cancellation/error outcome, and subprocess fixture. |
| U5 | PR #6275 | Forwarded plugin-manager event, type dependency, cache lifetime, and Loader reload ordering. |
| U6 | PR #6353 | Right-sidebar CSS, DockSurface assumptions, browser keyboard/geometry fixture. |
| U7 | Host-release-change commits before rc.2 | Boot graph producer/parser, update reconciler, reload prompt, and shipped build identity. |
| D1 | PR #6227 and recovery-diagnostic follow-ups | Custom upstream installer differs from Tauri's generated NSIS installer. |
| D2/D3 | Retained-publication and package-job-identity commits before rc.2 | Exact run/attempt identity, signature verification, immutable objects, and channel concurrency. |
| D4 | PR #5483 and PR #6121 | Credential source ordering, all consumers, headless composition, pi-ai native auth, and file preservation. |

PR labels are discovery aids. Resolve the actual Git objects and final source at the pinned tag; do not trust a web redirect or a PR title as evidence of the code being imported.

<a id="implementation-tasks"></a>

## Implementation tasks

Execute each task as a small sequence: add or import the regression fixture, demonstrate its failure on the selected base, adapt the implementation, run its focused checks, update owner documentation, and commit only that task's files. A fixture already passing on the base establishes an already-present behavior; do not manufacture a failure or copy unnecessary code. Dependencies order the tasks below.

### Task 0: Freeze the baseline and dependency ledger

**Files:** create `.plans/upstream-runtime-release-2026-10-18/source-inventory.json`; extend `scripts/upstream-intake-registry.ts`, `scripts/verify-upstream-intake.ts`, and `scripts/verify-upstream-intake.spec.ts` only for the selected-backport ledger.

1. Record canonical dirty paths without file contents or secrets; record the verified release tip, upstream lightweight tag ref and resolved commit, resolved source commits, and file hashes for U1–U7/D1–D4. Check ancestry and patch equivalence against the release checkout, not only against the dirty canonical checkout.
2. Create separate runtime and release implementation branches/worktrees; the release branch builds on the accepted runtime stack without coupling runtime acceptance to signing or Windows evidence. Create a clean sibling implementation worktree and capture `pnpm --silent run change-scope --base fork/codex/ask-knowledge-task7-20261017`. Repeat with the frozen base ref if the remote moves; never recompute acceptance against an unreviewed base.
3. For each item, list all imported types, packages, profile rows, generated artifacts, and caller changes. If a prerequisite expands into excluded account/Electron/analytics behavior, implement the smaller fork adaptation or stop that item for review.
4. Run `pnpm exec vitest run scripts/verify-upstream-intake.spec.ts` and `pnpm run verify-upstream-intake`. Add negative controls for unrecorded backports, false whole-release advancement, forbidden mounts/endpoints, and a missing prerequisite. Preserve known fork plugin pins, bundled skills, and the pi-ai streaming patch.

**Exit:** every approved item has a frozen source and complete import/adaptation decision; baseline failures are recorded before code changes.

### Task 1: Codex partial-answer compatibility (U4)

**Files:** `packages/subagent/subagent-codex/src/wire.ts`, `tests/subagent-codex.spec.ts`, existing subprocess fixtures, and the package README pair.

1. Import the parser and selection behavior: latest final answer, otherwise latest partial answer, otherwise latest unphased answer. Commentary remains excluded; unsupported phases remain errors.
2. Exercise partial → tool activity → final, multiple partial messages, partial-only output, empty output, cancellation, provider failure, and an unknown phase through the fake app-server entry path. Text must survive byte-for-byte; partial text must not hide a failed or cancelled run.
3. Run `pnpm exec vitest run packages/subagent/subagent-codex/tests/subagent-codex.spec.ts`. Add a keyless recorded-session case in `snapshots/session/codex-partial-answer/` derived from the existing `product-subagent-codex` scenario and subprocess fixture machinery; no live Codex login is required.

**Exit:** a recognized partial message no longer fails delegation, while final output and run outcome retain their existing precedence.

### Task 2: Skill refresh and sidebar behavior (U5/U6)

**Files:** `packages/client/ui-skill/src/client/index.ts`, its package manifest/compiler config and `tests/browser-plugin.client.spec.ts`; `packages/client/ui-sidebar-right/src/client/shell/SidebarRight.module.css`; `packages/client/ui-dockkit/src/components/DockSurface.tsx`; relevant `apps/web/tests/` fixtures.

1. Wire the forwarded `plugin-manager/changed` event through declared dependencies. Clear all affected catalogs after reload; abort or generation-fence old fetches so a late response cannot restore disabled skills. Dispose listeners and in-flight work on unload.
2. Import the overflow fix with the DockSurface placement rule. Test PageUp in a focused editor with the sidebar collapsed; measure frame position and confirm floating-panel visibility, scrolling, and keyboard focus.
3. Run `pnpm exec vitest run packages/client/ui-skill/tests/browser-plugin.client.spec.ts`. Import upstream `apps/web/tests/skill-menu-plugin-change.e2e.ts` and extend `apps/web/tests/sidebar-right.e2e.ts`; after building, execute `pnpm run test:web:built apps/web/tests/skill-menu-plugin-change.e2e.ts apps/web/tests/sidebar-right.e2e.ts` in keyless replay mode, then capture owning GUI snapshots. Native Windows WebView keyboard verification remains a separate required result.

**Exit:** enabling/disabling skills affects an existing session, and the sidebar neither displaces the frame nor hides floating content.

### Task 3: Credential ordering and authentication guidance (D4)

**Files:** `packages/credentials/credentials-local/src/index.ts` and `tests/{local,watcher}.spec.ts`; `packages/credentials/credentials/src/index.ts`; `packages/llm/llm-pi-ai/src/{auth,index}.ts` plus upstream native-auth helper as needed; `packages/llm/llm/src/{index,types}.ts`; `packages/api/settings-controller/src/credentials.ts`; `packages/client/ui-settings-models/src/client/`; `packages/bundle/{base,headless}/cordis.patch.yml`.

1. Adopt store → launch environment → project `.env` → user `.env` resolution for references. Keep provider-managed records and native pi-ai authentication consistent with that order. Saving/replacing/removing a stored key must take effect immediately and after restart; removing it exposes the next source.
2. Preserve unknown top-level credential-file fields with a warning that contains key names, never values. Continue rejecting invalid versions and malformed `refs`/`records`. Preserve comments, large integers, unrelated entries, file permissions, writer locking, and reload notifications.
3. Carry truthful authentication-source/endpoint metadata through the service and Models UI. Verify resolvers against installed pi-ai 1.3.x, not upstream's older resolver inventory; preserve all fork provider routes and its streaming patch.
4. Adopt the upstream headless environment-auth composition so one-shot/CI environment use remains possible without the writable desktop store. Test desktop, headless, and SDK source selection separately; document SDK behavior rather than silently changing it to match headless.
5. Run `pnpm exec vitest run packages/credentials/credentials-local/tests/local.spec.ts packages/credentials/credentials-local/tests/watcher.spec.ts packages/llm/llm-pi-ai/tests/auth.spec.ts packages/client/ui-settings-models/tests/store.client.spec.ts`. Import and run upstream native-auth and headless credential tests with synthetic secrets. Import upstream’s existing `snapshots/session/headless-credentials/` scenario and adapt it to the fork.

**Exit:** all authentication consumers agree on source selection, no test reads real keys, and a paired upgrade guide explains the changed environment override behavior. Acknowledge declared persistence-type changes if detection reports any; preserve committed historical schemas.

### Task 4: Model reasoning editor (U3)

**Files:** `packages/client/ui-settings-models/src/client/{ModelsSection,ProviderEditor,CustomProviderCard,ModelListEditor,ModelRow}.tsx` and `src/client/{store,locales}.ts`; create `ModelReasoningEfforts.tsx` and its focused test from upstream; update the pi-ai schema/metadata producer only where required.

1. Backport the complete reasoning editor and follow-up fixes. Obtain supported keys from the installed pi-ai schema; preserve unknown persisted keys, model identity during asynchronous edits, provider refusals, and explicit off/omitted distinctions.
2. Add regression cases for a schema-added level, an unrecognized saved level, model switching during editing, unsupported models, refused saves, and restart persistence. A failed update must not appear saved.
3. Run `pnpm exec vitest run packages/client/ui-settings-models/tests/model-reasoning-efforts.client.spec.tsx packages/client/ui-settings-models/tests/provider-form.client.spec.tsx packages/llm/llm-pi-ai/tests/dynamic-config.spec.ts`. Execute the Models browser fixture in both locales and update its owning snapshot.

**Exit:** editing a model changes the provider request's reasoning settings for that model and preserves other provider/model configuration.

### Task 5: Search/Fetch providers and auxiliary-search fix (U1/U2)

**Files:** import `packages/web/web-deepseek-api/`; modify `packages/web/web-search-deepseek/src/provider.ts`, `packages/web/web/src/index.ts`, `packages/client/ui-settings-web-search/`, `packages/bundle/base/{package.json,cordis.patch.yml}`, `apps/cli/package.json`, compiler project lists, lockfile, and package/subsystem docs.

1. Land U2 as an independently tested change: auxiliary Messages search sends `thinking: { type: 'disabled' }`; its result normalization and request recording remain intact.
2. Import the new provider package and per-operation provider selection with full dependency closure. Default to existing Messages search and local HTTP fetch; saving the opt-in switch selects both new providers, and switching off restores the shipped defaults.
3. Remove the account-token route from the new fork provider transport, its account imports, and its account peer/dev dependencies; do not retain a dormant `deepseekAccount.resolveToken()` branch. Reject account-routed requests explicitly and verify API-key-only operation without account services. Preserve independent chat/search endpoints, route prefixes, count bounds, trusted proxy behavior, cancellation, redirect rejection before credentials reach another origin, HTTP/non-JSON failures, and explicit errors when a custom gateway lacks tools routes. Do not add an automatic provider fallback.
4. Expose and persist the original-question forwarding option with clear Chinese/English copy. Default forwarding to off as an explicit fork adaptation; require an explicit saved opt-in, disclose the 128-character limit, and test omitted/false defaults and the bounded enabled payload. The user-visible switch must not silently change this choice on later saves or resets.
5. Run `pnpm exec vitest run packages/web/web-deepseek-api/tests packages/web/web-search-deepseek/tests/deepseek.spec.ts packages/web/web/tests/web.spec.ts packages/client/ui-settings-web-search/tests --maxWorkers=2`. Import the `deepseek-fetch` keyless session scenario and update `web-search-round` plus endpoint-guidance evidence. Real-provider testing requires separate authorization for paid requests and is reported independently.

**Exit:** both modes work through real profile composition, settings survive restart, and the new provider resolves from the collected desktop runtime without account login.

### Task 6: Client/Host release identity and reload handling (U7)

**Files:** create `scripts/desktop-build-identity.ts` and its spec; include `apps/desktop/src/bootstrap.ts` and its handshake/cache tests; modify `packages/client/modules/src/{index.ts,client/manifest.ts,client/entries.ts,client/index.ts}`, upstream `client/{release-change,notify}.ts`; `packages/client/ui-settings-general/src/client/` and tests; `scripts/build-{dmg.sh,exe.mjs}` build metadata; Tauri/companion handshake producers only where the existing runtime identity must be forwarded.

1. Import the release-identity producer, shallow reader, comparison, update refusal, and localized reload prompt as one complete change. Compare Host runtime version plus build commit when present; do not substitute the independent Tauri shell version or a per-plugin version.
2. Introduce the shared build-identity producer here and use it for the bundled Host and Client boot graph. Task 8 consumes this producer when it creates the artifact manifest; Task 6 never writes a not-yet-existing manifest. Preserve `bootstrap.ts`’s pre-boot manifest/companion runtime-version refusal; it rejects an inconsistent installation. The graph identity check rejects a stale cached Client or a reconnect after reinstall before new factories execute. Compare both checks against the same installed runtime identity, while commit-level freshness belongs to the graph check. Preserve same-release plugin graph revision updates; distinguish ordinary plugin changes from a Host release change.
3. Test unchanged release/different graph, changed release/malformed new graph, same version/different commit, legacy missing identity, reconnect, duplicate notifications, and accept/defer reload. Use upstream's explicit legacy policy and document it; do not make missing identity a permanent cross-release bypass. No new graph factories may execute after a detected mismatch.
4. Run `pnpm exec vitest run packages/client/modules/tests packages/client/ui-settings-general/tests --maxWorkers=2`. Add an installed companion reconnect control with two synthetic release identities and verify the reload prompt preserves existing sessions/settings. Do not introduce upstream mandatory-update services.

**Exit:** mismatched updates are refused before graph parsing/application, ordinary plugin refresh works, and Tauri startup works without account/network policy checks.

### Task 7: Windows upgrade lock recovery (D1)

**Files:** create `scripts/desktop-installer-template.nsi` pinned to the Tauri CLI template and a transaction include and `scripts/tests/desktop-installer-upgrade.ps1`; update `apps/desktop/src-tauri/tauri.windows.conf.json`, `scripts/build-exe.mjs`, `.github/workflows/desktop-windows.yml`, `scripts/verify-desktop-exe.spec.ts`, and desktop packaging documentation.

1. Use a custom `nsis.template`, not install hooks: retain the pinned Tauri template’s required installation/registry/WebView behavior and add staging, bounded directory replacement, and rollback around the application payload. Record the upstream template digest and test its substitutions against the pinned CLI. Explicitly include a lock on `resources/node.exe` from a surviving companion: the main-executable running check does not establish companion quiescence. Do not kill unrelated Node processes or delete the previous installation before its replacement is recoverable.
2. Handle only transient Windows errors such as access denied/sharing/lock violations with a bounded retry budget. Preserve the original error and recovery paths; preserve the previous complete payload if restoration fails. Never delete harness homes, user originals, libraries, sessions, or credentials during upgrade or rollback.
3. On a native Windows runner, install synthetic version A, launch its companion, hold a file open with a child process, then install version B. Cover lock release within the budget, permanent lock, interrupted replacement, rollback failure, normal upgrade, and reinstall. Verify actual installed bytes/version and restart behavior, not directory existence alone.
4. Reject unexpected nonzero installer exits; distinguish only documented successful/reboot-required outcomes. Keep logs and backup paths on failure. Run the PowerShell control and `pnpm exec vitest run scripts/verify-desktop-exe.spec.ts`; retain installed Host acceptance checks after recovery.

**Exit:** native Windows evidence demonstrates bounded completion or an actionable, recoverable failure with user data preserved. macOS/Wine/source-only results cannot close this task.

### Task 8: Artifact identity and public-release qualification (D2)

**Files:** create `scripts/desktop-release-manifest.ts`, `scripts/verify-desktop-release.ts`, and focused specs; integrate `scripts/build-{dmg.sh,exe.mjs}`, `scripts/verify-desktop-{bundle.sh,exe.mjs}`, `.github/workflows/desktop-windows.yml`, and a fork-owned release workflow.

1. Consume Task 6’s shared build-identity module. Define a versioned manifest with source commit, workflow commit, repository, run ID/attempt when applicable, target/architecture, runtime and shell versions, payload identities, artifact name/size/SHA-256, build mode, and observed signing/notarization results. Compute artifact digests after final assembly/signing; store the final artifact digest outside the artifact to avoid self-reference.
2. Validate the manifest against independent GitHub run/job/artifact evidence and the actual downloaded bytes. Reject wrong repository/ref/commit/attempt/platform, stale payload identity, tampered bytes, ambiguous outputs, failed jobs, or a missing required installed verification. Local internal builds use an explicit local identity and cannot pretend to be CI-qualified public artifacts.
3. Keep `internal` mode explicitly unsigned/unnotarized where appropriate. `public` mode requires Windows Authenticode with a configured trusted publisher or macOS Developer ID plus verified notarization/stapling; invoke native verification, never trust a manifest boolean. Missing credentials fail public preflight before expensive building and leave internal mode available.
4. Run `pnpm exec vitest run scripts/desktop-release-manifest.spec.ts scripts/verify-desktop-release.spec.ts`. Add native controls for missing/untrusted/invalid signatures and mismatched notarization, plus a valid signed path when credentials exist. Never report public-ready if that positive external prerequisite was unavailable.

**Exit:** internal artifacts remain testable, public qualification is independently enforced, and every delivered artifact traces to the exact tested build.

### Task 9: Resumable fork publication (D3)

**Files:** create `scripts/desktop-release-publish.ts`, its focused spec and local fixture transport; add a fork-owned manual publication workflow and paired release instructions. Do not extend npm publication in `scripts/release/publish.ts` for desktop binaries.

1. Implement `plan` and read-only `verify` paths before `publish`. The plan displays the fork repository, channel, version, exact source, signature qualification, immutable destination names, sizes/digests, and release metadata changes. No upstream endpoints, automatic updater, or production write is a default.
2. Publish immutable versioned binaries to the configured fork GitHub release, download/read them back and compare bytes, then update one authoritative channel record last. Keep the record in a dedicated fork release asset with an observed remote revision; serialize all supported channel writers through one repository-scoped workflow concurrency group. GitHub asset replacement is not an atomic compare-and-swap: recheck remote state before and after replacement, refuse ambiguous outcomes, and document that out-of-band manual writes are unsupported. Local transport tests exercise the same publisher decisions.
3. On resume, skip identical objects, refuse conflicting immutable objects, revalidate partial progress, and stop when another publisher changed the channel. Preserve already uploaded valid files on failure; do not advance metadata or move an existing tag to conceal incomplete publication. Separate successful asset publication from a failed final tag/metadata operation.
4. Run `pnpm exec vitest run scripts/desktop-release-publish.spec.ts`. Inject failures before/after each write, stale channel state, duplicate execution, wrong run identity, unsigned public input, and conflicting bytes. Exercise GitHub adapter request construction with recorded synthetic responses; actual remote writes remain a later explicit release action.

**Exit:** interrupted publication can resume without replacing a published binary or advertising an unverified artifact. No release is published during this implementation.

### Task 10: Documentation, policy checks, and integrated verification

**Files:** affected README pairs, upgrade guides, `scripts/upstream-intake-registry.ts` ledger, generated catalogs/project lists, existing installed-flow verifiers, and the scoped evidence directory.

1. Update each owning README/JSDoc, typed Chinese/English UI strings, and required upgrade guides as the behavior lands. Regenerate derived catalogs from source. Evaluate persistence-type acknowledgements for changed durable settings/records; do not alter committed Session generations or rewrite historical schemas.
2. Run `pnpm exec tsc -b tsconfig.host.json tsconfig.client.json`, `pnpm run verify-no-unknown-casts`, `pnpm run verify-export-jsdoc`, `pnpm run verify-client-ui-i18n`, `pnpm run verify-config-catalog`, `pnpm run verify-upstream-intake`, and `pnpm run test:docs`. Use the repository lint runner over changed files. Record inherited failures separately; never waive an affected Required failure.
3. Run `web-search-round` with `DSH_SNAPSHOT=replay pnpm run test:web:built apps/web/tests/web-search-round.e2e.ts`; it is a Web snapshot, not a Session snapshot. Run selected Session keyless snapshots with `pnpm run test:snapshot -t '<selected scenario pattern>'`; do not insert a standalone `--` that loses the filter. Run the Ask Knowledge focused package regression suite once after shared credential/module/profile integration, plus the existing installed Ask Knowledge and assistant controls. Treat live-provider skips as skips.
4. After source acceptance, build a disposable candidate artifact from the exact clean implementation head. Use `NODE_OPTIONS=--max-old-space-size=12288 RAYON_NUM_THREADS=2 pnpm run build`, fresh `bash scripts/build-kb-sidecar.sh`, Tauri macOS assembly, and the native Windows workflow. Verify a read-only DMG mount with `bash scripts/verify-desktop-bundle.sh <mounted-app>` and the installed Windows tree with `node scripts/verify-desktop-exe.mjs <install-root>` plus the installed Host controls. Keep candidates under the scoped evidence directory; do not replace delivered `dist/` installers or `/Applications`.
5. Run browser behavior controls for Models, search settings, skill changes, sidebar geometry, and reload prompts; separately record native Windows WebView keyboard results. Execute negative artifact/publication checks against the assembled outputs. Preserve native-platform or signing checks as pending if unavailable; do not convert them into passes based on unit tests.
6. Apply the pre-push skill if a push is subsequently requested. Produce a per-item report with imported/adapted files, test commands and exits, unresolved findings, source/artifact identity, and platform/signing limitations. Review the complete outgoing diff against the frozen fork base before any release decision.

**Exit:** U1–U7 and D1–D4 have independently inspectable evidence; every unrun native/signing/real-provider check remains explicitly identified.

<a id="acceptance-and-delivery"></a>

## Acceptance and delivery

The owner reviews this plan before implementation. Implementation approval allows isolated code changes, synthetic tests, and disposable candidate builds needed for verification. It does not approve paid model calls, live account/credential changes, publication, installation over a user's application, or replacement of previously delivered installers.

Accept the runtime stack (Tasks 0–5) independently after its selected behaviors, migration guidance, regression checks, and policy checks pass, with no unresolved Required finding. Review the release stack (Tasks 6–9) separately on that runtime base; missing Windows/signing evidence must not block accepted runtime fixes. Integrated acceptance still requires all selected workstreams. Internal-artifact acceptance additionally requires mounted macOS and native installed Windows verification, including lock recovery and Client/Host mismatch. Public-release acceptance additionally requires real signature/notarization verification and external build evidence; missing signing infrastructure blocks that status without blocking internal verification.

Deliver the plan pair and source ledger first. After implementation, deliver commits grouped by task and an evidence report; request a separate final packaging/publication decision. Retain the known-good release and installer copies throughout. Before release, resolve any new findings by fixing the introducing task; do not claim a whole rc.2 upgrade or silently expand scope to achieve a green build.

<a id="dev-note"></a>

## Dev Note

No implementation or test-pass claim is made by this proposed plan. Exact baseline/source identities and later command output are scoped execution evidence, separate from the maintained plan. Existing unrelated dirty files and existing user knowledge data remain outside the change set.
