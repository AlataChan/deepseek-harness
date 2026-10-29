/** Keyless real-Agent, JSONL and SQLite integration fixture. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { SqliteStorageBackend } from '@deepseek-ai/dsh-storage-sqlite'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { IngressStorage, TenantReceiptStorage, ingressDomainSpec, tenantReceiptDomainSpec } from '../src/storage.ts'
import { parseOperatorId, parseTargetTenantId } from '../src/types.ts'
import { TenantRuntimeService, type AgentSessionProvider } from '../src/runtime-service.ts'

/** Adapter whose optional blocking mode waits for real Agent cancellation. */
class FixtureAdapter extends LlmAdapter {
  calls = 0
  constructor(private readonly block: boolean) { super() }
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls++
    if (this.block && !options.signal?.aborted) {
      await new Promise<void>(resolve => options.signal?.addEventListener('abort', () =>{  resolve() }, { once: true }))
      options.signal?.throwIfAborted()
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'public final reply' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'public final reply' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/**
 * @param block - Whether the model waits for cancellation.
 * @param toolsMode - Tool presentation mode for native and nested dispatch controls.
 * @returns Owned fixture with real persistence and idempotent teardown.
 */
export async function createServiceFixture(block = false, toolsMode: 'native' | 'ptc' = 'native') {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-im-service-'))
  const ctx = new Context()
  let sqlite: SqliteStorageBackend | undefined
  const handles = new Map<string, AgentHandle>()
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    for (const handle of handles.values()) handle.agent.cancel({ kind: 'user' })
    for (const handle of handles.values()) await handle.dispose()
    await ctx.fiber.dispose()
    await sqlite?.close()
    await rm(directory, { recursive: true, force: true })
  }
  try {
    await mountAgentLoopTestDependencies(ctx, { tools: { mode: toolsMode } })
    await ctx.plugin(JsonlSessionPersistence, { root: join(directory, 'sessions'), compression: 'none' })
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(Storage)
    sqlite = new SqliteStorageBackend({ path: join(directory, 'im.sqlite'), journalMode: 'wal' })
    ctx.storage.backend.register('sqlite', sqlite)
    const facility = new DomainFacility(ctx, { backend: 'sqlite', routes: {} })
    const ingress = new IngressStorage(await facility.open(ingressDomainSpec))
    const receipts = new TenantReceiptStorage(await facility.open(tenantReceiptDomainSpec))
    const adapter = new FixtureAdapter(block)
    ctx.llm.registerAdapter(['fixture'], adapter)
    const operatorId = parseOperatorId('operator-a')
    const provider: AgentSessionProvider = {
      async getOrCreateAgent(conversationKey, _operator, signal) {
        signal.throwIfAborted()
        let handle = handles.get(conversationKey)
        if (!handle) {
          handle = await ctx.agents.create({ sessionId: SessionId(randomUUID()), meta: { cwd: directory },
            agentOptions: { provider: 'fixture', model: 'fixture' }, signal })
          handles.set(conversationKey, handle)
        }
        return handle.agent
      },
      async readSessionLog(id) {
        if (!Array.from(handles.values()).some(handle => handle.agent.session.id === id)) return undefined
        if (!await ctx.sessionPersistence.stat(id)) return undefined
        const stored = await ctx.sessionPersistence.open(id, 'read')
        try { return { id, events: (await stored.read(0, 5000)).events } } finally { await stored.close() }
      },
      async flushSessions() { for (const handle of handles.values()) await ctx.sessions.flush(handle.agent.session) },
    }
    const runtime = new TenantRuntimeService({ tenantId: parseTargetTenantId('runtime-a'), operatorIds: [operatorId], shutdownTimeoutMs: 1000, maxActiveDeliveries: 1 }, receipts, provider)
    return { ctx, directory, adapter, ingress, receipts, runtime, provider, handles, operatorId, facility, close }
  } catch (error) {
    await close()
    throw error
  }
}
