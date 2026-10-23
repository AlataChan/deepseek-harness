# Compatibility intake verification

Status: review revisions incorporated; desktop prerequisite checkpoint passed.

The original dirty checkout is preserved. Only reviewed desktop files and their evidence were copied into this worktree. The prior DMG and release manifest were hash-verified and copied to the canonical checkout’s dist/review-baselines/2026-10-23-context-qualified directory. No installed application or user profile was modified.

Prerequisite verification: 94 focused tests passed across eight files; four installed-runner negative controls passed; the executed intake gate passed with four recorded outstanding entries. The updated desktop composition README pair and revised implementation-plan pair pass named pairing checks.

The checkpoint hook required a late-initialized graph receiver to use a stable holder and shorter test setup. The affected bootstrap suite passed 20/20 after this edit. Historical text log copies have normalized trailing whitespace; canonical raw logs remain intact.

C1 is implemented in the isolated worktree: stable vendor metadata, timer locales, the loader peer range and an independently enforced ownership policy. The baseline CLI accepted both absent C1 ownership and an advanced release pin in a disposable repository; corrected physical-path CLI fixtures now pass all positive and rejecting controls. The first fixture draft used a macOS path alias that bypassed the CLI main guard; its red result is not counted. Focused tests: 40/40 passed before final lint-only test cleanup. Vendor runtime-source diff against rc.2 remains empty. Dependency resolution completed online after the offline metadata cache reported a missing native-loader release; lockfile changes are native-loader closure and stable vendor peer resolution. Root test and build are in progress.

C1 implementation checkpoint: `4c80e14941`. Integration qualification remains open. The dependency-script approval fixture originally invoked global pnpm 10 in its temporary profile; it now selects the repository-pinned pnpm explicitly and passes with the shared-host test budget.

C2 includes the discovered inline-anchor prerequisite in ui-slots/ui-renderer. The model label suite initially rejected div anchors; the imported inline renderer implementation and its error/disposal tests resolve it. Four focused suites pass 116/116. The generated Client catalog adds the label slot without deleting existing entries. Browser viewport and real default-catalog checks await the integrated build.

C3 changes only the default display name, retaining `deepseek-flash`. Its adapter/runtime suites pass 203/203; an additional explicit deployment-name case passes. The real default-catalog browser test uses the shipped adapter, an inert fixture credential and an inference tripwire; no replay catalog is substituted.

The expanded executed intake controls pass, including missing C1/C2/C3 entries, missing required vendor/locale/renderer/model paths and coordinated unauthorized pin advances. The current top-level intake command and six named documentation pairs pass.

The first root test attempt ran with the default worker/test budgets beside a compiler. It reported failures in Plugin Manager, Python schema generation, inspector, schedule UI, dependency checks, Python PTC, deliverables and knowledge-document tests. It also observed the intentionally red C2/C3 tests under development. The broad run was interrupted (exit 130) after accumulating timeouts and is incomplete, not a pass. The incomplete concurrent build was stopped. Changed-feature suites have since passed; required integrated build, bounded failed-suite diagnosis, browser checks and packaged acceptance remain open.

## Integrated verification at 107e09fd85

C1 checkpoint is df5767bf47 (the earlier abbreviated hash above was superseded). All native builtin consumers now require ^0.1.9, matching the loader. Current C1 controls pass 46/46; AppBoot/HMR runtime tests pass 130/130. The executed intake and rescope gates pass. Vendor runtime source remains unchanged against the selected upstream ceiling.

C2/C3 focused integration passed 322/322 before two additional passing C1 controls. Built-browser acceptance passed 9 tests with 2 existing WebKit skips across three files, including the actual shipped Flash catalog and 125% document zoom positioning. The model-switch recorded-session test passed. Timer packed locale exports and missing-locale control passed. Root source build and Rust tests (43/43) pass at 107e09fd85. Tauri release app compilation passes.

Repository-wide readiness is not claimed: the broad lint run exposed baseline errors (667 after the one intake diagnostic was corrected); remaining hygiene failures concern baseline export packaging and knowledge package files, plus a branch-introduced connection-process runtime-dependency classification violation (see second-review.md). A bounded rerun of ten previously failing suites passed 799 tests with two skips and two failures; the knowledge timeout subsequently passed alone, while the unchanged experimental assistants scrollbar contract remains failing. No unrelated CSS or gate relaxation is included.

The internal macOS ARM64 DMG build collects fresh runtime dependencies. Only immutable pinned Node and source-equivalent knowledge-sidecar caches are reused. Packaged and native acceptance remain pending until recorded below. No installed application or real user profile has been modified.

The explicit root `pnpm run typecheck` also passed (Host build plus Client contracts). The first DMG attempt correctly failed closed at 113 passing checks because the isolated worktree lacked the test-only carrier-harness executable. `cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml --bin carrier-harness --features harness` then passed; the unchanged packaging gate is being rerun.

Native WKWebView qualification remains open. A disposable private HOME plus CFFIXED_USER_HOME was used with kernel offline confinement, real-user data read/write protection and global single-instance socket protection. The candidate first exposed only a blank window; the second observation returned Orca `permission_denied` (visible window but AX reads blocked after retries). The permission diagnostic reports Accessibility and screenshots granted, so this is an unresolved per-app observation failure, not proof that the product UI passed or failed. Both owned candidate processes were terminated; the real installed application was untouched and the existing singleton socket inode and modification time were identical before/after. No native selector, context, locales or entry-flow acceptance is claimed from these attempts.

The rebuilt internal app passed all 114 bundle checks. Installed Ask Knowledge passed 29 acceptance criteria and invalid controls; installed composer predictions passed 25 checks. dsh-context passed live Host OFF/ON/OFF, cleanup/error/offline controls, both cold states, production Rust refresh preservation, and the built desktop page using the Rust carrier/cache with actual packaged Client mount/removal over three cycles. This browser-driven carrier test is distinct from the unresolved native WKWebView check. Strict ad-hoc signature verification passed. DMG creation follows this gate.

Final internal DMG: `dist/octopus_DSH.dmg`, 324200292 bytes, SHA-256 `c3998de55ee48c4c79e18ef551f0f528b8517dafa399e0545daa192bd8d8e59d`. The adjacent release manifest records source `107e09fd859cfc47fba5b02041d0079d825cacb7`, macos-arm64, internal/ad-hoc and modified source-state flags (plan/evidence updates); product changes are committed. The build writes payload SHA `806759e55459fb8fbe457388e834c034ed865c0f5b720cab94122921621fa76b` using its own payload algorithm.

A separate sorted relative-file-content digest found 51512 files and SHA-256 `499ab5f8ee2ebce74167df18eac24b4ca022213d6a13000f0927b12da6b8548a` in each of the tested source app, read-only mounted DMG app and unchanged copied app. Strict copied-app signature verification passed. The first copied-app context run timed out at the existing five-second Node version probe; direct execution immediately afterward returned v24.14.0, so one unchanged retry is being recorded separately. This transient first-launch delay is not hidden by changing the timeout.

The unchanged copied-DMG retry passed in full: real context Host toggles and restart states, Rust refresh, and built desktop Client mount/removal through the production carrier/cache over three cycles. The read-only image was detached after verification. Native WKWebView A3/A5/A6/A8/A9 observations remain unverified; this artifact is an internal test candidate, not an unconditional release approval. No public signing/notarization, Intel, Windows, or paid-API qualification is claimed. Baseline broad lint/hygiene and scrollbar failures remain open.

## Second-review remediation

R1 is fixed in 00729d3c76; the real dependency verifier passes. Native entry, final copied-DMG cold ON/OFF, selections and live Client lifecycle are verified. See remediation-review.md and evidence/ for exact observations, supported zoom/resize coverage, artifact identity and the limits retained from broad baseline checks. Local integration is approved; this is not an exhaustive public-release approval.
