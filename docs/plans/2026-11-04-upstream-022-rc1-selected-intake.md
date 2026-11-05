# Upstream 0.2.2-rc.1 Selected Intake Implementation Plan

English | [中文](2026-11-04-upstream-022-rc1-selected-intake.zh.md)

> **For implementers:** Use `superpowers:executing-plans` to execute the released tasks in order. No delegation or worker launch is implied.

**Goal:** Adapt selected RC1 capabilities while preserving the qualified Tauri desktop, assistants, standing teams, persistent questions and user data.

**Architecture:** A checkpoint precedes every implementation. Portable items stay on current APIs; dependent items wait for a coordinated runtime migration with a complete caller ledger.

**Tech Stack:** TypeScript, Cordis, React, pnpm, Vitest, recorded Sessions, Playwright and the existing Tauri distribution pipeline.

**Status:** Direction approved with review conditions incorporated. The [P0 qualification record](../../.plans/upstream-0.2.2-rc1-assessment-2026-11-04/baseline-validation.md) identifies the source checkpoint, baseline results and permission to begin the selected intake. A checkpoint alone does not open P0; its qualification must pass.

## Contents

- [Scope and prerequisites](#scope)
- [P0: hard checkpoint](#checkpoint)
- [P1: portable backports](#portable)
- [AD: focused desktop-operation plugin](#desktop)
- [M: coordinated runtime migration](#migration)
- [Dependent features](#dependent)
- [Registry and acceptance](#acceptance)
- [Dev Note](#dev-note)

<a id="scope"></a>
## Scope and prerequisites

Source ceiling: `dsh-v0.2.2-rc.1`. Keep `UPSTREAM_PIN` and every selected backport's `basePin` at `dsh-v0.2.1-alpha.1`. Do not borrow master-only commits or change the product release label to imply a full upstream upgrade.

The [assessment](../../.plans/upstream-0.2.2-rc1-assessment-2026-11-04/assessment.md), [per-item prerequisites](../../.plans/upstream-0.2.2-rc1-assessment-2026-11-04/prerequisites.md), [projection callers](../../.plans/upstream-0.2.2-rc1-assessment-2026-11-04/projection-callers.md) and [request listeners](../../.plans/upstream-0.2.2-rc1-assessment-2026-11-04/request-listeners.md) own detailed evidence. Regenerate their source inventories before implementation; line numbers and counts identify this inspected checkpoint, not a permanent exemption.

| Items | Prerequisite | Release constraint |
| --- | --- | --- |
| RC1-01 instruction budgets; RC1-02 readable skill roots | P0 | Adapt to current APIs and event vocabulary |
| RC1-03 Markdown copy; RC1-04 apply_patch | P0 plus current-API adapter proof | Reuse existing menu/export and fs/tools seams; no hidden core upgrade |
| AD-01 agent-desktop | P0 plus MCP-only composition proof | No projection registration, request listener or new Session event |
| RC1-05 quoting; RC1-06 composer admission/deduplication | M acceptance | Port coherent input/Host behavior |
| RC1-07 mobile input; RC1-08 trajectory/sidebar/menu behavior | M acceptance | Preserve fork surfaces and read models |
| RC1-09 plugin update/rollback | M acceptance | Qualify loader, install state and native pins together |
| RC1-F1 local Worktree/Forge; RC1-S1 unified Schedule | M plus feature-specific acceptance | Separate integrations; no automatic Team isolation or publication |

If a portable item needs a migrated API, stop that item, record the concrete missing symbol and move it behind M. Do not extend its scope into the framework or silently take a whole upstream package. OAR remains deferred; upstream CUA, Electron/account/policy/release-feed/analytics defaults remain excluded. Superagent follows this selected upgrade work.

<a id="checkpoint"></a>
## P0: hard checkpoint

**Files:** create `.plans/upstream-0.2.2-rc1-assessment-2026-11-04/checkpoint.json`, `checkpoint-files.json` and `baseline-validation.md`; read existing release metadata, source hashes, five approved Octopus plans and the intake registry. No product backport begins in this task.

1. Refresh HEAD, branch, staged/unstaged/untracked paths, current file hashes, registry entries and the installer identity. Classify product inputs separately from copied reference trees, build residue, credentials and unrelated work. Never use a fixed dirty-file count as an acceptance condition.
2. Prepare an explicit reviewed file list covering the actual A/B implementation, profiles, dependencies, fork presets and required documentation. Preserve unrelated edits. Do not use `git add .`, stash/reset the user's work, copy credentials, or assume a worktree from HEAD contains uncommitted features.
3. Create the reviewable source checkpoint on an isolated checkpoint branch without moving or rewriting the user's branch. Record its commit/tree and exact included/excluded inputs. A dirty diff, a successful worker report or an earlier installer is not a source checkpoint.
4. Create the implementation worktree from that checkpoint. Reconcile its source hashes with the intended baseline and qualify its relevant source/browser/installer behavior. Preserve the prior DMG before a build can overwrite it; distinguish inherited failures from failures of this checkpoint.
5. P0 opens only when the checkpoint identity, reviewed inclusion list, clean isolated worktree, baseline results and every blocking failure disposition are recorded. No P1, AD, M, dependency install or backport registry mutation may run earlier. If the baseline is not reproducible, repair and review it before upgrade work.

<a id="portable"></a>
## P1: portable backports

For each item: freeze exact current/tagged files, add a failing behavioral probe, implement the smallest current-API adaptation, run owner tests and the affected recorded-session/browser case, then review and commit that item alone. Record its individual BackportEntry only with accepted code. Paid recording, if required, needs a recorded applicable authorization and bounded budget; do not infer it from a key being present.

### RC1-01: separate instruction-chain budgets

**Files:** adapt `packages/context/agent-instructions/src/config.ts`, `render.ts`, `index.ts` and their README pair as required; extend `tests/agent-instructions.spec.ts` and the budget Session fixture. The assessment records this item's source commit; final behavior comes from the fixed tag, not an unchecked whole-commit import.

Probe a large project chain alongside a user-global chain, both initial and dynamic rendering, UTF-8 limits and disabled loading. Confirm each chain has its declared budget and the model-visible/logged result agrees. Run `pnpm exec vitest run packages/context/agent-instructions/tests/agent-instructions.spec.ts` and the named budget replay. Retain the existing selection and prompt APIs; declare any externally visible budget change in the owning documentation.

### RC1-02: isolate unreadable skill roots

**Files:** adapt `packages/skill/skill-filesystem/src/index.ts`, its README pair and `tests/skill-filesystem.spec.ts`; inspect current `skill` and `tool-skill` consumers before expanding their scope. The assessment records this item's source commit.

Probe one unreadable root alongside readable project/home/bundled roots and verify precedence, partial observation and later recovery. Use the current completeness representation; do not import new catalog persistence fields under this item. Run `pnpm exec vitest run packages/skill/skill-filesystem/tests packages/skill/skill/tests packages/skill/tool-skill/tests` and the affected skill-discovery replay. Keep teamwork references and installed skill verification intact.

### RC1-03: copy complete history as Markdown

**Files:** adapt `packages/session-query/session-log-export/src/index.ts`, `routes.ts`, `client/HeaderAction.tsx`, `client/locales.ts`, README pair and compiler faces; create `src/markdown.ts`, `tests/markdown.host.spec.ts` and `tests/markdown-route.host.spec.ts`. Extend existing header/action/route tests and the owning real-browser export case. The assessment records this item's source commit and its tag-level fixes.

Use existing Host/archive access to read complete committed history and the current HeaderAction menu. Do not import new shared context-menu bindings, projection handles or Session subscriptions. Test unloaded older history, fork prefixes, failed clipboard access, user/assistant/tool content and current fork events. Exported history must not invent later storage-only question status. Run `pnpm exec vitest run packages/session-query/session-log-export/tests` and the named built-Client export case.

### RC1-04: guarded apply_patch

**Files:** introduce the bounded parser owner `packages/fs/fs-patch/`; adapt `packages/fs/tool-fs/src/index.ts`, package manifest, current mutation controller and presenters; create its apply-patch tool/output/presentation and patch-execution modules plus owner tests. Freeze every new filename before implementation; update workspace resolution and runtime closure explicitly, without importing newer tools or working-directory APIs.

Verify syntax/hunk/missing-file preflight, sandbox denial, observation/freshness refusal, create/edit/delete/move, symlink cases, partial commit, cancellation and truthful Review metadata. Run parser tests, `pnpm exec vitest run packages/fs/tool-fs/tests`, a recorded native/PTC invocation and a real Client presentation case. Preflight is not an atomic multi-file commit; never hide partial effects or automatically replay uncertain writes.

At the fixed tag, both `dsh-base` and Web standard explicitly set `applyPatch: false`; the base observation-policy row is present but disabled. Inspect the resolved fork desktop/headless/persistent-question and user overlays too. This item keeps apply_patch opt-in and keeps our observation policy enabled. Add a negative composition check that fails if a copied preset disables the policy. Schema defaults alone do not satisfy this gate.

<a id="desktop"></a>
## AD: focused desktop-operation plugin

The user has approved AD-01; do not ask for that approval again. Its source is Vercel agent-desktop, not the DSH RC1 tag. Record its release/native digests in its own pins, not a false DSH BackportEntry.

Before writing the adapter, freeze an MCP-only Host/Client/preset/native-asset file list and prove startup, tool discovery and disposal through the current MCP client. Do not register projections, listen to agent/request, add Session events or change the generic input controller. If any becomes necessary, stop and reclassify AD behind M with a concrete dependency explanation.

Bundle a focused desktop-operation entry, keep standard unchanged, and retain one owner for shared-desktop interaction. Native executable/helper/version/skills/license must travel together with build-time digest verification and offline startup; no first-launch download or global enabling of dependency install scripts. Current native preflight is evidence only. Require installed MCP, permission/refusal, stale-ref, cancellation, disposal and clean-copy packaging acceptance before claiming delivery.

<a id="migration"></a>
## M: coordinated runtime migration

### M0: freeze the complete migration manifest

**Files:** create scoped `migration-files.json`, `projection-dispositions.json`, `request-dispositions.json` and `migration-validation.md` beside the assessment. The complete file/consumer/test manifest must be reviewed before M1; a list of package names is insufficient.

Regenerate the AST inventory and inspect alias/destructured/get-service uses. All 29 current registration rows in the linked ledger, all 83 direct service calls and any additional readers/aliases need dispositions. Cover commerce-mode, host/commerce, tool-agent-team, API model-selection projection, Team and both ask packages explicitly. For each old registration record its new owner/replacement, state compatibility, awaited initialization, retained reader, awaited disposal, checkpoint behavior, accepted source hash and runnable owner tests. Taking an upstream package whole does not waive comparison of its fork changes or old callers.

The model-selection state/notice machinery already exists in our helper. Reuse it and its tests, but migrate from entry-owned ModelSelectionRef plus request-time routing to Agent-owned durable selection captured before assembly. Inventory all four live request listeners: core/model-selection, assistant route-override, assistant rounds and webhook initial effort. Map the API-owned model-selection projection to the new owner; never register competing owners under one key.

The rounds listener caps maxTokens and throws on budget exhaustion; it does not change provider/model/effort. Keep its compatible control path or move it only with equivalent per-request, overlapping-round, cancellation and recovery tests. Do not remove it merely because routing use of agent/request is deprecated. Test selected assistant and standing-seat provider/model/effort through actual dispatched requests, including image validation, retries, absent effort and cold restore.

### M1: explicit runtime and Node decision

Portable lanes retain `^22.19.0 || >=24.0.0`. The coordinated DSH runtime migration adopts `>=24.9.0`; do not claim Cordis 4.1 alone requires it or is proven compatible with Node 22. Audit shipped Node binaries, source launch, dependency engines, both SDK runtime distributions and platform CI.

In the same change that raises the floor, create the Node migration guide pair and pairing record under `docs/upgrade-guide/v0.2.1-alpha.1/node-runtime-floor/` if the root version remains unchanged; otherwise use the root version at that change, as the owning skill requires. Explain affected source/SDK users, runtime installation and verification. Run `verify-upgrade-guides`, named pairing checks, supported-runtime source/SDK smokes and an actionable unsupported-runtime preflight. A metadata edit or the existing macOS Node 24.14 binary alone is insufficient.

M1 groups vendor Cordis/Loader/Include, tools resolution/execution, model selection, Session/projection/storage compatibility, PTC transport/cancellation, custom presets and both SDK consumers according to the reviewed manifest. Preserve immutable persistence generations, explicit type acknowledgements, required fork events and backup-or-stop behavior. Equal Session format 4 / SQLite schema 1 do not waive payload or lifecycle review. PTC ABORTED classification and config changes need their own applicable upgrade guides.

### M2: integration acceptance

Every registration ledger row must be resolved and tested; no synchronous old caller, duplicated projection owner or stale reader may remain. Exercise initialization failure, unload during work, retained readers/checkpoints, reactivation and cold restore. Verify every request-listener disposition and round budget behavior. Run all changed owners' focused tests and required per-file coverage, Host/Client compilers, both SDK expected outputs and strict recorded Sessions.

Re-run the real Host/Client question flow, canonical queued answer admission, native/PTC/MCP producing-step guards, copied legacy logs and profiles, Goal authority, IM receipt/connection ownership, Team/standing roster/model selection and the existing installer checks. Freeze exact code and artifact identities. Runtime migration is not accepted by typecheck, an updated version label or relaxed snapshots. Existing unrelated failures need explicit dispositions; they do not become passing checks.

<a id="dependent"></a>
## Dependent features

After M2, issue bounded implementation manifests for RC1-05–09 using their linked prerequisite classifications; keep input/Host, read-model and loader changes coherent. Add one BackportEntry per accepted item and qualify its current user path rather than copying all Client packages.

RC1-F1 starts with local Worktree/Forge and effective-cwd behavior. Resolve original workspace identity separately from execution cwd in Team previews, file navigation, data/knowledge bindings and Feishu question authorization. A Team per worktree-backed Lead Session is distinct from a new isolated-teammate provider; the latter needs its own design. Preserve shared-workspace standing teams. Test missing worktree recovery and cancel/restore before optional GitHub review/publishing. Do not grant merge or send authority from task completion.

RC1-S1 keeps one Automation Tasks entry and tests persistence, human/event input source, waiting-question supersession, cancellation and cold restore through actual Host controllers. It does not authorize the deferred outer Stage C runtime. Discuss Superagent only after the selected upgrade and these concrete capabilities are assessed.

<a id="acceptance"></a>
## Registry and acceptance

Each implemented RC1 item and migration/Forge/Schedule sub-item needs its own BackportEntry in `scripts/upstream-intake-registry.ts`: `sourceTag: 'dsh-v0.2.2-rc.1'`, `basePin: 'dsh-v0.2.1-alpha.1'`, exact paths, real prerequisites, source identity and runnable verification. No directory exemptions, placeholder accepted entries, whole-pin advance or replacement of the existing rc.2 entries.

All pnpm commands use the workspace's verified dependency configuration. Run owner tests and meaningful negative controls first, then changed-surface snapshots/browser/SDK checks. Run full source/native builds and every required installer gate against the integrated checkpoint, with a fresh copied artifact and signature/bundle correspondence. Record paid/platform and repository-wide limits separately. Do not reuse an earlier artifact's pass count as a new result.

Current acceptance: the P0 qualification record owns baseline acceptance. Adapter proofs, migration and selected-upgrade shipping checks remain unexecuted. This checkpoint changes no Node floor, plugin default or intake pin; generated catalogs reflect only the selected baseline source.

<a id="dev-note"></a>
## Dev Note

None.
