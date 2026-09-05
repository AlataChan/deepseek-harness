# Agent Note: Agent Team right collaboration dock

Status: implemented

English | [中文](2026-09-04-agent-team-collaboration-dock.zh.md)

## Problem

Option C’s header badge was too shallow for reading collaboration while a permanent third column would squeeze chat.

## Decision

Present live Team topology in a Client-only right overlay dock (default ~40vw, drag 280px–55vw, pin, Esc). Keep the same `TeamView` / `interactions` projection. Migrate roster/tasks/starters into a collapsible dock bottom.

## Alternatives considered

- **True split pane in `ui-conversation`.** Deferred: higher layout-contract cost.
- **Keep the dropdown panel only.** Rejected: map too small to read.

## Verification

```bash
pnpm exec vitest run packages/experimental/client-ui-agent-team/tests/
```
