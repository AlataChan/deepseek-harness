---
description: "Local review composition."
kind: "package-bundle"
---

# dsh-experimental-worktree-review

English | [中文](README.zh.md)

## Summary

This opt-in desktop profile bundle mounts the local worktree service, create tool and single Changes tab. Its Client marker depends on the actual local review Client owner; it does not apply a second UI. Official desktop-app and web-app packages have no dependency on this experimental composition.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount through Cordis composition; service calls retain the caller cancellation signal. The generated config catalog owns deployment settings.

Subsystem reference: [ Local review composition ](../../../docs/subsystems/worktrees.md).

Desktop ships this bundle disabled. Open the sidebar **Plugins** page, select `@deepseek-ai/dsh-experimental-worktree-review`, and enable the bundle; follow any restart notice from the manager. The conversation header then opens **Changes**. Opening the tab creates no checkout; the explicit request waits for the next task message.

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
