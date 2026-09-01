/** Provider methods that the happy-path suites do not call. */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AskKnowledgeLibraryId } from '@deepseek-ai/dsh-host-ask-knowledge'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createCatalogLibrary, resumeDeleting, writeCatalog } from '../src/catalog.ts'
import DesktopAskKnowledge from '../src/index.ts'
import { registerAskKnowledgeTools } from '../src/tools.ts'
import { bootOverlay } from './helpers/boot.ts'
import { installFakeSidecar, writeFakeSidecarEnv } from './helpers/install-sidecar.ts'

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

function liveSession(ctx: Context, id: string) {
  const session = ctx.sessions.prepare(SessionId(id))
  const detach = ctx.sessions.enter(session)
  ctx.sessions.announce(session)
  cleanups.push(detach)
  return session
}

describe('ask-knowledge provider surface', () => {
  it('renames, reports status, marks used, and wraps the session lock', async () => {
    const started = await bootOverlay({ sessions: true })
    cleanups.push(() => started.fiber.dispose())
    const { ctx } = started
    const created = await ctx.askKnowledge.createLibrary({
      displayName: '旧名',
      workspaceId: 'ws' as never,
    })
    const renamed = await ctx.askKnowledge.renameLibrary({
      libraryId: created.id,
      displayName: '新名',
    })
    expect(renamed.displayName).toBe('新名')
    const status = await ctx.askKnowledge.libraryStatus({ libraryId: created.id })
    expect(status.library.displayName).toBe('新名')
    expect(status.pendingAuditCount).toBe(0)
    await (ctx.askKnowledge as DesktopAskKnowledge).markUsed(created.id)
    const listed = await ctx.askKnowledge.listLibraries()
    expect(listed[0]?.id).toBe(created.id)
    const value = await (ctx.askKnowledge as DesktopAskKnowledge)
      .withSessionLock(SessionId('lock'), async () => 'ok')
    expect(value).toBe('ok')
  })

  it('rejects attach and detach when the session is not live', async () => {
    const started = await bootOverlay({ sessions: true })
    cleanups.push(() => started.fiber.dispose())
    const { ctx } = started
    const created = await ctx.askKnowledge.createLibrary({ displayName: '忙' })
    await expect(ctx.askKnowledge.attach({
      libraryId: created.id,
      sessionId: SessionId('ghost'),
    })).rejects.toMatchObject({ code: 'session-busy' })
    await expect(ctx.askKnowledge.detach({ sessionId: SessionId('ghost') }))
      .rejects.toMatchObject({ code: 'session-busy' })
  })

  it('rolls back attach and no-ops a second detach', async () => {
    const started = await bootOverlay({ sessions: true })
    cleanups.push(() => started.fiber.dispose())
    const { ctx } = started
    const first = await ctx.askKnowledge.createLibrary({ displayName: 'A' })
    const second = await ctx.askKnowledge.createLibrary({ displayName: 'B' })
    const session = liveSession(ctx, 'lease')
    const firstLease = await ctx.askKnowledge.attach({ libraryId: first.id, sessionId: session.id })
    await firstLease.rollback()
    expect(ctx.sessionProjections.stateOf(session, 'askKnowledgeBinding')).toBeNull()
    await ctx.askKnowledge.attach({ libraryId: first.id, sessionId: session.id })
    const switched = await ctx.askKnowledge.attach({ libraryId: second.id, sessionId: session.id })
    await switched.rollback()
    expect(ctx.sessionProjections.stateOf(session, 'askKnowledgeBinding')).toMatchObject({
      libraryId: first.id,
    })
    await ctx.askKnowledge.detach({ sessionId: session.id })
    await ctx.askKnowledge.detach({ sessionId: session.id })
    expect(ctx.sessionProjections.stateOf(session, 'askKnowledgeBinding')).toBeNull()
    await ctx.askKnowledge.attach({ libraryId: first.id, sessionId: session.id })
    await ctx.askKnowledge.attach({ libraryId: first.id, sessionId: session.id })
    const gone = await ctx.askKnowledge.attach({ libraryId: first.id, sessionId: session.id })
    cleanups.pop()?.()
    await gone.rollback()
    await ctx.askKnowledge.removeLibrary({ libraryId: AskKnowledgeLibraryId('missing-id') })
  })

  it('rejects unknown ingest handles and aborted signals', async () => {
    const started = await bootOverlay({ sessions: true })
    cleanups.push(() => started.fiber.dispose())
    const { ctx } = started
    const created = await ctx.askKnowledge.createLibrary({ displayName: '上传' })
    const aborted = AbortSignal.abort()
    await expect(ctx.askKnowledge.createLibrary({ displayName: 'x' }, aborted)).rejects.toThrow()
    await expect(ctx.askKnowledge.renameLibrary({
      libraryId: created.id,
      displayName: 'y',
    }, aborted)).rejects.toThrow()
    await expect(ctx.askKnowledge.removeLibrary({ libraryId: created.id }, aborted)).rejects.toThrow()
    await expect(ctx.askKnowledge.attach({
      libraryId: created.id,
      sessionId: SessionId('s'),
    }, aborted)).rejects.toThrow()
    await expect(ctx.askKnowledge.detach({ sessionId: SessionId('s') }, aborted)).rejects.toThrow()
    await expect(ctx.askKnowledge.beginIngest({
      libraryId: created.id,
      filename: 'a.md',
    }, aborted)).rejects.toThrow()
    await expect(ctx.askKnowledge.appendIngestChunk({
      handle: 'gone' as never,
      bytes: 'YQ==',
    })).rejects.toMatchObject({ code: 'ingest-failed' })
    await expect(ctx.askKnowledge.appendIngestChunk({
      handle: 'gone' as never,
      bytes: 'YQ==',
    }, aborted)).rejects.toThrow()
    await expect(ctx.askKnowledge.finishIngest({ handle: 'gone' as never }))
      .rejects.toMatchObject({ code: 'ingest-failed' })
    await expect(ctx.askKnowledge.libraryStatus({ libraryId: created.id }, aborted)).rejects.toThrow()
    await expect(ctx.askKnowledge.placeShortcut({
      libraryId: created.id,
      workspaceId: 'ws' as never,
    }, aborted)).rejects.toThrow()
    await expect(ctx.askKnowledge.revealLibrary({ libraryId: created.id }, aborted)).rejects.toThrow()
    await expect(ctx.askKnowledge.listLibraries(aborted)).rejects.toThrow()
    await expect(ctx.askKnowledge.retrieveBundle({
      libraryId: created.id,
      terms: ['报销'],
    })).resolves.toMatchObject({ items: expect.any(Array) })
    await expect(ctx.askKnowledge.lookup({ libraryId: created.id, term: '报销' }))
      .resolves.toMatchObject({ term: '报销' })
    const placed = await ctx.askKnowledge.placeShortcut({
      libraryId: created.id,
      workspaceId: 'ws' as never,
    })
    expect(placed.ok).toBe(false)
  })

  it('resumes deleting rows at boot and swallows a missing knowledge home', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ask-knowledge-resume-'))
    const sidecarHome = join(root, 'sidecar')
    await installFakeSidecar(sidecarHome)
    const created = await createCatalogLibrary(root, '半删')
    await writeCatalog(root, {
      version: 1,
      libraries: [{
        id: created.id,
        displayName: '半删',
        createdAt: created.createdAt,
        lastUsedAt: created.lastUsedAt,
        vaultRelPath: `libraries/${created.id}`,
        deleting: true,
      }],
    })
    const ctx = new Context()
    ctx.provide('systemPrompt', { section: () => () => {} })
    ctx.provide('sessionProjections', { register: () => () => {}, stateOf: () => null })
    const fiber = ctx.plugin(DesktopAskKnowledge, {
      knowledgeHome: root,
      sidecarRuntimePath: sidecarHome,
    })
    await fiber.await()
    cleanups.push(() => fiber.dispose())
    await resumeDeleting(root)
    expect(await ctx.askKnowledge.listLibraries()).toEqual([])
    const quiet = new Context()
    quiet.provide('systemPrompt', { section: () => () => {} })
    quiet.provide('sessionProjections', { register: () => () => {}, stateOf: () => null })
    const previous = process.env.OCTOPUS_APP_DATA
    delete process.env.OCTOPUS_APP_DATA
    const missing = quiet.plugin(DesktopAskKnowledge, { knowledgeHome: '', sidecarRuntimePath: sidecarHome })
    await missing.await()
    cleanups.push(() => missing.dispose())
    await expect(quiet.askKnowledge.listLibraries()).rejects.toMatchObject({ code: 'knowledge-home-missing' })
    if (previous === undefined) delete process.env.OCTOPUS_APP_DATA
    else process.env.OCTOPUS_APP_DATA = previous
  })

  it('returns status when recover fails and throws path-escape', async () => {
    const started = await bootOverlay({ sessions: true })
    cleanups.push(() => started.fiber.dispose())
    const { ctx, sidecarHome } = started
    const created = await ctx.askKnowledge.createLibrary({ displayName: '状态' })
    await writeFakeSidecarEnv(sidecarHome, { ASK_KNOWLEDGE_FAKE_INBOX: 'not-json' })
    const status = await ctx.askKnowledge.libraryStatus({ libraryId: created.id })
    expect(status.library.id).toBe(created.id)
    const home = started.root
    await writeCatalog(home, {
      version: 1,
      libraries: [{
        id: created.id,
        displayName: '状态',
        createdAt: created.createdAt,
        lastUsedAt: created.lastUsedAt,
        vaultRelPath: 'not-libraries/x',
      }],
    })
    await expect(ctx.askKnowledge.libraryStatus({ libraryId: created.id }))
      .rejects.toMatchObject({ code: 'path-escape' })
  })

  it('registers no tools when the tools service is absent', () => {
    const ctx = new Context()
    expect(registerAskKnowledgeTools(ctx)).toBeTypeOf('function')
    registerAskKnowledgeTools(ctx)()
  })

  it('removes a library whose vaultRelPath escapes libraries/', async () => {
    const started = await bootOverlay({ sessions: true })
    cleanups.push(() => started.fiber.dispose())
    const { ctx } = started
    const created = await ctx.askKnowledge.createLibrary({ displayName: '逃' })
    await writeCatalog(started.root, {
      version: 1,
      libraries: [{
        id: created.id,
        displayName: '逃',
        createdAt: created.createdAt,
        lastUsedAt: created.lastUsedAt,
        vaultRelPath: 'not-libraries/x',
      }],
    })
    await expect(ctx.askKnowledge.removeLibrary({ libraryId: created.id }))
      .rejects.toMatchObject({ code: 'path-escape' })
  })

  it('swallows recover failure when removing a library', async () => {
    const started = await bootOverlay({ sessions: true })
    cleanups.push(() => started.fiber.dispose())
    const { ctx, sidecarHome } = started
    const created = await ctx.askKnowledge.createLibrary({ displayName: '回收' })
    await writeFakeSidecarEnv(sidecarHome, { ASK_KNOWLEDGE_FAKE_INBOX_FAIL: '1' })
    await ctx.askKnowledge.removeLibrary({ libraryId: created.id })
    expect(await ctx.askKnowledge.listLibraries()).toEqual([])
  })

  it('resumes a catalog that only has live rows and assembles an unbound prompt', async () => {
    const started = await bootOverlay({ sessions: true, tools: true })
    cleanups.push(() => started.fiber.dispose())
    const created = await started.ctx.askKnowledge.createLibrary({ displayName: '活' })
    const second = new Context()
    second.provide('systemPrompt', {
      section: (spec: { name: string; text: (context: { agent?: { session: object } }) => string }) => {
        second.provide('ask-knowledge-section', spec)
        return () => {}
      },
      assemble: async () => ({}),
    })
    second.provide('sessionProjections', {
      register: () => () => {},
      stateOf: () => null,
    })
    const fiber = second.plugin(DesktopAskKnowledge, {
      knowledgeHome: started.root,
      sidecarRuntimePath: started.sidecarHome,
    })
    await fiber.await()
    cleanups.push(() => fiber.dispose())
    expect((await second.askKnowledge.listLibraries()).some(row => row.id === created.id)).toBe(true)
    const unbound = await started.ctx.systemPrompt.assemble({})
    expect(JSON.stringify(unbound)).not.toContain('ask_knowledge_retrieve')
    const session = liveSession(started.ctx, 'prompt')
    const empty = await started.ctx.systemPrompt.assemble({ agent: { session } as never })
    expect(JSON.stringify(empty)).not.toContain('ask_knowledge_retrieve')
    await started.ctx.askKnowledge.attach({ libraryId: created.id, sessionId: session.id })
    const bound = await started.ctx.systemPrompt.assemble({ agent: { session } as never })
    expect(JSON.stringify(bound)).toContain('ask_knowledge_retrieve')
    started.ctx.sessionProjections.register({
      key: 'agentPreset',
      init: () => 'data-agent',
      apply: (state: string | null) => state,
    } as never)
    const dataMode = await started.ctx.systemPrompt.assemble({ agent: { session } as never })
    expect(JSON.stringify(dataMode)).not.toContain('ask_knowledge_retrieve')
  })
})
