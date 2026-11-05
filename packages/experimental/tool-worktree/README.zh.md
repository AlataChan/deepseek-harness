---
description: "创建工作树工具."
kind: "package-reference"
---

# dsh-experimental-tool-worktree

[English](README.md) | 中文

## 概述

`create_worktree` 调用共享的本地工作树服务。`name` 指定新分支和目录名称，省略时自动生成唯一名称。`from` 选择本地提交、分支或标签，默认为 HEAD。名称已存在时失败。离开目录不会删除工作树和分支。

## 目录

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## 使用

由 Cordis 配置挂载；服务调用保留调用方信号。详细配置由配置目录生成。

子系统参考: [ 创建工作树工具 ](../../../docs/subsystems/worktrees.zh.md).

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

- 检出失败可能保留分支或目录；重试前应检查残留并使用新名称。恢复仅能找回已提交内容。

### 开发备注

<a id="dev-note"></a>

无。
