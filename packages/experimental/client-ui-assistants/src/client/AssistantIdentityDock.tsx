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
  'sessionId' | 'loadConversation' | 'loadProfile' | 'bindingChanges'>

const noChanges = { subscribe: (_listener: () => void) => () => {}, getSnapshot: () => 0 }

/**
 * Display identity only after the Host confirms the current Session's binding.
 * @param props - current Session, binding loaders, invalidations, and localized copy.
 * @returns the bound assistant's avatar and name, or no badge for an ordinary Session.
 */
export function AssistantIdentityDock({ sessionId, loadConversation, loadProfile, bindingChanges, t }:
  AssistantIdentityDockInjected & PropsLocale<typeof NS>) {
  const changes = bindingChanges ?? noChanges
  const revision = useSyncExternalStore(changes.subscribe, changes.getSnapshot)
  const [identity, setIdentity] = useState<{ sessionId: typeof sessionId; profile: AssistantProfile }>()
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
    </span>
  </div>
}
