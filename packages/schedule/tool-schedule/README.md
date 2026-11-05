---
description: "Preset-scoped create, list, view and edit tools for shared Host tasks."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-schedule

English | [中文](README.zh.md)

## Summary

Preset-scoped create, list, view and edit tools for shared Host tasks.

<a id="use-this-package"></a>

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount this consumer in an Agent preset alongside the Host Schedule service. It registers exactly `schedule_create`, `schedule_list`, `schedule_view`, and `schedule_edit`; the mounting scope owns their disposal. All calls require an Agent, and delegated callers are refused before dispatch.

`schedule_create` accepts `title`, `prompt`, one typed `timing`, and an optional `target`. Timing supports the six rules documented by the [Schedule service](../schedule/README.md); target defaults to `new_once`. `schedule_list` accepts activity filtering and pagination and returns `items`, `shown`, `total`, `limit`, and `offset`. `schedule_view` reads one canonical id. `schedule_edit` accepts `action: update` with a patch, or `action: delete`; a revision token can prevent stale writes. There are no legacy update or delete tool aliases.

Tasks belong to the Host, so these tools can manage tasks created in other Sessions. The actual acting Session is passed to creation and editing as involvement metadata. The tools never set a delivery's source to user and require explicit user authorization to create or modify tasks.

<a id="understand-the-implementation"></a>

## Understand the implementation

The package resolves `ctx.schedule` when available and registers typed tool schemas through `ctx.tools`. No Host service means no tools. JSON destination ids are branded at the tool parser. `ScheduleInputError` becomes a stable `{ code, message }`; other exceptions become `internal_error` without exposing storage details. The Host owns timer, storage, restart and delivery behavior.

<a id="model-experience"></a>

<a id="further-exploration"></a>

## Further Exploration

- [Schedule subsystem](../../../docs/subsystems/schedule.md).

## Model Experience

### Task tools and delivery

#### What the model sees

A visible tool contributes its fixed schema prefix. Each result is one lossless JSON text block containing the committed task, paged list, deletion, conflict or error. Results append to Session history until compaction; their token cost follows content and page size, preserving the earlier reusable prefix. Due input uses the existing scheduled-reminder framing and source kind `schedule`.

#### Token effect

Catalog reads issue no model request. Tool results and deliveries cost their actual rendered text.

#### KV Cache effect

Logged results append to history; changed tool registrations may invalidate the schema prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The Host must be running. Delivery may repeat across a crash; deleting a task never retracts queued input. History retention cannot reconstruct missing earlier receipts or establish model execution completion.

### Dev Note

<a id="dev-note"></a>

None.
