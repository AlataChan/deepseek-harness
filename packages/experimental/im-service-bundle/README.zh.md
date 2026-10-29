---
description: "用于隔离 IM 租户运行时的显式实验性 profile bundle。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-im-service-bundle

[English](README.md) | 中文

## 概述

此声明式 bundle 在 `dsh-base` 上挂载 IM 租户运行时。profile 组合器读取 `dsh.bundle.patch`，模块不导出运行时 API。入口在 bundle 列表为空的独立 profile 中运行。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知局限与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用此包

### 运行时 profile 组合

将[租户 profile 示例](../im-feishu/examples/profiles/tenant-a/package.json)复制到选定的私有 `DSH_HOME/profiles/` 目录，并在补丁中配置已授权的租户、操作者和工作区。profile 先列出 `@deepseek-ai/dsh-base`，再列出本 bundle，并显式声明与部署构建匹配的依赖。通过 `dsh --profile tenant-a` 启动。

### 独立入口 profile

[入口示例](../im-feishu/examples/profiles/ingress/package.json)的 bundle 列表为空，仅声明存储中心和 IM 传输包。其补丁挂载 `storage` 和 `im-ingress`。凭据和已认证操作者绑定由管理员配置，入站消息不能选择租户进程或可执行命令。

<a id="understand-the-implementation"></a>
## 了解实现

[bundle 补丁](cordis.patch.yml)关闭开发期 HMR 并挂载租户运行时。必需环境设置为 `DSH_IM_TENANT_ID`、逗号分隔的 `DSH_IM_OPERATOR_IDS` 和 `DSH_IM_STATE_DIR`；profile 补丁也可显式提供这些设置。`DSH_IM_CWD` 选择工作区。未设置 `DSH_IM_SOCKET_PATH` 时，运行时使用继承的 systemd 标准输入输出。运行时设置无效或缺失时启动失败。

[部署示例](../im-feishu/examples/README.zh.md)定义各租户的 socket/service 配对、私有状态和可执行临时目录、资源限额及独立 UID，需由管理员预配置并完成目标环境验收。

<a id="further-exploration"></a>
## 进一步探索

- [IM 服务与交互](../im-feishu/README.zh.md)
- [扩展验收记录](../../../.plans/feature-expansion-2026-10-24/expansion-completion.md)

<a id="model-experience"></a>
## 模型体验

### 运行时组合

#### 模型看到什么

已认证操作者的提示词保留标准人类 `user` 来源，传输标识保存在入口数据库中。

#### Token 影响

bundle 不添加模型指令文本。提示词、交互通知和常规预设上下文仍作为 Session 输入记录。

#### KV Cache 影响

轮次追加到选定的 Session，缓存行为由配置的预设和模型提供方决定。

## 已知局限与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **验收范围**——本地源码和可丢弃 Linux 安装产物检查已通过独立评审；真实平台投递、生产部署、物理两主机 SSH 和 CI 执行仍为单独未运行门禁。见[扩展验收记录](../../../.plans/feature-expansion-2026-10-24/expansion-completion.md)。

此包处于实验阶段，需显式安装 profile。真实平台账户和物理远程主机需单独验收。systemd 使用 `Accept=yes` 时，入口连接断开会取消租户当前任务，并在退出前写入终态；入口重启因此需要持久化对账。敏感操作缺少已配置的审批回答器时失败关闭。

<a id="dev-note"></a>
### 开发备注

bundle 由 profile 组合器配置，模块不导出服务。运行时行为与生命周期测试由 IM 包负责。
