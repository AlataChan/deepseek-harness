---
description: "The AskData capability seam: listing, spreadsheet import, and session bind behind ctx.askData, consumed by official session remotes."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-ask-data

English | [中文](README.zh.md)

## Summary

`ask-data` is the capability seam for the web GUI host's ask-data listing, import, and session bind: the abstract `AskData` service is the Service Definition, providers own the overlay store and data-agent connection book, and official session remotes consume it. A missing service fails as `session/ask-data-unavailable`.

The web GUI host's ask-data listing, import, and session bind is a capability seam. The abstract `AskData` service (`ctx.askData`) is its Service Definition. Providers implement the overlay store and the data-agent connection book. The Consumer is official `session.listAskDataSources` / `importAskDataSpreadsheet` / `importAskDataSample` / `commitAskData` / `askDataBinding`: it only calls these methods and maps `AskDataError` onto the wire. An absent service fails as `session/ask-data-unavailable`.

Client aggregates import `@deepseek-ai/dsh-host-ask-data/client` for the `askDataBinding` projection merge and for `AskDataErrorCode`, the closed failure-code union the wire carries in `details.code` and every operator surface needs to pick copy; that outlet re-exports `./types` and does not load the Host `AskData` service.

`listSources` returns overlay-managed rows plus unmatched data-agent connections. `importSpreadsheet` / `importSample` write sqlite and a manifest row only; they do not apply a preset or open a session, and `connectionRef` stays absent. `bind({ sourceId, sessionId })` runs after the target Session exists and returns a same-process `AskDataBindLease` whose `rollback()` restores the pre-call snapshot. `ask-data/bound` is merged into `SessionEventMap` here (no `@mode`); the `askDataBinding` projection is registered by the Provider.

The octopus_DSH desktop entry is the experimental Provider plus Client occupant (`@deepseek-ai/dsh-experimental-desktop-ask-data`). Official web compositions omit that package, so `conversation.hero.askData` and `conversation.askData.gate` stay empty.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="model-experience"></a>
## Model Experience

None, as this Service Definition owns only the capability vocabulary.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **No empty-database autogenesis** — bind requires an already-imported or saved source.
- **No second connection book** — data-agent 0.1.3 owns profiles and session bindings.

<a id="dev-note"></a>
## Dev Note

Import writes SQLite and a manifest row only — no preset, no session, and no `connectionRef` — so bind stays the one step that mutates session state, and `AskDataBindLease.rollback()` must restore the pre-call snapshot. `AskDataErrorCode` is the closed failure union carried in wire `details.code`, so adding a member means adding overlay copy; the `/client` outlet stays type-only.
