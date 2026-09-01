# @deepseek-ai/dsh-host-ask-data

English | [中文](README.zh.md)

The web GUI host's ask-data listing, import, and session bind is a capability seam. The abstract `AskData` service (`ctx.askData`) is its Service Definition. Providers implement the overlay store and the data-agent connection book. The Consumer is official `session.listAskDataSources` / `importAskDataSpreadsheet` / `importAskDataSample` / `commitAskData` / `askDataBinding`: it only calls these methods and maps `AskDataError` onto the wire. An absent service fails as `session/ask-data-unavailable`.

Client aggregates import `@deepseek-ai/dsh-host-ask-data/client` for the `askDataBinding` projection merge; that outlet re-exports `./types` and does not load the Host `AskData` service.

`listSources` returns overlay-managed rows plus unmatched data-agent connections. `importSpreadsheet` / `importSample` write sqlite and a manifest row only; they do not apply a preset or open a session, and `connectionRef` stays absent. `bind({ sourceId, sessionId })` runs after the target Session exists and returns a same-process `AskDataBindLease` whose `rollback()` restores the pre-call snapshot. `ask-data/bound` is merged into `SessionEventMap` here (no `@mode`); the `askDataBinding` projection is registered by the Provider.

The octopus_DSH desktop entry is the experimental Provider plus Client occupant (`@deepseek-ai/dsh-experimental-desktop-ask-data`). Official web compositions omit that package, so `conversation.hero.askData` and `conversation.askData.gate` stay empty.

## Model Experience

None, as this Service Definition owns only the capability vocabulary.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No empty-database autogenesis** — bind requires an already-imported or saved source.
- **No second connection book** — data-agent 0.1.3 owns profiles and session bindings.
