# Agent Note: Ask-data shows one start control after a pick

Status: implemented

English | [中文](2026-08-31-desktop-ask-data-single-start.zh.md)

## Problem

The 问数 page painted 「开始提问」 on every listed source. Two used sources produced two identical primary controls. Clicking one bound the current Session; the other then failed or looked like a trip back to the hero.

## Decision

Listed rows are selectable only. 「开始提问」 is a single page-level control and is hidden until the user picks a non-missing row or imports (sample or upload). That control commits the selected source. Preview lists tables and warnings and does not carry its own start. List splitting stays in [duplicate-start](2026-08-30-desktop-ask-data-duplicate-start.md). Bind reuse stays in [rebind](2026-08-31-desktop-ask-data-rebind-session.md).

## Alternatives considered

**Keep one start button per row.** Rejected: the page title is 选一份要问的数据; identical start controls on every row are the reported interaction.

**Auto-select the most recent row and show start immediately.** Rejected: start must follow an explicit pick or import so the button is bound to that file.

## Consequences

An unpicked list shows the pick hint and no start control. Coverage is `tests/data-source-page.client.spec.tsx`.
