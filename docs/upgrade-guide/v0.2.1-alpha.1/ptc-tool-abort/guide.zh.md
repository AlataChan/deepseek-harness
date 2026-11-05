---
kind: upgrade-guide
description: "PTC 子调用上限、步骤准入和已中止的工具结果现在保留所选执行器与成功主体文本。"
---

# PTC 工具中止与执行器配置

[English](guide.md) | 中文

## 变更

已选择的 `@deepseek-ai/dsh-tool-executor-ptc` 将其 `maxParallelSubCalls` 用于嵌套的 `run_code` 调用。工具服务的 `maxParallelSubCalls` 只在没有执行器采纳上限时生效，并在该选择卸载后再次生效。默认值仍是 10。

一个步骤已准入的工具调用保持该定义。步骤进行中注册同名的另一个工具不会运行新主体。该调用返回未知工具错误。已经开始的调用仍会排空，回合日志保持顺序。

主体已经产出成功结果之后的取消会保留该结果文本，追加 `Error: tool call aborted`，并设置 `isError` 与代码 `ABORTED`。从未开始的调用仍只返回 `ABORTED_BEFORE_DISPATCH`。这两个代码都不是关闭沙箱的理由。

`packages/bundle/web-app/presets/ptc.patch.yml` 挂载 `@deepseek-ai/dsh-tool-executor-ptc`，不再挂载 `@deepseek-ai/dsh-agent-tool-presentation`。原生和 `both` 预设保留呈现插件。`PtcRuntime.programFormat` 默认为 `function-body`，`retainsState` 为 false，`release(owner)` 立即完成。`stateOwner` 不会写入会话日志。

## 迁移

1. 当嵌套重叠上限必须不同于 `@deepseek-ai/dsh-tools` 时，在 PTC 执行器行设置 `maxParallelSubCalls`。确认为 `1` 时嵌套绑定逐个运行。
2. 把步骤中途注册的同名工具视为对该步骤已有调用不可用。不要期望新主体运行。
3. 把 `ABORTED` 内容读作成功主体文本加上中止行。继续把 `ABORTED_BEFORE_DISPATCH` 当作未开始的调用。
4. 让 PTC 预设指向 `@deepseek-ai/dsh-tool-executor-ptc`。原生和 `both` 预设留在 `@deepseek-ai/dsh-agent-tool-presentation`。
5. 不要传入 `stateOwner` 并期望保留 REPL 或 script 内存。当前 Node 提供方仍为每次运行启动一个新进程。
