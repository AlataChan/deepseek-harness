---
description: "钉钉 Stream 私聊接入、持久接收确认与有界回复。"
kind: "package-library"
---

# @deepseek-ai/dsh-experimental-im-dingtalk

[English](README.md) | 中文

## 概述

接收已认证的钉钉机器人私聊消息，在持久接收后确认，并通过该消息的会话 Webhook 回复。传输层在准入前拒绝不受支持的身份和消息格式。本库由实验 IM 入口组合使用，本身不启动应用。

## 目录

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

### 使用时机

在显式配置的 IM 入口 profile 中使用本传输层。接收器必须在确认接收前持久写入消息；存储异常时不发送 SDK Socket 确认。SDK 忽略回调返回的确认值，因此传输层只在持久接收或明确拒绝后显式调用 `socketCallBackResponse`。

### 入口

[模块导出](src/index.ts)提供 `DingTalkTransport`、配置 schema、规范化器和出站客户端。`start()` 检查 SDK 已连接标志；SDK 连接 Promise 成功本身不代表就绪。`close()` 停止准入，并在配置期限内等待自有操作完成。

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节——点击展开</summary>

[规范化器](src/dingtalk-normalizer.ts)将配置的应用和组织绑定到发送者与私聊会话。稳定消息 ID 用于投递去重，Socket 消息 ID 用于确认关联。私有入口数据库保存官方 HTTPS 回复能力及过期时间，两者均不转发到租户 Session。[出站客户端](src/dingtalk-outbound.ts)要求平台显式返回成功字段，拒绝重定向和外部来源，将不确定网络结果标记为 unknown。Webhook 回复被接受时没有平台消息 ID。

</details>

<a id="model-experience"></a>
## 模型体验

### 规范化私聊文本

#### 模型看到的内容

本库不构造模型请求。消费本库的入口决定是否将规范化 `text` 作为已认证人类提示准入。传输凭据和会话 Webhook URL 不进入模型上下文。

#### Token 影响

准入的消息文本贡献普通用户提示词 Token；传输元数据不贡献 Token。

#### KV 缓存影响

传输层不修改模型请求前缀；消费本库的运行时负责上下文组装。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- **验收范围**——本地源码和可丢弃 Linux 安装产物检查已通过独立评审；真实平台投递、生产部署、物理两主机 SSH 和 CI 执行仍为单独未运行门禁。见[扩展验收记录](../../../.plans/feature-expansion-2026-10-24/expansion-completion.md)。

- 仅支持私聊文本；拒绝群消息和附件。
- 回复要求未过期的官方会话 Webhook 能力；不自动重放 unknown 发送。
- 本渠道未实现人工审批卡片；敏感工具需要独立可信回答者，否则失败关闭。
- 本地 SDK 和回环 HTTP 测试不代表真实应用授权或投递已验证；必须单独验证指定测试应用和操作者。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护工作背景——点击展开</summary>

无。

</details>
