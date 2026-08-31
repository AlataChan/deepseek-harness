/** Overlay Provider registers as ctx.askData. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import DesktopAskData from '../src/index.ts'

describe('DesktopAskData', () => {
  it('registers as ctx.askData when projections and systemPrompt exist', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-data-seam-'))
    const ctx = new Context()
    const sections: string[] = []
    ctx.provide('systemPrompt', {
      section: (spec: { name: string; text: (context: { agent?: { session: object } }) => string }) => {
        sections.push(spec.name)
        expect(spec.text({})).toBe('')
        expect(spec.text({ agent: { session: {} } })).toContain('accept-xlsx-csv')
        return () => {}
      },
    })
    ctx.provide('sessionProjections', {
      register: () => () => {},
      stateOf: () => ({ sourceId: 's', connectionRef: 'c', displayName: 'n', readonly: true }),
    })
    const fiber = ctx.plugin(DesktopAskData, { dataHome: home })
    await fiber.await()
    expect(ctx.get('askData')).toBeInstanceOf(DesktopAskData)
    expect(sections).toContain('ask-data:limits')
    await expect(ctx.get('askData')!.listSources()).resolves.toEqual([])
    const ac = new AbortController()
    ac.abort()
    expect(() => { void ctx.get('askData')!.listSources(ac.signal) }).toThrow()
    await fiber.dispose()
    expect(ctx.get('askData')).toBeUndefined()
  })

  it('uses the default data-home and omits limits when the session is unbound', async () => {
    const ctx = new Context()
    const texts: string[] = []
    ctx.provide('systemPrompt', {
      section: (spec: { text: (context: { agent?: { session: object } }) => string }) => {
        texts.push(spec.text({ agent: { session: {} } }))
        return () => {}
      },
    })
    ctx.provide('sessionProjections', {
      register: () => () => {},
      stateOf: () => null,
    })
    const fiber = ctx.plugin(DesktopAskData, { dataHome: '' })
    await fiber.await()
    expect(texts).toEqual([''])
    await fiber.dispose()
  })

  it('forwards replaceSourceId through importSpreadsheet', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-data-seam-replace-'))
    const ctx = new Context()
    ctx.provide('systemPrompt', { section: () => () => {} })
    ctx.provide('sessionProjections', { register: () => () => {}, stateOf: () => null })
    const fiber = ctx.plugin(DesktopAskData, { dataHome: home })
    await fiber.await()
    const ask = ctx.get('askData')!
    const sample = await ask.importSample()
    const { readFile } = await import('node:fs/promises')
    const bytes = await readFile(new URL('../samples/sample-sales.csv', import.meta.url))
    const replaced = await ask.importSpreadsheet({
      filename: 'sales.csv',
      bytes,
      replaceSourceId: sample.source.id,
    })
    expect(replaced.source.id).toBe(sample.source.id)
    await fiber.dispose()
  })
})
