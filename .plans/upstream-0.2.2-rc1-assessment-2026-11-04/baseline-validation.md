# P0 checkpoint qualification

Status: passed. The isolated source checkpoint is qualified for the selected intake. No P1, AD, runtime migration, new upstream dependency version, Superagent work, or upstream-pin advance is included.

## Source and preservation

The original branch is `feature/im-expansion-tui-local-qualification`, at `e800c8261bf52eefc5680d51b23939d72ad92ff1`. It was neither switched nor reset. Its index bytes, staged entries and all 118 originally modified tracked files are unchanged. The original DMG is preserved under `dist/review-baselines/upstream-022-p0-2026-11-04/`, with SHA-256 `be7d2565cb2ab9fe35ccc770a9214f64b5d2bd3ef4c07bb25e98b1894c423b4f`.

The initial checkpoint is `94d501980fa581bb09cea0a094580cf95caf5dcc`, with tree `2d2b1363b116a8b84b265281cc9f9e3021c18fca`. It contains 409 explicitly selected inputs, with 243 changed paths against the original HEAD. The local `checkpoint-files.json` records inclusion reasons, exact hashes and 7,609 excluded paths. Credentials, raw live-IM logs, copied research, build residue and unrelated branding/homepage edits remain outside the checkpoint.

The repaired runtime checkpoint is `98ae294d7a63e360e7112b5abbd6d8c9187fa692`, tree `02994fa05253d2a639d061ecac00ea66a36fe0bf`. The final qualification commit adds this report and one documentation-test expectation; it changes no runtime source. Its exact identity and final input hashes are recorded in the original checkout's `checkpoint.json` and `checkpoint-files.json`. The checkpoint branch is `checkpoint/upstream-022-p0-2026-11-04`; the implementation branch is `feature/upstream-022-selected-intake`, in `.worktrees/p0-upstream-022-2026-11-04`.

## Baseline repairs

Four new fixture/test files were normalized to exactly one trailing newline inside the initial checkpoint; the originals were left intact. The repaired checkpoint removes forbidden document wording/hash references, repairs bilingual status, and labels unavailable historical raw logs as local-only evidence. It regenerates the Client slot catalog to include the already implemented question composer and exclude the unrelated branding component. The final documentation-test repair retains the exact existing `# DeepSeek Harness` homepage expectation; the separately edited homepage was intentionally excluded.

Existing dependencies were cloned into the isolated worktree, with 362 dependency roots, 848 relocated text files and one relocated absolute symlink. The copied dependencies have no symlink escape into the original workspace. Dependency-input timestamps were restored only after byte equality was verified for all 375 inputs. There was no root/product dependency install or upstream dependency update. Baseline packaging stages the existing pinned production dependencies in its private app assembly; its reused third-party cache was created by this worktree and refreshes all 306 workspace packages from rebuilt outputs. The existing KB runtime was reused unchanged.

## Executed validation

| Scope | Result | Local evidence |
| --- | --- | --- |
| Source build | Passed, Node 24.14.0 / pnpm 11.7.0 / TypeScript 6.0.3 | `p0-build-qualified.log` |
| Native Tauri release build | Passed at the repaired runtime commit | `p0-tauri-qualified.log` |
| Question package | 426 tests; 100% statements, branches, functions and lines, with existing per-file thresholds | `p0-feature-tests-final.log` |
| Team, IM and skill units | 497 unique tests pass across the initial run and unchanged 12-test approval rerun | `p0-team_im-tests.log`, `p0-approval-retry.log` |
| Distribution scripts | 92 tests in four files | `p0-distribution-tests.log` |
| Causal Team replay driver | 40 tests; all four coverage metrics 100% | `p0-team-driver-final.log` |
| Strict Team/control/header replays | 11 tests; captured Team logs retain all three exact hashes | `p0-strict-replays.log`, `baseline-results.json` |
| Real Host questions/Feishu | 25 scenarios | `p0-browser-host.log` |
| Built-Client browser question | Visible card, reload, one admitted answer and response; unchanged focused rerun passed | `p0-browser-final.log` |
| Generated catalog | Freshness passed and 22 generator tests passed | `p0-client-catalog-final.log`, `p0-catalog-tests.log` |
| Documentation | Aggregate: 40/42; both failures repaired and their owning checks passed, including 151 site tests. Full aggregate was not repeated | `p0-doc-sync.log`, `p0-client-catalog-final.log`, `p0-doc-site-final.log` |
| Upstream intake | Exit 0; the four existing mount dispositions are not RC1 backports | `p0-upstream-intake-final.log` |
| Installer readiness | 115 checks passed against the rebuilt app | `p0-readiness-final.log`, `p0-dmg-sealed.log` |
| Fresh copied-DMG skill flows | 12 checks passed using bundled runtime and private homes | `p0-installed-skill.log` |
| Fresh copied-DMG question/standing-Team flows | 24 checks passed, including cold restart and actual model routing | `p0-installed-questions-team.log` |
| Actual Tauri startup refresh | Passed with isolated HOME; refs and unrelated user skill preserved; only the test process was stopped | `p0-startup-refresh.log` |

Question, Team, replay and browser feature checks ran on the initial candidate; the later runtime delta is generated catalog data plus documentation, with dedicated generator tests/freshness, rebuilt Host/Client/native artifacts and new installed-flow checks. The final commit differs from the artifact source only in this report and a tested documentation assertion. No passing check was disabled or threshold lowered.

## Failed attempts and dispositions

The first copied-dependency preflight rejected newer input timestamps; equality-checked timestamp restoration fixed that preflight without changing dependencies. One Client unit suite was invoked before its generated Remote existed and passed after the complete build. The first native invocation correctly rejected the missing full-build record and passed after that prerequisite.

Under concurrent build load, one native approval teardown, one Team corpus fixture and one browser admission poll reached their existing deadlines. All passed unchanged in focused reruns. The accidentally broad replay selection produced 845/846 passes; all five Team corpus cases passed on rerun. Its first coverage filter named a nonexistent file and is not coverage evidence; the correctly scoped 40-test run supplies the driver coverage result. The first packaging attempt was stopped before acceptance when the stale catalog was discovered. The repaired runtime was rebuilt and repackaged; that earlier attempt supplies no installer acceptance. The first repaired-app readiness run returned 112 passed and three failed: missing test-only Rust carrier harness, a knowledge Host deadline and a prediction-stream deadline. The harness was rebuilt from isolated source (`cargo build --features harness --bin carrier-harness`); unchanged focused runs passed 29 knowledge and 25 prediction controls. A context restart also reached its existing deadline during concurrent checks. The entire 115-check readiness suite then passed serially without changing deadlines or product code. Its exact prepared app was sealed and packaged with the existing sign-prepared path; no failed checklist or stale seal was reused. The Python copy orchestrator was interrupted after its private mount completed; native ditto, detach and codesign resumed the verified read-only volume and the original bundle/hash assertions passed unchanged. The abandoned duplicate copy was removed; unrelated mounted images were left intact.

## Installer identity and limits

The new internal baseline artifact is `.worktrees/p0-upstream-022-2026-11-04/dist/octopus_DSH.dmg`, 334387122 bytes, SHA-256 `95f191a2289ece9511f589b267314e253faba8c3aa232ce479f44faff703cc76`. Its embedded release commit is `98ae294d7a63e360e7112b5abbd6d8c9187fa692`. Source modification flags distinguish the later test-only change from the clean source build. The DMG was mounted read-only, copied to a fresh location, detached, and verified with `codesign --verify --deep --strict`. Question Host/Client, IM desktop, inlined IM consumer and Team Client bundles match the rebuilt source byte-for-byte. Catalog check: byte-identical; selected question composer present, excluded branding absent.

All model traffic for new behavior checks used recorded or scripted loopback fixtures. No paid recording, live Feishu send, tenant callback qualification, public signing/notarization or installation into `/Applications` was performed. Those limits do not claim selected RC1 capabilities are implemented. `UPSTREAM_PIN` remains `dsh-v0.2.1-alpha.1`; Node floor and plugin defaults are unchanged. The original checkout's local evidence directory retains commands, outputs, dependency equivalence and artifact metadata.
