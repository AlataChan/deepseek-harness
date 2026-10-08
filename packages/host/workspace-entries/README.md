---
description: "The WorkspaceEntries capability seam: a fenced one-level directory listing behind ctx.workspaceEntries, consumed by session.listEntries."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-workspace-entries

English | [中文](README.zh.md)

## Summary

`workspace-entries` is the capability seam for the web GUI host's one-level project-file listing: the abstract `WorkspaceEntries` service (`ctx.workspaceEntries`) is the Service Definition whose only method, `list({ root, path? }, signal)`, lists one directory level inside a Host-owned project root; providers own the filesystem fence and row kinds. Official `session.listEntries` derives `root` from the named session's `cwd` and is the only Consumer. Clients never send a root, every returned row path is an absolute Host path, and a missing service fails as `session/entries-unavailable`.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Model Experience

None, as the seam serves the GUI host's file tree; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No in-app editor or preview** — clicking a file uses the existing `host.openPath` native opener.
- **One level per call** — expansion is a later `list` of that row's absolute path, still fenced to the same session `cwd`.

### Dev Note

Clients never send `root`: the Consumer derives it from the named session's `cwd`, and the provider must keep every returned row path absolute and inside the `realpath`-checked root. Row `hidden` is the POSIX dot-prefix fact while display policy stays client-side, and both error codes (`entries-unreadable`, `entries-outside-root`) are wire-visible — extend the closed set only together with the Consumer.
