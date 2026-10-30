import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject } from '../src/client/index.ts'

it('contributes the visible IM navigation entry and withdraws it with its toast on disposal', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(SlotRegistry)
    const slots = ctx.get('slots') as SlotRegistry
    const locale = new LocaleRuntime(ctx)
    locale.setLocale('zh'); ctx.provide('locale', locale)
    ctx.provide('uiWorkspace', { pickDirectory: vi.fn() })
    ctx.provide('connection', { rpc: { call: vi.fn() } })
    slots.register({ name: 'root', children: {
      'settings.section': { kind: 'list', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    } } as never, () => null)
    const plugin = ctx.plugin({ inject, apply })
    await plugin
    const section = slots.entries('settings.section')[0]!
    expect(section.options.id).toBe('desktop-im')
    expect(resolveSlotLabel(section.options.label)).toBe('IM 接入')
    expect(slots.entries('shell.overlay')).toHaveLength(1)
    await plugin.dispose()
    expect(slots.entries('settings.section')).toHaveLength(0)
    expect(slots.entries('shell.overlay')).toHaveLength(0)
  } finally { await ctx.fiber.dispose() }
})
