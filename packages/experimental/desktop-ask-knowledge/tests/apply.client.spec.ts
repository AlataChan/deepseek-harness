/** Ask-knowledge occupant registers the chip, picker, and settings section. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import type {
  AskKnowledgeDockInjected, AttachKnowledgeBridgeInjected, KnowledgeCapabilitiesRowInjected,
} from '../src/client/index.ts'
import type { LibraryPickerInjected } from '../src/client/LibraryPicker.tsx'
import type { LibrarySettingsRemotes } from '../src/client/LibrarySettingsSection.tsx'

interface SessionRow {
  id: string
  retainedBy?: Record<string, number | undefined> | undefined
  projectionValues?: { askKnowledgeBinding?: unknown } | undefined
}

/**
 * Read one registered entry's injected face. The registry erases the factory's
 * declared type, so the test reasserts the face its own registration created.
 * @param entry - registered slot entry.
 * @returns the entry's injected business face.
 */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- Fixtures own the erased factory result.
function injectedOf<T>(
  entry: { readonly inject?: ((...args: never[]) => Record<string, unknown>) | undefined } | undefined,
): T {
  if (entry?.inject === undefined) throw new Error('registered entry has no inject face')
  return entry.inject() as Partial<T> as T
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
    askKnowledgeListDocuments: vi.fn(async () => ({
      ok: true as const,
      value: { documentPaths: ['raw/制度.md'] },
    })),
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
    getSnapshot: () => ({
      byId: Object.fromEntries(Object.entries(state.byId).map(([id, row]) => [
        id,
        id === state.current ? { ...row, retainedBy: { ...row.retainedBy, mainView: 1 } } : row,
      ])),
    }),
    subscribe: () => () => {},
  }
  const openSession = vi.fn()
  const sessions = { list, open: openSession }
  ctx.provide('sessions', sessions)
  ctx.provide('uiWorkspace', { openSession })
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
      'conversation.hero.capabilities.item': { kind: 'list', scope: 'session-maybe' },
      'conversation.askKnowledge.picker': { kind: 'single', scope: 'root' },
      'conversation.input.dock': { kind: 'list', scope: 'session' },
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
    inject: [...inject, 'conversation', 'sessions', 'uiWorkspace'],
    apply,
  })
  await fiber.await()
  return { ctx, slots, remotes, sessions, openSession, state, dispose: () => fiber.dispose() }
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
    expect(b.slots.entries('conversation.hero.capabilities.item').map(row => row.options.id))
      .toEqual(['desktop-ask-knowledge'])
    expect(b.slots.entries('conversation.input.attachKnowledge')).toHaveLength(1)
    expect(b.slots.entries('conversation.input.attachSessionDocument')).toHaveLength(1)
    expect(b.slots.entries('conversation.input.dock')).toHaveLength(1)
    expect(b.slots.entries('settings.section').map(row => row.options.id)).toEqual(['desktop-ask-knowledge'])
    const row = injectedOf<KnowledgeCapabilitiesRowInjected>(b.slots.entries('conversation.hero.capabilities.item')[0])
    row.openPicker()
    expect(b.slots.entries('conversation.askKnowledge.picker')).toHaveLength(1)
    row.openPicker()
    expect(b.slots.entries('conversation.askKnowledge.picker')).toHaveLength(1)
    const attach = (b.slots.entries('conversation.input.attachKnowledge')[0]!.inject as unknown as () => AttachKnowledgeBridgeInjected)()
    attach.openPicker()
    expect(b.slots.entries('conversation.askKnowledge.picker')).toHaveLength(1)
    const picker = (b.slots.entries('conversation.askKnowledge.picker')[0]!.inject as unknown as () => LibraryPickerInjected)()
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
    const dock = injectedOf<AskKnowledgeDockInjected>(b.slots.entries('conversation.input.dock')[0])
    expect(dock.hooks.askKnowledgeSelection.getSnapshot()).toEqual({})
    picker.rememberSelection(['raw/制度.md'])
    expect(dock.hooks.askKnowledgeSelection.getSnapshot()).toEqual({ s1: ['raw/制度.md'] })
    attach.openPicker()
    expect(b.slots.entries('conversation.askKnowledge.picker')).toHaveLength(1)
    const settings = (b.slots.entries('settings.section')[0]!.inject as unknown as () => LibrarySettingsRemotes & { attach: (id: string) => Promise<unknown> })()
    await settings.listLibraries()
    await settings.removeLibrary('1')
    await settings.attach('1')
    expect(b.remotes.removeAskKnowledgeLibrary).toHaveBeenCalledWith({ libraryId: '1' })
    expect(b.remotes.attachAskKnowledge).toHaveBeenCalled()
    await b.dispose()
  })

  it('omits sessionId when no current session exists', async () => {
    const b = await bench()
    const row = injectedOf<KnowledgeCapabilitiesRowInjected>(b.slots.entries('conversation.hero.capabilities.item')[0])
    row.openPicker()
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
    const row = injectedOf<KnowledgeCapabilitiesRowInjected>(b.slots.entries('conversation.hero.capabilities.item')[0])
    row.openPicker()
    const picker = (b.slots.entries('conversation.askKnowledge.picker')[0]!.inject as unknown as () => LibraryPickerInjected)()
    await picker.attach('1')
    expect(b.remotes.attachAskKnowledge).toHaveBeenCalledWith({
      libraryId: '1',
      sessionId: 's-data',
    })
    expect(b.openSession).toHaveBeenCalledWith('s-knowledge')
    await b.dispose()
  })
})
