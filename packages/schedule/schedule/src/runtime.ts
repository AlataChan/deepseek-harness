/** Host timer over stored tasks; Session activation is a delivery operation. */
import { randomUUID } from 'node:crypto'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'schedule': { kind: 'schedule' } & ContextFormed
  }
}
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { isRecurringScheduleRecord, renderReminderFraming, renderRecurringReminderBatchFraming, resolveRecurringOccurrence } from './domain.ts'
import type { DeliveryRetentionBounds, RecurringScheduleRecord, ScheduleId, ScheduleExecutionPendingResult } from './types.ts'
import type { ScheduleTask } from './storage.ts'
import { appendDelivery } from './delivery-history.ts'

/** Largest delay Node timers represent without clamping. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Owns at most one timer across recomputations; delivery and management share the serialized operation. */
export class ScheduleRuntime {
  private timer: ReturnType<typeof setTimeout> | undefined
  private running: Promise<void> | undefined
  private stopping = false
  private requested = false
  private readonly executing = new Set<ScheduleId>()

  /**
   * @param ctx - Host services used to resume and enqueue.
   * @param tasks - Current durable tasks.
   * @param transact - Serialize delivery against management writes.
   * @param commit - Persist task status, target, receipt, and history together after durable inbox delivery.
   */
  constructor(
    private readonly ctx: Context,
    private readonly tasks: () => readonly ScheduleTask[],
    private readonly transact: <T>(work: () => Promise<T>) => Promise<T>,
    private readonly commit: (task: ScheduleTask) => Promise<void>,
    private readonly retention: DeliveryRetentionBounds,
    private readonly changed?: () => void,
  ) {}

  /**
   * Recompute the nearest obligation after startup or a durable change.
   * Dispatch failures are logged; refused admission does not retry automatically.
   */
  requestDrive(): void {
    if (this.stopping) return
    this.requested = true
    this.clearTimer()
    if (this.running !== undefined) return
    let run: Promise<void>
    try {
      run = this.ctx.agents.withoutInitiator(async () => {
        while (this.requested && !this.stopping) {
          this.requested = false
          await this.transact(async () => { await this.drive() })
        }
      })
    } catch (error: unknown) {
      // Ancestor unloading closes initiator admission before runtime cleanup runs.
      this.requested = false
      this.ctx.logger.warn(`schedule: dispatch stopped: ${String(error)}`)
      return
    }
    this.running = run
    void run.catch((error: unknown) => {
      this.ctx.logger.warn(`schedule: dispatch stopped: ${String(error)}`)
    }).finally(() => {
      this.running = undefined
      if (this.requested && !this.stopping) this.requestDrive()
    })
  }

  /** Stop the timer and drain an accepted delivery before storage closes. */
  async dispose(): Promise<void> {
    this.stopping = true
    this.clearTimer()
    // requestDrive reports execution failures; teardown only waits for quiescence.
    await this.running?.catch(() => undefined)
  }

  /** Whether the most recent reused-target delivery is queued or running.
   * @param task - Retained task.
   * @returns True while its delivery interval has not reached whole-agent idle.
   */
  isExecutionActive(task: ScheduleTask): boolean {
    return this.executing.has(task.record.id)
  }

  /** Deliver now in the same FIFO used by timers and edits, retaining the scheduled occurrence.
   * @param id - Task identity.
   * @param signal - Cancellation before durable reservation or inbox insertion.
   * @returns Committed task, missing task, or an already-running refusal.
   */
  async runNow(id: ScheduleId, signal?: AbortSignal): Promise<ScheduleTask | ScheduleExecutionPendingResult | undefined> {
    return this.transact(async () => {
      signal?.throwIfAborted()
      const task = this.tasks().find(value => value.record.id === id)
      if (task === undefined) return undefined
      if (this.executing.has(id)) return { id, code: 'schedule_execution_pending' }
      const { task: prepared, agent } = await this.resolveTarget(task, signal)
      signal?.throwIfAborted()
      const message = createUserMessage({ content: [{ type: 'text', text: isRecurringScheduleRecord(task.record)
        ? renderRecurringReminderBatchFraming([{ record: task.record, occurrenceAt: new Date(Date.now()).toISOString() }])
        : renderReminderFraming(task.record) }], source: { kind: 'schedule' } })
      agent.followup(message)
      if (!await this.ctx.sessions.flush(agent.session)) throw new Error('Session persistence did not acknowledge the reminder')
      const { pendingDelivery: _pending, ...kept } = prepared
      const deliveredAt = new Date(Date.now()).toISOString()
      const result: ScheduleTask = { ...kept,
        target: prepared.target.kind === 'new_once' ? { kind: 'session', sessionId: agent.session.id } : prepared.target,
        updatedAt: this.revision(prepared),
        ...appendDelivery(prepared, { scheduledAt: task.record.scheduledAt, deliveredAt,
          messageId: message.id, targetSessionId: agent.session.id }, this.retention),
      }
      await this.commit(result)
      this.watchExecution(result, agent.whenIdle())
      this.requestDrive()
      return result
    })
  }

  private deliveredTask(task: ScheduleTask, sessionId: SessionId): ScheduleTask {
    const { pendingDelivery: _pending, ...kept } = task
    return { ...kept, target: task.target.kind === 'new_once' ? { kind: 'session', sessionId } : task.target }
  }

  private revision(task: ScheduleTask): string {
    return new Date(Math.max(Date.now(), Date.parse(task.updatedAt ?? '') + 1 || Date.now())).toISOString()
  }

  private watchExecution(task: ScheduleTask, execution: Promise<void>): void {
    if (task.target.kind === 'new') return
    this.executing.add(task.record.id)
    const finish = (): void => {
      this.executing.delete(task.record.id)
      if (!this.stopping) this.changed?.()
    }
    void execution.then(finish, finish)
  }

  private async resolveTarget(task: ScheduleTask, signal?: AbortSignal) {
    let prepared = task
    let sessionId: SessionId
    if (task.target.kind === 'session') sessionId = task.target.sessionId
    else {
      sessionId = task.pendingDelivery?.targetSessionId
        ?? (task.target.kind === 'new_once' ? task.target.sessionId : SessionId(`session-${randomUUID()}`))
      if (task.pendingDelivery === undefined) {
        signal?.throwIfAborted()
        prepared = { ...task, pendingDelivery: { targetSessionId: sessionId }, updatedAt: this.revision(task) }
        await this.commit(prepared)
      }
      // create adopts the reserved identity idempotently after a create-before-prompt crash.
      await this.ctx.sessionController.create({ sessionId, ...task.target.create })
    }
    signal?.throwIfAborted()
    if (this.ctx.get('workspaceRegistry')?.archivedSessionIds.includes(sessionId)) throw new Error('The target Session is archived')
    const resolved = await this.ctx.sessionController.resolveAgent(sessionId)
    if ('error' in resolved) throw resolved.error
    return { task: prepared, agent: resolved.agent }
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  private async drive(): Promise<void> {
    this.clearTimer()
    const failed = new Set<string>()
    const handled = new Set<string>()
    const scanNow = Date.now()
    const due = this.tasks().filter(task => task.status === 'active' && Date.parse(task.record.scheduledAt) <= scanNow)
    for (const task of due) {
      if (this.stopping) return
      if (handled.has(task.record.id)) continue
      const group = isRecurringScheduleRecord(task.record) && task.target.kind === 'session'
        ? due.filter(candidate => candidate.target.kind === 'session' && task.target.kind === 'session'
          && candidate.target.sessionId === task.target.sessionId && isRecurringScheduleRecord(candidate.record))
        : [task]
      for (const member of group) handled.add(member.record.id)
      let admitted = group
      const committed = new Set<ScheduleTask['record']['id']>()
      try {
        const resolved = await this.resolveTarget(task)
        const prepared = resolved.task
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- Disposal can run while Session restoration is awaited.
        if (this.stopping) return
        const now = Date.now()
        // Session restoration can span a wall-clock rollback; future members keep their timer obligation.
        admitted = group.filter(member => Date.parse(member.record.scheduledAt) <= now)
        if (admitted.length === 0) continue
        const recurring = admitted.filter((member): member is ScheduleTask & { record: RecurringScheduleRecord } =>
          isRecurringScheduleRecord(member.record))
        const occurrences = recurring.map(member => ({
          task: member, occurrence: resolveRecurringOccurrence(member.record, now),
        }))
        const text = isRecurringScheduleRecord(task.record)
          ? renderRecurringReminderBatchFraming(occurrences.map(({ task: member, occurrence }) => ({
            record: member.record, occurrenceAt: occurrence.occurrenceAt,
          })))
          : renderReminderFraming(task.record)
        const message = createUserMessage({
          content: [{ type: 'text', text }], source: { kind: 'schedule' },
        })
        // followup synchronously appends the inbox splice before flush observes the Session.
        resolved.agent.followup(message)
        const flushed = await this.ctx.sessions.flush(resolved.agent.session)
        if (!flushed) throw new Error('Session persistence did not acknowledge the reminder')
        const deliveredAt = new Date(Date.now()).toISOString()
        if (!isRecurringScheduleRecord(task.record)) {
          await this.commit({
            ...this.deliveredTask(prepared, resolved.agent.session.id), status: 'ended', updatedAt: this.revision(prepared),
            ...appendDelivery(task, { scheduledAt: task.record.scheduledAt, deliveredAt,
              messageId: message.id, targetSessionId: resolved.agent.session.id }, this.retention),
          })
          this.watchExecution(prepared, resolved.agent.whenIdle())
          committed.add(task.record.id)
        }
        for (const { task: member, occurrence } of occurrences) {
          await this.commit({
            ...this.deliveredTask(member, resolved.agent.session.id), updatedAt: this.revision(member),
            record: { ...member.record, scheduledAt: occurrence.nextScheduledAt ?? occurrence.occurrenceAt },
            status: occurrence.nextScheduledAt === undefined ? 'ended' : 'active',
            ...appendDelivery(member, { scheduledAt: occurrence.occurrenceAt, deliveredAt,
              messageId: message.id, targetSessionId: resolved.agent.session.id }, this.retention),
          })
          this.watchExecution(member, resolved.agent.whenIdle())
          committed.add(member.record.id)
        }
      } catch (error: unknown) {
        // Successful commits and targets made future by clock rollback keep their timer obligation.
        const pending = admitted.filter(member => !committed.has(member.record.id))
        const failedAt = Date.now()
        for (const member of pending) {
          if (Date.parse(member.record.scheduledAt) <= failedAt) failed.add(member.record.id)
        }
        const ids = pending.map(member => member.record.id)
        this.ctx.logger.warn(`schedule: reminders ${JSON.stringify(ids)} were not acknowledged: ${String(error)}`)
      }
    }
    if (this.stopping) return
    const next = this.tasks().filter(task => task.status === 'active' && !failed.has(task.record.id))
      .reduce<number | undefined>((at, task) => {
        const target = Date.parse(task.record.scheduledAt)
        return at === undefined ? target : Math.min(at, target)
      }, undefined)
    if (next !== undefined) {
      this.timer = setTimeout(() => { this.timer = undefined; this.requestDrive() },
        Math.max(0, Math.min(next - Date.now(), MAX_TIMER_DELAY_MS)))
      this.timer.unref()
    }
  }
}
