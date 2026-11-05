# Review: native DSH team-orchestration plan

Date: 2026-11-03
Scope: review only. No product, plan, test, or manifest edits.

## Verdict

**Not ready to implement.** The direction is sound: a default-discoverable DSH skill, explicit teamwork requests, native Team tools, no Orca dependency, and lifecycle claims kept in the owning runtime. The architecture paragraph, the deferral of attempt fencing, and the “a new skill does not bump the Session format” rule match the current code.

The task list, capability table, and acceptance rows do not yet match those owners. An implementer following them can write a skill that treats interrupt, roster `completed`, and `queued` as settlement, can “fix” documented mailbox and ownership limits, and can pass the desktop bundle gate without shipping the skill. Resolve the required findings in the plan before execution.

## Inspected scope

- `docs/plans/2026-11-02-native-team-orchestration.md`
- `docs/plans/2026-11-02-native-team-orchestration.zh.md`
- `docs/plans/2026-11-02-native-team-orchestration.i18n.yaml`
- Team owners: `packages/experimental/agent-team/src/types.ts`, `task-board.ts`, `task-graph.ts`, `task-view.ts`, `mailbox.ts`, `activity.ts`, `roster.ts`, `journal.ts`, `institution.ts`, `README.md`
- Tools: `packages/experimental/tool-agent-team/src/index.ts`
- Standing rounds and dispatch ownership: `packages/experimental/assistant-registry/src/rounds.ts`, `dispatch-ownership.ts`
- Subagent interrupt: `packages/subagent/subagent/src/continuation-activation.ts`
- Child model selection: `packages/subagent/tool-subagent/src/model-selection.ts`
- Skill discovery: `packages/skill/skill/README.md`, `packages/skill/skill/src/index.ts`, `packages/skill/skill-filesystem/README.md`
- Desktop seed and gates: `scripts/desktop-bundled-skills.json`, `scripts/seed-desktop-bundled-skills.mjs`, `scripts/verify-desktop-bundle.sh`, `scripts/verify-desktop-exe.mjs`, `scripts/build-dmg.sh`, `scripts/write-seed-rev.mjs`, `apps/desktop/src-tauri/src/app.rs`, `packages/experimental/client-ui-agent-team/cordis.patch.yml`, `packages/boot/app-boot/src/profile.ts`
- Snapshot rules: `snapshots/AGENTS.md`, `snapshots/session/team-targets/snapshot.yml`
- Version-matched Orca guide from `orca skills get orchestration` (read only; no workers, tasks, or runs)

## Checks actually run

- `orca skills get orchestration` exited 0 and returned the full orchestration guide used for the mapping and translation checks.
- Counted `it(` declarations in the plan’s baseline files: `team.spec.ts` 58, `persistence.spec.ts` 5, `tool-team.spec.ts` 16, total 79. Those files have no `it.each`. This matches the plan’s count of cases. The tests were not re-executed, so this review does not confirm that they pass.

## Required findings

### R1. Task 1 probes have no pass condition, and several fight the published owner

**Where:** plan Task 1, English lines 71–79 (Chinese 任务 1, same lines). Capability row “Stop and cleanup”, English line 62. Owners: `packages/experimental/agent-team/README.md` lines 133, 137, 147, 213–214; `src/roster.ts` lines 206–216 and 522–529; `src/task-board.ts` lines 129–136 and 172–187; `src/journal.ts` lines 42–51; `src/mailbox.ts` lines 129–139 and 307–318; `packages/subagent/subagent/src/continuation-activation.ts` lines 322–325; `src/roster.ts` `deriveResult` lines 489–502.

**Failure:** The probes name scenarios and then say to assert “durable events, actual child state, and external files where relevant.” They do not say which result is success. The same task says to add tests only in three files, and to fix the smallest owning path when a probe fails. Those instructions disagree with the current contracts:

- `interrupt()` samples `previousStatus` and then calls `subagents.interrupt`. It returns before the turn ends. The continuable interrupt cancels the live turn with `keepInbox: true`. The Team README states that interrupt does not release task ownership and does not delete durable mail. `claim` accepts only a `pending` ready task. `reassign` is a separate Lead compare-and-set and does not wait for the previous turn. A skill step of “interrupt, then treat the tool result as settlement, then claim” fails closed: the task stays `in_progress` with the old owner, and a second claim is rejected.
- A non-running member whose durable phase is `active` gets `result.outcome: 'completed'` from `deriveResult`, including a worker that stopped with the task still `in_progress`. Roster `completed` here means the session is not running. It is not task acceptance. The probe “worker stopping without completing its task” has to expect both facts together. A test that treats roster `completed` as success will bless the failure mode the plan wants to catch.
- Failed provisioning still reserves the teammate name. `memberName` rejects reuse with `TEAM_MEMBER_NAME_TAKEN`. A recovery reference that respawns the same kebab-case name fails.
- Two claimants of one revision are already serialized by `journal.transact`. After the first commit, the second caller’s same `expectedRevision` fails with `TEAM_TASK_STALE_REVISION`.
- Dependency cycles fail in `assertTaskGraphCandidate` (`TEAM_TASK_DEPENDENCY_CYCLE`). A claim of a task whose blockers are not `completed` fails with `TEAM_TASK_BLOCKED`. Create cannot form a two-node cycle in one call, because each blocker must already exist.
- The mailbox README’s restart claim is process-local retry plus target-session de-duplication, and it states that concurrent processes are not exactly-once. The probe text “without duplicate target input” is stricter. Task 1’s “fix the defect” rule would treat that documented limit as a bug.
- When the target agent is not loaded and the child log does not yet contain the message, `dispatchOnce` steers and returns `true` without `checkpointDelivered` on that branch. Tool status `accepted` is the wrong oracle for a cold target. The Lead `team/message/delivered` event and the child log are the durable receipt.
- A late write after cancel lives in the subagent activation, which Task 1 forbids as a test home.

**Impact:** The skill will tell the Lead that interrupt settles ownership, or the implementation will add attempt fencing, automatic release, or exactly-once delivery while the plan’s deferred section says those are out of scope. Task 5’s restart check can then report a truthful unresolved task as roster-`completed` and call that success.

**Correction:** Give each probe an expected event, error code, and unchanged fact taken from the current owner. In particular: interrupt leaves the task owner in place; the Lead must `reassign` or the owner must `release` before anyone can `claim`; roster `result.outcome` is not task acceptance; a failed name is consumed; stale revision and blocked claim stay the current errors; restart de-dupe stays the README’s process-local guarantee. Put a regression in the package that owns the failing behavior. Keep a documented limitation as skill text unless the probe shows that the documented guarantee itself is false.

### R2. Standing-team sessions, model selection, and language are one workflow with three owners

**Where:** product decisions 3 and 4 and Task 2 “language appropriate to the user’s task”, English lines 44–45 and 87. Task 3 negatives, line 101, do not include a standing session. Owners: `packages/experimental/agent-team/src/institution.ts` lines 154–176; `src/roster.ts` lines 253–255 and 273–276; `packages/experimental/client-ui-agent-team/cordis.patch.yml` lines 26–33 (`maxMembers: 8`); `packages/experimental/tool-agent-team/src/index.ts` lines 42–50 and 264–290; `packages/subagent/tool-subagent/src/model-selection.ts` lines 99–152; `packages/experimental/agent-team/src/types.ts` lines 242–247; `src/mailbox.ts` lines 218–226; `packages/experimental/assistant-registry/src/dispatch-ownership.ts` lines 281–292. Round scheduling is a Host remote on `assistant-registry` (`scheduleRound` / `executeRound`), not a `tool-agent-team` tool.

**Failure:** Decision 3 says an existing standing team keeps its roster, models, coordinator, rounds, and cancellation, and the skill must not replace those members with spawned teammates. Task 2 and Task 3 never say how the model detects that session or what it must refuse. `spawnTeammate` still runs for a standing Lead. Seat prompts tell seats not to recruit; the Lead prompt tells the Lead to dispatch the baked-in seat order and does not reject `spawn_teammate`. Each institution squad has four seats. The desktop patch caps the roster at 8, so a standing Lead can still add teammates beside the 编制. Added names are permanent.

Model selection is not one policy:

- Fresh `spawn_teammate` accepts `provider` and `model` together, or neither. A partial pair throws. With no model-selection policy, any explicit selection throws `child model selection is disabled`. A route outside the session policy throws `child LLM route "<provider>/<model>" is not allowed`. Omitted selection inherits the Lead route. Fork rejects any route override with `TEAM_FORK_NO_ROUTE_OVERRIDE`.
- A route change that omits `reasoning_effort` drops the configured effort inside `requestedAgentOptions`. That is a silent effort clear on an otherwise accepted route change.
- Standing seat routes are the institution catalog fields `provider` and `model`. The catalog schema has no reasoning effort. The panel/remote updates that catalog. `spawn_teammate` does not update a seat.

`send_message` does not send `roundId`, `slotId`, or `attemptId`. Mailbox delivery then calls `isOwnedByOther(target, undefined, undefined)`, which returns true for any active execution token and waits until that token is released. A generic send to a seat that a standing round currently owns stalls the sender.

The always-on Team policy and both standing prompts require Chinese unless the user switches language on that turn. Task 2 tells the skill to use “language appropriate to the user’s task.” Those instructions will be in the same model context.

**Impact:** A standing-team user who asks for teamwork can get extra permanent teammates, a forked spawn that errors, or a seat model that does not change while the Lead reports that it did. A send during a round can block until dispatch ownership clears. The model also receives two language rules.

**Correction:** Make the skill’s first branch the standing-squad block already injected by `standingLeadPrompt`. In that session, do not call `spawn_teammate`, do not describe round or attempt tools, and dispatch the existing seat names through the shared task board. State that seat provider/model changes belong to the catalog, and that spawn overrides apply only to a fresh ad-hoc teammate, as a full provider/model pair or not at all, with the tool error repeated to the user. Note the effort-clear behavior when a new route omits effort. Tell the Lead that `send_message` to a seat owned by a standing round waits, and not to mix that wait with ad-hoc replacement. Add a Task 3 case whose session already has a standing squad and whose trace contains no new member. Point the language rule at the existing Team policy sentence.

### R3. “Review-only stays read-only” has no runtime owner

**Where:** product decision 5, English line 46. Owners: Team README line 210 and task-view contract at README line 143; policy text in `packages/experimental/tool-agent-team/src/index.ts` lines 42–44; `propose_action` at lines 401–424.

**Failure:** Members share the Lead working directory. `writeScopes` warn on overlap with in-progress tasks and do not block a claim or authorize a write. `propose_action` is Lead-only. It asks the user to approve executing a patch, command, or follow-up. It is not a worker question channel, and a worker message cannot switch the session permission mode. No task field creates a read-only worker.

**Impact:** A review assignment whose skill text says “remain read-only” still runs workers that can edit, and a Lead that routes a worker question through `propose_action` turns that question into an execution approval. Task 5 cannot honestly claim the worker was unable to write.

**Correction:** Say that the skill cannot create a read-only mode. Review-only means the Lead does not ask for edits and does not send worker output through `propose_action`. Worker questions are `send_message` to `lead`. The session’s existing permission checks still apply to every member. Keep acceptance on those instructions and on the unchanged permission path.

### R4. Several Task 3 negatives are model behavior, while decision 1 reads as a gate

**Where:** summary line 17, decision 1 line 42, Task 3 lines 97–103, Task 5 line 121, deferred work line 141. Owner: `spawn_teammate` execute at `packages/experimental/tool-agent-team/src/index.ts` lines 278–320; mailbox dedup at `packages/experimental/agent-team/src/mailbox.ts` lines 129–139.

**Failure:** `spawn_teammate` does not read the user message. The control that exists today is the Team policy sentence, which tells the model to create teammates only when the user explicitly asks. Decision 1 says an explicit teamwork request “permits” creation. Task 3 and Task 5 then accept “ordinary chat creates no workers” and “a fabricated success report fails Lead acceptance.”

These listed negatives are not tool rejections:

- A second `send_message` is a new mailbox id. Identity dedup applies only when `roundId`, `slotId`, and `attemptId` are all present, and the model tool does not expose those fields. “A durable `queued` send is not resent” is an instruction to the model.
- `wait_agent` does not spawn and does not send. The model can still spawn after `timedOut` or `noProgress`.
- Nothing in the task board checks artifacts. Machine-enforced acceptance is explicitly deferred. One recorded Lead that rejects one fixture does not establish that later models will.

A keyless snapshot replays a scripted model. A cooperative trace can pass every one of these cases while `spawn_teammate` remains unconditional.

**Impact:** The allowed claim “native workflow verified” gets used as “ordinary requests cannot create teammates” and “acceptance is enforced.” That is the equivalence the architecture paragraph says to avoid.

**Correction:** Rewrite decision 1 so the skill and the existing policy text tell the model to spawn only after an explicit request, and so `spawn_teammate` does not check that request. Split Task 3. Runtime assertions: stale revision is rejected, overlapping scopes still allow the mutation, `wait_agent` returns `noProgress` or `timedOut` and does not itself send or spawn, and a second send is a new durable message. Skill-trace assertions: one recorded composition may show a compliant model. Keep the desktop live chat as an observation of that build, and do not treat it as a gate. Leave fabricated-report rejection in the skill text, matching the deferred machine-enforced acceptance row.

### R5. Default distribution does not match the files and gates the plan names

**Where:** Task 2 create list, English lines 83–93; Task 4 lines 105–113; Task 5 “bundle verifier must pass”, line 121. Owners: `scripts/seed-desktop-bundled-skills.mjs` lines 102–107; `.agents/skills/term-glossary/package.json`; `scripts/verify-desktop-bundle.sh` lines 286–327; `scripts/build-dmg.sh` line 239; `scripts/verify-desktop-exe.mjs` lines 349–356; `apps/desktop/src-tauri/src/app.rs` lines 628–637 and 906–919; `packages/skill/skill-filesystem/README.md` lines 36–42; `packages/skill/skill/src/index.ts` lines 78 and 808.

**Failure:**

- `seedWorkspaceSkill` fails when `package.json` is missing, before it copies anything. Task 2 creates `SKILL.md` and two reference files only. The manifest entry in Task 4 then fails `node scripts/seed-desktop-bundled-skills.mjs`.
- `build-dmg.sh` runs `verify-desktop-bundle.sh`. That script checks four hardcoded skill directories. It does not walk `desktop-bundled-skills.json`. A DMG that omits `team-orchestration` still passes that gate. `verify-desktop-exe.mjs` does walk the manifest and only requires `SKILL.md`. It is not the DMG gate.
- Startup seeding treats a skill as present when `<name>/SKILL.md` exists and the content hash stamp matches. A refresh deletes `~/.dsh/skills/<name>` and recopies it, restoring only `.rate-limit-state.json`. Reference files survive only because the copy is recursive. No current gate fails on a missing `references/task-spec.md` or `references/recovery.md`.
- The filesystem provider’s load returns the `SKILL.md` body. Reference files are ordinary bundle files. Task 2’s validation says to load the skill and its references through that provider.

Discovery precedence, which the plan leaves as “current rules”: lower rank wins inside a layer. `<project>/.agents/skills` (rank 200) and `<project>/.dsh/skills` (rank 100) beat `~/.dsh/skills` (rank 400). The installer does not delete those project copies.

**Impact:** Implementation stops at the seed script, or a green DMG ships without the skill. A model that loads the skill never receives the recovery and task-spec references unless `SKILL.md` tells it to read those paths. A test that expects `skills.get()` to return the reference bodies fails against the real provider, or the author inlines them and abandons the on-demand split.

**Correction:** Add a private `package.json` with no dependencies, following `term-glossary`, and keep it in the seed fixture. Extend `verify-desktop-bundle.sh` so a missing `SKILL.md`, `references/task-spec.md`, or `references/recovery.md` fails with that path. Assert the same three paths in the temp-directory seed. In the skill, name the relative paths the model must read. Do not change `install_bundled_skills` refresh or rank precedence; lock the seed spec to the delete-and-recopy behavior and to project-root precedence.

### R6. The Chinese starting point changes the Orca contract, and decision 4 disagrees with itself

**Where:** English line 31 and Chinese line 31; English decision 4 line 45 and Chinese line 45. Pairing record `docs/plans/2026-11-02-native-team-orchestration.i18n.yaml` has hashes for both sections. The Orca guide returned by `orca skills get orchestration` says orchestration records “which attempt is authoritative,” and “A Dispatch is one authoritative Task attempt.” Settlement of a worker is reuse, explicit retention, or release after an accepted outcome. The local skill file is the discovery stub; `skills get` returns the guide.

**Failure:** The Chinese starting point renders “authoritative execution attempts” as “具有执行权限的尝试” (attempts that have execution permission), “discovery stub” as “发现入口”, “explicit completion” as “明确的完成报告”, and “resource settlement” as “资源处置”. Permission, a completion report, and disposal are different obligations from authoritative attempt identity and post-settlement reuse, retention, or release. A reader of only the Chinese plan will brief the native skill on the wrong Orca ideas even though the plan forbids copying Orca commands.

Decision 4 in English says to report an unsupported selection. The Chinese sentence says to raise an explicit error (“明确报错”). The tool throws. The two texts do not tell the skill author the same user-visible outcome.

**Impact:** The Chinese skill can talk about execution permission and resource disposal where the English skill talks about attempt authority and settlement, which is the distinction Task 1 is supposed to protect. Model-selection copy can be a chat aside in one language and a tool failure in the other.

**Correction:** Re-translate line 31 from the fetched guide’s terms: the installed skill is a stub, a Dispatch is the authoritative attempt, and settlement is reuse, retention, or release. On decision 4, say in both files that an unsupported spawn selection throws from the tool and the Lead repeats that error. Re-record the pairing hashes after the text matches.

### R7. The draft tells agents to execute it

**Where:** line 5 in both language files, against the status paragraph at line 13.

**Failure:** The status says this draft authorizes no implementation, dependency installation, model spend, commit, push, or release. The blockquote tells Claude to use `superpowers:executing-plans` and implement the plan task by task.

**Impact:** An agent that follows the banner implements the uncorrected tasks, including the runtime “fixes” in R1.

**Correction:** Remove the executing-plans banner until a later, explicit implementation approval. Leave the status paragraph as the only authority statement.

## Suggestions

1. **Separate `accepted` from `queued` in the skill.** Both mean the Lead log already holds `team/message/queued`. `queued` means this dispatch did not finish target receipt. `accepted` means this dispatch observed receipt, except the cold-target branch in R1, where the tool can return `accepted` before `team/message/delivered`. The capability table’s sentence that neither status proves comprehension is accurate and should stay.

2. **Do not document `idle` as a `list_agents` status.** `TeamMemberView['status']` is `running | inactive | provisioning | failed`. `availability()` maps every non-running agent to `inactive`. The tool output schema and interrupt schema also list `idle`, and the policy sentence says send starts an idle target. For this skill, describe the statuses `list_agents` actually returns. Leave the schema drift alone unless a separate change updates `snapshots/session/team-targets`.

3. **Name the snapshot composition.** `snapshots/session/team-targets/snapshot.yml` uses `profile: headless` and `composition: team-targets`. Headless does not enable `@deepseek-ai/dsh-experimental-agent-team-profile` (`OPTIONAL_BUNDLES` in `packages/boot/app-boot/src/profile.ts`). Desktop mounts Team service and tools through `packages/experimental/client-ui-agent-team/cordis.patch.yml`. Task 3 should name the headless profile and the composition patch, and Task 5 should remain the desktop seed path. Child logs belong in `session.<ordinal>.jsonl` per `snapshots/AGENTS.md`. Snapshot normalization replaces request system prompts with tokens, so pin on-demand skill text in the skill-tool result. `verify-skill-invocation-metadata` only checks skills that already have `agents/openai.yaml`; a green run does not prove this skill is discoverable.

4. **Point at the memory defects or drop the count.** Deferred work (English line 143) says four memory defects and then names removal, extraction, and prompt selection, with no source. The obligation not to claim that this skill repairs memory is clear. The count is not.

5. **Skip an upstream-intake edit unless a covered path actually changes.** `scripts/upstream-intake-registry.ts` has no `desktop-bundled-skills` or `team-orchestration` entry. Task 5’s “update as affected” is enough. Add a row only when that gate reports an unregistered fork edit.

## Verification limits

- Vitest was not re-run. The 79 figure is a source count of `it(`, not a fresh pass.
- No DMG was built, no app was launched, and no skill was seeded.
- No paid model call was made. Desktop restart behavior is unread in a live session.
- Orca was used only for `skills get orchestration`.
- Private evidence directories and unrelated sessions were not read.
- The pairing file shows both sides were hashed. It does not establish that the Chinese means the same thing as the English; R6 is from reading both texts against the fetched guide.
