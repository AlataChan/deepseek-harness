# Installed IM profile qualification

Codex independently qualified the experimental IM profiles in the existing worktree on 2026-10-24/25. This report replaces the earlier builder report, which described helpers and target behavior that were not independently established. No production deployment or live platform delivery is claimed.

## Delivered composition

The [service bundle](../../packages/experimental/im-service-bundle/README.md) is declarative: `dsh-base` plus the explicit IM runtime patch. Its library entry exposes no profile-generation API. The separate [ingress example](../../packages/experimental/im-feishu/examples/README.md) starts storage and ingress with an empty bundle list. Tenant manifests pin the current package version and require explicit tenant identity, operator list, state directory and workspace configuration. Ingress and runtime are never mounted in the same process.

The installed qualification starts two actual built `dsh` processes from an explicit collected artifact: the tool-free ingress and a tenant using the actual service bundle. Source product imports and source fallback are forbidden. Only external SDK connection/fetch operations are substituted with synthetic I/O. The actual Feishu dispatcher or DingTalk client, durable admission, private IPC, Agent turn, JSONL persistence, outbound client and SQLite readback are exercised.

The gate checks duplicate admission before and after completion, PONG delivery, the platform-specific outbound ID, shutdown, cold restart and duplicate refusal after restart. A negative case rejects an unavailable artifact rather than loading checkout code. The current three-case run passes against the version-preserving artifact; log: /tmp/dsh-codex-im-version-preserving-artifact.log. Synthetic platform acceptance does not establish real app permissions, card rendering or callbacks.

## Linux deployment assets

Concrete sockets `dsh-im-a.socket` and `dsh-im-b.socket` activate their corresponding per-connection service templates. Tenant identities are fixed; the service instance identifies a connection. Root-owned socket parents are `0750`, sockets are `0660 root:dsh-im-ingress`, and tmpfiles recreates them after reboot. The tenant-state parent is `0711 root:root`; each tenant subtree is private. Tenant services specify non-root identities, memory/CPU/task limits, protected filesystems, control-group cleanup and a private executable temporary directory.

`Accept=yes` deliberately ties runtime lifetime to the ingress connection. Disconnect cancels active turns and drains durable state; reconnect is refused until the existing instance exits. It does not preserve running turns through an ingress restart. Deployment owners must accept this limitation or implement a separately reviewed persistent-runtime design.

The independently executed matrix uses Docker Desktop Linux ARM64, Debian Bookworm, systemd 252.39 and LinuxKit. It uses the shipped unit/tmpfiles files with test-owned paths and installed keyless replay configuration. No host accounts, host units, host mounts or production credentials are changed. Ten grouped checks cover different-UID refusal, runtime identity/resource limits, actual persisted turns, duplicates and Session continuity, second-connection refusal, EOF cancellation/reconnect, workspace refusal, cross-tenant file denial, no TCP control endpoint and cold-boot receipt persistence. The earlier shipped-asset pass is /tmp/dsh-codex-linux-shipped-assets.log; the final version-preserving artifact rerun also passes all ten groups in /tmp/dsh-codex-linux-preserved-final.log.

## Artifact and reproducibility

The collector's opt-in `--preserve-dependency-versions` retains incompatible nested dependency versions. This is required by the installed ACP closure; the default desktop collection behavior is unchanged. Target native prerequisites are prepared inside the disposable target image. The collected artifact is a qualification input, not a packaged desktop release.

Reproducible entry points are [installed ingress qualification](../../packages/experimental/im-feishu/tests/linux/qualify-installed-ingress.ts), [Linux tenant qualification](../../packages/experimental/im-feishu/tests/linux/qualify-tenant-runtime.ts) and the opt-in [Linux workflow](../../.github/workflows/experimental-im-linux.yml). The workflow has not been dispatched. Real Feishu/DingTalk applications, authorized operators and the intended production Linux environment still need bounded target acceptance.
