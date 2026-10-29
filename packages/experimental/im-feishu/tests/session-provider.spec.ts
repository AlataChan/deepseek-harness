import { describe, expect, it } from 'vitest'
import { chmod, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import { SqliteStorageBackend } from '@deepseek-ai/dsh-storage-sqlite'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SessionId } from '@deepseek-ai/dsh-session'
import { parseOperatorId } from '../src/types.ts'
import {
  TenantAgentSessionProvider,
  tenantConversationDomainSpec,
  type ConversationRecord,
} from '../src/session-provider.ts'

class MockLlmAdapter extends LlmAdapter {
  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'mock response' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'mock response' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

class MockKvTable<K extends string, V> implements KvTable<K, V> {
  private readonly map = new Map<K, V>()
  get size(): number {
    return this.map.size
  }
  get(key: K): V | undefined {
    return this.map.get(key)
  }
  entries(): IterableIterator<[K, V]> {
    return this.map.entries()
  }
  keys(): IterableIterator<K> {
    return this.map.keys()
  }
  put(key: K, value: V): Promise<void> {
    this.map.set(key, value)
    return Promise.resolve()
  }
  delete(key: K): Promise<boolean> {
    return Promise.resolve(this.map.delete(key))
  }
  update(key: K, fn: (prev: V) => V): Promise<V> {
    const existing = this.map.get(key)
    if (!existing) {
      throw new Error('Key not found')
    }
    const updated = fn(existing)
    this.map.set(key, updated)
    return Promise.resolve(updated)
  }
}

describe('TenantAgentSessionProvider', () => {
  it('enforces durable conversation mapping, async readSessionLog, and operator validation', async () => {
    const rawDir = await mkdtemp(join(tmpdir(), 'dsh-session-provider-test-'))
    const tempDir = await realpath(rawDir)
    await chmod(tempDir, 0o700)

    const ctx = new Context()
    let sqlite: SqliteStorageBackend | undefined

    try {
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(JsonlSessionPersistence, { root: join(tempDir, 'sessions'), compression: 'none' })
      await ctx.plugin(AgentLoop, { agents: [] })
      await ctx.plugin(Storage)

      sqlite = new SqliteStorageBackend({ path: join(tempDir, 'state.sqlite'), journalMode: 'wal' })
      ctx.storage.backend.register('sqlite', sqlite)

      const facility = new DomainFacility(ctx, { backend: 'sqlite', routes: {} })
      const domain = await facility.open(tenantConversationDomainSpec)
      const table = domain.table('conversations')

      const adapter = new MockLlmAdapter()
      ctx.llm.registerAdapter(['fixture'], adapter)

      const operatorAlice = parseOperatorId('operator_alice')
      const conversationKey = JSON.stringify(['feishu', 'app_1', 'tenant_1', 'chat_1', 'user_1'])

      const provider = new TenantAgentSessionProvider(ctx, table, {
        cwd: tempDir,
        modelSelection: { provider: 'fixture', model: 'fixture' },
        maxReconciliationEvents: 100,
      })

      // 1. Fresh conversation creates new mapping durably before Agent publication
      const signal = new AbortController().signal
      const agent1 = await provider.getOrCreateAgent(conversationKey, operatorAlice, signal)
      const agent1SessionId = agent1.session.id

      // Verify the durable record was written
      const savedRecord = table.get(conversationKey)
      expect(savedRecord?.sessionId).toBe(agent1SessionId)
      expect(savedRecord?.operatorId).toBe('operator_alice')

      // 2. Subsequent call for same conversation reuses active Agent
      const agent2 = await provider.getOrCreateAgent(conversationKey, operatorAlice, signal)
      expect(agent2.session.id).toBe(agent1SessionId)

      // 3. Foreign session log read is denied (returns undefined)
      const foreignId = SessionId('00000000-0000-0000-0000-000000000000')
      const foreignLog = await provider.readSessionLog(foreignId)
      expect(foreignLog).toBeUndefined()

      // 4. Flush sessions so persistence receives the session events
      await provider.flushSessions()

      // 5. Owned session log read resolves successfully via async storage
      const ownedLog = await provider.readSessionLog(agent1SessionId)
      expect(ownedLog?.id).toBe(agent1SessionId)
      expect(Array.isArray(ownedLog?.events)).toBe(true)

      // 6. Operator mismatch fails closed on active lookup
      const operatorBob = parseOperatorId('operator_bob')
      await expect(
        provider.getOrCreateAgent(conversationKey, operatorBob, signal),
      ).rejects.toThrow(/operator mismatch/)

      // 7. Dispose provider
      await provider.dispose()
    } finally {
      await ctx.fiber.dispose()
      await sqlite?.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('recovers from mapping-before-create crash using sessionPersistence.stat', async () => {
    const rawDir = await mkdtemp(join(tmpdir(), 'dsh-session-crash-test-'))
    const tempDir = await realpath(rawDir)
    await chmod(tempDir, 0o700)

    const ctx = new Context()
    let sqlite: SqliteStorageBackend | undefined

    try {
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(JsonlSessionPersistence, { root: join(tempDir, 'sessions'), compression: 'none' })
      await ctx.plugin(AgentLoop, { agents: [] })
      await ctx.plugin(Storage)

      sqlite = new SqliteStorageBackend({ path: join(tempDir, 'state.sqlite'), journalMode: 'wal' })
      ctx.storage.backend.register('sqlite', sqlite)

      const facility = new DomainFacility(ctx, { backend: 'sqlite', routes: {} })
      const domain = await facility.open(tenantConversationDomainSpec)
      const table = domain.table('conversations')

      const adapter = new MockLlmAdapter()
      ctx.llm.registerAdapter(['fixture'], adapter)

      const operatorAlice = parseOperatorId('operator_alice')
      const conversationKey = JSON.stringify(['feishu', 'app_1', 'tenant_1', 'chat_crash', 'user_1'])
      const preMappedSessionId = SessionId('11111111-2222-3333-4444-555555555555')

      // Simulate crash: conversation table has the record, but sessionPersistence has no session
      await table.put(conversationKey, {
        conversationKey,
        sessionId: preMappedSessionId,
        operatorId: 'operator_alice',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      const provider = new TenantAgentSessionProvider(ctx, table, {
        cwd: tempDir,
        modelSelection: { provider: 'fixture', model: 'fixture' },
        maxReconciliationEvents: 100,
      })

      // The provider must observe stat === undefined and recover by calling agents.create with the preMappedSessionId
      const signal = new AbortController().signal
      const recoveredAgent = await provider.getOrCreateAgent(conversationKey, operatorAlice, signal)
      expect(recoveredAgent.session.id).toBe(preMappedSessionId)

      await provider.flushSessions()
      await provider.dispose()
    } finally {
      await ctx.fiber.dispose()
      await sqlite?.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('cold resumes existing session with stable ID across provider restart', async () => {
    const rawDir = await mkdtemp(join(tmpdir(), 'dsh-session-cold-test-'))
    const tempDir = await realpath(rawDir)
    await chmod(tempDir, 0o700)

    const ctx = new Context()
    let sqlite: SqliteStorageBackend | undefined

    try {
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(JsonlSessionPersistence, { root: join(tempDir, 'sessions'), compression: 'none' })
      await ctx.plugin(AgentLoop, { agents: [] })
      await ctx.plugin(Storage)

      sqlite = new SqliteStorageBackend({ path: join(tempDir, 'state.sqlite'), journalMode: 'wal' })
      ctx.storage.backend.register('sqlite', sqlite)

      const facility = new DomainFacility(ctx, { backend: 'sqlite', routes: {} })
      const domain = await facility.open(tenantConversationDomainSpec)
      const table = domain.table('conversations')

      const adapter = new MockLlmAdapter()
      ctx.llm.registerAdapter(['fixture'], adapter)

      const operatorAlice = parseOperatorId('operator_alice')
      const conversationKey = JSON.stringify(['feishu', 'app_1', 'tenant_1', 'chat_cold', 'user_1'])

      // Run 1: create agent and flush
      const provider1 = new TenantAgentSessionProvider(ctx, table, {
        cwd: tempDir,
        modelSelection: { provider: 'fixture', model: 'fixture' },
        maxReconciliationEvents: 100,
      })
      const signal = new AbortController().signal
      const agent1 = await provider1.getOrCreateAgent(conversationKey, operatorAlice, signal)
      const firstSessionId = agent1.session.id
      await provider1.flushSessions()
      await provider1.dispose()

      // Run 2: cold restart with fresh provider on same table and persistence
      const provider2 = new TenantAgentSessionProvider(ctx, table, {
        cwd: tempDir,
        modelSelection: { provider: 'fixture', model: 'fixture' },
        maxReconciliationEvents: 100,
      })
      const agent2 = await provider2.getOrCreateAgent(conversationKey, operatorAlice, signal)
      expect(agent2.session.id).toBe(firstSessionId)

      await provider2.flushSessions()
      await provider2.dispose()
    } finally {
      await ctx.fiber.dispose()
      await sqlite?.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('fails flushSessions if ctx.sessions.flush returns false', async () => {
    const rawDir = await mkdtemp(join(tmpdir(), 'dsh-session-flush-fail-'))
    const tempDir = await realpath(rawDir)
    await chmod(tempDir, 0o700)

    const ctx = new Context()
    let sqlite: SqliteStorageBackend | undefined

    try {
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(JsonlSessionPersistence, { root: join(tempDir, 'sessions'), compression: 'none' })
      await ctx.plugin(AgentLoop, { agents: [] })
      await ctx.plugin(Storage)

      sqlite = new SqliteStorageBackend({ path: join(tempDir, 'state.sqlite'), journalMode: 'wal' })
      ctx.storage.backend.register('sqlite', sqlite)

      const facility = new DomainFacility(ctx, { backend: 'sqlite', routes: {} })
      const domain = await facility.open(tenantConversationDomainSpec)
      const table = domain.table('conversations')

      const adapter = new MockLlmAdapter()
      ctx.llm.registerAdapter(['fixture'], adapter)

      const operatorAlice = parseOperatorId('operator_alice')
      const conversationKey = JSON.stringify(['feishu', 'app_1', 'tenant_1', 'chat_flush', 'user_1'])

      const provider = new TenantAgentSessionProvider(ctx, table, {
        cwd: tempDir,
        modelSelection: { provider: 'fixture', model: 'fixture' },
        maxReconciliationEvents: 100,
      })
      await provider.getOrCreateAgent(conversationKey, operatorAlice, new AbortController().signal)

      // Mock sessions.flush to return false
      ctx.sessions.flush = () => Promise.resolve(false)

      await expect(provider.flushSessions()).rejects.toThrow(/Failed to flush session/)
      await provider.dispose()
    } finally {
      await ctx.fiber.dispose()
      await sqlite?.close()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('validates working directory and rejects unsafe, non-canonical, or missing paths', async () => {
    const ctx = new Context()
    const dummyTable = new MockKvTable<string, ConversationRecord>()

    // 0. Missing or invalid maxReconciliationEvents
    expect(
      // @ts-expect-error - testing missing required config
      () => new TenantAgentSessionProvider(ctx, dummyTable, { cwd: '/tmp' }),
    ).toThrow(/maxReconciliationEvents must be a positive integer/)

    expect(
      () => new TenantAgentSessionProvider(ctx, dummyTable, { cwd: '/tmp', maxReconciliationEvents: -1 }),
    ).toThrow(/maxReconciliationEvents must be a positive integer/)

    expect(
      () => new TenantAgentSessionProvider(ctx, dummyTable, { cwd: '/tmp', maxReconciliationEvents: 0 }),
    ).toThrow(/maxReconciliationEvents must be a positive integer/)

    // 1. Empty string
    expect(
      () => new TenantAgentSessionProvider(ctx, dummyTable, { cwd: '', maxReconciliationEvents: 100 }),
    ).toThrow(/must be a non-empty string/)

    // 2. Relative path
    expect(
      () => new TenantAgentSessionProvider(ctx, dummyTable, { cwd: 'relative/path', maxReconciliationEvents: 100 }),
    ).toThrow(/must be absolute/)

    // 3. Missing directory
    expect(
      () => new TenantAgentSessionProvider(ctx, dummyTable, { cwd: '/nonexistent/path/for/dsh/test', maxReconciliationEvents: 100 }),
    ).toThrow(/does not exist/)

    // 4. Insecure permissions (0755)
    const rawDir = await mkdtemp(join(tmpdir(), 'dsh-session-insecure-'))
    const tempDir = await realpath(rawDir)
    try {
      await chmod(tempDir, 0o755)
      expect(
        () => new TenantAgentSessionProvider(ctx, dummyTable, { cwd: tempDir, maxReconciliationEvents: 100 }),
      ).toThrow(/insecure permissions/)

      // 5. Symlink (non-canonical)
      await chmod(tempDir, 0o700)
      const symlinkPath = join(tmpdir(), `dsh-symlink-${Date.now()}`)
      await symlink(tempDir, symlinkPath)
      try {
        expect(
          () => new TenantAgentSessionProvider(ctx, dummyTable, { cwd: symlinkPath, maxReconciliationEvents: 100 }),
        ).toThrow(/must be canonical/)
      } finally {
        await rm(symlinkPath, { force: true })
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('fails if active conversation has missing or mismatched durable mapping', async () => {
    const rawDir = await mkdtemp(join(tmpdir(), 'dsh-session-map-mismatch-'))
    const tempDir = await realpath(rawDir)
    await chmod(tempDir, 0o700)

    const ctx = new Context()
    try {
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(JsonlSessionPersistence, { root: tempDir, compression: 'none' })
      await ctx.plugin(AgentLoop, { agents: [] })
      await ctx.plugin(Storage)

      const adapter = new MockLlmAdapter()
      ctx.llm.registerAdapter(['fixture'], adapter)

      const table = new MockKvTable<string, ConversationRecord>()
      const operatorAlice = parseOperatorId('operator_alice')
      const conversationKey = JSON.stringify(['feishu', 'app_1', 'tenant_1', 'chat_map', 'user_1'])

      const provider = new TenantAgentSessionProvider(ctx, table, {
        cwd: tempDir,
        modelSelection: { provider: 'fixture', model: 'fixture' },
        maxReconciliationEvents: 100,
      })

      // 1. Establish active agent
      const signal = new AbortController().signal
      await provider.getOrCreateAgent(conversationKey, operatorAlice, signal)

      // 2. Corrupt mapping table: delete entry while handle is active
      await table.delete(conversationKey)
      await expect(
        provider.getOrCreateAgent(conversationKey, operatorAlice, signal),
      ).rejects.toThrow(/missing durable mapping/)

      // 3. Corrupt mapping table: set mismatched sessionId
      await table.put(conversationKey, {
        conversationKey,
        sessionId: SessionId('mismatched-session-id'),
        operatorId: 'operator_alice',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      await expect(
        provider.getOrCreateAgent(conversationKey, operatorAlice, signal),
      ).rejects.toThrow(/session mismatch/)

      await provider.dispose()
    } finally {
      await ctx.fiber.dispose()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('uses allSettled to await all handle disposals even when disposals reject', async () => {
    const rawDir = await mkdtemp(join(tmpdir(), 'dsh-session-allsettled-'))
    const tempDir = await realpath(rawDir)
    await chmod(tempDir, 0o700)

    const ctx = new Context()
    try {
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(JsonlSessionPersistence, { root: tempDir, compression: 'none' })
      await ctx.plugin(AgentLoop, { agents: [] })
      await ctx.plugin(Storage)

      const adapter = new MockLlmAdapter()
      ctx.llm.registerAdapter(['fixture'], adapter)

      const table = new MockKvTable<string, ConversationRecord>()
      const operatorAlice = parseOperatorId('operator_alice')

      const provider = new TenantAgentSessionProvider(ctx, table, {
        cwd: tempDir,
        modelSelection: { provider: 'fixture', model: 'fixture' },
        maxReconciliationEvents: 100,
      })

      let handle2Disposed = false
      const origCreate = ctx.agents.create.bind(ctx.agents)
      let createCount = 0
      ctx.agents.create = async (options) => {
        const handle = await origCreate(options)
        createCount += 1
        if (createCount === 1) {
          const origHandle1Dispose = handle.dispose.bind(handle)
          handle.dispose = async () => {
            await origHandle1Dispose()
            throw new Error('Simulated handle1 dispose error')
          }
        } else if (createCount === 2) {
          const origHandle2Dispose = handle.dispose.bind(handle)
          handle.dispose = async () => {
            await origHandle2Dispose()
            handle2Disposed = true
          }
        }
        return handle
      }

      const signal = new AbortController().signal
      const conv1 = JSON.stringify(['feishu', 'app_1', 'tenant_1', 'chat_s1', 'user_1'])
      const conv2 = JSON.stringify(['feishu', 'app_1', 'tenant_1', 'chat_s2', 'user_2'])
      await provider.getOrCreateAgent(conv1, operatorAlice, signal)
      await provider.getOrCreateAgent(conv2, operatorAlice, signal)

      await expect(provider.dispose()).rejects.toThrow(/Simulated handle1 dispose error/)
      // Verify handle2 was also awaited and disposed despite handle1 failure
      expect(handle2Disposed).toBe(true)
    } finally {
      await ctx.fiber.dispose()
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
