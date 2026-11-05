---
description: "本地 Git 工作树."
kind: "package-reference"
---

# dsh-experimental-worktree

[English](README.md) | 中文

## 概述

`create` 固定本地版本，分配新分支和检出目录，检出成功后才切换执行目录。原目录中的未提交文件和暂存区保持原状。`restore` 在记录的位置重建丢失的工作树，不切换执行目录；优先使用已有分支，分支丢失时从基准提交重建。每条命令禁用钩子和配置的内容过滤器。不会获取远程数据、删除分支、自动清理重试、合并或发布。

## 目录

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## 使用

由 Cordis 配置挂载；服务调用保留调用方信号。详细配置由配置目录生成。

子系统参考: [ 本地 Git 工作树 ](../../../docs/subsystems/worktrees.zh.md).

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
