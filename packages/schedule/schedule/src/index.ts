/** Host-wide durable reminders and shared human/model management. */
import { randomUUID } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import { Context, Service } from '@deepseek-ai/cordis'
import { TypertRemoteService, Remote, RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { delegationDepthOf } from '@deepseek-ai/dsh-subagent'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import type { SessionActivity } from '@deepseek-ai/dsh-workspace'
import { ScheduleRuntime } from './runtime.ts'
import { scheduleDomain, scheduleTaskSchema, type ScheduleTask } from './storage.ts'
import { deliveryHistoryPage } from './delivery-history.ts'
import { resolveScheduleUpdate } from './update.ts'
import {
  foldScheduleEvents, ScheduleInputError, ScheduleLogError, ScheduleId,
  createScheduleRecord,
} from './domain.ts'
import type {
  DeliveryRetentionBounds, ScheduleCatalogEntry, ScheduleCreateRequest, ScheduleDeliveryHistoryRequest,
  ScheduleDeliveryHistoryResult, ScheduleListRequest, ScheduleListResult, ScheduleTargetRequest, ScheduleTarget,
  ScheduleViewRequest, ScheduleViewResult, ScheduleEditRequest, ScheduleEditResult, ScheduleRunRequest,
  ScheduleRunResult, ScheduleDeleteInactiveResult,
} from './types.ts'


export type * from './types.ts'
export { scheduleDomain } from './storage.ts'
export type { ScheduleTask } from './storage.ts'
export type { RecurringOccurrence } from './domain.ts'
export {
  SCHEDULE_CHANGE_VERSION,
  MIN_EVERY_INTERVAL_SECONDS,
  MAX_TITLE_LENGTH,
  REQUIRED_TITLE_MESSAGE,
  ScheduleId,
  ScheduleInputError,
  ScheduleLogError,
  canonicalizeCronExpression,
  createAfterScheduleRecord,
  createAtScheduleRecord,
  createEveryScheduleRecord,
  createDailyScheduleRecord,
  createWeeklyScheduleRecord,
  createCronScheduleRecord,
  decodeScheduleChange,
  decodeScheduleRecord,
  foldScheduleEvents,
  isRecurringScheduleRecord,
  normalizeWeekdays,
  parseCronInput,
  parseWeeklyInput,
  renderReminderFraming,
  renderRecurringReminderBatchFraming,
  resolveEveryOccurrence,
  resolveDailyOccurrence,
  resolveWeeklyOccurrence,
  resolveCronOccurrence,
  resolveRecurringOccurrence,
  createScheduleRecord,
  scheduleView,
  weeklyTime,
} from './domain.ts'


declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable Host-wide reminder management. */
    schedule: ScheduleService
  }
}

/** Preserve input diagnostics on the human Remote error channel. */
function remoteInputError(error: unknown): never {
  if (error instanceof ScheduleInputError) throw new RemoteError('schedule/input-invalid', error.message, { code: error.code })
  throw error
}

/** Configuration for the Host Schedule domain. */
export interface Config {
  /**
   * Delivery-history window retained per task, in days; omission defaults to 30.
   * Pruning happens when an acknowledgment is appended, and `lastDelivery` is always retained.
   */
  deliveryHistoryDays?: number
  /**
   * Retained delivery records per task; omission defaults to 200. The older of this
   * cap and the window wins, and the newest records survive.
   */
  deliveryHistoryRecords?: number
}

/** Retained delivery-history window applied when the deployment states none. */
const DEFAULT_DELIVERY_HISTORY_DAYS = 30

/** Retained delivery-history record cap applied when the deployment states none. */
const DEFAULT_DELIVERY_HISTORY_RECORDS = 200

/**
 * Shared management service; reads, deletion, and timing edits never activate a Session.
 *
 * `sessionPersistence` is a load-order requirement rather than a directly called
 * service: a delivery commits only when `ctx.sessions.flush()` reports that a
 * `session/flush` listener participated, and the persistence backend providing this
 * service is the plugin that registers that listener.
 */
export class ScheduleService extends TypertRemoteService {
  static inject = ['agents', 'sessions', 'storageDomain', 'sessionController', 'sessionPersistence']

  static Config: z<Config> = z.object({
    deliveryHistoryDays: z.number().step(1).min(1).max(3650).default(DEFAULT_DELIVERY_HISTORY_DAYS),
    deliveryHistoryRecords: z.number().step(1).min(1).max(10_000).default(DEFAULT_DELIVERY_HISTORY_RECORDS),
  })

  /** Resolved retention bounds shared with the runtime that appends acknowledgments. */
  private readonly retention: DeliveryRetentionBounds
  private readonly ready: Promise<Domain<typeof scheduleDomain>>
  private readonly initialized: PromiseLike<unknown>
  private chain: Promise<unknown> = Promise.resolve()
  private runtime!: ScheduleRuntime
  private stopping = false

  /**
   * @param ctx - Host services owning storage, dispatch, and Session restoration.
   * @param config - Validated retention configuration for delivery history.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'schedule')
    this.retention = {
      days: config.deliveryHistoryDays ?? DEFAULT_DELIVERY_HISTORY_DAYS,
      records: config.deliveryHistoryRecords ?? DEFAULT_DELIVERY_HISTORY_RECORDS,
    }
    this.ready = ctx.storageDomain.open(scheduleDomain).then(async (domain) => {
      for (const [key, task] of domain.table('tasks').entries()) {
        if (key !== task.record.id) {
          // The mismatch is the actionable failure; a rejecting close must not replace it.
          try {
            await domain.close()
          } catch (error: unknown) {
            ctx.logger.warn(`schedule: closing the domain after a key mismatch failed: ${String(error)}`)
          }
          throw new Error(`schedule: stored task key "${key}" differs from record id "${task.record.id}"`)
        }
      }
      return domain
    })
    this.initialized = ctx.effect(async () => {
      const domain = await this.ready
      let runtime: ScheduleRuntime | undefined = undefined
      let cleanup: () => Promise<void>
      try {
        cleanup = ctx.effect(() => async () => {
          this.stopping = true
          await runtime?.dispose()
          await this.chain // The chain contains failures after returning them to their callers.
          await domain.close()
        })
      } catch (error) {
        this.stopping = true
        await domain.close()
        throw error
      }
      const tasks = domain.table('tasks')
      runtime = new ScheduleRuntime(ctx,
        () => [...tasks.entries()].map(([, task]) => task),
        work => this.serialize(work),
        async (task) => {
          await tasks.put(task.record.id, task)
          this.emitChanged()
        },
        this.retention, () => { this.emitChanged() })
      this.runtime = runtime
      runtime.requestDrive()
      return cleanup
    })
    ctx.on('session/created', (session) => {
      // Historical Schedule events remain readable but do not populate Host tasks.
      // A throwing `session/created` listener rolls the attach back, so an unreadable
      // legacy stream must warn here instead of blocking Session creation.
      let activeLegacy = 0
      try {
        // oxlint-disable-next-line typescript/no-deprecated -- Explicit warning for legacy Schedule history.
        activeLegacy = foldScheduleEvents(session.ownEvents()).active.length
      } catch (error: unknown) {
        /* v8 ignore next -- foldScheduleEvents normalizes every rejected stream to ScheduleLogError. */
        if (!(error instanceof ScheduleLogError)) throw error
        ctx.logger.warn(`schedule: Session "${session.id}" historical events could not be read (${error.message}); the legacy reminder is ignored.`)
        return
      }
      if (activeLegacy > 0) {
        ctx.logger.warn(`schedule: Session "${session.id}" contains legacy reminders; recreate active reminders with schedule_create.`)
      }
    }, { global: true })
    // Host tasks outlive their Session's Agent, so archive admission reads the
    // stored rows rather than a live runtime: an idle Session whose reminders
    // are still armed refuses the archive, and an archiving stop deletes those
    // rows instead of letting them deliver into a closed Session.
    ctx.effect(() => {
      const activity = ctx.on('workspace/session-activity', async ({ sessionId }, next) => {
        const active = { items: (await this.catalog()).filter(entry => entry.target.kind !== 'new' && entry.target.sessionId === sessionId && entry.status === 'active') }
        const rest = await next()
        if (active.items.length === 0) return rest
        const own: SessionActivity = {
          kind: 'schedule',
          items: active.items.map(record => ({ id: record.id, label: record.title })),
        }
        return [own, ...rest]
      })
      const stop = ctx.on('workspace/session-stop', async ({ sessionId }) => {
        await this.stopSessionTasks(sessionId)
      })
      return () => {
        stop()
        activity()
      }
    }, 'schedule.archiveAdmission()')
  }

  async [Service.init](): Promise<void> {
    await this.initialized
  }

  /** Create a task for a human caller without manufacturing an acting Session.
   * @param request - Content, timing, and optional destination.
   * @param signal - Cancellation before persistence.
   * @returns The committed task.
   */
  @Remote('create')
  async remoteCreate(request: ScheduleCreateRequest, signal?: AbortSignal): Promise<ScheduleCatalogEntry> {
    try { return await this.create(request, undefined, signal) }
    catch (error) { remoteInputError(error) }
  }

  /** Create one task; the actual acting Session is recorded only as involved.
   * @param request - Content, timing, and optional destination (defaults to new_once).
   * @param actor - Actual model caller; omitted for human remotes.
   * @param signal - Cancellation checked before the durable write, including FIFO waits.
   * @returns Persisted task; an accepted write is not rolled back by cancellation.
   */
  async create(request: ScheduleCreateRequest, actor?: Session, signal?: AbortSignal): Promise<ScheduleCatalogEntry> {
    this.validateActor(actor)
    if (Object.keys(request).some(key => !['title', 'prompt', 'timing', 'target'].includes(key))) {
      throw new ScheduleInputError('invalid_selector', 'Exactly one typed timing is required; create accepts title, prompt, timing and target only.')
    }
    signal?.throwIfAborted()
    const now = Date.now()
    const id = ScheduleId(`schedule-${randomUUID()}`)
    const record = createScheduleRecord(id, request.title, request.prompt, request.timing, now)
    const target = this.resolveTarget(request.target ?? { kind: 'new_once' }, actor)
    return this.serialize(async () => {
      const tasks = (await this.getDomain()).table('tasks')
      signal?.throwIfAborted()
      await this.validateTarget(target, signal)
      signal?.throwIfAborted()
      const createdAt = new Date(now).toISOString()
      const task = scheduleTaskSchema.parse({ record, target, status: 'active', createdAt, updatedAt: createdAt,
        involvedSessionIds: this.involved(actor, target),
        deliveryHistory: { records: [], earlierRecordsUnavailable: false },
      })
      await tasks.put(id, task)
      this.emitChanged(); this.runtime.requestDrive()
      return this.entry(task)
    })
  }

  /** Read one Host-wide page without activating a Session.
   * @param request - Activity filter and pagination.
   * @returns Sorted page with total and applied bounds.
   */
  async list(request: ScheduleListRequest = {}): Promise<ScheduleListResult> {
    const limit = request.limit ?? 100, offset = request.offset ?? 0
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500 || !Number.isSafeInteger(offset) || offset < 0) {
      throw new ScheduleInputError('invalid_rule', 'limit must be 1 through 500 and offset must be a non-negative safe integer.')
    }
    const entries = (await this.catalog()).filter(entry => request.active === undefined || (entry.status === 'active') === request.active)
    const items = entries.slice(offset, offset + limit)
    return { items, shown: items.length, total: entries.length, limit, offset }
  }

  /** Read one task page for a human Remote caller.
   * @param request - Activity filter and page bounds.
   * @returns The requested page without Session activation.
   */
  @Remote('list')
  async remoteList(request: ScheduleListRequest): Promise<ScheduleListResult> {
    try { return await this.list(request) }
    catch (error) { remoteInputError(error) }
  }

  /** Read all retained Host tasks.
   * @returns Active tasks first, then occurrence and identity order.
   */
  @Remote('catalog')
  async catalog(): Promise<ScheduleCatalogEntry[]> {
    return [...(await this.getDomain()).table('tasks').entries()].map(([, task]) => this.entry(task))
      .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active')
        || a.scheduledAt.localeCompare(b.scheduledAt) || a.id.localeCompare(b.id))
  }

  /** Read one retained task.
   * @param request - Task identity.
   * @returns Current task or lookup miss.
   */
  @Remote('view')
  async view(request: ScheduleViewRequest): Promise<ScheduleViewResult> {
    const task = (await this.getDomain()).table('tasks').get(request.id)
    return task === undefined ? { id: request.id, code: 'schedule_not_found' } : this.entry(task)
  }

  /** Read saved receipts without activating a Session.
   * @param request - Task identity, page size, and exclusive message cursor.
   * @returns Newest-first saved deliveries or lookup miss.
   */
  @Remote('history')
  async history(request: ScheduleDeliveryHistoryRequest): Promise<ScheduleDeliveryHistoryResult> {
    if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 100) {
      throw new ScheduleInputError('invalid_rule', 'Delivery history limit must be a safe integer from 1 through 100.')
    }
    const task = (await this.getDomain()).table('tasks').get(request.id)
    return task === undefined ? { id: request.id, code: 'schedule_not_found' } : deliveryHistoryPage(task, request, this.retention)
  }

  /** Human edit entry point, with no acting Session.
   * @param request - Closed update/delete operation.
   * @param signal - Cancellation before the durable write.
   * @returns Committed entry, deletion, or conflict/miss.
   */
  @Remote('edit')
  async remoteEdit(request: ScheduleEditRequest, signal?: AbortSignal): Promise<ScheduleEditResult> {
    try { return await this.edit(request, undefined, signal) }
    catch (error) { remoteInputError(error) }
  }

  /** Apply a complete task patch or delete through one revision check and FIFO slot.
   * @param request - Operation and optional expectedUpdatedAt compare token.
   * @param actor - Actual acting Agent Session, never human authority.
   * @param signal - Cancellation before persistence, including readiness and FIFO waits.
   * @returns Committed entry, deletion, or a non-mutating conflict/miss.
   */
  async edit(request: ScheduleEditRequest, actor?: Session, signal?: AbortSignal): Promise<ScheduleEditResult> {
    this.validateActor(actor)
    if (request.action === 'update' && Object.keys(request.patch).length === 0) {
      throw new ScheduleInputError('invalid_rule', 'An update patch requires at least one field.')
    }
    const target = request.action === 'update' && request.patch.target !== undefined
      ? this.resolveTarget(request.patch.target, actor) : undefined
    return this.serialize(async () => {
      const tasks = (await this.getDomain()).table('tasks')
      signal?.throwIfAborted()
      const current = tasks.get(request.id)
      if (current === undefined) return { id: request.id, code: 'schedule_not_found' }
      if (request.expectedUpdatedAt !== undefined && request.expectedUpdatedAt !== (current.updatedAt ?? null)) {
        return { id: request.id, code: 'schedule_conflict' }
      }
      if (request.action === 'delete') {
        await tasks.delete(request.id)
        this.emitChanged(); this.runtime.requestDrive()
        return { id: request.id, deleted: true }
      }
      const effectiveTarget = target ?? current.target
      if (target !== undefined || request.patch.timing !== undefined || request.patch.active === true) {
        await this.validateTarget(effectiveTarget, signal)
        signal?.throwIfAborted()
      }
      const revised = resolveScheduleUpdate(current, request.patch, target, Date.now())
      const task = scheduleTaskSchema.parse({ ...revised,
        involvedSessionIds: this.involved(actor, effectiveTarget, revised.involvedSessionIds),
      })
      await tasks.put(request.id, task)
      this.emitChanged(); this.runtime.requestDrive()
      return this.entry(task)
    })
  }

  /** Deliver immediately without consuming the scheduled occurrence.
   * @param request - Task identity.
   * @param signal - Cancellation checked before delivery admission.
   * @returns Updated task, lookup miss, or an already-running refusal.
   */
  @Remote('run')
  async run(request: ScheduleRunRequest, signal?: AbortSignal): Promise<ScheduleRunResult> {
    await this.getDomain()
    const task = await this.runtime.runNow(request.id, signal)
    return task === undefined ? { id: request.id, code: 'schedule_not_found' }
      : 'code' in task ? task : this.entry(task)
  }

  /** Delete ended rows, retaining paused and active tasks. Each deletion is independently durable.
   * @param signal - Cancellation before the first durable deletion.
   * @returns Number removed; a partial failure rejects and announces completed deletions.
   */
  @Remote('deleteInactive')
  async deleteInactive(signal?: AbortSignal): Promise<ScheduleDeleteInactiveResult> {
    return this.serialize(async () => {
      const tasks = (await this.getDomain()).table('tasks')
      const ids = [...tasks.entries()].filter(([, task]) => task.status === 'ended').map(([id]) => id)
      signal?.throwIfAborted()
      let deleted = 0
      try {
        for (const id of ids) { await tasks.delete(id); deleted++ }
      } finally {
        if (deleted > 0) this.emitChanged()
      }
      return { deleted }
    })
  }

  private entry(task: ScheduleTask): ScheduleCatalogEntry {
    return { ...task.record, target: task.target, status: task.status, involvedSessionIds: [...task.involvedSessionIds],
      ...(task.createdAt === undefined ? {} : { createdAt: task.createdAt }),
      ...(task.updatedAt === undefined ? {} : { updatedAt: task.updatedAt }),
      ...(task.lastDelivery === undefined ? {} : { lastDelivery: task.lastDelivery }),
      ...(this.runtime.isExecutionActive(task) ? { executionActive: true } : {}),
    }
  }

  private validateActor(actor: Session | undefined): void {
    if ((actor?.header.delegationDepth ?? 0) > 0) throw new ScheduleInputError('subagent_session', 'A delegated subagent cannot use reminders.')
  }

  private involved(actor: Session | undefined, target: ScheduleTarget, previous: SessionId[] = []): SessionId[] {
    return [...new Set([...previous, ...(actor === undefined ? [] : [actor.id]), ...(target.kind === 'new' ? [] : [target.sessionId])])]
  }

  private resolveTarget(request: ScheduleTargetRequest, actor?: Session): ScheduleTarget {
    if (!['session', 'new_once', 'new'].includes(request.kind)) {
      throw new ScheduleInputError('invalid_rule', 'Unsupported task target.')
    }
    if (request.kind === 'session') return request
    const create = { ...request.create }
    // Original workspace identity is independent of any effective execution directory.
    if (create.cwd === undefined && actor?.header.cwd !== undefined) create.cwd = actor.header.cwd
    if (request.kind === 'new_once') return { kind: 'new_once', sessionId: SessionId(`session-${randomUUID()}`), create }
    return { kind: 'new', create }
  }

  private async validateTarget(target: ScheduleTarget, signal?: AbortSignal): Promise<void> {
    if (target.kind === 'new') return
    if (this.ctx.get('workspaceRegistry')?.archivedSessionIds.includes(target.sessionId)) {
      throw new ScheduleInputError('invalid_rule', 'The target Session is archived.')
    }
    const agent = this.ctx.agents.get(target.sessionId)
    const session = agent?.session ?? this.ctx.sessions.get(target.sessionId)
    if (session !== undefined) {
      if ((session.header.delegationDepth ?? 0) > 0 || (agent !== undefined && delegationDepthOf(agent) > 0)) {
        throw new ScheduleInputError('subagent_session', 'This Session belongs to subagent routing, which never receives reminder delivery.')
      }
      return
    }
    if (target.kind === 'new_once') return
    const stored = await this.ctx.sessionPersistence.stat(target.sessionId, signal === undefined ? undefined : { signal })
    if (stored === undefined) throw new ScheduleInputError('invalid_rule', 'The target Session does not exist.')
    if ((stored.header.delegationDepth ?? 0) > 0) throw new ScheduleInputError('subagent_session', 'The target Session belongs to subagent routing.')
  }

  /**
   * Dispatch a durable-task or execution-status notification, containing
   * synchronous listener failures so a throwing listener cannot reject the caller or
   * skip the following `requestDrive()`.
   */
  private emitChanged(): void {
    try {
      this.ctx.emit('schedule/changed')
    } catch (error: unknown) {
      // Swallows synchronous observer exceptions only: emit dispatches
      // listeners inline and nothing else runs in the try. The event is a
      // notification, not a transaction participant.
      this.ctx.logger.warn(`schedule: schedule/changed listener failed: ${String(error)}`)
    }
  }

  private async getDomain(): Promise<Domain<typeof scheduleDomain>> {
    await this.initialized
    return this.ready
  }

  /**
   * Remove every active task stored for one Session, inside the queue the tools
   * use.
   *
   * Enumerating and deleting in one queue slot is what makes an archive stop
   * ordered behind a create whose write is still in flight: a stop that read the
   * table outside the queue could miss a row the create was about to commit and
   * leave an armed reminder behind. Re-entering the public `delete()` from here
   * would deadlock on this queue, so the rows are removed directly.
   * @param sessionId - Session whose active Host tasks must stop.
   */
  private async stopSessionTasks(sessionId: SessionId): Promise<void> {
    await this.serialize(async () => {
      const tasks = (await this.getDomain()).table('tasks')
      const active = [...tasks.entries()]
        .filter(([, task]) => task.target.kind !== 'new' && task.target.sessionId === sessionId && task.status === 'active')
        .map(([, task]) => task.record.id)
      if (active.length === 0) return
      // One row per write: the domain table has no batch delete, and each row is
      // durable on its own, so a failure partway through leaves the rows already
      // removed committed. Observers hear about that change before the failure
      // reaches the caller, which still receives it.
      let removed = false
      let failure: Error | undefined
      for (const id of active) {
        try {
          await tasks.delete(id)
          removed = true
        } catch (error: unknown) {
          // Every row is attempted: the archive has already landed, so a row this
          // stop skipped would stay armed in a Session whose runtime then refuses
          // its model steps. A rejection reason that carries no Error still has to
          // report a failure, so it is wrapped before the first one is kept.
          failure ??= error instanceof Error ? error : new Error(`schedule stop failed: ${String(error)}`)
        }
      }
      if (removed) {
        this.emitChanged()
        this.runtime.requestDrive()
      }
      if (failure !== undefined) throw failure
    })
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    if (this.stopping) return Promise.reject(new Error('Schedule service is stopping'))
    const pending = this.chain.then(work)
    this.chain = pending.catch(() => undefined) // Preserve FIFO progress after the caller receives the failure.
    return pending
  }
}

export default ScheduleService
