# Codex source-decision review notes

Status: static consumer review only; the source fixtures and implementation are not accepted yet. This inventory is independent of agy's eventual report.

The direct-source comparison search finds 35 textual matches across 24 production files, including the tool-skill explanatory comment. It includes stable and experimental code. This is an initial inventory, not proof that aliases or helper predicates have all been found; tool-skill also uses a casted source access that needs a separate trace.

| Consumer | Direct comparison lines |
| --- | --- |
| [packages/session/session-title/src/index.ts](../../packages/session/session-title/src/index.ts) | 132, 444, 501, 503 |
| [packages/session/session-turn-outline/src/projection.ts](../../packages/session/session-turn-outline/src/projection.ts) | 110 |
| [packages/context/session-reference/src/index.ts](../../packages/context/session-reference/src/index.ts) | 159 |
| [packages/context/session-reference/src/projection.ts](../../packages/context/session-reference/src/projection.ts) | 44 |
| [packages/context/time-context/src/request-zone.ts](../../packages/context/time-context/src/request-zone.ts) | 17 |
| [packages/goal/tool-goal/src/authority.ts](../../packages/goal/tool-goal/src/authority.ts) | 83 |
| [packages/skill/tool-skill/src/index.ts](../../packages/skill/tool-skill/src/index.ts) | 171 |
| [packages/experimental/agent-team/src/roster.ts](../../packages/experimental/agent-team/src/roster.ts) | 410 |
| [packages/client/ui-chat/src/client/model/steering-history.ts](../../packages/client/ui-chat/src/client/model/steering-history.ts) | 54 |
| [packages/web/web-deepseek-api/src/index.ts](../../packages/web/web-deepseek-api/src/index.ts) | 61 |
| [packages/client/ui-chat/src/client/conversation-nodes/message.ts](../../packages/client/ui-chat/src/client/conversation-nodes/message.ts) | 76 |
| [packages/guard/repeat-tool-reminder/src/index.ts](../../packages/guard/repeat-tool-reminder/src/index.ts) | 237 |
| [packages/client/ui-chat/src/client/conversation-nodes/inbox.ts](../../packages/client/ui-chat/src/client/conversation-nodes/inbox.ts) | 94 |
| [packages/experimental/assistant-registry/src/prediction-context.ts](../../packages/experimental/assistant-registry/src/prediction-context.ts) | 72, 73, 105, 162 |
| [packages/jobs/tool-jobs/src/index.ts](../../packages/jobs/tool-jobs/src/index.ts) | 215 |
| [packages/experimental/assistant-registry/src/index.ts](../../packages/experimental/assistant-registry/src/index.ts) | 4534, 4538 |
| [packages/experimental/auto-review/src/index.ts](../../packages/experimental/auto-review/src/index.ts) | 179, 217 |
| [packages/experimental/claude-code-mods/src/index.ts](../../packages/experimental/claude-code-mods/src/index.ts) | 85 |
| [packages/api/session-controller/src/commands.ts](../../packages/api/session-controller/src/commands.ts) | 490, 605, 612 |
| [packages/api/session-controller/src/client/sessions/session.ts](../../packages/api/session-controller/src/client/sessions/session.ts) | 796, 806 |
| [packages/api/session-controller/src/list.ts](../../packages/api/session-controller/src/list.ts) | 52 |
| [packages/api/session-controller/src/index.ts](../../packages/api/session-controller/src/index.ts) | 336 |
| [packages/client/ui-trajectory/src/client/trajectory-message-definitions.ts](../../packages/client/ui-trajectory/src/client/trajectory-message-definitions.ts) | 161 |
| [packages/client/file-upload/src/index.ts](../../packages/client/file-upload/src/index.ts) | 233 |

Option (c) retains the discriminator these consumers inspect. Before acceptance, validate actual format reads plus the controller-owned rpcId uses; preserving kind alone does not prove persistence, idempotency or namespace correctness. The ownership review must include prompt dedupe, pending-submission settlement, upload retirement, time-zone handling and ordinary Session replay.

Compared with the review's initial list, the fork also has source-dependent auto-review human instruction classification, web search prompt selection, steering/inbox display, assistant predictions and team initial-prompt acceptance. Option (a) must not silently lose these behaviors.

Required PTC lookup: native tool/call.callId or nested tool/ptc-dispatch-start.subCallId in the same Agent Session and current pending request; validate the tool name and prevent settled/mismatched calls from supplying parameters. Timing must be observed through real tool dispatch and approval, not only synthetic log rows.

## Independent restore probe

Codex ran node --import tsx/esm /tmp/dsh-codex-source-probe.mts against createSessionFormatCatalogWithChildren([]), strict recovery and current validation. Each case used a complete turn/step/message sequence and a version-appropriate header. These are actual reader/migration calls on in-memory JSON rows; they do not replace a JSONL persistence or live Agent test. The script and raw results remain in /tmp/dsh-codex-source-probe.mts and /tmp/dsh-codex-source-probe-results.json.

| Input version | Choice | Full restore to current |
| --- | --- | --- |
| 0 | a | cannot safely transform unclassified message source |
| 0 | b | @deepseek-ai/dsh-session-format-v0-to-v1 refuses this format v0 Session: user/message 2 source has unexpected member "deliveryId" |
| 0 | c | accepted |
| 1 | a | cannot safely transform unclassified message source |
| 1 | b | @deepseek-ai/dsh-session-format-v1-to-v2 refuses this format v1 Session: user/message 2 source has unexpected member "deliveryId" |
| 1 | c | accepted |
| 2 | a | cannot safely transform unclassified message source |
| 2 | b | @deepseek-ai/dsh-session-format-v2-to-v3 refuses this format v2 Session: user/message 2 source has unexpected member "deliveryId" |
| 2 | c | accepted |
| 3 | a | accepted |
| 3 | b | accepted |
| 3 | c | accepted |
| 4 | a | accepted |
| 4 | b | accepted |
| 4 | c | accepted |

Choice (c) passes this probe for every input generation 0–4. Choices (a)/(b) also pass for current-reader input generations 3/4. Unknown-kind default acceptance in an individual old validator is not proof that the complete 0–2 migration chain accepts it: this probe rejects (a) as an unclassified source. Do not change frozen generations to improve the result. Human behavior and namespace review are still independent gates.
