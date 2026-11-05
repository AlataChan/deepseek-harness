# Cursor independent B0 review

Date: 2026-11-03. Reviewer role: read-only B0 source/evidence audit for task `task_809c3924beb4`. Inputs: `docs/plans/2026-11-03-octopus-stage-b0-b1-persistent-questions-plan.md`, the design, roadmap and B2 plan, `.plans/octopus-implementation/stage-b0/{authority-matrix,review-exit-evidence}.md`, and current source at HEAD `e800c8261b` plus the working tree. Stage A in-progress files were not reviewed. No code, plan, test, manifest or evidence file was changed; this file is the only write.

## Verdict

**NOT READY FOR B1 IMPLEMENTATION. Score: 6/10.**

The design direction holds against source. Full-human authority, queue-only answers, no pre-step filtering, insertion-driven supersession, the exclusive-tool-plus-monotonic-guard approach, and the B2 dependency direction are all consistent with current code. Six Required gaps remain:

- Two B0 artifacts the plan names do not exist.
- The authority inventory misses a consumer that matters because answers are the first path that echoes **model-authored** text as `kind: 'user'`.
- Existing queue controls can remove, edit or steer a queued answer.
- The producing-step guard identity is not pinned.
- The restart/persistence harness owner is unidentified.
- The PTC-preset and busy-predicate restriction scope is undefined.

Each gap is small and closable in B0 documents without writing B1 code.

## Verified facts (source-backed)

| Claim | Evidence | Status |
| --- | --- | --- |
| Model may resume an active-but-disarmed Goal in a direct-human root turn | `packages/goal/tool-goal/src/authority.ts:80-84,100-103`; `packages/goal/goal/src/index.ts:364-381` (resume allows `active` when `activation !== 'armed'`) | Verified |
| Model resume of a truly `paused` Goal is rejected | `packages/goal/tool-goal/src/index.ts:278-285` (`GOAL_TOOL_RESUME_PAUSED`) | Verified; covered by existing tests `packages/goal/tool-goal/tests/tool-goal.spec.ts:380,400` |
| Disarm changes neither phase nor revision | `packages/goal/goal/src/index.ts:282-294`; restored goals start disarmed `:255-257` | Verified; restored-then-human-resume covered at `tool-goal.spec.ts:451-460` |
| Model may also resume a `blocked` Goal | `goal/src/index.ts:368`; tool rejects only `paused` | Verified (see S6) |
| Desktop prompt path: Remote → per-session gate → `commands.prompt` → explicit `kind: 'user'` + `rpcId` → `followup` or `steer` by mode | `packages/api/session-controller/src/index.ts:1134-1143`; `commands.ts:311-376` | Verified |
| Same-ID requests are serialized on the Remote path | `index.ts:1137` `SessionCallGate.run(..., 'wait')`; `session-gate.ts:48-76` | Verified (static) |
| Duplicate recognition checks both inbox lanes and entered `user/message` events by `rpcId`, ignoring content | `commands.ts:330,602-614` | Verified; content conflict must be detected by the decision service |
| `accepted: true` precedes durability | `commands.ts:364-374` returns after `followup`; durability is the separate `SessionStore.flush` at `packages/core/session/src/index.ts:1177-1207` | Verified |
| Inbox is durable and replayable across cold restore | `packages/core/agent-loop/src/inbox.ts:26-65,197-243` (`agent/inbox/spliced` append plus projection fold) | Verified (static) |
| Raw events survive compaction, so log dedup is not lost to compaction | `packages/compaction/compaction/README.md:142` | Verified (doc) |
| `agent/inbox/inserted` is synchronous emit after the durable splice; `claimed` is emitted per message at the step boundary | `inbox.ts:109-113,235-241`; `packages/core/agent/src/runtime-types.ts:281-299` (`@mode emit`) | Verified |
| A claimed message whose step is rejected is never entered as `user/message` | `runtime-types.ts:289-292`; entry happens only at step admission `agent-loop/src/agent.ts:419-423` | Verified; supports removing pre-step filtering |
| `tools.guard` is synchronous, monotonic, evaluated after an `allow` from `tools/pre-execute`, and agent-scoped via `agent.ctx` | `packages/core/tools/src/index.ts:723-731,1126-1142,1503-1531` | Verified |
| Exclusive call is its own scheduler group; later same-step calls are prepared only after it commits | `agent-loop/src/tool-calls.ts:85-101,164-170,199-213`; default exclusive when not concurrency-safe `tools/src/index.ts:1299-1310` | Verified; a guard armed in the question body denies same-step leftovers |
| `concludeTurn` does not close a turn while next-step input is pending or a `turn-stopping` listener steers | `agent-loop/src/agent.ts:359-364,538` | Verified |
| PTC nested calls run `scheduler.prepare` (pre-execute plus guard) and forward `concludesTurn` from nested results | `packages/core/tools/src/ptc.ts:613-623,654` | Verified (static); no existing guard×PTC test |
| In `ptc` presentation mode only `run_code` is model-direct | `tools/src/index.ts:340-348,1351-1353` | Verified |
| A `ptc` preset ships in Web and the desktop bundle | `packages/bundle/web-app/presets/ptc.patch.yml:160-163`; `packages/bundle/web-app/package.json:35,47` | Verified |
| Client slots exist | `packages/client/ui-conversation/src/client/contract/slots.ts:196`; `packages/client/ui-workspace/src/client/index.ts:269` | Verified |
| storage-domain: single-record atomic writes, no migration, whole-domain open fails on one invalid record | `packages/storage/storage-domain/README.md:73,94,147-148` | Verified |
| Web scaffold supports experimental overlays with the real Host controller and JSONL persistence | `apps/web/tests/scaffold.ts:314-323,589` | Verified |
| Authority matrix direct-condition list (40 sites / 26 files) matches current code | Re-ran search; only two extra hits, both comments (`tool-skill/src/index.ts:171`, `im-feishu/src/storage.ts:747`) | Verified, but incomplete (R1) |

## Required findings

**R1. Model-authored choice text gains human-only processing; the matrix misses `tool-skill`.**

- Source: `packages/skill/tool-skill/src/index.ts:409,418-431` checks `(message.source as { kind?: unknown }).kind !== 'user'` through a cast, which the matrix's direct-condition search missed. It activates skills on `/<name>` gestures, including `disable-model-invocation` skills that are meant to be user-only (`:171-176` comment, `:195`). `packages/context/session-reference/src/index.ts:159` likewise expands session references only in `kind: 'user'` text.
- Trigger: the model creates a question whose choice label contains ` /deploy-prod ` or a session reference. The user clicks it, and the label is admitted as the human answer text.
- Consequence: model-authored text launders a user-only skill activation or cross-session context pull under human authority. Desktop composer and IM paths never echo model text, so this risk is new to this feature.
- Fix: in B0.1, add a "model-authored content echoed as human" row. Choose an answer composition rule, for example: deliver the choice as a structured quoted answer (`Answer to question <id>: option <n> “…”`) with gesture and reference tokens neutralized, or explicitly accept the consequence with a recorded rationale.
- Tests for B1: `authority.spec.ts` cases for a skill-gesture label and a session-reference label.
- Also update the matrix to note that it covered helper or cast indirections.

**R2. Existing queue controls can cancel, rewrite or steer a queued answer.**

- Source: `commands.ts:480-497` supports `edit` (`inbox.replace`), `remove` (durable cancel, emitting `agent/inbox/discarded`), and `steer` (remove then `agent.steer`) on any pending item. `packages/client/ui-conversation/src/client/queue/QueueDock.tsx:116-121` lists `kind: 'user'` items with an `rpcId`. A queued answer submitted before the requesting turn closes is exactly such an item.
- Trigger: the user answers while the turn is still running, then removes, edits or promotes the queued item from the existing QueueDock.
- Consequences:
  - Remove: the decision stays answered or admitted while the model never receives the answer. `hasPromptRequest` then returns false, so a retry re-admits it.
  - Edit: a second `inserted` event arrives with the correlated `rpcId` and different content.
  - Steer: violates the plan's "never steer a decision answer" invariant.
- Fix: in B0.2, specify service handling for `agent/inbox/discarded` on a correlated `rpcId` (revert to open or mark the answer withdrawn), for a correlated re-insertion (edit or steer), and for `inbox.clear()`/disposal. The official QueueDock cannot change under the overlay rule, so handling must be event-driven.
- Tests for B1: `input-ordering.spec.ts` cases for remove, edit and steer of a queued answer.

**R3. Named B0 artifacts and persistence decisions are missing.**

- Source: `.plans/octopus-implementation/stage-b0/` contains only `authority-matrix.md` and `review-exit-evidence.md`. The plan requires `composition.md` (B0.1) and `persistence-and-host-tests.md` (B0.3). `review-exit-evidence.md:7,29` still says the exit review is pending.
- Not recorded anywhere:
  - The changed persisted types (likely none in `SessionEventMap`, but the tool-result `meta` payload is persisted, per `agent-loop/src/tool-calls.ts:286-289`).
  - The aggregate format and decoder plan.
  - Retention, capacity and incompatible-record policy.
  - The exported request/response field set.
- Consequence: storage-domain open validates every record and fails the whole domain on one invalid record (`storage-domain/README.md:94`). Without a decided envelope or quarantine rule, one bad record disables every pending question.
- Fix: write both artifacts, including an explicit "no SessionEventMap change; tool `meta` type is X" statement and the invalid-record policy.

**R4. The producing-step guard identity and continuation oracle are unspecified.**

- Source: `ToolGuard` is synchronous and `ToolExecution` has no step field (`tools/src/index.ts:393-398,731`). A concrete mechanism exists, but the evidence does not pin it: `tool/call` events carry `{turn, step, callId}` and are appended before `prepare` (`tool-calls.ts:167-170,262-266`). The guard can map `exec.rootCallId` to its logged `(turn, step)` and compare it with the question's own call. Alternatively, it can capture the sibling call-ID set from the producing `assistant/message`.
- Also unspecified: the observable that resets the guard (the `step/end` or `turn/end` session event, `agent.ts:356,385`), and behavior when the turn continues after `concludeTurn` (`agent.ts:359-364`).
- Consequence: B1 could implement a guard that either leaks to a later human step or misses PTC children, whose `rootCallId` equals the outer `run_code` call (`index.ts:1395`).
- Fix: record the chosen identity, the reset events, and these oracles in B0.2 evidence:
  - Same-step leftover denied.
  - Next step after non-human continuation behaves as specified.
  - Claimed non-correlated human input allows tools.
  - A PTC child with a producing-step `rootCallId` is denied.

**R5. Restart and persistence test owners are unidentified; dedup and readers are only plausible from static reading.**

- What is static only: cold-restore dedup is plausible from `inbox.ts` folding and `commands.ts:602-614`. No test exercises a persistent restart. The existing dedup tests use a warm Agent with a mocked `followup` (`packages/api/session-controller/tests/commands-upload-file.host.spec.ts:345-369`).
- Harness gap: the Web scaffold always creates a fresh `persistenceRoot` (`apps/web/tests/scaffold.ts:551-553`) and cannot relaunch over an existing root. The restart probes in B1.5 therefore need a scaffold extension.
- Unnamed owners:
  - `hasPromptRequest` is module-private (`commands.ts:602`), so the read owner for lost-response inspection is unnamed.
  - The flush owner is unnamed (`ctx.sessions.flush`, `session/src/index.ts:1190`).
  - For a cold session, a raw log reader must fold splices; scanning `agent/inbox/spliced.inserted` alone would misclassify a cancelled answer as admitted.
- Fix: B0.3 must name the read, flush and scaffold owners and specify the scaffold option (for example, reuse `persistenceRoot` and the decision storage root across launches).
- Keep the restart duplicate test as an unclosed B1 requirement.

**R6. Restriction scope is incomplete: the PTC preset and the busy-work predicate.**

- PTC preset: in `ptc`-presentation agents the question tool is reachable only through `run_code`. The planned refusal therefore fails every call in the shipped `ptc` preset, while the SDK listing still advertises the tool.
- Busy predicate: the evidence does not name its owners or the time at which it is checked. Candidates are `jobs.list(caller)` (`packages/jobs/jobs/src/index.ts:117`), `subagents.listChildren` (`packages/subagent/subagent/src/index.ts:372`), and `teams.listMembers` (`packages/experimental/agent-team/src/index.ts:228`).
- Fix: state that the tool is not registered (or is restricted through `tools.restrict`) for `ptc`-presentation scopes, and record the busy-predicate owners and the check point (inside the exclusive tool body, before save or disarm).

## Suggested findings

- **S1. Optional hook bridges can drop an admitted answer.** A `UserPromptSubmit` deny returns `reject` (`packages/hooks/hooks-claude-code/src/index.ts:225-231`; same in hooks-codex `:217`). The claimed answer is then never entered (`runtime-types.ts:289-292`). Scope the claim "accepted input always reaches the transcript" to compositions without such hooks, and have the index treat claimed-but-not-entered as `needs_reconciliation`.
- **S2. A question can be superseded immediately after it is saved.** The turn continues after `concludeTurn` when next-step context is pending or a hook steers at `agent/turn-stopping` (`agent.ts:359-364`). Insertion producers include `packages/jobs/tool-jobs/src/index.ts:307`, `packages/subagent/subagent/src/continuation-activation.ts:878`, `packages/interaction/user-approval/src/index.ts:188`, `packages/plan/plan-mode/src/index.ts:436`, and the hook bridges. Add a B1 test asserting that the default desktop composition does not supersede a fresh question without new material.
- **S3. Test same-ID, different-content rejection in the decision Remote.** Controller dedup ignores content (`commands.ts:330`), so this rejection must happen before `prompt()` is called.
- **S4. Ask-data sessions may refuse answers.** `index.ts:1140` (`assertPromptAllowed`) gates prompts in ask-data sessions. Define the answer outcome there.
- **S5. Use the full Remote, not the inner command.** Call the `sessionController.prompt` Remote method, which includes the gate and the ask-data/ask-knowledge wrappers, never `commands.prompt` directly. Pass `clientTimeZone` when available so time-context sees it (`packages/context/time-context/src/request-zone.ts:17`).
- **S6. Cover `blocked` Goals in UI copy.** The model can resume a `blocked` Goal under human authority. State-derived copy should cover `blocked`, not only `active`-disarmed versus `paused`.

## B2 architectural checks (no implementation)

| Check | Evidence | Result |
| --- | --- | --- |
| `TenantAgentSessionProvider` is the actual class | `packages/experimental/im-feishu/src/session-provider.ts:116` implements the conversation-keyed `AgentSessionProvider` (`runtime-service.ts:28-45`) | Verified |
| No reverse dependency | `im-feishu`, `desktop-im` and `im-service-bundle` `package.json` dependencies contain no `session-decisions`; no repository reference to `session-decisions` exists | Verified now; B2 should add a mechanical closure check |
| Single desktop connection | One `FeishuTransport` per runtime with the card slot `undefined` (`im-feishu/src/desktop.ts:134`; constructor `feishu-transport.ts:177-185`); the probe is refused while connected (`desktop-im/src/controller.ts:123-126`) | Verified |
| Free text keeps its own session | `conversationKey` maps to the provider's own durable mapping (`session-provider.ts:160-241`); a mismatched `sessionId` is rejected (`runtime-service.ts:125`) | Verified |
| Receipt rules | Receipt is durable before `followup` and is never replayed (`runtime-service.ts:110-138`); reconciliation is by `rpcId` (`storage.ts:770-775`); IM source shape equals desktop (`source.ts:31-39`) | Verified |
| Sole publication writer is the decision aggregate | Design and B2.1 item 7 state it; no code yet | Plan-level only |

B2 suggestions for B2.1 evidence:

- **Idle and delivery-limit refusals.** `TenantRuntimeService.admit` refuses non-idle agents (`runtime-service.ts:126`), and desktop composes `maxActiveDeliveries: 1` (`desktop.ts:109-110`). Reusing it as-is makes a card answer fail, rather than queue, when the asking session is running or when a free-text delivery is active.
- **Shared receipt storage.** A second runtime instance over the same `TenantReceiptStorage` creates two writers. Decide between a separate receipt namespace or domain and a decision-specific submit operation.
- **Handle ownership.** `TenantAgentSessionProvider.dispose()` cancels every owned handle with `{ kind: 'user' }` (`session-provider.ts:309-312`, invoked at `desktop.ts:89`). The decision adapter must never own desktop asking-session handles.
- **Reconciliation read limit.** `readSessionLog` reads from seq 0 up to `maxReconciliationEvents` and throws above it (`session-provider.ts:276-281`). Long desktop sessions will fail closed, so choose a bounded reader for asking sessions.

## Tests

Run (keyless, read-only):

```sh
pnpm exec vitest run packages/goal/tool-goal/tests/tool-goal.spec.ts packages/api/session-controller/tests/commands-upload-file.host.spec.ts packages/api/session-controller/tests/session-cold.host.spec.ts packages/core/tools/tests/scoped.spec.ts packages/core/tools/tests/ptc.spec.ts
```

Result: exit 0; 5 files passed; 218 tests passed; duration 2.62 s. An earlier invocation wrapped in `timeout` did not run because that command is absent on this macOS shell; it was not a test failure. These tests establish existing Goal phase checks, warm-session request dedup, cold-resume controls, scoped guard registration and PTC basics only.

Not run or not existing (still open; not closed by plan text):

- Persistent cold-restart duplicate-request test (inbox and entered cases).
- Guard × PTC nested-child adversarial test.
- Producing-step guard race and claim-release tests.
- Queue edit/remove/steer of a correlated answer.
- Model-authored-label authority test.
- Host-backed Web snapshots with a feature overlay and restart.
- All `session-decisions` B1 specs and all B2 specs.
- No fixture recording, build, lint, docs, installer or Feishu action was performed.

## Remaining preconditions for READY

1. Close R1–R6 in B0 documents: update the matrix, add `composition.md` and `persistence-and-host-tests.md`, and add guard and queue-action oracles to B0.2 evidence.
2. Coordinator gate review of those documents. B1 then proceeds with the listed unrun tests as explicit B1 acceptance obligations.

Code changed by this review: **no**.
