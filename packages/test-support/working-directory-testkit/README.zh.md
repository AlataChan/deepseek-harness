---
description: "为执行工具测试显式挂载真实工作目录服务。"
kind: "package-library"
---

# dsh-working-directory-testkit

[English](README.md) | 中文

## 概述

mountDirectoryFixture(ctx, defaultDirectory) 保留调用方文件系统，只在缺少时挂载真实的目录服务及其前置服务。调用方负责 Context 和临时目录清理。它不修改通用 AgentLoop 测试工具或产品默认组合。

## 目录

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Model Experience

通过实际工作目录服务及其执行消费者间接影响模型。

#### KV Cache effect

模型请求内容及缓存效果由所组合的所属包决定；本包不发起辅助模型请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 已有测试文件系统必须支持目录检查。调用方必须提供真实 Session 和生命周期，不能依靠空回调模拟目录切换。

### 开发备注

<a id="dev-note"></a>

无。
