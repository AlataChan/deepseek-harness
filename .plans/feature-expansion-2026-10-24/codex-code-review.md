# Codex expansion code review

Status: PASSED for the local Phase 0 helper implementation and source-choice evidence. Codex independently verified the settled agy repair snapshot. This does not approve a deployed IM gateway, tenant isolation, remote SSH execution, or the whole Phase 0 deployment plan.

## Finding dispositions

| Finding | Result | Verified change |
| --- | --- | --- |
| C1: delivery key collision | Resolved | Fixed-order JSON tuple encoding distinguishes delimiter-bearing IDs; collision regression passes. |
| C2: opaque identifiers | Resolved | Feishu app, tenant, chat, sender and event identifiers are branded and constructed through nonempty-string parsers. No unused database implementation is claimed. |
| C3: approval context | Resolved for metadata lookup | Native callId/result toolCallId and nested PTC subCallId are matched. Malformed JSON, cancellation, settlement, wrong names and completed turns return unavailable. Real Tools dispatch records nested dispatch-start before ApprovalService asks; the allowed tool body runs once and the rejected body zero times. Authentication and authorization remain the future adapter's responsibility. |
| C4: library description | Resolved | Manifest, module comment and README describe the implemented helper library. It provides no listener, tenant runtime, bundle patch or runnable profile. |
| C5: fixture compilation | Resolved | Fixtures use actual event fields and valid metadata. Host checks retain workspace source mappings and explicit references; Client tests compile in the actual Client aggregate. No new assertions to unknown remain. |
| C6: production owner coverage | Resolved for the specified namespace checks | Tests call real SessionCommandController, FileUploads and Client Session implementations. Sequential duplicate request IDs admit one inbox prompt; distinct IDs admit another. An independent IM ID leaves browser upload receipts and pending submissions intact; matching browser IDs retire and settle them. Host and Client tests are separate. Context cleanup precedes temporary-root removal. |
| C7: evidence accuracy | Resolved for local acceptance | Reports distinguish executed owner tests from static inspection and unrun deployment gates. Public create arguments match the code. Only idle cancellation was invoked; in-flight cancellation was source-inspected. Exact restoration of the earlier unrelated context edit remains unverified. |

## Independent verification

| Command or check | Result |
| --- | --- |
| pnpm exec vitest run packages/experimental/im-feishu/tests | 7 files, 27 tests passed on the final code edits. |
| pnpm exec tsc --project packages/experimental/im-feishu/tsconfig.check.json --pretty false | Exit 0 on the settled snapshot; source and Host tests included. |
| pnpm exec tsc --project tsconfig.client.json --noEmit --pretty false | Exit 0 on the settled snapshot; new Client test included by the aggregate's test glob. |
| pnpm exec oxlint packages/experimental/im-feishu | Exit 0. |
| pnpm run verify-translation-pairing packages/experimental/im-feishu/README.md | One named pair consistent. |
| Repository Markdown link/anchor checker | Both worker reports and both package READMEs pass. |
| Canonical plan checks and saved SHA256 comparison | Eight planning/review documents pass; all 23 pre-existing tracked modifications retain their saved hashes. |

Raw final outputs are retained at /tmp/dsh-codex-phase0-repair-final-vitest.log, /tmp/dsh-codex-settled-host-types.log, /tmp/dsh-codex-settled-client-types.log and /tmp/dsh-codex-phase0-repair-final-lint.log. File timestamps confirm the final focused suite follows the last source/test edit. The final compiler runs followed worker settlement. No repository-wide test suite, full distribution build or live provider test is claimed.

## Source decision and remaining gates

Option (c), kind=user with an independently minted SessionRequestId in rpcId, is accepted for this local helper design. Fifteen catalog restore cases compare options (a), (b) and (c) over generations 0–4: (c) reads in every generation, while (a) and (b) also read as generation 3/4 inputs. Readability alone does not require a format bump. No frozen format generation was edited. The keyless public Agent PoC exercises persistence and resume with the existing source vocabulary.

These tests establish namespace matching for the exercised owners. They do not implement durable inbox/outbox storage, concurrent delivery admission, crash reconciliation, Feishu ACK handling, authenticated IPC or tenant execution. Linux/systemd/different-UID, real Feishu and two-host SSH gates remain not run. TUI implementation is separate and was not changed. Remaining Phase 0 target gates must be satisfied before the corresponding Phase 1 runtime is accepted.

## Preservation and supervision

All work occurred in the existing /Users/apple/deepseek-harness worktree. No worktree was created. agy Task task_e9a61cfd4c86 and Dispatch ctx_df650385b5d5 settled with a valid succeeded report; Codex verified the code independently, called worker-release and acknowledged the completion delivery. Orca retained the reused external terminal without a process action; the reclaimable-worker list is empty.

The earlier unrelated .memory/active_context.md edit has no established exact preimage; restoration remains unverified. This is disclosed separately from the passing code checks. No further restoration was guessed. Historical failed review details remain in Git history. Only generated outputs inside the newly created test directory were backed up and removed during the earlier review; unrelated untracked files were not cleaned.
