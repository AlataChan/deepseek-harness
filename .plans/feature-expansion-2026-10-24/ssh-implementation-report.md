# SSH ACP qualification report

Task `task_03660008d278`, Dispatch `ctx_8820d998a99b`, Run `run_defe54996fc5`. AGY implemented the ACP configuration/Loader work and reviewed Codex's subsequent failure-test, example and workflow repairs. All work used the existing checkout. This report records local acceptance, not production or physical two-host acceptance.

## Composition and implementation

Path A is retained as a functional experimental composition. It composes `subagent-acp` with the existing `subprocess-ssh` and `ssh` services in a Cordis group isolating only `subprocess` and `ssh`. The root `subagents` registry remains shared, and root shell execution remains local. No new remote-provider package is needed. Final plan comparison showed that Path A requires local TCP forwarding on the tested OpenSSH and cannot satisfy the strict no-arbitrary-TCP requirement. Strict deployments therefore select Path B, implemented and qualified below.

The ACP provider adds explicit `validateCwd: false` for remote paths absent locally and `sessionCwd` for a session workspace distinct from spawn cwd. Default local directory validation remains enabled. Relative remote paths and empty session directories are rejected. Caller AbortSignals own initialization/prompt deadlines; SSH keepalives and helper leases detect transport/heartbeat loss, not an application that is hung over a live transport.

The [profile example](../../packages/subagent/subagent-acp/examples/remote-ssh-acp.patch.yml) requires administrator-provided real installed helper/CLI paths, helper digest, workspace and private HOME/DSH_HOME/TMPDIR. It launches the actual `dsh --profile acp` entry. The [server sample](../../packages/subagent/subagent-acp/examples/sshd_config.worker) provides server keepalives and Unix forwarding. On the tested OpenSSH 9.2 it also requires local TCP forwarding permission; this sample does not provide network confinement. Invalid/restrictive key recommendations and fictitious standalone server/helper paths were removed.

## Strict forced-command Path B

The [strict coordinator patch](../../packages/subagent/subagent-acp/examples/strict-ssh-acp.patch.yml) reuses `subagent-acp` with local `command: ssh`. The dedicated remote account has the [no-forwarding server policy](../../packages/subagent/subagent-acp/examples/sshd_config.acp-forced), a restricted public key and a fixed root-owned [supervisor](../../packages/subagent/subagent-acp/examples/dsh-acp-forced-command.sh). The original command must be empty or the literal `dsh-acp`; executable, profile, paths, environment and deadlines come from a protected administrator configuration.

The supervisor validates positive bounded deadlines, rejects integer overflow and writable configuration, and starts the actual installed ACP profile in an owned systemd user service with `RuntimeMaxSec`, `TimeoutStopSec` and control-group cleanup. It preserves SSH stdin through a saved descriptor and an owned FIFO relay. EOF or service exit triggers bounded unit shutdown and reaping of the exact relay/client processes. A finite maximum session duration is the fallback for a stopped/lost transport; it is not a renewable application lease. The cleanup budget must exceed the unit stop deadline.

The deployment requires Bash 5.1+, systemd/PAM and a user D-Bus manager for the dedicated account, with administrator-provisioned linger, private workspace/state/tmp and protected supervisor/configuration files. The qualification image was updated to include `libpam-systemd` and `dbus-user-session`; no host packages, users or services were changed. A small independent control reproduced background `<&0` losing input and verified the saved-descriptor solution; the live test then exposed and rejected remote cleanup continuing after local disposal until the FIFO relay was added.

## Independently reproduced evidence

| Selection | Result | Log |
| --- | --- | --- |
| ACP unit and scoped composition | 82 passed | /tmp/dsh-codex-ssh-owner-unit-final.log |
| Actual Cordis Loader, private DSH_HOME | 4 passed | /tmp/dsh-codex-ssh-loader-isolated-final.log |
| Combined installed SSH lane, including strict fallback | Built PONG, 9 Path A cases with zero skips, 5 strict Path B groups, exit 0 | /tmp/dsh-codex-strict-ssh-final.log |
| Composition after strict completion-handler repair | 4 passed | /tmp/dsh-codex-ssh-rig-final.log |
| Scoped source/test compilation and lint | Exit 0 | /tmp/dsh-codex-ssh-tests-types-final.log; /tmp/dsh-codex-ssh-source-lint-final.log; /tmp/dsh-codex-ssh-tests-lint-final.log |

The five strict Path B groups verify actual installed ACP PONG, normal disposal of an uncooperative descendant, writable/oversized-deadline configuration refusal, arbitrary TCP channel and arbitrary original-command refusal, and server-deadline process/descendant removal while the exact owned SSH child is stopped. Process observations use Docker independently of the SSH link. The same updated-image IM matrix passes all ten groups in /tmp/dsh-codex-linux-strict-image-final.log.

The nine Path A controls cover effective sshd settings for the actual worker identity, real wrong-host-key denial, ACP exchange, active-prompt cancellation, exact owned-child disconnect, remote lease expiry under a stopped transport, caller-deadline cancellation of stalled initialization, descendant cleanup and installed remote-only session cwd with PONG replay. The target is a network-isolated disposable Debian Linux ARM64 container, reached through real SSH via a private Docker proxy. Target native prerequisites are prepared by the separate native-preparation script; the qualifier consumes the prepared artifact.

Remote cleanup is independently observed through Docker and `/proc`; start/prompt counters detect replay. The hanging process remains alive after stdin EOF, preventing that event from masquerading as lease cleanup. Network-loss disposal must reject with explicit teardown/unknown diagnostics even when the independent observer confirms remote death. Tests do not convert transport uncertainty into reported cleanup success.

## Review disposition and limitations

AGY reviewed the exact owned-child fault injection, independent remote observation, active cancellation, descendant checks, mandatory installed case, corrected examples and opt-in workflow. Codex independently ran the named checks and reviewed AGY's source, type fixes and paired documentation. No required local code finding remains open. Final strict Path B review-only follow-up task_55feb49d9695 / ctx_92e6e4ed3463 also settled with no required findings. The unit selection emitted an exit-listener warning; no claim of a warning-free full repository run is made.

The [workflow](../../.github/workflows/experimental-ssh-acp.yml) is configured and statically reviewed; it was not dispatched or executed on GitHub. Physical two-host network testing, designated production hosts and live platform accounts remain not run. Scoped success is not a claim of universal SDK or source regression freedom. The [completion record](expansion-completion.md) owns overall expansion acceptance and the earlier Loader test-isolation side effect.

The valid worker completion was processed; Orca release returned retained/external_terminal with no process action, then delivery acknowledgement completed. No new worktree or production-host change occurred.
