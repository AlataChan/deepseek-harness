/** Desktop runtime model-visible surface context. */

import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadOptionalPatches } from '@deepseek-ai/dsh-app-boot'
import { apply as applyWeb, Config as WebConfig, internals } from '@deepseek-ai/dsh-web-app'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, it, onTestFinished } from 'vitest'
import { apply, Config } from '../src/index.ts'

describe('desktop runtime glue', () => {
  it('composes the shipped Web and Desktop runtimes with one source section', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'desktop-surface-'))
    const index = join(dir, 'index.html')
    writeFileSync(index, '<html></html>')
    const resolveDist = internals.resolveDistIndex
    internals.resolveDistIndex = () => index
    const ctx = new Context()
    onTestFinished(async () => {
      try {
        await ctx.fiber.dispose()
      } finally {
        internals.resolveDistIndex = resolveDist
        rmSync(dir, { recursive: true, force: true })
      }
    })
    ctx.provide('webServer', { host: '127.0.0.1', port: 4567 } as never)
    const patches = loadOptionalPatches('dsh', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)))
    const web = patches?.find(patch => patch.id === 'web-runtime')
    expect(web).toBeDefined()
    applyWeb(ctx, new WebConfig({ ...web?.config, trustedHosts: [] }))
    apply(ctx, new Config({ workspaceRoot: '/workspace/project', surfaceContext: true }))
    await ctx.plugin(SystemPrompt, { personaPrefix: '' })
    await ctx.fiber.await()
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.filter(section => section.name === 'harness:source')).toHaveLength(1)
    expect(assembly.sections.some(section => section.name === 'app:desktop-surface')).toBe(true)
    expect(assembly.sections.some(section => section.name === 'app:web-surface')).toBe(false)
  })

  it('orients the model to the selected desktop workspace and Host opener', async () => {
    const ctx = new Context()
    apply(ctx, new Config({ workspaceRoot: '/workspace/project', surfaceContext: true }))
    await ctx.plugin(SystemPrompt, { personaPrefix: '' })
    const assembly = await ctx.systemPrompt.assemble()
    const section = assembly.sections.find(entry => entry.name === 'app:desktop-surface')
    expect(section?.text).toContain('desktop application')
    expect(section?.text).toContain('/workspace/project')
    expect(section?.text).toContain('Host platform opener')
    expect(assembly.sections.find(entry => entry.name === 'harness:source')?.text)
      .toContain('DeepSeek Harness implementation checkout')
    await ctx.fiber.dispose()
  })

  it('registers no model-visible sections when surface context is disabled', async () => {
    const ctx = new Context()
    apply(ctx, new Config({ workspaceRoot: '/workspace/project', surfaceContext: false }))
    await ctx.plugin(SystemPrompt, { personaPrefix: '' })
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.some(entry => entry.name === 'app:desktop-surface')).toBe(false)
    expect(assembly.sections.some(entry => entry.name === 'harness:source')).toBe(false)
    await ctx.fiber.dispose()
  })
})
