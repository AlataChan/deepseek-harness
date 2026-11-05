/** Clearing ended tasks supersedes catalog reads sent before the mutation. */
import { expect, it, vi } from 'vitest'
import { clearEnded } from '../src/client/clear-ended.ts'
import { createCatalogSource } from '../src/client/catalog-source.ts'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { ScheduleCatalogEntry, ScheduleId } from '@deepseek-ai/dsh-schedule/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
it('keeps the fresh empty catalog when a pre-clear read resolves late', async () => {
  const row: ScheduleCatalogEntry = { id: 'ended' as ScheduleId, kind: 'at', title: 'Ended', prompt: 'Done',
    scheduledAt: '2020-01-01T00:00:00.000Z', target: { kind: 'session' as const, sessionId: 'old' as SessionId },
    involvedSessionIds: [], status: 'ended',
  }
  const stale = Promise.withResolvers<RemoteResult<ScheduleCatalogEntry[]>>()
  const list = vi.fn<() => Promise<RemoteResult<ScheduleCatalogEntry[]>>>().mockReturnValueOnce(stale.promise)
    .mockResolvedValue({ ok: true, value: [] })
  const source = createCatalogSource({ list, remove: async id => ({ ok: true, value: { id, deleted: true } }),
    subscribeChanged: () => () => {}, subscribeReset: () => () => {},
  })
  const dispose = source.hooks.catalog.subscribe(vi.fn())
  try {
    expect(await clearEnded(async () => ({ ok: true, value: { deleted: 1 } }),
      () => source.onRetry(source.hooks.catalog.getSnapshot().readRequest))).toBe(true)
    stale.resolve({ ok: true, value: [row] })
    await stale.promise
    expect(source.hooks.catalog.getSnapshot()).toMatchObject({ status: 'ready', records: [] })
    expect(list).toHaveBeenCalledTimes(2)
  } finally { dispose() }
})

it('refreshes after a rejected clear because some row deletions may already be durable', async () => {
  const refresh = vi.fn(async () => {})
  expect(await clearEnded(async () => { throw new Error('partial deletion') }, refresh)).toBe(false)
  expect(refresh).toHaveBeenCalledOnce()
})
