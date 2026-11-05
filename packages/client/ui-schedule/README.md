---
description: "One Automation Tasks page with manual creation, editing, execution and saved history."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-schedule

English | [中文](README.zh.md)

## Summary

One Automation Tasks page with manual creation, editing, execution and saved history.

<a id="use-this-package"></a>

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

The single Automation tasks / 自动化任务 sidebar entry opens a Host-wide catalog. New starts a conversation; Create manually opens a form in the existing detail pane. Manual creation accepts all six timing kinds and existing-session, create-once, or fresh-session targets. Search and All, Enabled, Paused and Ended filters operate on the retained catalog.

A selected task has Rules and Records tabs. Rules edits its name, instruction, timing and destination through revision-checked `edit`. Run now uses `run`; Pause/Resume edits activity; Clear ended tasks uses `deleteInactive`. Ended name and instruction remain read-only in this detail. The linked Session control uses current Session/Workspace metadata before opening a destination. The header catalog and ambient Session marks interpret the catalog target; they do not assume every task has an original Session.

The page, right Sidebar task tab, transcript cards and ambient marks keep their existing contributions. This package registers only English and Chinese dictionaries. It neither creates a second scheduler nor adds a second Automation Tasks panel.

<a id="understand-the-implementation"></a>

## Understand the implementation

Catalog subscriptions exist only while observed. A `schedule/changed` notice or connection reset supersedes the read in flight; clear-ended readback also supersedes older responses. Mutation failures retain the visible draft and expose a retry path. Records lazily request twenty saved receipts per page by task id, without activating a Session; changing tasks retires late responses. Saved deliveries describe inbox acceptance, not model completion.

<a id="model-experience"></a>

<a id="further-exploration"></a>

## Further Exploration

- [Schedule subsystem](../../../docs/subsystems/schedule.md).

## Model Experience

None, as this browser UI delegates model-visible tools and delivery to the Schedule owners.

#### KV Cache effect

The composed owners determine request tokens and cache effects; this package makes no auxiliary model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The Host must be running. Delivery may repeat across a crash; deleting a task never retracts queued input. History retention cannot reconstruct missing earlier receipts or establish model execution completion.

### Dev Note

<a id="dev-note"></a>

None.
