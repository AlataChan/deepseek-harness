---
description: "Local Changes tab."
kind: "package-reference"
---

# dsh-experimental-client-ui-forge

English | [中文](README.zh.md)

## Summary

One `worktree-review` sidebar tab displays local Git diffs and worktree request, cancellation, retry, restoration and return controls. A request is consumed before the first model step; opening the tab alone creates nothing. Failed held creation waits for retry or withdrawal. Local inspection uses the Session sandbox and bounded outputs, never external diff helpers or a code-host API. Required worktree records and the original directory survive cold reopening.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount through Cordis composition; service calls retain the caller cancellation signal. The generated config catalog owns deployment settings.

Subsystem reference: [ Local Changes tab ](../../../docs/subsystems/worktrees.md).

## Model Experience

Indirectly, through the working-directory service and its execution consumers.

#### KV Cache effect

The composed owners determine request tokens and cache effects; this package makes no auxiliary model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A failed checkout may retain its branch or directory; inspect retained artifacts before retrying with a new name. Restoration recovers committed content only.

### Dev Note

<a id="dev-note"></a>

None.
