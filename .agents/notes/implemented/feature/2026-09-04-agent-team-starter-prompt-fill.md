# Agent Note: Team panel starter-prompt fill buttons

Status: implemented

English | [中文](2026-09-04-agent-team-starter-prompt-fill.zh.md)

## Problem

Users could start Agent Team only by inventing natural-language prompts. The panel showed a static example line that did not enter the composer, so first-time users still needed an extra explanation step.

## Decision

Add three locale-owned starter templates in `@deepseek-ai/dsh-experimental-client-ui-agent-team`. Each panel button calls session-standard `inputActions.setDraft(text)` and closes the panel. Nothing is submitted automatically; Lead tools remain the creation path.

## Alternatives considered

- **Add a third composer mode chip.** Rejected earlier: Team is a session capability, not a mode.
- **Panel button that calls `spawn_teammate` directly.** Rejected: creation stays Lead-owned.
- **Register a `/team` slash command.** Deferred: fill buttons cover the immediate discoverability gap with less surface area.

## Consequences

- Chinese-first labels remain locale-owned; English keys stay complete.
- When `inputActions` is absent (no current session), the fill buttons stay disabled.
