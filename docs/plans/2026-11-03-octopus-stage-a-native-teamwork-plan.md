# Stage A Native Teamwork Implementation Plan

**Goal:** Ship a default-discoverable native teamwork skill that accurately guides explicit DSH collaboration without an Orca runtime dependency.

**Architecture:** Reuse Team tools, task board, durable messages, and the existing collaboration panel. The skill teaches supervision; it does not add attempt fencing, permission enforcement, persistent questions, or automatic recovery. Extend existing skill packaging checks to validate the two required references.

**Tech Stack:** Markdown, a dependency-free skill manifest, existing Cordis Team tools, Vitest, Session replay, and the desktop skill seed pipeline.

**Execution status:** This plan replaces the 11-02 draft. A2/A4 source and A5 owner documentation are independently source-reviewed. A3's two-worker scenario, both controls, adjacent multi-session cases, and header regressions pass root keyless replay, with the recorded JSONL files unchanged. Its [final implementation review](../../.plans/octopus-implementation/orchestration/cursor-team-replay-final-review.md) accepts the compiler and Cordis cleanup at 8/10 with no Required findings; root independently passes 181 runtime tests, eight strict replay/header checks, and the source-plus-tests compiler check. A4.6's real startup-refresh and project-precedence tests pass and have an [independent review](../../.plans/octopus-implementation/orchestration/cursor-a4-refresh-precedence-review.md). A6 installed qualification remains pending. See the [roadmap checkpoint](2026-11-03-octopus-implementation-roadmap.md#current-execution-evidence) and [source review](../../.plans/octopus-implementation/orchestration/cursor-stage-a-final-review.md).

## Summary

Deliver explicit teamwork with accurate model selection, standing-squad handling, artifact verification, truthful unresolved results, and installable skill content. This plan is independent of persistent decisions and Feishu. Read the [roadmap](2026-11-03-octopus-implementation-roadmap.md), [design](2026-11-03-octopus-human-led-orchestration-design.md), and [earlier review](../../.plans/native-team-orchestration/cursor-review-2026-11-03.md) first.

## Task A1: Pin the current Team guarantees

**Inspect:** `packages/experimental/agent-team/src/{task-board,task-graph,task-view,roster,mailbox,activity,journal,institution}.ts`, `packages/experimental/tool-agent-team/src/index.ts`, `packages/subagent/tool-subagent/src/model-selection.ts`, and `packages/experimental/assistant-registry/src/{rounds,dispatch-ownership}.ts`.

**Test owners:** `packages/experimental/agent-team/tests/team.spec.ts`, `persistence.spec.ts`, `institution.spec.ts`, and `packages/experimental/tool-agent-team/tests/tool-team.spec.ts`. Put a subagent defect's regression in its actual owning test package rather than forcing it into Team tests.

1. Run the current focused Team/tool baseline and preserve the actual count and result; do not carry forward the historical 79-pass claim.
2. Trace every skill operation to its owner. Record a short guarantee matrix in `.plans/octopus-implementation/stage-a/source-matrix.md`, including source locations and the expected facts below.
3. Add only missing public-behavior assertions. Use barriers and temporary workspaces for concurrency and side-effect checks.
4. If the current implementation violates a documented guarantee, reproduce it before a narrowly scoped fix. If it implements a documented limitation, retain the limitation in the skill instead of adding a recovery runtime.
5. Re-run only newly affected focused owners and review their durable events and child state.

| Probe | Required observation |
| --- | --- |
| Same revision claimed twice | One commit; stale claimant rejects with `TEAM_TASK_STALE_REVISION` |
| Unmet dependency or cycle | Current `TEAM_TASK_BLOCKED` / `TEAM_TASK_DEPENDENCY_CYCLE` rejection; no worker launch |
| Interrupt live worker | Cancellation requested; existing task ownership and durable mail retained |
| Worker ends without completing task | Roster may say `completed` while task stays `in_progress`; report remains unresolved |
| Failed provisioning and same-name spawn | Name remains consumed; `TEAM_MEMBER_NAME_TAKEN` |
| Overlapping write scopes | Advisory warning; no filesystem lock or read-only guarantee |
| Cold-target message | Inspect durable delivery/child receipt; tool `accepted` alone is not the oracle |
| Second generic send | New message identity; do not claim model-facing idempotent resend |
| Standing squad | Existing seats, catalog routes, and round ownership remain distinct from fresh ad-hoc spawning |

**Run:** `pnpm exec vitest run packages/experimental/agent-team/tests/team.spec.ts packages/experimental/agent-team/tests/persistence.spec.ts packages/experimental/agent-team/tests/institution.spec.ts packages/experimental/tool-agent-team/tests/tool-team.spec.ts`.

**Expected:** Current guarantees pass. A missing guarantee or tooling mismatch remains explicitly unresolved; green tests do not add capabilities beyond their assertions.

## Task A2: Author the skill and its reference files

**Create:** `.agents/skills/team-orchestration/SKILL.md`, `.agents/skills/team-orchestration/package.json`, `.agents/skills/team-orchestration/references/task-spec.md`, and `.agents/skills/team-orchestration/references/recovery.md`. Read `skill-creator` before authoring reusable skill metadata.

1. Add a private, dependency-free package manifest following `.agents/skills/term-glossary/package.json`. Use name `team-orchestration`, version `0.1.0`, and no runtime dependencies.
2. Write a narrow skill description: explicitly requested DSH teamwork, delegation, and supervision. State that missing Team tools means explain the limit and continue without recruiting or installing substitutes. Catalog discovery is not filtered by tool availability; wording and recorded traces are guidance, not enforcement.
3. Make the first branch standing squad versus ad-hoc team. Existing standing seats are reused; the skill never spawns additional members or describes Host round remotes as model tools. Seat model edits belong to the catalog. Generic sends into an owned standing round may wait; do not compensate by recruiting a replacement.
4. Describe fresh spawn provider/model pairs, fork override rejection, session route restrictions, requested versus effective selection, and reasoning-effort clearing on route change. Relay actual tool errors. Follow the existing Team language policy.
5. Define the normal flow: outcome/evidence, ownership/dependencies, explicit launch, durable messaging, bounded supervision, artifact inspection, and final accounting. Require one editor per shared file and preserve review-only intent without claiming enforced read-only workers.
6. Put task templates in `references/task-spec.md`; put interruption, inactive worker, queued send, unresolved outcome, and consumed-name cases in `references/recovery.md`. Explicitly instruct the model to read these relative paths when needed; `skills.get()` does not return their bodies automatically.
7. Make worker reports identify task, artifact, checks/results, limitations, and whether edits occurred. Text labels such as succeeded/failed/unresolved are reports, not invented Team states. The Lead verifies evidence and accounts for every required task.

**Acceptance:** Every tool name and argument exists in the current schema. No `worker_done`, terminal release, generic Dispatch, exactly-once claim, automatic respawn, or shell-launched agent fallback appears as an available DSH operation.

**Run:** `pnpm run verify-skill-invocation-metadata`. Also verify provider discovery and explicit filesystem reads in A3; a metadata pass alone proves neither. DSH does not read `agents/openai.yaml`; do not create it for this delivery.

## Task A3: Verify discovery and Team-composed recorded flows

**Create scenario directories:** `snapshots/session/team-orchestration/`, `team-orchestration-single-agent/`, `team-orchestration-standing/`, and `team-orchestration-no-tools/`. Each owns `snapshot.yml`, composition/replay patches as required, canonical versioned Session fixtures, and independent workspace expectations when files are edited.

**Inspect:** `snapshots/AGENTS.md`, `snapshots/session/team-targets/{snapshot.yml,cordis.yml,cordis.snapshot.yml}`, `packages/skill/skill-filesystem/README.md`, and existing snapshot runner owners discovered through `vitest.snapshot.config.ts`.

1. Before creating fixtures, confirm whether a pre-seeded standing Team session and catalog can exercise the required standing-squad case through the real `headless` plus Team composition. Catalog administration and round operations are Host-owned. If the case cannot run there, move that acceptance case to A6's installed Host flow; do not construct a hand-mounted substitute. Use the `team-targets` composition for supported headless cases and the shipped filesystem skill provider in an isolated DSH home.
2. Prerequisite: the new scenarios have no recordings, so initial recording requires `DEEPSEEK_API_KEY`, an explicitly authorized provider/model, a maximum recording count and token/spend budget, and permission for those bounded calls. Record that budget before A3; absent authorization, retain A3 as pending and do not claim keyless replay proves discovery. Record an explicitly requested two-worker task with one dependency and independent acceptance artifacts. Pin on-demand skill text in its tool result, because normalized request prompts are not a readable instruction oracle.
3. Add an ordinary single-agent request and a no-Team-tools composition that create no teammates in their recorded traces. These are model-compliance observations, not proof that `spawn_teammate` checks user intent.
4. If the A3.1 feasibility check supports it, record the existing standing-squad session with no new roster member, exact requested/effective route reporting, and no invented round tool. Otherwise record the deferral and assert those same facts in A6, preserving full Host behavior.
5. Add tool-level negatives in `packages/experimental/tool-agent-team/tests/tool-team.spec.ts`: partial route, forbidden route, fork override, stale task revision, and current advisory-overlap behavior. Reuse existing assertions rather than duplicating them.
6. Exercise the actual provider loading `SKILL.md`, followed by explicit reads of both references. Verify project skill precedence over home-seeded content without changing precedence.
7. Review every Session, tool-result, child-role, and workspace diff. Retain current-writer filenames; never rename committed historical generations or add a hidden application launcher.

**Run after scenario registration:** `pnpm run test:snapshot -- -t team-orchestration`, then the focused changed tool tests. **Expected:** All selected replays pass keylessly; ordinary chat traces recruit no workers, and fabricated success without its artifact remains unaccepted in the recorded Lead flow. Live-model generalization remains outside that claim. Initial recording of every new scenario is a budgeted paid prerequisite; replay is keyless only after those fixtures exist. No recording is authorized by this planning document.

## Task A4: Pin the skill and validate required references

**Modify:** `scripts/desktop-bundled-skills.json`, `scripts/seed-desktop-bundled-skills.mjs`, and `scripts/verify-desktop-bundle.sh`.

**Create:** `scripts/bundled-skill-files.mjs`, `scripts/verify-desktop-bundled-skills.mjs`, and `scripts/seed-desktop-bundled-skills.spec.ts`. Extend `scripts/verify-desktop-exe.mjs` and its spec only if needed to keep the same declared required-file rules across both packaging paths.

1. Add failing fixture cases for absent `references/task-spec.md` and `references/recovery.md`. Keep existing missing-`SKILL.md` and missing-`package.json` rejection behavior; do not build another implementation of those existing checks.
2. Add the manifest entry below. Treat `requiredFiles` as a proposed new manifest field consumed by the shared helper, not a field that already works.

```json
{
  "name": "team-orchestration",
  "path": ".agents/skills/team-orchestration",
  "requiredFiles": ["references/task-spec.md", "references/recovery.md"]
}
```

3. Implement shared requirement resolution in `bundled-skill-files.mjs`: `requiredFiles` for file paths, `requiredDirectories` for directory payloads, and `requiredText` entries containing a file path and required literal. Validate the manifest and relative paths before joining them. Declare all current per-skill requirements in the manifest, not in helper branches keyed by skill name. Seeder and assembled-bundle verifier both consume the same declared references. Represent existing specialized payload/dependency checks as manifest-driven requirements in the same validator: WeChat rate-limit script and `node_modules`, Archify executable, glossary files, and the media skill's required wording. Keep equivalent failure messages and negative fixtures.
4. Add `verify-desktop-bundled-skills.mjs --root <bundled-skills-directory>` as a validation script and replace the actual DMG verifier's per-skill shell blocks with this manifest-driven call. Keep only the common seed-entrypoint checks in shell; do not leave a parallel hardcoded list. An omitted skill or reference must fail with its exact relative path. A green Windows verifier alone does not qualify the DMG path.
5. Test with an isolated fixture repository containing the real seed/validation scripts and a workspace-only skill manifest. Do not add a production test-only root override or require npm/network to run a unit fixture. Verify a valid recursive copy, missing-reference failure, and unrelated skill preservation.
6. Test the current startup refresh and project precedence separately; do not change delete-and-recopy policy, hash behavior, or precedence for this skill. Inspect `apps/desktop/src-tauri/src/app.rs` without changing official application logic.

**Run:** `pnpm exec vitest run scripts/seed-desktop-bundled-skills.spec.ts`; run `scripts/verify-desktop-exe.spec.ts` only if its owner changed. Test the validator against assembled synthetic payloads with each required reference removed in turn, missing WeChat dependencies, missing Archify executable, missing glossary payload, and missing media wording. **Expected:** Valid fixtures pass; omitted references fail; no npm dependency is added to this skill.

## Task A5: Update owner documentation and integrate checks

**Update only if contracts or guarantees changed:** Team/tool README pairs, skill-owner documentation, `apps/desktop/README.md`, and `scripts/upstream-intake-registry.ts` for a covered fork edit actually reported by its verifier. A new skill alone does not justify a Session-format change.

1. Document discovered limitations in their existing owners; link from the skill instead of creating a competing runtime specification.
2. Run A1's affected tests, A3 replay, A4 fixtures, and skill metadata checks. Do not repeat an already passing command unless another edit affects its inputs.
3. Run `pnpm run test:docs`, then `pnpm run doc-sync`, and relevant lint/type checks sequentially. Report unrelated failures accurately and preserve dirty work.
4. Verify the scoped diff contains no product logic in official desktop/desktop-app/companion, no Orca dependency, and no unrelated memory repair. Apply pre-push guidance only when preparing a push.

## Task A6: Qualify the installer

**Artifact:** `dist/octopus_DSH.dmg`, through the existing pipeline described in the roadmap. This is an implementation delivery step, not a claim that packaging ran during planning.

1. Build the Host/Client, build the Tauri app, and build the arm64 DMG sequentially. Require the actual DMG bundle verifier to pass.
2. Copy the app from the produced DMG into a fresh test location and use a fresh test home. Verify the guide, package manifest, and both references are present and hash them.
3. Verify installed skill discovery and reference reading through the real provider. Run the explicit collaboration example, ordinary-chat control, standing-squad case, and restart inspection of tasks/mail. Ensure Orca is unavailable to that app's test environment.
4. Reinstall/refresh in the test home and verify required references survive while unrelated user skills remain. Inspect effective model selections rather than trusting display labels.
5. Preserve sanitized artifacts and observations in `.plans/octopus-implementation/stage-a/acceptance.md`. Mark the tested platform only; Windows needs its own artifact and installed-flow evidence.

## Completion criteria

The skill, references, model-selection rules, current lifecycle limits, keyless Team traces, required-reference negative checks, and fresh installed flow all have evidence. Runtime tests and cooperative model traces are reported separately. Earlier R1–R7 findings are mapped to dispositions in the evidence report; this plan does not declare them closed merely because it includes their requirements.

## Dev Note

This English working plan supersedes execution of the 11-02 draft and does not depend on Stage B or authorize Stage C work. Suggested review checkpoints are after A1, A3, A4, and final installer qualification; implementation commits, when requested, should preserve those scoped units.
