# Cursor B0 exit review

Date: 2026-11-03. Task `task_169a5daa0966`, dispatch `ctx_96b51924aeb8`. This is a read-only review of the B0 evidence delivered by task `task_12c9ca8fbc6e`, checked against the original findings in [cursor-b0-review.md](cursor-b0-review.md) and current source at HEAD `e800c8261b` plus the working tree. Inputs:

- `.plans/octopus-implementation/stage-b0/{authority-matrix,composition,guard-and-queue-oracles,persistence-and-host-tests,review-exit-evidence}.md`
- [opencode-b0-evidence-report.md](opencode-b0-evidence-report.md)
- The design, B0/B1 and B2 plan sections those files cite

This file is the only write. No product, plan, test or evidence file changed. No commits, builds, paid recordings, platform calls, installer runs or nested workers.

## Verdict

**NOT READY FOR B1 CODE. Score: 7/10** (up from 6/10).

The evidence is now concrete and mostly accurate. R1 and R3 are cleared, and the B2 ownership pins match source. Every remaining gap is statically feasible without core changes, so all are closable in B0 documents. Several dispositions still rest on source claims that are false, or that contradict each other or the B1 plan. B1 code written from them would encode a wrong queue-lifecycle classification, a false PTC assumption, and a busy predicate that throws in the common case.

None of the session-decisions tests exist. All B1 oracles below are unrun obligations. The older 218-test run and the 28-test run in `review-exit-evidence.md` show existing behavior only; they are not feature acceptance.

## Original findings: disposition

| Finding | Status | Basis |
| --- | --- | --- |
| R1 model-authored text as human | **Cleared** | See R1 below |
| R2 queue controls | **Reopened (narrow)** | New X1, X2 |
| R3 artifacts and persistence | **Cleared**, with Suggested clarifications S2 and S3 | See R3 below |
| R4 guard identity and reset | **Reopened (narrow)** | New X3 |
| R5 read, flush and restart owners | **Partially open** | New X6; X1 also breaks one planned B1.5 probe |
| R6 PTC and busy scope | **Reopened** | New X4, X5 |

### R1: cleared

- `SKILL_GESTURE` is `/(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g` (`packages/skill/tool-skill/src/index.ts:409`). `invokedSkillNames` filters through the cast at `:421` and scans every text block at `:422-427`.
- A session mention is `@[label](dsh-session:…)` (`packages/context/session-reference/src/uri.ts:45-50`).
- A `crypto.randomUUID()` string (`[0-9a-f-]`) plus an integer ordinal cannot match either grammar. The composed text `Answer to question <uuid>: option <n>` therefore contains no model-authored token. The doc correctly rejects quoting, since both scanners read every text block.
- The `'user-rpc'` source is `{ kind: 'user'; rpcId; clientTimeZone? }` (`packages/api/session-controller/src/types.ts:806-809`). Reusing it adds no source member.
- Compaction keeps raw events logged but shadows them from derived messages (`packages/compaction/compaction/README.md:140-142`). Recovery through an ordinary logged `read_persistent_question` tool result needs no injection seam or Session type change.
- Remaining issue: free-text answers carry no correlation prefix (Suggested S1).

### R3: cleared

- storage-domain validates every record at open, and one invalid record fails the whole call with `invalid-record` (`packages/storage/storage-domain/README.md:73,94`).
- A spec/stored version difference rejects with backend `version-mismatch` (`:148`).
- The doc's fail-loud policy and its no-quarantine stance match.
- `tool/result` persists `result.meta` verbatim (`packages/core/agent-loop/src/tool-calls.ts:283-289`), and the declared type is `meta?: JsonValue` (`packages/core/tools/src/index.ts:313`). A new presenter value under that field changes no declared Session member, so the no-acknowledgement statement holds.

## New and reopened Required findings

### X1. Graceful agent disposal is a durable discard; the B0 table and the B1 plan contradict each other

Source:

- Agent teardown calls `machine.cancel({ kind: 'disposed' })` without `keepInbox` (`packages/core/agent-loop/src/index.ts:537-546`).
- `ReactLoopAgent.cancel` then runs `this.inbox.clear()` (`packages/core/agent-loop/src/agent.ts:175-178`). That appends a `canceled` splice and emits `agent/inbox/discarded` for every pending message (`packages/core/agent-loop/src/inbox.ts:97-101,226-238`).
- The workspace archive stop also clears the inbox (`packages/core/agent/src/archive-admission.ts:17-21,36`).
- The discarded payload is `{ message }` only, with no cause.

What the documents say:

- `guard-and-queue-oracles.md` maps every correlated discard without re-insertion, including "`inbox.clear()` or cancel without `keepInbox`", to terminal `withdrawn`.
- A separate "Agent disposal" row maps the same teardown to `needs_reconciliation`. Disposal emits the discards first, so that row is unreachable as written.
- B1.5 item 4 requires "ordinary shutdown is not user cancellation".
- B1.5 item 5 plans a cold-restore duplicate test for "a restored inbox answer" after orderly close. After orderly close the inbox is empty by construction, so the test can only exist after a crash-style stop.
- Teardown order is also unpinned. If the decision service stops before agents dispose, it never sees the discards, and the index stays `submitting`.

Fix in B0.2 and B0.3:

1. Classify a correlated discard during agent teardown separately from a user removal. A usable detector is the write-chain re-check that the Agent is no longer `ctx.agents.get(sessionId)`, or an observed `agent/disposed`. Choose the resulting state (for example `needs_reconciliation` with the question still `open`).
2. State the service-teardown ordering assumption.
3. Rewrite the B1.5 restored-inbox duplicate probe to use a crash-style stop, meaning a relaunch without graceful agent disposal. Keep the orderly-close probe for "question still open, no automatic turn".

### X2. The withdrawal re-read can mark a claimed answer `withdrawn`; retry rules for `needs_reconciliation` are missing

Source:

- Promotion is synchronous: `updateQueue` steer calls `inbox.remove` and then `agent.steer` with no await between them (`packages/api/session-controller/src/commands.ts:495-497`).
- The service resolves the discard later on its serialized storage write chain, by re-reading the pending projection.
- The steered message sits in `next-step` and is claimed at the next step boundary (`agent.ts:271`).
- If the write chain is still busy with an earlier durable write when the running step ends, the claim happens first. The re-read then finds the message absent and persists terminal `withdrawn`, while the same `rpcId` is entered as `user/message`.

Retry rule gap:

- The answer Remote's barrier is specified only for `withdrawn`, `cancelled` and `superseded`.
- For an index in `needs_reconciliation` whose message is absent from both lanes, `hasPromptRequest` returns false (`commands.ts:602-614`). A browser retry with the same request ID would therefore re-admit it, unless the Remote rejects every non-`none` index state except an exact recorded outcome.

Fix:

1. Resolve the discard against observed `agent/inbox/claimed` and entered `user/message` evidence for the `rpcId`, not the pending projection alone. Entered evidence must win over `withdrawn`.
2. Specify Remote behavior for every index value. In particular, under `needs_reconciliation` and `withdrawn` the same request ID rejects, and only a fresh user re-answer with a new request ID is allowed (state whether one is).
3. Add a B1 race oracle: promote, hold the write chain, claim, then release.

### X3. The guard's producing-position reader is unnamed or prohibited; the release reasoning is incoherent

Reader:

- The doc says the service "can read the `(turn, step)` for `exec.callId`" from the log inside the tool body and the synchronous guard.
- The only synchronous log readers, `Session.eventAt` and `Session.snapshotEvents`, are `@deprecated … new calls are prohibited` (`packages/core/session/src/index.ts:626-653`).
- A compliant mechanism exists. A scoped `session/event` listener can record `step/start` / `tool/call` positions, which is the pattern `agent-loop` itself uses for `ToolCallRecovery` (`agent.ts:331-334`).
- Alternatively, deny every execution in the agent scope while the guard is armed. The arm-to-producing-`step/end` window contains only producing-step work: an exclusive group runs alone, and later siblings and their PTC children run inside that step.

Release reasoning:

- `step/end` for the producing step is appended in the step's `finally` (`agent.ts:356`). The next claim happens only in the following `preStep` (`agent.ts:271`).
- A claimed human message therefore can never arrive while the guard is still armed. The "claimed-release path for the window where the turn continues after `concludeTurn`" does not exist.
- The paragraph "Why the correlated answer is different" (`guard-and-queue-oracles.md:30`) is garbled.
- R4 oracle 4 and R2 oracle 3 ("producing-step tools remain denied until the producing step settles" after a promoted answer) pass vacuously.

Fix:

1. Name the reader, or adopt deny-all-while-armed.
2. Drop or re-justify the claim-release reset.
3. Replace the vacuous oracles with ones that can fail. Examples: a sibling after the question is denied, and a next-step tool after a non-human continuation runs.

### X4. The PTC disposition rests on a false claim: the SDK section still advertises the tool

Source:

- In `ptc` scopes the wire listing collapses to `run_code` (`packages/core/tools/src/index.ts:1010-1026`).
- The generated SDK prompt section still renders every visible tool except `run_code` (`sdkSection` `:896-912`; `sdkSchemas` `:1264-1278`).
- `PTC_ONLY_INSTRUCTION` tells the model to "Reach every tool the SDK declares below from inside the program" (`:59`).
- Both `request_persistent_question` and `read_persistent_question` would therefore be advertised in the shipped `ptc` preset. The question tool would always refuse with `DECISION_PTC_UNSUPPORTED`.
- `review-exit-evidence.md` states "the SDK listing under ptc already collapses, which is what closes the Cursor … concern", which is incorrect.
- `composition.md` says scope admission "keys off composition config", while `review-exit-evidence.md` says the feature "cannot proactively skip registration for ptc scopes". The two documents contradict each other.
- The shipped `ptc` preset selects presentation through a plugin row inside its own preset tree (`packages/bundle/web-app/presets/ptc.patch.yml:160-163`), so composition-level exclusion is available.

Fix: pick one of the two options and record it.

- Exclude by composition: the feature tools are not enabled in the `ptc` preset tree, plus a snapshot asserting that the `tools:sdk` section omits them.
- Explicitly accept advertise-and-refuse, with pinned model-visible refusal text and a snapshot.

Note that the body-level `exec.parent !== undefined` refusal stays correct for `both` mode.

### X5. Busy predicates throw in the common case or use durable state as liveness

- `teams.listMembers(agent)` calls `roster.membership(agent)`. That throws `TeamError('TEAM_NOT_MEMBER')` for any agent outside an active Team (`packages/experimental/agent-team/src/roster.ts:80-85`; `src/index.ts:228-230`). An ordinary root session, the common case, would fail the question tool if the predicate is implemented as written. Specify "not a member ⇒ no team work".
- `SubagentTimingProjection.active` is the durable `subagentTiming` projection on the child Session (`packages/subagent/subagent/src/projection.ts:69`; `projection-types.ts:22-30`). Two problems:
  - It can be read only through a live child `Session` via `sessionProjections`, and the doc names no reader.
  - A crashed, never-reopened child keeps an open turn in its log, so the parent would be refused permanently. The doc itself says catalog rows are not a liveness claim.
- Fix: use live state, for example `ctx.agents.get(child.id)?.status === 'running'` over `subagents.listChildren` rows. Name every reader. Add oracles for a non-team root session and a crashed child.
- Verified correct: `jobs.list(caller)` (`packages/jobs/jobs/src/index.ts:117`) with `JobStatus` `running | stopping` (`view.ts:19`), and `TeamMemberView.status` `running | provisioning` (`agent-team/src/types.ts:73`).

### X6. No public cold-session reader for the pending side of reconciliation

- `sessionProjections.snapshot(session, ['inbox'])` and `stateOf` take a live `Session` (`packages/session/session-projection/src/index.ts:313-327`).
- `inboxProjectionDefinition` is not a public export. `@deepseek-ai/dsh-agent-loop` exports only `.`, and `src/index.ts:35` imports the definition without re-exporting it.
- "Startup reconciliation" of `submitting` records in cold sessions therefore has no named pending-side reader. The entered side through `sessionQuery.readSession`/`readEvent` (`packages/session-query/session-query/src/index.ts:184,355`) works cold. Raw `agent/inbox/spliced` from `readSession` would need a fold, which is exactly the misclassification risk raised in the original R5.
- Fix: choose one option.
  - Defer pending-side reconciliation until the Session is live (`agent/created` or controller restore), then read the projection.
  - Name a public fold owner.

  Combine with X1: after orderly close the pending side is empty, so this matters only after a crash-style stop.

## Suggested findings

- **S1. Free-text answers have no correlation.** `composition.md` says the model correlates "by its composed identity", but free text passes through unchanged. Prefix it with the server-composed line `Answer to question <uuid>: ` followed by the user's text. This keeps user gestures intact, because `SKILL_GESTURE` needs only a whitespace boundary, and lets the model correlate the answer after compaction.
- **S2. Name both version codes.** The domain `defineDomain({ version: 1 })` mismatch is backend `version-mismatch`. A per-record `formatVersion` literal mismatch is `invalid-record`. The doc conflates them as "the domain's declared version". Either drop the redundant per-record field or state both codes.
- **S3. State the blast radius of a corrupt record.** "Fails composition open" is ambiguous. Specify that only the session-decisions service and its tools/Remotes become unavailable while ordinary chat and the rest of the desktop Host boot, and add a B1 test for it.
- **S4. Fix the `withdrawn` retention wording.** "`withdrawn` within its retention window" is listed as unresolved evidence that is never pruned. State one rule.
- **S5. Name the root-session eligibility test.** For example `header.origin !== 'subagent'` (as used at `commands.ts:571`), plus a no-Team-child check.
- **S6. Locating entered answers.** `searchEvents` is full-text over content with metadata filters (`packages/session-query/session-query/src/types.ts:265-276`), and `rpcId` is not text. Composed choice answers can be found by their UUID text. Free text needs S1 or a `readSession` scan. The `needs_reconciliation` fallback keeps this safe, so it is not Required.

## B2 dependency, receipt and session ownership

| Check | Evidence | Result |
| --- | --- | --- |
| No reverse dependency | No `package.json` under `packages/` or `apps/` references `session-decisions`; the package does not exist yet | Verified (static); closure test remains B2 |
| Non-idle and delivery-limit refusal | `runtime-service.ts:118-127` (limit, then `agent.status !== 'idle'` throws); `desktop.ts:109-110` `maxActiveDeliveries: 1` | Anchors match B2.1 item 8 |
| Receipt durable before `followup`, IM source equals desktop | `runtime-service.ts:110-138`, `createImPromptSource` | Verified |
| Handle ownership | `TenantAgentSessionProvider.dispose()` calls `cancel({ kind: 'user' })` without `keepInbox` (`session-provider.ts:309-312`), which durably discards owned inboxes (same mechanism as X1) | The "never own asking-session handles" pin is correct and necessary |
| Bounded reader | `readSessionLog` reads `maxReconciliationEvents + 1` and throws above it (`session-provider.ts:276-281`) | Verified |
| Single publication writer | B2 plan items 6-7 | Plan-level only |

B2 item 8 still lists alternatives: refusal versus a decision-specific submit operation, and receipt namespace versus submit path. That is acceptable for B1, but B2.1 exit must pick one of each.

## Checks performed

- Scoped read-only source reads (Read/Grep/`sed`/`rg`) of every API and line cited above.
- `git log -1` confirms HEAD is `e800c8261b`.
- No test, build, lint or doc gate was run. No new feature test exists to run, and existing suites do not exercise B1 behavior.

## Exact remaining gates before READY FOR B1 CODE

1. Amend `guard-and-queue-oracles.md` for X1, X2 and X3: disposal and archive discard classification, teardown ordering, claim-aware withdrawal resolution, a complete per-index-state Remote retry table, the named guard reader or deny-all-while-armed, removal of the incoherent release reasoning, and non-vacuous oracles.
2. Amend `review-exit-evidence.md` and `composition.md` for X4 and X5: correct the PTC SDK claim, choose composition exclusion or accepted refusal, and record the busy-predicate readers including the not-a-member case and the live-child test.
3. Amend `persistence-and-host-tests.md` for X6 and X1: name the cold pending-side owner, and switch the restored-inbox duplicate probe to a crash-style relaunch. Update the B1.5 plan text to match.
4. Optionally fold in S1-S6.
5. Get coordinator review of those edits. Re-review can be scoped to the X1-X6 deltas.

After READY, B1 still owns, unrun:

- Every `session-decisions` spec named in B0.
- The persistent cold-restart duplicate-request tests.
- Guard×PTC and same-step leftover denial.
- Queue remove, edit, promote and race cases.
- Model-authored-label authority.
- The `durableRoots` scaffold extension and Host-backed Web snapshots.
- Installed-DMG acceptance.

Code changed by this review: **no**.
