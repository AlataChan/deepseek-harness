# RC1-S1 implementation report — 2026-11-05

Status: implementation and focused verification complete; independent root integration acceptance remains required. This report snapshots worker-owned edits plus explicitly approved extensions in the shared isolated worktree. No Git writes, package installation, pnpm invocation, generators, emitted builds, paid requests, browser execution, original-checkout edits, or subworkers were performed by this worker.

## Behavior delivered

One existing ScheduleService/Runtime and one Automation Tasks panel manage six timing kinds: after, at, every, daily, weekly and cron. No RRule or parallel scheduler was added. Tasks support session/new_once/new destinations; omitted targets reserve new_once. Tool calls pass the actual acting Session, human remotes omit it, and delegated callers/destinations and archived destinations remain refused. Original header cwd supplies omitted Agent-owned creation cwd and never comes from effective execution cwd.

Pending delivery and its stable target Session id are written in the same task row before Session creation. Existing create({sessionId,cwd,agentPreset}) and resolveAgent are used. Cold retry reuses the reservation, including create-before-prompt recovery. Input is logged with source.kind schedule and no human RPC id. Separate task/Session writes preserve at-least-once semantics; no exactly-once or cross-record transaction is claimed. Existing waiting questions are superseded while already queued correlated answers remain queued. Schedule input does not grant Goal human authority.

The domain is v2, compatibleVersions [1]. v1 sessionId/inactive fields normalize into target/ended in memory; read/open/close preserve old file bytes, and mutation writes v2. Historical schedule/change declarations, frozen generations and global SQLite version are unchanged. JSON whole-unit compatible-version admission and next-mutation stamping, including rollback on failed publish, are implemented in the approved storage files; the shared memory fixture mirrors those semantics.

Public management is create/list/catalog/view/history/run/edit/deleteInactive. List is paged; edit compares expectedUpdatedAt and writes a complete patch once; run preserves the scheduled occurrence; deleteInactive removes only ended rows. Manual creation, target/content/timing editing, pause/resume, run, saved history and clearing ended tasks use actual controls in the existing panel. en/zh own copy. Run availability refreshes when the reused target reaches whole-agent idle. Legacy update/delete registrations/remotes are removed; historical logged call presentation remains readable in ui-tool.

## Model-visible expectations

The only current tools are schedule_create, schedule_list, schedule_view and schedule_edit. Create requires title/prompt/timing and accepts target; the timing selector is nested and exactly one of the six kinds. Successful create/view/update values are full catalog entries including target, status, involvedSessionIds and optional timestamps/receipt/execution state. List returns {items,shown,total,limit,offset}. Delete returns {id,deleted:true}; lookup miss and stale revision return schedule_not_found/schedule_conflict. Tool JSON is a lossless text block from the committed result and is covered by keyless owner harness tests. Remote input errors use typed schedule/input-invalid with stable details.code; local tool calls retain ScheduleInputError handling. Deliveries retain existing reminder framing and source.kind schedule.

## Verification actually run

- Direct Node Vitest focused owner suite: packages/schedule/schedule/tests, packages/schedule/tool-schedule/tests, packages/client/ui-schedule/tests, ui-tool/tests/details-row.client.spec.tsx, subagent-in-process-driver/tests/schedule-tools.spec.ts and storage-json/tests/json-backend.spec.ts. The base focused suite passed 51 files / 1624 tests (rc1-s1-final-focused.log); the later broader V8 run adds all ui-tool and storage-json cases and supersedes that count.
- Additional actual Host controller run: rc1-s1-real-host-final.log, 1 file / 4 tests passed. Uses SessionCommandController, ApiSessionAgentController, real AgentLoop inbox and JSON persistence: cold create-before-prompt reuse, waiting-question supersession with queued answer preservation, cancellation/deletion retention, and successive automatic recurrence.
- Additional destination/ownership run: rc1-s1-cold-ownership.log, 1 file / 8 tests passed, including archived refusal, original cwd inheritance, cold delegated metadata and failed manual flush retry. Real initialization/disposal regression run: rc1-s1-readiness-tests.log, 4 files / 96 tests passed.
- Source no-emit tsc for schedule and tool-schedule passed (rc1-s1-source-host-compile.log and rc1-s1-source-tool-compile.log). Earlier broad Host no-emit hit the default heap; filtered diagnostic programs omitted shared augmentation roots and are diagnostic evidence only, not aggregate compiler acceptance. Root owns aggregate builds.
- Repository root lint wrapper covers 113 owner/approved files; final diagnostics and exit status are recorded in rc1-s1-final-lint.json. Final V8 run passed 71 files / 2059 tests with 49 measured source files at 100% statements (3354/3354), branches (2607/2607), functions (810/810), and lines (2862/2862). Command uses the repository V8 config and unchanged per-file 100% thresholds, scoped include patterns, two workers, isolated .plans report output, JSON/text and the repository uncovered-locations reporter; rc1-s1-coverage.log and rc1-s1-coverage/coverage-final.json record the result. A previous run reached 100% coverage but hit an existing 5-second cron test deadline under competing compiler load; bounding workers fixed that run without changing any deadline, assertion or exclusion. Root repaired the unrelated nested shell fixture before the final run.
- Browser test code is authored/migrated, not run by this worker. Built browser, CLI expected process, SDK projections, frozen goldens, global docs gates and final acceptance belong to root.

The final two named browser files also passed the root lint wrapper after exact current API assertions and localized control labels were audited (rc1-s1-browser-final-lint.json). An additional shared-locale run passed 28 tests; V8 reported 0/0 executable entries for that data-only include, so no extra coverage percentage is claimed. Root owns final typed i18n/pair gates. All 91 listed product/document files passed scoped git diff --check (rc1-s1-diff-check.log).

The final coverage command was:

```sh
node node_modules/vitest/vitest.mjs run packages/schedule/schedule/tests packages/schedule/tool-schedule/tests packages/client/ui-schedule/tests packages/client/ui-tool/tests packages/storage/storage-json/tests packages/subagent/subagent-in-process-driver/tests/schedule-tools.spec.ts --maxWorkers=2 --coverage --coverage.reportOnFailure --coverage.include='packages/schedule/*/src/**/*.ts' --coverage.include='packages/client/ui-schedule/src/**/*.{ts,tsx}' --coverage.include='packages/client/ui-tool/src/client/tool/models/tool-call-model.ts' --coverage.include='packages/client/ui-tool/src/client/tool/models/details-card-model.ts' --coverage.include='packages/client/ui-tool/src/client/tool/toolviews/details-row.tsx' --coverage.include='packages/storage/storage-json/src/format.ts' --coverage.include='packages/storage/storage-json/src/single-unit.ts' --coverage.reportsDirectory=.plans/rc1-execution/rc1-s1-coverage --coverage.reporter=text --coverage.reporter=json --coverage.reporter=/Users/apple/deepseek-harness/.worktrees/p0-upstream-022-2026-11-04/scripts/coverage-uncovered-locations.cjs
node node_modules/typescript/bin/tsc --noEmit -p packages/schedule/schedule/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p packages/schedule/tool-schedule/tsconfig.json
```

The final repository lint command was:

```sh
node --import tsx/esm scripts/run-oxlint.ts packages/schedule/schedule/src packages/schedule/schedule/tests packages/schedule/tool-schedule/src packages/schedule/tool-schedule/tests packages/client/ui-schedule/src packages/client/ui-schedule/tests packages/client/ui-tool/src/client/tool/models/tool-call-model.ts packages/client/ui-tool/src/client/tool/models/details-card-model.ts packages/client/ui-tool/src/client/tool/toolviews/details-row.tsx packages/client/ui-tool/tests/details-row.client.spec.tsx packages/storage/storage-json/src/format.ts packages/storage/storage-json/src/single-unit.ts packages/storage/storage-json/tests/json-backend.spec.ts packages/storage/storage/src/backend.ts packages/storage/storage-domain/src/spec.ts packages/storage/storage-domain/tests/helpers/memory-backend.ts apps/web/tests/schedule-after.e2e.ts apps/web/tests/schedule-manual.e2e.ts apps/cli/tests/profiles/web/tests/schedule-timing.expected.e2e.ts packages/subagent/subagent-in-process-driver/tests/schedule-tools.spec.ts --format json
node --import tsx/esm scripts/run-oxlint.ts apps/web/tests/schedule-after.e2e.ts apps/web/tests/schedule-manual.e2e.ts --format json
```

## Upstream sources and adaptations

Ceiling dsh-v0.2.2-rc.1, commit 66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db; lead 341ea6eea414c61fbe4c99cd1c3d6fc60bf0a57f. No origin/master source was used. The accepted candidate manifest supplies the following tag blobs for review traceability. Selected API declarations and management/target/clear-ended behavior were adapted into the fork's current files; existing timing arithmetic, timer teardown, ownership and persistence handling were retained. The tag's RRule, schedule/resolve-agent, actor-id authority assumptions and broader notification/workspace integration were not imported. Runtime/index tag excerpts were rechecked directly during final review.

| Candidate path | Accepted tag blob |
| --- | --- |
| `packages/schedule/schedule/src/types.ts` | `b4920e92030905e483ee2fd7d3364591f033b890` |
| `packages/schedule/schedule/src/storage.ts` | `9f0534c5e84b49532abcca7bc1bf7bfc24082135` |
| `packages/schedule/schedule/src/index.ts` | `36b6eaaf91ba8a78b7f20276da10e2409213bf31` |
| `packages/schedule/schedule/src/runtime.ts` | `e15aa2d74666a8fea8d1bb044abe796d7a423293` |
| `packages/schedule/schedule/src/update.ts` | `39fef6049c09d2dc5dd473ad428e105cbff56838` |
| `packages/schedule/schedule/src/delivery-history.ts` | `89048942206af0fd219c19ee391657e55a91bffd` |
| `packages/schedule/schedule/src/domain.ts` | `f90f79514d26332762d456957708cc650b38f113` |
| `packages/schedule/tool-schedule/src/index.ts` | `ab1ed612dcdd35811cefe842e01dcaec680b5140` |
| `packages/schedule/AGENTS.md` | `5f00a7b14cc27e10b1a73a9f3fc415603788ad3d` |
| `packages/client/ui-schedule/src/client/index.ts` | `5df353095f92706bc2bac5e077305d54d16074c1` |
| `packages/client/ui-schedule/src/client/TaskManagerPage.tsx` | `53a53fe9d44df92991248a9050251c3fb9672d29` |
| `packages/client/ui-schedule/src/client/TaskDetail.tsx` | `cafd8023780f490b531692bdc7a5ea28338d4aa2` |
| `packages/client/ui-schedule/src/client/catalog-source.ts` | `575a19d2bc8db9aaedb216545e71825337b20c8c` |
| `packages/client/ui-schedule/src/client/task-manager-locales.ts` | `13ef7c905203b4da794cf6eb05bf314ed6915b7f` |
| `packages/client/ui-schedule/src/client/session-schedule-state.ts` | `cc27321f00776f6618ba65876cf660759e6b8e82` |
| `apps/web/tests/schedule-after.e2e.ts` | `34cbaf4155965af1655aa9d2f35e95e59b2848c7` |
| `packages/subagent/subagent-in-process-driver/tests/schedule-tools.spec.ts` | `no tag blob; authored fork test` |
| `packages/client/ui-schedule/src/client/clear-ended.ts` | `007d2b18d0994238ea4eb074e1dff2ccffcee063` |
| `packages/client/ui-schedule/src/client/task-record.ts` | `abb6a965f606a75c3a7cbfd8ce57d3a6a4ca481b` |
| `packages/schedule/schedule/tests/management.spec.ts` | `90215582bfa95d92d20b1cb2e12d76d793f7121e` |
| `packages/schedule/schedule/tests/targets.spec.ts` | `6b1d431e97b24a438d4943b550d0d1ac8e9f4a1d` |
| `packages/schedule/schedule/tests/storage-evolution.spec.ts` | `d2370ad52622e4c5d3a861c22d9fd955e30d0af7` |
| `packages/schedule/schedule/tests/target-restart.spec.ts` | `da973e0a84d31c1581946c892e797c6395cd797d` |
| `packages/schedule/schedule/tests/host-controllers.spec.ts` | `no tag blob; authored fork test` |
| `packages/client/ui-schedule/tests/host-task-editor.client.spec.tsx` | `2eb815b6d94634a31c2914d5489da1ca75650669` |
| `packages/client/ui-schedule/tests/clear-ended.client.spec.ts` | `ef943688b02063defcfc912086b3a0f09c213cb7` |
| `apps/web/tests/schedule-manual.e2e.ts` | `cde9828a5db3e97bb39b35e59aeeb8149d0479ca` |

## Root-owned integration and limits

Root owns shared API remote exports/generation, manifests/lockfile/compiler aggregates, preset consumers and catalog generation, distribution pins, registry entries, all emitted outputs, browser/SDK/CLI process checks, final standard-heap build acceptance and bilingual pair metadata. The schedule/input-invalid declaration needs the next Host type emit/remote generation before downstream emitted types are authoritative. Root already generated schedule remotes and migrated shared preset/tool-catalog consumers; regenerate after final source review if required. Product version stays 0.2.1-alpha.1 and UPSTREAM_PIN/basePin stays alpha.

The authored dated persistence prose was moved by root to docs/upgrade-guide/v0.2.1-alpha.1/schedule-tasks/storage.md and storage.zh.md because Host domain rows are not machine-extracted Session persistence roots. Do not fabricate a top-level persistence schema record: root owns the extractor/acknowledgement decision. The guide pair documents current API migration and at-least-once limitations. Pair metadata/generators were not run here.

Root approved and the worker updated docs/subsystems/schedule.md and schedule.zh.md storage/target/tool/remotes/management prose and current verbatim type declarations. Historical schedule/change declarations and timing rationale remain; generated Cordis regions were not edited. The exact type-equiv replacement symbols are in rc1-s1-subsystem-symbols.json, and root updated the shared manifest/type-link registrations. No omitted consumer/golden is silently treated as migrated. Host-running dependency, bounded retained receipts, possible repeat delivery after crashes and queued input surviving deletion remain explicit product limits.

The post-initialization runtime field is definite, and a separately optional local capture owns cleanup before initialization completes. Root explicitly reviewed this simplification; run waits for initialization and has no unreachable runtime-missing branch. Real teardown, failed initialization, FIFO admission and closed-domain refusals remain covered. No coverage exclusion, threshold reduction, ignore waiver or private-state test was added.

## Exact changed-file snapshot

SHA-256 values below cover the worker's changed files and approved extensions. ui-conversation/locales.ts is shared: only additive Schedule view/edit/status/destination keys belong to this worker; its complete hash includes other owners' changes. Root moved storage prose and owns generated/pair metadata files. The Schedule subsystem pair contains root-owned generated Cordis regions; those and the shared locale full-file hashes are not claimed as worker-exclusive modifications. The report and execution logs are evidence artifacts, not product source.

| File | SHA-256 |
| --- | --- |
| `apps/cli/tests/profiles/web/tests/schedule-timing.expected.e2e.ts` | `ee03ec2f3f9baa555cc0336f669f092a8383682146f5485de253488178c36ced` |
| `apps/web/tests/schedule-after.e2e.ts` | `8d286abeee0cceee9b29cd97ac27d3ada660e633557b9643ca121c13902d6a87` |
| `apps/web/tests/schedule-manual.e2e.ts` | `5bf1b9925f8ce0b7ab959c7d9044ae72d6c4da736e940b23c37c0f8ebd0de356` |
| `docs/subsystems/schedule.md` | `96edab8fbaecd788312aae1528fad5223eca29f0e8e606d81c97f3ab1a80af29` |
| `docs/subsystems/schedule.zh.md` | `49a142430c46c3dc5144003ba09f7419ecef750c2c1a5ca78cf8dcedbb0100e7` |
| `docs/upgrade-guide/v0.2.1-alpha.1/schedule-tasks/guide.md` | `e487844c07aed2c9cdd1c9d8dece279829703c9cba19eb42eb6ede3b8c88c11e` |
| `docs/upgrade-guide/v0.2.1-alpha.1/schedule-tasks/guide.zh.md` | `1307ce673c894d982f3f24c21dd7bd5236d0bd3995cc4453bad79e2f7d54eb28` |
| `docs/upgrade-guide/v0.2.1-alpha.1/schedule-tasks/storage.md` | `a142c26323d36c90487e0b4f04935bdf0d599b5ef1b071be5f1b96025e14455b` |
| `docs/upgrade-guide/v0.2.1-alpha.1/schedule-tasks/storage.zh.md` | `2a79b73d3fc02cfd8a8db6ad6b529d2e77d18267c58084bee6e1b004b61b6c3f` |
| `packages/client/ui-conversation/src/client/locales.ts` | `fa7211d658018ee98c7f850cc0e7be9a7a0e7409c2d6ac4c9f35f81a478da9cc` |
| `packages/client/ui-schedule/README.md` | `030e7b8641c1c5def82a4952c7b8b52c9191ad47d2fe74acfffde3b577c2eed5` |
| `packages/client/ui-schedule/README.zh.md` | `b61c53cb4ba20f6499848c13db4f5ad022fc8730656176a07dec365492cc3d81` |
| `packages/client/ui-schedule/src/client/DeliveryHistory.tsx` | `079938c5e8971ee698e761dab52dc763342c059ea95ba05590644fd0e1e50ab3` |
| `packages/client/ui-schedule/src/client/TaskDetail.tsx` | `d748ca2c96c3174efc57b4cb22060c391001a32f5184136097f25d0c7e7ca386` |
| `packages/client/ui-schedule/src/client/TaskManagerPage.tsx` | `98e8cb2c0512f5616ca0f6452863a455c191291e17d092d5828ab4fe7ceb719d` |
| `packages/client/ui-schedule/src/client/catalog-source.ts` | `ec6bc83e3d7cec4d22fc5d9cda4c3b5f203bd498d6aac20f380dc9e123fab6a6` |
| `packages/client/ui-schedule/src/client/clear-ended.ts` | `8c2795509a9dad4d34691ffd9d8e3c0900438dddeb4c234ef89c03afcdda12a6` |
| `packages/client/ui-schedule/src/client/index.ts` | `d78e332eec2dd47c5c341ce071ed5cc19e379f8e9a695d9083da46569f544e06` |
| `packages/client/ui-schedule/src/client/session-schedule-state.ts` | `e0df7122baa693a7475897299207f2dee27b9233022df3bb96aef7dfc9a8d6ec` |
| `packages/client/ui-schedule/src/client/task-manager-locales.ts` | `d841f51e2447e1fc36cc109db6b24ced360e4a3a548799fc99d050932a1a5eb6` |
| `packages/client/ui-schedule/src/client/task-record.ts` | `64f732a105f169f00179c271f4cd6decebe213f8387e94f2d21c0071b43c622d` |
| `packages/client/ui-schedule/src/client/task-timing.ts` | `4ada33e988092ca2f96c65e6e697a821fba0d7ef3ae204288a6136d09bafa508` |
| `packages/client/ui-schedule/tests/browser-plugin.client.spec.ts` | `9350a6bfeafdf9fd471e13d27016ab011332b21aad89c5181d5a6a3b247037e2` |
| `packages/client/ui-schedule/tests/catalog-source.client.spec.ts` | `0c2cb7a8798a26c72312dca4a98d8fd4ea728487087944126b4ee014b61e7b1d` |
| `packages/client/ui-schedule/tests/clear-ended.client.spec.ts` | `cd3b10fa0d6bc96fd32418c5c7248c19b13e101b025e0e8452ea7ce9233af295` |
| `packages/client/ui-schedule/tests/delivery-history.client.spec.tsx` | `cb181e810f4ec60f7e476c4b78a9764724e46d46bccf699df1d61cfa97d9ee28` |
| `packages/client/ui-schedule/tests/host-task-editor.client.spec.tsx` | `3f23b034ab2f8809b9c0c5eb0776729da5db3a3a82cb0a86f62bd3808c49f739` |
| `packages/client/ui-schedule/tests/schedule-create-card.client.spec.tsx` | `c1ecaf3d61405d6c462cbce80d47dee8383c984691ada12f71ed43068bca1f30` |
| `packages/client/ui-schedule/tests/schedule-task-tab.client.spec.tsx` | `f350ba104b0cc9f9056cf4f2639b396be5790ee06b903a32a237ee976126aef7` |
| `packages/client/ui-schedule/tests/schedule-turn-card.client.spec.tsx` | `ecaa211c382877b098c5cf437669c5ff84fa78e98c10fe0dbc4fc60ff657c684` |
| `packages/client/ui-schedule/tests/session-schedule-hover.client.spec.tsx` | `8f0821b57d05708b169aa5bfcb67ff11fd55e113d459866d6c9e4625942d28dd` |
| `packages/client/ui-schedule/tests/session-schedule-mark.client.spec.tsx` | `f27b3fbd8375cef2808d043f8ad62b7bff3f456ea3406552bc2b25958a5d99c0` |
| `packages/client/ui-schedule/tests/session-schedule-shared.client.spec.tsx` | `2b7bd192f039c5891ebf11d1decc383255beb5b30e72b2865a5a3616e4627cdf` |
| `packages/client/ui-schedule/tests/session-schedule-state.client.spec.ts` | `2402479e40798e67986cd517e59ae1f08592bc42873beffdee0a85d42c723dbd` |
| `packages/client/ui-schedule/tests/task-detail.client.spec.tsx` | `dbc34ac7e51ec3107c6fdf51ffc84ee19b30c6ae03138eb721706ba89facebb0` |
| `packages/client/ui-schedule/tests/task-manager-page.client.spec.tsx` | `f88ac3359b389907770a8ff7befa2923d6a699fb5dcfbc9b0d7406fb1a28f8a2` |
| `packages/client/ui-schedule/tests/task-timing.client.spec.tsx` | `a3d38f36ec13409ff59ac3de323bae1def551bd6fcc615de17fb20462bdc1d99` |
| `packages/client/ui-tool/README.md` | `8b8398f05587cf22f12feb7f84699ec790ddf6f4cf19a1fcd2bcb590bee523e0` |
| `packages/client/ui-tool/README.zh.md` | `1054efaed5c8d69ea7331b05fc04a6a71e62db59c0197ee488117632a7fb085d` |
| `packages/client/ui-tool/src/client/tool/models/details-card-model.ts` | `6be5c91e9c6d3f4a2e177a06a322d73ad515bf6e6bf42f15b6a5c311a955af36` |
| `packages/client/ui-tool/src/client/tool/models/tool-call-model.ts` | `f190a177355c68cac3027a6ab1716bc6121ab7d805ae0f8ec44dc9588d3f318d` |
| `packages/client/ui-tool/src/client/tool/toolviews/details-row.tsx` | `2c5aa87082f8311e3dca77df234d14668991208c448d5bb2e6a2b7083e63e8b1` |
| `packages/client/ui-tool/tests/details-row.client.spec.tsx` | `a0a86b7e053f92b2ae6f20a9ecb1be092a84a784570f8335cf0a1a251a462434` |
| `packages/schedule/AGENTS.md` | `0d8fb18449199cfe74f6ca3ac614dcb69dafefe1ca157072c54a91ebf6222075` |
| `packages/schedule/schedule/README.md` | `ae2296ab4f488d658a1f7309576b987600d9221db050c06f2b2a049e6cb5c72f` |
| `packages/schedule/schedule/README.zh.md` | `5781cb66264bcae82e67d15180b610d6437a5e90a3015037659f0f03d17b2de7` |
| `packages/schedule/schedule/src/delivery-history.ts` | `e185c9aa26ca4fd8e9d31306ba742d91e2d936242884eea99ce377651a4b5e15` |
| `packages/schedule/schedule/src/domain.ts` | `f7e8de35128a06ba2c826131fd23067960c11ee01a03ddada7602e91018a5e03` |
| `packages/schedule/schedule/src/index.ts` | `43ddbb30eadbc86dd65777534f635579c0ef1bc6b253578090890f7696b3d9e0` |
| `packages/schedule/schedule/src/runtime.ts` | `1fb358cbdcfcecbe7a61b6459fdb48304b079cc71ea8f3ae18f1921ebf5ef90d` |
| `packages/schedule/schedule/src/storage.ts` | `a34c322ab01358a22fa425135f1485ce5526b08100409f1c8d7fdebbbe2d57a2` |
| `packages/schedule/schedule/src/types.ts` | `676a7c889dfacbd99d961a532dcb6ceb30a784d9ad038d2565153f8be6447dc6` |
| `packages/schedule/schedule/src/update.ts` | `45aa6bc9ebf13658d5edf0b4b6f23d10c6086343d0005b1880f376ea0217d3eb` |
| `packages/schedule/schedule/tests/cron.spec.ts` | `4317f3cccdca1f7f5add09945fe2a73b0d1f792d53096454164852c6418422e0` |
| `packages/schedule/schedule/tests/delivery-history.spec.ts` | `c17265f741a7d654def862d6160e78de59b8983e12df16eee04b2bd01cbd3383` |
| `packages/schedule/schedule/tests/delivery.spec.ts` | `08b5c244d2ef7a4b86cd35032e2b6b5735d209dc1d58671237ed8a26f8321282` |
| `packages/schedule/schedule/tests/domain-restart.spec.ts` | `abcc11b48bd7383c71e26dc61673b8f2b6a5dead5091890ed43b2ffb59fe5db8` |
| `packages/schedule/schedule/tests/harness.ts` | `734e10cfc5dac69c201ad6b480f215d2eb4e585b5000aed8218b769b4f9f58c3` |
| `packages/schedule/schedule/tests/host-controllers.spec.ts` | `07ff78114fb3555acdb864d85a36faac3dd3f4c0fa4c7094942464ae517063e0` |
| `packages/schedule/schedule/tests/legacy-history.spec.ts` | `302c1a47dfadbd8b0ac8cdb92350b152f9fdd003fa266e1ffcf3d3c8c9c1eb9e` |
| `packages/schedule/schedule/tests/malformed-unit.spec.ts` | `849e8edef1c65eec0759e240bf67531e284f78169530215ef24e006482975027` |
| `packages/schedule/schedule/tests/management.spec.ts` | `60bd3149c90e2f836b143d047fde93881519c194daf5394724360af605c9c21e` |
| `packages/schedule/schedule/tests/plugin.spec.ts` | `82c2a514a9f66e39517e6cf577cd163f2136844aeda23bb3f5872b8942a28297` |
| `packages/schedule/schedule/tests/recovery.spec.ts` | `d64bc3f351b54046a0cff16d46bfcd13f0656a9f3dd27e33c7edcc64647b0834` |
| `packages/schedule/schedule/tests/runtime.spec.ts` | `2a7b9b7345c4437a76a0eb2fddd8dafbd276a523a04d874fb283780230ab147d` |
| `packages/schedule/schedule/tests/serial-delivery.spec.ts` | `64b570a79c2e714e69c606751cdc3c384d7ab17f34a57f8700d62042100562d4` |
| `packages/schedule/schedule/tests/storage-evolution.spec.ts` | `1c59871680a813e9c73af775fc6b371d72baa23ec10043b9cfe686a885bf7079` |
| `packages/schedule/schedule/tests/subagent-ownership.spec.ts` | `ca2166487a26d4d5266f63cb66a7bbfcc9a49bf76b8cd392af278397602f66bc` |
| `packages/schedule/schedule/tests/target-restart.spec.ts` | `4d54f02e2ac788fedbd634925d1c5bda743996ce318c7b3f823083b0597c74dc` |
| `packages/schedule/schedule/tests/targets.spec.ts` | `ea7865d0794f245a8bd1163d6b1555cc19d1ee21184251ec74a7a08f95382526` |
| `packages/schedule/schedule/tests/update-restart.spec.ts` | `1d3053a6339106a770c94893895b4fd2891617642efe1c6b246e2aa53c4f2778` |
| `packages/schedule/schedule/tests/update-service.spec.ts` | `a9d6200d738d1c65f48917c9e8fc05baac656cac9b8257206173a9858d7c261b` |
| `packages/schedule/schedule/tests/update.spec.ts` | `b13e86eb3259d7bb8dda8164d091b90594e2d34fc98309a5950bdb9aef9729a2` |
| `packages/schedule/schedule/tests/weekly.spec.ts` | `b01ac23f591c6835535eb3a9aefaa188896bbaa2b3b2c77fc24701bc754462c3` |
| `packages/schedule/tool-schedule/README.md` | `1e8b104312b44b6a587ae9c1e525e7ef0aad56971cc17c0a2269d3fc88bcb19a` |
| `packages/schedule/tool-schedule/README.zh.md` | `f7a8a369d06c23d24db50964a1428f8f32baea1092f5b805131ee4e4e95c0b81` |
| `packages/schedule/tool-schedule/src/index.ts` | `0a043ab2ee8428a0384226014269f4e8477ee79a8613403c1e25d58d7f3ac141` |
| `packages/schedule/tool-schedule/tests/tool-schedule.spec.ts` | `10c88cffb69f9facf1f746a93c1cbb3da3345f2920007a7205b459f74867565a` |
| `packages/storage/storage-domain/README.md` | `dc33a055b8fbdb17ad5e156f76ff9d49bf8acd9c648609d1e382ec93efd81e0d` |
| `packages/storage/storage-domain/README.zh.md` | `2a1d4a9892264abb39ea95258737d07353eb56c184b88b319b14bf94ef293255` |
| `packages/storage/storage-domain/src/spec.ts` | `5efbc69bb3b41a31790dc6a42e9384717be2192b5ee0c8af2244fcf7f6386f60` |
| `packages/storage/storage-domain/tests/helpers/memory-backend.ts` | `c9818612f865bf2e5f716886e5f03cad68aff82e3cd4a429acbc8f5018a7f535` |
| `packages/storage/storage-json/README.md` | `03bb0ea83b67c441b170bdee2bb0e2cce82819b67f40872c2f43fc63779738e0` |
| `packages/storage/storage-json/README.zh.md` | `ccc0040c719f9b9a02bef7851278880903a84833c38bf2f0316d42076ba4f37d` |
| `packages/storage/storage-json/src/format.ts` | `92ceae0f45ebbf6251c8d4531b0ca5bef01cb85c910091160b8e782df740a85c` |
| `packages/storage/storage-json/src/single-unit.ts` | `835aaa1688b52cff333fc4cba7b80606c899ec0ff6c89dfe504760131591cba0` |
| `packages/storage/storage-json/tests/json-backend.spec.ts` | `cd7f1f796591a345b9cdc1b6b6ece773fb50450fa2d4b815b99239101026f340` |
| `packages/storage/storage/README.md` | `3830a43cf66a1466eaa3f69ef9fda69492a7606a8b668ccc2c757b7f042b52d6` |
| `packages/storage/storage/README.zh.md` | `ad967eb96aa4cb0b36d5081005f186477d05c0d23aa3e32bfd39ce0a3e21a13a` |
| `packages/storage/storage/src/backend.ts` | `2afadd441ad0d721a42de76ee0f02f6db709643f9320e4c3b64f84c6d95733ff` |
| `packages/subagent/subagent-in-process-driver/tests/schedule-tools.spec.ts` | `9ee0402fc275165d9ff71a073e1c4b2eb5dc01a3c3503332a2572cf34b0fb530` |
