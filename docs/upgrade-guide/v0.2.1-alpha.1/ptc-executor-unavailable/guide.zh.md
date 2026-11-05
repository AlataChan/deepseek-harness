---
kind: upgrade-guide
description: "卸载已选择的 PTC 工具执行器后，该作用域会失败，而不会改由另一个执行器运行工具。"
---

# PTC 执行器卸载

[English](guide.md) | 中文

## 变更

调用 `ctx.tools.setExecutor()` 后又释放该选择的组合，会在该作用域的后续工具调用上收到 `TOOL_EXECUTOR_UNAVAILABLE`。该调用不会走原生管线，也不会落到另一个执行器。从未选择执行器的配置仍使用 `ToolRuntime.execute()`。程序工作目录仍来自 `session.header.cwd`。Session 事件类型没有变化。

## 迁移

1. 若预设挂载了 `@deepseek-ai/dsh-tool-executor-ptc`，在 Agent 执行工具的整段时间内保持该插件已加载。
2. 遇到 `TOOL_EXECUTOR_UNAVAILABLE` 时，先在同一作用域重新加载执行器，再进行下一批工具调用。不要捕获该错误后改走该作用域的原生工具路径。
