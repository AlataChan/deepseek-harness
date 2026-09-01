/** session ask-knowledge remotes: unavailable, attach without preset lock, ingest chunks. */

import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentFactory } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { AskKnowledge, AskKnowledgeError, AskKnowledgeLibraryId } from '@deepseek-ai/dsh-host-ask-knowledge'
import type {
  AskKnowledgeAttachLease, AskKnowledgeBundle, AskKnowledgeExtractResult, AskKnowledgeIngestHandle,
  AskKnowledgeIngestResult, AskKnowledgeLibrary, AskKnowledgeLookup, AskKnowledgeStatus,
} from '@deepseek-ai/dsh-host-ask-knowledge'
import { askKnowledgeBindingProjectionDefinition } from '@deepseek-ai/dsh-host-ask-knowledge'
import { askDataBindingProjectionDefinition } from '@deepseek-ai/dsh-host-ask-data'
import { agentPresetProjectionDefinition } from '@deepseek-ai/dsh-agent-presets'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { createSessionTestRemote } from './test-remote.ts'
import { ASK_KNOWLEDGE_MAX_CHUNK_BYTES } from '../src/types.ts'
import type { SessionRequestId } from '../src/types.ts'

class StubAskKnowledge extends AskKnowledge {
  libraries: AskKnowledgeLibrary[] = []
  lastAttach: { libraryId: string; sessionId: string } | undefined
  attachImpl: () => Promise<AskKnowledgeAttachLease> = async () => ({
    binding: { libraryId: 'lib-1', displayName: '制度' },
    rollback: async () => undefined,
  })

  override listLibraries(): Promise<AskKnowledgeLibrary[]> {
    return Promise.resolve(this.libraries)
  }

  override createLibrary(request: { displayName: string }): Promise<AskKnowledgeLibrary> {
    const row: AskKnowledgeLibrary = {
      id: AskKnowledgeLibraryId('lib-1'),
      displayName: request.displayName,
      createdAt: '2026-08-31T00:00:00.000Z',
      lastUsedAt: '2026-08-31T00:00:00.000Z',
      missing: false,
      deleting: false,
    }
    this.libraries = [row]
    return Promise.resolve(row)
  }

  override renameLibrary(request: {
    libraryId: AskKnowledgeLibrary['id']
    displayName: string
  }): Promise<AskKnowledgeLibrary> {
    const current = this.libraries[0]
    if (current === undefined) throw new AskKnowledgeError('library-missing', 'missing')
    const next = { ...current, displayName: request.displayName }
    this.libraries = [next]
    return Promise.resolve(next)
  }

  override removeLibrary(): Promise<void> {
    this.libraries = []
    return Promise.resolve()
  }

  override async attach(request: {
    libraryId: AskKnowledgeLibrary['id']
    sessionId: SessionId
  }): Promise<AskKnowledgeAttachLease> {
    this.lastAttach = { libraryId: request.libraryId, sessionId: request.sessionId }
    return this.attachImpl()
  }

  override detach(): Promise<void> {
    return Promise.resolve()
  }

  override beginIngest(): Promise<AskKnowledgeIngestHandle> {
    return Promise.resolve('handle-1' as AskKnowledgeIngestHandle)
  }

  override appendIngestChunk(): Promise<void> {
    return Promise.resolve()
  }

  override finishIngest(): Promise<AskKnowledgeIngestResult> {
    return Promise.resolve({ status: 'applied', rawRelPath: 'raw/a.md' })
  }

  override beginExtract(): Promise<AskKnowledgeIngestHandle> {
    return Promise.resolve('handle-extract' as AskKnowledgeIngestHandle)
  }

  override appendExtractChunk(): Promise<void> {
    return Promise.resolve()
  }

  override finishExtract(): Promise<AskKnowledgeExtractResult> {
    return Promise.resolve({ filename: 'note.md', text: '正文', truncated: false })
  }

  override libraryStatus(): Promise<AskKnowledgeStatus> {
    return Promise.resolve({ library: this.libraries[0]!, pendingAuditCount: 0 })
  }

  override retrieveBundle(): Promise<AskKnowledgeBundle> {
    return Promise.resolve({
      items: [{ path: 'wiki/报销.md', title: '报销', reason: '', text: '正文', kind: 'raw' }],
      warnings: [],
      tokenEstimate: 1,
    })
  }

  override lookup(): Promise<AskKnowledgeLookup> {
    return Promise.resolve({ term: '报销', canonicalPath: 'wiki/报销.md', text: '正文', warnings: [] })
  }

  override placeShortcut(): Promise<{ ok: boolean }> {
    return Promise.resolve({ ok: true })
  }

  override revealLibrary(): Promise<void> {
    return Promise.resolve()
  }
}

function stubAgent(session: Session): Agent {
  return {
    id: session.id,
    session,
    status: 'idle',
    followup: () => undefined,
    steer: () => undefined,
  } as unknown as Agent
}

async function harness(options: {
  askKnowledge?: boolean
  workspaces?: { get(id: string): unknown; list(): unknown[] }
} = {}) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-ask-knowledge-session-')))
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  ctx.sessionProjections.register(askKnowledgeBindingProjectionDefinition)
  ctx.sessionProjections.register(askDataBindingProjectionDefinition)
  ctx.sessionProjections.register(agentPresetProjectionDefinition)
  const selects: string[] = []
  const hooks = new Set<(agent: Agent, next: string) => void | Promise<void>>()
  ctx.provide('agentPresets', {
    defaultId: 'standard',
    resolve: (id?: string) => Promise.resolve({
      id: id ?? 'standard',
      trust: 'system',
      path: `/presets/${id ?? 'standard'}/agent.cordis.yml`,
    }),
    mount: async () => ({ id: 'standard' }),
    admitSelect(hook: (agent: Agent, next: string) => void | Promise<void>) {
      hooks.add(hook)
      return () => { hooks.delete(hook) }
    },
    async select(agent: Agent, next: string) {
      for (const hook of hooks) await hook(agent, next)
      selects.push(next)
      agent.session.append('agent-preset/selected', { agentPreset: next })
      return next
    },
  })
  const factory: AgentFactory = {
    async createAgent(_ownerCtx, options) {
      const session = ctx.sessions.prepare(
        options.sessionId,
        options.meta === undefined ? {} : { meta: options.meta },
      )
      const detach = ctx.sessions.enter(session)
      ctx.sessions.announce(session)
      const agent = stubAgent(session)
      const agentCtx = ctx.extend({ agent })
      ;(agent as { ctx?: Context }).ctx = agentCtx
      await options.setup?.(agentCtx)
      const unregister = ctx.agents.register(agent)
      return {
        agent,
        dispose: () => {
          unregister()
          detach()
          return Promise.resolve()
        },
      }
    },
    async resume() {
      throw new Error('test harness has no persisted sessions')
    },
  }
  ctx.agents.setFactory(factory)
  ctx.provide('workspaceRegistry', (options.workspaces ?? { get: () => undefined }) as never)
  if (options.askKnowledge !== false) await ctx.plugin(StubAskKnowledge)
  const remote = createSessionTestRemote(ctx, {
    defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
    cwd,
  })
  return { remote, ctx, selects }
}

describe('session ask-knowledge remotes', () => {
  it('fails listAskKnowledgeLibraries without the capability', async () => {
    const { remote } = await harness({ askKnowledge: false })
    await expect(remote.listAskKnowledgeLibraries()).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/ask-knowledge-unavailable' },
    })
  })

  it('creates a library and attaches without selecting a non-standard preset', async () => {
    const { remote, ctx, selects } = await harness()
    const created = await remote.createAskKnowledgeLibrary({ displayName: '制度' })
    expect(created).toMatchObject({ ok: true, value: { displayName: '制度' } })
    const session = await remote.create({ cwd: '/tmp/ak' })
    expect(session.ok).toBe(true)
    if (!session.ok) throw new Error('create failed')
    const attached = await remote.attachAskKnowledge({
      libraryId: 'lib-1',
      sessionId: session.value.sessionId,
    })
    expect(attached).toMatchObject({ ok: true, value: { sessionId: session.value.sessionId } })
    expect(selects).not.toContain('data-agent')
    const live = ctx.sessions.get(session.value.sessionId)
    expect(live).toBeDefined()
    await expect(remote.askKnowledgeBinding({ sessionId: session.value.sessionId })).resolves.toMatchObject({
      ok: true,
      value: null,
    })
  })

  it('opens a new standard session when attach names a bound data-agent session', async () => {
    const { remote, ctx, selects } = await harness()
    const created = await remote.create({
      sessionId: SessionId('s-data'),
      cwd: '/tmp/ak-data',
      agentPreset: 'data-agent',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error('create failed')
    const dataSession = ctx.sessions.get(created.value.sessionId)
    expect(dataSession).toBeDefined()
    dataSession?.append('ask-data/bound', {
      sourceId: 'src-sales',
      connectionRef: 'ask-data:src-sales',
      displayName: '销售明细',
      readonly: true,
    })
    const attached = await remote.attachAskKnowledge({
      libraryId: 'lib-1',
      sessionId: created.value.sessionId,
    })
    expect(attached.ok).toBe(true)
    if (!attached.ok) throw new Error('attach failed')
    expect(attached.value.sessionId).not.toBe(created.value.sessionId)
    const knowledge = ctx.sessions.get(attached.value.sessionId)
    expect(knowledge?.header.agentPreset).toBe('standard')
    expect(knowledge?.header.cwd).toBe('/tmp/ak-data')
    expect(selects).not.toContain('data-agent')
    const stub = ctx.get('askKnowledge') as StubAskKnowledge
    expect(stub.lastAttach).toEqual({
      libraryId: 'lib-1',
      sessionId: attached.value.sessionId,
    })
  })

  it('attaches the new standard session to the workspace that lists the data-agent session', async () => {
    const attachedIds: string[] = []
    const workspace = {
      id: 'ws-eval',
      path: '/tmp/ak-ws',
      sessionIds: [SessionId('s-data-ws')],
      attachSession: async (id: string) => {
        attachedIds.push(id)
      },
    }
    const { remote, ctx } = await harness({
      workspaces: {
        get: (id: string) => id === 'ws-eval' ? workspace : undefined,
        list: () => [workspace],
      },
    })
    const created = await remote.create({
      sessionId: SessionId('s-data-ws'),
      cwd: '/tmp/ak-ws',
      agentPreset: 'data-agent',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error('create failed')
    ctx.sessions.get(created.value.sessionId)?.append('ask-data/bound', {
      sourceId: 'src-sales',
      connectionRef: 'ask-data:src-sales',
      displayName: '销售明细',
      readonly: true,
    })
    const attached = await remote.attachAskKnowledge({
      libraryId: 'lib-1',
      sessionId: created.value.sessionId,
    })
    expect(attached.ok).toBe(true)
    if (!attached.ok) throw new Error('attach failed')
    expect(attached.value.sessionId).not.toBe(created.value.sessionId)
    expect(attachedIds).toEqual([attached.value.sessionId])
  })

  it('returns an unbound data-agent session to standard before hanging the library', async () => {
    const { remote, ctx, selects } = await harness()
    const created = await remote.create({
      sessionId: SessionId('s-blank-data'),
      cwd: '/tmp/ak-blank',
      agentPreset: 'data-agent',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error('create failed')
    const attached = await remote.attachAskKnowledge({
      libraryId: 'lib-1',
      sessionId: created.value.sessionId,
    })
    expect(attached).toMatchObject({ ok: true, value: { sessionId: created.value.sessionId } })
    expect(selects).toEqual(['standard'])
    const stub = ctx.get('askKnowledge') as StubAskKnowledge
    expect(stub.lastAttach).toEqual({
      libraryId: 'lib-1',
      sessionId: created.value.sessionId,
    })
  })

  it('creates a standard session when attach omits sessionId', async () => {
    const { remote, ctx, selects } = await harness()
    const attached = await remote.attachAskKnowledge({ libraryId: 'lib-1' })
    expect(attached.ok).toBe(true)
    if (!attached.ok) throw new Error('attach failed')
    const live = ctx.sessions.get(attached.value.sessionId)
    expect(live?.header.agentPreset).toBe('standard')
    expect(selects).toEqual([])
  })

  it('rejects a chunk larger than 160KiB', async () => {
    const { remote } = await harness()
    const huge = Buffer.alloc(ASK_KNOWLEDGE_MAX_CHUNK_BYTES + 1).toString('base64')
    await expect(remote.appendAskKnowledgeIngestChunk({
      handle: 'h',
      bytes: huge,
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/ask-knowledge-failed' },
    })
  })

  it('extracts a session document and rejects an oversized extract chunk', async () => {
    const { remote } = await harness()
    const begun = await remote.beginAskKnowledgeExtract({ filename: 'note.md' })
    expect(begun).toMatchObject({ ok: true, value: 'handle-extract' })
    await expect(remote.appendAskKnowledgeExtractChunk({
      handle: 'handle-extract',
      bytes: Buffer.from('hi').toString('base64'),
    })).resolves.toMatchObject({ ok: true })
    await expect(remote.finishAskKnowledgeExtract({ handle: 'handle-extract' }))
      .resolves.toMatchObject({
        ok: true,
        value: { filename: 'note.md', text: '正文', truncated: false },
      })
    const huge = Buffer.alloc(ASK_KNOWLEDGE_MAX_CHUNK_BYTES + 1).toString('base64')
    await expect(remote.appendAskKnowledgeExtractChunk({
      handle: 'h',
      bytes: huge,
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/ask-knowledge-failed' },
    })
  })

  it('lets an unbound standard session prompt', async () => {
    const { remote } = await harness()
    const session = await remote.create({ cwd: '/tmp/ak-prompt' })
    expect(session.ok).toBe(true)
    if (!session.ok) throw new Error('create failed')
    const prompted = await remote.prompt({
      requestId: 'r1' as SessionRequestId,
      sessionId: session.value.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: 'hello' }],
    })
    expect(prompted.ok === false && prompted.error.code === 'session/ask-knowledge-unbound').toBe(false)
    expect(prompted.ok).toBe(true)
  })

  it('refuses retrieve on an unbound session', async () => {
    const { remote } = await harness()
    const session = await remote.create({ cwd: '/tmp/ak-unbound' })
    expect(session.ok).toBe(true)
    if (!session.ok) throw new Error('create failed')
    await expect(remote.askKnowledgeRetrieve({
      sessionId: session.value.sessionId,
      terms: ['报销'],
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/ask-knowledge-unbound' },
    })
  })
})
