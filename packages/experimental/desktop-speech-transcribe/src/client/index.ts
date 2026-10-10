/**
 * Browser half: the 录音转文字 row in the 专业能力 hero menu. The row stages a
 * picked recording into the session workspace through the Host and submits a
 * transcription request for the `speech_transcribe` tool.
 * @module @deepseek-ai/dsh-experimental-desktop-speech-transcribe/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the fork-owned capabilities-menu slot and its row owner props.
import type {} from '@deepseek-ai/dsh-experimental-desktop-ask-data/client'
import { TranscriptAudioRow, type TranscriptAudioRowInjected } from './TranscriptAudioRow.tsx'
import { NS, en, zh, type SpeechTranscribeKey } from './locales.ts'
import type { TranscriptAudioRemotes } from './remotes.ts'

export type { StagedTranscriptAudioRow, TranscriptAudioRemotes } from './remotes.ts'
export type { TranscriptAudioRowInjected, TranscriptAudioRowProps } from './TranscriptAudioRow.tsx'
export {
  MAX_UPLOAD_MIB,
  TranscriptAudioRow,
  encodeAudioBytes,
  fileFromPicker,
  readAudioFile,
} from './TranscriptAudioRow.tsx'
export type { SpeechTranscribeKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Transcript-audio overlay copy. */
    'desktop-speech-transcribe': SpeechTranscribeKey
  }
}

/** One row from `sessions.list` as read by the capabilities occupant. */
interface ListedSession {
  id: string
  workspaceId?: string
}

/** Services required by the 录音转文字 occupant. */
export const inject = ['slots', 'remote', 'remote.session', 'locale']

/**
 * Register the 专业能力 row.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'desktop-speech-transcribe: dictionaries')
  // The row rides the fork-owned 专业能力 menu slot. Subscribe to the
  // declaration (the working creation-row shape) instead of registering
  // eagerly: the menu owner may apply after this entry.
  ctx.inject(['conversation', 'sessions', 'uiWorkspace'], (scope) => {
    const workspaceIdFor = (sessionId: SessionId | undefined): string | undefined => {
      if (sessionId === undefined) return undefined
      const sessions = scope.get('sessions') as {
        list?: { getSnapshot: () => { byId: Record<string, ListedSession> } }
      } | undefined
      return sessions?.list?.getSnapshot().byId[sessionId]?.workspaceId
    }
    const injectRow = (sessionId: SessionId | undefined): TranscriptAudioRowInjected => {
      const workspaceId = workspaceIdFor(sessionId)
      return {
        remotes: transcriptAudioRemotesOf(ctx),
        ...sessionId === undefined ? {} : { sessionId },
        ...workspaceId === undefined ? {} : { workspaceId },
      }
    }
    return scope.slots.inject('conversation.hero.capabilities.item', () => scope.slots.register({
      name: 'conversation.hero.capabilities.item',
      id: 'desktop-speech-transcribe',
      order: 35,
      locale: NS,
      inject: injectRow,
    }, TranscriptAudioRow))
  })
}

/**
 * Session Remotes used by the 录音转文字 row.
 * @param ctx - client context with a Session Remote.
 * @returns the session Remote namespace as the row's remotes face.
 */
export function transcriptAudioRemotesOf(ctx: ClientContext): TranscriptAudioRemotes {
  return ctx.remote.session
}
