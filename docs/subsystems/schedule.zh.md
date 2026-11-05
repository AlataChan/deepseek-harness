# 宿主级 Schedule

[English](schedule.md) | 中文

Schedule 独立于 Session 的加载状态存储任务，并投递到现有或新建 Session。本页记录 [`types.ts`](../../packages/schedule/schedule/src/types.ts) 中的持久与模型可见类型；[包 README](../../packages/schedule/schedule/README.zh.md) 负责组合方式与提醒文本格式。

## 持久记录

`ScheduleId` 是全局唯一的[品牌化 ID](core.zh.md#branded-ids)。版本 2 的 `schedule` domain 为每个 `ScheduleRecord` 存储目标、相关 Session id、活动/暂停/已结束状态及可选的最新回执、修订时间和待投递保留信息。它声明 `compatibleVersions: [1]`；v1 行的 `sessionId` 仅在内存中变为 session 目标，`inactive` 变为 ended。打开不重写文件；下一次变更写入当前字段并标记为 v2。缺少状态的记录规范化为 `active`，不扫描或重建历史 Session。创建时将目标规范化为 RFC 3339 UTC `scheduledAt`；`after` 保留提交的延迟，`every` 保留固定间隔，`daily` 与 `weekly` 保留规范化后的本地 `time` 及显式 `timeZone`，`cron` 保留规范化后的五字段 `expression` 及显式 `timeZone`。每日、每周与 cron 记录解码保留已提交时点及已存储的时区拼写。已存储的任务记录声明必填的 `title`，即任务界面显示的短名称；创建时必须提供该字段，且绝不从指令派生。任何已存储记录都不得缺少标题：`title` 缺失、去除首尾空白后为空、带首尾空白或超过 120 个字符的已存储记录都会以 `ScheduleLogError` 拒绝持久化解码；schedule domain 未声明备份并跳过的策略，因此一条这样的已存储任务会拒绝整个 domain 的打开，而不是被丢弃。仅显式删除会移除任务；此前已物理删除的任务不会被恢复或虚构。

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

## 绝对时间输入

`at` 选择器可以是严格且带偏移量的 RFC 3339 字符串，也可以是精确的本地日历对象。本地形式让这种解释在工具边界保持显式：

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

随发行版交付的 Web 组合挂载 `schedule` 服务与 `ui-schedule` 任务页面。时钟读数与四个提醒工具归 preset 所有：`standard`、`cordis` 与 `ptc` 一同声明 `time-context` 与 `@deepseek-ai/dsh-tool-schedule`，`minimal` 两者都不声明。这三个 preset 中的 `tool-subagent` 与 `tool-subagent-fork` 两行都 deny 这四个工具，且每个工具都以 `subagent_session` 拒绝被委派的调用方，因此被委派的子 agent 既看不到这些工具，其调用也不会被接受。当 open turn 只有一个无歧义的浏览器时区时，Time-context 会告诉模型按该请求本地时区解释未明确限定时区的自然语言日期和时间；浏览器时区记录混合或缺失时，则告诉模型询问用户。该指引不是持久 Session 默认值：模型仍必须在字符串形式中传入偏移量，或在本地形式中传入 `time_zone`；Schedule 绝不会读取浏览器、Session、进程或模型上下文。

Schedule 会拒绝无效偏移量与时区、不带偏移量的字符串、非未来目标，以及落在夏令时缺口内的本地时间。遇到夏令时重叠时，会选择第一次出现的较早时点。创建成功后只存储规范化后的 UTC `scheduledAt`，因此回放绝不依赖环境时区状态。

<a id="daily-wall-clock-input"></a>
## 每日本地钟表时间输入

`daily` 是 create 或 edit 内接受的六种 timing 之一，其 `daily` 选择器与其他时间选择器互斥。例如，`daily: { time: '23:00:00', time_zone: 'Asia/Shanghai' }` 选择该时区每个符合条件的本地日期的 23:00。对象必须精确包含以下字段，不包含日期、偏移量或间隔：

```ts type-equiv
/** Daily local-time selector accepted by creation and timing edits. */
interface DailyInput {
  /** Local HH:mm:ss time with optional one-to-three fractional digits. */
  readonly time: string
  /** Explicit UTC or IANA Area/Location zone. */
  readonly time_zone: string
}
```

创建时要求 `HH:mm:ss` 及可选的一至三位小数秒，拒绝闰秒和 `24:00`，将显式 IANA 时区规范化，并以 `HH:mm:ss.SSS` 存储 `time`。首个 `scheduledAt` 严格晚于创建时刻。不存在的本地时间或整个日期被跳过；重叠时间选择较早时点，每个本地日期一次。若较早时点已过去，较晚的重复时点不符合条件。仅 UTC 目标年份受 0001–9999 范围约束；UTC 范围边缘的本地日期可以落在第 0 年或第 10000 年。

已保存的下一目标是已提交的 UTC 时点。宿主解码器与重启保留该时点，不依据时区规则重新解析；规范名称变化后，有效的已存储时区别名仍可读取。后续目标使用宿主当前的 IANA 数据。下一目标必须晚于投递判断时刻，并且其本地日期晚于所选发生时点的日期。没有可表示的未来 UTC 目标时，创建以 `time_out_of_range` 失败。

## 固定速率输入与补偿

`every_seconds` 是至少 60 秒的安全整数间隔，与创建时间对齐。它衡量经过的时间，而不是每日本地钟表时间：发生偏移量变化时，`every_seconds: 86400` 不能替代 `daily`。协议不提供共享冷却时间或跨记录准入规则；下文描述的 cron 选择器是钟表时间语义，不是固定速率间隔。

宿主启动时若 Every、Daily、Weekly 或 Cron 记录已逾期，只发送最新一次到期发生时点。Every 推进到投递判断时刻之后第一个与当前间隔起算点对齐的目标；Daily、Weekly 和 Cron 遵循上文与下文的本地日期规则。错过的发生时点不会累积。若没有可表示的下一 UTC 目标，投递后保留未运行记录及最近一次回执。

一次性提醒各自产生一条 follow-up。同一次扫描中属于同一 Session 的到期重复记录共用由 `renderRecurringReminderBatchFraming` 渲染的一条 follow-up，每条记录各包含最新一次触发。一分钟下限仅适用于固定速率间隔；投递不等待目标 Agent 空闲。

<a id="cron-wall-clock-input"></a>
## Cron 钟表时间输入

`cron` 是互斥的创建选择器之一。它的对象只携带严格的标准五字段 Vixie 表达式 `minute hour day-of-month month day-of-week` 和显式 IANA 时区，例如 `cron: { expression: '*/15 9-17 * * 1-5', time_zone: 'Asia/Shanghai' }`。字段取值范围如下：

| 字段 | 取值范围 | 说明 |
|---|---|---|
| minute | 0-59 | |
| hour | 0-23 | |
| day-of-month | 1-31 | |
| month | 1-12 | |
| day-of-week | 0-7 | `0` 和 `7` 都表示周日。 |

每个字段接受 `*`、单个值、`a-b` 范围、`n >= 1` 的 `*/n` 与 `a-b/n` 步长，以及由这些形式组成的逗号分隔列表。其他写法一律以 `invalid_rule` 拒绝，且错误信息会指出违规字段：`L`、`W`、`#` 运算符，`JAN`/`MON` 名称，`@daily` 风格宏，带秒字段的六字段表达式，超出范围的值、反向范围、零步长和空字段。由于该方言只有五个字段，最小间隔为一分钟；亚分钟级调度仍然不受支持。

创建时会先规范化表达式再存储。规范化会把每个字段展开为匹配值集合，再确定性地重新编码该集合：重复值合并，相邻的值与范围合并，均匀步长写为 `a-b/n`，而以 `*` 开头的字段写为星号步长（匹配全部取值时写 `*`，否则写最宽的星号步长并追加其余取值），步长 `1` 被移除，周日统一写为 `0`。不以 `*` 开头的字段绝不会变成星号步长。保留每个字段的星号标志，正是下文 day-of-month/day-of-week 规则在存储的表达式上仍与 Vixie 一致的原因。持久化解码器会拒绝非规范化的已存储表达式。

首个目标是该时区内本地日期与时间匹配的第一个严格未来时点。它复用 Daily 与 Weekly 的本地时间解析：不存在的本地时间被跳过，重叠时间每个日期只取较早一次。已提交的 UTC `scheduledAt` 在重启时绝不重新计算。

day-of-month 与 day-of-week 遵循 Vixie 语义。字段文本以 `*` 开头即为星号字段，与它匹配的取值集合无关，因此 `*/1` 与 `*/2` 都是星号字段，而 `1-31` 与 `0-7` 受限。任一字段为星号字段时，本地日期只有在两个字段都匹配时才算匹配；两个字段都不是星号字段时，匹配任一字段即算匹配。

cron 解码保留已提交时点及已存储的时区拼写，并拒绝非规范化的已存储表达式。cron 仅属于当前宿主的 `ScheduleRecord`；冻结的历史 Session 解码器不接受它。

## 历史 Session 变更

版本 1 的 `schedule/change` 事件仍可作为历史 Session 数据解码。其 create 和 fold 类型使用 `LegacyScheduleRecord`，仅接受 After、At 和 Every；Daily、Weekly 与 Cron 仅属于当前宿主的 `ScheduleRecord`。宿主记录解码器独立于冻结的历史解码器。在 title 出现之前写入的 create 记录不含 `title`，因此历史解码器接受该缺失成员，而宿主解码器仍要求它。历史事件不会填充 storage domain 或触发投递。这些事件中的已有提醒需要显式通过 `schedule_create` 重新创建；不会隐式迁移 Session 或转换旧 `at` 记录。

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

历史 decoder 与 fold 拒绝未知版本、额外字段、复用 ID 和无效转换。该事件仍编入[持久化目录](../persistence-catalog.zh.md#schedulechange--log-only)。Session 历史不负责决定当前活动任务。

## 活动视图与管理

[工具目录](../tool-catalog.zh.md#deepseek-aidsh-tool-schedule) 拥有 `schedule_create`、`schedule_list`、`schedule_view` 和 `schedule_edit` 的 schema。[`tool-schedule`](../../packages/schedule/tool-schedule/README.zh.md) 将它们贡献给每个挂载它的 preset。四个工具都拒绝被委派的调用方；create 和 edit 还会拒绝属于委派子 agent 的实际调用 Session。人工 remote 不提供此调用方。现有目标必须存在、未归档且不属于委派子 agent。列表、查看、编辑和删除不会激活目标 Agent。

创建必须提供去除首尾空白后非空且不超过 120 字符的标题、非空指令和一种显式 timing。默认目标是 `new_once`：创建任务时保留一个 Session id，首次投递时创建该 Session，此后复用。`session` 使用现有 Session；`new` 每次投递创建一个新 Session。未指定创建 cwd 时，Agent 请求使用调用 Session 的原始 header cwd，人工请求使用宿主项目目录。有效执行 cwd 不会替代原始工作区身份。

当前工具值是包含持久化生命周期状态和目标的目录条目。下方仅包含时间投影的类型继续用于提醒格式化，不是当前任务管理响应。

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

## 任务请求与结果

List 返回匹配宿主任务的一页，活动项优先，各组内按发生时点及 id 排序。`active: false` 选择暂停和已结束任务。limit 默认为 100、最大为 500，offset 默认为零。Catalog 返回完整排序集合；view 返回一个条目或查找未命中。读取仅检查 Schedule domain，不重建 Session 历史。

Edit 在投递 FIFO 内应用更新补丁或删除。`expectedUpdatedAt` 比较上次读取的修订时间；`null` 匹配没有修订时间的记录。不匹配返回 `schedule_conflict`，任务不存在返回 `schedule_not_found`。补丁可改变名称、指令、时间、目标或活动状态。宿主将每次接受的补丁作为一次任务行写入提交并推进修订时间，规范化时间相同及墙钟回退时也如此。等价规则保留已提交的发生时点及已存储的时区拼写。空补丁非法。

改变每日、每周或 cron 规则会按现有跳时/重叠规则计算严格位于未来的首次发生时点。Every 建立新的间隔锚点；after 开始新的相对延迟；at 选择未来的绝对时点。恢复错过时点的周期任务会选择未来时点。过去的一次性任务必须先替换时间才能恢复。仅修改内容会保留发生时点和已保存回执。取消检查发生在初始化/FIFO 等待后及持久写入前，不能回滚已准入的写入。

唯一的[自动化任务页](../../packages/client/ui-schedule/README.zh.md) 将手动创建与启动会话的 New 分开。页面筛选活动、暂停和已结束任务，并为已结束任务保留规则/记录详情。手动编辑、暂停/恢复、立即运行和清理已结束任务使用同一宿主服务。立即运行保留原计划时点；复用目标的上次投递仍排队或运行时拒绝再次运行。整个 Agent 空闲时通知刷新目录。清理只删除已结束行，暂停行保留。每次删除独立持久化，部分失败会 reject 并刷新已完成删除。删除不会撤回排队输入。

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

## 已保存的发送记录

`schedule.history({id, limit, before?})` 按任务 id 读取已保存回执，无需 Session 绑定或 Agent 激活。limit 必须是 1–100 的安全整数。页面按追加顺序逆序排列，不按墙钟排序；返回的最旧消息 id 是下一页排他的游标。任务不存在返回 `schedule_not_found`，游标未知返回 `delivery_cursor_not_found`。

新任务初始化已知为空的历史。没有历史的行只展示其最新已保存回执，并标明更早记录不可用。v1 解码器仅从现有目标补齐回执的目标 Session id，绝不虚构回执或缺失的指令快照。成功投递在同一任务行写入历史、最新回执、状态和下一发生时点。追加按 `deliveryHistoryDays` 和 `deliveryHistoryRecords` 修剪，保留最新回执，并在修剪后标明更早记录不可用。显式删除移除任务行及其回执；会话消息保留。

## 宿主投递

现有 runtime 启动时为最早的活动发生时点设置 timer。暂停和已结束任务可查询，但没有 timer 义务。到期周期任务仍合并为最近一次错过的发生时点，且仅对兼容的现有 Session 目标合批。恢复后第二次采样墙钟，排除因回退而尚未到期的发生时点。Goal 或独立 Run 完成记录都不参与派发。

创建任何投递 Session 前，runtime 将 `pendingDelivery` 和稳定保留的 Session id 持久化在同一任务行。它调用现有 `sessionController.create({sessionId,cwd,agentPreset})` 和 `resolveAgent(sessionId)`；在创建后、发送前中断的情况下，冷恢复采用此保留 id。收件箱插入前拒绝已归档目标。

`followup()` 同步追加 `source.kind: 'schedule'` 且不含人工 RPC id 的输入。Session flush 成功后才写入含目标回执及一次任务 ended 状态或周期推进的任务行。此输入通过普通收件箱处理使待回答问题过期，同时保留已排队的关联回答。它不携带 Goal 人工权限，也不 steer 或取消当前回合。

解析、入队、flush 或任务写入失败时，任务保留，管理变更或重启后可重试。Session 持久化与任务写入彼此独立，收件箱持久化后的崩溃可能重复投递。Schedule 保证至少一次，不保证恰好一次或模型完成。任务删除及 Agent 取消不撤回已接受的排队输入。没有外部通知渠道。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Session](session.zh.md)

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
