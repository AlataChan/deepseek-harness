---
description: "Session execution directories."
kind: "package-reference"
---

# dsh-working-directory

English | [中文](README.zh.md)

## Summary

The immutable Session header retains the original project. `get(session)` reads the effective directory; `ensure(agent, signal)` validates it and returns to the original project if it disappeared; `set(agent, path, signal)` validates and commits a directory change. Calls serialize per Session, cancellation before append commits nothing, and disposal aborts and drains operations. `defaultDirectory` must be absolute and is used only when the header has no directory. Existing processes keep their cwd and sandbox authority stays on the original project.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount through Cordis composition; service calls retain the caller cancellation signal. The generated config catalog owns deployment settings.

Subsystem reference: [ Session execution directories ](../../../docs/subsystems/working-directory.md).

## Model Experience

### Execution directory and local state

#### What the model sees

The required literal context is `Current working directory: {JSON-quoted cwd}.` A committed switch queues a user notice with source `working-directory`; directory text remains present when optional runtime context is disabled.

#### Token effect

Tool calls, directory notices and required directory context add text as used; no auxiliary model request is made.

#### KV Cache effect

Stable directory text can reuse an existing prefix. Directory changes replace runtime-context text and append notices; provider cache availability remains outside this package.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Changing cwd does not update existing process directories or grant new sandbox rights. A missing original project causes ensure to fail until an existing directory is explicitly selected.

### Dev Note

<a id="dev-note"></a>

None.
