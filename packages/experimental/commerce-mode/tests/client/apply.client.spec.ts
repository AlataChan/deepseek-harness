/** Commerce browser plugin: dictionaries, tool cards, and the 电商助手 chip with its gate. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { CommerceChangeRow } from '../../src/client/CommerceChangeRow.tsx'
import { CommerceChip } from '../../src/client/CommerceChip.tsx'
import { CommercePage, type CommercePageProps } from '../../src/client/CommercePage.tsx'
import { apply, inject } from '../../src/client/index.ts'
import { en, zh } from '../../src/client/locales.ts'

interface ListedSession {
  id: string
  blank?: boolean
  projectionValues?: { agentPreset?: string; commerceBinding?: unknown }
}

type GateInjected = Omit<CommercePageProps, 't'>

async function bench(initial?: { current?: string; byId?: Record<string, ListedSession> }) {
  const ctx = new Context()
  const slots = new SlotRegistry(ctx)
  slots.register({
    name: 'root',
    children: {
      'tool.call.toolview': { kind: 'keyed', scope: 'session' },
      'conversation.hero.commerce': { kind: 'single', scope: 'root' },
      'conversation.commerce.gate': { kind: 'single', scope: 'root' },
    },
  } as never, () => null)
  const locale = { registrations: [] as { namespace: string; dictionaries: unknown }[], disposed: 0 }
  ctx.provide('locale', {
    register(namespace: string, dictionaries: unknown) {
      locale.registrations.push({ namespace, dictionaries })
      return () => { locale.disposed += 1 }
    },
  })
  const remotes = {
    listCommerceSources: vi.fn(async () => ({ ok: true as const, value: [] })),
    listCommercePlatforms: vi.fn(async () => ({ ok: true as const, value: ['sample'] })),
    importCommerceSpreadsheet: vi.fn(async () => ({ ok: true as const, value: {} })),
    importCommerceSample: vi.fn(async () => ({ ok: true as const, value: {} })),
    commitCommerce: vi.fn(async () => ({ ok: true as const, value: { sessionId: 's-new' } })),
  }
  ctx.provide('remote', { session: remotes } as never)
  ctx.provide('remote.session', remotes)
  const state = { current: initial?.current, byId: initial?.byId ?? {} }
  let listener: (() => void) | undefined
  const open = vi.fn()
  ctx.provide('sessions', {
    list: {
      getSnapshot: () => state,
      subscribe: (fn: () => void) => {
        listener = fn
        return () => { listener = undefined }
      },
    },
    open,
  })
  ctx.provide('conversation', {})
  const seat = { stage: vi.fn(), select: vi.fn(async () => undefined as string | undefined), clearStage: vi.fn() }
  ctx.provide('agentPresetSeat', seat)
  const fiber = ctx.plugin({ inject: [...inject, 'conversation', 'sessions', 'agentPresetSeat'], apply })
  await fiber.await()
  return {
    ctx, slots, locale, seat, open, remotes, state, fiber,
    emit: () => { listener?.() },
  }
}

function gate(slots: SlotRegistry): GateInjected {
  return (slots.entries('conversation.commerce.gate')[0]!.inject as unknown as () => GateInjected)()
}

describe('commerce-mode client apply', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'remote', 'remote.session', 'locale'])
  })

  it('registers the dictionaries, one card per change tool, and the hero chip', async () => {
    const b = await bench()
    const entries = b.slots.entries('tool.call.toolview')
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
    expect(b.locale.registrations).toEqual([{ namespace: 'commerce-mode', dictionaries: { zh, en } }])
    const chip = b.slots.entries('conversation.hero.commerce')[0]
    expect(chip?.component).toBe(CommerceChip)
    expect(b.slots.entries('conversation.commerce.gate')).toHaveLength(0)
  })

  it('opens the gate from the chip with the preset staged, and closes it on commit', async () => {
    const b = await bench()
    const chip = b.slots.entries('conversation.hero.commerce')[0]
    const opener = (chip?.inject as unknown as () => { openGate: () => void })()
    opener.openGate()
    expect(b.seat.stage).toHaveBeenCalledWith('commerce', { hold: true })
    const entry = b.slots.entries('conversation.commerce.gate')[0]
    expect(entry?.component).toBe(CommercePage)

    const injected = gate(b.slots)
    await injected.listSources()
    await injected.listPlatforms()
    await injected.importSample()
    await injected.commit({ sourceId: 'src-1' })
    expect(b.remotes.listCommerceSources).toHaveBeenCalledOnce()
    expect(b.remotes.listCommercePlatforms).toHaveBeenCalledOnce()
    expect(b.remotes.importCommerceSample).toHaveBeenCalledOnce()
    expect(b.remotes.commitCommerce).toHaveBeenCalledWith({ sourceId: 'src-1' }, undefined)

    injected.onCommitted('s-new')
    expect(b.seat.clearStage).toHaveBeenCalled()
    expect(b.open).toHaveBeenCalledWith('s-new')
    expect(b.slots.entries('conversation.commerce.gate')).toHaveLength(0)
  })

  it('restores the previous preset when the gate is cancelled', async () => {
    const b = await bench({ current: 's-1', byId: { 's-1': { id: 's-1', blank: true, projectionValues: { agentPreset: 'standard' } } } })
    b.emit()
    const opener = (b.slots.entries('conversation.hero.commerce')[0]?.inject as unknown as () => { openGate: () => void })()
    opener.openGate()
    await gate(b.slots).cancel()
    expect(b.seat.select).toHaveBeenCalledWith('standard')
    expect(b.slots.entries('conversation.commerce.gate')).toHaveLength(0)
  })

  it('reopens the gate for a blank commerce session with no bound source', async () => {
    const b = await bench({
      current: 's-2',
      byId: { 's-2': { id: 's-2', blank: true, projectionValues: { agentPreset: 'commerce' } } },
    })
    b.emit()
    expect(b.slots.entries('conversation.commerce.gate')).toHaveLength(1)
    expect(gate(b.slots).currentBlankSessionId).toBe('s-2')

    b.state.byId['s-2'] = {
      id: 's-2', blank: true, projectionValues: { agentPreset: 'commerce', commerceBinding: { sourceId: 'src-1' } },
    }
    expect(gate(b.slots).currentBlankSessionId).toBeUndefined()
  })

  it('removes every registration when the plugin is disposed', async () => {
    const b = await bench()
    const opener = (b.slots.entries('conversation.hero.commerce')[0]?.inject as unknown as () => { openGate: () => void })()
    opener.openGate()
    await b.fiber.dispose()
    expect(b.slots.entries('tool.call.toolview')).toHaveLength(0)
    expect(b.slots.entries('conversation.hero.commerce')).toHaveLength(0)
    expect(b.slots.entries('conversation.commerce.gate')).toHaveLength(0)
    expect(b.locale.disposed).toBe(1)
  })
})
