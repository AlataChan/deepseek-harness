# Codex expansion code review

Status: NOT PASSED. Both agy coding Dispatches have settled; Codex reviewed the repaired snapshot independently. The Phase 0 draft remains uncommitted and the source-decision gate stays closed. No Phase 1 runtime is accepted.

## Required findings

| ID | Priority | Finding | Required evidence |
| --- | --- | --- | --- |
| C1 | P1 | [source.ts](../../packages/experimental/im-feishu/src/source.ts) colon-joins unconstrained delivery fields. Distinct tuples can generate the same domain key and merge unrelated deliveries. Codex reproduced the collision by calling the helper with appId=a:b/tenantId=c versus appId=a/tenantId=b:c. | Injective fixed-tuple encoding plus a collision regression. Boundaries must validate real external IDs; no implicit delimiter assumption. |
| C2 | P2 | [types.ts](../../packages/experimental/im-feishu/src/types.ts) exposes opaque cross-boundary tenant/chat/sender/event identifiers as unbranded strings. | Brand owned opaque IDs and construct them at actual config/wire parsers; keep protocol constants ordinary literals. |
| C3 | P1 | The initial [approval helper](../../packages/experimental/im-feishu/src/approval-context.ts) matched the wrong native field, used a null parse-failure fallback, and ignored cancellation and settlement within the same turn. | Match tool/call.data.callId, tool/result.data.message.toolCallId and PTC subCallId. Import the PTC event type augmentation explicitly. Return unavailable on malformed/stale/cancelled context; adapter owns request/Session authorization. Verify actual dispatch-order and native/nested success, rejection, cancellation and settlement. |
| C4 | P2 | [README](../../packages/experimental/im-feishu/README.md) calls the draft a package-bundle and claims a functioning ingress/runtime, but the current package has no dsh.bundle.patch and only exports helper functions. The initial three-level .plans links were correct; Codex withdraws its earlier path-depth criticism. | Classify the actual library/plugin, describe only implemented capabilities and verified installation behavior, validate links and maintain the bilingual pair. |
| C5 | P2 | [Source fixtures](../../packages/experimental/im-feishu/tests/fixtures.spec.ts) add forbidden as-unknown assertions and call a nonexistent validatePayloadsV0 export. The native v4 artifacts also omit user/message surfaceOp metadata. | Use actual public reader APIs with valid fixtures and no new unknown casts. Codex independently ran the current draft: 1 passed, 7 failed; most failures were malformed fixture metadata, not intended source validation. This does not satisfy the decision gate. |
| C6 | P1 | [Human behavior tests](../../packages/experimental/im-feishu/tests/human-behavior.spec.ts) reimplement skill scanning and repeat-tool/jobs resets inside the tests instead of mounting the production plugins. Passing these copies would not detect regressions in those consumers. | Exercise the actual owner plugins/services and emitted effects with the chosen source, or explicitly mark a consumer unverified. Do not report copied predicates or test-local Sets as product behavior evidence. |
| C7 | P1 | [Source decision record](decision-source.md) claims 100% human-behavior preservation, tested production namespace isolation and durable ingress/database deduplication. Its cited tests copy consumer logic and the ingress/database path does not exist. It also calls option (c) the sole legitimate design even though the current reader accepts option (b). | Report only actual reader/service observations; mark copied or unrun behavior and future durability as unverified. Select (c) for concrete ownership/compatibility reasons without claiming (b) is inherently invalid or needs a bump. Use repository-relative links and correct the observed source inventory. |

## Scope repair

The worker changed .memory/active_context.md and replaced a coordinator-owned temporary inventory outside its assigned code/report scope. Codex requested restoration of only the worker's own context-file edits and prohibited further such writes. Independent saved hashes still show all 23 pre-existing tracked modifications intact. Exact restoration of the unrelated untracked context file remains to be verified; do not claim it without evidence.

## Review gates

Codex reproduced the stale PTC result using a real Session and matching start/settlement events. The initial native malformed-argument probe used an id-shaped tool/call payload; the actual current event uses callId, so that probe is not valid producer-derived evidence. Static review additionally found the initial helper matched the wrong native field. Native success/malformed/settled cases must use actual current event fields and real dispatch tests; these replace the initial native probe before acceptance.

- Source fixtures: actual released/current restore calls, preserving kind=user semantics and legitimate prompt-ID ownership.
- Production helper behavior: private API matches its lifetime/ownership promises; no current approval from malformed, stale or cancelled context.
- Compilation, owner tests, relevant lint/package/docs checks, and no added default-product dependencies.
- No frozen format changes, desktop product edits, worktree creation, credentials or live platform/SSH calls.
- Worker results are accepted only after independent diff inspection and focused reproduction; Linux and real-tenant gates remain not run.

## Final disposition of the repaired snapshot

| Item | Disposition | Evidence and remaining work |
| --- | --- | --- |
| C1 | Resolved for helper | Fixed-order JSON tuple and collision regression pass. No durable delivery store exists yet. |
| C2 | Resolved for helper | Five branded Feishu IDs and nonempty-string parsers replace bare ID fields; unused database type removed. Actual ingress wire parsing remains future work. |
| C3 | Resolved for helper behavior | Native callId/result toolCallId and PTC subCallId lookups, malformed arguments, prior turn, cancellation and settlement tests pass. Real Tools dispatch records nested dispatch-start before ApprovalService asks; allowed body executes once and rejected body zero times. This does not establish tenant authentication or live card approval. |
| C4 | Partly resolved | README correctly describes a library. package.json description and index module comment still claim ingress/runtime adapters; align them before acceptance. |
| C5 | Open, P2 | Vitest passes, but the test-inclusive tsconfig.check.json exits nonzero: seven diagnostics originate in the new test files. tool/result needs surfaceOp; optional query properties include explicit undefined; hypothetical im source lacks type augmentation; lastPromptAt starts undefined instead of null. The same command also reports vendor diagnostics; fix own errors and separately establish the appropriate baseline/compiler setup without weakening checks or editing vendor. |
| C6 | Open, P1 | Copied consumer predicates were removed; six tests now call three real production owners. Required controller deduplication, browser submission settlement and upload-retirement integration tests are absent. These cannot be deferred past the Phase 0 source gate. |
| C7 | Open, P1 | Reports are narrower than the initial draft but still claim all C1–C7 resolved and Phase 0 complete. The source-only compiler excludes tests. The report gives an incorrect create({ prompt, model, session }) signature; the test actually uses create({ sessionId, meta, agentOptions }). Cancellation is tested while idle, not during in-flight work. UUID independence reduces accidental collision risk; it is not a guarantee. |

Independent commands on this snapshot: pnpm exec vitest run packages/experimental/im-feishu/tests (24 passed across five files); pnpm exec tsc --project packages/experimental/im-feishu/tsconfig.json --noEmit --pretty false (exit 0, source only); pnpm exec tsc --project packages/experimental/im-feishu/tsconfig.check.json --pretty false (nonzero exit; latest run 109 diagnostics, seven in the new package); pnpm exec oxlint packages/experimental/im-feishu (exit 0); text search found no as-unknown assertions in the new source/tests. Exact compiler and Vitest outputs are retained under /tmp/dsh-codex-phase0-final-test-typecheck.log and /tmp/dsh-codex-phase0-vitest.log.

The independent plan/link/wrapping/reference/newline check passed for four canonical documents and verified the 23 saved pre-existing tracked-file hashes unchanged. Exact restoration of the worker's unrelated .memory/active_context.md edit remains unverified. No broad cleanup was attempted; only ten generated JS/map files inside the newly created package tests directory were backed up to /tmp/dsh-im-feishu-generated-tests.tar.gz and removed.

The source-format candidate (c) is supported by the 15-case restore matrix and the keyless Agent persistence/resume PoC, but the namespace gate is incomplete. Linux/systemd/different-UID, live Feishu, real SSH and TUI implementation gates were not run. Do not promote this draft or start Phase 1 from the worker completion label.
