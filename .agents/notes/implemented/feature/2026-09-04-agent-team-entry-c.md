# Agent Note: Shallower Agent Team header entry (option C)

Status: implemented

English | [中文](2026-09-04-agent-team-entry-c.zh.md)

## Problem

The Team collaboration map lived behind header → panel → mid-scroll content, so users could not see teammate activity without opening a dense dropdown first.

## Decision

Keep the header dropdown (option C before a right dock). Prefetch one silent `TeamView` per session for a header badge (`count` or `running/count`). Opening the panel reveals and scrolls to the collaboration map first, then roster and tasks. No polling; refresh behavior unchanged.

## Alternatives considered

- **Right dock immediately (A).** Deferred: higher layout cost; C validates shallower entry first.
- **Left-rail teammate list.** Rejected: competes with session/files.

## Consequences

- Silent prefetch adds one `view` call per session switch.
- A future right dock can reuse the same `TeamView` / interactions projection.
