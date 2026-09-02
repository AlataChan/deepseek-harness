/** Ask-knowledge occupant registers the chip, picker, and settings section. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import type { AskKnowledgeChipInjected, AttachKnowledgeBridgeInjected } from '../src/client/index.ts'
import type { LibraryPickerInjected } from '../src/client/LibraryPicker.tsx'
import type { LibrarySettingsRemotes } from '../src/client/LibrarySettingsSection.tsx'

interface SessionRow {
  id: string
  projectionValues?: { askKnowledgeBinding?: unknown } | undefined
}

async function bench(initial?: { current?: string; byId?: Record<string, SessionRow> }) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const remotes = {
    listAskKnowledgeLibraries: vi.fn(async () => ({ ok: true as const, value: [] })),
    createAskKnowledgeLibrary: vi.fn(async () => ({ ok: true as const, value: { id: '2', displayName: '新' } })),
    attachAskKnowledge: vi.fn(async () => ({
      ok: true as const,
      value: { sessionId: 's1' },
    })),
    renameAskKnowledgeLibrary: vi.fn(async () => ({ ok: true as const })),
    removeAskKnowledgeLibrary: vi.fn(async () => ({ ok: true as const })),
    beginAskKnowledgeIngest: vi.fn(async () => ({ ok: true as const, value: 'h1' })),
    appendAskKnowledgeIngestChunk: vi.fn(async () => ({ ok: true as const })),
    finishAskKnowledgeIngest: vi.fn(async () => ({ ok: true as const, value: { status: 'applied' as const } })),
    beginAskKnowledgeExtract: vi.fn(async () => ({ ok: true as const, value: 'hx' })),
    appendAskKnowledgeExtractChunk: vi.fn(async () => ({ ok: true as const })),
    finishAskKnowledgeExtract: vi.fn(async () => ({
      ok: true as const,
      value: { filename: '制度.pdf', text: '正文', truncated: false },
    })),
  }
  ctx.provide('remote', { session: remotes } as never)
  ctx.provide('remote.session', remotes)
  const state = {
    current: initial?.current,
    byId: initial?.byId ?? {},
  }
  const list = {
    getSnapshot: () => state,
    subscribe: () => () => {},
  }
  const sessions = { list, open: vi.fn() }
  ctx.provide('sessions', sessions)
  ctx.provide('conversation', {})
  const slots = ctx.get('slots') as SlotRegistry
  slots.register(
    {
      name: 'root',
      children: {
        conversation: { kind: 'single', scope: 'root' },
        'settings.section': { kind: 'list', scope: 'root' },
      },
    } as never,
    () => null,
  )
  slots.register({
    name: 'conversation',
    children: {
      'conversation.hero.askKnowledge': { kind: 'single', scope: 'root' },
      'conversation.askKnowledge.picker': { kind: 'single', scope: 'root' },
      'conversation.composer.bar': { kind: 'single', scope: 'session-maybe' },
    },
  } as never, () => null)
  slots.register({
    name: 'conversation.composer.bar',
    children: {
      'conversation.input.attachKnowledge': { kind: 'single', scope: 'session-maybe' },
      'conversation.input.attachSessionDocument': { kind: 'single', scope: 'session-maybe' },
    },
  } as never, () => null)
  const fiber = ctx.plugin({
    inject: [...inject, 'conversation', 'sessions'],
    apply,
  })
  await fiber.await()
  return { ctx, slots, remotes, sessions, state, dispose: () => fiber.dispose() }
}

describe('desktop-ask-knowledge apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'remote', 'remote.session', 'locale'])
  })

  it('registers the chip and settings section, then opens the picker once', async () => {
    const b = await bench({
      current: 's1',
      byId: {
        s1: {
          id: 's1',
          projectionValues: { askKnowledgeBinding: { displayName: '制度 A', libraryId: '1' } },
        },
      },
    })
    expect(b.slots.entries('conversation.hero.askKnowledge')).toHaveLength(1)
    expect(b.slots.entries('conversation.input.attachKnowledge')).toHaveLength(1)
    expect(b.slots.entries('conversation.input.attachSessionDocument')).toHaveLength(1)
    expect(b.slots.entries('settings.section').map(row => row.options.id)).toEqual(['desktop-ask-knowledge'])
    const chip = (b.slots.entries('conversation.hero.askKnowledge')[0]!.inject as unknown as () => AskKnowledgeChipInjected)()
    expect(chip.boundName).toBe('制度 A')
    chip.openPicker()
    expect(b.slots.entries('conversation.askKnowledge.picker')).toHaveLength(1)
    chip.openPicker()
    expect(b.slots.entries('conversation.askKnowledge.picker')).toHaveLength(1)
    const listed = (b.slots.entries('conversation.askKnowledge.picker')[0]!.inject as unknown as () => LibraryPickerInjected)()
    expect(listed.initialPhase).toBe('list')
    const attach = (b.slots.entries('conversation.input.attachKnowledge')[0]!.inject as unknown as () => AttachKnowledgeBridgeInjected)()
    attach.openPicker()
    const picker = (b.slots.entries('conversation.askKnowledge.picker')[0]!.inject as unknown as () => LibraryPickerInjected)()
    expect(picker.initialPhase).toBe('upload')
    await picker.listLibraries()
    await picker.createLibrary('新')
    await picker.renameLibrary('1', '制度')
    await picker.beginIngest('1', '制度.md')
    await picker.appendIngestChunk('h1', 'YQ==')
    await picker.finishIngest('h1')
    await picker.removeLibrary('1')
    await picker.attach('1')
    expect(b.remotes.renameAskKnowledgeLibrary).toHaveBeenCalledWith({
      libraryId: '1',
      displayName: '制度',
    })
    expect(b.remotes.beginAskKnowledgeIngest).toHaveBeenCalledWith({
      libraryId: '1',
      filename: '制度.md',
    })
    expect(b.remotes.appendAskKnowledgeIngestChunk).toHaveBeenCalledWith({
      handle: 'h1',
      bytes: 'YQ==',
    })
    expect(b.remotes.finishAskKnowledgeIngest).toHaveBeenCalledWith({ handle: 'h1' })
    expect(b.remotes.removeAskKnowledgeLibrary).toHaveBeenCalledWith({ libraryId: '1' })
    expect(b.remotes.attachAskKnowledge).toHaveBeenCalledWith({
      libraryId: '1',
      sessionId: 's1',
    })
    picker.close()
    expect(b.slots.entries('conversation.askKnowledge.picker')).toHaveLength(0)
    const settings = (b.slots.entries('settings.section')[0]!.inject as unknown as () => LibrarySettingsRemotes & { attach: (id: string) => Promise<unknown> })()
    await settings.listLibraries()
    await settings.removeLibrary('1')
    await settings.attach('1')
    expect(b.remotes.removeAskKnowledgeLibrary).toHaveBeenCalledWith({ libraryId: '1' })
    expect(b.remotes.attachAskKnowledge).toHaveBeenCalled()
    await b.dispose()
  })

  it('omits boundName and sessionId when no current session exists', async () => {
    const b = await bench()
    const chip = (b.slots.entries('conversation.hero.askKnowledge')[0]!.inject as unknown as () => AskKnowledgeChipInjected)()
    expect(chip.boundName).toBeUndefined()
    chip.openPicker()
    const picker = (b.slots.entries('conversation.askKnowledge.picker')[0]!.inject as unknown as () => LibraryPickerInjected)()
    await picker.attach('1')
    expect(b.remotes.attachAskKnowledge).toHaveBeenCalledWith({ libraryId: '1' })
    await b.dispose()
  })

  it('opens the Session Host returned when attach leaves a data-agent chat', async () => {
    const b = await bench({
      current: 's-data',
      byId: { 's-data': { id: 's-data' } },
    })
    b.remotes.attachAskKnowledge.mockResolvedValue({
      ok: true as const,
      value: { sessionId: 's-knowledge' },
    })
    const chip = (b.slots.entries('conversation.hero.askKnowledge')[0]!.inject as unknown as () => AskKnowledgeChipInjected)()
    chip.openPicker()
    const picker = (b.slots.entries('conversation.askKnowledge.picker')[0]!.inject as unknown as () => LibraryPickerInjected)()
    await picker.attach('1')
    expect(b.remotes.attachAskKnowledge).toHaveBeenCalledWith({
      libraryId: '1',
      sessionId: 's-data',
    })
    expect(b.sessions.open).toHaveBeenCalledWith('s-knowledge')
    await b.dispose()
  })

  it('treats a non-object or nameless bind as unbound', async () => {
    const cases: Array<SessionRow['projectionValues']> = [
      { askKnowledgeBinding: 'x' },
      { askKnowledgeBinding: null },
      { askKnowledgeBinding: { libraryId: '1' } },
      { askKnowledgeBinding: { displayName: 1 } },
    ]
    for (const projectionValues of cases) {
      const b = await bench({
        current: 's1',
        byId: { s1: { id: 's1', projectionValues } },
      })
      const chip = (b.slots.entries('conversation.hero.askKnowledge')[0]!.inject as unknown as () => AskKnowledgeChipInjected)()
      expect(chip.boundName).toBeUndefined()
      await b.dispose()
    }
  })
})
