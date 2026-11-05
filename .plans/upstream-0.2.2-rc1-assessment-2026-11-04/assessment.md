# Upstream 0.2.2-rc.1 intake assessment

Status: revised source assessment; execution order and gates are owned by the [selected intake implementation plan](../../docs/plans/2026-11-04-upstream-022-rc1-selected-intake.md). This is not a completed upgrade. The user approved the focused default-bundled agent-desktop integration, then asked to inspect upstream and select upgrades before discussing Superagent. That approval remains in force; no Superagent integration is part of this assessment.

## Recommendation

Use selective adaptations against the fixed `dsh-v0.2.2-rc.1` source ceiling. Start with bounded reliability fixes and useful conversation improvements, then add apply_patch with the fork's existing filesystem protections. Treat Worktree/Forge as a valuable separate integration, with its runtime prerequisites explicit. Group any core/Cordis/PTC/Session migration together rather than scheduling Cordis as a final independent package bump. Preserve the existing Team, standing squads, question service, IM connection owner, Tauri shell and default standard assistant.

Do not perform a whole merge, replace fork packages with upstream directories, or advance UPSTREAM_PIN/product versions based on selected backports. The approved agent-desktop plugin can use the current MCP client; upstream CUA and a complete 0.2.2 migration are not prerequisites for it.

## Verified source ceiling

| Item | Observed value |
| --- | --- |
| Fork HEAD | `e800c8261bf52eefc5680d51b23939d72ad92ff1` |
| Branch | `feature/im-expansion-tui-local-qualification` |
| Actual upstream remote | `origin`, `https://github.com/deepseek-ai/deepseek-harness.git` |
| Fork publishing remote | `fork`, `https://github.com/AlataChan/deepseek-harness.git` |
| Upstream master | `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159` |
| Reviewed release | `dsh-v0.2.2-rc.1`, commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db` |
| Release publication | 2026-11-04T13:07:14Z, marked prerelease |
| Merge base and complete-intake pin | `5badb15009ae1756c3afe0ae0cef1faafc290ccc`, `dsh-v0.2.1-alpha.1`, dated October 3 |
| Existing selected backports | Registry entries C1–C3, U1–U7 and D1–D4 from rc.2; not a complete rc.2 runtime intake |

The earlier 5,112-commit / 12,123-path summary is accurate for master with Git's default rename accounting. The fixed release tag has 4,301 upstream-only commits and 11,392 changed paths under that accounting. The maintained change-scope tool disables rename detection and reports 11,539 release paths; the equivalent master count is 12,203. Renames account for the path-count difference, not an additional release. Do not mix master-only changes into the release assessment.

`inventory.json` records pinned upstream and current inspected-file hashes. `release.json` saves the official release description. `change-scope.log` separates committed comparison paths from staged, unstaged and untracked paths. The `upstream/` directory contains 1,702 source/reference files extracted from the fixed Git object for inspection; this is not a claim that every file was semantically reviewed. The conclusions below follow the relevant source implementations, manifests, README obligations and selected commit diffs.

## Corrections to the earlier summary

1. The CLI delegation feature is specifically `experimental/subagent-oar` plus `tool-subagent-oar`, not a guessed ACP package. OAR is a one-shot text-task provider backed by native Codex/Claude CLIs. It embeds another execution library and does not use DSH's normal subprocess provider for those native sessions. Our standard presets already expose `subagent_codex` and `subagent_claude_code`.
2. Forge is useful and has no direct Electron dependency in its package manifest, but it is not just a React screen. Its bundle composes worktree, forge, forge-github, forge-session and the Client panel. It depends on working-directory state, Session maintenance and projections. Importing only client-ui-forge is insufficient.
3. Upstream Team explicitly still shares one cwd/checkout and provides no worktree isolation. Forge's Session worktrees do not automatically give each teammate a separate checkout. The upstream Team profile also disables ordinary subagent tools; our current coexistence and standing-squad behavior must not be overwritten with that profile.
4. Shared Web UI code is potentially reusable with Tauri, but its contracts changed. Async projection handles, current working-directory reads, slot/menu APIs and Host-confirmed input handling are not isolated CSS changes.
5. Docs, schema acknowledgements and snapshots are review and compatibility evidence. Some generated references can be regenerated after a deliberate change; recorded Sessions and behavioral goldens must not be broadly regenerated to make a port pass.
6. The Search default is already `deepseek-official` with HTTP Fetch in our current base, and Search/Fetch settings have recorded rc.2 adaptations. This is not a wholly new feature to import again. Recheck behavioral deltas and credentials admission instead of resetting provider selection.

## Recommended intake matrix

| Area | Selection | Adaptation and acceptance conditions |
| --- | --- | --- |
| Instruction budgets and skill discovery | Take first | Port the separate user-global/project instruction budgets and unreadable-root isolation. Preserve existing skill discovery/precedence and the bundled teamwork payload. These are demonstrated source-level gaps, not a request to replace all context/skill packages. |
| Conversation correctness | Needs migration first | Prefer draft retention after failed Host admission, retained answers/text under collapsed process groups, prompt deduplication, clipboard/paste handling and useful file-link fixes. Test ordinary human input, queued question answers and restart together. |
| Full-history Markdown copy | Portable by bounded current-API adaptation | Adapt session-query/session-log-export to the current HeaderAction menu and Host/archive APIs; do not import new context-menu bindings, projections or subscriptions. Verify complete persisted history, not just the Client's loaded window, and preserve the distinction between Session text and storage-only question status. |
| Quoting and mobile/tablet layout | Needs migration first | Keep the fork's composer, Team pod and question card. Verify keyboard/viewport behavior and quote/draft retention. Port Host-confirmed input/menu behavior with its complete controller changes; pure CSS is not a hidden pre-migration subset authorized by this row. Do not copy whole Client directories. |
| apply_patch | Take as an explicit capability | Adapt fs-patch and the tool/controller/presentation path to current APIs. Preserve sandbox checks, read-before-edit/freshness policy and Review. Keep deployment activation explicit; the tag schema, base row and Web standard preset all set applyPatch to false. The base observation-policy row exists with disabled: true; retain our enabled policy explicitly in every affected composition. Whole-patch preflight is not an atomic multi-file commit: partial effects and cancellation must remain visible. |
| Plugin update, rollback and diagnostics | Needs migration first | Reuse useful lifecycle/error handling, preserving fork pins, native payload verification and the separation of installation from activation failure. Do not import account services, upstream release feeds or automatic marketplace activation. |
| Subagent identity, preset restrictions and Team checkpoint fixes | Adapt selectively | Preserve standing rosters, selected provider/model/effort, durable mail, shared task ownership, summary generation and the new execution view. New checkpoint fixes rely on the projection implementation they were written for. |
| Core/Cordis/PTC/Session changes | Separate coordinated migration | Valuable, but not a sequence of unrelated fixes. Bundle tool resolution/execution, step-model capture, projection handles, Session subscriptions, PTC transport/cancellation and vendor compatibility with all fork consumer changes. |
| Worktree plus local Forge review | Accept as the next substantial feature | Start with local worktree/effective-cwd support and local diff/review. Keep GitHub binding/publishing optional. Require the runtime prerequisites and explicit Team integration. An upstream experimental label alone is not a reason to reject it. |
| Unified Schedule | Accept after the required runtime/Client adaptation | Keep one Automation Tasks entry, persisted task identity, human/event source authority and waiting-question input policy. Treat the source change as cross-cutting, not a Schedule-only package update. |
| OAR | Defer | Existing native Codex/Claude delegation covers the core capability. Require evidence of an additional needed runtime or measurable reliability benefit before adding another backend and permission/cancellation path. One-shot OAR sessions are not a substitute for continuable Team members. |
| Upstream CUA | Exclude from defaults | The user selected agent-desktop as the focused desktop-operation route. Reuse permission-UX lessons if useful; do not activate two independent desktop-control stacks. |
| Liveshare and personalized/recommendation/index defaults | Defer/exclude from defaults | No approved need in this scope; retain deliberate plugin activation. |
| Statistics | Optional later | Useful for diagnosis, but not a prerequisite for teamwork, questions or desktop operation. Preserve provider-reported accounting and avoid inventing usage. |
| Extra UI locales | Defer | Keep the current English/Chinese obligations first. Additional languages are optional rather than a reason to replace existing locale-owned copy. |
| Electron, account binding, policy gates, release feed and analytics | Exclude | Enforce the current never-merge registry; reuse product-independent behavior only through fork-owned adaptation. |

## Why the runtime/vendor migration is one workstream

### A concrete persistent-assistant incompatibility

Our `packages/experimental/assistant-registry/src/route-override.ts` selects the effective assistant route inside `agent/request` (listener starts at line 168). The reviewed upstream `core/agent/src/runtime-types.ts` freezes provider/model/effort before prompt assembly/pre-step. Its retained agent/request hook must preserve that selection and is deprecated for routing; plugins should select through agent.model before step preparation.

Our existing core/agent/model-selection.ts already captures ModelSelectionRef during assembly, applies it through agent/request and emits switch notices. Reuse this logic and its tests: the migration is incremental, not greenfield. It is still different from upstream Agent.model.current()/select(), driver-owned early capture and the core-owned durable projection. Map the current API-owned model-selection projection to one new owner.

There are four live request listeners, recorded in request-listeners.md: the core helper, assistant route-override, assistant rounds.ts:1232 and webhook initial effort. The rounds listener changes only maxTokens and throws when its budget is exhausted; deprecation of routing is not grounds to delete its budget enforcement. Retain its compatible control path or prove an equivalent move. The standing-team and institution-seat tests must observe the provider/model/effort that actually receives each request, with images, retries and cold restore.

### Tool execution and question guards

Upstream tools.resolve/executable and per-step activation feed both model declarations and execution admission. Native and PTC execution are now scoped plugins; old tools.mode and DSH_TOOLS_MODE configurations are not the same composition. PTC control transport uses birpc, SSH changes protocol version, and caller cancellation returns ABORTED rather than CODE_RUN_FAILED. The newer VM Script mode also has different top-level syntax and optional retained state.

Retest our question-producing-step guard against native, nested PTC and MCP paths; preserve full-human queued answers, canonical request identities and uncertainty handling. A PTC cancellation fix such as `9e979a71e6` changes SDK/session expectations as well as runtime code. Bring the complete semantic fix and both SDK projections, not one worker file.

### Projection and data compatibility

The writer Session format is 4 in both current fork and reviewed tag, and SQLite user_version is 1 in both. This does not mean the payloads and APIs are unchanged. Upstream adds job/registered, job/settled and working-directory/change to the required event vocabulary. Its projection registration returns an asynchronous retained ProjectionHandle and removes the old host state map. Its storage-domain API adds explicitly declared compatibleVersions for whole-unit reads.

An AST inventory finds 29 direct sessionProjections.register calls in 24 current source files and 83 direct service calls. projection-callers.md lists every registration; projection-callers.json and projection-references.txt cover direct consumers and the broader alias audit. Fork/mixed callers include commerce-mode, host/commerce, tool-agent-team, API model-selection projection, Team and both ask packages. Every caller needs a concrete owner/replacement, awaited initialization/disposal, retained-reader/checkpoint proof and owner tests. Importing an upstream package does not implicitly accept its old fork callers. Regenerate the inventory and resolve aliases before migration. Preserve immutable finalized schema generations and the fork's released-event inventory; require declared persistence acknowledgements and copied-session tests. Do not import the new storage compatibility support as permission for ad hoc migration or downgrade.

### Runtime versions

The release raises Node's minimum to 24.9 and uses Cordis 4.1.0, Loader 1.1.0 and Include 1.1.0. Our root still supports Node ^22.19 or >=24.0, and rc.2 vendor metadata was selectively aligned without replacing runtime source. The currently packaged macOS Node 24.14 satisfies the new floor, but this does not qualify source/SDK callers or other installers. Decision: portable backports retain the current floor; the coordinated DSH migration raises it to >=24.9.0, with the version-correct Node upgrade guide pair, source/SDK/platform checks and unsupported-runtime preflight in the same change. No independent claim of Cordis 4.1 support or incompatibility on Node 22 is made.

Cordis raw/candidate/effective configuration and projection Fiber behavior affect plugin activation/settings. Vendor must be established before or alongside its dependent adaptations, not left as an independent last step after consumers were imported.

## Worktree acceptance specific to this fork

The upstream worktree service creates a branch from a resolved local commit and changes the Agent's effective working directory. It does not copy staged, unstaged, untracked or ignored source files. Our current qualified implementation includes substantial uncommitted feature work. Starting an implementation or acceptance worktree from HEAD alone would omit that work and test a different product. First create a reviewable checkpoint containing only the accepted feature inputs, preserving unrelated dirty files and credentials.

Then validate the effective-cwd service through the filesystem, shell, sidebar files, file links, preview paths and sandbox. Our Team summary path uses the Lead Session header cwd today; our Feishu question adapter binds authorization to the recorded workspace/header cwd. Define original workspace identity separately from current execution cwd before changing those checks. Do not simply weaken the binding or rebind a data/knowledge source when an Agent enters a worktree.

For Team integration, choose an explicit mode: one Team per worktree-backed Lead Session, or a future isolated-teammate provider with delivery/merge ownership. Upstream Team alone does not supply the latter. Preserve the normal shared-workspace mode for existing standing teams. Test clean-commit content, missing worktree recovery, canceled creation, sandbox denial, linked Git/common-directory access, cold restore, file navigation and a real two-member workflow. No automatic merge or publication follows from completing a task.

## Defaults that must not hitchhike into the fork

- Keep existing file observation/freshness protection unless separately changed by an explicit product decision. The reviewed upstream base retains the observation-policy row but disables it; accepting apply_patch does not require accepting that default.
- Do not silently accept broader Web Fetch access. `2f01ad549c` deliberately allows non-public destinations. Our intranet use case may justify an explicit policy, but this is a network-admission change, not a harmless parser fix.
- Retain configured model capacities and explicit reasoning values. The upstream 1M/128K custom-model fallback is not proof that a configured endpoint can serve those capacities.
- Preserve standard as the default assistant, native Team and question capabilities already shipped in experimental packages, disabled optional community/index/recommendation behavior, and the Tauri/new-user installation path.

## Execution order after review

The formal plan owns the hard P0 gate and task details. No implementation starts until a reviewed source commit/tree, explicit included/excluded file list, isolated worktree and reproducible baseline are recorded. Refresh the dirty inventory rather than assuming the review's count is permanent; copied reference files are not product inputs.

After P0, RC1-01/02 are current-API adaptations; RC1-03/04 need bounded current-API adapter proof. RC1-05–09 require the coordinated migration first. prerequisites.md records every classification and reclassification rule. AD-01 remains approved before migration only if it uses the existing MCP client without projection registration, agent/request listeners, new Session events or input-controller changes.

Every accepted DSH item has its own BackportEntry with sourceTag dsh-v0.2.2-rc.1, basePin dsh-v0.2.1-alpha.1, exact paths, dependencies and owner tests. UPSTREAM_PIN and existing rc.2 entries stay unchanged. AD-01 records its actual Vercel source/digests separately rather than pretending to be a DSH backport. No placeholder entries are added before implementation.

OAR stays deferred, upstream CUA stays out of defaults, Worktree/Forge and Schedule retain their separate gates, and Superagent follows the selected upgrade. The Node floor, network policy and model-capacity decisions are explicit migration obligations, not incidental preset changes.

## Verification and limits

Executed: upstream fetch for master and the fixed tag; Git-object/source/manifest/commit-diff inspection; the maintained change-scope report against the exact merge base and release commit. Relevant current source was inspected directly, including dirty fork consumers. No merge trial, checkout, dependency install, build, application launch, release test or production migration was performed. No upstream code, registry pin, product version, plugin default or user data was changed. Existing unrelated dirty work was preserved.

This is a source-backed selection recommendation. It does not claim that all 4,301 release commits or every extracted file were reviewed, that selected backports already pass tests, or that Forge/Team/OAR interoperation has been executed.
