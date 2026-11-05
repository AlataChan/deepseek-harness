/** Pure timing edits accept every recurrence kind, compute creation targets, and preserve targets for normalized no-ops. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as domain from '../src/domain.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import { resolveScheduleUpdate, retainedTitle } from '../src/update.ts'
import { editRuleForTest, harness } from './harness.ts'
import type { ScheduleRecord, ScheduleTiming, ScheduleToolError, SchedulePatch } from '../src/types.ts'

const now = Date.parse('2026-09-16T00:00:00.125Z')
const id = domain.ScheduleId('timing')
const prompt = 'Keep exact prompt\nwith details'
/** Title every stored record carries; it is the instruction's first line, supplied at creation. */
const storedTitle = 'Keep exact prompt'
const after = domain.createAfterScheduleRecord(id, prompt, 60, now, storedTitle)
const at = domain.createAtScheduleRecord(id, prompt, '2026-09-16T01:00:00.125Z', now, storedTitle)
const every = domain.createEveryScheduleRecord(id, prompt, 300, now, storedTitle)
const daily = domain.createDailyScheduleRecord(id, prompt, { time: '09:00:00.125', time_zone: 'US/Eastern' }, now, storedTitle)
const weekly = domain.createWeeklyScheduleRecord(id, prompt, {
  time: '09:00:00.125', time_zone: 'US/Eastern', weekdays: [1, 3],
}, now, storedTitle)
const cron = domain.createCronScheduleRecord(id, prompt, {
  expression: '0 9 * * 1-5', time_zone: 'US/Eastern',
}, now, storedTitle)
afterEach(() => vi.restoreAllMocks())

function update(current: ScheduleRecord, change: ScheduleTiming, acceptedAt = now) {
  return editRuleForTest(current, change, acceptedAt)
}

/** Target changes covering every kind a timing change can select. */
const targetChanges: Record<'at' | 'every' | 'daily' | 'weekly' | 'cron', ScheduleTiming> = {
  at: { kind: 'at', at: '2026-09-20T10:30:00.321+08:00' },
  every: { kind: 'every', every_seconds: 600 },
  daily: { kind: 'daily', daily: { time: '08:00:00.125', time_zone: 'Asia/Shanghai' } },
  weekly: { kind: 'weekly', weekly: { time: '07:00:00.125', time_zone: 'Asia/Shanghai', weekdays: [2, 5] } },
  cron: { kind: 'cron', cron: { expression: '0 7 * * 2,5', time_zone: 'Asia/Shanghai' } },
}

/** Recompute the record creation itself would produce from the same accepted save time. */
function createdFrom(change: ScheduleTiming): ScheduleRecord {
  switch (change.kind) {
    case 'after': return domain.createAfterScheduleRecord(id, prompt, change.after_seconds, now, storedTitle)
    case 'at': return domain.createAtScheduleRecord(id, prompt, change.at, now, storedTitle)
    case 'every': return domain.createEveryScheduleRecord(id, prompt, change.every_seconds, now, storedTitle)
    case 'daily': return domain.createDailyScheduleRecord(id, prompt, change.daily, now, storedTitle)
    case 'weekly': return domain.createWeeklyScheduleRecord(id, prompt, change.weekly, now, storedTitle)
    case 'cron': return domain.createCronScheduleRecord(id, prompt, change.cron, now, storedTitle)
  }
}

const storedRecords: ScheduleRecord[] = [after, at, every, daily, weekly, cron]
const transitions = storedRecords.flatMap(current => Object.keys(targetChanges)
  .map(kind => [current.kind, kind, current] as const))

it.each(transitions)('converts a %s task to a %s rule with the creation target, identity, and prompt', (storedKind, kind, current) => {
  expect(storedKind).toBe(current.kind)
  const change = targetChanges[kind as keyof typeof targetChanges]
  const result = update(current, change)
  expect(result).toEqual({ id, updated: true, record: createdFrom(change) })
  if (!('record' in result)) throw new Error('Expected a new record')
  expect(result.record).toMatchObject({ id, prompt, kind })
  expect(Date.parse(result.record.scheduledAt)).toBeGreaterThan(now)
})

it('does not treat a cross-kind change to the committed instant as a no-op', () => {
  for (const current of [every, daily, weekly, cron]) {
    expect(update(current, { kind: 'at', at: current.scheduledAt }))
      .toEqual({ id, updated: true, record: domain.createAtScheduleRecord(id, prompt, current.scheduledAt, now, storedTitle) })
  }
})

it('refuses a stale revision before applying a cross-kind timing change', async () => {
  const test = await harness(); try {
    const task = await test.service.create({ title: storedTitle, prompt, timing: targetChanges.every })
    await test.service.edit({ id: task.id, action: 'update', patch: { timing: targetChanges.daily } })
    expect(await test.service.edit({ id: task.id, action: 'update', expectedUpdatedAt: task.updatedAt ?? null, patch: { title: '  ', timing: targetChanges.weekly } })).toEqual({ id: task.id, code: 'schedule_conflict' })
  } finally { await test.ctx.fiber.dispose() }
})

it.each([after, at])('converts changed $kind targets to at without changing identity or prompt', (current) => {
  expect(update(current, { kind: 'at', at: '2026-09-16T10:30:00.321+08:00' })).toEqual({
    id, updated: true, record: { id, kind: 'at', title: storedTitle, prompt, scheduledAt: '2026-09-16T02:30:00.321Z' },
  })
  expect(update(current, { kind: 'at', at: { date: '2026-09-16', time: '10:30:00.321', time_zone: 'Asia/Shanghai' } }))
    .toEqual({
      id, updated: true, record: { id, kind: 'at', title: storedTitle, prompt, scheduledAt: '2026-09-16T02:30:00.321Z' },
    })
})

it.each([after, at])('retains original $kind fields when the equivalent target is already due', (current) => {
  const localTime = current.kind === 'after' ? '08:01:00.125' : '09:00:00.125'
  for (const input of [current.scheduledAt, `2026-09-16T${localTime}+08:00`, {
    date: '2026-09-16', time: localTime, time_zone: 'Asia/Shanghai',
  }]) {
    const result = update(current, { kind: 'at', at: input }, Date.parse('2026-09-17T00:00:00Z'))
    expect(result).toEqual({ id, updated: false, record: current })
    if (!('record' in result)) throw new Error('Expected unchanged record')
    expect(result.record).toBe(current)
  }
})

it('reanchors changed every intervals at the save sample but never moves an unchanged interval', () => {
  expect(update(every, { kind: 'every', every_seconds: 600 }, now + 75_000)).toEqual({
    id, updated: true, record: { ...every, everySeconds: 600, scheduledAt: '2026-09-16T00:11:15.125Z' },
  })
  expect(update(every, { kind: 'every', every_seconds: 300 }, now + 900_000))
    .toEqual({ id, updated: false, record: every })
})

it('changes daily time and zone, preserving milliseconds and choosing the first strictly future date', () => {
  expect(update(daily, { kind: 'daily', daily: { time: '08:00:00.125', time_zone: 'Asia/Shanghai' } })).toEqual({
    id, updated: true, record: {
      id, kind: 'daily', title: storedTitle, prompt, time: '08:00:00.125', timeZone: 'Asia/Shanghai',
      scheduledAt: '2026-09-17T00:00:00.125Z',
    },
  })
})

it.each([
  [{ time: '10:00:00.125', time_zone: 'America/New_York' }, '2026-09-16T14:00:00.125Z'],
  [{ time: '09:00:00.125', time_zone: 'UTC' }, '2026-09-16T09:00:00.125Z'],
] as const)('changes daily time or zone independently without changing identity (%j)', (input, scheduledAt) => {
  expect(update(daily, { kind: 'daily', daily: input })).toMatchObject({
    id, updated: true, record: { id, kind: 'daily', prompt, scheduledAt },
  })
})

it('keeps exact stored zone spelling and committed target for equivalent daily selectors', () => {
  const current: ScheduleRecord = { ...daily, timeZone: 'US/Eastern', time: '09:00:00.100', scheduledAt: at.scheduledAt }
  expect(update(current, { kind: 'daily', daily: { time: '09:00:00.1', time_zone: 'America/New_York' } }, now + 86_400_000))
    .toEqual({ id, updated: false, record: current })
})

it.each([
  ['2026-03-08T00:00:00Z', '02:30:00', '2026-03-09T06:30:00.000Z'],
  ['2026-11-01T00:00:00Z', '01:30:00', '2026-11-01T05:30:00.000Z'],
])('uses existing gap/overlap semantics at %s', (acceptedAt, time, scheduledAt) => {
  expect(update(daily, { kind: 'daily', daily: { time, time_zone: 'America/New_York' } }, Date.parse(acceptedAt)))
    .toMatchObject({ updated: true, record: { scheduledAt } })
})

it('accepts reordered patch fields under the same revision token', async () => {
  const test = await harness(); try {
    const task = await test.service.create({ title: storedTitle, prompt, timing: targetChanges.every })
    const patch = Object.fromEntries(Object.entries({ title: 'Reordered', prompt: 'Replacement' }).reverse())
    expect(await test.service.edit({ id: task.id, action: 'update', expectedUpdatedAt: task.updatedAt ?? null, patch })).toMatchObject({ title: 'Reordered', prompt: 'Replacement' })
  } finally { await test.ctx.fiber.dispose() }
})

it.each([null, 'missing-revision', 'not a date'])('refuses an obsolete revision token %j without writing', async (expectedUpdatedAt) => {
  const test = await harness(); try {
    const task = await test.service.create({ title: storedTitle, prompt, timing: targetChanges.every })
    expect(await test.service.edit({ id: task.id, action: 'update', expectedUpdatedAt, patch: { title: 'Rejected' } })).toEqual({ id: task.id, code: 'schedule_conflict' })
    expect(await test.service.view({ id: task.id })).toEqual(task)
  } finally { await test.ctx.fiber.dispose() }
})

const invalidChanges: [ScheduleRecord, unknown, string][] = [
  [at, null, 'invalid_rule'], [at, [], 'invalid_rule'], [at, 'at', 'invalid_rule'],
  [at, {}, 'invalid_rule'], [at, { kind: 'after', after_seconds: 0 }, 'invalid_rule'],
  [at, { kind: 'at', at: at.scheduledAt, prompt: 'Overwrite' }, 'invalid_rule'],
  [at, { kind: 'at', every_seconds: 300 }, 'invalid_rule'], [at, { at: at.scheduledAt }, 'invalid_rule'],
  [at, { kind: 'at' }, 'invalid_rule'],
  [at, { kind: 'at', at: 'invalid' }, 'invalid_rule'],
  [at, { kind: 'at', at: '2026-02-30T00:00:00Z' }, 'invalid_rule'],
  [at, { kind: 'at', at: '2026-09-15T00:00:00Z' }, 'not_future'],
  [at, { kind: 'at', at: '0001-01-01T00:00:00+01:00' }, 'time_out_of_range'],
  [at, { kind: 'at', at: { date: '2026-09-16', time: '12:00:00', time_zone: 'Invalid/Zone' } }, 'invalid_time_zone'],
  [at, { kind: 'at', at: { date: '2026-09-16', time: '12:00:00', time_zone: 'UTC', extra: true } }, 'invalid_rule'],
  [at, { kind: 'at', at: { date: '2027-03-14', time: '02:30:00', time_zone: 'America/New_York' } }, 'invalid_rule'],
  [every, { kind: 'every', every_seconds: 59 }, 'frequency_too_high'],
  [every, { kind: 'every', every_seconds: '300' }, 'invalid_rule'],
  [every, { kind: 'every', every_seconds: 300.5 }, 'invalid_rule'],
  [every, { kind: 'every', every_seconds: Number.MAX_SAFE_INTEGER }, 'time_out_of_range'],
  [daily, { kind: 'daily', daily: { time: '24:00:00', time_zone: 'UTC' } }, 'invalid_rule'],
  [daily, { kind: 'daily', daily: { time: '10:00:00', time_zone: '+08:00' } }, 'invalid_time_zone'],
  [daily, { kind: 'daily', daily: { time: '10:00:00', time_zone: 'UTC', extra: true } }, 'invalid_rule'],
]

describe('strict wire timing validation', () => {
  it.each(invalidChanges)('rejects invalid timing %#', (current, change, code) => {
    const result = update(current, change as ScheduleTiming) as ScheduleToolError
    expect(result).toMatchObject({ code })
    expect(result.message).toEqual(expect.any(String))
  })
})

it('rejects daily exhaustion using the actual acceptance clock', () => {
  expect(update(daily, { kind: 'daily', daily: { time: '00:00:00', time_zone: 'UTC' } }, Date.parse('9999-12-31T23:59:59.999Z')))
    .toMatchObject({ code: 'time_out_of_range' })
})

it('does not turn programming failures in decoding or timing calculation into public input results', () => {
  const failure = new Error('Programming failure')
  vi.spyOn(domain, 'parseAtInput').mockImplementationOnce(() => { throw failure })
  expect(() => update(at, { kind: 'at', at: at.scheduledAt })).toThrow(failure)
})

it('changes revision when interval metadata changes even before its occurrence', async () => {
  const test = await harness(); try {
    const task = await test.service.create({ title: storedTitle, prompt, timing: targetChanges.every })
    await test.service.edit({ id: task.id, action: 'update', patch: { timing: targetChanges.daily } })
    expect(await test.service.edit({ id: task.id, action: 'update', expectedUpdatedAt: task.updatedAt ?? null, patch: { title: '  ', timing: targetChanges.weekly } })).toEqual({ id: task.id, code: 'schedule_conflict' })
  } finally { await test.ctx.fiber.dispose() }
})

it('preserves the stored title through a timing edit', () => {
  const result = editRuleForTest(daily, { kind: 'every', every_seconds: 600 }, now)
  if (!('record' in result)) throw new Error('Expected a new record')
  expect(result.record.title).toBe(storedTitle)
})

it('applies a replacement name and instruction without moving the committed target', () => {
  for (const current of storedRecords) {
    const result = editRuleForTest(current, undefined, now, { title: 'Renamed', prompt: 'New instruction' })
    expect(result).toEqual({ id, updated: true, record: { ...current, title: 'Renamed', prompt: 'New instruction' } })
    if (!('record' in result)) throw new Error('Expected a new record')
    expect(result.record.scheduledAt).toBe(current.scheduledAt)
    expect(result.record.kind).toBe(current.kind)
  }
})

it.each<[string, Pick<SchedulePatch, 'title' | 'prompt'>, Pick<SchedulePatch, 'title' | 'prompt'>]>([
  ['name', { title: 'Only the name' }, { title: 'Only the name', prompt }],
  ['instruction', { prompt: 'Only the instruction' }, { title: storedTitle, prompt: 'Only the instruction' }],
])('applies a %s-only change while keeping the other content and the committed target', (_field, content, expected) => {
  for (const current of storedRecords) {
    const result = editRuleForTest(current, undefined, now, content)
    expect(result).toEqual({ id, updated: true, record: { ...current, ...expected } })
    if (!('record' in result)) throw new Error('Expected a new record')
    expect(result.record.scheduledAt).toBe(current.scheduledAt)
  }
})

it('applies name, instruction, and a changed rule together with the creation target', () => {
  const weekly = { time: '07:00:00.125', time_zone: 'Asia/Shanghai', weekdays: [2, 5] }
  expect(editRuleForTest(every, { kind: 'weekly', weekly }, now, {
    title: 'Renamed', prompt: 'New instruction',
  })).toEqual({
    id, updated: true, record: domain.createWeeklyScheduleRecord(id, 'New instruction', weekly, now, 'Renamed'),
  })
})

it('keeps the committed target when an equivalent rule change also edits content', () => {
  expect(editRuleForTest(every, { kind: 'every', every_seconds: 300 }, now + 900_000, { title: 'Renamed' }))
    .toEqual({ id, updated: true, record: { ...every, title: 'Renamed' } })
  expect(editRuleForTest(after, { kind: 'at', at: after.scheduledAt }, now, { prompt: 'New instruction' }))
    .toEqual({ id, updated: true, record: { ...after, prompt: 'New instruction' } })
  const alias: ScheduleRecord = { ...daily, time: '09:00:00.100', timeZone: 'US/Eastern' }
  expect(editRuleForTest(alias, {
    kind: 'daily', daily: { time: '09:00:00.1', time_zone: 'America/New_York' },
  }, now + 86_400_000, { title: 'Renamed' })).toEqual({ id, updated: true, record: { ...alias, title: 'Renamed' } })
})

it('writes nothing when trimmed content already matches every stored value', () => {
  for (const current of storedRecords) {
    expect(editRuleForTest(current, undefined, now)).toEqual({ id, updated: false, record: current })
    expect(editRuleForTest(current, undefined, now, {
      title: `  ${current.title}  `, prompt: `  ${current.prompt}  `,
    })).toEqual({ id, updated: false, record: current })
  }
})

it.each<[string, Pick<SchedulePatch, 'title' | 'prompt'>, string]>([
  ['title', { title: '   ' }, 'title is required and must be non-empty after trimming.'],
  ['title', { title: 'x'.repeat(domain.MAX_TITLE_LENGTH + 1) }, 'title must be at most 120 characters.'],
  ['prompt', { prompt: ' \n ' }, 'prompt must be non-empty after trimming.'],
])('rejects an invalid replacement %s with its stable message', (_field, content, message) => {
  expect(editRuleForTest(daily, undefined, now, content)).toEqual({ code: 'invalid_prompt', message })
})

it.each<[string, unknown]>([['title', { title: 7 }], ['prompt', { prompt: 7 }]])(
  'rejects a non-string replacement %s at the wire boundary',
  (_field, content) => {
    expect(editRuleForTest(daily, undefined, now, content as Pick<SchedulePatch, 'title' | 'prompt'>))
      .toMatchObject({ code: 'invalid_prompt' })
  },
)

it('checks the revision before validating replacement content', async () => {
  const test = await harness(); try {
    const task = await test.service.create({ title: storedTitle, prompt, timing: targetChanges.every })
    await test.service.edit({ id: task.id, action: 'update', patch: { timing: targetChanges.daily } })
    expect(await test.service.edit({ id: task.id, action: 'update', expectedUpdatedAt: task.updatedAt ?? null, patch: { title: '  ', timing: targetChanges.weekly } })).toEqual({ id: task.id, code: 'schedule_conflict' })
  } finally { await test.ctx.fiber.dispose() }
})

it('returns the stored title and refuses a record without a valid one', () => {
  expect(retainedTitle(daily)).toBe(storedTitle)
  for (const title of ['   ', ` ${storedTitle}`, 'x'.repeat(domain.MAX_TITLE_LENGTH + 1)]) {
    expect(() => retainedTitle({ ...daily, title })).toThrow(domain.ScheduleLogError)
  }
})

it('resumes overdue recurring tasks, refuses past one-shots, and reactivates ended tasks with new timing', () => {
  const target = { kind: 'session' as const, sessionId: SessionId('owner') }
  const task = { target, involvedSessionIds: [target.sessionId], record: every, status: 'paused' as const,
    updatedAt: '2026-09-16T00:00:00.125Z', pendingDelivery: { targetSessionId: target.sessionId },
  }
  const resumed = resolveScheduleUpdate(task, { active: true }, undefined, now + 900000)
  expect(resumed.status).toBe('active')
  expect(Date.parse(resumed.record.scheduledAt)).toBeGreaterThan(now + 900000)
  expect(resumed).not.toHaveProperty('pendingDelivery')
  expect(() => resolveScheduleUpdate({ ...task, record: after }, { active: true }, undefined, now + 900000))
    .toThrow('Choose a future timing')
  expect(resolveScheduleUpdate({ ...task, status: 'ended' }, { timing: { kind: 'after', after_seconds: 120 } }, undefined, now))
    .toHaveProperty('status', 'active')
  expect(resolveScheduleUpdate({ ...task, record: after }, { timing: { kind: 'after', after_seconds: 60 } }, undefined, now).record)
    .toEqual(after)
  expect(resolveScheduleUpdate(task, { title: 'Keep reservation' }, undefined, now).pendingDelivery).toEqual(task.pendingDelivery)
  expect(resolveScheduleUpdate(task, { target: { kind: 'new' } }, { kind: 'new', create: {} }, now)).not.toHaveProperty('pendingDelivery')
  expect(resolveScheduleUpdate({ ...task, updatedAt: '2026-09-17T00:00:00.000Z' }, { title: 'Rollback' }, undefined, now).updatedAt)
    .toBe('2026-09-17T00:00:00.001Z')
  const final = { ...task, record: domain.createEveryScheduleRecord(id, prompt, 60,
    Date.parse('9999-12-31T23:58:00Z'), storedTitle) }
  expect(() => resolveScheduleUpdate(final, { active: true }, undefined, Date.parse('9999-12-31T23:59:59Z')))
    .toThrow('No future occurrence')
})
