---
description: "用于飞书 IM 消息来源生成、单射投递键编码与审批上下文解析的辅助函数库。"
kind: "package-library"
---

# @deepseek-ai/dsh-experimental-im-feishu

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-experimental-im-feishu` 提供人类提示词来源、持久化 IM 投递存储、入口准入和租户运行时服务。已认证操作者的消息使用新生成的 UUID 请求 ID，保留 `kind: user`；外部身份仅保存在业务数据库中。仅构造服务实例不会启动平台连接或执行进程。使用前必须完成显式 profile 组合和部署验收。

## 目录

- [使用此 package](#use-this-package)
- [理解实现原理](#understand-the-implementation)
- [延伸探索](#further-exploration)
- [模型体验](#model-experience)
- [已知局限与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用此 package

### 适用场景

在飞书 IM 入口处理器或审批适配器中，将接收到的平台 WebSocket 消息转换为 Harness 的 user 提示词来源，或处理待决审批准入时，导入此辅助函数库。根入口是函数库。独立的 `./runtime` 和 `./ingress` 导出提供隔离进程插件；它们要求显式部署配置，禁止在同一租户进程中同时挂载。

桌面用户通过已内置的 [IM 设置扩展](../desktop-im/README.zh.md)进入“设置 → IM 接入”。`./desktop` 适配器在当前桌面用户的进程内复用投递服务，并通过 SQLite 管理写入所有权；它不提供跨 UID 的租户隔离。

### 入口点

从显式入口点导入辅助函数或隔离进程插件：

```ts
// Library helpers: prompt source minting and key encoding
import { createImPromptSource, mintImSessionRequestId } from '@deepseek-ai/dsh-experimental-im-feishu'

// Ingress plugin entry: mounts WebSocket transport and durable admission queue
import * as ingressPlugin from '@deepseek-ai/dsh-experimental-im-feishu/ingress'

// Runtime plugin entry: mounts tenant session mapping and execution service
import * as runtimePlugin from '@deepseek-ai/dsh-experimental-im-feishu/runtime'
```

-----

<a id="understand-the-implementation"></a>
## 理解实现原理

<details>
<summary>实现内部细节——点击展开</summary>

| 文件 | 角色 |
|---|---|
| [`src/types.ts`](src/types.ts) | 飞书外部品牌化标识符与解析后的审批上下文类型 |
| [`src/source.ts`](src/source.ts) | 方案 (c) user 提示词来源构建与单射 JSON 元组键编码 |
| [`src/storage.ts`](src/storage.ts) | 单 writer inbox/outbox、receipt domain 与崩溃对账 |
| [`src/ingress.ts`](src/ingress.ts) | 持久准入后 ACK；单独驱动任务分发及回复投递 |
| [`src/feishu-transport.ts`](src/feishu-transport.ts) | 具有有界启动、可配置轮询与优雅排空的 WebSocket 传输通道 |
| [`src/feishu-normalizer.ts`](src/feishu-normalizer.ts) | 双向帧规范化、Bearer 令牌脱敏与卡片 2.0 解析 |
| [`src/feishu-outbound.ts`](src/feishu-outbound.ts) | 出站来源校验、超时、脱敏、返回消息 ID 与发送结果不确定分类 |
| [`src/runtime-service.ts`](src/runtime-service.ts) | 租户持有的会话映射、重复抑制与有界取消 |
| [`src/approval-context.ts`](src/approval-context.ts) | 轮次作用域的原生与 PTC 工具审批上下文解析，遇畸变或已结算调用时安全失败 |

runtime 持有正在执行的 delivery 时，即使提示词尚未能从持久日志读到，状态也保持 admitted。执行结束后，由 receipt 和关联的 Session 日志确定状态；恢复出的 receipt 若没有匹配提示词则保持 unknown，不自动重放。

</details>

### 非目录类型

该 package 定义了十二个在子系统 Cordis 目录之外独立维护的 IPC、准入及回执类型：

- [`src/types.ts`](src/types.ts)：
  - `IncomingImMessage`——规范化校验后的传入平台 IM 消息载荷。
  - `IngressAcceptResult`——记录生成的请求 ID 与重试状态的持久化准入结果。
- [`src/storage.ts`](src/storage.ts)：
  - `OperatorBindingRecord`——存储中管理授权状态的已认证操作员绑定记录。
  - `TenantReceiptRecord`——租户存储中记录执行结果与时间戳的持久化投递回执记录。
- [`src/ipc.ts`](src/ipc.ts)：
  - `SubmitDeliveryRequest`——将已准入投递提交至租户运行时的 IPC 请求。
  - `SubmitDeliveryResponse`——确认投递提交状态的 IPC 响应。
  - `GetDeliveryRequest`——按投递键（可附带会话 ID）查询运行时投递状态的 IPC 请求。
  - `GetDeliveryResponse`——返回投递状态与执行结果的 IPC 响应。
  - `CancelDeliveryRequest`——请求对活跃投递处理进行有界取消的 IPC 请求。
  - `CancelDeliveryResponse`——返回取消结果状态（`cancelled`、`not_found`、`completed`、`failed` 或 `unknown`）的 IPC 响应。
  - `GetApprovalContextRequest`——为待决工具决策查询审批上下文的 Phase-2 IPC 请求。
  - `GetApprovalContextResponse`——返回严格为 null 上下文的 Phase-2 IPC 响应（审批参数显式不对 IPC 暴露）。

-----

<a id="further-exploration"></a>
## 延伸探索

- [功能扩展架构计划](../../../.plans/feature-expansion-2026-10-24/dsh_feature_expansion_architecture_plan.md) — 多租户 IM 与隔离架构。
- [来源决策记录](../../../.plans/feature-expansion-2026-10-24/decision-source.md) — 来源格式方案 (a)、(b) 与 (c) 的实证对比。
- [扩展完成记录](../../../.plans/feature-expansion-2026-10-24/expansion-completion.md) — 已限定范围的测试证据与剩余部署验收。

-----

<a id="model-experience"></a>
## 模型体验

### 入口提示词来源

#### 模型所见

通过 `createImPromptSource` 格式化的消息带有 `kind: 'user'`，并在 `rpcId` 中携带新铸造的 `SessionRequestId`。模型将传入消息视为标准的人类用户提示词，不含平台特定的投递标识符或平台传输元数据。

#### Token 影响

将提示词消息文本添加到对话上下文中，不产生来自外部投递键或协议头的额外开销。

#### KV Cache 影响

在已建立的对话前缀之后追加标准用户提示词 token，在连续轮次之间保持缓存复用。

## 已知局限与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **验收范围**——本地源码和可丢弃 Linux 安装产物检查已通过独立评审；真实平台投递、生产部署、物理两主机 SSH 和 CI 执行仍为单独未运行门禁。见[扩展验收记录](../../../.plans/feature-expansion-2026-10-24/expansion-completion.md)。

- **部署独立完成** — 服务类不安装 systemd unit、不配置 OS 用户，也不启动 profile。Linux socket 权限和进程隔离需要目标环境验收。运行时在请求启动器退出前会等待持久化投递取消和存储排空。随附的 `Accept=yes` socket unit 会在入口断连后结束对应租户运行时并取消活动轮次；重连须等待该运行时排空。运行时原生模块使用租户状态目录下私有且可执行的 `TMPDIR`。
- **明确标记投递不确定性** — receipt 没有对应日志提示词时绝不自动重放。外部发送未获确认时进入 unknown，需对账或由操作者处理。
- **限额与轮询来自部署配置** — 就绪轮询间隔（`connectionStatusPollIntervalMs`）、启动、发送与关闭超时均为经验证的配置字段。入口限制保留记录数、提示词和回复字节数、消息时效及发送次数。
- **Phase 2 默认安全失败与 SDK 终态失败** — 未配置的卡片接收器、过期操作或畸变载荷安全失败并提示警告。SDK 连接耗尽或永久失败使传输通道进入终态，需要重新创建实例。
- **审批权限显式配置** — 默认运行时不通过 IPC 暴露审批参数。可选交互回答器要求精确的实时请求身份、当前已认证绑定和单次持久决定；带时限的结构化问题交由其他回答器处理或失败关闭。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

位于 `@deepseek-ai/dsh-experimental-*` 下的实验性函数库。

</details>
