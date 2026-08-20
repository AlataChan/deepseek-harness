/** VS Code bundle composition and model-visible surface context. */

import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, it } from 'vitest'
import { apply, Config } from '../src/index.ts'

const CLIENT_APP_PATCH = fileURLToPath(new URL('../../client-app/cordis.patch.yml', import.meta.url))
const VSCODE_APP_PATCH = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))

describe('VS Code bundle composition', () => {
  it('keeps the shared UI roster and mounts only VS Code-owned adapters', () => {
    const clientEntries = composeEntries([loadOverlayPatches('test', CLIENT_APP_PATCH)])
    const entries = composeEntries([
      loadOverlayPatches('test', CLIENT_APP_PATCH),
      loadOverlayPatches('test', VSCODE_APP_PATCH),
    ])
    const rows = new Map(entries.map(entry => [entry.id, entry]))

    for (const entry of clientEntries.filter(entry => typeof entry.id === 'string' && entry.id.startsWith('ui-'))) {
      expect(rows.get(entry.id)).toMatchObject({ name: entry.name })
    }
    expect(rows.get('api-gateway')?.config).toMatchObject({ nativeOpen: false })
    expect(rows.get('directory-picker-browse')).toMatchObject({ name: '@deepseek-ai/dsh-host-directory-picker-browse' })
    expect(rows.get('ui-directory-picker-browse')).toMatchObject({ name: '@deepseek-ai/dsh-client-ui-directory-picker-browse' })
    expect(rows.get('vscode-startup')).toMatchObject({ name: '@deepseek-ai/dsh-vscode-app/startup' })
    expect(rows.get('vscode-runtime')).toMatchObject({ name: '@deepseek-ai/dsh-vscode-app' })
    expect(rows.get('connection-vscode')).toMatchObject({ name: '@deepseek-ai/dsh-client-connection-vscode' })
    expect(rows.get('ui-vscode')).toMatchObject({ name: '@deepseek-ai/dsh-client-ui-vscode' })

    for (const absent of [
      'session-log-download',
      'directory-picker',
      'web-startup',
      'webserver',
      'client-modules-web',
      'web-runtime',
      'client-hmr',
      'connection',
      'directory-picker-native',
      'ui-directory-picker-native',
    ]) expect(rows.has(absent)).toBe(false)
  })
})

describe('VS Code runtime glue', () => {
  it('orients the model to the selected editor workspace without claiming implicit editor state', async () => {
    const ctx = new Context()
    apply(ctx, new Config({ workspaceRoot: '/workspace/project', surfaceContext: true }))
    await ctx.plugin(SystemPrompt, { persona: '' })
    const assembly = await ctx.systemPrompt.assemble()
    const section = assembly.sections.find(entry => entry.name === 'app:vscode-surface')
    expect(section?.text).toContain('Visual Studio Code')
    expect(section?.text).toContain('/workspace/project')
    expect(section?.text).toContain('no implicit editor')
    expect(assembly.sections.find(entry => entry.name === 'harness:source')?.text)
      .toContain('DeepSeek Harness implementation checkout')
    await ctx.fiber.dispose()
  })

  it('registers no model-visible sections when surface context is disabled', async () => {
    const ctx = new Context()
    apply(ctx, new Config({ workspaceRoot: '/workspace/project', surfaceContext: false }))
    await ctx.plugin(SystemPrompt, { persona: '' })
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.some(entry => entry.name === 'app:vscode-surface')).toBe(false)
    expect(assembly.sections.some(entry => entry.name === 'harness:source')).toBe(false)
    await ctx.fiber.dispose()
  })
})
