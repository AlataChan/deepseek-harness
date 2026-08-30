/** Desktop runtime model-visible surface context. */

import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, it } from 'vitest'
import { apply, Config } from '../src/index.ts'

describe('desktop runtime glue', () => {
  it('orients the model to the selected desktop workspace and Host opener', async () => {
    const ctx = new Context()
    apply(ctx, new Config({ workspaceRoot: '/workspace/project', surfaceContext: true }))
    await ctx.plugin(SystemPrompt, { persona: '' })
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
    await ctx.plugin(SystemPrompt, { persona: '' })
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.some(entry => entry.name === 'app:desktop-surface')).toBe(false)
    expect(assembly.sections.some(entry => entry.name === 'harness:source')).toBe(false)
    await ctx.fiber.dispose()
  })
})
