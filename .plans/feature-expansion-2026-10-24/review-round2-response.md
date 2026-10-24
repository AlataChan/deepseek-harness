# Plan review disposition — revision v3

The review's three blockers are valid against source baseline the parent of this design commit (subject: fix(ci): allow Windows installer qualification to finish). The canonical plans now specify corrections; their implementation and acceptance tests remain unrun. Status: ready for another design review, not locked and not product-ready.

## Required corrections

| Review item | Revision | Source evidence and remaining gate |
| --- | --- | --- |
| 1. Missing authenticated tenant channel | Expansion §§3–4: per-tenant filesystem Unix socket, root-owned directories, ingress-only group, 0660, systemd Accept=yes with stdio activation; different UID denied before protocol | [host-webserver](../../packages/host/webserver/src/index.ts) does not provide this authentication. Linux test must exercise actual UIDs and socket activation, not mocked ACL checks. |
| 2. Duplicate SSH provider | Expansion §6: prefer isolated ssh/subprocess-ssh/subagent-acp; evaluate command:ssh with forced command/restrict; new package requires evidence that both fail | [ACP injection/cwd checks](../../packages/subagent/subagent-acp/src/index.ts), [spawn](../../packages/subagent/subagent-acp/src/run.ts), [SSH flags/lease](../../packages/ssh/ssh/src/index.ts), [remote subprocess](../../packages/ssh/subprocess-ssh/src/index.ts), [existing isolate example](../../apps/cli/config/examples/github-review/cordis.yml). Composition has not run. |
| 3. Premature TUI promotion | TUI §7: T1 experimental scaffold, T2–T4 features, T5 experimental artifact tests, T6 reviewed promotion and stable installation | [Promotion policy](../../packages/experimental/AGENTS.md). No built-in profile or apps dependency before T6; test paths move atomically. |
| 4. Competing signal owners | TUI §§4,6: launcher alone handles SIGINT=130, SIGTERM=0 and proposed POSIX SIGHUP=129; TUI owns raw input bytes and SIGWINCH | [profile-boot](../../apps/cli/src/profile-boot.ts) currently handles INT/TERM but not HUP. Launcher-wide regression tests and synchronous terminal restoration remain T0 requirements. |
| 5. Missing approval arguments | Both plans require same-session callId lookup of logged tool/call, tool-name match and bounded redaction; missing context disables approval | [user-approval README](../../packages/interaction/user-approval/README.md). Phase 3 cards get the summary through tenant IPC; no direct cross-UID log access. |
| 6. Persistence/storage/ingress/package naming | Expansion §§3,5,8: MessageSourceMap.im, storage-domain/storage-sqlite, explicit schema versions, acknowledgements and both SDKs; im-feishu instead of gateway-* | [Webhook source](../../packages/webhook/webhook/src/types.ts), [webhook semantics](../../packages/webhook/webhook/README.md), [storage domain](../../packages/storage/storage-domain/README.md), [SQLite](../../packages/storage/storage-sqlite/README.md), [type change process](../../docs/cookbook/reviewing-persistence-type-changes.md). Current-format validation and crash-window tests are future work. |

## Additional findings incorporated

- ACP over Unix socket was evaluated, not assumed to solve delivery correlation. [ACP transport](../../packages/acp/acp/src/index.ts) uses stdio; its stream override is for tests. [ACP prompt handling](../../packages/acp/acp/src/session.ts) records ordinary user source. The proposed same-package private IM adapter supplies authenticated delivery admission and reconciliation without changing ACP automation semantics. This design choice still needs Phase 0 executable validation.
- Remote cwd is a concrete reuse constraint: subagent-acp locally checks the path and reuses it for ACP. Both SSH options must test a remote-only path; prefer a small owner correction over a new framework.
- A retains the existing 10/3 client keepalive and helper lease. B requires restricted forced-command execution and remote supervision. Both specify server-side ClientAlive checks; remote cleanup is independently measured. A needs controlled Unix socket forwarding, so B's blanket restrict policy cannot simply be copied onto A.
- IM single-operator delivery precedes two-tenant product acceptance. The first runtime still requires different-UID refusal. No channel-neutral seam until a second real consumer exists.
- Domain writes do not make Session admission atomic. Logged IM delivery IDs support reconciliation; an absent log entry during uncertain admission does not authorize replay. A receipt and unknown state preserve that distinction.
- TUI uses [ToolCallView/ToolResultView](../../packages/core/tools/src/presentation.ts), existing node-pty/@xterm/headless tooling, and a separate-process test against the real [Session writer lease](../../packages/session/session-persistence-jsonl/src/lease.ts). It does not contend with a user's running desktop or use their real profile.

## Evidence and limits

Current work inspected the named source and applicable package/documentation rules and checked the revised documents for links, task ordering and whitespace. It did not execute T0, Linux services, platform calls or two-host SSH tests. Earlier fail-loud test results in review-considerations-response.md are historical evidence only, not tests of these proposed changes.

[systemd.socket](https://www.freedesktop.org/software/systemd/man/latest/systemd.socket.html) documents filesystem socket permissions, Accept=yes and MaxConnections; [systemd.exec](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html) documents accepted sockets on stdin/stdout. [OpenSSH sshd_config](https://man.openbsd.org/sshd_config#ClientAliveInterval) documents server-side liveness detection. These primary references support the design, not a claim that the target deployment was tested.

The canonical files are now in this directory. Previous external artifacts are preserved in review-round2-backup/ and replaced with pointers; earlier review records remain historical and unchanged. Product files and unrelated working-tree changes are outside this revision.
