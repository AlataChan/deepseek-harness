/** Ask-data occupant registers the chip after the conversation holes exist. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import type { AskDataChipInjected } from '../src/client/index.ts'
import type { DataSourcePageRemotes } from '../src/client/DataSourcePage.tsx'

interface SessionRow {
  id: string
  blank?: boolean
  projectionValues?: { agentPreset?: string; askDataBinding?: unknown }
}

async function bench(initial?: { current?: string; byId?: Record<string, SessionRow> }) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const remotes = {
    listAskDataSources: vi.fn(async () => ({ ok: true as const, value: [] })),
    importAskDataSpreadsheet: vi.fn(async () => ({ ok: true as const, value: {} })),
    importAskDataSample: vi.fn(async () => ({ ok: true as const, value: {} })),
    commitAskData: vi.fn(async () => ({ ok: true as const, value: { sessionId: 's-new' } })),
    create: vi.fn(async () => ({ ok: true as const, value: { sessionId: 's-adv' } })),
  }
  ctx.provide('remote', { session: remotes } as never)
  ctx.provide('remote.session', remotes)
  const state = {
    current: initial?.current,
    byId: initial?.byId ?? {},
  }
  let listener: (() => void) | undefined
  const list = {
    getSnapshot: () => state,
    subscribe: (fn: () => void) => {
      listener = fn
      return () => { listener = undefined }
    },
  }
  const open = vi.fn()
  ctx.provide('sessions', { list, open })
  ctx.provide('conversation', {})
  const seat = {
    stage: vi.fn(),
    select: vi.fn(async () => undefined as string | undefined),
    clearStage: vi.fn(),
    apply: vi.fn(async () => undefined),
  }
  ctx.provide('agentPresetSeat', seat)
  const slots = ctx.get('slots') as SlotRegistry
  slots.register(
    { name: 'root', children: { conversation: { kind: 'single', scope: 'root' } } } as never,
    () => null,
  )
  slots.register({
    name: 'conversation',
    children: {
      'conversation.hero.askData': { kind: 'single', scope: 'root' },
      'conversation.askData.gate': { kind: 'single', scope: 'root' },
    },
  } as never, () => null)
  const fiber = ctx.plugin({
    inject: [...inject, 'conversation', 'sessions', 'agentPresetSeat'],
    apply,
  })
  await fiber.await()
  return {
    ctx,
    slots,
    remotes,
    seat,
    open,
    state,
    emit: () => { listener?.() },
    dispose: () => fiber.dispose(),
  }
}

type GateInjected = DataSourcePageRemotes & {
  cancel: () => Promise<void>
  onCommitted: (sessionId: string) => void
  openSession: (sessionId: string) => void
  currentBlankSessionId?: string
}

function gate(slots: SlotRegistry): GateInjected {
  return (slots.entries('conversation.askData.gate')[0]!.inject as unknown as () => GateInjected)()
}

describe('desktop-ask-data apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'remote', 'remote.session', 'locale'])
  })

  it('registers the chip and opens the gate only on click', async () => {
    const b = await bench()
    expect(b.slots.entries('conversation.hero.askData')).toHaveLength(1)
    expect(b.slots.entries('conversation.askData.gate')).toHaveLength(0)
    const injected = (b.slots.entries('conversation.hero.askData')[0]!.inject as unknown as () => AskDataChipInjected)()
    injected.openGate()
    expect(b.seat.stage).toHaveBeenCalledWith('data-agent', { hold: true })
    expect(b.slots.entries('conversation.askData.gate')).toHaveLength(1)
    injected.openGate()
    expect(b.slots.entries('conversation.askData.gate')).toHaveLength(1)
    await b.dispose()
  })

  it('wraps Session remotes and cancel / commit / open', async () => {
    const b = await bench({
      current: 's-blank',
      byId: { 's-blank': { id: 's-blank', blank: true } },
    })
    const injected = (b.slots.entries('conversation.hero.askData')[0]!.inject as unknown as () => AskDataChipInjected)()
    injected.openGate()
    const page = gate(b.slots)
    expect(page.currentBlankSessionId).toBe('s-blank')
    await page.listSources()
    expect(b.remotes.listAskDataSources).toHaveBeenCalled()
    await page.importSample()
    expect(b.remotes.importAskDataSample).toHaveBeenCalled()
    await page.importSpreadsheet({ filename: 'a.csv', bytes: 'aGk=' })
    expect(b.remotes.importAskDataSpreadsheet).toHaveBeenCalled()
    await page.commit({ sourceId: 'src-1' })
    expect(b.remotes.commitAskData).toHaveBeenCalled()
    await page.createAdvanced({})
    expect(b.remotes.create).toHaveBeenCalledWith({ agentPreset: 'data-agent' })
    await page.createAdvanced({ workspaceId: 'ws-1' })
    expect(b.remotes.create).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      agentPreset: 'data-agent',
    })
    page.openSession('s-open')
    expect(b.open).toHaveBeenCalled()
    page.onCommitted('s-done')
    expect(b.seat.clearStage).toHaveBeenCalled()
    expect(b.slots.entries('conversation.askData.gate')).toHaveLength(0)
    await b.dispose()
  })

  it('keeps the gate open when cancel is refused', async () => {
    const b = await bench()
    b.seat.select.mockResolvedValueOnce('busy')
    const injected = (b.slots.entries('conversation.hero.askData')[0]!.inject as unknown as () => AskDataChipInjected)()
    injected.openGate()
    await gate(b.slots).cancel()
    expect(b.seat.clearStage).not.toHaveBeenCalled()
    expect(b.slots.entries('conversation.askData.gate')).toHaveLength(1)
    await b.dispose()
  })

  it('closes the gate when cancel is accepted', async () => {
    const b = await bench()
    const injected = (b.slots.entries('conversation.hero.askData')[0]!.inject as unknown as () => AskDataChipInjected)()
    injected.openGate()
    await gate(b.slots).cancel()
    expect(b.seat.clearStage).toHaveBeenCalled()
    expect(b.slots.entries('conversation.askData.gate')).toHaveLength(0)
    await b.dispose()
  })

  it('opens the gate when a blank unbound data-agent session becomes current', async () => {
    const b = await bench()
    b.state.current = 's1'
    b.state.byId = {
      s1: {
        id: 's1',
        blank: true,
        projectionValues: { agentPreset: 'data-agent', askDataBinding: null },
      },
    }
    b.emit()
    expect(b.slots.entries('conversation.askData.gate')).toHaveLength(1)
    b.emit()
    expect(b.slots.entries('conversation.askData.gate')).toHaveLength(1)
    await b.dispose()
    expect(b.slots.entries('conversation.askData.gate')).toHaveLength(0)
  })

  it('remembers the last non-ask preset from the session list', async () => {
    const b = await bench()
    b.state.current = 's1'
    b.state.byId = {
      s1: { id: 's1', projectionValues: { agentPreset: 'minimal' } },
    }
    b.emit()
    const injected = (b.slots.entries('conversation.hero.askData')[0]!.inject as unknown as () => AskDataChipInjected)()
    injected.openGate()
    expect(b.seat.stage).toHaveBeenCalled()
    await gate(b.slots).cancel()
    expect(b.seat.select).toHaveBeenCalledWith('minimal')
    await b.dispose()
  })
})
