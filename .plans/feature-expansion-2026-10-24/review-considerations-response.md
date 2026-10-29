# Review considerations: disposition and verification

The five recommendations are incorporated with the corrections below. The two authoritative plans remain in `/Users/apple/.gemini/antigravity-cli/brain/ff101cbc-ec78-47c8-a834-bf5ec98e7abd/`. Their prior contents are preserved in `review-considerations-backup/` beside this record.

| Review item | Disposition |
| --- | --- |
| Tenant process privileges | Fixed system services with explicit User/Group, administrator provisioning, and a constrained privileged launcher; ordinary systemd user services cannot switch OS users. No in-process UID switching or generic sudo access. |
| SSH half-open connections | Validated configurable defaults 15s / 3 probes / 10s connect timeout, separate ACP execution deadline, blackhole test, local settlement with remote outcome/cleanup unknown. Transport keepalive is not task-progress evidence. |
| Feishu approval scope | Phase 2 rejects protected operations without a trusted answerer. Phase 3 adds authenticated, one-shot card decisions with identity, expiry, cancellation and replay checks. HTTP signatures and authenticated WS dispatch are distinguished. |
| Fatal terminal recovery | Existing app-boot owns both fatal events and currently reports before asynchronous release. T0 must establish synchronous, idempotent terminal restoration before diagnostics through that owner, preserve nonzero exit, and test real failures. A second competing global handler is not the design. |
| CJK/emoji width | Explicit grapheme and terminal-column tests; maintained width/control libraries chosen by need. 300 lines is not a correctness threshold. Real terminal observations supplement PTY byte/mode tests. |

An additional repository-policy correction keeps prototype bundles experimental and requires promotion before stable bundles or apps/cli depend on them. This follows packages/experimental/AGENTS.md and prevents the plan from violating the release dependency rules.

Verification performed:

- `pnpm exec vitest run packages/boot/app-boot/tests/app-boot.spec.ts -t installFailLoud --maxWorkers=1`: 11 passed, 74 outside the selected scope skipped. This establishes the existing handler behavior, not the proposed TUI restoration ordering.
- `ssh -G -F /dev/null` with the proposed keepalive/connect options: effective values 15, 3, 10; strict host-key checking and batch mode enabled, connection multiplexing disabled. This was configuration expansion only; no SSH connection was made.
- Both revised artifacts: trailing whitespace, single final newline, and accidental control-byte checks passed.
- `git diff --check`: passed.

No T0 implementation or assembled TTY acceptance was performed in this revision step. No OS account changes, platform messages, external credential use, or remote Worker execution occurred.

Primary references: [systemd identity rules](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html#User/Group%20Identity), [OpenSSH keepalive](https://man.openbsd.org/ssh_config#ServerAliveCountMax), [Node fatal exception handling](https://nodejs.org/api/process.html#warning-using-uncaughtexception-correctly), [string-width](https://github.com/sindresorhus/string-width), [ansi-escapes](https://github.com/sindresorhus/ansi-escapes).
