---
kind: upgrade-guide
description: "Unloading a selected PTC tool executor now fails the scope instead of running tools through another executor."
---

# PTC executor unload

English | [中文](guide.zh.md)

## Change

A composition that calls `ctx.tools.setExecutor()` and then disposes that selection receives `TOOL_EXECUTOR_UNAVAILABLE` for later tool calls in that scope. The call does not run on the native pipeline or on a different executor. Profiles that never select an executor still use `ToolRuntime.execute()`. Program working directories still come from `session.header.cwd`. No Session event type changed.

## Migration

1. If a preset mounts `@deepseek-ai/dsh-tool-executor-ptc`, keep that plugin loaded for the whole time the agent executes tools.
2. On `TOOL_EXECUTOR_UNAVAILABLE`, reload the executor in the same scope before the next tool batch. Do not catch the error and call a native tool path for that scope.
