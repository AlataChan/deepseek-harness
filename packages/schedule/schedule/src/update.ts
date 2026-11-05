/** Optimistic name, instruction, and timing updates of retained Host tasks, without Session mutations. */
import { isDeepStrictEqual } from 'node:util'
import {
  canonicalizeCronExpression, canonicalizeTimeZone, createAfterScheduleRecord, createAtScheduleRecord, createCronScheduleRecord,
  createDailyScheduleRecord, createEveryScheduleRecord, createWeeklyScheduleRecord,
  decodeStoredTitle, parseAtInput, parseCronInput, parseDailyInput, parseWeeklyInput,
  ScheduleInputError, scheduleTitle, resolveRecurringOccurrence, isRecurringScheduleRecord,
} from './domain.ts'
import type { ScheduleRecord, ScheduleTiming, SchedulePatch, ScheduleTarget } from './types.ts'
import type { ScheduleTask } from './storage.ts'

/** Name the exact selector property each timing kind must carry, or undefined for an unknown discriminant. */
function timingSelector(kind: string): string | undefined {
  switch (kind) {
    case 'after': return 'after_seconds'
    case 'at': return 'at'
    case 'every': return 'every_seconds'
    case 'daily': return 'daily'
    case 'weekly': return 'weekly'
    case 'cron': return 'cron'
    default: return undefined
  }
}

/**
 * Validate the exact timing selector keys received over RPC.
 * @param value - Untrusted timing change; the wire can carry a null, array, or foreign discriminant.
 * @returns The same value narrowed to the closed timing-change union.
 */
function validateChange(value: unknown): ScheduleTiming {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ScheduleInputError('invalid_rule', 'Timing change must be an object with exactly one supported timing selector.')
  }
  const change = value as ScheduleTiming
  const selector = timingSelector(change.kind)
  const keys = Object.keys(change)
  if (selector === undefined || keys.length !== 2 || !keys.includes('kind') || !keys.includes(selector)) {
    throw new ScheduleInputError('invalid_rule', 'Timing change must contain exactly kind and its matching timing selector.')
  }
  return change
}

/**
 * Validate a replacement instruction received over RPC.
 * @param prompt - Untrusted instruction value; the wire can carry a non-string.
 * @returns The trimmed instruction; an invalid instruction throws ScheduleInputError.
 */
function schedulePrompt(prompt: string): string {
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new ScheduleInputError('invalid_prompt', 'prompt must be non-empty after trimming.')
  }
  return prompt.trim()
}

/**
 * Title one update must either keep or replace.
 *
 * A decoded record always carries a stored title. A record value without a
 * valid one is refused with the durable decode error instead of deriving a name.
 * @param record - Current active Host record.
 * @returns The stored title; a missing, blank, untrimmed, or over-long title throws ScheduleLogError.
 */
export function retainedTitle(record: ScheduleRecord): string {
  return decodeStoredTitle(record.title)
}

/**
 * Apply a replacement name and instruction to a stored record without touching its rule.
 * @param current - Current active record holding the committed target.
 * @param title - Validated replacement or retained name.
 * @param prompt - Validated replacement or retained instruction.
 * @returns The same record when both are unchanged, otherwise a frozen copy with the new content.
 */
function withContent(current: ScheduleRecord, title: string, prompt: string): ScheduleRecord {
  return title === current.title && prompt === current.prompt
    ? current
    : Object.freeze({ ...current, title, prompt })
}

/**
 * Resolve the requested rule against the current record after the complete expected record has matched.
 *
 * The change kind may differ from the current record's kind; a change whose normalized
 * timing equals the current rule keeps the committed target and only applies the supplied
 * name and instruction, while any other change recomputes the target exactly as creation
 * computes it from the same now.
 */
function changedRecord(
  current: ScheduleRecord,
  title: string,
  prompt: string,
  value: ScheduleTiming | undefined,
  now: number,
): ScheduleRecord {
  if (value === undefined) return withContent(current, title, prompt)
  const change = validateChange(value)
  switch (change.kind) {
    case 'after':
      if (current.kind === 'after' && current.afterSeconds === change.after_seconds) return withContent(current, title, prompt)
      return createAfterScheduleRecord(current.id, prompt, change.after_seconds, now, title)
    case 'at':
      if ((current.kind === 'after' || current.kind === 'at')
        && parseAtInput(change.at) === Date.parse(current.scheduledAt)) return withContent(current, title, prompt)
      return createAtScheduleRecord(current.id, prompt, change.at, now, title)
    case 'every':
      if (current.kind === 'every' && change.every_seconds === current.everySeconds) {
        return withContent(current, title, prompt)
      }
      return createEveryScheduleRecord(current.id, prompt, change.every_seconds, now, title)
    case 'daily': {
      if (current.kind === 'daily') {
        const normalized = parseDailyInput(change.daily)
        if (normalized.time === current.time
          && normalized.timeZone === canonicalizeTimeZone(current.timeZone)) return withContent(current, title, prompt)
      }
      return createDailyScheduleRecord(current.id, prompt, change.daily, now, title)
    }
    case 'weekly': {
      if (current.kind === 'weekly') {
        const normalized = parseWeeklyInput(change.weekly)
        if (normalized.time === current.time
          && normalized.timeZone === canonicalizeTimeZone(current.timeZone)
          && isDeepStrictEqual(normalized.weekdays, current.weekdays)) return withContent(current, title, prompt)
      }
      return createWeeklyScheduleRecord(current.id, prompt, change.weekly, now, title)
    }
    case 'cron': {
      if (current.kind === 'cron') {
        const normalized = parseCronInput(change.cron)
        if (normalized.expression === canonicalizeCronExpression(current.expression)
          && normalized.timeZone === canonicalizeTimeZone(current.timeZone)) return withContent(current, title, prompt)
      }
      return createCronScheduleRecord(current.id, prompt, change.cron, now, title)
    }
    /* v8 ignore next 4 -- validateChange rejects unknown discriminants before this closed union switch. */
    default: {
      const unreachable: never = change
      throw new Error(`Unknown validated timing change: ${String(unreachable)}`)
    }
  }
}

/**
 * Revise one task after the caller checked its revision inside the shared FIFO.
 * Equivalent timing keeps its committed occurrence; resuming advances a missed recurrence.
 * @param current - Stored task.
 * @param patch - Replacement content, timing, target, and activity fields.
 * @param target - Validated replacement destination, when supplied.
 * @param now - Queue-time clock sample.
 * @returns Replacement task retaining its delivery history.
 */
export function resolveScheduleUpdate(
  current: ScheduleTask, patch: SchedulePatch, target: ScheduleTarget | undefined, now: number,
): ScheduleTask {
  const title = patch.title === undefined ? retainedTitle(current.record) : scheduleTitle(patch.title)
  const prompt = patch.prompt === undefined ? current.record.prompt : schedulePrompt(patch.prompt)
  let record = changedRecord(current.record, title, prompt, patch.timing, now)
  let status = patch.active === false ? 'paused' as const : current.status
  if (patch.active === true) {
    if (Date.parse(record.scheduledAt) <= now) {
      if (!isRecurringScheduleRecord(record)) throw new ScheduleInputError('not_future', 'Choose a future timing before resuming this task.')
      const next = resolveRecurringOccurrence(record, now).nextScheduledAt
      if (next === undefined) throw new ScheduleInputError('time_out_of_range', 'No future occurrence is available.')
      record = { ...record, scheduledAt: next }
    }
    status = 'active'
  } else if (patch.timing !== undefined && current.status === 'ended') status = 'active'
  const changedTiming = record.scheduledAt !== current.record.scheduledAt || record.kind !== current.record.kind
  const { pendingDelivery, ...kept } = current
  return {
    ...kept, record, target: target ?? current.target, status,
    updatedAt: new Date(Math.max(now, Date.parse(current.updatedAt ?? '') + 1 || now)).toISOString(),
    ...(pendingDelivery === undefined || changedTiming || target !== undefined ? {} : { pendingDelivery }),
  }
}
