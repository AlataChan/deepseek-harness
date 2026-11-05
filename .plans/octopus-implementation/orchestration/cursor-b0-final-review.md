# Cursor B0 final review (N1–N3 delta)

Date: 2026-11-03. Task `task_25ef3744074e`, dispatch `ctx_084ddc7d9287`. Read-only delta re-review of the N1–N3 corrections in [cursor-b0-corrections-review.md](cursor-b0-corrections-review.md) (8/10, NOT READY). Checked against source at HEAD `e800c8261b`. Working tree was already dirty; this file is the only write.

Inputs: `.plans/octopus-implementation/stage-b0/{composition,guard-and-queue-oracles,persistence-and-host-tests,review-exit-evidence}.md`; plan paragraphs B1.1, B1.4, and B1.5 in `docs/plans/2026-11-03-octopus-stage-b0-b1-persistent-questions-plan.md`; design lines 137, 143, and 270 in `docs/plans/2026-11-03-octopus-human-led-orchestration-design.md`. S1–S11 were checked only for incorporation and contradiction. No broad authority re-audit.

No source, test, plan, or evidence file was edited. No commits, builds, paid calls, platform or installer actions, and no nested workers. No `session-decisions` package or feature test exists. Every oracle below is an unrun B1 obligation.

## Verdict

**READY FOR B1 CODE. Score: 9/10** (up from 8/10).

N1, N2, and N3 are cleared. The same rule is now in the stage-b0 evidence, B1.1/B1.4/B1.5, and design lines 137, 143, and 270. Nothing left would make B1 encode the wrong admission key, an unbounded disposal upgrade, or an unnamed preset mount.

Suggested items below are alignment and test-setup notes. They do not reopen N1–N3. B1 still owns every unrun feature spec, snapshot, and scaffold extension.

## N1–N3 dispositions

| Finding | Disposition | Why |
| --- | --- | --- |
| N1 entered match on digest | **Cleared** | Entered evidence is exact Session + `source.kind === 'user'` + reserved `source.rpcId`. Digest is retry-conflict data only. |
| N2 no exit from `needs_reconciliation`; unbounded disposal upgrade | **Cleared** | `dismissUnresolvedAnswer` settles `cancelled` / `dismissed` with no prompt, retract, or Agent cancel. Disposal upgrades an uncommitted withdrawal only. |
| N3 unnamed mount; "native" is not static | **Cleared** | Feature-owned `persistent-questions` preset restates standard, pins native, leaves default `standard` alone. Later user config replacement wins. User-edited PTC advertise-and-refuse is explicit. |

### N1

Current source, not proposed behavior:

- `SessionCommandController.prompt` builds `{ kind: 'user', rpcId: request.requestId }` (`packages/api/session-controller/src/commands.ts:331-334`). The reserved request ID is the logged `source.rpcId`.
- `prepareDirectMessages` returns the original message when it finds no mention. When it rewrites text, it spreads the message and replaces `content` only (`packages/context/session-reference/src/index.ts:159-169`), so `source.rpcId` survives.
- The logged `user/message` is that post-`agent/pre-step` message (`packages/core/agent-loop/src/agent.ts:419-421`). A free-text answer that contains a session mention can therefore differ in text from the submitted payload and still match on `rpcId`.

The corrected rule matches that fact. Guard-and-queue-oracles.md matches on Session, user source, and reserved `rpcId`, and says payload digests are retry-conflict data. Persistence-and-host-tests.md verifies candidate raw events on `source.rpcId` only and uses digests only for retry conflicts. Choice text still has no digest suffix (composition.md). Design line 209 tells a lost response to inspect the same request identity. No remaining entered-match step requires a content digest.

### N2

Proposed B1 behavior, consistent across the documents:

- `dismissUnresolvedAnswer(decisionId, expectedRevision)` is defined for `needs_reconciliation`, `submitting`, and `withdrawn` only. One record update sets lifecycle `cancelled`, answer index `dismissed`, closes the record, and keeps the request ID, digest, and resolution timestamp.
- It never calls `prompt`, `resume`, or Agent `cancel`. The UI must say that closing tracking does not retract a queued or accepted message. If entry wins before the dismissal write, the result is already-admitted. After dismissal, later Session evidence stays in the Session log and does not reopen tracking.
- The retry table returns tracking-closed for the saved ID and conflicts for another ID. Oracle 8 covers dismissal, retention, and no late reopen. Persistence retention may prune settled `withdrawn` and `dismissed` tombstones only after the question is closed and closed-record retention expires. Unresolved `submitting` and `needs_reconciliation` records are still never swept.
- Disposal or archive may classify an unentered discard as `needs_reconciliation` only when that fact is observed before the withdrawn write commits for that Agent incarnation. A committed withdrawn tombstone is not upgraded by a later close. Oracle 5 says a user removal followed by closing hours later does not reopen tracking. Service teardown excludes settled withdrawn and dismissed records. Design line 143 states the same bound.

Current source supports why the bound is expressed as write-commit order rather than a discard cause:

- `cancel` without `keepInbox` calls `inbox.clear()` (`packages/core/agent-loop/src/agent.ts:175-178`).
- `agent/inbox/discarded` carries `{ message }` only (`inbox.ts:236-238`). Teardown and user removal are not distinguishable on that payload.
- Disposal cancels with `{ kind: 'disposed' }`, waits until idle, disposes the scope, closes the handle, then detaches the Agent (`packages/core/agent-loop/src/index.ts:543-561`). Detach emits `agent/disposed` (`packages/core/agent/src/index.ts:496-514`).

B1.4 item 1 names the same Remote, the same terminal states, and the same prohibition on prompt, resume, cancellation, and retraction.

### N3

Current source for the mount and mode claims:

- A profile `cordis.patch.yml` is applied after every bundle layer and replaces one entry's whole config (`packages/boot/app-boot/README.md:64`). `dsh.bundle.patch` is an ordered file list concatenated in order (`packages/bundle/web-app/package.json:44-50`; app-boot README on bundle patch files). Listing the Host patch before the preset patch is a real ordering mechanism.
- Shipped registry default is `standard` (`packages/bundle/web-app/cordis.patch.yml:561-564`). `preset-standard` has no `tool-presentation` row. `presets/ptc.patch.yml:160-163` pins `@deepseek-ai/dsh-agent-tool-presentation` with `mode: ptc`. The Web tools row sets `mode` from `DSH_TOOLS_MODE` (`cordis.patch.yml:32-38`). Unset, the tools schema default is `native` (`packages/core/tools/src/index.ts:811`).
- `modeFor` uses the nearest scoped declaration, otherwise the deployment default (`index.ts:922-932`). A native `dsh-agent-tool-presentation` row calls `presentAs('native')` (`packages/core/agent-tool-presentation/src/index.ts:59-65`). That is the override an untouched feature preset uses under process-wide `DSH_TOOLS_MODE=ptc`.
- `tools:sdk` renders empty when the effective mode is native and otherwise renders every visible tool (`index.ts:902-911`). The wire listing in `ptc` mode keeps only `run_code` (`index.ts:1022-1026`). Nested SDK calls set `parent` (`packages/core/tools/src/ptc.ts:547-554`) and `scheduler.prepare` (`ptc.ts:623`). `collapses` does not deny a nested call (`index.ts:1351-1352`). Base composes `ptc-runtime` (`packages/bundle/base/cordis.patch.yml:398-399`), so a user-selected PTC presentation can mount.
- Therefore the untouched feature preset stays native and can ask. The shipped PTC preset, which the plan does not modify, has no feature consumer, so both tools stay absent. A later user replacement that keeps the consumer and makes the effective mode PTC can show both tools in the SDK; the read tool can still run as a nested call; nested question creation is a future feature refusal before save. No document claims the SDK omits the tools in that user-edited composition.

The proposed composition matches those facts. composition.md inserts row `preset-persistent-questions`, plugin `@deepseek-ai/dsh-agent-preset`, `config.id` `persistent-questions`, restates the standard roster, adds the scoped consumer and an explicit native presentation row, and does not overwrite shipped standard or PTC rows. User replacement wins; the feature must not merge the consumer or the mode back. The pinned refusal for the accepted limitation is “Persistent questions are unavailable inside PTC programs. Ask the user in ordinary chat instead.” B1 snapshots cover process PTC on the untouched preset, shipped PTC without the consumer, a saved PTC edit that advertises and refuses, and a saved edit that removes the consumer. B1.1 item 3 and design lines 137 and 270 say the same thing. B1.1 also keeps official entrypoints and the default upstream composition unchanged.

These are future tests. None exist, and none were run.

## S1–S11

Incorporated, and none is reopened.

| Item | Where the correction landed | Source check |
| --- | --- | --- |
| S1 settlement fact | Guard: claim settles at its `turn/end` or the following entered `step/end`; rejected pre-step has no `step/end` | A rejected pre-step returns before `step/start` (`agent.ts:317-320`). `turn/end` is appended in `finally` (`agent.ts:382-386`). |
| S2 fact timing | Guard: each write resolves against the fact set at execution time | Proposed rule. No source conflict. |
| S3 prompt rejection | Guard: a definite pre-admission rejection stays `needs_reconciliation` and does not return to `none` | See Suggested S3 below. The index rule itself is present. |
| S4 withdrawn retry | Retry table returns the recorded withdrawn outcome for the same ID and conflicts otherwise. Correlated insert does not supersede its own question. | Proposed rule. Consistent with the table. |
| S5 disabled search | Persistence: shipped `openAt: never`; `readSession` / `readEvent` are the cold path; a search error stays `needs_reconciliation` | `openAt: never` is the Web row (`cordis.patch.yml:27-30`). `searchEvents` fails with `SESSION_QUERY_SEARCH_DISABLED` (`packages/session-query/session-query-sqlite/README.md:67`). `readSession` is at `session-query/src/index.ts:184`; `readEvent` is at `:355`. |
| S6 crash-style stop | Persistence and B1.5: checkpoint flushed roots while the answer is queued, then relaunch over the copies. Do not kill the in-process scaffold. | `launchWebScaffold` boots in-process and deletes its temp roots on close (`apps/web/tests/scaffold.ts:461-466,474,551-553`). |
| S7 `workspaceCwd` | `durableRoots` includes `workspaceCwd`; cleanup of caller-owned roots moves to the caller; the copied relaunch reuses it | `storage-json` is pinned under `workspaceCwd` (`scaffold.ts:595-598`). Close removes that directory (`:464`). |
| S8 optional services | review-exit-evidence.md: `ctx.get`; absence means no such work; a present catalog failure refuses before save or disarm; `listChildren` is awaited | Matches the package rule that optional services use `ctx.get`. Proposed failure policy. |
| S9 direct children | Same paragraph: direct children only, stated as an accepted limit | Proposed acceptance, not a hidden transitive walk. |
| S10 live Agents | Persistence: on service start, also inspect Agents already registered | `agents.list()` returns live Agents (`packages/core/agent/src/index.ts:586-588`). `agent/created` does not fire again for them. |
| S11 stale "see R6" | review-exit-evidence.md no longer says that | The X1–X6 disposition table replaced it. |

## Suggested

No new Required finding.

- **S1 (text).** Two PTC sentences are both written as the model-facing refusal. composition.md pins “Persistent questions are unavailable inside PTC programs. Ask the user in ordinary chat instead.” Plan B0.2 required-negative outcomes still says Busy/PTC errors use “Ask the user in ordinary chat instead, or retry after owned work has settled. Do not stop or replace teammates.” Behavior agrees: refuse before save, notification, or Goal disarm. The verbatim snapshot string does not. Pick one PTC sentence before recording it. The busy sentence can keep the teammate clause.
- **S2 (table).** The priority table's first row sends every `rpcId` entry to `admitted`, and its service-stopping row sends every unentered reservation to `needs_reconciliation`. The paragraphs and oracles immediately below add the real exceptions: a committed withdrawn tombstone is not upgraded by a later close, and an explicit dismissal is not reopened by later entry. Put those two exceptions on the table rows so the priority list is the whole algorithm.
- **S3 (prompt throw).** `prompt()` calls `agent.followup(message)` and only then `binding.commit()` (`commands.ts:364-372`). A throw after `followup` is reported as `session/agent-busy` even though the message is already queued. "Definitely rejects before admission" is the right index rule only when no pending or entered fact exists for that `rpcId`. A rejection write has to go through the same fact table; the pending and entered rows already outrank a bare rejection label.
- **S4 (scaffold search).** Shipped Web leaves search off. `launchWebScaffold` forces `openAt: 'first-search'` (`scaffold.ts:590-594`) so existing e2e scenarios can search. A B1.5 probe on the unmodified scaffold does not observe `SESSION_QUERY_SEARCH_DISABLED`. Pin `openAt: never` on the shipped-path case. The persistence rule already says a disabled-search error stays `needs_reconciliation`.

Citation note, not a behavior gap: persistence-and-host-tests.md points storage-json at `scaffold.ts:594-596`. Those lines are the search override. The storage pin is `scaffold.ts:598`, and it does live under `workspaceCwd`.

## What B1 still has to run

READY means the N1–N3 contracts are specific enough to implement. It does not mean any feature test passed. Still unrun, and still B1 acceptance: every `session-decisions` spec, cold-restart duplicate admission, guard×PTC and same-step denial, queue remove/edit/promote races, label authority, `durableRoots` and checkpoint-copy restart, Host-backed Web snapshots, and installed-DMG acceptance.

## Verification performed

- Read the four stage-b0 documents, B1.1, B1.4, B1.5, and design lines 137, 143, and 270.
- Read the source lines cited above. `git log -1` confirmed HEAD `e800c8261b`.
- No test, build, lint, or doc gate was run. Feature tests cannot be run because the package does not exist.
