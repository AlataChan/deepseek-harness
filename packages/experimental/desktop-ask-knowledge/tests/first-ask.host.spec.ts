/** Keyless first-ask: create, ingest fixture, attach, retrieve body, list after cwd change. */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bootOverlay } from './helpers/boot.ts'

const cleanups: Array<() => Promise<void> | void> = []
const originalCwd = process.cwd()

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
  process.chdir(originalCwd)
})

describe('ask-knowledge first-ask', () => {
  it('ingests a fixture, hangs the library, and retrieves 报销 with a body', async () => {
    const started = await bootOverlay({
      sessions: true,
      credentials: {
        resolve: async () => ({ value: 'sk-first-ask-fixture-not-a-model-call' }),
      },
    })
    cleanups.push(() => started.fiber.dispose())
    const { ctx } = started
    const library = await ctx.askKnowledge.createLibrary({ displayName: '报销制度' })
    const handle = await ctx.askKnowledge.beginIngest({ libraryId: library.id, filename: '报销.md' })
    await ctx.askKnowledge.appendIngestChunk({
      handle,
      bytes: Buffer.from('# 报销\n\n报销流程。\n', 'utf8').toString('base64'),
    })
    const ingested = await ctx.askKnowledge.finishIngest({ handle })
    expect(ingested.status).toBe('applied')
    const session = ctx.sessions.prepare(SessionId('first-ask'))
    ctx.sessions.enter(session)
    ctx.sessions.announce(session)
    await ctx.askKnowledge.attach({ libraryId: library.id, sessionId: session.id })
    const bundle = await ctx.askKnowledge.retrieveBundle({ libraryId: library.id, terms: ['报销'] })
    expect(bundle.items.some(item => item.text.includes('报销'))).toBe(true)
    const other = await mkdtemp(join(tmpdir(), 'ask-knowledge-ws2-'))
    process.chdir(other)
    const listed = await ctx.askKnowledge.listLibraries()
    expect(listed.map(row => row.id)).toEqual([library.id])
  })
})
