/** Shipped TUI bundle composition regression. */

import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { describe, expect, it } from 'vitest'
import * as bundleInvariant from '../src/invariant.ts'

const BASE_PATCH = fileURLToPath(new URL('../../base/cordis.patch.yml', import.meta.url))
const TUI_PATCH = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))

function property(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
}

describe('TUI bundle composition', () => {
  it('keeps base services and adds only the direct terminal runtime', () => {
    const entries = composeEntries([
      loadOverlayPatches('tui-test', BASE_PATCH),
      loadOverlayPatches('tui-test', TUI_PATCH),
    ])
    const rows = new Map(entries.map(entry => [entry.id, entry]))

    expect(rows.get('session')).toMatchObject({ name: '@deepseek-ai/dsh-session' })
    expect(rows.get('agent-loop')).toMatchObject({ name: '@deepseek-ai/dsh-agent-loop' })
    expect(rows.get('hmr')?.disabled).toBe(true)
    expect(String(property(rows.get('system-prompt')?.config, 'persona'))).toContain('terminal')
    expect(rows.get('tools')?.config).toHaveProperty('mode')
    expect(rows.get('code-runtime')).toMatchObject({ name: '@deepseek-ai/dsh-code-runtime-worker-thread' })
    expect(rows.get('tui-startup')).toMatchObject({ name: '@deepseek-ai/dsh-tui-app/startup' })
    expect(rows.get('tui')).toMatchObject({ name: '@deepseek-ai/dsh-tui', inject: ['tuiStartup'] })
    expect(rows.get('tui')?.config).toMatchObject({ terminalColumnsFallback: 80, resumeTranscriptRows: 200 })
    expect(rows.get('invariants')).toMatchObject({ name: '@deepseek-ai/dsh-invariants' })
    expect(rows.get('tui-invariant')).toMatchObject({ name: '@deepseek-ai/dsh-tui/invariant' })
    expect(rows.get('tui-app-invariant')).toMatchObject({ name: '@deepseek-ai/dsh-tui-app/invariant' })

    for (const absent of [
      'api-gateway', 'webserver', 'client-runtime', 'client-modules-web',
      'web-runtime', 'vscode-runtime', 'connection', 'connection-vscode',
    ]) expect(rows.has(absent)).toBe(false)
  })
})

describe('TUI bundle invariant', () => {
  it('accepts a controller backed by the published startup provider', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(InvariantRegistry)
    ctx.provide('tuiStartup', { kind: 'fresh' })
    const invariant = ctx.plugin(bundleInvariant)
    await invariant.await()
    expect(() => {
      ctx.emit('tui/controller-mounted', {
        controller: {} as never, agent: undefined, providersPublished: true,
      })
    }).not.toThrow()
    await ctx.fiber.dispose()
  })

  it('rejects a controller without startup or published providers', async () => {
    const missing = new Context()
    await missing.plugin(AgentRegistry)
    await missing.plugin(InvariantRegistry)
    missing.provide('tuiStartup', undefined)
    const missingInvariant = missing.plugin(bundleInvariant)
    await missingInvariant.await()
    expect(() => { missing.emit('tui/controller-mounted', {
      controller: {} as never, agent: undefined, providersPublished: true,
    }) }).toThrow(/startup provider/)
    await missing.fiber.dispose()

    const unpublished = new Context()
    await unpublished.plugin(AgentRegistry)
    await unpublished.plugin(InvariantRegistry)
    unpublished.provide('tuiStartup', { kind: 'fresh' })
    const unpublishedInvariant = unpublished.plugin(bundleInvariant)
    await unpublishedInvariant.await()
    expect(() => { unpublished.emit('tui/controller-mounted', {
      controller: {} as never, agent: undefined, providersPublished: false,
    }) }).toThrow(/interaction providers/)
    await unpublished.fiber.dispose()
  })
})
