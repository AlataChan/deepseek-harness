# Agent Note: Locale-first Agent Team roster copy

Status: implemented

English | [中文](2026-09-04-agent-team-locale-first-roster-copy.zh.md)

## Problem

Desktop users who opened the Agent Team panel still had to map English product words (`Agent Team`, `teammate`, `spawn_teammate`, `subagent`) onto two different behaviors: one-shot subagents versus durable teammates. The panel was a monitor, but its copy did not teach that distinction, so ordinary users needed an extra explanation step before they could use natural language in chat.

## Decision

Keep Team creation on chat-driven Lead tools. Change only the `@deepseek-ai/dsh-experimental-client-ui-agent-team` locale surface and panel chrome:

- Header trigger uses Chinese `团队协作`, with `Agent Team` as a secondary brand line.
- Roster rows label `主助理` / `常驻队友` (English: Lead / Teammate).
- When no teammates exist, show a short contrast between durable teammates and one-shot subagents.
- Always show a how-to line plus one natural-language example; do not surface tool names in user copy.

## Alternatives considered

- **Add a third composer mode chip.** Rejected: Team is a session capability, not a mode; mixing it with 标准模式 / 问数 / 知识库 increases confusion.
- **Add a panel button that calls `spawn_teammate`.** Rejected: creation remains Lead-owned policy; a UI shortcut would bypass the model loop and duplicate Host admission rules.
- **Rename global subagent status strings in `ui-workspace`.** Deferred: broader product copy; this change stays inside the Team overlay package.

## Consequences

- Users see Chinese-first guidance in the Team panel without changing Host tools or Remote APIs.
- English locale remains key-complete for the same teaching content.
- Official `desktop-app` product logic is untouched; only the experimental Client UI overlay changes.
