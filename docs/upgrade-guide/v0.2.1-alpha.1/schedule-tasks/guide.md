---
kind: upgrade-guide
description: Schedule tools and remotes now manage Host-wide tasks through typed timing, explicit targets and revision-checked edits.
---

# Schedule task management

English | [中文](guide.zh.md)

## Change

Schedule tasks use the same Host service and Automation tasks panel, with manual creation, editing, immediate run and clearing ended tasks. The model tools are `schedule_create`, `schedule_list`, `schedule_view` and `schedule_edit`. The old `schedule_update` and `schedule_delete` tools and remotes are removed; historical transcript results still render.

Create accepts `{title, prompt, timing, target?}`. The six timing kinds remain `after`, `at`, `every`, `daily`, `weekly` and `cron`. Targets are `session`, `new_once` and `new`; omitting the target now creates one Session at first delivery and reuses it. List returns a page containing `items`, `shown`, `total`, `limit` and `offset`. History is addressed by task id, without a Session binding.

The schedule storage domain writes version 2 and reads version 1 in memory without rewriting on open. The next task mutation writes current fields. JSON whole-unit storage admits explicitly declared compatible versions and stamps the current version on its next successful mutation. No Session log generation or global SQLite schema changes. Delivery remains at least once: a reserved target prevents duplicate Session creation after restart, but a crash can repeat inbox delivery.

## Migration

1. Replace create's top-level selectors with `timing`, for example `{kind: 'after', after_seconds: 60}`. Supply `target: {kind: 'session', sessionId}` to continue delivering into an existing Session; omission intentionally changes the destination.
2. Read `list(...).items` and use `view({id})` for a single task. Replace updates with `edit({id, action: 'update', patch, expectedUpdatedAt})`; replace deletion with `edit({id, action: 'delete', expectedUpdatedAt})`. Pass the last read `updatedAt`, or `null` for an older row without one, to detect conflicts.
3. Update preset tool filters to the four current tool names. In-process Agent consumers pass the actual acting Session to `create` and `edit`; human remotes do not supply one. Remove Session ids from history requests.
4. Retain a backup before the first mutation. Verify older tasks appear with session targets, creation without a target uses `new_once`, stale edits return `schedule_conflict`, and a restarted reserved delivery reuses its Session. Newer task rows cannot be opened by the older exact-version scheduler.
