# Agent Note: Inactive Team roster must not invent the Lead model

Status: implemented

English | [中文](2026-09-04-agent-team-inactive-roster-model.zh.md)

## Problem

`TeamRoster.list` resolved an inactive teammate's `model` as `live?.options.model ?? root.options.model`. After the child Activation drained, the UI and a later `list_agents` call showed the Lead model even when `spawn_teammate` had selected a different child route. The Lead's tool reply (taken while the child was still live, or from the spawn result) disagreed with the Team panel.

## Decision

Resolve teammate models in this order: live Agent options, durable `TeamMemberSnapshot.model`, continuable descriptor `agentModel`, child session request context/header. Persist `model` on the active `team/member` snapshot at spawn settlement. Use the Lead model only for `context: 'fork'` children that never declared their own route.

## Alternatives considered

- **Leave the Lead fallback and teach users to ignore the panel.** Rejected: the panel is the user-facing roster authority next to `list_agents`.
- **Bump `team/member` event version solely for the field.** Rejected: optional additive `model` on version 2 is enough; old snapshots without `model` still recover from descriptor/session when present.

## Consequences

- Inactive roster rows keep the child route after drain and across Host restarts when the active snapshot recorded `model`.
- Fork teammates without an explicit route still display the Lead model.
- Existing Teams that never wrote `model` and no longer have the child Session loaded may omit `model` until the next spawn or resume refreshes the snapshot.
