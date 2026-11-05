---
kind: upgrade-guide
description: Schedule storage writes version 2 after mutation and older exact-version readers cannot reopen it.
---

# Schedule storage compatibility

English | [中文](guide.zh.md)

## Change

The Schedule domain reads released version-1 units through `compatibleVersions: [1]` and writes version 2 on the next mutation. Older exact-version readers reject version-2 units. Opening and closing an old JSON file does not rewrite it. Session log generations, the historical `schedule/change` event and the global SQLite schema remain unchanged.

Read normalization converts `sessionId` to a session target and `inactive` to ended. It preserves historical receipts and fills missing receipt destinations only from an existing or reserved target. Current rows also hold revisions, involved Session ids and pending delivery reservations. See [task management](../schedule-tasks/guide.md) for the tool and remote API migration.

A pending delivery and its reserved target Session id are saved in the same task row before Session creation. Recovery adopts that id. The reservation, Session inbox append and task receipt remain separate writes, so a crash can repeat message delivery.

## Migration

1. Back up the Schedule storage before the first edit or delivery with this version. Retain the matching older runtime if rollback may be needed; do not open mutated version-2 units with it.
2. Confirm existing tasks appear with session targets and ended tasks retain their history. Leave storage files unopened by external writers during runtime use.
3. Make one intended task edit, restart, and confirm the edit and history survive. For delivery recovery, confirm a reserved target is reused; do not assume that this prevents duplicate messages.
4. If rollback is necessary, stop the newer runtime and restore the pre-mutation backup before starting the older runtime.
