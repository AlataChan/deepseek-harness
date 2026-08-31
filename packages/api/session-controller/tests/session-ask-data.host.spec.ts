/** session ask-data remotes: unavailable, base64, commit compensation, busy, unbound. */

import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentFactory } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { AskData, AskDataError } from '@deepseek-ai/dsh-host-ask-data'
import type {
  AskDataBindLease, AskDataBindRequest, AskDataImportPreview, AskDataImportSpreadsheetRequest,
  AskDataSource,
} from '@deepseek-ai/dsh-host-ask-data'
import { askDataBindingProjectionDefinition } from '@deepseek-ai/dsh-host-ask-data'
import { agentPresetProjectionDefinition } from '@deepseek-ai/dsh-agent-presets'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { createSessionTestRemote } from './test-remote.ts'
import { ASK_DATA_MAX_DECODED_BYTES, type SessionRequestId } from '../src/types.ts'
import { decodeCanonicalBase64, mapAskDataError } from '../src/ask-data.ts'
import { CommitFifo, SessionCallGate } from '../src/session-gate.ts'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'

class StubAskData extends AskData {
  bindImpl: (request: AskDataBindRequest) => Promise<AskDataBindLease> = async request => ({
    binding: {
      sourceId: request.sourceId,
      connectionRef: `ask-data:${request.sourceId}`,
      displayName: '示例：销售明细',
      readonly: true,
    },
    rollback: async () => undefined,
  })

  override listSources(_signal?: AbortSignal): Promise<AskDataSource[]> {
    return Promise.resolve([])
  }

  override importSpreadsheet(
    request: AskDataImportSpreadsheetRequest,
    _signal?: AbortSignal,
  ): Promise<AskDataImportPreview> {
    return Promise.resolve({
      source: {
        id: request.replaceSourceId ?? 'src-1' as AskDataSource['id'],
        displayName: request.filename,
        kind: 'import',
        warnings: [],
        missing: false,
      },
      tables: [],
      warnings: [],
    })
  }

  override importSample(_signal?: AbortSignal): Promise<AskDataImportPreview> {
    return Promise.resolve({
      source: {
        id: 'src-sample' as AskDataSource['id'],
        displayName: '示例：销售明细',
        kind: 'sample',
        warnings: [],
        missing: false,
      },
      tables: [{ name: '销售明细', rowCount: 20, columns: ['日期'] }],
      warnings: [],
    })
  }

  override bind(request: AskDataBindRequest, _signal?: AbortSignal): Promise<AskDataBindLease> {
    return this.bindImpl(request)
  }
}

function stubAgent(session: Session): Agent {
  return { id: session.id, session, status: 'idle' } as unknown as Agent
}

async function harness(options: {
  askData?: boolean
  workspace?: { path: string; attachSession: (id: unknown) => Promise<void>; detachSession: (id: unknown) => Promise<void> }
} = {}) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-ask-data-session-')))
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
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
  ctx.provide('workspaceRegistry', {
    get: () => options.workspace,
  } as never)
  if (options.askData !== false) await ctx.plugin(StubAskData)
  const remote = createSessionTestRemote(ctx, {
    defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
    cwd,
  })
  return { remote, ctx, selects }
}

describe('session ask-data remotes', () => {
  it('fails listAskDataSources without the capability', async () => {
    const { remote } = await harness({ askData: false })
    await expect(remote.listAskDataSources()).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/ask-data-unavailable' },
    })
  })

  it('rejects a number-array bytes payload and non-canonical base64', async () => {
    const { remote } = await harness()
    await expect(remote.importAskDataSpreadsheet({
      filename: 'a.csv',
      bytes: [1, 2, 3] as never,
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'gateway/bad-request' },
    })
    await expect(remote.importAskDataSpreadsheet({
      filename: 'a.csv',
      bytes: 'aGk',
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'gateway/bad-request' },
    })
    expect(decodeCanonicalBase64('aGk=')).toEqual(new Uint8Array([104, 105]))
    expect(() => decodeCanonicalBase64('!!!!')).toThrow(RemoteError)
    expect(() => decodeCanonicalBase64('YR==')).toThrow(RemoteError)
  })

  it('maps AskDataError through mapAskDataError', () => {
    const live = new AbortController().signal
    expect(() => mapAskDataError(new AskDataError('ask-data-unavailable', 'gone'), live)).toThrow(RemoteError)
    expect(() => mapAskDataError(new Error('x'), live)).toThrow(RemoteError)
    expect(() => mapAskDataError('x', live)).toThrow(RemoteError)
  })

  it('rejects a decoded payload over 50MB before parse', async () => {
    const { remote } = await harness()
    const bytes = Buffer.alloc(ASK_DATA_MAX_DECODED_BYTES + 1).toString('base64')
    await expect(remote.importAskDataSpreadsheet({
      filename: 'big.csv',
      bytes,
    })).resolves.toMatchObject({
      ok: false,
      error: { details: { ruleId: 'file-size' } },
    })
  })

  it('imports the sample without opening a session', async () => {
    const { remote, ctx } = await harness()
    const result = await remote.importAskDataSample()
    expect(result).toMatchObject({ ok: true, value: { source: { kind: 'sample' } } })
    expect(ctx.sessions.list()).toEqual([])
  })

  it('maps AskDataError from import', async () => {
    const { remote, ctx } = await harness()
    const stub = ctx.get('askData') as StubAskData
    stub.importSample = async () => {
      throw new AskDataError('csv-encoding', 'bad csv', { ruleId: 'csv-encoding' })
    }
    await expect(remote.importAskDataSample()).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/ask-data-failed', details: { ruleId: 'csv-encoding' } },
    })
  })

  it('creates one session on commit without sessionId and records the bind', async () => {
    const { remote, ctx } = await harness()
    const result = await remote.commitAskData({ sourceId: 'src-sample' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(ctx.sessions.list()).toHaveLength(1)
    await expect(remote.askDataBinding({ sessionId: result.value.sessionId })).resolves.toMatchObject({
      ok: true,
      value: { sourceId: 'src-sample', readonly: true },
    })
  })

  it('disposes a created session when bind fails', async () => {
    const { remote, ctx } = await harness()
    const stub = ctx.get('askData') as StubAskData
    stub.bindImpl = async () => {
      throw new AskDataError('bind-failed', 'nope')
    }
    await expect(remote.commitAskData({ sourceId: 'src-sample' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/ask-data-failed' },
    })
    expect(ctx.sessions.list()).toEqual([])
  })

  it('restores the previous preset when bind fails on an existing blank', async () => {
    const { remote, ctx, selects } = await harness()
    const created = await remote.create({ sessionId: SessionId('s-std'), agentPreset: 'standard' })
    expect(created.ok).toBe(true)
    const stub = ctx.get('askData') as StubAskData
    stub.bindImpl = async () => {
      throw new AskDataError('bind-failed', 'nope')
    }
    await expect(remote.commitAskData({
      sourceId: 'src-sample',
      sessionId: SessionId('s-std'),
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/ask-data-failed' },
    })
    expect(ctx.sessions.get(SessionId('s-std'))).toBeDefined()
    expect(selects.at(-1)).toBe('standard')
  })

  it('rolls back a successful bind when append fails', async () => {
    const { remote, ctx } = await harness()
    await remote.create({ sessionId: SessionId('s-append'), agentPreset: 'data-agent' })
    const agent = ctx.agents.get(SessionId('s-append'))
    expect(agent).toBeDefined()
    if (agent === undefined) throw new Error('expected agent')
    const rolled = { value: false }
    const stub = ctx.get('askData') as StubAskData
    stub.bindImpl = async request => ({
      binding: {
        sourceId: request.sourceId,
        connectionRef: 'ask-data:src-sample',
        displayName: '示例：销售明细',
        readonly: true,
      },
      rollback: async () => { rolled.value = true },
    })
    const original = agent.session.append.bind(agent.session)
    const replay = original as (type: string, data: unknown) => void
    agent.session.append = ((type: string, data: unknown) => {
      if (type === 'ask-data/bound') throw new Error('append failed')
      return replay(type, data)
    }) as typeof agent.session.append
    await expect(remote.commitAskData({
      sourceId: 'src-sample',
      sessionId: SessionId('s-append'),
    })).resolves.toMatchObject({ ok: false })
    expect(rolled.value).toBe(true)
  })

  it('still restores preset and disposes when rollback throws', async () => {
    const { remote, ctx } = await harness()
    const stub = ctx.get('askData') as StubAskData
    stub.bindImpl = async request => ({
      binding: {
        sourceId: request.sourceId,
        connectionRef: 'ask-data:src-sample',
        displayName: '示例：销售明细',
        readonly: true,
      },
      rollback: async () => { throw new Error('rollback failed') },
    })
    const created = await remote.create({ sessionId: SessionId('s-rb'), agentPreset: 'standard' })
    expect(created.ok).toBe(true)
    const agent = ctx.agents.get(SessionId('s-rb'))!
    const original = agent.session.append.bind(agent.session)
    const replay = original as (type: string, data: unknown) => void
    agent.session.append = ((type: string, data: unknown) => {
      if (type === 'ask-data/bound') throw new Error('append failed')
      return replay(type, data)
    }) as typeof agent.session.append
    await expect(remote.commitAskData({
      sourceId: 'src-sample',
      sessionId: SessionId('s-rb'),
    })).resolves.toMatchObject({
      ok: false,
      error: { message: 'append failed' },
    })
    expect(ctx.sessions.get(SessionId('s-rb'))).toBeDefined()
  })

  it('rejects a second overlapping commit of a different source on the same session', async () => {
    const { remote } = await harness()
    await remote.create({ sessionId: SessionId('s-two'), agentPreset: 'data-agent' })
    const first = await remote.commitAskData({
      sourceId: 'src-a',
      sessionId: SessionId('s-two'),
    })
    expect(first.ok).toBe(true)
    await expect(remote.commitAskData({
      sourceId: 'src-b',
      sessionId: SessionId('s-two'),
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'gateway/bad-request' },
    })
  })

  it('rejects a non-blank unbound sessionId without disposing it', async () => {
    const { remote, ctx } = await harness()
    await remote.create({ sessionId: SessionId('s-used'), agentPreset: 'standard' })
    ctx.sessions.get(SessionId('s-used'))!.append('turn/start', { turn: 0 })
    await expect(remote.commitAskData({
      sourceId: 'src-sample',
      sessionId: SessionId('s-used'),
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'gateway/bad-request' },
    })
    expect(ctx.sessions.get(SessionId('s-used'))).toBeDefined()
  })

  it('refuses prompt on an unbound data-agent session', async () => {
    const { remote } = await harness()
    await remote.create({ sessionId: SessionId('s-unbound'), agentPreset: 'data-agent' })
    await expect(remote.prompt({
      requestId: 'r1' as SessionRequestId,
      sessionId: SessionId('s-unbound'),
      mode: 'queue',
      content: [{ type: 'text', text: 'hi' }],
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/ask-data-unbound' },
    })
  })

  it('refuses prompt when askDataBinding is null', async () => {
    const { remote, ctx } = await harness()
    await remote.create({ sessionId: SessionId('s-null'), agentPreset: 'data-agent' })
    const original = ctx.sessionProjections.stateOf.bind(ctx.sessionProjections)
    vi.spyOn(ctx.sessionProjections, 'stateOf').mockImplementation((session, key) => {
      if (key === 'askDataBinding') return null as never
      return original(session, key)
    })
    await expect(remote.prompt({
      requestId: 'r-null' as SessionRequestId,
      sessionId: SessionId('s-null'),
      mode: 'queue',
      content: [{ type: 'text', text: 'hi' }],
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/ask-data-unbound' },
    })
  })

  it('defaults previousPreset to standard when the projection is empty', async () => {
    const { remote, ctx, selects } = await harness()
    await remote.create({ sessionId: SessionId('s-nopreset'), agentPreset: 'standard' })
    const original = ctx.sessionProjections.stateOf.bind(ctx.sessionProjections)
    vi.spyOn(ctx.sessionProjections, 'stateOf').mockImplementation((session, key) => {
      if (key === 'agentPreset') return undefined
      return original(session, key)
    })
    const stub = ctx.get('askData') as StubAskData
    stub.bindImpl = async () => {
      throw new AskDataError('bind-failed', 'nope')
    }
    await expect(remote.commitAskData({
      sourceId: 'src-sample',
      sessionId: SessionId('s-nopreset'),
    })).resolves.toMatchObject({ ok: false })
    expect(selects.at(-1)).toBe('standard')
  })

  it('allows prompt on standard and on a bound data-agent session', async () => {
    const { remote } = await harness()
    await remote.create({ sessionId: SessionId('s-std-prompt'), agentPreset: 'standard' })
    const standard = await remote.prompt({
      requestId: 'r-std' as SessionRequestId,
      sessionId: SessionId('s-std-prompt'),
      mode: 'queue',
      content: [{ type: 'text', text: 'hi' }],
    })
    expect(standard.ok === false && standard.error.code === 'session/ask-data-unbound').toBe(false)
    await remote.create({ sessionId: SessionId('s-bound-prompt'), agentPreset: 'data-agent' })
    await remote.commitAskData({ sourceId: 'src-sample', sessionId: SessionId('s-bound-prompt') })
    const bound = await remote.prompt({
      requestId: 'r-bound' as SessionRequestId,
      sessionId: SessionId('s-bound-prompt'),
      mode: 'queue',
      content: [{ type: 'text', text: 'hi' }],
    })
    expect(bound.ok === false && bound.error.code === 'session/ask-data-unbound').toBe(false)
  })

  it('refuses leaving data-agent after a successful bind', async () => {
    const { remote, ctx } = await harness()
    await remote.create({ sessionId: SessionId('s-bound'), agentPreset: 'data-agent' })
    await remote.commitAskData({ sourceId: 'src-sample', sessionId: SessionId('s-bound') })
    const agent = ctx.agents.get(SessionId('s-bound'))!
    const presets = ctx.get('agentPresets') as {
      select(agent: Agent, next: string): Promise<string>
    }
    await expect(presets.select(agent, 'standard')).rejects.toMatchObject({
      code: 'session/ask-data-bound',
    })
  })

  it('rejects an external select while commit holds the session lock', async () => {
    const { remote, ctx } = await harness()
    await remote.create({ sessionId: SessionId('s-busy'), agentPreset: 'standard' })
    const stub = ctx.get('askData') as StubAskData
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    let entered!: () => void
    const inBind = new Promise<void>((resolve) => { entered = resolve })
    stub.bindImpl = async (request) => {
      entered()
      await held
      return {
        binding: {
          sourceId: request.sourceId,
          connectionRef: 'ask-data:src-sample',
          displayName: '示例：销售明细',
          readonly: true,
        },
        rollback: async () => undefined,
      }
    }
    const commit = remote.commitAskData({
      sourceId: 'src-sample',
      sessionId: SessionId('s-busy'),
    })
    await inBind
    const agent = ctx.agents.get(SessionId('s-busy'))!
    const presets = ctx.get('agentPresets') as {
      select(agent: Agent, next: string): Promise<string>
    }
    await expect(presets.select(agent, 'data-agent')).rejects.toBeInstanceOf(RemoteError)
    await expect(presets.select(agent, 'data-agent')).rejects.toMatchObject({
      code: 'session/busy',
    })
    release()
    await expect(commit).resolves.toMatchObject({ ok: true })
  })

  it('lists sources, imports a spreadsheet, and maps list failures', async () => {
    const { remote, ctx } = await harness()
    await expect(remote.listAskDataSources()).resolves.toMatchObject({ ok: true, value: [] })
    await expect(remote.importAskDataSpreadsheet({
      filename: 'a.csv',
      bytes: 'aGk=',
      replaceSourceId: 'src-1',
    })).resolves.toMatchObject({
      ok: true,
      value: { source: { displayName: 'a.csv' } },
    })
    const stub = ctx.get('askData') as StubAskData
    stub.listSources = async () => {
      throw new AskDataError('source-invalid', 'bad', { ruleId: 'accept-xlsx-csv' })
    }
    await expect(remote.listAskDataSources()).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/ask-data-failed', details: { ruleId: 'accept-xlsx-csv' } },
    })
  })

  it('maps aborted, unavailable, remote, and generic import failures', async () => {
    const { remote, ctx } = await harness()
    const stub = ctx.get('askData') as StubAskData
    const ac = new AbortController()
    stub.importSample = async () => {
      ac.abort()
      throw new Error('late')
    }
    await expect(remote.importAskDataSample(ac.signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'gateway/cancelled' },
    })
    stub.importSample = async () => {
      throw new AskDataError('ask-data-unavailable', 'gone')
    }
    await expect(remote.importAskDataSample()).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/ask-data-unavailable' },
    })
    stub.importSample = async () => {
      throw new RemoteError('gateway/internal', 'passthrough', {})
    }
    await expect(remote.importAskDataSample()).resolves.toMatchObject({
      ok: false,
      error: { code: 'gateway/internal', message: 'passthrough' },
    })
    stub.importSample = async () => {
      throw new Error('boom')
    }
    await expect(remote.importAskDataSample()).resolves.toMatchObject({
      ok: false,
      error: { message: 'boom' },
    })
    stub.importSample = async () => {
      throw 'string-throw'
    }
    await expect(remote.importAskDataSample()).resolves.toMatchObject({
      ok: false,
      error: { message: 'string-throw' },
    })
    stub.importSpreadsheet = async () => {
      throw new AskDataError('file-too-large', 'big', { limit: 3 })
    }
    await expect(remote.importAskDataSpreadsheet({
      filename: 'a.csv',
      bytes: 'aGk=',
    })).resolves.toMatchObject({
      ok: false,
      error: { details: { limit: 3 } },
    })
  })

  it('reads a missing binding and refuses an unknown session', async () => {
    const { remote } = await harness()
    await remote.create({ sessionId: SessionId('s-bind'), agentPreset: 'standard' })
    await expect(remote.askDataBinding({ sessionId: SessionId('s-bind') })).resolves.toMatchObject({
      ok: true,
      value: null,
    })
    await expect(remote.askDataBinding({ sessionId: SessionId('missing') })).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/not-found' },
    })
  })

  it('allows a second commit of the same source and rejects a missing workspace', async () => {
    const { remote } = await harness()
    await remote.create({ sessionId: SessionId('s-same'), agentPreset: 'data-agent' })
    const first = await remote.commitAskData({
      sourceId: 'src-sample',
      sessionId: SessionId('s-same'),
    })
    expect(first.ok).toBe(true)
    await expect(remote.commitAskData({
      sourceId: 'src-sample',
      sessionId: SessionId('s-same'),
    })).resolves.toMatchObject({ ok: true })
    await expect(remote.commitAskData({
      sourceId: 'src-sample',
      workspaceId: 'missing' as WorkspaceId,
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'workspace/not-found' },
    })
  })

  it('fails commit when agent-presets is missing on a non-data-agent session', async () => {
    const { remote, ctx } = await harness()
    await remote.create({ sessionId: SessionId('s-nopreset'), agentPreset: 'standard' })
    const original = ctx.get.bind(ctx)
    vi.spyOn(ctx, 'get').mockImplementation(((name: string) => {
      if (name === 'agentPresets') return undefined
      return original(name as never)
    }) as typeof ctx.get)
    await expect(remote.commitAskData({
      sourceId: 'src-sample',
      sessionId: SessionId('s-nopreset'),
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'gateway/internal' },
    })
  })

  it('attaches a workspace on create and detaches it when bind fails', async () => {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-ask-data-ws-')))
    const workspace = {
      path: cwd,
      attachSession: vi.fn(async () => undefined),
      detachSession: vi.fn(async () => { throw new Error('detach failed') }),
    }
    const { remote, ctx } = await harness({ workspace })
    const stub = ctx.get('askData') as StubAskData
    stub.bindImpl = async () => {
      throw new AskDataError('bind-failed', 'nope')
    }
    const result = await remote.commitAskData({
      sourceId: 'src-sample',
      workspaceId: 'ws-1' as WorkspaceId,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error, result.error.message).toMatchObject({
      code: 'session/ask-data-failed',
    })
    expect(workspace.attachSession).toHaveBeenCalled()
    expect(workspace.detachSession).toHaveBeenCalled()
    expect(ctx.sessions.list()).toEqual([])
  })

  it('treats sessionListMetadata.blank as authoritative', async () => {
    const { remote, ctx } = await harness()
    await remote.create({ sessionId: SessionId('s-meta'), agentPreset: 'standard' })
    const original = ctx.sessionProjections.stateOf.bind(ctx.sessionProjections)
    vi.spyOn(ctx.sessionProjections, 'stateOf').mockImplementation((session, key) => {
      if (key === 'sessionListMetadata') return { blank: false, lastPromptAt: null }
      return original(session, key)
    })
    await expect(remote.commitAskData({
      sourceId: 'src-sample',
      sessionId: SessionId('s-meta'),
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'gateway/bad-request' },
    })
  })

  it('uses turnBoundary when sessionListMetadata is absent', async () => {
    const { remote, ctx } = await harness()
    await remote.create({ sessionId: SessionId('s-turn'), agentPreset: 'data-agent' })
    const original = ctx.sessionProjections.stateOf.bind(ctx.sessionProjections)
    vi.spyOn(ctx.sessionProjections, 'stateOf').mockImplementation((session, key) => {
      if (key === 'sessionListMetadata') return undefined
      if (key === 'turnBoundary') return { openTurnStartSeq: null, lastTurn: 0 } as never
      return original(session, key)
    })
    await expect(remote.commitAskData({
      sourceId: 'src-sample',
      sessionId: SessionId('s-turn'),
    })).resolves.toMatchObject({ ok: true })
  })

  it('treats a missing turnBoundary as blank', async () => {
    const { remote, ctx } = await harness()
    await remote.create({ sessionId: SessionId('s-boundry'), agentPreset: 'data-agent' })
    const original = ctx.sessionProjections.stateOf.bind(ctx.sessionProjections)
    vi.spyOn(ctx.sessionProjections, 'stateOf').mockImplementation((session, key) => {
      if (key === 'sessionListMetadata' || key === 'turnBoundary') return undefined
      return original(session, key)
    })
    await expect(remote.commitAskData({
      sourceId: 'src-sample',
      sessionId: SessionId('s-boundry'),
    })).resolves.toMatchObject({ ok: true })
  })

  it('rejects an aborted commit and an unresolved existing session', async () => {
    const { remote } = await harness()
    const ac = new AbortController()
    ac.abort()
    await expect(remote.commitAskData({ sourceId: 'src-sample' }, ac.signal)).resolves.toMatchObject({
      ok: false,
    })
    await expect(remote.commitAskData({
      sourceId: 'src-sample',
      sessionId: SessionId('missing'),
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/not-found' },
    })
  })

  it('creates two sessions for the same source when sessionId is omitted', async () => {
    const { remote, ctx } = await harness()
    const a = await remote.commitAskData({ sourceId: 'src-sample' })
    const b = await remote.commitAskData({ sourceId: 'src-sample' })
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(a.value.sessionId).not.toBe(b.value.sessionId)
    expect(ctx.sessions.list()).toHaveLength(2)
  })
})

describe('SessionCallGate and CommitFifo', () => {
  it('reenters on the same stack and rejects an external waiter', async () => {
    const gate = new SessionCallGate()
    const id = SessionId('g1')
    const seen: string[] = []
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    let entered!: () => void
    const inRun = new Promise<void>((resolve) => { entered = resolve })
    const first = gate.run(id, 'wait', async () => {
      seen.push('outer')
      expect(gate.isReentrant(id)).toBe(true)
      expect(gate.isExternallyHeld(id)).toBe(false)
      await gate.run(id, 'reject', async () => { seen.push('inner') })
      entered()
      await held
    })
    await inRun
    expect(gate.isExternallyHeld(id)).toBe(true)
    await expect(gate.run(id, 'reject', async () => 'x')).rejects.toMatchObject({
      code: 'session/busy',
    })
    release()
    await first
    expect(seen).toEqual(['outer', 'inner'])
  })

  it('waits for the holder then runs', async () => {
    const gate = new SessionCallGate()
    const id = SessionId('g-wait')
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    let entered!: () => void
    const inFirst = new Promise<void>((resolve) => { entered = resolve })
    const first = gate.run(id, 'wait', async () => {
      entered()
      await held
      return 1
    })
    await inFirst
    const second = gate.run(id, 'wait', async () => 2)
    release()
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2])
  })

  it('queues waiters in FIFO order', async () => {
    const fifo = new CommitFifo()
    const order: number[] = []
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const first = fifo.enqueue(async () => {
      await held
      order.push(1)
      return 1
    })
    const second = fifo.enqueue(async () => {
      order.push(2)
      return 2
    })
    release()
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2])
    expect(order).toEqual([1, 2])
  })
})
