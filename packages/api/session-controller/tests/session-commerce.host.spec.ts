/** session commerce remotes: unavailable, base64 cap, commit compensation, preset, and binding rules. */

import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentFactory } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  Commerce,
  CommerceError,
  commerceBindingProjectionDefinition,
  type CommerceAnalysisResult,
  type CommerceAnalysisSchema,
  type CommerceImportPreview,
  type CommerceImportSpreadsheetRequest,
  type CommerceInventoryHealth,
  type CommerceListing,
  type CommerceListingSummary,
  type CommerceSalesSummary,
  type CommerceSource,
  type CommerceSourceDescription,
  type CommerceSourceId,
} from '@deepseek-ai/dsh-host-commerce'
import { agentPresetProjectionDefinition } from '@deepseek-ai/dsh-agent-presets'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { createSessionTestRemote } from './test-remote.ts'
import { COMMERCE_MAX_DECODED_BYTES } from '../src/types.ts'

const SOURCE = 'src-commerce-1' as CommerceSourceId

class StubCommerce extends Commerce {
  describeImpl: (sourceId: CommerceSourceId) => Promise<CommerceSourceDescription> = () =>
    Promise.resolve({ displayName: 'Fictional tea shop', kinds: ['products'] })

  importImpl: () => Promise<CommerceImportPreview> = () => Promise.resolve({
    source: { id: SOURCE, displayName: 'Fictional tea shop', kinds: ['products'] },
    tables: [{ kind: 'products', rowCount: 2, columns: ['listing_id', 'title'] }],
    warnings: [],
  })

  listImpl: () => Promise<CommerceSource[]> = () => Promise.resolve([
    { id: SOURCE, displayName: 'Fictional tea shop', kinds: ['products'] },
  ])

  override listSources(): Promise<CommerceSource[]> {
    return this.listImpl()
  }

  override platforms(): readonly string[] {
    return ['sample']
  }

  override importSpreadsheet(_request: CommerceImportSpreadsheetRequest): Promise<CommerceImportPreview> {
    return this.importImpl()
  }

  override importSample(): Promise<CommerceImportPreview> {
    return this.importImpl()
  }

  override describeSource(sourceId: CommerceSourceId): Promise<CommerceSourceDescription> {
    return this.describeImpl(sourceId)
  }

  override searchListings(): Promise<CommerceListingSummary[]> {
    return Promise.reject(new Error('searchListings is not part of the Remote surface'))
  }

  override getListing(): Promise<CommerceListing> {
    return Promise.reject(new Error('getListing is not part of the Remote surface'))
  }

  override salesSummary(): Promise<CommerceSalesSummary> {
    return Promise.reject(new Error('salesSummary is not part of the Remote surface'))
  }

  override inventoryHealth(): Promise<CommerceInventoryHealth> {
    return Promise.reject(new Error('inventoryHealth is not part of the Remote surface'))
  }

  override analysisSchema(): Promise<CommerceAnalysisSchema> {
    return Promise.reject(new Error('analysisSchema is not part of the Remote surface'))
  }

  override runAnalysisQuery(): Promise<CommerceAnalysisResult> {
    return Promise.reject(new Error('runAnalysisQuery is not part of the Remote surface'))
  }

  override renderExport(): Promise<string> {
    return Promise.reject(new Error('renderExport is not part of the Remote surface'))
  }
}

function stubAgent(session: Session): Agent {
  return { id: session.id, session, status: 'idle' } as unknown as Agent
}

async function harness(options: {
  commerce?: boolean
  presets?: 'roster' | 'missing-preset' | 'none'
} = {}) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-commerce-session-')))
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  ctx.sessionProjections.register(commerceBindingProjectionDefinition)
  ctx.sessionProjections.register(agentPresetProjectionDefinition)

  const selects: string[] = []
  const rosterMode = options.presets ?? 'roster'
  const notFound = (id: string): RemoteError<'agent-preset/not-found'> => new RemoteError(
    'agent-preset/not-found',
    `agent-presets: preset "${id}" not found (available: standard)`,
    { agentPreset: id, available: ['standard'] },
  )
  if (rosterMode !== 'none') {
    ctx.provide('agentPresets', {
      defaultId: 'standard',
      resolve: (id?: string) => rosterMode === 'missing-preset' && id === 'commerce'
        ? Promise.reject(notFound('commerce'))
        : Promise.resolve({ id: id ?? 'standard', trust: 'system', path: `/presets/${id ?? 'standard'}/agent.cordis.yml` }),
      mount: async () => ({ id: 'standard' }),
      admitSelect: () => () => {},
      select(agent: Agent, next: string) {
        if (rosterMode === 'missing-preset' && next === 'commerce') return Promise.reject(notFound('commerce'))
        selects.push(next)
        agent.session.append('agent-preset/selected', { agentPreset: next })
        return Promise.resolve(next)
      },
    })
  }

  const factory: AgentFactory = {
    async createAgent(_ownerCtx, createOptions) {
      const session = ctx.sessions.prepare(
        createOptions.sessionId,
        createOptions.meta === undefined ? {} : { meta: createOptions.meta },
      )
      const detach = ctx.sessions.enter(session)
      ctx.sessions.announce(session)
      const agent = stubAgent(session)
      const agentCtx = ctx.extend({ agent })
      ;(agent as { ctx?: Context }).ctx = agentCtx
      await createOptions.setup?.(agentCtx)
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
  ctx.provide('workspaceRegistry', { get: () => undefined } as never)
  if (options.commerce !== false) await ctx.plugin(StubCommerce)
  const remote = createSessionTestRemote(ctx, {
    defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
    cwd,
  })
  return { remote, ctx, selects, commerce: ctx.get('commerce') as StubCommerce | undefined }
}

describe('session commerce remotes', () => {
  it('fails every commerce remote without the capability', async () => {
    const { remote } = await harness({ commerce: false })
    await expect(remote.listCommerceSources()).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/commerce-unavailable' },
    })
    await expect(remote.importCommerceSample()).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/commerce-unavailable' },
    })
  })

  it('lists sources and imports the sample without opening a session', async () => {
    const { remote, ctx } = await harness()
    await expect(remote.listCommerceSources()).resolves.toEqual({
      ok: true,
      value: [{ id: SOURCE, displayName: 'Fictional tea shop', kinds: ['products'] }],
    })
    const imported = await remote.importCommerceSample()
    expect(imported).toMatchObject({
      ok: true,
      value: {
        source: { id: SOURCE },
        tables: [{ kind: 'products', rowCount: 2, columns: ['listing_id', 'title'] }],
      },
    })
    expect([...ctx.agents.list()]).toHaveLength(0)
  })

  it('lists the configured platform mappings', async () => {
    const { remote } = await harness()
    await expect(remote.listCommercePlatforms()).resolves.toEqual({ ok: true, value: ['sample'] })
    const absent = await harness({ commerce: false })
    await expect(absent.remote.listCommercePlatforms()).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/commerce-unavailable' },
    })
  })

  it('rejects a non-canonical payload and one over the decoded cap', async () => {
    const { remote } = await harness()
    await expect(remote.importCommerceSpreadsheet({
      filename: 'products.csv', bytes: 'not base64!', kind: 'products', platform: 'sample',
    })).resolves.toMatchObject({ ok: false, error: { code: 'gateway/bad-request' } })
    const oversize = 'A'.repeat(Math.ceil((COMMERCE_MAX_DECODED_BYTES + 1024) / 3) * 4)
    await expect(remote.importCommerceSpreadsheet({
      filename: 'products.csv', bytes: oversize, kind: 'products', platform: 'sample',
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/commerce-failed', details: { code: 'file-too-large', ruleId: 'file-size' } },
    })
  })

  it('maps a CommerceError from import onto the failed code', async () => {
    const { remote, commerce } = await harness()
    commerce!.importImpl = () => Promise.reject(new CommerceError('import-invalid', 'header row is missing', { ruleId: 'first-row-header' }))
    await expect(remote.importCommerceSpreadsheet({
      filename: 'products.csv', bytes: Buffer.from('listing,title\n').toString('base64'), kind: 'products', platform: 'sample',
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/commerce-failed', details: { code: 'import-invalid', ruleId: 'first-row-header' } },
    })
  })

  it('creates one commerce session on commit and records the bind', async () => {
    const { remote, ctx, selects } = await harness()
    const committed = await remote.commitCommerce({ sourceId: SOURCE })
    expect(committed.ok).toBe(true)
    if (!committed.ok) return
    const agent = ctx.agents.get(committed.value.sessionId)
    expect(agent?.session.snapshotEvents().some(event => event.type === 'commerce/bound')).toBe(true)
    expect(ctx.sessionProjections.stateOf(agent!.session, 'commerceBinding')).toMatchObject({ sourceId: SOURCE })
    // The created Session composes the preset; only an existing Session is switched.
    expect(selects).toEqual([])
  })

  it('disposes a created session when the bind fails', async () => {
    const { remote, ctx, commerce } = await harness()
    commerce!.describeImpl = () => Promise.reject(new CommerceError('source-missing', 'source not found'))
    await expect(remote.commitCommerce({ sourceId: SOURCE })).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/commerce-failed', details: { code: 'source-missing' } },
    })
    expect([...ctx.agents.list()]).toHaveLength(0)
  })

  it('selects the commerce preset on a blank session and restores it when the bind fails', async () => {
    const { remote, ctx, commerce, selects } = await harness()
    const sessionId = SessionId('blank-session')
    const created = await ctx.agents.create({
      sessionId,
      meta: { cwd: process.cwd(), agentPreset: 'standard' },
      agentOptions: { provider: 'test', model: 'test-model' },
    })
    commerce!.describeImpl = () => Promise.reject(new CommerceError('source-missing', 'source not found'))
    await expect(remote.commitCommerce({ sourceId: SOURCE, sessionId })).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/commerce-failed' },
    })
    expect(selects).toEqual(['commerce', 'standard'])
    expect(ctx.agents.get(sessionId)).toBeDefined()
    await created.dispose()
  })

  it('binds an existing blank session and reports the same session for a repeated commit', async () => {
    const { remote, ctx, selects } = await harness()
    const sessionId = SessionId('blank-bind')
    const created = await ctx.agents.create({
      sessionId,
      meta: { cwd: process.cwd(), agentPreset: 'standard' },
      agentOptions: { provider: 'test', model: 'test-model' },
    })
    await expect(remote.commitCommerce({ sourceId: SOURCE, sessionId })).resolves.toEqual({ ok: true, value: { sessionId } })
    await expect(remote.commitCommerce({ sourceId: SOURCE, sessionId })).resolves.toEqual({ ok: true, value: { sessionId } })
    const bound = created.agent.session.snapshotEvents().filter(event => event.type === 'commerce/bound')
    expect(bound).toHaveLength(1)
    expect(selects).toEqual(['commerce'])
    await created.dispose()
  })

  it('refuses a session bound to a different source and a non-blank unbound session', async () => {
    const { remote, ctx } = await harness()
    const bound = SessionId('other-source')
    const boundSession = await ctx.agents.create({
      sessionId: bound,
      meta: { cwd: process.cwd(), agentPreset: 'standard' },
      agentOptions: { provider: 'test', model: 'test-model' },
    })
    await remote.commitCommerce({ sourceId: SOURCE, sessionId: bound })
    await expect(remote.commitCommerce({ sourceId: 'src-other', sessionId: bound })).resolves.toMatchObject({
      ok: false,
      error: { code: 'gateway/bad-request' },
    })

    const busy = SessionId('started-session')
    const busySession = await ctx.agents.create({
      sessionId: busy,
      meta: { cwd: process.cwd(), agentPreset: 'standard' },
      agentOptions: { provider: 'test', model: 'test-model' },
    })
    busySession.agent.session.append('turn/start', { turn: 1 })
    await expect(remote.commitCommerce({ sourceId: SOURCE, sessionId: busy })).resolves.toMatchObject({
      ok: false,
      error: { code: 'gateway/bad-request' },
    })
    expect(ctx.agents.get(busy)).toBeDefined()
    await Promise.all([boundSession.dispose(), busySession.dispose()])
  })

  it('reports the preset as unavailable when the roster has no commerce preset', async () => {
    const created = await harness({ presets: 'missing-preset' })
    await expect(created.remote.commitCommerce({ sourceId: SOURCE })).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/commerce-preset-unavailable', details: { preset: 'commerce' } },
    })
    expect([...created.ctx.agents.list()]).toHaveLength(0)

    const existing = await harness({ presets: 'missing-preset' })
    const sessionId = SessionId('no-preset')
    const agent = await existing.ctx.agents.create({
      sessionId,
      meta: { cwd: process.cwd(), agentPreset: 'standard' },
      agentOptions: { provider: 'test', model: 'test-model' },
    })
    await expect(existing.remote.commitCommerce({ sourceId: SOURCE, sessionId })).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/commerce-preset-unavailable' },
    })
    await agent.dispose()

    const rosterless = await harness({ presets: 'none' })
    const bare = SessionId('no-roster')
    const bareAgent = await rosterless.ctx.agents.create({
      sessionId: bare,
      meta: { cwd: process.cwd() },
      agentOptions: { provider: 'test', model: 'test-model' },
    })
    await expect(rosterless.remote.commitCommerce({ sourceId: SOURCE, sessionId: bare })).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/commerce-preset-unavailable' },
    })
    await bareAgent.dispose()
  })
})
