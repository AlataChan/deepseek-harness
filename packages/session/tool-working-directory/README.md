---
description: "Working-directory tool."
kind: "package-reference"
---

# dsh-tool-working-directory

English | [中文](README.zh.md)

## Summary

The `working_directory` tool reads the current directory when `cd` is absent and validates a new directory when present. Relative paths start from the current execution directory. An Agent Session is required. The tool does not move running shells or change file permissions.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount through Cordis composition; service calls retain the caller cancellation signal. The generated config catalog owns deployment settings.

Subsystem reference: [ Working-directory tool ](../../../docs/subsystems/working-directory.md).

## Model Experience

### Execution directory and local state

#### What the model sees

`working_directory` accepts an optional `cd`; its schema and canonical result are model-visible when this tool is mounted. Working-directory changes also reach the model through the directory owner.

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
