/** Commerce browser plugin: dictionaries and one keyed card per staging, discard, and export tool. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { CommerceChangeRow } from '../../src/client/CommerceChangeRow.tsx'
import { apply, inject } from '../../src/client/index.ts'
import { en, zh } from '../../src/client/locales.ts'

async function bench() {
  const ctx = new Context()
  const slots = new SlotRegistry(ctx)
  slots.register({
    name: 'root',
    children: { 'tool.call.toolview': { kind: 'keyed', scope: 'session' } },
  } as never, () => null)
  const locale = { registrations: [] as { namespace: string; dictionaries: unknown }[], disposed: 0 }
  ctx.provide('locale', {
    register(namespace: string, dictionaries: unknown) {
      locale.registrations.push({ namespace, dictionaries })
      return () => { locale.disposed += 1 }
    },
  })
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { slots, locale, fiber }
}

describe('commerce-mode client apply', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('registers the dictionaries and a card for each staging, discard, and export tool', async () => {
    const { slots, locale } = await bench()
    const entries = slots.entries('tool.call.toolview')
    expect(entries.map(entry => entry.options.key)).toEqual([
      'commerce_stage_listing_update',
      'commerce_stage_price_change',
      'commerce_stage_promotion',
      'commerce_stage_restock',
      'commerce_stage_campaign',
      'commerce_discard_change',
      'commerce_export_changes',
    ])
    expect(entries.every(entry => entry.locale === 'commerce-mode' && entry.component === CommerceChangeRow)).toBe(true)
    expect(locale.registrations).toEqual([{ namespace: 'commerce-mode', dictionaries: { zh, en } }])
  })

  it('removes the cards and dictionaries when the plugin is disposed', async () => {
    const { slots, locale, fiber } = await bench()
    await fiber.dispose()
    expect(slots.entries('tool.call.toolview')).toHaveLength(0)
    expect(locale.disposed).toBe(1)
  })
})
