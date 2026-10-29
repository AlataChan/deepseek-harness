# Linux IM deployment examples

English | [中文](README.zh.md)

The ingress runs as `dsh-im-ingress` and connects to root-owned Unix sockets. systemd starts each tenant under its dedicated unprivileged UID. Install and configure these examples explicitly; live platform acceptance and production-host qualification remain separate.

## Accounts and directories

Provision group and UID 22001 for `dsh-im-ingress`, UID 22002 for `dsh-im-a`, and UID 22003 for `dsh-im-b`. The ingress group must have no tenant members. The sample `trustedGid` values assume GID 22001; change both account provisioning and profile configuration together when selecting another GID.

Install [dsh-im.conf](tmpfiles.d/dsh-im.conf) as a tmpfiles configuration. It recreates the root:ingress-group socket parents with mode 0750 on every boot. The persistent state parent is root:root 0711, allowing each tenant to traverse to its own 0700 directory while preventing directory listing. Tenant home, state, workspace and executable temporary directories remain private.

## Profiles and units

Install the built packages into the selected runtime installation. Copy [tenant A](profiles/tenant-a/) into its private `DSH_HOME/profiles/tenant-a` directory and [tenant B](profiles/tenant-b/) into its corresponding directory. The manifests declare exact source-package versions for the local built closure; distribution packaging must align names and versions with its published packages. Configure model credentials under each tenant identity before admitting real work.

Each socket uses a concrete tenant name; the service template instance identifies the connection, not the tenant. Install these pairs:

| Tenant | Socket | Connection service |
| --- | --- | --- |
| A | [dsh-im-a.socket](systemd/system/dsh-im-a.socket) | [dsh-im-a@.service](systemd/system/dsh-im-a@.service) |
| B | [dsh-im-b.socket](systemd/system/dsh-im-b.socket) | [dsh-im-b@.service](systemd/system/dsh-im-b@.service) |

Enable the socket units after provisioning the profiles and directories. Tenant runtime processes receive their socket through standard input/output; they open no TCP control listener. The service fixes its UID, workspace, private `HOME`/`DSH_HOME`/`TMPDIR`, cgroup limits and control-group teardown. The runtime's workspace identity must match the ingress endpoint setting.

Copy the [ingress profile](profiles/ingress/) into the ingress identity's private `DSH_HOME/profiles/im-ingress` directory. It contains no base bundle, Agent, LLM provider or execution tool. Set `FEISHU_APP_ID`, `FEISHU_APP_SECRET` and `DSH_IM_OPERATOR_BINDINGS` in the ingress service environment. The last value is a JSON array of administrator-approved binding records; missing or malformed configuration fails at load. Each record contains the provider, app, organization, chat and sender IDs, their JSON-tuple `bindingKey`, internal operator and target tenant IDs, authorization timestamp and nullable revocation timestamp. Launch `dsh --profile im-ingress` as the ingress UID through the deployment's process supervisor. This repository does not provision host accounts or enable services automatically.

## Connection and recovery behavior

`Accept=yes` gives each connection one tenant process, and `MaxConnections=1` refuses a second writer connection until the old instance drains. An ingress crash or restart interrupts active tenant turns. EOF cancels owned work and flushes terminal state before exit; reconnect reconciles receipts against Session logs and never automatically replays an uncertain delivery. The systemd stop deadline and `KillMode=control-group` handle a process that does not exit cleanly.

Approval and question cards require explicit interaction configuration. The default runtime has no IM approval answerer, so protected operations fail closed. Optional cards require a current authenticated binding, exact live request identity and a single-use durable decision.

## Qualification

The [installed Linux qualifier](../tests/linux/qualify-tenant-runtime.ts) reads these socket/service and tmpfiles assets, substitutes disposable paths and a keyless replay launch, and exercises real tenant processes under distinct UIDs. It verifies socket refusal, file isolation, resource limits, cancellation, duplicate handling and restart persistence. The [installed ingress qualifier](../tests/linux/qualify-installed-ingress.ts) separately exercises Feishu and DingTalk dispatch with synthetic platform I/O. These checks do not establish real platform delivery or physical remote-host acceptance.
