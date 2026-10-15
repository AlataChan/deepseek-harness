/** Visible assistant identity beside the conversation composer. */
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { AssistantProfile } from '@deepseek-ai/dsh-experimental-assistant-registry/types'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { AssistantConversationHeaderInjected } from './AssistantConversationHeader.tsx'
import { EntityAvatar } from './EntityAvatar.tsx'
import { NS } from './locales.ts'
import css from './AssistantConversationHeader.module.css'

/** Async identity readers and an invalidation source shared with the header. */
export type AssistantIdentityDockInjected = Pick<AssistantConversationHeaderInjected,
  'sessionId' | 'loadConversation' | 'loadProfile' | 'bindingChanges'> & {
    onUseOrdinary?: (() => Promise<void>) | undefined
    sessionState?: {
      subscribe: (listener: () => void) => () => void
      getSnapshot: () => { blank: boolean; running: boolean } | undefined
    } | undefined
  }

const noSession = { subscribe: (_listener: () => void) => () => {}, getSnapshot: () => undefined }
const noChanges = { subscribe: (_listener: () => void) => () => {}, getSnapshot: () => 0 }

/**
 * Display identity only after the Host confirms the current Session's binding.
 * @param props - current Session, binding loaders, invalidations, and localized copy.
 * @returns the bound assistant's avatar and name, or no badge for an ordinary Session.
 */
export function AssistantIdentityDock({ sessionId, loadConversation, loadProfile, bindingChanges, onUseOrdinary, sessionState, t }:
  AssistantIdentityDockInjected & PropsLocale<typeof NS>) {
  const changes = bindingChanges ?? noChanges
  const revision = useSyncExternalStore(changes.subscribe, changes.getSnapshot)
  const [identity, setIdentity] = useState<{ sessionId: typeof sessionId; profile: AssistantProfile }>()
  const state = useSyncExternalStore((sessionState ?? noSession).subscribe, (sessionState ?? noSession).getSnapshot)
  const [changing, setChanging] = useState(false)
  const [actionFailed, setActionFailed] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const lifetime = new AbortController()
    const isCurrent = () => !lifetime.signal.aborted
    setIdentity(undefined)
    setFailed(false)
    void (async () => {
      const conversation = await loadConversation(sessionId)
      if (!isCurrent() || !conversation) return
      const profile = await loadProfile(conversation.profileId)
      if (isCurrent() && profile) setIdentity({ sessionId, profile })
    })().catch(() => { if (isCurrent()) setFailed(true) })
    return () => { lifetime.abort() }
  }, [sessionId, loadConversation, loadProfile, revision])
  if (failed) return <p role="alert">{t('operationFailed')}</p>
  if (!identity || identity.sessionId !== sessionId) return null
  return <div className={css.container} role="status" data-testid="assistant-conversation-identity">
    <span className={css.badge}>
      <EntityAvatar name={identity.profile.name} avatar={identity.profile.avatar} small />
      {t('currentAssistant')}: {identity.profile.name}
      {identity.profile.deletedAt !== undefined && <span>{t('entityDeleted')}</span>}
    </span>
    {onUseOrdinary && <button type="button" className={css.actionButton} disabled={changing || state?.running}
      onClick={() => {
        setChanging(true)
        setActionFailed(false)
        void onUseOrdinary().catch(() => { setActionFailed(true) }).finally(() => { setChanging(false) })
      }}>{t(state?.blank ? 'clearAssistantSelection' : 'startOrdinaryConversation')}</button>}
    {actionFailed && <span role="alert">{t('operationFailed')}</span>}
  </div>
}
