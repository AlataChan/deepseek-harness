---
kind: upgrade-guide
description: "Terminal ownership strictly outranks detached mode: SIGHUP restores terminal raw mode and exits 129 when active terminal owners exist, even with DSH_DETACHED=1."
---

# Terminal ownership takes precedence over detached mode on SIGHUP

English | [中文](guide.zh.md)

## Change

This change introduces explicit `DSH_DETACHED=1` handling for owner-free background profiles and synchronous terminal restoration for interactive profiles. It does not describe an earlier released DSH_DETACHED behavior. Ordinary runs without this option retain their existing SIGHUP behavior.

Now terminal ownership strictly outranks detached execution:

- When an interactive terminal owner is registered (`activeCount > 0`), receiving `SIGHUP` always invokes synchronous terminal restoration (`restoreNow()`) and requests bounded shutdown with code 129 (`128 + SIGHUP`).
- `DSH_DETACHED=1` ignores `SIGHUP` only when no interactive terminal owner is active (`activeCount === 0`).

This precedence invariant accounts for Node.js engine behavior (`node::ResetSignalHandlers()` in `src/node.cc`), where Node.js resets inherited signal dispositions to `SIG_DFL` during bootstrap, requiring runtime signal coordination to preserve both detached execution and clean terminal teardown.

## Migration

1. For headless, background daemon, or automated ACP workflows running without interactive terminal controls, set `DSH_DETACHED=1` explicitly when hangup survival is required. Because these workflows register zero terminal owners (`activeCount === 0`), the launcher ignores `SIGHUP` in these runs.
2. For interactive terminal sessions (such as `dsh --profile tui`), the launcher attempts synchronous terminal restoration on SIGHUP and requests exit status 129. A lost TTY, SIGKILL or native abort cannot guarantee restoration.
