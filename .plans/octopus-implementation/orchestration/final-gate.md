# Final implementation gate

Current checkpoint: persistent-question discovery latency repair. Stage A, B0/B1 and B2 remain implemented; Stage C remains deferred and independent review remains pending. The preceding visible-card/Team-view record is preserved at ../../external-integration-2026-11-04/previous-final-gate.md.

The already-mounted composer previously cached an empty catalog and waited for the next 15-second poll after a question was saved. It now invalidates the shared source when the producing Session turn changes from running to stopped. The asking tool already concludes that turn. The reconciliation poll remains unchanged. No new Session event, admission rule, faster permanent poll or loop change is introduced. An observed three-second delay is compatible with the remaining poll interval; no precise model-to-screen timing or universal latency bound is inferred.

## Current checks and artifact

- `card-delay-red.log` reproduces the absent form after turn stop with polling disabled; the repaired regression passes without advancing a timer. `card-delay-tests-final.log`: 91 card tests. `card-delay-coverage-final.log`: 426 feature tests across 17 files; all four existing 100% coverage thresholds pass.
- `browser.log`: the real Host and built full Client create the question, show controls without a header click, survive reload and admit one clicked answer into persisted Session text, followed by a response turn. Only the model is scripted.
- `types-final.log`, `lint-final.log`, `pairs-check.log` and `build.log`: owning compiler, scoped lint, README pair and complete source build pass. The test-selector fixture was subsequently made fully typed; the 91-case card suite and compiler checks pass. Product source is unchanged from the full coverage/build checkpoint.
- `dmg-build.log`: 115 readiness checks pass and packaging exits 0. Native Rust source/binary is unchanged and reused from the preceding build. Actual Rust refresh/native-carrier checks remain part of the package gate.
- `copy-final.log`: fresh read-only DMG mount/copy/detach, strict deep signature verification and all five packaged-bundle comparisons pass. The initial login-shell copy command did not begin verification and was interrupted; the unchanged command with login disabled succeeds.

These logs are under `../../external-integration-2026-11-04/`. Current installer: `dist/octopus_DSH.dmg`, 334533041 bytes, SHA-256 `be7d2565cb2ab9fe35ccc770a9214f64b5d2bd3ef4c07bb25e98b1894c423b4f`. Metadata and checksum match. Internal/ad-hoc macOS arm64 delivery, harness 0.2.1-alpha.1, shell 0.1.2-rc.3; dirty HEAD e800c8261bf52eefc5680d51b23939d72ad92ff1. See takeover-final-source-hashes.json and takeover-release-artifact.json.

The preceding checkpoint's 37 Team UI tests, 12 installed skill/mail checks, 24 installed question/standing-Team checks and isolated Tauri startup refresh are retained evidence, not new runs against this installer. The Host admission and IM implementations do not change; both question faces and both IM bundles are compared against current built bytes. Current full-browser coverage qualifies the changed Client. No fresh GUI startup was attempted alongside the user's running desktop, which was preserved.

## External project assessment and retained limits

`../../external-integration-2026-11-04/assessment.md` contains a pinned-source comparison and integration cost estimate for agent-desktop and dsh-superagent-prototype. The former's digest-verified macOS 1.2.0 archive passes direct version/status and MCP initialize/list/status-call checks, exposing 67 tools. This is not a completed DSH adapter, new-user permissions qualification or default plugin delivery. Neither external project nor a new event consumer is installed or enabled. A focused bundled desktop-operation entry is recommended; Stage C0 would separately assess the superagent concepts.

Real Feishu qualification remains the earlier separately identified installer in ../stage-b2/platform-qualification.md, not this UI repair. No new platform run is claimed. Independent review is pending; ../REVIEW_PROMPT.md includes this regression. Prior global documentation gates recorded 40 pass and 2 unrelated failures, and upstream intake recorded the pre-existing HeroShell.module.css edit. Those global checks were not rerun here. No repository-wide green verdict, commit, merge or push is claimed.
