import { AvatarPicker, EntityAvatar, DEFAULT_AVATAR } from './EntityAvatar.tsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AssistantProfile,
  AssistantProfileId,
  ListMemoryOptions,
  MemoryEntry,
  MemoryEntryId,
  MemoryScope,
  TeamDefinition,
  TeamDefinitionId,
  TeamSeat,
  TeamSeatId,
  UpdateAssistantProfileOptions,
} from '@deepseek-ai/dsh-experimental-assistant-registry'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AssistantModelOption } from './models.ts'
import { NS } from './locales.ts'
import { AssistantDetailDrawer } from './AssistantDetailDrawer.tsx'
import { TeamCreationModal, type CreateTeamPayload } from './TeamCreationModal.tsx'
import { TeamView } from './TeamView.tsx'
import type { SaveTeamUpdatesPayload, TeamSeatUpdatePatch } from './TeamEditorModal.tsx'
import css from './AssistantDirectory.module.css'

/** Injected operations for Assistant Directory. */
export interface AssistantDirectoryInjected {
  loadProfiles: () => Promise<readonly AssistantProfile[]>
  loadTeams: () => Promise<readonly TeamDefinition[]>
  loadSeats: (teamId: TeamDefinitionId) => Promise<readonly TeamSeat[]>
  loadModels: () => Promise<readonly AssistantModelOption[]>
  onCreateProfile: (data: { name: string; responsibility?: string; instructions?: string; avatar?: string }) => Promise<void>
  onStartChat: (profileId: AssistantProfileId) => Promise<void>
  onArchiveProfile: (profileId: AssistantProfileId) => Promise<void>
  onUpdateProfile: (id: AssistantProfileId, options: UpdateAssistantProfileOptions) => Promise<AssistantProfile | undefined>
  onCreateTeam?: ((payload: CreateTeamPayload) => Promise<void> | void) | undefined
  onSaveTeam?: ((teamId: TeamDefinitionId, expectedRevision: number, updates: SaveTeamUpdatesPayload) => Promise<void> | void) | undefined
  onUpdateSeat?: ((seatId: TeamSeatId, patch: TeamSeatUpdatePatch) => Promise<void> | void) | undefined
  loadLiveView?: ((teamId: TeamDefinitionId) => Promise<import('./StandingTeamDock.tsx').StandingTeamLiveView | undefined>) | undefined
  discussionOps?: import('./TeamDiscussion.tsx').TeamDiscussionOps | undefined
  onOpenDock?: (() => void) | undefined
  onViewActivityLog?: ((seat: TeamSeat, leadSessionId?: TeamDefinition['leadSessionId']) => void) | undefined
  loadMemories?: ((scope: MemoryScope, options?: ListMemoryOptions) => Promise<readonly MemoryEntry[]>) | undefined
  onSaveMemory?: ((scope: MemoryScope, text: string) => Promise<void>) | undefined
  onUpdateMemory?: ((id: MemoryEntryId, text: string, expectedRevision: number) => Promise<void>) | undefined
  onRemoveMemory?: ((id: MemoryEntryId, expectedRevision: number) => Promise<void>) | undefined
  onArchiveMemory?: ((id: MemoryEntryId, expectedRevision: number) => Promise<void>) | undefined
  onUnarchiveMemory?: ((id: MemoryEntryId, expectedRevision: number) => Promise<void>) | undefined
  onPromoteMemory?: ((id: MemoryEntryId, targetProfileId: AssistantProfileId) => Promise<void>) | undefined
}

/** Component props for Assistant Directory. */
export type AssistantDirectoryProps =
  PropsRuntime<'main'>
  & AssistantDirectoryInjected
  & PropsLocale<typeof NS>

/**
 * Assistant Directory main panel component. The directory owns its fetched
 * profiles, teams, seats, and model catalog; every mutation refetches through
 * the same state so the mounted panel re-renders without remounting.
 * @param props - injected loaders/operations and localization.
 * @returns rendered assistant directory panel.
 */
export function AssistantDirectory({
  t,
  loadProfiles,
  loadTeams,
  loadSeats,
  loadModels,
  onCreateProfile,
  onStartChat,
  onArchiveProfile,
  onUpdateProfile,
  onCreateTeam,
  onSaveTeam,
  onUpdateSeat,
  loadLiveView,
  discussionOps,
  onOpenDock,
  onViewActivityLog,
  loadMemories,
  onSaveMemory,
  onUpdateMemory,
  onRemoveMemory,
  onArchiveMemory,
  onUnarchiveMemory,
  onPromoteMemory,
}: AssistantDirectoryProps) {
  const [profiles, setProfiles] = useState<readonly AssistantProfile[]>([])
  const [teams, setTeams] = useState<readonly TeamDefinition[]>([])
  const [seatsByTeam, setSeatsByTeam] = useState<ReadonlyMap<TeamDefinitionId, readonly TeamSeat[]>>(new Map())
  const [models, setModels] = useState<readonly AssistantModelOption[]>([])
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [showTeamModal, setShowTeamModal] = useState(false)
  const [selectedTeamId, setSelectedTeamId] = useState<TeamDefinitionId | null>(null)
  const [detailProfileId, setDetailProfileId] = useState<AssistantProfileId | null>(null)
  const [avatar, setAvatar] = useState(DEFAULT_AVATAR)
  const [name, setName] = useState('')
  const [responsibility, setResponsibility] = useState('')
  const [instructions, setInstructions] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [profilesLoading, setProfilesLoading] = useState(true)
  const [profilesError, setProfilesError] = useState('')
  const [teamsError, setTeamsError] = useState('')
  const [modelsError, setModelsError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [actionFailed, setActionFailed] = useState(false)
  const pendingActions = useRef(new Set<string>())
  const runAction = async (key: string, action: () => Promise<void>) => {
    if (pendingActions.current.has(key)) return
    pendingActions.current.add(key)
    setActionFailed(false)
    try { await action() } catch { setActionFailed(true) }
    finally { pendingActions.current.delete(key) }
  }
  const refreshGeneration = useRef(0)

  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current
    setProfilesLoading(true)
    setProfilesError('')
    setTeamsError('')
    const readTeams = async () => {
      try {
        const nextTeams = await loadTeams()
        const seatLists = await Promise.allSettled(nextTeams.map(team => loadSeats(team.id)))
        if (generation !== refreshGeneration.current) return
        setTeams(nextTeams)
        setSeatsByTeam(new Map(nextTeams.map((team, index) => { const result = seatLists[index]; return [team.id, result?.status === 'fulfilled' ? result.value : []] })))
        if (seatLists.some(result => result.status === 'rejected')) setTeamsError('seats')
      } catch (error) {
        if (generation === refreshGeneration.current) setTeamsError(String(error instanceof Error ? error.message : error))
      }
    }
    const teamsRequest = readTeams()
    try {
      const nextProfiles = await loadProfiles()
      if (generation === refreshGeneration.current) setProfiles(nextProfiles)
    } catch (error) {
      if (generation === refreshGeneration.current) setProfilesError(String(error instanceof Error ? error.message : error))
    } finally {
      if (generation === refreshGeneration.current) setProfilesLoading(false)
      await teamsRequest
    }
  }, [loadProfiles, loadSeats, loadTeams])

  useEffect(() => {
    void refresh()
    return () => { refreshGeneration.current++ }
  }, [refresh])

  useEffect(() => {
    let active = true
    setModelsError('')
    void (async () => {
      try {
        const nextModels = await loadModels()
        if (active) setModels(nextModels)
      } catch (error) {
        if (active) setModelsError(String(error instanceof Error ? error.message : error))
      }
    })()
    return () => { active = false }
  }, [loadModels])

  const handleCreate = async () => {
    if (!name.trim() || submitting) return
    setSubmitting(true)
    setSaveError('')
    try {
      await onCreateProfile({
        name: name.trim(),
        ...avatar !== DEFAULT_AVATAR ? { avatar } : {},
        ...responsibility.trim() ? { responsibility: responsibility.trim() } : {},
        ...instructions.trim() ? { instructions: instructions.trim() } : {},
      })
      setAvatar(DEFAULT_AVATAR)
      setName('')
      setResponsibility('')
      setInstructions('')
      setShowCreateForm(false)
      await refresh()
    } catch (error) {
      setSaveError(String(error instanceof Error ? error.message : error))
    } finally {
      setSubmitting(false)
    }
  }

  const activeProfiles = profiles.filter(p => !p.archivedAt)
  const selectedTeam = teams.find(t => t.id === selectedTeamId)
  const detailProfile = profiles.find(p => p.id === detailProfileId)

  const handleUpdateProfile = async (id: AssistantProfileId, options: UpdateAssistantProfileOptions) => {
    await onUpdateProfile(id, options)
    await refresh()
  }

  const handleArchive = async (profileId: AssistantProfileId) => {
    await onArchiveProfile(profileId)
    await refresh()
  }

  return (
    <div className={css.container}>
      <header className={css.header}>
        <div className={css.titleGroup}>
          <h1 className={css.title}>{t('panel')}</h1>
          <p className={css.hint}>{t('panelHint')}</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {onCreateTeam && (
            <button
              type="button"
              className={css.secondaryButton}
              onClick={() => { setShowTeamModal(true) }}
            >
              {t('newTeam')}
            </button>
          )}
          <button
            type="button"
            className={css.primaryButton}
            onClick={() => { setShowCreateForm(prev => !prev) }}
          >
            {t('newAssistant')}
          </button>
        </div>
      </header>

      {profilesError && <p role="alert">{t('profilesLoadFailed')}: {profilesError}</p>}
      {teamsError && <p role="alert">{t('teamsLoadFailed')}: {teamsError}</p>}
      {modelsError && <p role="alert">{t('modelsLoadFailed')}: {modelsError}</p>}
      {actionFailed && <p role="alert">{t('operationFailed')}</p>}
      {saveError && <p role="alert">{t('saveFailed')}: {saveError}</p>}

      {showCreateForm && (
        <form
          className={css.formCard}
          onSubmit={(e) => {
            e.preventDefault()
            void handleCreate()
          }}
        >
          <div className={css.inputField}>
            <label htmlFor="asst-name">{t('name')}</label>
            <input
              id="asst-name"
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value) }}
              required
            />
          </div>
          <AvatarPicker name={name} value={avatar} onChange={setAvatar} disabled={submitting} t={t} />
          <div className={css.inputField}>
            <label htmlFor="asst-resp">{t('responsibility')}</label>
            <input
              id="asst-resp"
              type="text"
              value={responsibility}
              onChange={(e) => { setResponsibility(e.target.value) }}
            />
          </div>
          <div className={css.inputField}>
            <label htmlFor="asst-inst">{t('instructions')}</label>
            <textarea
              id="asst-inst"
              rows={3}
              value={instructions}
              onChange={(e) => { setInstructions(e.target.value) }}
            />
          </div>
          <div className={css.formActions}>
            <button
              type="button"
              className={css.secondaryButton}
              onClick={() => { setShowCreateForm(false) }}
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              className={css.primaryButton}
              disabled={submitting || !name.trim()}
            >
              {t('save')}
            </button>
          </div>
        </form>
      )}

      {activeProfiles.length === 0 && profilesLoading ? <p>{t('loadingProfiles')}</p> : activeProfiles.length === 0 && !profilesError ? (
        <div className={css.emptyState}>{t('empty')}</div>
      ) : (
        <div className={css.grid}>
          {activeProfiles.map(profile => (
            <article key={profile.id} className={css.card}>
              <div className={css.cardHeader}>
                <EntityAvatar name={profile.name} avatar={profile.avatar} />
                <div className={css.cardMeta}>
                  <span className={css.cardName}>{profile.name}</span>
                  {profile.responsibility && (
                    <span className={css.cardBadge}>{profile.responsibility}</span>
                  )}
                </div>
              </div>

              {profile.instructions && (
                <p className={css.cardInstructions}>{profile.instructions}</p>
              )}

              <footer className={css.cardActions}>
                <button
                  type="button"
                  className={css.primaryButton}
                  onClick={() => { void runAction(`chat:${profile.id}`, () => onStartChat(profile.id)) }}
                >
                  {t('startChat')}
                </button>
                <div className={css.cardActionsRight}>
                  <button
                    type="button"
                    className={css.secondaryButton}
                    onClick={() => { setDetailProfileId(profile.id) }}
                  >
                    {t('details')}
                  </button>
                  <button
                    type="button"
                    className={css.secondaryButton}
                    onClick={() => { void runAction(`archive:${profile.id}`, () => handleArchive(profile.id)) }}
                  >
                    {t('archiveAssistant')}
                  </button>
                </div>
              </footer>
            </article>
          ))}
        </div>
      )}

      {selectedTeam && (
        <div style={{ marginTop: '24px' }}>
          <button
            type="button"
            className={css.secondaryButton}
            onClick={() => { setSelectedTeamId(null) }}
            style={{ marginBottom: '12px' }}
          >
            {t('cancel')}
          </button>
          <TeamView
            t={t}
            team={selectedTeam}
            seats={seatsByTeam.get(selectedTeam.id) ?? []}
            profiles={profiles}
            models={models}
            onSaveTeam={async (updates) => { await onSaveTeam?.(selectedTeam.id, selectedTeam.revision, updates); await refresh() }}
            onUpdateSeat={onUpdateSeat}
            discussionOps={discussionOps}
            onTeamChanged={refresh}
            onOpenDock={onOpenDock}
            onViewActivityLog={seat => onViewActivityLog?.(seat, selectedTeam.leadSessionId)}
            loadLiveView={loadLiveView ? () => loadLiveView(selectedTeam.id) : undefined}
            onOpenPrivateChat={(profileId) => { void runAction(`chat:${profileId}`, () => onStartChat(profileId)) }}
            loadMemories={loadMemories}
            onSaveMemory={onSaveMemory}
            onUpdateMemory={onUpdateMemory}
            onRemoveMemory={onRemoveMemory}
            onArchiveMemory={onArchiveMemory}
            onUnarchiveMemory={onUnarchiveMemory}
            onPromoteMemory={onPromoteMemory ? id => onPromoteMemory(id, selectedTeam.coordinatorProfileId) : undefined}
          />
        </div>
      )}

      {teams.length > 0 && !selectedTeamId && (
        <div style={{ marginTop: '24px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 500, marginBottom: '12px' }}>{t('teamTemplates')}</h2>
          <div className={css.grid}>
            {teams.filter(team => !team.archivedAt).map(team => (
              <article key={team.id} className={css.card}>
                <div className={css.cardHeader}>
                  <EntityAvatar name={team.name} avatar={team.avatar} />
                  <div className={css.cardMeta}>
                    <span className={css.cardName}>{team.name}</span>
                    {team.description && <span className={css.cardBadge}>{team.description}</span>}
                  </div>
                </div>
                <footer className={css.cardActions}>
                  <button
                    type="button"
                    className={css.primaryButton}
                    onClick={() => { setSelectedTeamId(team.id) }}
                  >
                    {t('details')}
                  </button>
                </footer>
              </article>
            ))}
          </div>
        </div>
      )}

      {onCreateTeam && showTeamModal && (
        <TeamCreationModal
          t={t}
          isOpen={showTeamModal}
          profiles={profiles}
          onClose={() => { setShowTeamModal(false) }}
          onCreateTeam={async (payload) => {
            await onCreateTeam(payload)
            setShowTeamModal(false)
            await refresh()
          }}
        />
      )}

      {detailProfile && (
        <AssistantDetailDrawer
          key={detailProfile.id}
          isOpen={detailProfileId !== null}
          onClose={() => { setDetailProfileId(null) }}
          profile={detailProfile}
          availableModels={models}
          onUpdateProfile={handleUpdateProfile}
          loadMemories={loadMemories}
          onSaveMemory={onSaveMemory}
          onUpdateMemory={onUpdateMemory}
          onRemoveMemory={onRemoveMemory}
          onArchiveMemory={onArchiveMemory}
          onUnarchiveMemory={onUnarchiveMemory}
          t={t}
        />
      )}
    </div>
  )
}
