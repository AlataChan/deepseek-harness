---
description: "PTC 批次执行器：模型只能直接调用 run_code，嵌套工具走共享的受保护管线。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-executor-ptc

[English](README.md) | 中文

## 概述

挂载此插件后，该作用域选择 PTC 批次执行。除 `run_code` 以外的模型直呼会在工具主体开始前被拒绝。嵌套调用使用该步骤捕获的工具集合和注册表的受保护管线。程序传输仍是 `@deepseek-ai/dsh-tools` 中的 `run_code`。选择卸载后抛出 `TOOL_EXECUTOR_UNAVAILABLE`，不会落到另一个执行器。未挂载此插件的配置继续使用原生 `ToolRuntime.execute()`。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

插件注入 `tools`、`systemPrompt` 和 `ptcRuntime`。在预设作用域中，`apply` 调用 `ctx.tools.presentAs('ptc')` 和 `ctx.tools.setExecutor()`。在根上下文中，`apply` 要求工具行 `mode: ptc`，并且不调用 `presentAs`；`native` 或 `both` 会在加载时失败。`maxParallelSubCalls` 在该作用域接受执行器时写入执行器记录。同一作用域拒绝第二次注册时，在任上限保持不变。卸载后先使用最近的剩余记录，然后使用工具服务字段。Agent 程序使用 `session.header.cwd`。此包不追加 `working-directory/change`。

<a id="model-experience"></a>
## 模型体验

### 工具选择

#### 模型看到的内容

模型看到 `run_code` 程序传输及其生成的工具 SDK。[工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-executor-ptc)拥有其 schema。直接调用其他工具会被拒绝；嵌套调用保留捕获的工具身份及全部注册表守卫。本插件选择传输，tools 和 runtime 包拥有程序说明及结果。

#### Token 影响

一个传输 schema 取代直接调用的工具 schema。生成的 SDK 仍描述可用的嵌套工具；成本取决于该集合及运行时说明。

#### KV Cache 影响

所选执行器或可见嵌套工具变化时，请求前缀随之变化。作用域和工具集合稳定时，生成的声明保持不变。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 作用域需要可用的 PTC 运行时和工具注册表；卸载所选执行器后拒绝新批次。
- 取消发生时，已开始的子调用可能已经产生外部影响。程序不会自动重放。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
