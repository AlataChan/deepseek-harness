---
description: "The AskData capability seam: listing, spreadsheet import, and session bind behind ctx.askData, consumed by official session remotes."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-ask-data

English | [中文](README.zh.md)

## Summary

`ask-data` is the capability seam for the web GUI host's ask-data listing, import, and session bind: the abstract `AskData` service (`ctx.askData`) is the Service Definition, providers own the overlay store and data-agent connection book, and official session remotes consume it. `importSpreadsheet` / `importSample` write sqlite and a manifest row without opening a session; `bind({ sourceId, sessionId })` runs after the target Session exists and returns a same-process lease whose `rollback()` restores the pre-call snapshot. A missing service fails as `session/ask-data-unavailable`.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Model Experience

None, as this Service Definition owns only the capability vocabulary.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No empty-database autogenesis** — bind requires an already-imported or saved source.
- **No second connection book** — data-agent 0.1.3 owns profiles and session bindings.

### Dev Note

Import writes SQLite and a manifest row only — no preset, no session, and no `connectionRef` — so bind stays the one step that mutates session state, and `AskDataBindLease.rollback()` must restore the pre-call snapshot. `AskDataErrorCode` is the closed failure union carried in wire `details.code`, so adding a member means adding overlay copy; the `/client` outlet stays type-only.
