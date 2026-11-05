---
description: "本地变更页签."
kind: "package-reference"
---

# dsh-experimental-client-ui-forge

[English](README.md) | 中文

## 概述

一个 `worktree-review` 侧栏页签显示本地 Git 差异，提供创建请求、取消、重试、恢复和返回原项目操作。创建请求在首次模型步骤前执行，仅打开页签不会创建工作树。等待中的创建失败后保持等待，直到用户重试或撤销。检查使用会话沙箱和有界输出，不执行外部差异程序或代码托管 API。必需的工作树记录和原目录身份可在冷启动后恢复。

## 目录

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## 使用

由 Cordis 配置挂载；服务调用保留调用方信号。详细配置由配置目录生成。

子系统参考: [ 本地变更页签 ](../../../docs/subsystems/worktrees.zh.md).

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
