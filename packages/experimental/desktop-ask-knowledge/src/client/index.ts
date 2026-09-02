/**
 * Browser half of 问知识: hero chip, picker, and settings section.
 * The picker never occupies conversation.askData.gate.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-host-ask-knowledge/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { AskKnowledgeChip } from './AskKnowledgeChip.tsx'
import type { AskKnowledgeChipInjected } from './AskKnowledgeChip.tsx'
import { AttachKnowledgeBridge } from './AttachKnowledgeBridge.tsx'
import type { AttachKnowledgeBridgeInjected } from './AttachKnowledgeBridge.tsx'
import { AttachSessionDocumentBridge } from './AttachSessionDocumentBridge.tsx'
import type { AttachSessionDocumentBridgeInjected } from './AttachSessionDocumentBridge.tsx'
import { LibraryPicker } from './LibraryPicker.tsx'
import type { LibraryPickerInjected, LibraryPickerRemotes } from './LibraryPicker.tsx'
import { LibrarySettingsSection } from './LibrarySettingsSection.tsx'
import type { LibrarySettingsRemotes } from './LibrarySettingsSection.tsx'
import { en, zh, type AskKnowledgeKey } from './locales.ts'

export type { AskKnowledgeChipInjected, AskKnowledgeChipProps } from './AskKnowledgeChip.tsx'
export { AskKnowledgeChip } from './AskKnowledgeChip.tsx'
export type {
  AttachKnowledgeBridgeInjected, AttachKnowledgeBridgeProps,
} from './AttachKnowledgeBridge.tsx'
export { AttachKnowledgeBridge } from './AttachKnowledgeBridge.tsx'
export type {
  AttachSessionDocumentBridgeInjected, AttachSessionDocumentBridgeProps,
} from './AttachSessionDocumentBridge.tsx'
export { AttachSessionDocumentBridge } from './AttachSessionDocumentBridge.tsx'
export type {
  LibraryPickerInjected, LibraryPickerPhase, LibraryPickerProps, PickerIngestResult, PickerLibrary,
} from './LibraryPicker.tsx'
export { LibraryPicker } from './LibraryPicker.tsx'
export type { LibrarySettingsSectionProps, SettingsLibrary } from './LibrarySettingsSection.tsx'
export { LibrarySettingsSection } from './LibrarySettingsSection.tsx'
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
  projectionValues?: {
    askKnowledgeBinding?: unknown
  }
}

/**
 * Hung library name on this list row, if any.
 * @param session - current list row.
 * @returns display name, or undefined when unbound.
 */
function boundName(session: ListedSession | undefined): string | undefined {
  const binding = session?.projectionValues?.askKnowledgeBinding
  if (typeof binding !== 'object' || binding === null) return undefined
  if (!('displayName' in binding)) return undefined
  return typeof binding.displayName === 'string' ? binding.displayName : undefined
}

/** Services required by the ask-knowledge occupant. */
export const inject = ['slots', 'remote', 'remote.session', 'locale']

/**
 * Register the 问知识 chip, picker, and settings section.
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
  ctx.inject(['conversation', 'sessions'], (scope: ClientContext) => {
    let pickerDispose: (() => void) | undefined

    const currentSession = (): ListedSession | undefined => {
      const state = scope.sessions.list.getSnapshot() as {
        current?: string
        byId: Record<string, ListedSession>
      }
      return state.current === undefined ? undefined : state.byId[state.current]
    }

    const closePicker = (): void => {
      pickerDispose?.()
      pickerDispose = undefined
    }

    const openPicker = (start: 'list' | 'upload' = 'list'): void => {
      if (pickerDispose !== undefined) {
        if (start === 'list') return
        closePicker()
      }
      pickerDispose = scope.slots.register({
        name: 'conversation.askKnowledge.picker',
        locale: NS,
        inject: (): LibraryPickerInjected => ({
          ...remotesOf(scope),
          initialPhase: start,
          attach: async (libraryId) => {
            const session = currentSession()
            const result = await scope.remote.session.attachAskKnowledge({
              libraryId,
              ...session === undefined ? {} : { sessionId: SessionId(session.id) },
            })
            if (
              result.ok
              && result.value?.sessionId !== undefined
              && result.value.sessionId !== session?.id
            ) {
              scope.sessions.open(SessionId(result.value.sessionId))
            }
            return result
          },
          close: closePicker,
        }),
      }, LibraryPicker)
    }

    const chip = scope.slots.register({
      name: 'conversation.hero.askKnowledge',
      locale: NS,
      inject: (): AskKnowledgeChipInjected => ({
        openPicker: () => { openPicker('list') },
        ...boundName(currentSession()) === undefined ? {} : { boundName: boundName(currentSession()) },
      }),
    }, AskKnowledgeChip)
    const attach = scope.slots.inject('conversation.input.attachKnowledge', () => scope.slots.register({
      name: 'conversation.input.attachKnowledge',
      inject: (): AttachKnowledgeBridgeInjected => ({
        openPicker: () => { openPicker('upload') },
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
      chip()
    }
  })
}

function remotesOf(ctx: ClientContext): LibrarySettingsRemotes & LibraryPickerRemotes {
  const session = ctx.remote.session as unknown as {
    listAskKnowledgeLibraries: LibraryPickerInjected['listLibraries']
    createAskKnowledgeLibrary: (request: { displayName: string }) => ReturnType<LibraryPickerInjected['createLibrary']>
    attachAskKnowledge: (request: { libraryId: string; sessionId?: ReturnType<typeof SessionId> }) => ReturnType<LibraryPickerInjected['attach']>
    renameAskKnowledgeLibrary: (request: { libraryId: string; displayName: string }) => ReturnType<LibraryPickerInjected['renameLibrary']>
    removeAskKnowledgeLibrary: (request: { libraryId: string }) => ReturnType<LibrarySettingsRemotes['removeLibrary']>
    beginAskKnowledgeIngest: (request: { libraryId: string; filename: string }) => ReturnType<LibraryPickerInjected['beginIngest']>
    appendAskKnowledgeIngestChunk: (request: { handle: string; bytes: string }) => ReturnType<LibraryPickerInjected['appendIngestChunk']>
    finishAskKnowledgeIngest: (request: { handle: string }) => ReturnType<LibraryPickerInjected['finishIngest']>
  }
  return {
    listLibraries: () => session.listAskKnowledgeLibraries(),
    createLibrary: displayName => session.createAskKnowledgeLibrary({ displayName }),
    attach: libraryId => session.attachAskKnowledge({ libraryId }),
    renameLibrary: (libraryId, displayName) => session.renameAskKnowledgeLibrary({ libraryId, displayName }),
    removeLibrary: libraryId => session.removeAskKnowledgeLibrary({ libraryId }),
    beginIngest: (libraryId, filename) => session.beginAskKnowledgeIngest({ libraryId, filename }),
    appendIngestChunk: (handle, bytes) => session.appendAskKnowledgeIngestChunk({ handle, bytes }),
    finishIngest: handle => session.finishAskKnowledgeIngest({ handle }),
  }
}

function extractRemotesOf(ctx: ClientContext): AttachSessionDocumentBridgeInjected['remotes'] {
  const session = ctx.remote.session as unknown as {
    beginAskKnowledgeExtract: AttachSessionDocumentBridgeInjected['remotes']['beginExtract']
    appendAskKnowledgeExtractChunk: AttachSessionDocumentBridgeInjected['remotes']['appendExtractChunk']
    finishAskKnowledgeExtract: AttachSessionDocumentBridgeInjected['remotes']['finishExtract']
  }
  return {
    beginExtract: request => session.beginAskKnowledgeExtract(request),
    appendExtractChunk: request => session.appendAskKnowledgeExtractChunk(request),
    finishExtract: request => session.finishAskKnowledgeExtract(request),
  }
}
