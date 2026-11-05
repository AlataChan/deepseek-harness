/** Exact model tool schemas and results over the real Host schedule service. */
import { afterEach, expect, it, vi } from 'vitest'
import * as ToolSchedule from '../src/index.ts'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ScheduleTiming } from '@deepseek-ai/dsh-schedule'
import { harness, agentFor, mountToolSchedule } from './harness.ts'

const contexts: Awaited<ReturnType<typeof harness>>[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(test => test.ctx.fiber.dispose())) })
async function setup() {
  const test = await harness(); contexts.push(test)
  const agent = agentFor(test.ctx)
  const scope = await mountToolSchedule(test.ctx, agent)
  return { ...test, agent, scope }
}
async function execute(test: Awaited<ReturnType<typeof setup>>, name: string, args: object, agent: Agent | undefined = test.agent,
  signal = new AbortController().signal) {
  return test.ctx.tools.execute({ callId: ToolCallId('schedule-call'), signal, name, arguments: args,
    ...(agent === undefined ? {} : { agent }),
  })
}
const timings: ScheduleTiming[] = [
  { kind: 'after', after_seconds: 3600 }, { kind: 'at', at: '2099-01-01T00:00:00Z' },
  { kind: 'every', every_seconds: 300 }, { kind: 'daily', daily: { time: '09:00:00.125', time_zone: 'Asia/Shanghai' } },
  { kind: 'weekly', weekly: { time: '09:00:00', time_zone: 'UTC', weekdays: [1, 3] } },
  { kind: 'cron', cron: { expression: '0 9 * * *', time_zone: 'UTC' } },
]
it('registers only create/list/view/edit in the mounting Agent scope and disposes them', async () => {
  const test = await setup()
  for (const name of ['schedule_create', 'schedule_list', 'schedule_view', 'schedule_edit']) {
    expect(test.ctx.tools.get(name, test.agent)).toBeDefined()
    expect(test.ctx.tools.get(name)).toBeUndefined()
  }
  expect(test.ctx.tools.get('schedule_update', test.agent)).toBeUndefined()
  expect(test.ctx.tools.get('schedule_delete', test.agent)).toBeUndefined()
  await test.scope.dispose()
  expect(test.ctx.tools.get('schedule_create', test.agent)).toBeUndefined()
})
it.each(timings)('creates and round-trips the exact $kind record, target, revision and lossless JSON result', async (timing) => {
  const test = await setup()
  const result = await execute(test, 'schedule_create', { title: '  Check  ', prompt: '  Check\n"quoted"  ', timing })
  expect(result.isError).toBe(false)
  const [entry] = await test.service.catalog()
  expect(entry).toBeDefined()
  expect(result.value).toEqual(entry)
  expect(entry).toMatchObject({ kind: timing.kind, title: 'Check', prompt: 'Check\n"quoted"', status: 'active',
    target: { kind: 'new_once' },
  })
  expect(entry?.involvedSessionIds).toContain(test.agent.session.id)
  expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(entry) }])
  expect(await execute(test, 'schedule_list', { limit: 1 })).toMatchObject({ isError: false, value: {
    items: [entry], shown: 1, total: 1, limit: 1, offset: 0,
  } })
  expect(await execute(test, 'schedule_view', { id: entry!.id })).toMatchObject({ isError: false, value: entry })
})
it.each(['session', 'new_once', 'new'] as const)('accepts the $kind destination without activating it', async (kind) => {
  const test = await setup()
  const target = kind === 'session' ? { kind, sessionId: test.agent.id } : { kind, create: { cwd: '/tmp', agentPreset: 'standard' } }
  const result = await execute(test, 'schedule_create', { title: 'Check', prompt: 'Check', timing: timings[0], target })
  expect(result).toMatchObject({ isError: false, value: { target: { kind } } })
  expect(test.resolve).not.toHaveBeenCalled()
})
it('edits and deletes Host-wide tasks by id and returns an optimistic conflict', async () => {
  const test = await setup()
  const task = await test.service.create({ title: 'External', prompt: 'External task', timing: { kind: 'after', after_seconds: 3600 } })
  const edited = await execute(test, 'schedule_edit', { id: task.id, action: 'update', expectedUpdatedAt: task.updatedAt,
    patch: { title: 'Revised', prompt: 'New instruction', timing: timings[2], active: false },
  })
  expect(edited).toMatchObject({ isError: false, value: { id: task.id, title: 'Revised', prompt: 'New instruction', kind: 'every', status: 'paused' } })
  expect(await execute(test, 'schedule_edit', { id: task.id, action: 'update', expectedUpdatedAt: task.updatedAt,
    patch: { active: true },
  })).toMatchObject({ isError: false, value: { id: task.id, code: 'schedule_conflict' } })
  expect(await execute(test, 'schedule_edit', { id: task.id, action: 'delete' })).toMatchObject({ isError: false, value: { id: task.id, deleted: true } })
  expect(await execute(test, 'schedule_view', { id: task.id })).toMatchObject({ isError: false, value: { id: task.id, code: 'schedule_not_found' } })
})
it.each([
  { kind: 'after', after_seconds: 0 }, { kind: 'after', after_seconds: 1.5 },
  { kind: 'every', every_seconds: 59 }, { kind: 'every', every_seconds: Number.MAX_SAFE_INTEGER + 1 },
  { kind: 'at', at: '2020-01-01T00:00:00Z' }, { kind: 'at', at: 'not a date' },
  { kind: 'daily', daily: { time: '25:00:00', time_zone: 'UTC' } },
  { kind: 'daily', daily: { time: '09:00:00', time_zone: 'Not/AZone' } },
  { kind: 'weekly', weekly: { time: '09:00:00', time_zone: 'UTC', weekdays: [] } },
  { kind: 'weekly', weekly: { time: '09:00:00', time_zone: 'UTC', weekdays: [1, 1] } },
  { kind: 'cron', cron: { expression: '* * * * * *', time_zone: 'UTC' } },
])('refuses invalid timing without storing or activating a task %#', async (timing) => {
  const test = await setup()
  const result = await execute(test, 'schedule_create', { title: 'Check', prompt: 'Check', timing })
  if (timing.kind === 'after' && timing.after_seconds === 1.5) expect(result.isError).toBe(true)
  else { expect(result.isError).toBe(false); expect(result.value).toHaveProperty('code') }
  expect((await test.service.list()).total).toBe(0)
  expect(test.resolve).not.toHaveBeenCalled()
})
it.each(['', ' '.repeat(2), 'x'.repeat(121)])('refuses invalid title %j', async (title) => {
  const test = await setup()
  expect(await execute(test, 'schedule_create', { title, prompt: 'Check', timing: timings[0] }))
    .toMatchObject({ isError: false, value: { code: 'invalid_prompt' } })
  expect((await test.service.list()).total).toBe(0)
})
it.each([{ limit: 0 }, { limit: 501 }, { offset: -1 }, { offset: 1.5 }])('refuses invalid list bounds %j', async (args) => {
  const test = await setup()
  const result = await execute(test, 'schedule_list', args)
  if (args.offset === 1.5) expect(result.isError).toBe(true)
  else expect(result).toMatchObject({ isError: false, value: { code: 'invalid_rule' } })
})
it.each(['schedule_create', 'schedule_list', 'schedule_view', 'schedule_edit'])('refuses delegated caller of %s before mutation', async (name) => {
  const test = await setup()
  const child = agentFor(test.ctx, 'child', { delegationDepth: 1 })
  await mountToolSchedule(test.ctx, child)
  const args = name === 'schedule_create' ? { title: 'Check', prompt: 'Check', timing: timings[0] }
    : name === 'schedule_edit' ? { id: 'missing', action: 'delete' } : name === 'schedule_view' ? { id: 'missing' } : {}
  expect(await execute(test, name, args, child)).toMatchObject({ isError: false, value: { code: 'subagent_session' } })
  expect((await test.service.list()).total).toBe(0)
})
it('withholds internal storage failures and leaves cancellation without a durable write', async () => {
  const test = await setup()
  vi.spyOn(test.service, 'create').mockRejectedValueOnce(new Error('private storage path'))
  expect(await execute(test, 'schedule_create', { title: 'Check', prompt: 'Check', timing: timings[0] }))
    .toMatchObject({ isError: false, value: { code: 'internal_error', message: 'The schedule operation failed.' } })
  const result = await execute(test, 'schedule_create', { title: 'Check', prompt: 'Check', timing: timings[0] }, test.agent, AbortSignal.abort())
  expect(result.isError || (result.value !== null && typeof result.value === 'object' && 'code' in result.value)).toBe(true)
  expect((await test.service.list()).total).toBe(0)
  expect(SessionId('original')).toBe(test.agent.session.id)
})

it('refuses Agent-less execution in all four actual ToolRuntime registrations', async () => {
  const test = await harness(); contexts.push(test)
  await test.ctx.plugin(ToolSchedule)
  for (const [name, args] of [
    ['schedule_create', { title: 'None', prompt: 'None', timing: timings[0] }], ['schedule_list', {}],
    ['schedule_view', { id: 'missing' }], ['schedule_edit', { id: 'missing', action: 'delete' }],
  ] as const) {
    expect(await test.ctx.tools.execute({ callId: ToolCallId('agentless'), signal: new AbortController().signal,
      name, arguments: args,
    })).toMatchObject({ isError: false, value: { code: 'internal_error' } })
  }
  expect(await test.service.catalog()).toEqual([])
})
it('presents each current tool and validates edit operations before storage', async () => {
  const test = await setup()
  for (const [name, args, title, kind, rawInput] of [
    ['schedule_create', { title: 'Inspect', prompt: 'Inspect', timing: { kind: 'after', after_seconds: 60 } }, 'Create reminder', 'other', 'Inspect'],
    ['schedule_list', {}, 'List reminders', 'read', undefined],
    ['schedule_view', { id: 'task' }, 'View reminder', 'read', 'task'],
    ['schedule_edit', { id: 'task', action: 'delete' }, 'Edit reminder', 'other', 'task'],
  ] as const) {
    expect(test.ctx.tools.get(name, test.agent)?.presentCall?.(args))
      .toEqual({ card: 'generic', title, kind, ...(rawInput === undefined ? {} : { rawInput }) })
  }
  expect(await execute(test, 'schedule_edit', { id: 'missing', action: 'update' }))
    .toMatchObject({ value: { code: 'invalid_rule' } })
  expect(await execute(test, 'schedule_edit', { id: 'missing', action: 'delete', patch: { title: 'Forbidden' } }))
    .toMatchObject({ value: { code: 'invalid_rule' } })
  vi.spyOn(test.service, 'view').mockRejectedValueOnce(new Error('private read failure'))
  expect(await execute(test, 'schedule_view', { id: 'missing' })).toMatchObject({ value: { code: 'internal_error' } })
  const task = await test.service.create({ title: 'Target', prompt: 'Inspect', timing: { kind: 'after', after_seconds: 3600 } })
  expect(await execute(test, 'schedule_edit', { id: task.id, action: 'update', expectedUpdatedAt: task.updatedAt,
    patch: { target: { kind: 'session', sessionId: test.agent.id } },
  })).toMatchObject({ value: { target: { kind: 'session', sessionId: test.agent.id } } })
  vi.spyOn(test.service, 'edit').mockRejectedValueOnce(new Error('private write failure'))
  expect(await execute(test, 'schedule_edit', { id: task.id, action: 'delete' })).toMatchObject({ value: { code: 'internal_error' } })
})
