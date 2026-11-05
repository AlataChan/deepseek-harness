---
description: "PTC batch executor that admits only run_code as a model-direct call and runs nested tools through the shared guarded pipeline."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-executor-ptc

English | [中文](README.zh.md)

## Summary

Mount this plugin to select PTC batch execution for one scope. A model-direct call other than `run_code` is refused before the tool body starts. Nested calls use the step's captured tool set and the registry's guarded pipeline. The program transport remains `run_code` in `@deepseek-ai/dsh-tools`. Unloading the selection throws `TOOL_EXECUTOR_UNAVAILABLE` and does not fall through to another executor. A profile that does not mount this plugin keeps native `ToolRuntime.execute()`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The plugin injects `tools`, `systemPrompt`, and `ptcRuntime`. On a preset scope, `apply` calls `ctx.tools.presentAs('ptc')` and `ctx.tools.setExecutor()`. On the root context, `apply` requires the tools row `mode: ptc` and does not call `presentAs`; `native` or `both` fails at load. `maxParallelSubCalls` is stored on the executor record when that scope accepts it. A rejected duplicate leaves the incumbent cap unchanged. After unload, the nearest remaining record applies, then the tools-service field. Agent programs use `session.header.cwd`. This package does not append `working-directory/change`.

<a id="model-experience"></a>
## Model Experience

### Tool selection

#### What the model sees

The model sees the `run_code` transport and its generated tool SDK. The [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-executor-ptc) owns its schema. Direct calls to other tools are refused; nested calls retain the captured tool identities and all registry guards. This plugin selects the transport; the tools and runtime packages own program instructions and results.

#### Token effect

One transport schema replaces the direct-call tool schemas. The generated SDK still describes available nested tools; cost depends on that set and the runtime instructions.

#### KV Cache effect

Changing the selected executor or visible nested tools changes the request prefix. A stable scope and tool set retain the same generated declarations.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A scope needs an available PTC runtime and tool registry; unloading the selected executor refuses new batches.
- Started subcalls can already have external effects when cancellation occurs. Programs are not replayed automatically.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
