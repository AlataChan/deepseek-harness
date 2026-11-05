---
description: "Local Git worktrees."
kind: "package-reference"
---

# dsh-experimental-worktree

English | [中文](README.zh.md)

## Summary

`create` pins a local revision, allocates a new branch and checkout, then enters it only after checkout succeeds. Uncommitted source files and the index remain in the source checkout. `restore` recreates a missing checkout at its recorded path without changing cwd, using the existing branch or recreating a missing branch at its base commit. Hooks and configured content filters are disabled per command. No fetch, branch deletion, cleanup replay, merge or publication occurs.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount through Cordis composition; service calls retain the caller cancellation signal. The generated config catalog owns deployment settings.

Subsystem reference: [ Local Git worktrees ](../../../docs/subsystems/worktrees.md).

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
