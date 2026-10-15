import { EntityAvatar } from './EntityAvatar.tsx'
import { useEffect, useRef, useState } from 'react'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type {
  AssistantConversation,
  AssistantConversationId,
  AssistantModelSelection,
  AssistantProfile,
  AssistantProfileId,
  ListMemoryOptions,
  MemoryEntry,
  MemoryEntryId,
  MemoryScope,
  UpdateAssistantProfileOptions,
} from '@deepseek-ai/dsh-experimental-assistant-registry'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AssistantModelOption } from './models.ts'
import { NS } from './locales.ts'
import { AssistantDetailDrawer } from './AssistantDetailDrawer.tsx'
import css from './AssistantConversationHeader.module.css'

/** Injected operations for Assistant Conversation Header. */
export interface AssistantConversationHeaderInjected {
  sessionId: SessionId
  loadConversation: (sessionId: SessionId) => Promise<AssistantConversation | undefined>
  loadProfile: (profileId: AssistantProfileId) => Promise<AssistantProfile | undefined>
  loadModels: () => Promise<readonly AssistantModelOption[]>
  onStartNewTopic?: ((profileId: AssistantProfileId) => Promise<void>) | undefined
  onSetModelOverride?:
    ((id: AssistantConversationId, model: AssistantModelSelection) => Promise<AssistantConversation | undefined>) | undefined
  onClearModelOverride?: ((id: AssistantConversationId) => Promise<AssistantConversation | undefined>) | undefined
  onUpdateProfile?: ((id: AssistantProfileId, options: UpdateAssistantProfileOptions) => Promise<AssistantProfile | undefined>) | undefined
  loadMemories?: ((scope: MemoryScope, options?: ListMemoryOptions) => Promise<readonly MemoryEntry[]>) | undefined
  onSaveMemory?: ((scope: MemoryScope, text: string) => Promise<void>) | undefined
  onUpdateMemory?: ((id: MemoryEntryId, text: string, expectedRevision: number) => Promise<void>) | undefined
  onRemoveMemory?: ((id: MemoryEntryId, expectedRevision: number) => Promise<void>) | undefined
  onArchiveMemory?: ((id: MemoryEntryId, expectedRevision: number) => Promise<void>) | undefined
  onUnarchiveMemory?: ((id: MemoryEntryId, expectedRevision: number) => Promise<void>) | undefined
}

/** Component props for AssistantConversationHeader. */
export type AssistantConversationHeaderProps = PropsRuntime<'conversation.session.header.actions'> &
  AssistantConversationHeaderInjected &
  PropsLocale<typeof NS>

/**
 * Header actions for assistant-bound sessions: role badge, new topic, details drawer.
 * The header loads its own conversation, profile, and model catalog through
 * the injected loaders, so a cold-resumed session shows its profile once the
 * loader resolves.
 * @param props - session identity, loaders, and action callbacks.
 * @returns rendered header actions or null when unbound.
 */
export function AssistantConversationHeader({
  t,
  sessionId,
  loadConversation,
  loadProfile,
  loadModels,
  onStartNewTopic,
  onSetModelOverride,
  onClearModelOverride,
  onUpdateProfile,
  loadMemories,
  onSaveMemory,
  onUpdateMemory,
  onRemoveMemory,
  onArchiveMemory,
  onUnarchiveMemory,
}: AssistantConversationHeaderProps) {
  const generation = useRef(0)
  const [conversation, setConversation] = useState<AssistantConversation | undefined>(undefined)
  const [profile, setProfile] = useState<AssistantProfile | undefined>(undefined)
  const [models, setModels] = useState<readonly AssistantModelOption[]>([])
  const [actionFailed, setActionFailed] = useState(false)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  useEffect(() => {
    let active = true
    generation.current++
    setProfile(undefined)
    setConversation(undefined)
    setIsDrawerOpen(false)
    setActionFailed(false)
    void (async () => {
      const loadedConversation = await loadConversation(sessionId)
      if (!active) return
      setConversation(loadedConversation)
      if (!loadedConversation) {
        setProfile(undefined)
        return
      }
      const loadedProfile = await loadProfile(loadedConversation.profileId)
      if (active) setProfile(loadedProfile)
    })().catch(() => {
      if (active) setActionFailed(true)
    })
    return () => {
      active = false
      generation.current++
    }
  }, [loadConversation, loadProfile, sessionId])

  useEffect(() => {
    let active = true
    void loadModels()
      .then((next) => {
        if (active) setModels(next)
      })
      .catch(() => {
        if (active) setActionFailed(true)
      })
    return () => {
      active = false
    }
  }, [loadModels])

  if (!profile) return actionFailed ? <p role="alert">{t('operationFailed')}</p> : null

  const handleSetModelOverride = async (model: ModelSelection) => {
    if (!conversation || !onSetModelOverride) return
    const request = generation.current
    const updated = await onSetModelOverride(conversation.id, model)
    if (updated && request === generation.current) setConversation(updated)
  }

  const handleClearModelOverride = async () => {
    if (!conversation || !onClearModelOverride) return
    const request = generation.current
    const updated = await onClearModelOverride(conversation.id)
    if (updated && request === generation.current) setConversation(updated)
  }

  const handleUpdateProfile = async (id: AssistantProfileId, options: UpdateAssistantProfileOptions) => {
    if (!onUpdateProfile) return
    const request = generation.current
    const updated = await onUpdateProfile(id, options)
    if (updated && request === generation.current) setProfile(updated)
  }

  return (
    <div className={css.container}>
      {actionFailed && <p role="alert">{t('operationFailed')}</p>}
      <span className={css.badge}>
        <EntityAvatar name={profile.name} avatar={profile.avatar} small />
        {profile.name}
      </span>

      {onStartNewTopic && (
        <button
          type="button"
          className={css.actionButton}
          onClick={() => {
            void onStartNewTopic(profile.id).catch(() => {
              setActionFailed(true)
            })
          }}
        >
          {t('newTopic')}
        </button>
      )}

      <button
        type="button"
        className={css.actionButton}
        onClick={() => {
          setIsDrawerOpen(true)
        }}
      >
        {t('details')}
      </button>

      <AssistantDetailDrawer
        isOpen={isDrawerOpen}
        onClose={() => {
          setIsDrawerOpen(false)
        }}
        profile={profile}
        conversation={conversation}
        availableModels={models}
        onSetModelOverride={onSetModelOverride ? handleSetModelOverride : undefined}
        onClearModelOverride={onClearModelOverride ? handleClearModelOverride : undefined}
        onUpdateProfile={onUpdateProfile ? handleUpdateProfile : undefined}
        loadMemories={loadMemories}
        onSaveMemory={onSaveMemory}
        onUpdateMemory={onUpdateMemory}
        onRemoveMemory={onRemoveMemory}
        onArchiveMemory={onArchiveMemory}
        onUnarchiveMemory={onUnarchiveMemory}
        t={t}
      />
    </div>
  )
}
