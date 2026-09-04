/** session.listEntries: session-derived root, capability mapping, and closed errors. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceEntries, WorkspaceEntriesError } from '@deepseek-ai/dsh-host-workspace-entries'
import type { WorkspaceEntriesListing, WorkspaceEntriesListRequest } from '@deepseek-ai/dsh-host-workspace-entries'
import { createSessionTestRemote, testSessionPersistence } from './test-remote.ts'

/** Programmable listing backend: records the Host-derived request. */
class StubEntries extends WorkspaceEntries {
  last: { request: WorkspaceEntriesListRequest; signal: AbortSignal | undefined } | undefined
  impl: (
    request: WorkspaceEntriesListRequest,
    signal?: AbortSignal,
  ) => Promise<WorkspaceEntriesListing> = request => Promise.resolve({
    path: request.path ?? request.root,
    root: request.root,
    entries: [],
    truncated: false,
  })

  override list(
    request: WorkspaceEntriesListRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceEntriesListing> {
    this.last = { request, signal }
    return this.impl(request, signal)
  }
}

function requireBackend(backend: StubEntries | undefined): StubEntries {
  if (backend === undefined) throw new Error('expected workspaceEntries in harness')
  return backend
}

async function harness(options: {
  persistence?: {
    list: (signal?: AbortSignal) => Promise<Array<{
      version: 0
      id: SessionId
      createdAt: number
      isSeeded: boolean
      cwd?: string
    }>>
  }
  entries?: boolean
} = {}) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
    list: options.persistence?.list ?? (() => Promise.resolve([])),
    inspect: () => Promise.reject(new Error('listEntries must not inspect a Session')),
  }) as never)
  if (options.entries !== false) await ctx.plugin(StubEntries)
  const remote = createSessionTestRemote(ctx, {
    defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
    cwd: '/tmp',
  })
  return { remote, ctx, backend: ctx.get('workspaceEntries') as StubEntries | undefined }
}

describe('session/listEntries', () => {
  it('fails with entries-unavailable when the workspace-entries service is absent', async () => {
    const { remote, ctx } = await harness({ entries: false })
    const session = ctx.sessions.create(SessionId('live'), { meta: { cwd: '/proj' } })
    await expect(remote.listEntries({ sessionId: session.id }))
      .resolves.toMatchObject({ ok: false, error: { code: 'session/entries-unavailable', details: {} } })
  })

  it('fails with session/not-found for an unknown id and does not call list', async () => {
    const { remote, backend } = await harness()
    await expect(remote.listEntries({ sessionId: SessionId('missing') }))
      .resolves.toMatchObject({
        ok: false,
        error: { code: 'session/not-found', details: { sessionId: 'missing' } },
      })
    expect(requireBackend(backend).last).toBeUndefined()
  })

  it('fails with entries-unreadable when a live session has no cwd', async () => {
    const { remote, ctx, backend } = await harness()
    const session = ctx.sessions.create(SessionId('nocwd'))
    await expect(remote.listEntries({ sessionId: session.id }))
      .resolves.toMatchObject({
        ok: false,
        error: { code: 'session/entries-unreadable', details: { path: '' } },
      })
    expect(requireBackend(backend).last).toBeUndefined()
  })

  it('uses the live session cwd as root and omits path when the client sent none', async () => {
    const { remote, ctx, backend } = await harness()
    const session = ctx.sessions.create(SessionId('live'), { meta: { cwd: '/proj' } })
    await expect(remote.listEntries({ sessionId: session.id }))
      .resolves.toEqual({
        ok: true,
        value: { path: '/proj', root: '/proj', entries: [], truncated: false },
      })
    expect(requireBackend(backend).last?.request).toEqual({ root: '/proj' })
  })

  it('forwards an absolute path while still deriving root from the session cwd', async () => {
    const { remote, ctx, backend } = await harness()
    const listedBackend = requireBackend(backend)
    const session = ctx.sessions.create(SessionId('live'), { meta: { cwd: '/proj' } })
    listedBackend.impl = async (listed) => {
      if (listed.path === '/etc') {
        throw new WorkspaceEntriesError('entries-outside-root', '/etc', '/etc is outside /proj', '/proj')
      }
      return { path: listed.path ?? listed.root, root: listed.root, entries: [], truncated: false }
    }
    await expect(remote.listEntries({ sessionId: session.id, path: '/etc' }))
      .resolves.toMatchObject({
        ok: false,
        error: { code: 'session/entries-outside-root', details: { path: '/etc', root: '/proj' } },
      })
    expect(listedBackend.last?.request).toEqual({ root: '/proj', path: '/etc' })
  })

  it('maps entries-unreadable from the backend and folds unknown throws to internal', async () => {
    const { remote, ctx, backend } = await harness()
    const listedBackend = requireBackend(backend)
    const session = ctx.sessions.create(SessionId('live'), { meta: { cwd: '/proj' } })
    listedBackend.impl = async () => {
      throw new WorkspaceEntriesError('entries-unreadable', '/proj/missing', 'cannot list /proj/missing')
    }
    await expect(remote.listEntries({ sessionId: session.id, path: '/proj/missing' }))
      .resolves.toMatchObject({
        ok: false,
        error: { code: 'session/entries-unreadable', details: { path: '/proj/missing' } },
      })
    listedBackend.impl = async () => {
      throw new Error('disk detached')
    }
    await expect(remote.listEntries({ sessionId: session.id }))
      .resolves.toMatchObject({ ok: false, error: { code: 'gateway/internal' } })
  })

  it('reports an aborted listing as cancelled', async () => {
    const { remote, ctx, backend } = await harness()
    const session = ctx.sessions.create(SessionId('live'), { meta: { cwd: '/proj' } })
    requireBackend(backend).impl = (_request, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => { reject(new Error('scan aborted')) }, { once: true })
    })
    const abort = new AbortController()
    const pending = remote.listEntries({ sessionId: session.id }, abort.signal)
    abort.abort()
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'gateway/cancelled' } })
  })

  it('uses a persisted session cwd without creating a live session', async () => {
    const cold = SessionId('cold')
    const { remote, ctx, backend } = await harness({
      persistence: {
        list: () => Promise.resolve([{
          version: 0 as const, id: cold, createdAt: 1, isSeeded: false, cwd: '/stored',
        }]),
      },
    })
    expect(ctx.sessions.get(cold)).toBeUndefined()
    await expect(remote.listEntries({ sessionId: cold }))
      .resolves.toMatchObject({ ok: true, value: { root: '/stored' } })
    expect(requireBackend(backend).last?.request).toEqual({ root: '/stored' })
  })

  it('fails with entries-unreadable when a persisted session has no cwd', async () => {
    const cold = SessionId('cold-empty')
    const { remote, backend } = await harness({
      persistence: {
        list: () => Promise.resolve([{
          version: 0 as const, id: cold, createdAt: 1, isSeeded: false,
        }]),
      },
    })
    await expect(remote.listEntries({ sessionId: cold }))
      .resolves.toMatchObject({
        ok: false,
        error: { code: 'session/entries-unreadable', details: { path: '' } },
      })
    expect(requireBackend(backend).last).toBeUndefined()
  })
})
