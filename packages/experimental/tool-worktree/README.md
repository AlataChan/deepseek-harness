---
description: "Create-worktree tool."
kind: "package-reference"
---

# dsh-experimental-tool-worktree

English | [中文](README.zh.md)

## Summary

`create_worktree` invokes the shared local worktree service. `name` chooses a new branch and checkout name; omission generates a unique name. `from` selects a local commit, branch or tag and defaults to HEAD. Existing names fail. The checkout and branch remain after leaving it.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount through Cordis composition; service calls retain the caller cancellation signal. The generated config catalog owns deployment settings.

Subsystem reference: [ Create-worktree tool ](../../../docs/subsystems/worktrees.md).

## Model Experience

### Execution directory and local state

#### What the model sees

`create_worktree` accepts a checkout name and optional base revision; its schema and canonical result are model-visible when this tool is mounted. Working-directory changes also reach the model through the directory owner.

#### Token effect

Tool calls, directory notices and required directory context add text as used; no auxiliary model request is made.

#### KV Cache effect

Stable directory text can reuse an existing prefix. Directory changes replace runtime-context text and append notices; provider cache availability remains outside this package.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A failed checkout may retain its branch or directory; inspect retained artifacts before retrying with a new name. Restoration recovers committed content only.

### Dev Note

<a id="dev-note"></a>

None.
