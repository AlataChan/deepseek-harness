/**
 * Browser half of 问知识: hero chip, picker, and settings section.
 * The picker never occupies conversation.askData.gate.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-host-ask-knowledge/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: the fork-owned capabilities-menu slot and its row owner props.
import type {} from '@deepseek-ai/dsh-experimental-desktop-ask-data/client'
import { AskKnowledgeDock } from './AskKnowledgeDock.tsx'
import type { AskKnowledgeDockInjected } from './AskKnowledgeDock.tsx'
import { KnowledgeCapabilitiesRow } from './KnowledgeCapabilitiesRow.tsx'
import type { KnowledgeCapabilitiesRowInjected } from './KnowledgeCapabilitiesRow.tsx'
import { AttachKnowledgeBridge } from './AttachKnowledgeBridge.tsx'
import type { AttachKnowledgeBridgeInjected } from './AttachKnowledgeBridge.tsx'
import { AttachSessionDocumentBridge } from './AttachSessionDocumentBridge.tsx'
import type { AttachSessionDocumentBridgeInjected } from './AttachSessionDocumentBridge.tsx'
import { LibraryPicker } from './LibraryPicker.tsx'
import { ingestFinishError } from './LibraryPicker.tsx'
import { uploadLibraryDocument } from './ingest-file.ts'
import type { LibraryPickerInjected, LibraryPickerRemotes } from './LibraryPicker.tsx'
import { LibrarySettingsSection } from './LibrarySettingsSection.tsx'
import type { LibrarySettingsRemotes } from './LibrarySettingsSection.tsx'
import type { DocumentStatusItem } from './DocumentStatus.tsx'
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { en, zh, type AskKnowledgeKey } from './locales.ts'

export type { AskKnowledgeChipInjected, AskKnowledgeChipProps } from './AskKnowledgeChip.tsx'
export { AskKnowledgeChip } from './AskKnowledgeChip.tsx'
export type { AskKnowledgeDockInjected, AskKnowledgeDockProps } from './AskKnowledgeDock.tsx'
export type {
  KnowledgeCapabilitiesRowInjected, KnowledgeCapabilitiesRowProps,
} from './KnowledgeCapabilitiesRow.tsx'
export type {
  AttachKnowledgeBridgeInjected, AttachKnowledgeBridgeProps,
} from './AttachKnowledgeBridge.tsx'
export { AttachKnowledgeBridge } from './AttachKnowledgeBridge.tsx'
export type {
  AttachSessionDocumentBridgeInjected, AttachSessionDocumentBridgeProps,
} from './AttachSessionDocumentBridge.tsx'
export { AttachSessionDocumentBridge } from './AttachSessionDocumentBridge.tsx'
export type {
  LibraryPickerInjected, LibraryPickerProps, PickerIngestResult, PickerLibrary,
} from './LibraryPicker.tsx'
export { LibraryPicker } from './LibraryPicker.tsx'
export type { LibrarySettingsSectionProps, SettingsLibrary } from './LibrarySettingsSection.tsx'
export { LibrarySettingsSection } from './LibrarySettingsSection.tsx'
export type { DocumentStatusItem, DocumentStatusProps } from './DocumentStatus.tsx'
export { DocumentStatus } from './DocumentStatus.tsx'
export type { DocumentListProps } from './DocumentList.tsx'
export { DocumentList } from './DocumentList.tsx'
export type { AskKnowledgeKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Ask-knowledge overlay copy. */
    'desktop-ask-knowledge': AskKnowledgeKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'desktop-ask-knowledge'

/** One row from `sessions.list` as read by the ask-knowledge occupant. */
interface ListedSession {
  id: string
  retainedBy?: Record<string, number | undefined>
  projectionValues?: {
    askKnowledgeBinding?: unknown
  }
}

/** Services required by the ask-knowledge occupant. */
export const inject = ['slots', 'remote', 'remote.session', 'locale']

/**
 * Register the 专业能力 row, picker, dock strip, and settings section.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'desktop-ask-knowledge: dictionaries')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'desktop-ask-knowledge',
    order: 40,
    locale: NS,
    label: zh['settings.section'],
    inject: (): LibrarySettingsRemotes => remotesOf(ctx),
  }, LibrarySettingsSection))
  ctx.inject(['conversation', 'sessions', 'uiWorkspace'], (scope: ClientContext) => {
    let pickerDispose: (() => void) | undefined
    // Documents picked per Session, published to the composer dock.
    const selection = createSnapshotStore<Record<string, string[] | undefined>>({})

    const currentSession = (): ListedSession | undefined => {
      const state = scope.sessions.list.getSnapshot() as {
        byId: Record<string, ListedSession>
      }
      return Object.values(state.byId).find(row => (row.retainedBy?.mainView ?? 0) > 0)
    }

    const closePicker = (): void => {
      pickerDispose?.()
      pickerDispose = undefined
    }

    const openPanel = (): void => {
      pickerDispose = scope.slots.register({
        name: 'conversation.askKnowledge.picker',
        locale: NS,
        inject: (): LibraryPickerInjected => ({
          ...remotesOf(scope),
          attach: async (libraryId) => {
            const session = currentSession()
            const result = await scope.remote.session.attachAskKnowledge({
              libraryId,
              ...session === undefined ? {} : { sessionId: SessionId(session.id) },
            })
            if (
              result.ok
              && result.value.sessionId !== session?.id
            ) {
              scope.uiWorkspace.openSession(SessionId(result.value.sessionId))
            }
            return result
          },
          rememberSelection: (docs) => {
            const session = currentSession()
            if (session !== undefined) {
              selection.update((draft) => { draft[session.id] = [...docs] })
            }
          },
          close: closePicker,
        }),
      }, LibraryPicker)
    }

    const openPicker = (): void => {
      if (pickerDispose !== undefined) return
      openPanel()
    }

    const dock = scope.slots.register({
      name: 'conversation.input.dock',
      id: 'desktop-ask-knowledge',
      order: 30,
      locale: NS,
      inject: (): AskKnowledgeDockInjected => ({
        openPicker,
        hooks: { askKnowledgeSelection: selection },
      }),
    }, AskKnowledgeDock)
    const capabilitiesRow = scope.slots.inject('conversation.hero.capabilities.item', () => scope.slots.register({
      name: 'conversation.hero.capabilities.item',
      id: 'desktop-ask-knowledge',
      order: 20,
      locale: NS,
      inject: (): KnowledgeCapabilitiesRowInjected => ({ openPicker }),
    }, KnowledgeCapabilitiesRow))
    const attach = scope.slots.inject('conversation.input.attachKnowledge', () => scope.slots.register({
      name: 'conversation.input.attachKnowledge',
      inject: (): AttachKnowledgeBridgeInjected => ({
        openPicker,
      }),
    }, AttachKnowledgeBridge))
    const attachSessionDoc = scope.slots.inject('conversation.input.attachSessionDocument', () => scope.slots.register({
      name: 'conversation.input.attachSessionDocument',
      inject: (): AttachSessionDocumentBridgeInjected => ({ remotes: extractRemotesOf(scope) }),
    }, AttachSessionDocumentBridge))

    return () => {
      closePicker()
      attachSessionDoc()
      attach()
      dock()
      capabilitiesRow()
    }
  })
}

function remotesOf(ctx: ClientContext): LibrarySettingsRemotes & LibraryPickerRemotes {
  const session = ctx.remote.session as {
    listAskKnowledgeLibraries: LibraryPickerInjected['listLibraries']
    createAskKnowledgeLibrary: (request: { displayName: string }) => ReturnType<LibraryPickerInjected['createLibrary']>
    attachAskKnowledge: (request: { libraryId: string; sessionId?: ReturnType<typeof SessionId> }) => ReturnType<LibraryPickerInjected['attach']>
    renameAskKnowledgeLibrary: (request: { libraryId: string; displayName: string }) => ReturnType<LibraryPickerInjected['renameLibrary']>
    removeAskKnowledgeLibrary: (request: { libraryId: string }) => ReturnType<LibrarySettingsRemotes['removeLibrary']>
    beginAskKnowledgeIngest: (request: { libraryId: string; filename: string }) => ReturnType<LibraryPickerInjected['beginIngest']>
    appendAskKnowledgeIngestChunk: (request: { handle: string; bytes: string }) => ReturnType<LibraryPickerInjected['appendIngestChunk']>
    finishAskKnowledgeIngest: (request: { handle: string }) => ReturnType<LibraryPickerInjected['finishIngest']>
    askKnowledgeListDocuments: (request: { libraryId: string }) => Promise<{
      ok: boolean
      value?: { documentPaths: readonly string[] }
      error?: { message?: string }
    }>
  }
  const remotes: LibrarySettingsRemotes & LibraryPickerRemotes = {
    listLibraries: () => session.listAskKnowledgeLibraries(),
    createLibrary: displayName => session.createAskKnowledgeLibrary({ displayName }),
    attach: libraryId => session.attachAskKnowledge({ libraryId }),
    renameLibrary: (libraryId, displayName) => session.renameAskKnowledgeLibrary({ libraryId, displayName }),
    removeLibrary: libraryId => session.removeAskKnowledgeLibrary({ libraryId }),
    beginIngest: (libraryId, filename) => session.beginAskKnowledgeIngest({ libraryId, filename }),
    appendIngestChunk: (handle, bytes) => session.appendAskKnowledgeIngestChunk({ handle, bytes }),
    finishIngest: handle => session.finishAskKnowledgeIngest({ handle }),
    abortIngest: async (handle) => {
      const remote = documentRemotes(ctx)
      if (remote?.abortIngest !== undefined) return remote.abortIngest({ handle })
      return { ok: true, value: undefined }
    },
    addDocument: async (libraryId, file) => {
      const finished = await uploadLibraryDocument(remotes, libraryId, file, ctx.locale.resolveText({ zh: zh['ingest.failed'], en: en['ingest.failed'] }))
      if (!finished.ok || finished.value === undefined || finished.value.status === 'failed'
        || (finished.value.status === 'deferred' && !finished.value.rawRelPath)) {
        throw new Error(ingestFinishError(finished, ctx.locale.resolveText({ zh: zh['ingest.failed'], en: en['ingest.failed'] }), ctx.locale.resolveText({ zh: zh['ingest.timeout'], en: en['ingest.timeout'] })))
      }
    },
    listDocuments: async (libraryId: string) => {
      const remote = documentRemotes(ctx)
      if (remote !== undefined) {
        const result = await remote.documentList(libraryId)
        return result.ok ? { ok: true, value: result.value.documents,
          ...result.value.migrationWarning === undefined ? {} : { warning: result.value.migrationWarning } } : result
      }
      // Legacy Host has raw pages but no retained source metadata.
      const result = await session.askKnowledgeListDocuments({ libraryId })
      return result.ok && result.value !== undefined
        ? { ok: true, value: result.value.documentPaths.map(path => ({ id: path, libraryId,
          filename: path, originalAvailable: false, searchable: true, status: 'retained' as const })) }
        : { ok: false }
    },
    listLibraryDocuments: async (libraryId) => {
      const result = await session.askKnowledgeListDocuments({ libraryId })
      return result.ok && result.value !== undefined
        ? { ok: true, value: result.value.documentPaths }
        : { ok: false, ...result.error === undefined ? {} : { error: result.error } }
    },
    openOriginal: item => documentAction(ctx, item, 'original'),
    viewText: item => documentAction(ctx, item, 'text'),
    viewSources: item => documentAction(ctx, item, 'sources'),
    retryStage: item => documentAction(ctx, item, 'retry'),
    resumeExtraction: item => documentAction(ctx, item, 'resume'),
    cancelProcessing: item => documentAction(ctx, item, 'cancel'),
    approveBudget: item => documentAction(ctx, item, 'approve'),
  }
  return remotes
}

function extractRemotesOf(ctx: ClientContext): AttachSessionDocumentBridgeInjected['remotes'] {
  const session = ctx.remote.session as {
    beginAskKnowledgeExtract: AttachSessionDocumentBridgeInjected['remotes']['beginExtract']
    appendAskKnowledgeExtractChunk: AttachSessionDocumentBridgeInjected['remotes']['appendExtractChunk']
    finishAskKnowledgeExtract: AttachSessionDocumentBridgeInjected['remotes']['finishExtract']
  }
  return {
    beginExtract: request => session.beginAskKnowledgeExtract(request),
    appendExtractChunk: request => session.appendAskKnowledgeExtractChunk(request),
    finishExtract: request => session.finishAskKnowledgeExtract(request),
    abortExtract: async (request) => {
      const remote = documentRemotes(ctx)
      if (remote?.abortIngest !== undefined) return remote.abortIngest(request)
      return { ok: true, value: undefined }
    },
  }
}

interface DocumentRemotes {
  documentList(libraryId: string): Promise<RemoteResult<{
    readonly documents: readonly DocumentStatusItem[]
    readonly migrationWarning?: string
  }>>
  startDocumentAction: DocumentRemotes['documentAction']
  documentAction(this: void, request: {
    libraryId: string
    documentId: string
    action: string
    planHash?: string
    approvedTokens?: number
    uncertainOutcome?: 'replay'
  }): Promise<RemoteResult<void>>
  abortIngest?(request: { handle: string }): Promise<RemoteResult<void>>
}

function documentRemotes(ctx: ClientContext): DocumentRemotes | undefined {
  return ctx.get('remote.askKnowledge') as DocumentRemotes | undefined
}

async function documentAction(ctx: ClientContext, item: DocumentStatusItem, action: string): Promise<void> {
  const remote = documentRemotes(ctx)
  if (!remote || !item.libraryId) throw new Error(ctx.locale.resolveText({ zh: zh['error.docsFailed'], en: en['error.docsFailed'] }))
  const invoke = ['approve', 'resume', 'retry'].includes(action) ? remote.startDocumentAction : remote.documentAction
  const result = await invoke({ libraryId: item.libraryId, documentId: item.id, action,
    ...item.planHash === undefined ? {} : { planHash: item.planHash },
    ...item.estimatedTokens === undefined ? {} : { approvedTokens: item.estimatedTokens },
    ...item.uncertainOutcome === 'replay' ? { uncertainOutcome: item.uncertainOutcome } : {} })
  if (!result.ok) throw new Error(result.error.message)
}

/**
 * Mount the generated document Remote contribution before exposing its UI.
 * @param ctx - browser service context.
 * @param contribution - generated Host-for-Client document descriptors.
 * @returns disposer that removes UI registrations before the Remote namespace.
 */
export async function mountAskKnowledgeUi(
  ctx: ClientContext,
  contribution: TypertRemoteContribution,
): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(inject, apply)
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeRemote()
  }
}
