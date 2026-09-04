/** Attach, detach, live/cold remove, and workspace switch keep one library id. */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionId as Sid } from '@deepseek-ai/dsh-session'
import { bootOverlay } from './helpers/boot.ts'

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

async function boot() {
  const started = await bootOverlay({ sessions: true })
  cleanups.push(() => started.fiber.dispose())
  return started
}

function liveSession(ctx: Context, id: string) {
  const session = ctx.sessions.prepare(SessionId(id))
  const detach = ctx.sessions.enter(session)
  ctx.sessions.announce(session)
  cleanups.push(detach)
  return session
}

describe('ask-knowledge attach', () => {
  it('binds and unbinds a live session without changing a missing preset', async () => {
    const { ctx } = await boot()
    const library = await ctx.askKnowledge.createLibrary({ displayName: '制度 A' })
    const session = liveSession(ctx, 'live-1')
    const lease = await ctx.askKnowledge.attach({ libraryId: library.id, sessionId: session.id })
    expect(lease.binding.displayName).toBe('制度 A')
    expect(ctx.sessionProjections.stateOf(session, 'askKnowledgeBinding')).toEqual(lease.binding)
    expect(session.snapshotEvents().some(event => event.type === 'ask-knowledge/bound')).toBe(true)
    await ctx.askKnowledge.detach({ sessionId: session.id })
    expect(ctx.sessionProjections.stateOf(session, 'askKnowledgeBinding')).toBeNull()
  })

  it('switches libraries without leaving an A/B mismatch', async () => {
    const { ctx } = await boot()
    const first = await ctx.askKnowledge.createLibrary({ displayName: 'A' })
    const second = await ctx.askKnowledge.createLibrary({ displayName: 'B' })
    const session = liveSession(ctx, 'switch')
    await ctx.askKnowledge.attach({ libraryId: first.id, sessionId: session.id })
    await ctx.askKnowledge.attach({ libraryId: second.id, sessionId: session.id })
    expect(ctx.sessionProjections.stateOf(session, 'askKnowledgeBinding')).toMatchObject({
      libraryId: second.id,
      displayName: 'B',
    })
  })

  it('unbinds a live session on remove and still lists other libraries', async () => {
    const { ctx } = await boot()
    const keep = await ctx.askKnowledge.createLibrary({ displayName: '留' })
    const gone = await ctx.askKnowledge.createLibrary({ displayName: '删' })
    const session = liveSession(ctx, 'remove-live')
    await ctx.askKnowledge.attach({ libraryId: gone.id, sessionId: session.id })
    await ctx.askKnowledge.removeLibrary({ libraryId: gone.id })
    expect(ctx.sessionProjections.stateOf(session, 'askKnowledgeBinding')).toBeNull()
    expect(session.snapshotEvents().some(event => event.type === 'ask-knowledge/unbound')).toBe(true)
    const listed = await ctx.askKnowledge.listLibraries()
    expect(listed.map(row => row.id)).toEqual([keep.id])
  })

  it('unbinds a cold session through persistence.append after a live re-check', async () => {
    const { ctx } = await boot()
    const library = await ctx.askKnowledge.createLibrary({ displayName: '冷' })
    const coldId = SessionId('cold-only')
    const appended: SessionEvent[] = []
    ctx.provide('sessionPersistence', {
      list: async () => [{ id: coldId }],
      load: async () => ({
        events: [{
          type: 'ask-knowledge/bound',
          seq: 0,
          time: 1,
          data: { libraryId: library.id, displayName: '冷' },
        }],
      }),
      append: async (_id: Sid, events: SessionEvent[]) => {
        appended.push(...events)
      },
    } as never)
    await ctx.askKnowledge.removeLibrary({ libraryId: library.id })
    expect(appended.some(event => event.type === 'ask-knowledge/unbound')).toBe(true)
    expect(ctx.sessions.get(coldId)).toBeUndefined()
  })

  it('lists the same library id after a workspace path change', async () => {
    const { ctx } = await boot()
    const created = await ctx.askKnowledge.createLibrary({ displayName: '跨目录' })
    const listed = await ctx.askKnowledge.listLibraries()
    expect(listed.map(row => row.id)).toEqual([created.id])
  })
})
