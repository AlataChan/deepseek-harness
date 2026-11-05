/** Built CLI, public Remote requests, and persisted task files; seeded receipts are not delivery evidence. */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { DailyScheduleRecord } from '@deepseek-ai/dsh-schedule'
import { expect, it } from 'vitest'
import { withDefaultWeb, webGet, webRequest } from './default-web-process.ts'

const id = 'retained-remote-task' as DailyScheduleRecord['id']
const sessionId = SessionId('unloaded-owner')
const record: DailyScheduleRecord = {
  id, kind: 'daily', title: 'Retained instruction', prompt: 'Retained instruction\nwith a second line',
  time: '09:00:00.125', timeZone: 'Asia/Shanghai', scheduledAt: '2099-01-01T01:00:00.125Z',
}
const lastDelivery = {
  scheduledAt: '2026-01-01T01:00:00.125Z', deliveredAt: '2026-01-01T01:00:01.250Z', messageId: 'saved-receipt',
}
const task = {
  sessionId, record, status: 'active', lastDelivery,
  deliveryHistory: { earlierRecordsUnavailable: false, records: [{ ...lastDelivery, prompt: record.prompt }] },
}
const taskPath = (root: string) => join(root, 'home', 'storages', 'schedule.json')

async function seed(root: string, bytes: string): Promise<void> {
  await mkdir(join(root, 'home', 'storages'), { recursive: true })
  await writeFile(taskPath(root), bytes)
}

function encoded(value: unknown): string {
  return `${JSON.stringify({ unit: { name: 'schedule', version: 1 }, global: null, tables: { tasks: { [id]: value } } }, null, 2)}\n`
}

async function connect(url: string, signal: AbortSignal) {
  const auth = await webGet(url, signal)
  const cookie = auth.headers['set-cookie']?.[0]?.split(';', 1)[0]
  if (cookie === undefined) throw new Error('Owned Web process did not issue its authentication cookie')
  return async (method: string, args: Record<string, unknown>) => {
    const rpcId = randomUUID()
    const response = await webRequest(new URL(`/api/${method}`, url), signal, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }),
    })
    expect(response.status, response.text).toBe(200)
    const envelope = JSON.parse(response.text) as { type?: unknown; rpcId?: unknown; result?: unknown }
    expect(envelope).toMatchObject({ type: 'server-response', rpcId })
    return envelope.result
  }
}

it('edits a retained task through built remotes and preserves its identity and receipts after cold startup', async (test) => {
  let persisted = encoded(task)
  let updated = record
  let revision: string | undefined
  const target = { kind: 'session', sessionId }
  const receipt = { ...lastDelivery, targetSessionId: sessionId }
  const expectedHistory = { ok: true, value: { id, records: [{ ...receipt, prompt: record.prompt }],
    earlierRecordsUnavailable: false, earlierRecordsPruned: false, retention: { days: 30, records: 200 },
  } }
  await withDefaultWeb(test, async ({ root, url }) => {
    const rpc = await connect(url, test.signal)
    expect(await rpc('schedule/catalog', {})).toEqual({ ok: true, value: [{ ...record, target,
      involvedSessionIds: [sessionId], status: 'active', lastDelivery: receipt,
    }] })
    expect(await readFile(taskPath(root), 'utf8')).toBe(persisted)
    expect(await rpc('schedule/history', { request: { id, limit: 20 } })).toEqual(expectedHistory)
    await rpc('session/create', { request: { sessionId, cwd: root } })
    const instant = new Date(Date.now() + 12 * 60 * 60 * 1000); instant.setUTCMilliseconds(125)
    updated = { ...record, time: instant.toISOString().slice(11, 23), timeZone: 'UTC', scheduledAt: instant.toISOString() }
    const timing = { kind: 'daily', daily: { time: updated.time, time_zone: 'UTC' } }
    const result = await rpc('schedule/edit', { request: { id, action: 'update', expectedUpdatedAt: null, patch: { timing } } })
    expect(result).toMatchObject({ ok: true, value: { ...updated, target, status: 'active', lastDelivery: receipt } })
    persisted = await readFile(taskPath(root), 'utf8')
    const written = JSON.parse(persisted) as { tables: { tasks: Record<string, { updatedAt: string }> } }
    revision = written.tables.tasks[id]?.updatedAt
    expect(revision).toEqual(expect.any(String))
    expect(JSON.parse(persisted)).toEqual({ unit: { name: 'schedule', version: 2 }, global: null,
      tables: { tasks: { [id]: { target, involvedSessionIds: [sessionId], record: updated, status: 'active',
        updatedAt: revision, lastDelivery: receipt,
        deliveryHistory: { earlierRecordsUnavailable: false, records: [{ ...receipt, prompt: record.prompt }] },
      } } },
    })
    expect(await rpc('schedule/history', { request: { id, limit: 20 } })).toEqual(expectedHistory)
    expect(await rpc('schedule/edit', { request: { id, action: 'update', expectedUpdatedAt: null, patch: { timing } } }))
      .toEqual({ ok: true, value: { id, code: 'schedule_conflict' } })
    expect(await readFile(taskPath(root), 'utf8')).toBe(persisted)
  }, { prepare: root => seed(root, persisted) })
  await withDefaultWeb(test, async ({ root, url }) => {
    const rpc = await connect(url, test.signal)
    expect(await rpc('schedule/catalog', {})).toEqual({ ok: true, value: [{ ...updated, target,
      involvedSessionIds: [sessionId], status: 'active', lastDelivery: receipt, updatedAt: revision,
    }] })
    expect(await rpc('schedule/history', { request: { id, limit: 20 } })).toEqual(expectedHistory)
    expect(await readFile(taskPath(root), 'utf8')).toBe(persisted)
    expect(await rpc('schedule/edit', { request: { id, action: 'update', expectedUpdatedAt: revision,
      patch: { title: 'Retained after restart' },
    } })).toMatchObject({ ok: true, value: { ...updated, title: 'Retained after restart', target } })
  }, { prepare: root => seed(root, persisted) })
})

it('creates and idempotently adopts a seeded target without modifying the task file', async (test) => {
  const persisted = encoded(task)
  const target = { kind: 'session', sessionId }
  const receipt = { ...lastDelivery, targetSessionId: sessionId }
  const entry = { ...record, target, involvedSessionIds: [sessionId], status: 'active', lastDelivery: receipt }
  await withDefaultWeb(test, async ({ root, url }) => {
    const rpc = await connect(url, test.signal)
    const create = { request: { sessionId, cwd: root } }
    const expectedCreate = { ok: true, value: { sessionId, agentPreset: 'standard' } }
    expect(await rpc('session/create', create)).toEqual(expectedCreate)
    expect(await rpc('session/create', create)).toEqual(expectedCreate)
    expect(await rpc('schedule/list', { request: { active: true } })).toEqual({ ok: true,
      value: { items: [entry], shown: 1, total: 1, limit: 100, offset: 0 },
    })
    expect(await rpc('schedule/history', { request: { id, limit: 20 } })).toEqual({ ok: true, value: { id,
      records: [{ ...receipt, prompt: record.prompt }], earlierRecordsUnavailable: false, earlierRecordsPruned: false,
      retention: { days: 30, records: 200 },
    } })
    expect(await readFile(taskPath(root), 'utf8')).toBe(persisted)
  }, { prepare: root => seed(root, persisted) })
})
