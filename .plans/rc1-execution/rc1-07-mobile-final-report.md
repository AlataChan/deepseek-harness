# RC1-07 mobile modal focus repair

Worker implementation complete; independent root review and built-browser acceptance remain required.

## Cause and implemented behavior

The prior built run (`client-root-built-browser-2.log`) failed the initial composer no-focus assertion on Chromium-mobile and WebKit-mobile, while desktop passed. InputBar already skips mobile unlock autofocus. Its workspace trigger remains the same DOM element when it becomes editable; useModalLayer saved that noneditable element and unconditionally focused it on close. A regression through the actual Modal reproduced the failure before the fix (1 failed, 16 passed).

useModalLayer now captures whether the saved control matches the browser's `:read-write` selector. On mobile only, it skips automatic restoration when that same connected control changed from noneditable to editable. It keeps desktop restoration, already-editable mobile control restoration, ordinary mobile button/keyboard dismissal, nested-dialog ownership and existing IME/Tab behavior. There are no composer data attributes or composer imports in the primitive. No InputBar, editor runtime or view-binding production edits were needed.

The focused owner test now opens a real Modal from the resident inert InputBar, makes that exact node editable and closes the modal, verifies no automatic mobile focus, then verifies retained text/focus on refusal and card focus after acceptance. Primitive tests cover both separate enable/close updates and simultaneous enable-and-close. The browser scenario additionally records the real noneditable workspace-trigger element and verifies the enabled composer is that same DOM node, preserving every existing initial-focus/refusal/acceptance/viewport/strict-replay assertion and root's AggregateError cleanup.

## Verification actually executed

- Before fix: `node node_modules/vitest/vitest.mjs run packages/client/ui-primitives/tests/modal-layer.client.spec.tsx` failed only the new mobile noneditable-to-editable restoration regression (1 failed / 16 passed).
- Final: `node node_modules/vitest/vitest.mjs run packages/client/ui-primitives/tests/modal-layer.client.spec.tsx packages/client/ui-conversation/tests/input-bar.client.spec.tsx packages/client/ui-conversation/tests/editor-viewport.client.spec.ts` passed 3 files / 122 tests; output: `rc1-07-mobile-focused.log`.
- `node --import tsx/esm scripts/run-oxlint.ts packages/client/ui-primitives/src/useModalLayer.ts packages/client/ui-primitives/tests/modal-layer.client.spec.tsx packages/client/ui-conversation/tests/input-bar.client.spec.tsx apps/web/tests/composer-focus.e2e.ts --format json` exited 0 with zero diagnostics across 4 files; output: `rc1-07-mobile-lint.json`.
- Scoped `git diff --check` passed for tracked source/tests/docs. The untracked browser scenario was checked for trailing whitespace separately.

No worker browser execution, build/emit, package installation, pnpm command, generator, Git write, paid API, IM send, .env read, TCC action, original-checkout edit or helper worker was performed. These are focused jsdom source tests, not evidence of physical virtual-keyboard behavior.

## Source and authority

Applied within the accepted `rc1-client-candidate-files.json`, `dependent-manifest-root-review.json` and `m2-exit-source-freeze.json`, plus the exact repair dispatch and coordinator ask reply granting primitive README pair, composer-admission guide pair and composer-focus scenario. The source ceiling stays `dsh-v0.2.2-rc.1` at commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`; basePin/UPSTREAM_PIN and product version were not changed.

Inspected current fork files in place and tag-only `packages/client/ui-primitives/src/useModalLayer.ts` (blob `2942c992f077bbcdacce058ffa62baf0d0450106`). The tag has additional pending-restore behavior; this repair does not import that unrelated behavior. Tag InputBar identity inspected: `892a41022331f529188cbbed9221b89d7f6d62ad`. The fix is a local adaptation to the evidenced fork failure, with no origin/master source and no wholesale replacement. Existing dirty shared changes are preserved.

## Root-only next steps and limitations

Root must rebuild the affected client and run the authored `apps/web/tests/composer-focus.e2e.ts` against the shipped composition on desktop Chromium and mobile Chromium/WebKit. Root was notified that source and stronger oracle were ready; this report does not claim that run passed. Emulated mobile user agents and viewport instrumentation cannot qualify a physical iPhone/Android keyboard.

Root owns any intake registry updates for the additional useModalLayer source/test paths, exact final item file ledger, bilingual pairing records for README/guide pairs, compiler/build outputs, distribution qualification and final acceptance. No new dependency, export, manifest, alias, profile pin or model-visible API requires wiring. Chinese product copy remains unchanged.

## Exact final worker product/test/document identities

The InputBar owner test and browser scenario already contained earlier intake work; these hashes identify the complete final files, while the dispatched changes are the modal transition regression and resident-node oracle respectively. This worker also writes this report and the two verification logs named above.

| Path | SHA-256 | Git blob |
| --- | --- | --- |
| `packages/client/ui-primitives/src/useModalLayer.ts` | `7bbd9b2fbb1a84f885a63686f00d32a9d96f199b126450970bc31349e14d2e03` | `bc79050ccd5f88146f201adeabb60eaaf56e377a` |
| `packages/client/ui-primitives/tests/modal-layer.client.spec.tsx` | `d73456be096b8081f4c0d05cfb9861a9fa45c3f35204d51bf8daed84535d60d2` | `1d71de28cf9b1cc6f873b5e30897e6ecd89cef72` |
| `packages/client/ui-conversation/tests/input-bar.client.spec.tsx` | `dd502a8b62e34010c499df1eb12f6fced25632595fa615a624beb36eec9d5a02` | `33ec8bf058de7ac9b41e60344aa055894f356b9c` |
| `apps/web/tests/composer-focus.e2e.ts` | `a7cacd7a95e5d98299d1ae80f5277a9a1e274e8299f2cbaa062349681078773c` | `ef616e1525261328e7184178dd427cd99abb447d` |
| `packages/client/ui-primitives/README.md` | `3136bf4e465409e7245e55d91d4b5c98d07fe3cf87e86dde878feb3a3794281b` | `53120085eb65ec183573a2380d8bfcd48cb9484e` |
| `packages/client/ui-primitives/README.zh.md` | `a67637bd03afece6437e14a99213549fd41e820f0b5bccb31a18b50f2454fd2c` | `f31f4b9b5507760925df770cafaad1c3e901c6b1` |
| `docs/upgrade-guide/v0.2.1-alpha.1/composer-admission/guide.md` | `6f30b7d6cea49284e2e3fef52c5de1df981e8a3d698204d3449660edf0064e8d` | `8dca1a1a2fefd844b692cb6cbe21424326f43fad` |
| `docs/upgrade-guide/v0.2.1-alpha.1/composer-admission/guide.zh.md` | `d3e5f600a6c6a2f4ad7709eaad67f4685e0a65c8942a1bf277a3ac549e3e3e1b` | `e2d61b407605caaff1d102403ac438fb81192158` |
