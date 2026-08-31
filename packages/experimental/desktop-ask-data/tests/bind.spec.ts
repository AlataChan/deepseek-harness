/** Overlay bind adapter: connect through data-agent, rollback restores the snapshot. */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { AskDataConnectionRef, AskDataError } from '@deepseek-ai/dsh-host-ask-data'
import type { AskDataSourceId } from '@deepseek-ai/dsh-host-ask-data'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { bindSource } from '../src/bind.ts'
import { putStoredSource } from '../src/sources.ts'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

describe('bindSource', () => {
  it('fails when data-agent connections are absent', async () => {
    const ctx = new Context()
    await expect(bindSource(ctx, '/tmp', {
      sourceId: brandString<AskDataSourceId>('src-1'),
      sessionId: 's1' as SessionId,
    })).rejects.toMatchObject({ code: 'bind-failed' })
  })

  it('connects a managed source and rollback restores the previous binding', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-data-bind-'))
    const id = brandString<AskDataSourceId>('src-1')
    const dir = join(home, 'imports', 'src-1')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'data.sqlite'), 'x')
    await putStoredSource(home, {
      id,
      displayName: 'sales.csv',
      kind: 'import',
      sqlitePath: 'data.sqlite',
      sourceCopyPath: 'source.csv',
      warnings: [],
    })
    const connect = vi.fn(async () => ({ summary: { profileId: 'ask-data:src-1' } }))
    const disconnect = vi.fn(async () => undefined)
    const ctx = new Context()
    ctx.provide('dataAgentConnections', {
      get: () => ({ type: 'sqlite', database: '/old.db', profileId: 'old', readonly: true }),
      connect,
      disconnect,
      resolveForExecution: async () => ({ database: '/old.db' }),
    })
    const lease = await bindSource(ctx, home, { sourceId: id, sessionId: 's1' as SessionId })
    expect(lease.binding.connectionRef).toBe('ask-data:src-1')
    expect(lease.binding.readonly).toBe(true)
    expect(connect).toHaveBeenCalled()
    await lease.rollback()
    const last = connect.mock.calls.at(-1) as unknown[] | undefined
    expect(last?.[1]).toMatchObject({ profileId: 'old' })
  })

  it('skips rewriting lastUsedAt when the session is already bound', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-data-bind-used-'))
    const id = brandString<AskDataSourceId>('src-1')
    const dir = join(home, 'imports', 'src-1')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'data.sqlite'), 'x')
    await putStoredSource(home, {
      id,
      displayName: 'sales.csv',
      kind: 'import',
      sqlitePath: 'data.sqlite',
      sourceCopyPath: 'source.csv',
      connectionRef: AskDataConnectionRef('ask-data:src-1'),
      lastUsedAt: '2026-01-01T00:00:00.000Z',
      warnings: [],
    })
    const connect = vi.fn()
    const ctx = new Context()
    ctx.provide('dataAgentConnections', {
      get: () => ({ profileId: 'ask-data:src-1' }),
      connect,
      disconnect: vi.fn(),
      resolveForExecution: async () => ({ database: 'x' }),
    })
    const lease = await bindSource(ctx, home, { sourceId: id, sessionId: 's1' as SessionId })
    await lease.rollback()
    expect(connect).not.toHaveBeenCalled()
  })

  it('starts a Catalog scan after bind when the catalog is empty', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-data-bind-catalog-'))
    const id = brandString<AskDataSourceId>('src-1')
    const dir = join(home, 'imports', 'src-1')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'data.sqlite'), 'x')
    await putStoredSource(home, {
      id,
      displayName: 'sales.csv',
      kind: 'import',
      sqlitePath: 'data.sqlite',
      sourceCopyPath: 'source.csv',
      warnings: [],
    })
    const start = vi.fn(async () => ({ id: 'run-1' }))
    const ctx = new Context()
    ctx.provide('dataAgentConnections', {
      get: () => undefined,
      connect: vi.fn(async () => ({ summary: { profileId: 'ask-data:src-1' } })),
      disconnect: vi.fn(),
      resolveForExecution: async () => ({ database: 'x' }),
    })
    ctx.provide('dataAgentCatalog', { listSources: () => [] })
    ctx.provide('dataAgentCatalogScanner', { start })
    await bindSource(ctx, home, { sourceId: id, sessionId: 's1' as SessionId })
    expect(start).toHaveBeenCalledWith({ sessionId: 's1', scope: { kind: 'source' } })
  })

  it('skips Catalog scan when a source is already registered', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-data-bind-catalog-skip-'))
    const id = brandString<AskDataSourceId>('src-1')
    const dir = join(home, 'imports', 'src-1')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'data.sqlite'), 'x')
    await putStoredSource(home, {
      id,
      displayName: 'sales.csv',
      kind: 'import',
      sqlitePath: 'data.sqlite',
      sourceCopyPath: 'source.csv',
      warnings: [],
    })
    const start = vi.fn()
    const ctx = new Context()
    ctx.provide('dataAgentConnections', {
      get: () => undefined,
      connect: vi.fn(async () => ({ summary: { profileId: 'ask-data:src-1' } })),
      disconnect: vi.fn(),
      resolveForExecution: async () => ({ database: 'x' }),
    })
    ctx.provide('dataAgentCatalog', { listSources: () => [{ id: 'ask-data:src-1' }] })
    ctx.provide('dataAgentCatalogScanner', { start })
    await bindSource(ctx, home, { sourceId: id, sessionId: 's1' as SessionId })
    expect(start).not.toHaveBeenCalled()
  })

  it('still binds when Catalog scan throws', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-data-bind-catalog-fail-'))
    const id = brandString<AskDataSourceId>('src-1')
    const dir = join(home, 'imports', 'src-1')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'data.sqlite'), 'x')
    await putStoredSource(home, {
      id,
      displayName: 'sales.csv',
      kind: 'import',
      sqlitePath: 'data.sqlite',
      sourceCopyPath: 'source.csv',
      warnings: [],
    })
    const ctx = new Context()
    ctx.provide('dataAgentConnections', {
      get: () => undefined,
      connect: vi.fn(async () => ({ summary: { profileId: 'ask-data:src-1' } })),
      disconnect: vi.fn(),
      resolveForExecution: async () => ({ database: 'x' }),
    })
    ctx.provide('dataAgentCatalog', { listSources: () => [] })
    ctx.provide('dataAgentCatalogScanner', {
      start: async () => {
        throw new Error('Catalog scan requires a connected, stable connection profile')
      },
    })
    const lease = await bindSource(ctx, home, { sourceId: id, sessionId: 's1' as SessionId })
    expect(lease.binding.connectionRef).toBe('ask-data:src-1')
  })

  it('rolls back a rebind of an already-registered profile without deleting it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-data-bind-rebind-'))
    const id = brandString<AskDataSourceId>('src-1')
    const dir = join(home, 'imports', 'src-1')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'data.sqlite'), 'x')
    await putStoredSource(home, {
      id,
      displayName: 'sales.csv',
      kind: 'import',
      sqlitePath: 'data.sqlite',
      sourceCopyPath: 'source.csv',
      connectionRef: AskDataConnectionRef('ask-data:src-1'),
      warnings: [],
    })
    const connect = vi.fn(async () => ({ summary: { profileId: 'ask-data:src-1' } }))
    const ctx = new Context()
    ctx.provide('dataAgentConnections', {
      get: () => undefined,
      connect,
      disconnect: vi.fn(async () => undefined),
      resolveForExecution: async () => ({ database: 'x' }),
    })
    const lease = await bindSource(ctx, home, { sourceId: id, sessionId: 's1' as SessionId })
    await lease.rollback()
    expect(connect).toHaveBeenCalled()
  })

  it('is a no-op rollback when the session is already bound to this source', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-data-bind-'))
    const id = brandString<AskDataSourceId>('src-1')
    const dir = join(home, 'imports', 'src-1')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'data.sqlite'), 'x')
    await putStoredSource(home, {
      id,
      displayName: 'sales.csv',
      kind: 'import',
      sqlitePath: 'data.sqlite',
      sourceCopyPath: 'source.csv',
      connectionRef: AskDataConnectionRef('ask-data:src-1'),
      warnings: [],
    })
    const connect = vi.fn()
    const ctx = new Context()
    ctx.provide('dataAgentConnections', {
      get: () => ({ profileId: 'ask-data:src-1' }),
      connect,
      disconnect: vi.fn(),
      resolveForExecution: async () => ({ database: 'x' }),
    })
    const lease = await bindSource(ctx, home, { sourceId: id, sessionId: 's1' as SessionId })
    await lease.rollback()
    expect(connect).not.toHaveBeenCalled()
  })

  it('binds a saved profile and rollback disconnects', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-data-bind-'))
    const connect = vi.fn(async () => ({ summary: { profileId: 'saved-1' } }))
    const disconnect = vi.fn(async () => undefined)
    const ctx = new Context()
    ctx.provide('dataAgentConnections', {
      get: () => undefined,
      connect,
      disconnect,
      resolveForExecution: async () => ({ database: '/saved.db' }),
    })
    ctx.provide('storageDomain', {
      get: () => ({
        table: (name: string) => name === 'profiles'
          ? {
            entries: () => [['saved-1', {
              database: '/saved.db',
              name: 'saved',
              readonly: true,
            }]][Symbol.iterator](),
            delete: async () => false,
          }
          : { entries: () => [][Symbol.iterator](), delete: async () => false },
      }),
    })
    const lease = await bindSource(ctx, home, {
      sourceId: brandString<AskDataSourceId>('saved:saved-1'),
      sessionId: 's1' as SessionId,
    })
    expect(lease.binding.connectionRef).toBe('saved-1')
    await lease.rollback()
    expect(disconnect).toHaveBeenCalled()
  })

  it('starts a Catalog scan after binding a saved profile', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-data-bind-saved-catalog-'))
    const start = vi.fn(async () => ({ id: 'run-1' }))
    const ctx = new Context()
    ctx.provide('dataAgentConnections', {
      get: () => undefined,
      connect: vi.fn(async () => ({ summary: { profileId: 'saved-1' } })),
      disconnect: vi.fn(async () => undefined),
      resolveForExecution: async () => ({ database: '/saved.db' }),
    })
    ctx.provide('dataAgentCatalog', { listSources: () => [] })
    ctx.provide('dataAgentCatalogScanner', { start })
    ctx.provide('storageDomain', {
      get: () => ({
        table: (name: string) => name === 'profiles'
          ? {
            entries: () => [['saved-1', {
              database: '/saved.db',
              name: 'saved',
              readonly: true,
            }]][Symbol.iterator](),
            delete: async () => false,
          }
          : { entries: () => [][Symbol.iterator](), delete: async () => false },
      }),
    })
    await bindSource(ctx, home, {
      sourceId: brandString<AskDataSourceId>('saved:saved-1'),
      sessionId: 's1' as SessionId,
    })
    expect(start).toHaveBeenCalledWith({ sessionId: 's1', scope: { kind: 'source' } })
  })

  it('is a no-op rollback when a saved profile is already bound', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-data-bind-saved-already-'))
    const connect = vi.fn()
    const ctx = new Context()
    ctx.provide('dataAgentConnections', {
      get: () => ({ profileId: 'saved-1' }),
      connect,
      disconnect: vi.fn(),
      resolveForExecution: async () => ({ database: '/saved.db' }),
    })
    ctx.provide('storageDomain', {
      get: () => ({
        table: (name: string) => name === 'profiles'
          ? {
            entries: () => [['saved-1', {
              database: '/saved.db',
              name: 'saved',
              readonly: false,
              updatedAt: '2026-01-01T00:00:00.000Z',
            }]][Symbol.iterator](),
            delete: async () => false,
          }
          : { entries: () => [][Symbol.iterator](), delete: async () => false },
      }),
    })
    const lease = await bindSource(ctx, home, {
      sourceId: brandString<AskDataSourceId>('saved:saved-1'),
      sessionId: 's1' as SessionId,
    })
    expect(lease.binding.readonly).toBe(false)
    await lease.rollback()
    expect(connect).not.toHaveBeenCalled()
  })

  it('disconnects on rollback when there is no previous sqlite binding', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-data-bind-disc-'))
    const id = brandString<AskDataSourceId>('src-1')
    const dir = join(home, 'imports', 'src-1')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'data.sqlite'), 'x')
    await putStoredSource(home, {
      id,
      displayName: 'sales.csv',
      kind: 'import',
      sqlitePath: 'data.sqlite',
      sourceCopyPath: 'source.csv',
      lastUsedAt: '2026-01-01T00:00:00.000Z',
      warnings: [],
    })
    const disconnect = vi.fn(async () => undefined)
    const ctx = new Context()
    ctx.provide('dataAgentConnections', {
      get: () => undefined,
      connect: vi.fn(async () => ({ summary: { profileId: 'ask-data:src-1' } })),
      disconnect,
      resolveForExecution: async () => ({ database: 'x' }),
    })
    const lease = await bindSource(ctx, home, { sourceId: id, sessionId: 's1' as SessionId })
    await lease.rollback()
    expect(disconnect).toHaveBeenCalled()
  })

  it('continues rollback when restoring the previous binding throws', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-data-bind-restore-fail-'))
    const id = brandString<AskDataSourceId>('src-1')
    const dir = join(home, 'imports', 'src-1')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'data.sqlite'), 'x')
    await putStoredSource(home, {
      id,
      displayName: 'sales.csv',
      kind: 'import',
      sqlitePath: 'data.sqlite',
      sourceCopyPath: 'source.csv',
      warnings: [],
    })
    const connect = vi.fn(async (_session: string, input: { profileId?: string }) => {
      if (input.profileId === 'old') throw new Error('restore failed')
      return { summary: { profileId: 'ask-data:src-1' } }
    })
    const ctx = new Context()
    ctx.provide('dataAgentConnections', {
      get: () => ({
        type: 'sqlite',
        database: '/old.db',
        profileId: 'old',
        name: 'old-db',
      }),
      connect,
      disconnect: vi.fn(),
      resolveForExecution: async () => ({ database: '/old.db' }),
    })
    const lease = await bindSource(ctx, home, { sourceId: id, sessionId: 's1' as SessionId })
    await expect(lease.rollback()).resolves.toBeUndefined()
  })

  it('throws source-missing for an unknown overlay id', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-data-bind-'))
    const ctx = new Context()
    ctx.provide('dataAgentConnections', {
      get: () => undefined,
      connect: vi.fn(),
      disconnect: vi.fn(),
      resolveForExecution: async () => ({ database: 'x' }),
    })
    await expect(bindSource(ctx, home, {
      sourceId: brandString<AskDataSourceId>('missing'),
      sessionId: 's1' as SessionId,
    })).rejects.toBeInstanceOf(AskDataError)
  })
})
