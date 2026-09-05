# Agent Note: Agent Team dock live soft-refresh and durable message edges

Status: implemented

English | [中文](2026-09-04-agent-team-dock-live-refresh.zh.md)

## Problem

Manual refresh made the dock feel dead, and message edges disappeared as soon as hops were delivered.

## Decision

While the Team dock is open, soft-refresh `TeamView` about every 1.5s (silent); stop when closed. Project message edges for both pending and delivered mailbox hops (still body-free).

## Alternatives considered

- **Session-event push without interval.** Deferred until this panel is wired to streaming projections.
- **Keep pending-only edges.** Rejected: users usually saw nodes with no lines.

## Verification

```bash
pnpm exec vitest run packages/experimental/agent-team/tests/interactions.spec.ts packages/experimental/client-ui-agent-team/tests/
```
