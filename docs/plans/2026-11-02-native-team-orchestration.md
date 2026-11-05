# Native Team Orchestration Implementation Plan

English | [中文](2026-11-02-native-team-orchestration.zh.md)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bundle a DSH-native `team-orchestration` skill that helps users delegate explicitly requested teamwork, coordinate dependencies, and receive evidence-backed results without installing Orca.

**Architecture:** Keep DSH's Team service, tools, Session logs, and existing desktop collaboration panel as the execution system. Add a concise skill with on-demand references through the existing bundled-skills pipeline. Verify lifecycle guarantees in the owning runtime; do not represent skill instructions as enforced attempt isolation or recovery.

**Tech Stack:** Markdown skills, Cordis, existing Team and subagent services, Vitest, recorded Session snapshots, and the existing Tauri desktop packaging scripts.

**Status:** Draft for review. This document authorizes no implementation, dependency installation, model spending, commit, push, or release. Planning and the focused baseline checks below are complete; implementation and release acceptance remain pending.

## Summary

Deliver an honest, bounded first version using DSH's existing tools. Default installation makes the skill discoverable; only a user's explicit teamwork request permits teammate creation. Stronger automatic retries, attempt ownership, and remote-worker recovery belong to a separately specified runtime extension if the initial audit finds them necessary.

## Contents

- [Verified starting point](#starting-point)
- [Product decisions](#product-decisions)
- [Capability mapping](#capability-mapping)
- [Implementation tasks](#implementation-tasks)
- [Acceptance and release](#acceptance)
- [Deferred runtime work](#deferred-work)

<a id="starting-point"></a>
## Verified starting point

The locally installed Orca skill is a discovery stub. Its version-matched guide, loaded with `orca skills get orchestration`, defines authoritative execution attempts, durable message delivery, explicit completion, and resource settlement. The native skill will describe these ideas independently in DSH terms; it will not redistribute Orca documentation or call Orca commands.

The inspected DSH sources are [Team types](../../packages/experimental/agent-team/src/types.ts), [task mutations](../../packages/experimental/agent-team/src/task-board.ts), [mailbox](../../packages/experimental/agent-team/src/mailbox.ts), [activity waits](../../packages/experimental/agent-team/src/activity.ts), [model-facing tools and policy](../../packages/experimental/tool-agent-team/src/index.ts), and [standing-team rounds](../../packages/experimental/assistant-registry/src/rounds.ts). Generic Team tasks currently have `pending`, `in_progress`, `completed`, and `deleted` statuses; they do not expose an Orca Dispatch entity. Standing-team round attempts are a separate mechanism and must not be silently substituted for generic Team task attempts.

Desktop distribution already has a [skill manifest](../../scripts/desktop-bundled-skills.json), [seed script](../../scripts/seed-desktop-bundled-skills.mjs), and [startup installation](../../apps/desktop/src-tauri/src/app.rs). The new skill is absent from the current manifest. The [skill registry](../../packages/skill/skill/README.md) supports discovery and on-demand loading.

Planning baseline: `pnpm exec vitest run packages/experimental/agent-team/tests/team.spec.ts packages/experimental/agent-team/tests/persistence.spec.ts packages/experimental/tool-agent-team/tests` passed 79 tests across three files. This establishes the selected existing baseline, not the acceptance cases proposed below. No external Orca workers or paid providers were started for planning.

<a id="product-decisions"></a>
## Product decisions

1. Install the skill by default in the fork's desktop distribution. Do not auto-start teams, change the default assistant, introduce a background scheduler, or require another model account beyond the configured DSH providers.
2. Use native tools only. If the required tools are unavailable in a profile, explain the limitation and stop delegation; never install Orca, invoke shell-launched substitute agents, or modify composition automatically.
3. Support an explicitly requested ad-hoc team first. An existing standing team retains its own roster, models, coordinator, rounds, and cancellation; the skill must not replace its members with newly spawned teammates.
4. Preserve the user's model and reasoning selections. Resolve overrides through the existing model-selection policy, distinguish requested selections from effective selections, and report unsupported selections rather than switching silently.
5. Preserve human decision authority and existing permission enforcement. A worker question cannot grant more privileges, approve publication, or broaden the user's task. Review-only assignments remain read-only unless the user authorizes fixes.
6. Keep the normal path short: define acceptance, split ownership, launch independent work, coordinate, verify, report. Load recovery and task-writing references only when needed. No new persistent memory or automatic memory extraction is part of this feature.
7. Reuse the collaboration panel and existing localized controls. The first version adds no new settings page, home entry, panel, provider, or application product logic in `apps/desktop`, `packages/bundle/desktop-app`, or desktop-companion.

<a id="capability-mapping"></a>
## Capability mapping

| Orca practice | DSH owner or operation | First-version obligation |
| --- | --- | --- |
| Self-contained Task specification | `team_task_create`, task description, `write_scopes` | Specify target, result, constraints, owner, dependencies, and observable acceptance |
| Independent execution wave | `spawn_teammate`, `send_message` | Launch only requested, genuinely independent work; keep shared-file edits ordered |
| Dependency readiness | `team_task_list`, `team_task_get`, `team_task_update` | Read current revisions before mutation; readiness does not wake a worker |
| Durable messages | `send_message`, Team mailbox | `accepted` or `queued` means the send is durable; neither proves comprehension or task success |
| Supervised waiting | `list_agents`, `wait_agent` | Wake required inactive workers before waiting; re-read state after a change, timeout, or `noProgress` |
| Worker questions | Native peer messages and existing Lead human-question path | Route questions through the Lead; use current question/approval tools only within their existing authority |
| Explicit result and acceptance | Worker message, task state, artifacts, tests, Lead verification | A worker's closing text and `completed` task status are claims to verify, not independent evidence |
| Stop and cleanup | `interrupt_agent`, subagent lifecycle | Verify cancellation settles before reassigning edits; no terminal-close or worktree-delete instructions |
| Attempt fencing and automatic retry | No generic Task-to-Dispatch equivalent established | No automatic retry or attempt-isolation promise; unresolved work remains explicitly unresolved |
| Remote placement and worktree isolation | Outside the first-version workflow | Do not advertise SSH execution, distributed scheduling, or automatic isolated worktrees |

<a id="implementation-tasks"></a>
## Implementation tasks

### Task 1: Establish the exact runtime guarantees

**Inspect:** the source owners linked above; `packages/experimental/agent-team/src/roster.ts`; `packages/subagent/subagent/src/index.ts`; `packages/experimental/assistant-registry/src/dispatch-ownership.ts`; and the existing Team and tool test suites.

**Steps:** Trace each mapped operation through its executing owner and durable events. Add only missing behavior tests to `packages/experimental/agent-team/tests/team.spec.ts`, `packages/experimental/agent-team/tests/persistence.spec.ts`, and `packages/experimental/tool-agent-team/tests/tool-team.spec.ts`. Record the resulting guarantees and limitations in the owning README pairs, with this plan retaining links rather than a second runtime specification.

**Required probes:** Two claimants with one revision; dependency cycles and blocked-task admission; durable queued delivery across restart without duplicate target input; a wait returning `noProgress`; interruption followed by attempted reassignment; a late result after cancellation; and a worker stopping without completing its task. Assert durable events, actual child state, and external files where relevant. Do not infer cancellation or successful work from a roster label alone.

**Decision:** If a safe workflow can be expressed with current operations, continue with its documented limitations. If any probe reveals a correctness defect, write the failing regression first and fix the smallest owning path before making the corresponding claim. If safety requires new task-attempt persistence or a new capability, stop that implementation slice at a concrete follow-up design; do not add speculative schemas or hide the gap in the skill.

**Validation:** Run the same 79-test baseline command plus each newly affected focused file. Demonstrate that every new regression rejects the faulty behavior before its fix. Use barriers for race scenarios and temporary resource roots; do not use timing sleeps as evidence.

### Task 2: Author the native skill and focused references

**Create:** `.agents/skills/team-orchestration/SKILL.md`, `.agents/skills/team-orchestration/references/task-spec.md`, and `.agents/skills/team-orchestration/references/recovery.md`. Add Codex invocation metadata only if this distribution needs it, keeping its policy consistent with frontmatter. Consult the repository skill-authoring guidance during implementation.

**Steps:** Write discovery metadata naming explicit teamwork and supervision requests. Keep the main guide concise and explain Lead and teammate responsibilities, current tool names, task revisions, durable sends, bounded waits, and evidence-based reporting. Put task examples and failure/recovery examples in the two references. Write original DSH guidance; do not copy Orca's stub or its runtime-specific instructions.

**Required task fields:** Target files or materials; concrete deliverable; constraints; one editing owner per shared file; actual dependencies; model selection when the user specifies it; and acceptance evidence. Use lower-kebab-case teammate names and language appropriate to the user's task. Never invent a task `failed` status, `worker_done`, an acknowledgement command, a terminal release, or a runtime API that DSH does not expose.

**Required worker report:** Identify the task, state `succeeded`, `failed`, or `unresolved` as report text, list artifacts and checks with results, name limitations, and state whether edits occurred. These words are report content, not new durable task statuses. A worker reports before marking its task complete; on failure or uncertainty it leaves the task incomplete, informs the Lead, and does not launch a replacement automatically.

**Required Lead report:** Account for every requested task, reconcile worker claims with artifacts and verification, identify incomplete work, and describe any explicit next-owner decision. Do not declare the overall task complete while required work is unresolved. Do not impose permanent worker idleness or cleanup obligations unsupported by DSH's native lifecycle.

**Validation:** Review every named tool and field against current schemas. Run `pnpm run verify-skill-invocation-metadata`; separately test the actual DSH filesystem provider loading the skill and its references, since the metadata check alone does not establish discoverability or behavior.

### Task 3: Verify model-facing behavior through the real profile

**Create:** `snapshots/session/team-orchestration/` as a Session-driven case following `snapshots/AGENTS.md`. **Extend:** `packages/experimental/tool-agent-team/tests/tool-team.spec.ts` for tool-level negative cases. Reuse `snapshots/session/team-targets/` for existing policy/schema expectations only if those outputs actually change.

**Steps:** Mount the skill through a temporary DSH home and the shipped skill provider in a real `dsh` profile. Record an explicit two-teammate task with a dependency, messages, acceptance checks, and a final accounting. Make discovery, on-demand loading, native tool calls, child Sessions, and final artifacts observable. Use the existing snapshot runner and mocked/recorded model boundary rather than a hand-mounted-only demonstration.

**Negative cases:** An ordinary single-agent request starts no teammate; a missing Team tool set does not trigger a shell fallback; a durable `queued` send is not resent; a timeout does not spawn a replacement; an inactive required worker is messaged before waiting; conflicting task revisions are rejected; overlapping write scopes remain advisory and never masquerade as locks; a fabricated success report without its artifact fails Lead acceptance.

**Validation:** Run `pnpm run test:snapshot -- -t team-orchestration` after creating and registering the scenario, plus the focused Team/tool tests. Extend the owned snapshot harness in the same change if needed. Any fresh recording that requires paid inference needs separately authorized bounded calls; keyless replay remains the required repeatable check.

### Task 4: Pin and verify default skill distribution

**Modify:** `scripts/desktop-bundled-skills.json`. **Create:** `scripts/seed-desktop-bundled-skills.spec.ts` for isolated manifest/seed fixtures if no existing owner covers them. **Inspect and change only as needed:** `scripts/seed-desktop-bundled-skills.mjs`, `scripts/verify-desktop-bundle.sh`, and `scripts/verify-desktop-exe.mjs`.

**Steps:** Add `{ "name": "team-orchestration", "path": ".agents/skills/team-orchestration" }` to the manifest. Reuse manifest-driven collection. Verify the guide and both references survive seeding, startup installation, and an upgrade refresh, and that an existing same-name override is handled according to the current precedence/refresh rules. Avoid new dependencies and any Orca runtime payload.

**Acceptance:** Missing or malformed bundled skill files fail the owning verification with the exact missing path; the valid payload loads through DSH; unrelated user skills survive installation and refresh. Never change refresh behavior or overwrite policy merely to make this skill work. If the current pipeline fails this requirement, make the smallest tested change in its existing owner.

**Validation:** Run the focused new seed spec and existing verifier specs affected by edits. Seed into a uniquely created temporary directory with `node scripts/seed-desktop-bundled-skills.mjs --out <temporary-directory>` during implementation; record any existing npm-sourced entries that require network. No default manifest edits occur during planning.

### Task 5: Document, qualify, and deliver the installable desktop

**Update as affected:** the Team and tool README pairs, `apps/desktop/README.md`, and the upstream intake registry for any covered fork edits. Keep model-visible guarantees in their owning package and link them from the skill. New lifecycle/persistence changes require their owning docs, declared type acknowledgements, and TypeScript/Python SDK projections where applicable; a new skill alone does not justify a Session format change.

**Steps:** Run focused behavior and snapshot checks, skill metadata validation, `pnpm run test:docs`, and `pnpm run doc-sync`. Apply `dsh-pre-push-checks` when preparing a commit/push; keep unrelated dirty work untouched. Record every blocked or unrun check accurately rather than copying old packaging evidence.

**Desktop qualification:** Follow the existing pipeline: `pnpm run build`, then `cargo tauri build` from `apps/desktop`, then `bash scripts/build-dmg.sh --arch arm64` from the repository root. Its bundle verifier must pass. Copy the produced app out of the mounted DMG into a fresh test location/home, verify installed skill contents and discovery, run the explicit collaboration scenario, restart, and confirm durable tasks/messages and truthful unresolved-state reporting. Ordinary chat must still create no workers. Test without Orca available to the launched app.

**Release evidence:** Preserve sanitized commands/results, payload and installed skill hashes, effective worker model selections, Session/task identities, acceptance artifacts, and restart observations. Do not include credentials or private user conversations. Claim only the platform and installation path actually tested. Windows acceptance requires its own built installer and installed-flow evidence; macOS evidence does not establish it.

<a id="acceptance"></a>
## Acceptance and release

| Milestone | Required evidence | Allowed claim |
| --- | --- | --- |
| Plan | Source mapping and selected existing tests | Draft design only |
| Native skill | Tool-accurate guide, provider loading, negative cases, keyless Session replay | Native workflow verified for the tested composition |
| Default bundle | Valid payload plus deliberate missing-reference rejection | Skill is included and installation is checked |
| Desktop delivery | Fresh copied-DMG run, no Orca dependency, explicit team task, restart, ordinary-chat control | Ready for the tested desktop platform and channel |
| Stronger recovery | Separately reviewed runtime design and adversarial lifecycle evidence | Only the specific implemented guarantees |

Implementation order is Task 1, Task 2, Task 3, Task 4, then Task 5. Keep runtime repairs, skill/snapshot work, and distribution changes reviewable as separate scoped commits. No commit, push, or packaging is part of the current planning request.

<a id="deferred-work"></a>
## Deferred runtime work

Automatic retries, generic task-attempt identifiers, stale-attempt fencing, machine-enforced acceptance, blocking cross-worker question/reply state, remote placement, and distributed cleanup are not first-version promises. For each needed extension, specify the owning service and consumer, durable transitions, exact execution authority, cancellation settlement, restart behavior, model/user-visible output, and negative controls before implementation. Reuse standing-team attempt ownership only if a complete consumer mapping supports it; do not create a parallel coordinator runtime by analogy with Orca.

The four memory defects from the earlier review are separate work. This skill must not rely on automatic memory extraction or imply that installing orchestration repairs memory removal, extraction, or prompt-selection behavior.
