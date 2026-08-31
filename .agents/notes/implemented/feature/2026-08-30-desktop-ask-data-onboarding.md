# Agent Note: octopus_DSH 问数启动（先有数据，再有会话）

Status: implemented

English | [中文](2026-08-30-desktop-ask-data-onboarding.zh.md)

## Problem

octopus_DSH users who want to ask a spreadsheet currently open a blank「数据模式」session, then type a SQLite path in the data-agent workbench. Ordinary users have Excel or CSV, not a database path. A blank data-agent session that can `prompt` before any bind also lets the model talk as if a table were already connected.

## Decision

The official Service Definition is `@deepseek-ai/dsh-host-ask-data` (`ctx.askData`: `listSources` / `importSpreadsheet` / `importSample` / `bind`). The fork overlay `@deepseek-ai/dsh-experimental-desktop-ask-data` is the only Provider and the Client occupant of `conversation.hero.askData` and `conversation.askData.gate`. Official `desktop-app` composition and the default `standard` assistant stay unchanged. 「问数」is a new-session chip.

The path is data first: pick or import a source (sample first), then `commitAskData` creates or reuses a session already bound to that source. `session-controller` is Consumer only and never imports overlay internals. data-agent 0.1.3 remains the only connection book. Overlay bind calls `ctx.dataAgentConnections.connect` / `resolveForExecution` (Task 0 `adapter: api`). `connectionRef` is the data-agent profile id.

Hard limits live in one `limits.ts` module and appear on the data-source page, beside upload, on preview, on failure recovery, and in a dynamic system-prompt section. Sample files are ASCII `sample-sales.xlsx` / `.csv` / `.sqlite`. Missing host `sqlite3` disables upload only; `importSample` copies the prebuilt sqlite. Querying that file still needs data-agent's `sqlite3` CLI (Task 0 `sqlite3-free sample: BLOCKED` at the query layer).

Unbound data-agent sessions reject `prompt` as `session/ask-data-unbound`. After bind, `select` away from `data-agent` is `session/ask-data-bound`. A pin list that still names `dsh-context` fails `verify-desktop-bundle.sh`; leftover user profiles are not rewritten.

## Alternatives considered

**Change official `desktop-app` or the default assistant.** Rejected: the fork rule keeps course and desktop extras off official composition.

**Vendor data-agent or invent a second connection store.** Rejected: 0.1.3 already owns profiles and session bindings. Task 0 found a documented Host API.

**Create an empty SQLite when the user clicks 问数.** Rejected: the first success path is a filled sample table, not a DBA empty database.

**Send spreadsheet bytes to the model.** Rejected: import stays on the Host; the log must not carry file bytes.

## Consequences

A new desktop profile with this overlay can open 问数, use the sample, preview, commit, and query the sample table without typing a path. Upload of the clean sample CSV has zero warnings. Write tools fail on the committed connection. Official web without the overlay stays empty at the ask-data holes.

data-agent 0.1.3 SQLite queries require a resolvable `sqlite3` CLI. Existing user profiles that still list `dsh-context` fail companion boot; the window must show that failure. Dirty-excel heuristics will miss some sheets; warnings plus sample recovery are the accepted mitigation.

Assembled first-ask is `packages/experimental/desktop-ask-data/tests/first-ask.host.spec.ts` against real 0.1.3. Recorded-session snapshots under `snapshots/session/ask-data-sample/` and `snapshots/web/ask-data-onboarding/` are still required by the testing policy when this surface ships in a recorded corpus.
