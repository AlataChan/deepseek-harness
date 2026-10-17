/** @vitest-environment jsdom */
/** Ask-knowledge occupant registers the chip, picker, and settings section. */

import { Context, Service } from '@deepseek-ai/cordis'
import { createElement } from 'react'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { LibrarySettingsSection } from '../src/client/LibrarySettingsSection.tsx'
import { zh } from '../src/client/locales.ts'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject, mountAskKnowledgeUi } from '../src/client/mount.ts'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type {
  AskKnowledgeDockInjected, AttachKnowledgeBridgeInjected, KnowledgeCapabilitiesRowInjected,
} from '../src/client/mount.ts'
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
function injectedOf<T>(
  entry: { readonly inject?: ((...args: never[]) => Record<string, unknown>) | undefined } | undefined,
): T {
  if (entry?.inject === undefined) throw new Error('registered entry has no inject face')
  return entry.inject() as Partial<T> as T
}

async function bench(initial?: {
  current?: string
  byId?: Record<string, SessionRow>
  mountContribution?: TypertRemoteContribution
  namespacedRemote?: boolean
  libraries?: Array<{ id: string; displayName: string; documentCount?: number }>
}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const remotes = {
    listAskKnowledgeLibraries: vi.fn(async () => ({ ok: true as const, value: initial?.libraries ?? [] })),
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
  const unmountRemote = vi.fn(async () => {})
  const mountRemote = vi.fn(async (_contribution: TypertRemoteContribution) => unmountRemote)
  if (initial?.namespacedRemote) {
    class RemoteService extends Service {
      readonly $mount = mountRemote
      constructor(scope: Context) { super(scope, 'remote') }
    }
    new RemoteService(ctx)
  } else ctx.provide('remote', { session: remotes, $mount: mountRemote } as never)
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
    apply: initial?.mountContribution === undefined
      ? apply
      : async (scope: Context) => await mountAskKnowledgeUi(scope, initial.mountContribution!),
  })
  await fiber.await()
  return { ctx, slots, remotes, sessions, openSession, state, mountRemote, unmountRemote, dispose: () => fiber.dispose() }
}

describe('desktop-ask-knowledge apply', () => {
  it('mounts generated Remotes before UI and removes UI before unmounting', async () => {
    const contribution: TypertRemoteContribution = { package: '@fixture/document-remote', descriptors: [] }
    const b = await bench({ mountContribution: contribution })
    expect(b.mountRemote).toHaveBeenCalledExactlyOnceWith(contribution)
    expect(b.slots.entries('settings.section')).toHaveLength(1)
    b.unmountRemote.mockImplementation(async () => {
      expect(b.slots.entries('settings.section')).toHaveLength(0)
    })
    await b.dispose()
    expect(b.unmountRemote).toHaveBeenCalledTimes(1)
  })

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


describe('registered document actions', () => {
  it('dispatches every visible action to the document Host namespace with durable identity', async () => {
    const b = await bench()
    const item = { id: 'doc-verified', libraryId: 'library-verified', filename: 'policy.md',
      revisionId: 'rev-verified', originalAvailable: true, searchable: true,
      status: 'paused' as const, estimatedTokens: 42000, totalChunks: 8, planHash: 'exact-visible-plan' }
    let refuse = false
    const action = vi.fn(async () => refuse
      ? { ok: false as const, error: { message: 'durable cancellation refused' } }
      : { ok: true as const, value: undefined })
    const documents = vi.fn(async () => ({ ok: true as const, value: [item] }))
    b.ctx.provide('remote.askKnowledge', { documentAction: action, documents } as never)
    try {
      const settings = injectedOf<LibrarySettingsRemotes>(b.slots.entries('settings.section')[0])
      expect(await settings.listDocuments!('library-verified')).toEqual({ ok: true, value: [item] })
      for (const [name, operation] of [
        ['openOriginal', 'original'], ['viewText', 'text'], ['viewSources', 'sources'],
        ['retryStage', 'retry'], ['resumeExtraction', 'resume'], ['cancelProcessing', 'cancel'],
        ['approveBudget', 'approve'],
      ] as const) {
        await settings[name]!(item)
        expect(action).toHaveBeenLastCalledWith({ libraryId: item.libraryId, documentId: item.id,
          action: operation, planHash: item.planHash, approvedTokens: item.estimatedTokens })
      }
      refuse = true
      await expect(settings.cancelProcessing!(item)).rejects.toThrow('durable cancellation refused')
    } finally { await b.dispose() }
  })

  it('refuses actions without a Host method and never invents a retained legacy original', async () => {
    const b = await bench()
    try {
      const settings = injectedOf<LibrarySettingsRemotes>(b.slots.entries('settings.section')[0])
      await expect(settings.cancelProcessing!({ id: 'legacy', filename: 'a.md', originalAvailable: false,
        searchable: true, status: 'active' })).rejects.toThrow()
      const listed = await settings.listDocuments!('library')
      expect(listed.value?.every(item => !item.originalAvailable)).toBe(true)
    } finally { await b.dispose() }
  })
})

it('loads pending documents and approves their displayed budget through a real Cordis Remote namespace', async () => {
  const b = await bench({ namespacedRemote: true,
    libraries: [{ id: 'qinghe', displayName: '青禾培训测试库', documentCount: 1 }] })
  const item = { id: 'doc-qinghe', libraryId: 'qinghe', filename: '青禾原版.md',
    originalAvailable: true, searchable: true, status: 'paused' as const, stage: 'awaiting_approval',
    estimatedTokens: 42000, totalChunks: 32, completedChunks: 0, budgetApproved: false, planHash: 'visible-plan' }
  const documents = vi.fn(async () => ({ ok: true as const, value: [item] }))
  const documentAction = vi.fn(async () => ({ ok: true as const, value: undefined }))
  await b.ctx.plugin({ name: 'document-remote-provider', apply: (scope: Context) => {
    scope.provide('remote.askKnowledge', { documents, documentAction } as never)
  } }).await()
  const settings = injectedOf<LibrarySettingsRemotes>(b.slots.entries('settings.section')[0])
  const view = render(createElement(LibrarySettingsSection, { ...settings, t: key => zh[key] }))
  try {
    fireEvent.click(await view.findByRole('button', { name: /青禾培训测试库/ }))
    fireEvent.click(await view.findByRole('button', { name: '批准预算' }))
    expect(documents).toHaveBeenCalledWith('qinghe')
    expect(documentAction).toHaveBeenCalledWith({ libraryId: 'qinghe', documentId: item.id,
      action: 'approve', planHash: 'visible-plan', approvedTokens: 42000 })
    expect(view.queryByText('该知识库暂无文档')).toBeNull()
  } finally { view.unmount(); await b.dispose(); await b.ctx.fiber.dispose() }
})


it.each([
  ['original', 'docs.openOriginal'], ['text', 'docs.viewExtracted'], ['sources', 'docs.viewSources'],
  ['retry', 'docs.retryStage'], ['resume', 'docs.resumeExtraction'], ['cancel', 'docs.cancelProcessing'],
  ['approve', 'docs.approveBudget'], ['replay', 'docs.replayUncertain'],
] as const)('routes the mounted %s button through the real Cordis document namespace', async (operation, label) => {
  const b = await bench({ namespacedRemote: true, libraries: [{ id: 'actions', displayName: '按钮验收库' }] })
  const item = { id: 'doc-actions', libraryId: 'actions', filename: '按钮验证.md', originalAvailable: true,
    textAvailable: true, searchable: true, status: 'paused' as const,
    stage: operation === 'approve' ? 'awaiting_approval' : operation === 'replay' ? 'uncertain' : 'paused',
    error: operation === 'retry' ? 'Recoverable source failure' : undefined,
    estimatedTokens: 42000, budgetApproved: operation !== 'approve', planHash: 'visible-action-plan' }
  const documents = vi.fn(async () => ({ ok: true as const, value: [item] }))
  const documentAction = vi.fn(async () => ({ ok: true as const, value: undefined }))
  await b.ctx.plugin({ name: 'actions-remote-provider', apply: (scope: Context) => {
    scope.provide('remote.askKnowledge', { documents, documentAction } as never)
  } }).await()
  const settings = injectedOf<LibrarySettingsRemotes>(b.slots.entries('settings.section')[0])
  const view = render(createElement(LibrarySettingsSection, { ...settings, t: key => zh[key] }))
  try {
    fireEvent.click(await view.findByRole('button', { name: /按钮验收库/ }))
    fireEvent.click(await view.findByRole('button', { name: zh[label] }))
    await waitFor(() => expect(documentAction).toHaveBeenCalledExactlyOnceWith({
      libraryId: 'actions', documentId: 'doc-actions', action: operation === 'replay' ? 'resume' : operation,
      planHash: 'visible-action-plan', approvedTokens: 42000,
      ...operation === 'replay' ? { uncertainOutcome: 'replay' } : {},
    }))
  } finally { view.unmount(); await b.dispose(); await b.ctx.fiber.dispose() }
})
