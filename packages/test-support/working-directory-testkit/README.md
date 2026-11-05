---
description: "Explicitly mount the real directory owner in execution-consumer tests."
kind: "package-library"
---

# dsh-working-directory-testkit

English | [中文](README.zh.md)

## Summary

`mountDirectoryFixture(ctx, defaultDirectory)` preserves the caller filesystem and mounts real directory prerequisites only when absent. The caller owns Context and temporary-directory cleanup. It changes neither generic AgentLoop fixtures nor product composition.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Model Experience

Indirectly, through the working-directory service and its execution consumers.

#### KV Cache effect

The composed owners determine request tokens and cache effects; this package makes no auxiliary model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- An existing test filesystem must support directory inspection. Callers supply actual Sessions and lifetimes rather than inert directory callbacks.

### Dev Note

<a id="dev-note"></a>

None.
