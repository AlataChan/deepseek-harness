import { AvatarPicker, EntityAvatar } from './EntityAvatar.tsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type {
  AssistantConversation,
  AssistantProfile,
  AssistantProfileId,
  ListMemoryOptions,
  MemoryEntry,
  MemoryEntryId,
  MemoryScope,
  UpdateAssistantProfileOptions,
} from '@deepseek-ai/dsh-experimental-assistant-registry'
import type { AssistantModelOption } from './models.ts'
import { modelRouteValue, parseModelRoute } from './models.ts'
import { ModelSelect } from './ModelSelect.tsx'
import { MemoryPanel } from './MemoryPanel.tsx'
import type { AssistantLocaleKey } from './locales.ts'
import css from './AssistantDetailDrawer.module.css'

/** Injected properties for the assistant detail drawer. */
export interface AssistantDetailDrawerProps {
  isOpen: boolean
  onClose: () => void
  profile: AssistantProfile
  conversation?: AssistantConversation | undefined
  availableModels?: readonly AssistantModelOption[] | undefined
  onSetModelOverride?: ((model: ModelSelection) => Promise<void>) | undefined
  onClearModelOverride?: (() => Promise<void>) | undefined
  onUpdateProfile?: ((id: AssistantProfileId, options: UpdateAssistantProfileOptions) => Promise<void>) | undefined
  loadMemories?: ((scope: MemoryScope, options?: ListMemoryOptions) => Promise<readonly MemoryEntry[]>) | undefined
  onSaveMemory?: ((scope: MemoryScope, text: string) => Promise<void>) | undefined
  onUpdateMemory?: ((id: MemoryEntryId, text: string, expectedRevision: number) => Promise<void>) | undefined
  onRemoveMemory?: ((id: MemoryEntryId, expectedRevision: number) => Promise<void>) | undefined
  onArchiveMemory?: ((id: MemoryEntryId, expectedRevision: number) => Promise<void>) | undefined
  onUnarchiveMemory?: ((id: MemoryEntryId, expectedRevision: number) => Promise<void>) | undefined
  t: (key: AssistantLocaleKey) => string
}

/**
 * Assistant detail and configuration drawer: profile facts plus the default
 * model editor, and the conversation-scoped model override when a
 * conversation is supplied.
 * @param props - profile, conversation, and model handlers.
 * @returns rendered drawer component or null when closed.
 */
export function AssistantDetailDrawer(props: AssistantDetailDrawerProps) {
  if (!props.isOpen) return null
  return <AssistantDetailDrawerContent key={`${props.profile.id}:${props.conversation?.id ?? ''}`} {...props} />
}

function AssistantDetailDrawerContent({
  isOpen,
  onClose,
  profile,
  conversation,
  availableModels = [],
  onSetModelOverride,
  onClearModelOverride,
  onUpdateProfile,
  loadMemories,
  onSaveMemory,
  onUpdateMemory,
  onRemoveMemory,
  onArchiveMemory,
  onUnarchiveMemory,
  t,
}: AssistantDetailDrawerProps) {
  const [selectedModelKey, setSelectedModelKey] = useState(() => modelRouteValue(conversation?.modelOverride))
  const [profileModelKey, setProfileModelKey] = useState(() => modelRouteValue(profile.defaultModel))
  const [avatarSaving, setAvatarSaving] = useState(false)
  const avatarBusy = useRef(false)
  const saveAvatar = async (value: string) => {
    if (!onUpdateProfile || avatarBusy.current) return
    avatarBusy.current = true
    setAvatarSaving(true)
    setModelError(null)
    try {
      await onUpdateProfile(profile.id, { avatar: value })
    } catch {
      if (mounted.current) setModelError('operationFailed')
    } finally {
      avatarBusy.current = false
      if (mounted.current) setAvatarSaving(false)
    }
  }
  const [memories, setMemories] = useState<readonly MemoryEntry[]>([])
  const [memoryLoadFailed, setMemoryLoadFailed] = useState(false)
  const [modelError, setModelError] = useState<AssistantLocaleKey | null>(null)
  const modelBusy = useRef(false)
  const mounted = useRef(true)
  const loadSequence = useRef(0)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      loadSequence.current++
    }
  }, [])
  useEffect(() => {
    setSelectedModelKey(modelRouteValue(conversation?.modelOverride))
  }, [conversation?.modelOverride?.provider, conversation?.modelOverride?.model])
  useEffect(() => {
    setProfileModelKey(modelRouteValue(profile.defaultModel))
  }, [profile.defaultModel?.provider, profile.defaultModel?.model])

  const refreshMemories = useCallback(async () => {
    if (!loadMemories) return
    const sequence = ++loadSequence.current
    try {
      const mems = await loadMemories({ kind: 'profile', profileId: profile.id }, { includeArchived: true })
      if (mounted.current && sequence === loadSequence.current) {
        setMemories(mems)
        setMemoryLoadFailed(false)
      }
    } catch (_error) {
      if (mounted.current && sequence === loadSequence.current) setMemoryLoadFailed(true)
    }
  }, [loadMemories, profile.id])

  useEffect(() => {
    if (isOpen) void refreshMemories()
  }, [isOpen, refreshMemories])

  const validSelection = (value: string) => {
    const selection = parseModelRoute(value)
    if (!selection || !availableModels.some(model => model.provider === selection.provider && model.id === selection.model)) {
      setModelError('invalidModelSelection')
      return undefined
    }
    return selection
  }

  const handleProfileModelChange = async (value: string) => {
    if (!onUpdateProfile || modelBusy.current) return
    const selection = validSelection(value)
    if (!selection) return
    modelBusy.current = true
    setModelError(null)
    try {
      await onUpdateProfile(profile.id, { defaultModel: selection })
      if (mounted.current) setProfileModelKey(value)
    } catch (_error) {
      if (mounted.current) setModelError('operationFailed')
    } finally {
      modelBusy.current = false
    }
  }

  const handleModelChange = async (value: string) => {
    if (modelBusy.current) return
    const selection = value === '' ? undefined : validSelection(value)
    if (value !== '' && !selection) return
    if ((value === '' && !onClearModelOverride) || (selection && !onSetModelOverride)) return
    modelBusy.current = true
    setModelError(null)
    try {
      if (selection) await onSetModelOverride?.(selection)
      else await onClearModelOverride?.()
      if (mounted.current) setSelectedModelKey(value)
    } catch (_error) {
      if (mounted.current) setModelError('operationFailed')
    } finally {
      modelBusy.current = false
    }
  }

  return (
    <div className={css.overlay} onClick={onClose} role="dialog" aria-modal="true">
      <div
        className={css.drawer}
        onClick={(e) => {
          e.stopPropagation()
        }}
      >
        <header className={css.header}>
          <h2 className={css.title}>{t('drawerTitle')}</h2>
          <button type="button" className={css.closeButton} onClick={onClose} aria-label={t('cancel')}>
            ✕
          </button>
        </header>

        <div className={css.content}>
          <EntityAvatar name={profile.name} avatar={profile.avatar} />
          {onUpdateProfile && (
            <AvatarPicker
              name={profile.name}
              value={profile.avatar ?? ''}
              disabled={avatarSaving}
              onChange={(value) => {
                void saveAvatar(value)
              }}
              t={t}
            />
          )}
          {modelError && <div role="alert">{t(modelError)}</div>}
          {memoryLoadFailed && <div role="alert">{t('memoriesLoadFailed')}</div>}
          <div className={css.section}>
            <span className={css.label}>{t('name')}</span>
            <p className={css.text}>{profile.name}</p>
          </div>

          {profile.responsibility && (
            <div className={css.section}>
              <span className={css.label}>{t('responsibility')}</span>
              <p className={css.text}>{profile.responsibility}</p>
            </div>
          )}

          {profile.instructions && (
            <div className={css.section}>
              <span className={css.label}>{t('instructions')}</span>
              <p className={css.text}>{profile.instructions}</p>
            </div>
          )}

          {(profile.defaultModel !== undefined || onUpdateProfile !== undefined) && (
            <div className={css.section}>
              <span className={css.label}>{t('defaultModel')}</span>
              {onUpdateProfile ? (
                <ModelSelect
                  className={css.select}
                  testId="profile-model-select"
                  options={availableModels}
                  value={profileModelKey}
                  onChange={(value) => {
                    void handleProfileModelChange(value)
                  }}
                  t={t}
                  unsetLabel={t('defaultModelUnset')}
                />
              ) : (
                profile.defaultModel && (
                  <p className={css.text}>
                    {profile.defaultModel.provider} / {profile.defaultModel.model}
                  </p>
                )
              )}
            </div>
          )}

          {conversation && onSetModelOverride && (
            <div className={css.section}>
              <span className={css.label}>{t('conversationModel')}</span>
              <ModelSelect
                className={css.select}
                options={availableModels}
                value={selectedModelKey}
                onChange={(value) => {
                  void handleModelChange(value)
                }}
                t={t}
                unsetLabel={t('inheritProfileModel')}
                keepUnset
              />
            </div>
          )}

          {loadMemories && (
            <div className={css.section}>
              <MemoryPanel
                scope={{ kind: 'profile', profileId: profile.id }}
                memories={memories}
                onSaveMemory={
                  onSaveMemory
                    ? async (text) => {
                      await onSaveMemory({ kind: 'profile', profileId: profile.id }, text)
                      await refreshMemories()
                    }
                    : undefined
                }
                onUpdateMemory={
                  onUpdateMemory
                    ? async (id, text, rev) => {
                      await onUpdateMemory(id, text, rev)
                      await refreshMemories()
                    }
                    : undefined
                }
                onRemoveMemory={
                  onRemoveMemory
                    ? async (id, rev) => {
                      await onRemoveMemory(id, rev)
                      await refreshMemories()
                    }
                    : undefined
                }
                onArchiveMemory={
                  onArchiveMemory
                    ? async (id, rev) => {
                      await onArchiveMemory(id, rev)
                      await refreshMemories()
                    }
                    : undefined
                }
                onUnarchiveMemory={
                  onUnarchiveMemory
                    ? async (id, rev) => {
                      await onUnarchiveMemory(id, rev)
                      await refreshMemories()
                    }
                    : undefined
                }
                t={t}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
