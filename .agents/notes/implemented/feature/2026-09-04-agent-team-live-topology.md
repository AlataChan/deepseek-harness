# Agent Note: Team panel live collaboration topology

Status: implemented

English | [中文](2026-09-04-agent-team-live-topology.zh.md)

## Problem

The agreed Agent Team layering needed a spatial view of who is running, pending peer messages, and task dependencies. Deferring that view left only the roster/task CAS panel and created product inconsistency with the documented health split (chat / panel / live map / Archify).

## Decision

Extend the existing `agentTeams.view` `TeamView` with thin `interactions` edges (pending mailbox hops and owner-to-owner task dependencies; no message bodies). Render a collapsible fixed-layout map inside the Team panel from that same load/refresh path. Default on while the panel is open; sessionStorage can hide it; no polling and no second Host API.

## Alternatives considered

- **Separate Host topology remote.** Rejected: duplicates projection authority.
- **Force-directed / continuous animation.** Rejected: cost and spectacle without more truth.
- **Client-only edges without Host enrichment.** Rejected for message hops: pending mailbox lives only in the Team journal.

## Consequences

- Delivered messages leave the pending queue and therefore leave the live map; Archify remains the post-hoc narrative layer.
- True push updates still wait on Client projection streaming; until then the map advances whenever the panel refreshes (open, manual refresh, task mutation).
