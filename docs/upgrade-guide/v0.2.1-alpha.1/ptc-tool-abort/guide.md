---
kind: upgrade-guide
description: "PTC subcall limits, step admission, and aborted tool results now keep the selected executor and the successful body text."
---

# PTC tool abort and executor config

English | [中文](guide.zh.md)

## Change

A selected `@deepseek-ai/dsh-tool-executor-ptc` applies its `maxParallelSubCalls` to nested `run_code` calls. The tools-service `maxParallelSubCalls` applies only while no executor has adopted a limit, and again after that selection unloads. The default remains 10.

A tool call admitted for a step keeps that definition. Registering a different tool with the same name during the step does not run the new body. The call returns an unknown-tool error. Calls that already started still drain, and the turn log stays ordered.

Cancellation after the body has produced a successful result keeps that result's text, appends `Error: tool call aborted`, and sets `isError` with code `ABORTED`. A call that never starts still returns only `ABORTED_BEFORE_DISPATCH`. Neither code is a reason to disable the sandbox.

`packages/bundle/web-app/presets/ptc.patch.yml` mounts `@deepseek-ai/dsh-tool-executor-ptc` instead of `@deepseek-ai/dsh-agent-tool-presentation`. Native and `both` presets keep the presentation plugin. `PtcRuntime.programFormat` defaults to `function-body`, `retainsState` is false, and `release(owner)` resolves immediately. `stateOwner` is not written to the session log.

## Migration

1. Set `maxParallelSubCalls` on the PTC executor row when the nested overlap cap must differ from `@deepseek-ai/dsh-tools`. Confirm a value of `1` runs nested bindings one at a time.
2. Treat a same-name tool registered mid-step as unavailable to calls from that step. Do not expect the new body to run.
3. Read `ABORTED` content as the successful body text plus the abort line. Keep handling `ABORTED_BEFORE_DISPATCH` as a call that did not start.
4. Point a PTC preset at `@deepseek-ai/dsh-tool-executor-ptc`. Leave native and `both` presets on `@deepseek-ai/dsh-agent-tool-presentation`.
5. Do not pass `stateOwner` expecting retained REPL or script memory. The current Node provider still starts a fresh process for each run.
