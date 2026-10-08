---
description: "octopus_DSH desktop file-tree overlay: a fenced one-level directory listing behind ctx.workspaceEntries plus the sidebar.files Client occupant."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-desktop-files

English | [中文](README.zh.md)

## Summary

`desktop-files` is the private desktop overlay for the session `cwd` file tree: the Host half implements `ctx.workspaceEntries` with a fully-qualified, lexical, and `realpath` fence, and the Client half occupies `sidebar.files`. File clicks open through `session.openWorkspacePath`; there is no in-app editor, Git, or terminal surface. The desktop profile seed installs it; official `dsh-desktop-app` and `PROFILE_TEMPLATES.desktop` do not name it, and official web instead leaves `sidebar.files` empty.

## Table of Contents

- [Config](#config)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="config"></a>
## Config

```yaml
- id: desktop-files
  name: '@deepseek-ai/dsh-experimental-desktop-files'
  config:
    maxEntries: 1000
```

`cordis.patch.yml` inserts this Host row and restates `connection-desktop` so that row also injects `sessionController`. Handshake then waits until the Session control stream has a live service; otherwise the companion exits on the first `session/control` open and the window reconnects forever. The Client half is discovered from `dsh.client` after the Host fiber is live.

## Model Experience

None, as the overlay serves the GUI file tree; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No in-app editor or preview** — a file click uses the system default application.
- **No Git, terminal, or float windows** — v1 is the session-cwd tree only.

### Dev Note

The fence is three checks in one — fully-qualified paths, lexical containment, and `realpath` containment — and a directory symlink that leaves the root must fail as `entries-outside-root` instead of listing the outside tree. `cordis.patch.yml` also restates the `connection-desktop` row to inject `sessionController`; dropping that restatement makes the companion exit on the first `session/control` open and the window reconnect forever.
