/**
 * Integration test harness mounting real runtime dependencies:
 * jsonl persistence + agent loop + subagent + session-controller + mock provider.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import SessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQueryEngine, { type SessionObservation, type SessionObservationOptions } from '@deepseek-ai/dsh-session-query'
import SubagentService from '@deepseek-ai/dsh-subagent'
import * as SubagentFork from '@deepseek-ai/dsh-subagent-fork-in-process'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import SessionController from '@deepseek-ai/dsh-api-session-controller'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
export { textResponse }
import AssistantService, { type Config as AssistantConfig } from '../src/index.ts'
import { AssistantCatalog } from '../src/catalog.ts'
import { TeamService } from '@deepseek-ai/dsh-experimental-agent-team'

export class TestSessionQuery extends SessionQueryEngine {
  static override inject = ['sessions', 'sessionPersistence']

  override async observeSession(
    sessionId: SessionId,
    options: SessionObservationOptions = {},
  ): Promise<SessionObservation> {
    const live = this.ctx.sessions.get(sessionId)
    if (live !== undefined) {
      const cursor = live.snapshotEvents().at(-1)?.seq ?? -1
      const lease = (): SessionObservation => ({
        source: 'live',
        header: live.header,
        inheritedEventCount: SessionLogOffset(0),
        events: live.snapshotEvents(),
        cursor,
        projections: {
          asOfSeq: cursor,
          values: {},
        },
        retain: lease,
        [Symbol.dispose]: () => {},
      })
      return lease()
    }
    const handle = await this.ctx.sessionPersistence.open(
      sessionId,
      'read',
      options.signal === undefined ? {} : { signal: options.signal },
    )
    try {
      const read = await handle.read(
        0, undefined, options.signal === undefined ? {} : { signal: options.signal },
      )
      const cursor = read.events.at(-1)?.seq ?? -1
      const lease = (): SessionObservation => ({
        source: 'prepared',
        header: handle.header,
        inheritedEventCount: SessionLogOffset(0),
        events: read.events,
        cursor,
        projections: {
          asOfSeq: cursor,
          values: {},
        },
        retain: lease,
        [Symbol.dispose]: () => {},
      })
      return lease()
    } finally {
      await handle.close()
    }
  }

  override searchSessions(): Promise<never> {
    return Promise.reject(new Error('session search not configured in harness'))
  }

  override searchEvents(): Promise<never> {
    return Promise.reject(new Error('event search not configured in harness'))
  }
}

export interface AssistantHarnessOptions {
  readonly storageRoot?: string | undefined
  readonly withCatalog?: boolean | undefined
  readonly withAgentTeams?: boolean | undefined
  readonly leadSessionId?: SessionId | undefined
}

export interface AssistantTestHarness {
  readonly ctx: Context
  readonly lead: Agent
  readonly adapter: MockAdapter
  readonly storageRoot: string
  readonly assistants: AssistantService
  readonly controller: SessionController
  readonly catalog?: AssistantCatalog | undefined
  dispose(keepStorage?: boolean): Promise<void>
}

export async function setupAssistantHarness(
  scriptOrAdapter?: ConstructorParameters<typeof MockAdapter>[0] | MockAdapter,
  config: AssistantConfig = {},
  options: AssistantHarnessOptions = {},
): Promise<AssistantTestHarness> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)

  const storageRoot = options.storageRoot ?? mkdtempSync(join(tmpdir(), 'dsh-asst-'))
  await ctx.plugin(SessionPersistenceJsonl, { root: storageRoot })
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(SubagentFork, { providerName: 'fork' })

  if (options.withAgentTeams) {
    await ctx.plugin(TeamService, {
      institutionCatalogPath: join(storageRoot, 'institution-squads.json'),
    })
  }

  const withCatalog = options.withCatalog !== false
  if (withCatalog) {
    const storagesDir = join(storageRoot, 'storages')
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root: storagesDir })
    await ctx.plugin(StorageDomain, { backend: 'json' })
  }

  // Stubs for SessionController injection
  const disposeNoop = (): void => {}
  ctx.provide('typert', {
    lookups: { configure: () => disposeNoop },
    contexts: { configureHost: () => disposeNoop },
  } as never)
  ctx.provide('fileUploads', {
    registerAgentResolver: () => disposeNoop,
    resolve: () => undefined,
    bindPrompt: () => ({ commit: () => {}, [Symbol.dispose]: () => {} }),
    retirePrompt: () => {},
  } as never)
  ctx.provide('attachments', {
    imageLimits: { maxImages: 10, maxDimension: 4096, maxBytes: 10485760 },
    admitPromptContent: async (content: unknown[]) => content,
  } as never)
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'mock', model: 'mock' }),
    saveSelection: async () => {},
  } as never)
  ctx.provide('workspaceRegistry', {
    list: () => [],
    archivedSessionIds: [],
  } as never)

  const controller = new SessionController(
    ctx,
    { nativeOpen: false, listWorkSliceMs: 16 },
    { canOpenPath: () => false },
  )

  const storagesDir = withCatalog ? join(storageRoot, 'storages') : undefined
  const assistants = new AssistantService(ctx, {
    ...storagesDir !== undefined ? { lockPath: join(storagesDir, 'assistants.lock') } : {},
    ...withCatalog ? {} : { autoOpen: false },
    ...config,
  })

  let catalog: AssistantCatalog | undefined
  if (withCatalog && storagesDir !== undefined) {
    try {
      catalog = await assistants.initCatalog({ lockPath: join(storagesDir, 'assistants.lock') })
    } catch (error) {
      await ctx.fiber.dispose()
      if (!options.storageRoot) rmSync(storageRoot, { recursive: true, force: true })
      throw error
    }
  }

  const defaultScript = Array.from({ length: 50 }, () => textResponse('Real seat response'))
  const resolved = scriptOrAdapter ?? defaultScript
  const adapter = resolved instanceof MockAdapter ? resolved : new MockAdapter(resolved)
  ctx.llm.registerAdapter(['mock'], adapter)

  const leadId = options.leadSessionId ?? SessionId('lead')
  const lead = await ctx.agentLoop.create(leadId, { provider: 'mock', model: 'mock' })

  return {
    ctx,
    lead,
    adapter,
    storageRoot,
    assistants,
    controller,
    ...catalog !== undefined ? { catalog } : (assistants.catalog !== undefined ? { catalog: assistants.catalog } : {}),
    async dispose(keepStorage: boolean = false) {
      try {
        if (assistants.catalog) {
          await assistants.catalog.close()
        }
        await ctx.fiber.dispose()
      } finally {
        if (!keepStorage && !options.storageRoot) {
          rmSync(storageRoot, { recursive: true, force: true })
        }
      }
    },
  }
}
