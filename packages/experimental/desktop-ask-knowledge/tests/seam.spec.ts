/** Overlay Provider registers as ctx.askKnowledge. */

import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import DesktopAskKnowledge from '../src/index.ts'

describe('DesktopAskKnowledge', () => {
  it('registers as ctx.askKnowledge when projections and systemPrompt exist', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-knowledge-seam-'))
    const ctx = new Context()
    const sections: string[] = []
    let render: ((context: { agent?: { session: object } }) => string) | undefined
    ctx.provide('systemPrompt', {
      section: (spec: { name: string; text: (context: { agent?: { session: object } }) => string }) => {
        sections.push(spec.name)
        render = spec.text
        return () => {}
      },
    })
    ctx.provide('sessionProjections', {
      register: () => Promise.resolve({
        stateOf: () => ({ libraryId: 'lib', displayName: '库' }),
        readerFor: () => () => ({ libraryId: 'lib', displayName: '库' }),
        dispose: () => Promise.resolve(),
      }),
    })
    const fiber = ctx.plugin(DesktopAskKnowledge, { knowledgeHome: home, sidecarRuntimePath: '' })
    await fiber.await()
    expect(ctx.get('askKnowledge')).toBeInstanceOf(DesktopAskKnowledge)
    expect(sections).toContain('ask-knowledge:retrieve')
    if (render === undefined) throw new Error('Ask-knowledge did not register its prompt section')
    expect(render({})).toBe('')
    expect(render({ agent: { session: Session.create(SessionId('seam-session')) } })).toContain('terms')
    await expect(ctx.get('askKnowledge')!.listLibraries()).resolves.toEqual([])
    const created = await ctx.get('askKnowledge')!.createLibrary({ displayName: '制度' })
    expect(created.displayName).toBe('制度')
    const ac = new AbortController()
    ac.abort()
    await expect(ctx.get('askKnowledge')!.listLibraries(ac.signal)).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.get('askKnowledge')).toBeUndefined()
  })

  it('loads without OCTOPUS_APP_DATA and fails only ask-knowledge methods', async () => {
    const ctx = new Context()
    ctx.provide('systemPrompt', { section: () => () => {} })
    ctx.provide('sessionProjections', { register: () => Promise.resolve({ stateOf: () => null, readerFor: () => () => null, dispose: () => Promise.resolve() }) })
    const fiber = ctx.plugin(DesktopAskKnowledge, { knowledgeHome: '', sidecarRuntimePath: '' })
    await fiber.await()
    await expect(ctx.get('askKnowledge')!.listLibraries()).rejects.toMatchObject({
      code: 'knowledge-home-missing',
    })
    await fiber.dispose()
  })
})
