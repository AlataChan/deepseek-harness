import { useState } from 'react'
import type {
  MemoryEntry,
  MemoryEntryId,
  MemoryScope,
} from '@deepseek-ai/dsh-experimental-assistant-registry'
import type { AssistantLocaleKey } from './locales.ts'
import css from './MemoryPanel.module.css'

/** Injected properties for the assistant memory panel. */
export interface MemoryPanelProps {
  /** The target memory scope (profile or team). */
  scope: MemoryScope
  /** Current active memories. */
  memories: readonly MemoryEntry[]
  /** Callback to persist a newly recorded memory. */
  onSaveMemory?: ((text: string) => Promise<void>) | undefined
  /** Callback to edit an existing memory with expected revision for CAS validation. */
  onUpdateMemory?: ((id: MemoryEntryId, text: string, expectedRevision: number) => Promise<void>) | undefined
  /** Callback to soft-delete an existing memory with expected revision. */
  onRemoveMemory?: ((id: MemoryEntryId, expectedRevision: number) => Promise<void>) | undefined
  /** Callback to archive an existing memory with expected revision. */
  onArchiveMemory?: ((id: MemoryEntryId, expectedRevision: number) => Promise<void>) | undefined
  /** Callback to unarchive an existing memory with expected revision. */
  onUnarchiveMemory?: ((id: MemoryEntryId, expectedRevision: number) => Promise<void>) | undefined
  /** Callback to promote a team-scoped memory into the user's private profile memory. */
  onPromoteMemory?: ((id: MemoryEntryId) => Promise<void>) | undefined
  /** Localizer function for the assistants namespace. */
  t: (key: AssistantLocaleKey) => string
}

/**
 * Editable panel displaying scoped persistent memories with CAS editing and soft deletion.
 * @param props - memory entries, scope, and modification handlers.
 * @returns rendered memory panel component.
 */
export function MemoryPanel(props: MemoryPanelProps) {
  return <MemoryPanelContent key={props.scope.kind === 'profile' ? `profile:${props.scope.profileId}` : `team:${props.scope.teamId}`} {...props} />
}

function MemoryPanelContent({
  scope,
  memories,
  onSaveMemory,
  onUpdateMemory,
  onRemoveMemory,
  onArchiveMemory,
  onUnarchiveMemory,
  onPromoteMemory,
  t,
}: MemoryPanelProps) {
  const [newText, setNewText] = useState('')
  const [editingId, setEditingId] = useState<MemoryEntryId | null>(null)
  const [editText, setEditText] = useState('')
  const [editingRevision, setEditingRevision] = useState<number | null>(null)
  const [conflictId, setConflictId] = useState<MemoryEntryId | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [failed, setFailed] = useState(false)

  const activeMemories = memories.filter(memory => memory.removedAt === undefined
    && (scope.kind === 'profile'
      ? memory.scope.kind === 'profile' && memory.scope.profileId === scope.profileId
      : memory.scope.kind === 'team' && memory.scope.teamId === scope.teamId))

  const reportFailure = (error: unknown, entryId?: MemoryEntryId) => {
    if (entryId && error instanceof Error && /revision|conflict|CAS|409/i.test(error.message)) {
      setConflictId(entryId)
    } else {
      setFailed(true)
    }
  }

  const handlePromote = async (entry: MemoryEntry) => {
    if (!onPromoteMemory || isSubmitting) return
    setIsSubmitting(true)
    setFailed(false)
    try { await onPromoteMemory(entry.id) } catch (error) { reportFailure(error) }
    finally { setIsSubmitting(false) }
  }

  const handleStartEdit = (entry: MemoryEntry) => {
    setEditingId(entry.id)
    setEditingRevision(entry.revision)
    setEditText(entry.text)
    setConflictId(null)
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditingRevision(null)
    setEditText('')
    setConflictId(null)
  }

  const handleSaveEdit = async (entry: MemoryEntry) => {
    if (!onUpdateMemory || !editText.trim() || isSubmitting) return
    setIsSubmitting(true)
    setFailed(false)
    try {
      await onUpdateMemory(entry.id, editText.trim(), editingRevision ?? entry.revision)
      setEditingId(null)
      setEditText('')
      setConflictId(null)
    } catch (error) {
      reportFailure(error, entry.id)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRemove = async (entry: MemoryEntry) => {
    if (!onRemoveMemory || isSubmitting) return
    setIsSubmitting(true)
    setFailed(false)
    try {
      await onRemoveMemory(entry.id, entry.revision)
      setConflictId(null)
    } catch (error) {
      reportFailure(error, entry.id)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleArchive = async (entry: MemoryEntry) => {
    if (!onArchiveMemory || isSubmitting) return
    setIsSubmitting(true)
    setFailed(false)
    try {
      await onArchiveMemory(entry.id, entry.revision)
    } catch (error) {
      reportFailure(error, entry.id)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleUnarchive = async (entry: MemoryEntry) => {
    if (!onUnarchiveMemory || isSubmitting) return
    setIsSubmitting(true)
    setFailed(false)
    try {
      await onUnarchiveMemory(entry.id, entry.revision)
    } catch (error) {
      reportFailure(error, entry.id)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleAddMemory = async () => {
    if (!onSaveMemory || !newText.trim() || isSubmitting) return
    setIsSubmitting(true)
    setFailed(false)
    try {
      await onSaveMemory(newText.trim())
      setNewText('')
    } catch (error) {
      reportFailure(error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const scopeLabel = scope.kind === 'profile'
    ? t('memoryScopeProfile')
    : t('memoryScopeTeam')

  return (
    <div className={css.panel} data-testid="memory-panel">
      <div className={css.header}>
        <h3 className={css.title}>{t('memoryTitle')}</h3>
        <span className={css.badge}>{scopeLabel}</span>
      </div>

      {failed && <div role="alert">{t('operationFailed')}</div>}

      <p className={css.retentionNotice}>{t('memoryRetentionNotice')}</p>

      {activeMemories.length === 0 ? (
        <div className={css.empty}>{t('emptyMemory')}</div>
      ) : (
        <ul className={css.list}>
          {activeMemories.map((entry) => {
            const isEditing = editingId === entry.id
            const hasConflict = conflictId === entry.id

            return (
              <li key={entry.id} className={css.item} data-testid={`memory-item-${entry.id}`}>
                {isEditing ? (
                  <>
                    <textarea
                      className={css.editTextarea}
                      value={editText}
                      onChange={(e) =>{  setEditText(e.target.value) }}
                      disabled={isSubmitting}
                      aria-label={t('editMemory')}
                    />
                    {hasConflict && (
                      <div className={css.conflictNotice}>{t('memoryRevisionConflict')}</div>
                    )}
                    <div className={css.itemActions}>
                      <button
                        type="button"
                        className={`${css.button} ${css.buttonPrimary}`}
                        onClick={() => handleSaveEdit(entry)}
                        disabled={isSubmitting || !editText.trim()}
                      >
                        {t('save')}
                      </button>
                      <button
                        type="button"
                        className={css.button}
                        onClick={handleCancelEdit}
                        disabled={isSubmitting}
                      >
                        {t('cancel')}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className={css.itemText}>{entry.text}</div>
                    <div className={css.itemMeta}>
                      <span>{t('memoryRevisionLabel')}: {entry.revision}</span>
                      {entry.author && <span>{t('memoryAuthorLabel')}: {entry.author}</span>}
                    </div>
                    {hasConflict && (
                      <div className={css.conflictNotice}>{t('memoryRevisionConflict')}</div>
                    )}
                    <div className={css.itemActions}>
                      {onUpdateMemory && (
                        <button
                          type="button"
                          className={css.button}
                          onClick={() =>{  handleStartEdit(entry) }}
                          disabled={isSubmitting}
                        >
                          {t('editMemory')}
                        </button>
                      )}
                      {onRemoveMemory && (
                        <button
                          type="button"
                          className={`${css.button} ${css.buttonDanger}`}
                          onClick={() => handleRemove(entry)}
                          disabled={isSubmitting}
                        >
                          {t('deleteMemory')}
                        </button>
                      )}
                      {entry.archivedAt === undefined ? (
                        onArchiveMemory && (
                          <button
                            type="button"
                            className={css.button}
                            onClick={() => handleArchive(entry)}
                            disabled={isSubmitting}
                            data-testid={`archive-memory-${entry.id}`}
                          >
                            {t('archiveMemory')}
                          </button>
                        )
                      ) : (
                        onUnarchiveMemory && (
                          <button
                            type="button"
                            className={css.button}
                            onClick={() => handleUnarchive(entry)}
                            disabled={isSubmitting}
                            data-testid={`unarchive-memory-${entry.id}`}
                          >
                            {t('unarchiveMemory')}
                          </button>
                        )
                      )}
                      {scope.kind === 'team' && onPromoteMemory && (
                        <button
                          type="button"
                          className={css.button}
                          onClick={() => { void handlePromote(entry) }}
                          disabled={isSubmitting}
                        >
                          {t('promoteMemory')}
                        </button>
                      )}
                    </div>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {onSaveMemory && (
        <div className={css.addForm}>
          <input
            type="text"
            className={css.addInput}
            value={newText}
            placeholder={t('memoryPlaceholder')}
            onChange={(e) =>{  setNewText(e.target.value) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleAddMemory()
              }
            }}
            disabled={isSubmitting}
            aria-label={t('memoryPlaceholder')}
          />
          <button
            type="button"
            className={`${css.button} ${css.buttonPrimary}`}
            onClick={handleAddMemory}
            disabled={isSubmitting || !newText.trim()}
          >
            {t('addMemory')}
          </button>
        </div>
      )}
    </div>
  )
}
