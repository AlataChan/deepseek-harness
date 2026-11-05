---
description: "将选中的会话文本插入输入框，并作为普通 Markdown 引用发送。"
kind: "package-reference"
---

# @deepseek-ai/dsh-message-quotes

[English](README.md) | 中文

## 概述

选中会话正文后，可将其作为一个可整体移除的引用加入当前输入框。发送时输出普通 Markdown 引用行。发送被拒绝后，引用与完整草稿一起保留。已删除会话和不可继续的子会话无法接收引用。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## 使用此包

Web 组合在会话视图中挂载 Client 入口。引用共享当前[会话](../../../docs/subsystems/conversation.zh.md)输入框，并使用按键注册的 `conversation.chat.text-interaction` 插槽。此包没有配置字段。

<a id="model-experience"></a>

## 模型体验

### 提交的引用文本

#### 模型看到什么

引用成为普通 Markdown：选中的每一行以 `> ` 开头，与前后正文之间保留空行。引用中的资源标记保持原文。引用不增加元数据或会话事件类型。

#### Token 影响

仅已提交的引用文本及其 Markdown 标记会增加请求 token；提交前的选择操作和草稿预览不会增加 token。

#### KV Cache 影响

已提交引用以用户消息文本追加到会话历史中，保留前面消息的 token。修改草稿仅影响下一条提交的消息。提供方缓存可用性由外部决定。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 仅识别显式标记且前导空格不超过三个的引用行，不处理惰性续行或围栏代码语义。
- 草稿引用使用现有会话草稿存储，不提供独立的引用库。

### 开发备注

无。
