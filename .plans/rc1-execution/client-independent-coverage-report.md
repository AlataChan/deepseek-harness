# RC1-05/06/07/08 independent Client coverage qualification

**Final scoped V8 measurement passed: 226 files / 3,948 tests, exit 0, and 100% lines/statements/functions/branches in every measured file.** Typed lint exited 0 with zero diagnostics across all 26 changed TypeScript files. Root remains the final reviewer and build/browser/acceptance owner. **Coverage of all changed executable source is not established:** the unchanged repository exclusions omit 29 executable files.

## Scope and exact evidence

The original manifest plus mobile useModalLayer contains 60 unique TS/TSX source paths. Root approved one new sidebar capacity helper, making the final include inventory **61 paths: 53 executable and eight type-only**. V8 reports **29 rows: 24 executable modules plus five empty type-only projections**. Its existing exclusions omit 29 executable files and three type-only modules. Empty type-only rows and absent executable files are not evidence of executable coverage. All 61 source hashes match the hashes captured before the final run; [source-freeze-check.json](client-independent-coverage/source-freeze-check.json) records that comparison and the unchanged-config identity.

The baseline used all existing tests under ui-conversation, ui-chat, ui-sidebar, ui-trajectory, message-quotes, ui-primitives and API session-controller, without replacing old owner coverage. It ran 220 files / 3,913 tests: 3,908 passed and five failed; 13 measured files missed at least one per-file 100% metric, and V8 exited 1. The final command retains those seven complete directories and additionally includes root's requested versions fixture suite. It reports zero test failures and zero measured coverage gaps. Final aggregate counts, shown only for reconciliation, are lines 738/738, statements 882/882, functions 228/228, branches 586/586; all are 100%.

Exact executable/argv are in [baseline-command.json](client-independent-coverage/baseline-command.json), [final-command.json](client-independent-coverage/final-command.json) and [lint-command.json](client-independent-coverage/lint-command.json). Both coverage commands load the actual repository vitest.config.ts and V8 provider with unchanged exclusions and per-file 100% thresholds. CLI options scope includes, isolate report paths, select JSON/text reporters and retain reports on failure. No partition mode, deadline increase, exclusion change, skip, waiver or threshold override was used.

- Baseline: [baseline.log](client-independent-coverage/baseline.log), [exit 1](client-independent-coverage/baseline-exit.json), [raw summary](client-independent-coverage/baseline/coverage-summary.json), [raw counters](client-independent-coverage/baseline/coverage-final.json), [exact gaps](client-independent-coverage/baseline-gaps.json).
- Final integrated evidence: [final.log](client-independent-coverage/final.log), [exit 0](client-independent-coverage/final-exit.json), [raw summary](client-independent-coverage/final/coverage-summary.json), [raw counters](client-independent-coverage/final/coverage-final.json), [empty final gaps](client-independent-coverage/final-gaps.json).
- Final typed lint: [lint-final-qualified.json](client-independent-coverage/lint-final-qualified.json), [exit 0](client-independent-coverage/lint-final-qualified-exit.json); 26 files, zero diagnostics.
- Exact final source inventory and identities: [source-inventory.json](client-independent-coverage/source-inventory.json), [final-source-hashes.json](client-independent-coverage/final-source-hashes.json). Worker file identities, before SHA-256 and final computed Git blob identities: [worker-files.json](client-independent-coverage/worker-files.json).

Final runner output:

```text
Test Files  226 passed (226)
      Tests  3948 passed (3948)
   Start at  12:57:47
   Duration  112.51s (transform 23.64s, setup 7.82s, import 239.06s, tests 107.17s, environment 132.80s)
```

## Implemented behavior coverage and approved fixes

Tests added or extended cover concurrent distinct Host reservations and independent settlement, no early inbox delivery, duplicate retry receipts, verbatim human text, quote removal default/propagation behavior, literal quote rendering around wire-session and skill references, empty excerpts, actual quote-plugin keyed registration and locale unload/reload, actual assembled Chinese folding settings, independent/idempotent preference persistence, pin subscription/reset/repin lifetimes, stale More choices after actual panel-plugin unload, fallback navigation without ResizeObserver, and Files/Sessions navigation with retained outlets.

The five initial API failures were current compatibility failures; they are not labeled historically preexisting. Root approved the three extra API filenames. Three Session expectations were obsolete because prompt engagement now follows Host acceptance: deferred remote settlement proves no early promptAttempted/awaitingFirstTurn state, while rejection/retry checks retain the human text. The ask-data test had a ctx.get spy that accidentally hid every service; it now disposes only the real agentPresets registration and preserves the original gateway/internal error expectation. The persisted-preset fixture now reads the actual registered preset projection instead of omitting presetOf. Root requested versions.client.spec.tsx's fixture repair; it now uses makeTranslate with real feature/common dictionaries rather than narrowing away common keys. No casts or weakened outcomes were introduced.

Root approved a private user-text.tsx simplification after two concrete unreachable-source findings: quote/session ranges require display text, quote rendering has no impossible missing-display fallback, and equal-position ordering distinguishes session-before-plain because quote prefixes cannot share start offsets with @ or / ranges. Literal quoted wire references and outside reference precedence have real-input regressions. Public Markdown output, fields and events are unchanged. Root also approved JSDoc/return-annotation-only fixes in text-interaction.ts, draft.ts, runtime.ts, view-binding.ts and focus.ts for the ten exported-documentation findings; root owns their repository gate execution.

### Observed delayed mobile unlock defect

Root's rebuilt-browser diagnostic, read from mobile-built-focus-diagnostic.log, showed the actual Modal returning focus to a composer DIV while contentEditable=false/readWrite=false; asynchronous workspace adoption enabled that same node after closure. This exposed a real product gap in the prior enable-before/at-close fix. Worker added actual Modal close-then-unlock cases for input, textarea, contenteditable and semantic textbox: before the fix, four failed / 19 passed ([mobile-deferred-unlock-before.log](client-independent-coverage/mobile-deferred-unlock-before.log)). The approved useModalLayer extension captures semantic text-entry identity on entry and, on mobile, suppresses automatic restoration to that same initially noneditable opener even while it remains readonly at close. Ordinary buttons and previously editable controls retain restoration; desktop restoration remains unchanged. No composer-specific attribute or coupling was added.

After the fix, Modal/InputBar/editor-viewport suites passed 127 tests ([mobile-deferred-unlock-after.log](client-independent-coverage/mobile-deferred-unlock-after.log)). Primitive README and composer-admission upgrade-guide pairs now state the delayed-unlock behavior precisely. Root must record both bilingual pairs and owns the rebuilt Chromium/WebKit acceptance; worker ran no browser/E2E and did not alter the initial-focus assertion or browser test source.

Device identification tests exercise the real helper with explicit navigator metadata fixtures, restore globals, isolate module caching, and distinguish mobile UAs and touch-capable MacIntel from desktop metadata. The Modal null-activeElement fallback uses a real iframe document with its body removed, actual focus acquisition, Escape and listener removal; no activeElement getter or private layer state is mocked. These establish unit behavior, not physical-device acceptance.

### Sidebar layout qualification

Frozen-source inspection showed two older uncovered Sidebar actions: task-start Sessions-tab callback line 360 matches frozen line 313, and task-start files-region expandSidebar no-op line 385 matches frozen line 338. Both now execute through owner navigation tests. The other layout, missing-ResizeObserver and stale-panel paths were introduced source, not baseline exemptions; no new gap was misclassified as inherited.

Root approved extraction of the existing height arithmetic into panel-capacity.ts, preserving previous capacity at zero height and at least one complete launcher for positive height. Seven numeric cases exercise actual threshold behavior without fabricating DOM clientHeight. Root then approved assertion-free callback-ref state: the initial null effect pass is real, observer setup/cleanup follows the adopted column, and the existing pointer observer reads that same column with matching dependencies. No non-null assertion or type-cast workaround remains. Root retains real built-browser geometry qualification.

The final focused primitive/sidebar run passed 73 files / 1,441 tests and strict 100% on focus.ts, useModalLayer.ts, SidebarRoot.tsx and panel-capacity.ts: [callback-ref-qualified.log](client-independent-coverage/callback-ref-qualified.log). These focused counts overlap the integrated run and are not a distinct aggregate.

## Independent baseline evidence and measurement history

Root explicitly approved only git rev-parse f10cfa2ca1 and git show f10cfa2ca1:<the four requested source paths>. [frozen-baseline/commands.json](client-independent-coverage/frozen-baseline/commands.json) records the resolved revision and exact commands; original snapshots, diffs and line correspondences are retained there. Final diffs are named *.final.diff. This proves source attribution, not a historical old-revision coverage run; no historical coverage percentage is claimed. No other Git operation or source-ref intake was performed.

The initial incomplete coverage attempt was terminated because Vitest's default suppresses reporting when tests fail; initial-interrupted.log/exit are not a completed measurement. Intermediate before-simplification, before-mobile-fix and before-callback-ref runs retain their exact observed results, including strict coverage exit 1 where applicable. They are superseded by final/. The rejected non-null assertion is retained in earlier lint evidence and was replaced with the approved typed representation, without a suppression. Repeated green checks are counted only as overlapping verification after actual source changes.

## Exact per-file coverage

Metrics are **lines / statements / functions / branches**. Empty type-only rows reconcile the raw report and do not enlarge the executable denominator.

| File | Baseline | Final |
| --- | --- | --- |
| `packages/api/session-controller/src/commands.ts` | 100% / 100% / 100% / 99.55% | 100% / 100% / 100% / 100% |
| `packages/api/session-controller/src/client/contract/session.ts` | 100% / 100% / 100% / 100% | 100% / 100% / 100% / 100% |
| `packages/api/session-controller/src/client/contract/snapshot.ts` | 100% / 100% / 100% / 100% | 100% / 100% / 100% / 100% |
| `packages/client/ui-chat/src/chat-settings.ts` | 100% / 100% / 100% / 100% | 100% / 100% / 100% / 100% |
| `packages/client/ui-chat/src/client/apply.ts` | 98.29% / 98.57% / 96.72% / 100% | 100% / 100% / 100% / 100% |
| `packages/client/ui-chat/src/client/locale.ts` | 100% / 100% / 100% / 100% | 100% / 100% / 100% / 100% |
| `packages/client/ui-chat/src/client/presentation-policy.ts` | 100% / 100% / 100% / 100% | 100% / 100% / 100% / 100% |
| `packages/client/ui-chat/src/client/stores.ts` | 100% / 100% / 100% / 100% | 100% / 100% / 100% / 100% |
| `packages/client/ui-chat/src/client/transcript-view.ts` | 100% / 93.33% / 100% / 90.47% | 100% / 100% / 100% / 100% |
| `packages/client/ui-chat/src/client/contract/slots.ts` | 100% / 100% / 100% / 100% | 100% / 100% / 100% / 100% |
| `packages/client/ui-chat/src/client/contract/store.ts` | 100% / 100% / 100% / 100% | 100% / 100% / 100% / 100% |
| `packages/client/ui-chat/src/client/settings/TranscriptViewRow.tsx` | 84.61% / 87.5% / 80% / 100% | 100% / 100% / 100% / 100% |
| `packages/client/ui-primitives/src/QuotePreview.tsx` | 33.33% / 16.66% / 33.33% / 100% | 100% / 100% / 100% / 100% |
| `packages/client/ui-primitives/src/focus.ts` | 100% / 100% / 100% / 92.85% | 100% / 100% / 100% / 100% |
| `packages/client/ui-primitives/src/index.ts` | 100% / 100% / 100% / 100% | 100% / 100% / 100% / 100% |
| `packages/client/ui-primitives/src/useAnchoredPosition.ts` | 100% / 100% / 100% / 100% | 100% / 100% / 100% / 100% |
| `packages/client/ui-primitives/src/useModalLayer.ts` | 100% / 100% / 100% / 98.52% | 100% / 100% / 100% / 100% |
| `packages/client/ui-primitives/src/user-text.tsx` | 100% / 100% / 100% / 95.58% | 100% / 100% / 100% / 100% |
| `packages/client/ui-primitives/src/markdown/quote-text.ts` | 100% / 100% / 100% / 100% | 100% / 100% / 100% / 100% |
| `packages/client/ui-sidebar/src/client/SidebarRoot.tsx` | 98.94% / 97.63% / 98% / 95.79% | 100% / 100% / 100% / 100% |
| `packages/client/ui-sidebar/src/client/locales.ts` | 100% / 100% / 100% / 100% | 100% / 100% / 100% / 100% |
| `packages/client/ui-sidebar/src/client/panel-capacity.ts` | New helper; absent | 100% / 100% / 100% / 100% |
| `packages/client/ui-sidebar/src/client/panel-pins.ts` | 100% / 81.81% / 80% / 66.66% | 100% / 100% / 100% / 100% |
| `packages/client/ui-sidebar/src/client/contract/slots.ts` | 100% / 100% / 100% / 100% | 100% / 100% / 100% / 100% |
| `packages/session/message-quotes/src/index.ts` | 100% / 100% / 0% / 100% | 100% / 100% / 100% / 100% |
| `packages/session/message-quotes/src/client/QuoteSelection.tsx` | 100% / 100% / 100% / 100% | 100% / 100% / 100% / 100% |
| `packages/session/message-quotes/src/client/index.ts` | 0% / 0% / 0% / 100% | 100% / 100% / 100% / 100% |
| `packages/session/message-quotes/src/client/locales.ts` | 0% / 0% / 100% / 100% | 100% / 100% / 100% / 100% |
| `packages/session/message-quotes/src/client/quote-text.ts` | 100% / 100% / 100% / 100% | 100% / 100% / 100% / 100% |

## Executable source omitted by unchanged exclusions

The following 29 changed executable files were supplied as includes but do not appear in the actual V8 report. Their unit suites execute where applicable, but strict per-file coverage for these files is not established. Existing ui-conversation, Chat-presentation, Session-internals, sidebar-entry and Trajectory exclusions were retained.

- `packages/api/session-controller/src/client/sessions/session.ts`
- `packages/client/ui-conversation/src/client/input/editor/view-binding.ts`
- `packages/client/ui-conversation/src/client/input/facade.ts`
- `packages/client/ui-conversation/src/client/input/machine.ts`
- `packages/client/ui-conversation/src/client/locales.ts`
- `packages/client/ui-conversation/src/client/service.ts`
- `packages/client/ui-conversation/src/client/skeleton/InputBar.tsx`
- `packages/client/ui-chat/src/client/chat/ChatView.tsx`
- `packages/client/ui-chat/src/client/chat/text-interaction.ts`
- `packages/client/ui-chat/src/client/chat/text-selection.ts`
- `packages/client/ui-conversation/src/client/apply.ts`
- `packages/client/ui-conversation/src/client/draft.ts`
- `packages/client/ui-conversation/src/client/input/editor/QuoteNode.tsx`
- `packages/client/ui-conversation/src/client/input/editor/keymap.ts`
- `packages/client/ui-conversation/src/client/input/editor/projection.ts`
- `packages/client/ui-conversation/src/client/input/editor/runtime.ts`
- `packages/client/ui-conversation/src/client/input/hub.ts`
- `packages/client/ui-conversation/src/client/input/prompt.ts`
- `packages/client/ui-chat/src/client/chat/AssistantNodeView.tsx`
- `packages/client/ui-chat/src/client/chat/ChatGroupSeat.tsx`
- `packages/client/ui-chat/src/client/chat/ChatNodeSeat.tsx`
- `packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx`
- `packages/client/ui-conversation/src/client/view-pins.ts`
- `packages/client/ui-sidebar/src/client/index.ts`
- `packages/client/ui-trajectory/src/client/TrajectoryTable.tsx`
- `packages/client/ui-trajectory/src/client/TrajectoryToolbar.tsx`
- `packages/client/ui-trajectory/src/client/TrajectoryView.tsx`
- `packages/client/ui-trajectory/src/client/locales.ts`
- `packages/client/ui-trajectory/src/client/trajectory-virtual-rows.ts`

## Type-only source

- `packages/api/session-controller/src/client/contract/session.ts` (empty coverage row)
- `packages/api/session-controller/src/client/contract/snapshot.ts` (empty coverage row)
- `packages/client/ui-conversation/src/client/contract/draft-editor.ts` (not reported)
- `packages/client/ui-conversation/src/client/contract/input.ts` (not reported)
- `packages/client/ui-chat/src/client/contract/slots.ts` (empty coverage row)
- `packages/client/ui-chat/src/client/contract/store.ts` (empty coverage row)
- `packages/client/ui-conversation/src/client/contract/slots.ts` (not reported)
- `packages/client/ui-sidebar/src/client/contract/slots.ts` (empty coverage row)

## Worker modifications and SHA-256

The following 30 files comprise nine source files, 17 unit tests and four documents. The report and isolated evidence artifacts are additional task outputs. Computed Git blob identities in worker-files.json were calculated from bytes, without Git commands or writes. All existing dirty changes outside the approved edits were preserved.

| Path | Kind | SHA-256 |
| --- | --- | --- |
| `packages/api/session-controller/tests/session.client.spec.ts` | test | `e068d07dc4527a6638ad05c76f114fed5bea90fd216da73c81c770f2b4da1c77` |
| `packages/api/session-controller/tests/session-ask-data.host.spec.ts` | test | `e4c4366907e96b6be445198244f1a378bfb2f2b4914b3f0f72c0d46025b40b4d` |
| `packages/api/session-controller/tests/agent.host.spec.ts` | test | `3d7fc0833abcb9d7d2ccfff986c489845e27b38a99acdce7bebe8c7f69de8432` |
| `packages/api/session-controller/tests/prompt-request-reservation.host.spec.ts` | test | `ab4d842d72fca736969b6120e7a15f2ee2ef304694020ae1f2b358e373dcc0f3` |
| `packages/client/ui-chat/tests/transcript-view-policy.client.spec.ts` | test | `cc46f7b5df8ca55733421ecf171069767fdbdd71d7940c12dfd644e15f2267e4` |
| `packages/client/ui-chat/tests/transcript-view-row.client.spec.tsx` | test | `37e4be8c2dde57931087f40c62ef043c1d19f0f07d27e2df6c8bac0b6d631b13` |
| `packages/client/ui-chat/tests/chat-apply.client.spec.tsx` | test | `60fb1e364134bc6b159ef6c13ad5f2427413088b164e68dcac23fcc5f1e85f9d` |
| `packages/client/ui-sidebar/tests/panel-list.client.spec.tsx` | test | `59cb895b76832fe7caa7f3f523e8e4b8972237b7eb52b1df23b7786eda1a3e01` |
| `packages/client/ui-sidebar/tests/panel-pins.client.spec.ts` | test | `3b64632ba166e626b8049c4df9fb3f1addf7bc9615ca6ac4c142738494fb2616` |
| `packages/client/ui-primitives/tests/quote-preview.client.spec.tsx` | test | `fd10d494c7ad992c73c608d99b2cc3648cb6135e0bc9ec30fe3524906199f54a` |
| `packages/client/ui-primitives/tests/user-text.client.spec.tsx` | test | `d37081e6b17d814fc5e2ae4b68cd10b4b46ffae8621b7bf8614b1376f52c053e` |
| `packages/session/message-quotes/tests/plugin-lifecycle.client.spec.tsx` | test | `d32d65aa28ff5a6d0848f65cdbc5cebc8255af75bfd6fc40f64dff51855e502e` |
| `packages/client/ui-plugin-manager/tests/versions.client.spec.tsx` | test | `f28fa325c7be2c00c126c60ad297925749e8456541d3462e851c9a774d05ee49` |
| `packages/client/ui-primitives/src/user-text.tsx` | source | `6c5b78fa9c9dfa9300cfb4be1f0fb4f50aa0a5b19db4bdb43caa9e4b055c0946` |
| `packages/client/ui-chat/src/client/chat/text-interaction.ts` | source | `d46d275671137104a27b791e0f615b206b5326a81e03b510ad7697680b7af5fb` |
| `packages/client/ui-conversation/src/client/draft.ts` | source | `cca437f8deb702ab5113028f3b9e2d144f9aab0318fbdc75e769bea0913cbcc6` |
| `packages/client/ui-conversation/src/client/input/editor/runtime.ts` | source | `a20da56ba2deeae2637b2fc18c0cb15a16b9f30afc37dc628662ce1d766adde7` |
| `packages/client/ui-conversation/src/client/input/editor/view-binding.ts` | source | `62bac404b937f125eae5375c680bbc7e5094cb8ce881e9b49b5921c4f8571a29` |
| `packages/client/ui-primitives/src/focus.ts` | source | `59f31547338d73180bda39d782ae720bdc398cd7ce98aa4e58727e8b567279f8` |
| `packages/client/ui-primitives/tests/modal-layer.client.spec.tsx` | test | `f8ae7a9e23a31d725a38697fb6582cba64d8a2959e73e909e91f28ebc474fd62` |
| `packages/client/ui-primitives/tests/device-identification.client.spec.ts` | test | `559cfb24ec0fb6b3019d74e74da3df737fafa0b80e24ce91a858c827272c3a37` |
| `packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx` | test | `57edf70fba98e73ee1fa2fcfe2da384615ef672103a28cd0d426cd32261d24f4` |
| `packages/client/ui-sidebar/tests/panel-capacity.client.spec.ts` | test | `7d2567cda93729182227324f31495799ed45f18fe8c576993d8b290b58ff5745` |
| `packages/client/ui-primitives/src/useModalLayer.ts` | source | `75ae821c96332a7edf62e4642403997011fa345d496ce5dedfd73700c8c2cabc` |
| `packages/client/ui-sidebar/src/client/SidebarRoot.tsx` | source | `45a9a3303498d6573c2ec932f9c39c7c8b1f2ad9285f84450918f02bb8842c98` |
| `packages/client/ui-sidebar/src/client/panel-capacity.ts` | source | `1ce48a6c681ae283476f2d377bdc01bb7e9af08f2320def38bc9fbd125470e8f` |
| `packages/client/ui-primitives/README.md` | doc | `79664b7e73bec0bfd5d2756d633d093668d8929ee11f48a800bdd1eecfd65e53` |
| `packages/client/ui-primitives/README.zh.md` | doc | `6f4937a49aa2b3d6da0b1785b2d0323953b9c20c3a806650eadbd7ca9cfe1cbf` |
| `docs/upgrade-guide/v0.2.1-alpha.1/composer-admission/guide.md` | doc | `a412d9490ff24eda8a4ca0b826a6272a13392bef55b85c131e1ae60735ef92e2` |
| `docs/upgrade-guide/v0.2.1-alpha.1/composer-admission/guide.zh.md` | doc | `d164325ea3fcb0c9db8a9eab3a69061748cb16c5d95bdc653b6a5488ff7d3b33` |

## Source ceiling, root wiring and acceptance limits

The accepted item reports/client-final-files.json identify source ceiling dsh-v0.2.2-rc.1 at 66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db, alpha UPSTREAM_PIN/basePin and product version 0.2.1-alpha.1. This task took no new tag source and did not replace fork files wholesale. The approved frozen files were read only for gap attribution; no origin/master source was used. Worker changed no version, pin, shared manifest, lockfile, compiler/profile config, registry or generated output.

Root added message-quotes' @deepseek-ai/dsh-client-store workspace:* devDependency and linked it through install13 for the real Conversation lifecycle test. No other new direct dependency is needed. Root must add panel-capacity.ts and all approved source/test changes to final item/registry ledgers, record the ui-primitives README and composer-admission guide pairs, and run its documentation/export-JSDoc, aggregate compiler, snapshot/browser, generated-output, build, installer and final acceptance checks. Worker claims no pnpm/install, emit/build, generator, snapshot/browser/E2E execution, paid API, real IM send, external network/secret operation, .env read, TCC action, subworker, original-checkout edit or Git mutation.

**Remaining qualification finding:** 29 executable changed files remain excluded by repository policy and therefore unmeasured; full changed-source strict coverage is not established. Measured source has no remaining unit coverage gaps. Actual rebuilt-browser mobile behavior and geometry, physical mobile keyboards, packaging and final shipping acceptance remain root-owned; no final acceptance is inferred from these unit/lint results.
