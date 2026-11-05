---
description: "本地审查组合."
kind: "package-bundle"
---

# dsh-experimental-worktree-review

[English](README.md) | 中文

## 概述

该桌面配置可选组合挂载本地工作树服务、创建工具和唯一的变更页签。Client 标记依赖实际的本地审查 Client，不会重复注册界面。官方 desktop-app 和 web-app 包不依赖此实验组合。

## 目录

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## 使用

由 Cordis 配置挂载；服务调用保留调用方信号。详细配置由配置目录生成。

子系统参考: [ 本地审查组合 ](../../../docs/subsystems/worktrees.zh.md).

## Model Experience

通过实际工作目录服务及其执行消费者间接影响模型。

#### KV Cache effect

模型请求内容及缓存效果由所组合的所属包决定；本包不发起辅助模型请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 检出失败可能保留分支或目录；重试前应检查残留并使用新名称。恢复仅能找回已提交内容。

### 开发备注

<a id="dev-note"></a>

无。

桌面安装包随附此组合包，但默认关闭。在侧栏打开**插件**，选择 `@deepseek-ai/dsh-experimental-worktree-review` 并开启组合包；若管理器提示重启，请按提示操作。启用后可从会话标题旁打开**变更**。打开页签不会创建检出目录；显式申请会等待下一条任务消息。
