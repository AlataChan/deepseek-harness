/** Overlay Provider registers as ctx.askKnowledge. */

import { describe, expect, it } from 'vitest'
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
    ctx.provide('systemPrompt', {
      section: (spec: { name: string; text: (context: { agent?: { session: object } }) => string }) => {
        sections.push(spec.name)
        expect(spec.text({})).toBe('')
        expect(spec.text({ agent: { session: {} } })).toContain('terms')
        return () => {}
      },
    })
    ctx.provide('sessionProjections', {
      register: () => () => {},
      stateOf: () => ({ libraryId: 'lib', displayName: '库' }),
    })
    const fiber = ctx.plugin(DesktopAskKnowledge, { knowledgeHome: home, sidecarRuntimePath: '' })
    await fiber.await()
    expect(ctx.get('askKnowledge')).toBeInstanceOf(DesktopAskKnowledge)
    expect(sections).toContain('ask-knowledge:retrieve')
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
    ctx.provide('sessionProjections', { register: () => () => {}, stateOf: () => null })
    const fiber = ctx.plugin(DesktopAskKnowledge, { knowledgeHome: '', sidecarRuntimePath: '' })
    await fiber.await()
    await expect(ctx.get('askKnowledge')!.listLibraries()).rejects.toMatchObject({
      code: 'knowledge-home-missing',
    })
    await fiber.dispose()
  })
})
