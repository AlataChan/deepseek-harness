/**
 * Browser half of conversation media creation: shortcuts, cards, Works, and the MiniMax key.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
// Type-only: Models footer slot declared by the official Models section.
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
// Type-only: the fork-owned capabilities-menu slot and its row owner props.
import type {} from '@deepseek-ai/dsh-experimental-desktop-ask-data/client'
import { CreationShortcuts, type CreationShortcutsInjected } from './CreationShortcuts.tsx'
import { MediaCard, type MediaCardInjected } from './MediaCard.tsx'
import { MinimaxKeyCard, mediaCredentialsOf } from './MinimaxKeyCard.tsx'
import { WorksButton } from './WorksButton.tsx'
import { WorksPanel, type ListedSession, type WorksPanelInjected } from './WorksPanel.tsx'
import { en, NS, zh, type MediaKey } from './locales.ts'
import type { MediaSessionRemotes } from './remotes.ts'

export type { MediaKey } from './locales.ts'
export type {
  MediaSessionRemotes,
  MediaWorkRow,
  MediaVoiceRow,
  MediaRuntimeRow,
  MediaCredentialsRemotes,
  MediaCredentialInfo,
} from './remotes.ts'
export type { MinimaxKeyCardInjected, MinimaxKeyCardProps } from './MinimaxKeyCard.tsx'
export type { MediaCardModel, MediaRowState } from './card-model.ts'
export { mediaCardModel, firstLine, resultText } from './card-model.ts'
export { encodeMediaBytes } from './VoicePicker.tsx'
export { setWorksOpen, worksOpen, subscribeWorks } from './works-state.ts'
export { CreationShortcuts, fileFromPicker } from './CreationShortcuts.tsx'
export { importedCloneDraft, isCloneAudioName, readCloneFile } from './VoicePicker.tsx'
export { WorksButton } from './WorksButton.tsx'
export { WorksPanel } from './WorksPanel.tsx'
export { VoicePicker } from './VoicePicker.tsx'
export { MediaCard } from './MediaCard.tsx'
export {
  MinimaxKeyCard,
  MINIMAX_API_KEY_NAME,
  mediaCredentialsOf,
} from './MinimaxKeyCard.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Desktop media overlay copy. */
    'desktop-media': MediaKey
  }
}

const TOOLS = [
  'media_create_video',
  'media_synthesize_speech',
  'media_clone_voice',
  'media_compose',
] as const

/** Required browser services. */
export const inject = ['slots', 'remote', 'remote.session', 'locale']

/**
 * Session remotes used by the media overlay.
 * @param ctx - client context with a Session Remote.
 * @returns duck-typed media remotes.
 */
export function mediaRemotesOf(ctx: ClientContext): MediaSessionRemotes {
  return ctx.remote.session as unknown as MediaSessionRemotes
}

/**
 * Save As uses the native OS chooser only. Browse occupants expose listDirectory.
 * @param ctx - client context.
 * @returns pickDirectory when the native chooser is present.
 */
export function nativePickDirectory(
  ctx: ClientContext,
): (() => Promise<string | null>) | undefined {
  const workspace = ctx.get('uiWorkspace') as { pickDirectory?: () => Promise<string | null> } | undefined
  if (workspace?.pickDirectory === undefined) return undefined
  let occupants: readonly { inject?: () => Record<string, unknown> | undefined }[] = []
  try {
    occupants = (ctx.get('slots') as
      | { entries: (name: string) => typeof occupants }
      | undefined)?.entries('sidebar.workspaces.directoryFlow') ?? []
  } catch (error: unknown) {
    // SlotRegistry throws when the hole was never declared; hide Save As.
    void error
  }
  let native = false
  for (const row of occupants) {
    const injected = row.inject === undefined ? undefined : row.inject()
    if (injected === undefined) continue
    if (Object.hasOwn(injected, 'listDirectory')) return undefined
    if (Object.hasOwn(injected, 'pick')) native = true
  }
  if (!native) return undefined
  const pickDirectory = workspace.pickDirectory
  return () => pickDirectory()
}

/**
 * Register dictionaries, shortcuts, cards, Works button, and overlay.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'desktop-media: dictionaries')
  // The creation rows ride the fork-owned 专业能力 menu slot. Subscribe to the
  // declaration (the working knowledge-row shape) instead of registering
  // eagerly: the menu owner may apply after this entry.
  ctx.inject(['conversation', 'sessions', 'uiWorkspace'], (scope) => {
    const workspaceIdFor = (sessionId: SessionId | undefined): string | undefined => {
      if (sessionId === undefined) return undefined
      const sessions = scope.get('sessions') as {
        list?: { getSnapshot: () => { byId: Record<string, ListedSession> } }
      } | undefined
      return sessions?.list?.getSnapshot().byId[sessionId]?.workspaceId
    }
    const injectRows = (sessionId: SessionId | undefined): CreationShortcutsInjected => {
      const workspaceId = workspaceIdFor(sessionId)
      return {
        remotes: mediaRemotesOf(ctx),
        credentials: mediaCredentialsOf(ctx),
        ...sessionId === undefined ? {} : { sessionId },
        ...workspaceId === undefined ? {} : { workspaceId },
      }
    }
    return scope.slots.inject('conversation.hero.capabilities.item', () => scope.slots.register({
      name: 'conversation.hero.capabilities.item',
      id: 'desktop-media',
      order: 30,
      locale: NS,
      inject: injectRows,
    }, CreationShortcuts))
  })
  for (const key of TOOLS) {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
      name: 'tool.call.toolview',
      key,
      locale: NS,
      inject: (): MediaCardInjected => {
        const state = ctx.get('sessions') as {
          list: { getSnapshot: () => { current?: string; byId: Record<string, ListedSession> } }
        } | undefined
        const snapshot = state?.list.getSnapshot()
        const current = snapshot?.current === undefined ? undefined : snapshot.byId[snapshot.current]
        return {
          remotes: mediaRemotesOf(ctx),
          sessionId: current?.id ?? '',
          ...current?.workspaceId === undefined ? {} : { workspaceId: current.workspaceId },
        }
      },
    }, MediaCard))
  }
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'desktop-media-works',
    order: 20,
    locale: NS,
  }, WorksButton))
  ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
    name: 'settings.models.footer',
    id: 'desktop-media-minimax-key',
    order: 10,
    locale: NS,
    inject: () => ({ credentials: mediaCredentialsOf(ctx) }),
  }, MinimaxKeyCard))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'desktop-media-works-panel',
    order: 20,
    locale: NS,
    inject: (): WorksPanelInjected => {
      const sessions = ctx.get('sessions') as {
        list: { getSnapshot: () => { current?: string; byId: Record<string, ListedSession> } }
        open: (id: ReturnType<typeof SessionId>) => void
      } | undefined
      const snapshot = sessions?.list.getSnapshot() ?? { byId: {} }
      const current = snapshot.current === undefined ? undefined : snapshot.byId[snapshot.current]
      const pickDirectory = nativePickDirectory(ctx)
      return {
        remotes: mediaRemotesOf(ctx),
        sessionsById: snapshot.byId,
        openSession: (sessionId) => { sessions?.open(SessionId(sessionId)) },
        ...current === undefined ? {} : { current },
        ...pickDirectory === undefined ? {} : { pickDirectory },
        copyText: text => navigator.clipboard.writeText(text),
      }
    },
  }, WorksPanel))
}
