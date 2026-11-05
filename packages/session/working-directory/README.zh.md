---
description: "会话执行目录."
kind: "package-reference"
---

# dsh-working-directory

[English](README.md) | 中文

## 概述

会话头保持原项目目录不变。`get(session)` 读取执行目录；`ensure(agent, signal)` 检查目录，目录丢失时返回原项目；`set(agent, path, signal)` 检查并记录目录切换。同一会话的操作按顺序执行，写入事件前取消不会切换目录，卸载会取消并等待操作结束。`defaultDirectory` 必须为绝对路径，仅在会话头没有目录时使用。现有进程保持自身目录，沙箱权限仍由原项目决定。

## 目录

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## 使用

由 Cordis 配置挂载；服务调用保留调用方信号。详细配置由配置目录生成。

子系统参考: [ 会话执行目录 ](../../../docs/subsystems/working-directory.zh.md).

## Model Experience

### 执行目录与本地状态

#### What the model sees

必需的原样上下文为 `Current working directory: {JSON 引用的 cwd}.`。记录切换后注入来源为 `working-directory` 的用户通知；即使关闭可选运行时上下文，目录信息仍然保留。

#### Token effect

工具调用、目录通知和必需目录上下文按使用情况增加文本，不发起额外模型请求。

#### KV Cache effect

稳定目录文本可复用已有前缀；切换目录会更新运行时上下文并追加通知，提供方缓存可用性由模型服务决定。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 切换执行目录不会改变现有进程目录，也不会扩大沙箱权限。原项目也丢失时 ensure 会失败，需明确选择一个存在的目录。

### 开发备注

<a id="dev-note"></a>

无。
