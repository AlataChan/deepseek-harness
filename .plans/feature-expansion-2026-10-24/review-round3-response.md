# Review disposition — revision v4

The TUI design passed with two prerequisites. The expansion source choice was a valid blocker; revision v4 removes the committed IM source type. The user authorizes agy implementation in the current worktree and Codex review, with no new worktree.

## Required corrections

| Item | Decision | Acceptance before release |
| --- | --- | --- |
| Human-turn semantics | Expansion §5.1 selects direction (c): kind=user with a newly minted SessionRequestId in rpcId; delivery identity remains in the durable domain. All three options get Phase 0 fixtures and a recorded decision. | Read current/released logs, enumerate human-turn consumers, verify controller-owned prompt namespace, deduplication, browser settlement and upload retirement. Codex must accept this evidence before Phase 1 writes logs. No raw platform ID in rpcId, new source kind or frozen validator edits. |
| PTC nested approval | Both plans use tool/call.callId or tool/ptc-dispatch-start.subCallId, scoped to the request's Agent Session and tool name. | Real PTC execution records dispatch-start before approval/request. Nested allow/reject/cancel/mismatched IDs and redaction get behavior tests. |
| SIGHUP/nohup | TUI §6 scopes launcher HUP listener to terminal restore owner registration; it is absent when no terminal owner exists. | nohup headless/ACP/Web retain inherited ignore. TUI HUP=129, INT=130 and TERM=0; effect release removes only the owned listener. |
| Runtime lifetime and reboot | Expansion §3.1 deliberately retains Accept=yes: ingress restart cancels in-flight turns and reconnection waits for runtime teardown. Add root-managed tmpfiles.d for /run directory group/mode on every boot. | Restart ingress during a long tool; observe bounded drain, interrupted/unknown status and no replay; Linux reboot setup and actual different-UID refusal must pass. |

## Source observations

- [Released source validation](../../packages/session/session-format-v0-to-v1/src/payload-validation.ts) restricts kind=user to kind/rpcId/clientTimeZone; unknown non-empty kinds use the default branch. Readability does not establish human semantics or require a format bump by itself.
- [Prompt ID owner](../../packages/api/session-controller/src/types.ts) declares branded SessionRequestId and user-rpc. [Commands](../../packages/api/session-controller/src/commands.ts) use rpcId for prompt deduplication and upload retirement; the [client](../../packages/api/session-controller/src/client/sessions/session.ts) uses it for submission settlement. These consumers must be tested rather than assuming rpcId is a free delivery namespace.
- [PTC dispatch](../../packages/core/tools/src/ptc.ts) records tool/ptc-dispatch-start with subCallId/name/arguments before dispatch. The actual approval timing remains a Phase 0 test obligation.
- [Launcher](../../apps/cli/src/profile-boot.ts) currently owns SIGINT/SIGTERM. A permanent HUP listener would broaden its behavior; the proposed terminal-owner scope avoids that change for detached profiles.

## Implementation supervision

The first agy dispatch owns Phase 0 code and executable fixtures, then stops for Codex review. Follow-up dispatches may implement the locally testable expansion runtime/MVP only after the source decision passes. Platform credentials, real IM messages, OS unit installation and remote SSH connections require their specifically scoped deployment authorization; absent those, report the corresponding gates as not run. No TUI code is included in the expansion worker's ownership.

All coding occurs in /Users/apple/deepseek-harness. Preserve unrelated modifications and untracked files; do not create a worktree, clean/reset the tree, edit frozen formats, change desktop defaults, or treat a worker completion label as acceptance. Codex checks the actual diff and independently runs the focused evidence before accepting it.
