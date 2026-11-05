# Cursor B0 corrections review (X1–X6 delta)

Date: 2026-11-03. Task `task_48432107daf8`, dispatch `ctx_7ccef2fdea64`. Read-only delta review of the coordinator's X1–X6 and S1–S6 corrections against [cursor-b0-exit-review.md](cursor-b0-exit-review.md) (7/10), checked against source at HEAD `e800c8261b` plus the dirty tree.

Inputs: `.plans/octopus-implementation/stage-b0/{composition,guard-and-queue-oracles,persistence-and-host-tests,review-exit-evidence,authority-matrix}.md`, and `docs/plans/2026-11-03-octopus-{human-led-orchestration-design,stage-b0-b1-persistent-questions-plan,implementation-roadmap}.md`.

This file is the only write. No source, test, plan or evidence file changed. No commits, builds, paid calls, platform or installer actions, and no nested workers.

## Verdict

**NOT READY FOR B1 CODE. Score: 8/10** (up from 7/10).

X3, X5 and X6 are cleared. X1, X2 and X4 are substantially corrected, but each correction leaves one new Required gap (N1–N3 below). B1.1 and B1.3 code would encode these gaps directly. All three can be fixed in the B0 documents without core changes, and re-review can be scoped to N1–N3.

The cross-document story is now consistent on the main points: queue-only answers, deny-all-while-armed with no claim reset, native-only mounts, the no-resubmit retry policy, deferred cold pending reads, and crash-style restore probes. The design (lines 137, 143, 199, 270), plan B0.2/B0.3/B1.3–B1.5, roadmap line 60 and the stage-b0 files all agree.

None of the `session-decisions` tests exist. Every oracle below is an unrun B1 obligation. Existing core tests are not B1 acceptance, including the 28-test run, the earlier 218-test run, and the coordinator's 44-test `cancel.spec.ts` run.

## X1–X6 dispositions

| Finding | Disposition | Source basis |
| --- | --- | --- |
| X1 teardown discard | **Cleared, with new N2** | See X1 below |
| X2 claim race and retries | **Cleared, with new N1** | See X2 below |
| X3 guard reader and release | **Cleared** | See X3 below |
| X4 PTC visibility | **Partially cleared; new N3** | See X4 below |
| X5 busy predicates | **Cleared** (Suggested S8, S9) | See X5 below |
| X6 cold pending reader | **Cleared** (Suggested S10) | See X6 below |

### X1: cleared

- Teardown order matches the doc. Agent dispose runs in this order: `machine.cancel({ kind: 'disposed' })`, `whenIdle`, `scope.dispose`, `handle.close`, then `detachAgent`, which emits `agent/disposed` (`packages/core/agent-loop/src/index.ts:526-571`; `packages/core/agent/src/index.ts:497-525`).
- `cancel` without `keepInbox` calls `inbox.clear()` (`packages/core/agent-loop/src/agent.ts:175-178`). That emits cause-free `agent/inbox/discarded { message }` (`inbox.ts:97-101,226-238`). Classifying `withdrawn` as queue absence only is therefore correct.
- `agent/disposed` is scope-filtered. Unscoped Host listeners receive every Agent (`runtime-types.ts:263-270`), so the claim "Host-owned observers cover Agent-first teardown" holds. The claim "Agent-scoped observers cannot observe final disposal" also holds, because the agent scope is disposed before `agent/disposed`.
- The service-teardown paragraph covers both orders.
- B1.5 now uses a crash-style stop for the restored-pending probe and orderly close for the open-question case.

### X2: cleared

- Promotion is one synchronous burst: `inbox.remove` then `agent.steer` (`commands.ts:495-497`).
- Claim splices with `discardRemoved=false` and emits `agent/inbox/claimed` synchronously in `preStep` (`inbox.ts:109-114`; `agent.ts:271`).
- `user/message` is appended in `step()` after `step/start` and an awaited `prepareRequest` (`agent.ts:400-421`).
- The fact-priority table (entered over claimed over pending over lifecycle over unpaired discard) gives `admitted` for oracle 3 under a held write chain, provided resolution reads the accumulated fact set at write-execution time (Suggested S2).
- The retry table now covers every index value and forbids a fresh card re-answer. Design 143 and plan B1.4 item 1 agree.

### X3: cleared

- `ToolGuard` is synchronous and evaluated only after an `allow` decision (`packages/core/tools/src/index.ts:723-731,1136-1155,1519`). An agent-ctx guard applies to that agent's scope chain only.
- Agent scopes are created without a parent (`agent.ts:130`) and are bound only to the preset generation (`agent-preset-registry/src/index.ts:267`). A Lead's deny-all guard therefore does not reach teammates or children.
- `tool/call` is appended before `prepare` (`tool-calls.ts:166-170`). `session/event` callbacks run synchronously after the log push and must not append (`packages/core/session/src/index.ts:64-74,738-760`). That makes the event-observed position cache sound without deprecated readers.
- `step/end` is appended in `finally` before the next `preStep` claim (`agent.ts:356,271`). Removing the claim reset is correct, and oracles 1–3 can now fail.
- A nested PTC call reaches `scheduler.prepare`, so the same guard applies (`ptc.ts:608-623`).

### X4: partially cleared

- The SDK claim is corrected. The PTC wire listing collapses to `run_code` (`index.ts:1010-1026`), but `tools:sdk` renders every visible tool for non-native modes (`index.ts:896-912`).
- The decision to omit the consumer from PTC trees is recorded consistently in composition.md, review-exit-evidence.md, design 137/270 and plan B0.2 item 5.
- What remains open is the mount mechanism, and whether a "native" tree is actually native. See N3.

### X5: cleared

- Busy-predicate readers verified:
  - `jobs.list(caller)` returns caller-owned plus unowned jobs (`jobs/src/index.ts:112-117`; `view.ts:77-81`).
  - `subagents.listChildren(parentSessionId, signal)` is an async durable catalog read (`subagent/src/index.ts:363-374`; `projection-types.ts:10-19`).
  - `ctx.agents.get(id: SessionId)` exists, with `AgentStatus = 'idle' | 'running'` (`packages/core/agent/src/index.ts:566`; `runtime-types.ts:109`).
  - `teams.tryMembership` (`agent-team/src/index.ts:328-336`).
  - Lead-row exclusion via `TeamMemberView.role` (`agent-team/src/types.ts:69-72`).
- **Correction to my previous X5 text:** an ordinary root Agent does not throw `TEAM_NOT_MEMBER`. `tryMembership` returns an implicit `{ role: 'lead' }` for any root without a subagent descriptor (`agent-team/src/roster.ts:95-116`). It returns `undefined` only for non-Team subagent children and stale identities. The chosen predicate is still correct. However, the "ordinary non-Team root success" oracle exercises the `listMembers` path, which returns the lead row only; it does not exercise the `undefined` path.
- The root eligibility check `header.origin !== 'subagent'` matches the declared type `origin?: 'subagent'` (`packages/core/session/src/types.ts:117`).

### X6: cleared

- `sessionProjections.stateOf(session, key)` is public (`session-projection/src/index.ts:311-327`). The `inbox` unit is registered by agent-loop under key `'inbox'` (`agent-loop/src/index.ts:365`; `inbox.ts:28`).
- The deferral to a real `agent/created` therefore needs no private fold and no Agent activation.
- `agent/created` is serial and awaited before queued work is released (`runtime-types.ts:250-261`). A synchronous capture there sees the restored inbox before the first claim.

## New Required findings

### N1. Entered evidence must match on `source.rpcId`, not on a content digest

- persistence-and-host-tests.md (Entered side) says: "Verify candidate raw events against exact source.rpcId and content digest". The guard table's "Matching entered user/message" leaves the matching key unstated.
- The logged `user/message` is the message after `agent/pre-step`. session-reference's prepend listener replaces canonical mention text in every text block of a direct user message, and that rewritten message is the one appended (`packages/context/session-reference/src/index.ts:135-178`; `agent.ts:276-281,421`).
- A free-text answer containing a session mention therefore enters with content that differs from the submitted or edited payload. composition.md line 29 and authority oracle 3 explicitly keep that behavior supported.
- Under the current text, a delivered answer would stay `needs_reconciliation` permanently. Combined with N2, that record could never be pruned.
- **Fix:** entered evidence is an exact `source.kind === 'user'` and `source.rpcId` match. The `rpcId` is server-allocated and unique per reservation, and the spread at `index.ts:169` preserves the source. Use the payload digest only for Remote retry conflict checks against the reserved or edited queue payload.

### N2. `needs_reconciliation` has no exit, and the disposal upgrade is unbounded

- The guard doc says "late disposal/archive upgrades an unentered withdrawal to needs_reconciliation", with no time bound.
- A user who removes a queued answer and closes the app hours later gets the same upgrade, because the discard payload carries no cause (`inbox.ts:236-238`). Teardown and user removal are indistinguishable at the discard.
- persistence-and-host-tests.md never sweeps records with `needs_reconciliation`. The retry table rejects every request against such a record. Design 209 says only "requires explicit user action", but no document names that action or the state it produces.
- Ordinary orderly closes with queued answers, plus these upgraded withdrawals, accumulate permanent records toward the frozen 1,000-record cap. At the cap, question creation is refused.
- **Fix:**
  1. Define the explicit user resolution operation (for example a card "dismiss unresolved answer" Remote) and its terminal state. After that operation the record becomes a settled tombstone that is eligible for closed-record retention once its question is closed. It must never prompt.
  2. Either bound the disposal upgrade (for example, to discards whose withdrawn write had not committed when the same incarnation's `agent/disposed` arrived), or state that the misclassification is accepted because item 1 resolves it.
  3. Add store and retention oracles for both rules.

### N3. The native-tree mount has no named mechanism, and "native tree" is not a static property

- **Mechanism.** A patch keyed by row id replaces that row's whole `config` (`packages/bundle/web-app/README.md:86`; `agent-preset-registry/README.md:48`). Shipped preset rows also say Web-editor saves override `config.plugins` by id (`presets/standard.patch.yml:1-3`). Existing fork overlays only `insert` top-level rows, or insert their own preset row as `commerce-mode` does (`packages/experimental/commerce-mode/cordis.patch.yml`). A top-level row is the global agent tree that composition.md forbids. B1.1's first artifact, `cordis.patch.yml`, therefore needs a chosen mechanism:
  - a feature-owned preset row that restates the standard roster plus the consumer, or
  - a keyed override of `preset-standard`, which restates the official row and states precedence against a user-saved preset edit.
- **Effective mode.** `preset-standard` declares no `tool-presentation` row. Only `ptc.patch.yml:160-163` pins one. The Web/desktop `tools` row sets `mode: !!js process.env.DSH_TOOLS_MODE` (`web-app/cordis.patch.yml:32-38`), and `modeFor` falls back to that deployment default (`tools/src/index.ts:922-933`).
- With `DSH_TOOLS_MODE=ptc`, the "native" standard tree is therefore PTC, and `tools:sdk` would advertise both feature tools. In that mode every call is nested, so the body refusal (`exec.parent !== undefined`) makes this advertise-and-refuse, which X4 required to be either excluded or explicitly accepted. A user-edited preset can do the same.
- **Fix:**
  1. Name the mount mechanism and its precedence rule.
  2. Either pin native presentation in the mounting tree (an explicit `tool-presentation: native` row), or accept advertise-and-refuse under process-wide `ptc` with pinned refusal text and a snapshot.
  3. Add a composition oracle that boots with `DSH_TOOLS_MODE=ptc` and asserts the chosen outcome.

## Suggested

- **S1. Name the settlement facts.** A rejected or aborted `preStep` produces no `step/start` or `step/end`, only `turn/end` (`agent.ts:316-320,383-387`). The `claimed` payload carries `turn` but no step (`runtime-types.ts:299`). Name the settlement fact as `turn/end` of the claimed turn, or `step/end` of the following step, whichever arrives first. Otherwise "claimed, step unresolved" stays `submitting` until teardown. Oracle 3's rejection case would catch this.
- **S2.** State that each queued write resolves against the fact set accumulated at execution time, not the set captured at enqueue. Oracle 3 depends on that.
- **S3. Definite pre-admission `prompt()` rejection.** Examples are session not found and archive. The retry table has no row for it. State the resulting index; since the policy is "at most one prompt call per decision", it must not return to `none`.
- **S4.** Pick one rule for `withdrawn` same-ID retries. The current text says "returns withdrawn or rejects". State that insertion of a message whose `rpcId` equals the decision's reservation (initial admission, promotion re-insert, or edit replacement) never supersedes the question.
- **S5. Full-text search is off in shipped compositions.** Shipped bundles set session-query-sqlite to `openAt: never` (`web-app/cordis.patch.yml:22-30`), so `searchEvents` fails with `SESSION_QUERY_SEARCH_DISABLED` (`session-query-sqlite/README.md:67`). State that `readSession`/`readEvent` is the shipped path and that a search error maps to `needs_reconciliation`.
- **S6. Name the crash-style stop mechanism.** The scaffold boots in-process (`apps/web/tests/scaffold.ts:461-466,474`), so it cannot kill the process. One option is to copy the durable roots after `sessions.flush` while the answer is queued, then boot a second scaffold over the copy.
- **S7.** `durableRoots` must also keep `workspaceCwd`. storage-json lives under it (`scaffold.ts:594-596`), and cleanup removes it (`:464`). The restored Session's cwd would otherwise point at a deleted directory. `harnessHome` reuse already exists (`:456-457`).
- **S8.** `teams`, `subagents` and `jobs` are optional services. State the absent-service rule (`ctx.get`, treated as no such work). State that `listChildren` rejection fails closed before save or Goal disarm.
- **S9.** Children are checked one level deep. An idle child with running grandchildren or jobs does not block. Either state that supersession-on-insertion makes this acceptable, or check descendants.
- **S10.** On service start, also inspect Agents that are already registered. On enable or reload after Agents exist, `agent/created` has already fired for them.
- **S11.** `review-exit-evidence.md:14` still says "see R6 below"; that section is now X4/X5.

## S1–S6 from the previous review

| Item | Status | Where |
| --- | --- | --- |
| S1 free-text prefix | Addressed | composition.md:29; plan B1.4 item 1 |
| S2 two version codes | Addressed | persistence-and-host-tests.md:29 |
| S3 corruption blast radius | Addressed | persistence:33; plan B1.1 item 4 |
| S4 withdrawn retention | Addressed; interacts with N2 | persistence:34 |
| S5 root eligibility test | Addressed (see X5 correction) | review-exit-evidence.md:35 |
| S6 locating entered answers | Addressed, but see N1 (digest) and S5 (search disabled) | persistence:44 |

## Verification performed

- Scoped read-only reads (Read, `rg`, `sed`) of every source line cited above.
- `git log -1` confirmed HEAD `e800c8261b`.
- `git status --porcelain` showed the same 169-line state before and after this write. The report sits inside the already untracked `.plans/octopus-implementation/` directory.
- No test, build, lint or doc gate was run. No feature test exists, and existing suites do not exercise B1 behavior.

## Exact gates before READY FOR B1 CODE

1. Amend guard-and-queue-oracles.md and persistence-and-host-tests.md for N1 (rpcId-only entered match) and N2 (resolution operation, upgrade bound or accepted misclassification, retention).
2. Amend composition.md and plan B1.1 for N3: the mount mechanism and precedence, plus native pinning or accepted advertise-and-refuse with a `DSH_TOOLS_MODE=ptc` oracle.
3. Optionally fold in S1–S11.
4. Scoped re-review of the N1–N3 deltas.

After READY, B1 still owns all of the following, unrun: every session-decisions spec, persistent cold-restart duplicate tests, guard×PTC and same-step denial, queue remove/edit/promote races, label authority, the `durableRoots` and crash-stop scaffold work, Host-backed Web snapshots, and installed-DMG acceptance.
