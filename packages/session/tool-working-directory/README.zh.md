---
description: "工作目录工具."
kind: "package-reference"
---

# dsh-tool-working-directory

[English](README.md) | 中文

## 概述

`working_directory` 工具在未传入 `cd` 时读取当前目录，传入时检查并切换目录。相对路径基于当前执行目录。调用必须关联 Agent 会话。工具不会移动已经启动的 Shell，也不会改变文件权限。

## 目录

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## 使用

由 Cordis 配置挂载；服务调用保留调用方信号。详细配置由配置目录生成。

子系统参考: [ 工作目录工具 ](../../../docs/subsystems/working-directory.zh.md).

## Model Experience

### 执行目录与本地状态

#### What the model sees

挂载工具后，模型可见工具定义和规范结果。目录切换还通过工作目录服务进入模型上下文。

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
