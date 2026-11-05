# Host-wide Schedule

English | [中文](schedule.zh.md)

Schedule stores tasks independently of Session activation and delivers them to existing or newly created Sessions. This page records the durable and model-facing types from [`types.ts`](../../packages/schedule/schedule/src/types.ts); the [package README](../../packages/schedule/schedule/README.md) owns composition and reminder framing.

## Durable records

`ScheduleId` is a globally unique [branded id](core.md#branded-ids). The version-2 `schedule` domain stores each `ScheduleRecord` with its target, involved Session ids, active/paused/ended status and optional latest receipt, revision and pending delivery reservation. It declares `compatibleVersions: [1]`; a v1 row's `sessionId` becomes a session target and `inactive` becomes ended only in memory. Open performs no rewrite; the next mutation writes current fields and stamps v2. Records lacking status normalize to `active` without scanning or recreating historical Sessions. Creation canonicalizes the target into RFC 3339 UTC `scheduledAt`; `after` retains the submitted delay, `every` retains its fixed interval, `daily` and `weekly` retain normalized local `time` and their explicit `timeZone`, and `cron` retains its canonical five-field `expression` and explicit `timeZone`. Daily, weekly, and cron decoding preserve the committed instant and stored zone spelling. The stored task record declares a required `title`, the short name the task surfaces show; creation requires it and never derives it from the instruction. No stored record may omit its title: a record whose `title` is missing, blank after trimming, untrimmed, or longer than 120 characters fails durable decoding with `ScheduleLogError`, and the schedule domain declares no backup-and-skip policy, so one such stored task rejects the whole domain open instead of being dropped. Only explicit deletion removes a task; previously physically deleted tasks are not restored or fabricated.

```ts type-equiv
/** Durable one-shot reminder created from a positive delay. */
interface AfterScheduleRecord {
  /** Globally unique task identity. */
  readonly id: ScheduleId
  /** Rule discriminator for a delayed one-shot reminder. */
  readonly kind: 'after'
  /** Required stored task name; already trimmed, non-empty, and at most 120 characters. */
  readonly title: string
  /** Trimmed reminder content supplied at creation. */
  readonly prompt: string
  /** Positive safe-integer delay accepted at creation. */
  readonly afterSeconds: number
  /** Four-digit-year RFC 3339 UTC target. */
  readonly scheduledAt: string
}
```

```ts type-equiv
/** Durable one-shot reminder created from an absolute instant. */
interface AtScheduleRecord {
  /** Globally unique task identity. */
  readonly id: ScheduleId
  /** Rule discriminator for an absolute one-shot reminder. */
  readonly kind: 'at'
  /** Required stored task name; already trimmed, non-empty, and at most 120 characters. */
  readonly title: string
  /** Trimmed reminder content supplied at creation. */
  readonly prompt: string
  /** Four-digit-year RFC 3339 UTC target. */
  readonly scheduledAt: string
}
```

```ts type-equiv
/** Durable fixed-rate reminder aligned to creation or its most recent interval edit. */
interface EveryScheduleRecord {
  /** Globally unique task identity. */
  readonly id: ScheduleId
  /** Rule discriminator for a fixed-rate recurring reminder. */
  readonly kind: 'every'
  /** Required stored task name; already trimmed, non-empty, and at most 120 characters. */
  readonly title: string
  /** Trimmed reminder content supplied at creation. */
  readonly prompt: string
  /** Fixed safe-integer interval, never below one minute. */
  readonly everySeconds: number
  /** Next anchor-aligned occurrence while active, or final occurrence when inactive. */
  readonly scheduledAt: string
}
```

```ts type-equiv
/** Durable daily wall-clock reminder; gaps skip a date and overlaps use the earlier instant. */
interface DailyScheduleRecord {
  /** Globally unique task identity. */
  readonly id: ScheduleId
  /** Rule discriminator for a daily wall-clock reminder. */
  readonly kind: 'daily'
  /** Required stored task name; already trimmed, non-empty, and at most 120 characters. */
  readonly title: string
  /** Trimmed reminder content supplied at creation. */
  readonly prompt: string
  /** Local time normalized to HH:mm:ss.SSS. */
  readonly time: string
  /** Explicit IANA zone; equivalent timing edits retain the stored spelling. */
  readonly timeZone: string
  /** Committed next UTC instant while active, or final occurrence when inactive. */
  readonly scheduledAt: string
}
```

```ts type-equiv
/** One-shot task variants. */
type OneShotScheduleRecord = AfterScheduleRecord | AtScheduleRecord
```

```ts type-equiv
/** Recurring Host task variants. */
type RecurringScheduleRecord = EveryScheduleRecord | DailyScheduleRecord | WeeklyScheduleRecord | CronScheduleRecord
```

```ts type-equiv
/** Reminder rule and target, stored with its original Session binding. */
type ScheduleRecord = OneShotScheduleRecord | RecurringScheduleRecord
```

## Absolute-time input

The `at` selector is either a strict offset-bearing RFC 3339 string or an exact local-calendar object. The local form keeps its interpretation explicit at the tool boundary:

```ts type-equiv
/** Structured local-calendar input accepted by creation and timing edits. */
interface LocalAtInput {
  /** Four-digit ISO calendar date. */
  readonly date: string
  /** Local wall-clock time with optional one-to-three digit milliseconds. */
  readonly time: string
  /** Explicit UTC or IANA Area/Location zone. */
  readonly time_zone: string
}
```

```ts type-equiv
/** Absolute selector accepted by creation and timing edits. */
type AtInput = string | LocalAtInput
```

The shipped Web composition mounts the `schedule` service and the `ui-schedule` task page. The clock reading and the four reminder tools are preset-owned: `standard`, `cordis`, and `ptc` declare `time-context` and `@deepseek-ai/dsh-tool-schedule` together, and `minimal` declares neither. The `tool-subagent` and `tool-subagent-fork` rows in those three presets deny the four tools, and each tool refuses a delegated caller with `subagent_session`, so a delegated child neither sees the tools nor has a call accepted. Time-context tells the model to interpret otherwise-unqualified natural-language dates and times in that request-local zone when the open turn has one unambiguous browser zone; mixed or missing browser-zone records tell the model to ask. That guidance is not a durable Session default: the model must still pass an offset in the string form or `time_zone` in the local form, and Schedule never reads browser, Session, process, or model context.

Schedule rejects invalid offsets and zones, offset-free strings, non-future targets, and local times inside daylight-saving gaps. A daylight-saving overlap chooses its first, earlier instant. Successful creation stores only canonical UTC `scheduledAt`, so replay never depends on ambient time-zone state.

<a id="daily-wall-clock-input"></a>
## Daily wall-clock input

`daily` is one of the six timing kinds accepted inside create or edit. Its `daily` selector is mutually exclusive with the other timing selectors. For example, `daily: { time: '23:00:00', time_zone: 'Asia/Shanghai' }` selects 23:00 in that zone on each eligible local date. The exact object has no date, offset, or interval field:

```ts type-equiv
/** Daily local-time selector accepted by creation and timing edits. */
interface DailyInput {
  /** Local HH:mm:ss time with optional one-to-three fractional digits. */
  readonly time: string
  /** Explicit UTC or IANA Area/Location zone. */
  readonly time_zone: string
}
```

Creation requires `HH:mm:ss` with optional one-to-three fractional digits, rejects leap seconds and `24:00`, canonicalizes the explicit IANA zone, and stores `time` as `HH:mm:ss.SSS`. The first `scheduledAt` is strictly after creation time. A nonexistent local time or entire date is skipped; an overlap selects the earlier instant once per local date. If that earlier instant has passed, the later duplicate is not eligible. Only UTC target years 0001–9999 are constrained; local dates at the UTC range edges may fall in year 0 or 10000.

A saved next target is a committed UTC instant. The Host decoder and restart preserve that instant without resolving it against time-zone rules again, and valid stored zone aliases remain readable when canonical names change. Subsequent targets use the Host's current IANA data. The next target must be both after the delivery decision and on a local date later than the selected occurrence's date. Creation fails with `time_out_of_range` when no future UTC target is representable.

## Fixed-rate input and catch-up

`every_seconds` is a safe-integer interval of at least 60 seconds, aligned to creation time. It measures elapsed time, not daily wall-clock time: `every_seconds: 86400` cannot substitute for `daily` across offset changes. The protocol provides no shared cooldown or cross-record admission rule; the cron selector described below is wall-clock timing, not a fixed-rate interval.

When the Host starts with an overdue Every, Daily, Weekly, or Cron record, it sends only the latest due occurrence. Every advances to the first target aligned to its current interval anchor after the delivery decision; Daily, Weekly, and Cron follow the local-date rules above and below. Missed occurrences do not accumulate. If no next UTC target is representable, delivery retains the record as ended with its latest receipt.

One-shots produce individual follow-ups. Recurring records due in the same scan for the same Session share one follow-up rendered by `renderRecurringReminderBatchFraming`, with one latest occurrence per record. The one-minute minimum applies only to fixed-rate intervals; delivery does not wait for the target Agent to become idle.

<a id="cron-wall-clock-input"></a>
## Cron wall-clock input

`cron` is one of the mutually exclusive creation selectors. Its exact object carries only the strict five-field Vixie expression `minute hour day-of-month month day-of-week` and an explicit IANA zone, for example `cron: { expression: '*/15 9-17 * * 1-5', time_zone: 'Asia/Shanghai' }`. The field bounds are:

| Field | Accepted range | Notes |
|---|---|---|
| minute | 0-59 | |
| hour | 0-23 | |
| day-of-month | 1-31 | |
| month | 1-12 | |
| day-of-week | 0-7 | Both `0` and `7` mean Sunday. |

Every field accepts `*`, a single value, an `a-b` range, a `*/n` or `a-b/n` step with `n >= 1`, and a comma-separated list of those forms. Everything else is rejected with `invalid_rule` and a message naming the offending field: `L`, `W`, and `#` operators, `JAN`/`MON` names, `@daily`-style macros, six-field expressions with a seconds field, out-of-range values, inverted ranges, zero steps, and empty fields. Because the dialect has five fields, the smallest interval is one minute; sub-minute scheduling stays unsupported.

Creation canonicalizes the expression before storing it. Canonicalization expands each field into its matched value set and re-encodes that set deterministically: repeated values collapse, adjacent values and ranges merge, a uniform step is written as `a-b/n` or, for a field that started with `*`, as a star-step (`*` for every value, otherwise the widest star-step walk plus any remaining values), a step of `1` is dropped, and Sunday is written as `0`. A field that did not start with `*` never becomes a star-step. Preserving each field's star flag is what keeps the day-of-month/day-of-week rule below Vixie-faithful across the stored expression. The durable decoder rejects a stored expression that is not canonical.

The first target is the first strictly future instant whose local date and time in the zone match. It reuses the Daily and Weekly local-time resolution: a non-existent local time is skipped, and an ambiguous one takes the earlier occurrence once for that date. The committed UTC `scheduledAt` is never recomputed on restart.

Day-of-month and day-of-week follow Vixie semantics. A field is a star when its text starts with `*`, independently of the values it matches, so `*/1` and `*/2` are stars while `1-31` and `0-7` are restricted. When either field is a star, a local date matches only when both fields match; when neither is a star, it matches when either field matches.

Cron decoding preserves the committed instant and the stored zone spelling, and rejects a non-canonical stored expression. Cron belongs only to the current Host `ScheduleRecord`; the frozen historical Session decoder does not admit it.

## Historical Session changes

Version-1 `schedule/change` events remain decodable as historical Session data. Their create and fold types use `LegacyScheduleRecord`, which admits only After, At, and Every; Daily, Weekly, and Cron belong only to the current Host `ScheduleRecord`. The Host record decoder is separate from the frozen historical decoder. A create record written before titles existed carries no `title`, so the historical decoder admits that absent member while the Host decoder still requires it. Historical events do not populate the storage domain or schedule delivery. Existing reminders in these events require explicit recreation through `schedule_create`; no implicit Session migration or conversion of old `at` records occurs.

```ts type-equiv
/**
 * Frozen Session event and fold vocabulary; daily rules belong only to Host storage.
 *
 * A version-1 event written before titles existed persists no `title` member, so
 * `after`, `at`, and `every` decode without one and stay readable. The Host task
 * record requires the member and never persists a record without it.
 */
type LegacyScheduleRecord =
  | LegacyAfterScheduleRecord
  | LegacyAtScheduleRecord
  | LegacyEveryScheduleRecord
```

```ts type-equiv
/** Creates one durable reminder record. */
interface ScheduleCreateChange {
  readonly version: 1
  readonly operation: 'create'
  readonly schedule: LegacyScheduleRecord
}
```

```ts type-equiv
/** Deletes one currently active reminder. */
interface ScheduleDeleteChange {
  readonly version: 1
  readonly operation: 'delete'
  readonly id: ScheduleId
}
```

```ts type-equiv
/** Records that one active one-shot reminder entered the durable dispatch history. */
interface OneShotScheduleDispatchChange {
  readonly version: 1
  readonly operation: 'dispatch'
  readonly id: ScheduleId
}
```

```ts type-equiv
/** Records one fixed-rate decision and advances directly past missed occurrences. */
interface EveryScheduleDispatchChange {
  readonly version: 1
  readonly operation: 'dispatch'
  readonly id: ScheduleId
  /** Wall-clock decision time used to select the latest due occurrence. */
  readonly acceptedAt: string
}
```

```ts type-equiv
/** Durable dispatch shapes supported by the current rule set. */
type ScheduleDispatchChange = OneShotScheduleDispatchChange | EveryScheduleDispatchChange
```

```ts type-equiv
/** Strict version-1 durable Schedule mutation union. */
type ScheduleChange = ScheduleCreateChange | ScheduleDeleteChange | ScheduleDispatchChange
```

The historical decoder and fold reject unknown versions, extra fields, reused ids, and invalid transitions. The event remains indexed in the [persistence catalog](../persistence-catalog.md#schedulechange--log-only). Session history is not the authority for active tasks.

## Active views and management

The [tool catalog](../tool-catalog.md#deepseek-aidsh-tool-schedule) owns the schemas for `schedule_create`, `schedule_list`, `schedule_view` and `schedule_edit`. [`tool-schedule`](../../packages/schedule/tool-schedule/README.md) contributes them to each mounting preset. All four refuse delegated callers; create and edit also refuse an actual acting Session with delegated ownership. Human remotes omit that actor. An existing destination must be present, unarchived and not a delegated child. Listing, viewing, editing and deletion do not activate destination Agents.

Create requires a trimmed, non-empty title of at most 120 characters, a non-empty prompt and one typed timing. The target defaults to `new_once`: reserve one Session id at task creation, create that Session at first delivery and then reuse it. `session` uses an existing Session; `new` creates a fresh Session for each delivery. Omitted creation cwd uses the acting Session's original header cwd, or the Host project directory for a human request. Effective execution cwd does not replace original workspace identity.

Current tool values are catalog entries with stored lifecycle status and destination. The timing-only projection below remains available to reminder formatting; it is not the current task-management response.

```ts type-equiv
/** Current delivery timing derived from the durable record and wall clock. */
type ScheduleState = 'scheduled' | 'overdue'
```

```ts type-equiv
/** Host-driven delivery resumes the original Session when needed. */
type ScheduleDeliveryMode = 'host'
```

```ts type-equiv
/** Timing projection used by reminder formatting. */
type ScheduleView = ScheduleRecord & {
  /** Whether the target remains in the future. */
  readonly state: ScheduleState
  /** Delivery is managed by the Host. */
  readonly deliveryMode: ScheduleDeliveryMode
}
```

## Task requests and results

List returns a page of all matching Host tasks, with active rows first and occurrence/id ordering within each group. `active: false` selects paused and ended tasks. The default limit is 100, the maximum is 500 and offset defaults to zero. Catalog returns the complete sorted set; view returns one entry or a lookup miss. Reads inspect only the Schedule domain and never reconstruct Session history.

Edit applies an update patch or deletion in the delivery FIFO. `expectedUpdatedAt` compares the last observed revision; `null` matches a row without a revision. A mismatch returns `schedule_conflict`, and an absent task returns `schedule_not_found`. A patch may change name, instruction, timing, destination or active status. The Host commits every accepted patch as one task-row write and advances the revision, including normalized timing no-ops and clock rollback. Equivalent rules retain their pinned occurrence and stored zone spelling. An empty patch is invalid.

A changed daily, weekly or cron rule computes its first strictly future occurrence under the existing gap/overlap rules. Every starts a new interval anchor; after starts a new relative delay; at selects a future absolute instant. Resuming a missed recurrence selects a future occurrence. A past one-shot needs replacement timing before resumption. A content-only edit retains the occurrence and saved receipts. Cancellation is checked after readiness/FIFO waits and before the durable write; it cannot roll back an admitted write.

The single [Automation Tasks page](../../packages/client/ui-schedule/README.md) provides manual creation separately from New, which starts a conversation. It filters active, paused and ended tasks and retains rule/history details for ended tasks. Manual edit, pause/resume, Run now and Clear ended tasks use the same Host service. Run now preserves the scheduled occurrence and refuses a reused-target task while its previous delivery is queued or running. Whole-agent idle announces a catalog refresh. Clear ended tasks removes only ended rows; paused rows survive. Each deletion is independently durable, so a partial failure rejects and refreshes completed removals. Deletion never retracts queued input.

```ts type-equiv
/** Timing accepted by the shared management API. */
type ScheduleTiming =
  | { readonly kind: 'after'; readonly after_seconds: number }
  | { readonly kind: 'at'; readonly at: AtInput }
  | { readonly kind: 'every'; readonly every_seconds: number }
  | { readonly kind: 'daily'; readonly daily: DailyInput }
  | { readonly kind: 'weekly'; readonly weekly: WeeklyInput }
  | { readonly kind: 'cron'; readonly cron: CronInput }
```

```ts type-equiv
/** Values used when a target creates a Session. */
interface ScheduleSessionCreateSpec {
  /** Project directory of the created Session, which joins the Workspace registered there; omission uses the Host project directory. */
  readonly cwd?: string
  /** Agent preset of the created Session; omission uses the default preset. */
  readonly agentPreset?: string
}
```

```ts type-equiv
/** Stored delivery destination; it is independent of the Session that manages the task. */
type ScheduleTarget =
  | {
    /** Every occurrence goes to one existing Session. */
    readonly kind: 'session'
    /** Session that receives each delivery. */
    readonly sessionId: SessionId
  }
  | {
    /** The first delivery creates one Session; later deliveries go to that Session. */
    readonly kind: 'new_once'
    /** Reserved at creation; the first delivery creates it and the target becomes `session`. */
    readonly sessionId: SessionId
    /** Values used to create the reserved Session. */
    readonly create: ScheduleSessionCreateSpec
  }
  | {
    /** Every delivery creates a fresh Session. */
    readonly kind: 'new'
    /** Values used to create each Session. */
    readonly create: ScheduleSessionCreateSpec
  }
```

```ts type-equiv
/** Destination accepted by create and edit; the Host reserves the `new_once` Session id. */
type ScheduleTargetRequest =
  | {
    /** Deliver to one existing Session that is not a delegated child. */
    readonly kind: 'session'
    /** Existing Session that receives each delivery. */
    readonly sessionId: SessionId
  }
  | {
    /** Create one Session at the first delivery. */
    readonly kind: 'new_once'
    /** Creation values; omission uses the Host defaults. */
    readonly create?: ScheduleSessionCreateSpec
  }
  | {
    /** Create a fresh Session at each delivery. */
    readonly kind: 'new'
    /** Creation values; omission uses the Host defaults. */
    readonly create?: ScheduleSessionCreateSpec
  }
```

```ts type-equiv
/** Durable Session inbox delivery acknowledgment, not model execution completion. */
interface ScheduleDeliveryReceipt {
  /** Canonical UTC target of the delivered occurrence. */
  readonly scheduledAt: string
  /** Canonical UTC time sampled after Session persistence acknowledged delivery. */
  readonly deliveredAt: string
  /** Identity of the delivered message, shared by tasks in one recurring batch. */
  readonly messageId: MessageId
  /** Session that durably accepted the delivered message. */
  readonly targetSessionId: SessionId
}
```

```ts type-equiv
/** Saved inbox delivery with its immutable sent prompt when recorded by this Host. */
interface ScheduleDeliveryRecord extends ScheduleDeliveryReceipt {
  /** Prompt sent for this occurrence; unavailable for legacy receipts. */
  readonly prompt?: string
}
```

```ts type-equiv
/** Bounded newest-first query over the saved deliveries of one task. */
interface ScheduleDeliveryHistoryRequest {
  /** Task whose saved deliveries are read. */
  readonly id: ScheduleId
  /** Required safe-integer page size from 1 through 100. */
  readonly limit: number
  /** Message identity of the oldest entry in the previous page; excluded from this page. */
  readonly before?: MessageId
}
```

```ts type-equiv
/** One newest-first page of saved deliveries. */
interface ScheduleDeliveryHistoryPage {
  /** Task whose saved deliveries this page lists. */
  readonly id: ScheduleId
  /** Saved deliveries, newest first. */
  readonly records: ScheduleDeliveryRecord[]
  /** Whether deliveries before the saved records may exist; the Host never reconstructs them. */
  readonly earlierRecordsUnavailable: boolean
  /** Whether a retention limit removed saved records; legacy history without that fact is false. */
  readonly earlierRecordsPruned: boolean
  /** Current Host retention limits; the delivery writer applies the same limits. */
  readonly retention: DeliveryRetentionBounds
  /** Cursor for the next page; present only when older saved records remain. */
  readonly nextBefore?: MessageId
}
```

```ts type-equiv
/** Non-mutating miss: the task or the page cursor does not exist. */
interface ScheduleDeliveryHistoryMiss {
  /** Requested task identity. */
  readonly id: ScheduleId
  /** `delivery_cursor_not_found` means `before` names no saved record of this task. */
  readonly code: 'schedule_not_found' | 'delivery_cursor_not_found'
}
```

```ts type-equiv
/** One saved-delivery page, or a non-mutating lookup miss. */
type ScheduleDeliveryHistoryResult = ScheduleDeliveryHistoryPage | ScheduleDeliveryHistoryMiss
```

```ts type-equiv
/** Browser-safe Host task state. */
type ScheduleCatalogEntry = ScheduleRecord & {
  /** Destination of the next delivery. */
  readonly target: ScheduleTarget
  /** Creating/editing Agent Sessions and existing or reserved destinations; fresh `new` destinations are excluded. */
  readonly involvedSessionIds: SessionId[]
  /** Only `active` tasks have a timer obligation; `paused` and `ended` tasks stay visible. */
  readonly status: 'active' | 'paused' | 'ended'
  /** Canonical UTC creation time. */
  readonly createdAt?: string
  /** Canonical UTC time of the latest stored change; editors send it back as `expectedUpdatedAt`. */
  readonly updatedAt?: string
  /**
   * The latest delivery is queued or running in its reused target Session; a `new` target, whose deliveries run beside one
   * another, never sets it.
   */
  readonly executionActive?: true
  /** End of the minimum delivery interval, present while it remains in the future. */
  readonly deliveryFloorEndsAt?: string
  /** Most recent durably acknowledged inbox delivery, when available. */
  readonly lastDelivery?: ScheduleDeliveryReceipt
}
```

```ts type-equiv
/** Host task creation request. */
interface ScheduleCreateRequest {
  /** Task name of at most 120 characters, non-empty after trimming. */
  readonly title: string
  /** Instruction sent at each occurrence; non-empty after trimming. */
  readonly prompt: string
  /** Authoritative typed timing with at least one future occurrence. */
  readonly timing: ScheduleTiming
  /** Delivery destination; omission creates one Session at first delivery and reuses it. */
  readonly target?: ScheduleTargetRequest
}
```

```ts type-equiv
/** Host-wide task list request. */
interface ScheduleListRequest {
  /** `true` lists only active tasks; `false` lists only paused and ended tasks; omission lists all tasks. */
  readonly active?: boolean
  /** Page size from 1 through 500; the default is 100. */
  readonly limit?: number
  /** Number of sorted tasks to skip; the default is 0. */
  readonly offset?: number
}
```

```ts type-equiv
/** One page of the Host-wide task list; active tasks come first, ordered by next occurrence. */
interface ScheduleListResult {
  /** Tasks in this page. */
  readonly items: ScheduleCatalogEntry[]
  /** Number of tasks in this page. */
  readonly shown: number
  /** Number of tasks that match the filter. */
  readonly total: number
  /** Applied page size. */
  readonly limit: number
  /** Applied offset. */
  readonly offset: number
}
```

```ts type-equiv
/** Read one task by canonical identity. */
interface ScheduleViewRequest {
  /** Task to read. */
  readonly id: ScheduleId
}
```

```ts type-equiv
/** Non-mutating miss for an unknown task identity. */
interface ScheduleNotFoundResult {
  /** Requested task identity. */
  readonly id: ScheduleId
  /** Lookup miss discriminator. */
  readonly code: 'schedule_not_found'
}
```

```ts type-equiv
/** Current task state, or a lookup miss. */
type ScheduleViewResult = ScheduleCatalogEntry | ScheduleNotFoundResult
```

```ts type-equiv
/** Fields changed together by one atomic update; an omitted field keeps its stored value. */
interface SchedulePatch {
  /** Replacement task name. */
  readonly title?: string
  /** Replacement instruction. */
  readonly prompt?: string
  /** Replacement timing; a changed rule recomputes the next occurrence. */
  readonly timing?: ScheduleTiming
  /** Replacement destination. */
  readonly target?: ScheduleTargetRequest
  /** `false` pauses the task; `true` resumes a recurrence from its first future occurrence. */
  readonly active?: boolean
}
```

```ts type-equiv
/** One closed edit operation. */
type ScheduleEditRequest =
  | {
    /** Task to change. */
    readonly id: ScheduleId
    /** Apply `patch` as one atomic change. */
    readonly action: 'update'
    /** Fields to change; at least one member is required. */
    readonly patch: SchedulePatch
    /** `updatedAt` value that the editor read; a different stored value returns `schedule_conflict`. */
    readonly expectedUpdatedAt?: string | null
  }
  | {
    /** Task to remove. */
    readonly id: ScheduleId
    /** Remove the task and its saved deliveries. */
    readonly action: 'delete'
    /** `updatedAt` value that the editor read; a different stored value returns `schedule_conflict`. */
    readonly expectedUpdatedAt?: string | null
  }
```

```ts type-equiv
/** Non-mutating refusal: the stored task changed after the editor read it. */
interface ScheduleConflictResult {
  /** Requested task identity. */
  readonly id: ScheduleId
  /** Optimistic revision mismatch discriminator. */
  readonly code: 'schedule_conflict'
}
```

```ts type-equiv
/** Updated task state, a completed deletion, or a non-mutating miss or conflict. */
type ScheduleEditResult =
  | ScheduleCatalogEntry
  | Extract<ScheduleDeleteResult, { readonly deleted: true }>
  | ScheduleNotFoundResult
  | ScheduleConflictResult
```

```ts type-equiv
/** Manual execution request from the human task manager. */
interface ScheduleRunRequest {
  /** Task to run now. */
  readonly id: ScheduleId
}
```

```ts type-equiv
/** Non-mutating refusal: one execution of this task already owns its admission slot. */
interface ScheduleExecutionPendingResult {
  /** Requested task identity. */
  readonly id: ScheduleId
  /** Consolidated execution discriminator. */
  readonly code: 'schedule_execution_pending'
}
```

```ts type-equiv
/** Task state after a manual delivery, or a non-mutating miss or refusal. */
type ScheduleRunResult = ScheduleCatalogEntry | ScheduleNotFoundResult | ScheduleExecutionPendingResult
```

```ts type-equiv
/** Successful Host-wide removal of every ended task, whether or not any remained. */
interface ScheduleDeleteInactiveResult {
  /** Ended task rows this call removed; zero when the Host held none. */
  readonly deleted: number
}
```
```ts type-equiv
/** Removal of one task and its saved deliveries. */
type ScheduleDeleteResult = { readonly id: ScheduleId; readonly deleted: true }
```

```ts type-equiv
/** Retention limits applied only when appending a delivery receipt. */
interface DeliveryRetentionBounds {
  /** Retained window measured back from the appended acknowledgment. */
  readonly days: number
  /** Maximum saved receipts per task. */
  readonly records: number
}
```

## Saved delivery records

`schedule.history({id, limit, before?})` reads saved receipts by task id without a Session binding or Agent activation. Limit is a safe integer from 1 through 100. Pages use reverse append order, not wall-clock sorting; the oldest returned message id is the exclusive next-page cursor. A missing task returns `schedule_not_found`, and an unknown cursor returns `delivery_cursor_not_found`.

New tasks initialize empty known history. A row without history exposes only its latest saved receipt and marks earlier records unavailable. The v1 decoder fills a receipt's target Session id only from its existing destination; it never invents receipts or missing prompt snapshots. A successful delivery writes history, latest receipt, status and next occurrence in the same task row. Append prunes by `deliveryHistoryDays` and `deliveryHistoryRecords`, retaining the latest receipt and marking earlier records unavailable when pruned. Explicit deletion removes the row and its receipts; conversation messages remain.

## Host delivery

The existing runtime arms the earliest active occurrence at startup. Paused and ended tasks remain queryable without timer obligations. Due recurrences still coalesce to their latest missed occurrence and batch only compatible existing-Session destinations. A second wall-clock sample after restoration excludes occurrences made premature by rollback. No Goal or separate Run completion record participates in dispatch.

Before creating any delivery Session, the runtime persists `pendingDelivery` and a stable reserved Session id in the same task row. It calls the existing `sessionController.create({sessionId,cwd,agentPreset})` and `resolveAgent(sessionId)`; cold recovery adopts that reserved id after create-before-prompt interruption. An archived destination is refused before inbox insertion.

`followup()` synchronously appends input with `source.kind: 'schedule'` and no human RPC id. Successful Session flush precedes the task write containing its destination receipt and one-shot ended status or recurrence advance. This input supersedes an open waiting question through normal inbox handling while preserving an already queued correlated answer. It carries no Goal human authority and never steers or cancels the current turn.

Resolve, enqueue, flush or task-write failure leaves the task available for retry after a management change or restart. Session persistence and task writes are separate: a crash can repeat delivery after inbox persistence. Schedule guarantees at least once, not exactly once or model completion. Task deletion and Agent cancellation do not retract accepted queued input. There is no external notification channel.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxschedule--scheduleservice"></a>

### `ctx.schedule` — `ScheduleService`

Shared management service; reads, deletion, and timing edits never activate a Session.

`sessionPersistence` is a load-order requirement rather than a directly called service: a delivery commits only when `ctx.sessions.flush()` reports that a `session/flush` listener participated, and the persistence backend providing this service is the plugin that registers that listener.

```ts cordis-catalog
/** Create a task for a human caller without manufacturing an acting Session.
 * @param request - Content, timing, and optional destination.
 * @param signal - Cancellation before persistence.
 * @returns The committed task.
 */
@Remote('create') async remoteCreate(request: ScheduleCreateRequest, signal?: AbortSignal): Promise<ScheduleCatalogEntry>

/** Create one task; the actual acting Session is recorded only as involved.
 * @param request - Content, timing, and optional destination (defaults to new_once).
 * @param actor - Actual model caller; omitted for human remotes.
 * @param signal - Cancellation checked before the durable write, including FIFO waits.
 * @returns Persisted task; an accepted write is not rolled back by cancellation.
 */
async create(request: ScheduleCreateRequest, actor?: Session, signal?: AbortSignal): Promise<ScheduleCatalogEntry>

/** Read one Host-wide page without activating a Session.
 * @param request - Activity filter and pagination.
 * @returns Sorted page with total and applied bounds.
 */
async list(request: ScheduleListRequest = {}): Promise<ScheduleListResult>

/** Read one task page for a human Remote caller.
 * @param request - Activity filter and page bounds.
 * @returns The requested page without Session activation.
 */
@Remote('list') async remoteList(request: ScheduleListRequest): Promise<ScheduleListResult>

/** Read all retained Host tasks.
 * @returns Active tasks first, then occurrence and identity order.
 */
@Remote('catalog') async catalog(): Promise<ScheduleCatalogEntry[]>

/** Read one retained task.
 * @param request - Task identity.
 * @returns Current task or lookup miss.
 */
@Remote('view') async view(request: ScheduleViewRequest): Promise<ScheduleViewResult>

/** Read saved receipts without activating a Session.
 * @param request - Task identity, page size, and exclusive message cursor.
 * @returns Newest-first saved deliveries or lookup miss.
 */
@Remote('history') async history(request: ScheduleDeliveryHistoryRequest): Promise<ScheduleDeliveryHistoryResult>

/** Human edit entry point, with no acting Session.
 * @param request - Closed update/delete operation.
 * @param signal - Cancellation before the durable write.
 * @returns Committed entry, deletion, or conflict/miss.
 */
@Remote('edit') async remoteEdit(request: ScheduleEditRequest, signal?: AbortSignal): Promise<ScheduleEditResult>

/** Apply a complete task patch or delete through one revision check and FIFO slot.
 * @param request - Operation and optional expectedUpdatedAt compare token.
 * @param actor - Actual acting Agent Session, never human authority.
 * @param signal - Cancellation before persistence, including readiness and FIFO waits.
 * @returns Committed entry, deletion, or a non-mutating conflict/miss.
 */
async edit(request: ScheduleEditRequest, actor?: Session, signal?: AbortSignal): Promise<ScheduleEditResult>

/** Deliver immediately without consuming the scheduled occurrence.
 * @param request - Task identity.
 * @param signal - Cancellation checked before delivery admission.
 * @returns Updated task, lookup miss, or an already-running refusal.
 */
@Remote('run') async run(request: ScheduleRunRequest, signal?: AbortSignal): Promise<ScheduleRunResult>

/** Delete ended rows, retaining paused and active tasks. Each deletion is independently durable.
 * @param signal - Cancellation before the first durable deletion.
 * @returns Number removed; a partial failure rejects and announces completed deletions.
 */
@Remote('deleteInactive') async deleteInactive(signal?: AbortSignal): Promise<ScheduleDeleteInactiveResult>
```

Types: [Session](session.md)

Source: [`packages/schedule/schedule/src/index.ts`](../../packages/schedule/schedule/src/index.ts)

<a id="schedule-events"></a>

### `schedule/*` events

<a id="schedulechanged--emit"></a>

#### `schedule/changed` — emit

Task or delivery execution state changed; clients refetch task catalogs.

```ts cordis-catalog
/** Task or delivery execution state changed; clients refetch task catalogs.
 * @mode emit
 */
'schedule/changed'(): void
```

Source: [`packages/schedule/schedule/src/types.ts`](../../packages/schedule/schedule/src/types.ts)
<!-- END GENERATED cordis-surface -->
