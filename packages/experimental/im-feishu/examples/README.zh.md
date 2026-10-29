# Linux IM 部署示例

[English](README.md) | 中文

入口以 `dsh-im-ingress` 身份运行，并连接 root 所有的 Unix socket。systemd 以各自独立的非特权 UID 启动租户。需显式安装并配置这些示例；真实平台验收和生产主机资格验证单独完成。

## 账户与目录

为 `dsh-im-ingress` 配置组和 UID 22001，为 `dsh-im-a` 配置 UID 22002，为 `dsh-im-b` 配置 UID 22003。入口组不能包含租户用户。示例 `trustedGid` 假定 GID 为 22001；选择其他 GID 时应同步修改账户预配置和 profile 配置。

将 [dsh-im.conf](tmpfiles.d/dsh-im.conf) 安装为 tmpfiles 配置。每次启动均重建 root:入口组所有、权限为 0750 的 socket 父目录。持久状态父目录为 root:root 0711，允许租户遍历到各自的 0700 目录，同时禁止列出目录内容。租户的 home、状态、工作区及可执行临时目录均保持私有。

## Profile 与单元

将构建好的包安装到选定的运行时环境。将[租户 A](profiles/tenant-a/) 复制到其私有 `DSH_HOME/profiles/tenant-a` 目录，将[租户 B](profiles/tenant-b/) 复制到对应目录。清单为本地构建闭包声明精确的源包版本；分发打包需使名称和版本与已发布包一致。准入真实任务前应在各租户身份下配置模型凭据。

socket 使用具体租户名称；service 模板实例标识连接，而非租户。安装以下配对：

| 租户 | Socket | 连接 service |
| --- | --- | --- |
| A | [dsh-im-a.socket](systemd/system/dsh-im-a.socket) | [dsh-im-a@.service](systemd/system/dsh-im-a@.service) |
| B | [dsh-im-b.socket](systemd/system/dsh-im-b.socket) | [dsh-im-b@.service](systemd/system/dsh-im-b@.service) |

完成 profile 和目录预配置后启用 socket 单元。租户运行时通过标准输入输出接收 socket，不开启 TCP 控制监听。service 固定 UID、工作区、私有 `HOME`/`DSH_HOME`/`TMPDIR`、cgroup 限额及控制组清理。运行时的工作区身份必须与入口端点设置一致。

将[入口 profile](profiles/ingress/) 复制到入口身份的私有 `DSH_HOME/profiles/im-ingress` 目录。它不包含 base bundle、Agent、模型提供方或执行工具。在入口服务环境中设置 `FEISHU_APP_ID`、`FEISHU_APP_SECRET` 和 `DSH_IM_OPERATOR_BINDINGS`。最后一项为管理员已批准绑定记录组成的 JSON 数组；缺失或格式无效时在加载阶段报错。各记录包含提供方、应用、组织、会话、发送者 ID，对应 JSON 元组 `bindingKey`，内部操作者和目标租户 ID，授权时间戳及可空的撤销时间戳。由部署的进程管理器以入口 UID 启动 `dsh --profile im-ingress`。本仓库不自动配置主机账户或启用服务。

## 连接与恢复行为

`Accept=yes` 为每条连接创建一个租户进程，`MaxConnections=1` 在旧实例排空前拒绝第二个 writer 连接。入口崩溃或重启会中断当前租户轮次。EOF 会取消持有的任务，并在退出前写入终态；重连通过 Session 日志对账 receipt，绝不自动重放不确定的投递。systemd 停止期限和 `KillMode=control-group` 处理无法正常退出的进程。

审批和问题卡片需要显式交互配置。默认运行时没有 IM 审批回答器，因此受保护操作失败关闭。可选卡片要求当前已认证绑定、精确的实时请求身份和单次持久决定。

## 验证

[已安装 Linux 验证器](../tests/linux/qualify-tenant-runtime.ts)读取这些 socket/service 和 tmpfiles 文件，替换一次性路径与无密钥重放启动方式，并以不同 UID 驱动真实租户进程。它验证 socket 拒绝、文件隔离、资源限额、取消、重复处理和重启持久性。[已安装入口验证器](../tests/linux/qualify-installed-ingress.ts)另以合成平台 I/O 验证飞书和钉钉分发。这些检查不代表真实平台投递或物理远程主机验收。
