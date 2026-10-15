import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AssistantProfile,
  AssistantProfileId,
  ListMemoryOptions,
  MemoryEntry,
  MemoryEntryId,
  MemoryScope,
  TeamDefinition,
  TeamSeat,
  TeamSeatId,
} from '@deepseek-ai/dsh-experimental-assistant-registry'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { AssistantModelOption } from './models.ts'
import { NS } from './locales.ts'
import { TeamEditorModal, type SaveTeamUpdatesPayload, type TeamSeatUpdatePatch } from './TeamEditorModal.tsx'
import { MemoryPanel } from './MemoryPanel.tsx'
import { StandingTeamDock, StandingTeamActivity, type StandingTeamDockProps } from './StandingTeamDock.tsx'
import { EntityAvatar } from './EntityAvatar.tsx'
import { TeamDiscussion, type TeamDiscussionOps } from './TeamDiscussion.tsx'
import css from './TeamView.module.css'

export type TeamViewTab = 'discussion' | 'tasks' | 'deliverables' | 'memory'

export interface TeamViewProps extends PropsLocale<typeof NS> {
  team: TeamDefinition
  seats: readonly TeamSeat[]
  profiles: readonly AssistantProfile[]
  models?: readonly AssistantModelOption[] | undefined
  activeTab?: TeamViewTab | undefined
  onTabChange?: ((tab: TeamViewTab) => void) | undefined
  onSaveTeam?: ((updates: SaveTeamUpdatesPayload) => Promise<void> | void) | undefined
  onUpdateSeat?: ((seatId: TeamSeatId, patch: TeamSeatUpdatePatch) => Promise<void> | void) | undefined
  onOpenDock?: (() => void) | undefined
  loadLiveView?: StandingTeamDockProps['loadLiveView']
  discussionOps?: TeamDiscussionOps | undefined
  onTeamChanged?: (() => Promise<void>) | undefined
  onViewActivityLog?: ((seat: TeamSeat) => void) | undefined
  onOpenPrivateChat?: ((profileId: AssistantProfileId) => void) | undefined
  loadMemories?: ((scope: MemoryScope, options?: ListMemoryOptions) => Promise<readonly MemoryEntry[]>) | undefined
  onSaveMemory?: ((scope: MemoryScope, text: string) => Promise<void>) | undefined
  onUpdateMemory?: ((id: MemoryEntryId, text: string, expectedRevision: number) => Promise<void>) | undefined
  onRemoveMemory?: ((id: MemoryEntryId, expectedRevision: number) => Promise<void>) | undefined
  onArchiveMemory?: ((id: MemoryEntryId, expectedRevision: number) => Promise<void>) | undefined
  onUnarchiveMemory?: ((id: MemoryEntryId, expectedRevision: number) => Promise<void>) | undefined
  onPromoteMemory?: ((id: MemoryEntryId) => Promise<void>) | undefined
}

export function TeamView({
  t,
  team,
  seats,
  profiles,
  models = [],
  activeTab: controlledTab,
  onTabChange,
  onSaveTeam,
  onUpdateSeat,
  onOpenDock,
  loadLiveView,
  discussionOps,
  onTeamChanged,
  onViewActivityLog,
  onOpenPrivateChat,
  loadMemories,
  onSaveMemory,
  onUpdateMemory,
  onRemoveMemory,
  onArchiveMemory,
  onUnarchiveMemory,
  onPromoteMemory,
}: TeamViewProps) {
  const [internalTab, setInternalTab] = useState<TeamViewTab>('discussion')
  const [showEditor, setShowEditor] = useState(false)
  const [dockOpen, setDockOpen] = useState(false)
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null)
  const [memories, setMemories] = useState<readonly MemoryEntry[]>([])
  const [memoriesFailed, setMemoriesFailed] = useState(false)
  const memoryGeneration = useRef(0)

  const refreshMemories = useCallback(async () => {
    const generation = ++memoryGeneration.current
    setMemoriesFailed(false)
    if (!loadMemories) return
    try {
      const mems = await loadMemories({ kind: 'team', teamId: team.id }, { includeArchived: true })
      if (generation === memoryGeneration.current) setMemories(mems)
    } catch (error) {
      if (generation === memoryGeneration.current) setMemoriesFailed(true)
      throw error
    }
  }, [loadMemories, team.id])

  useEffect(() => {
    setMemories([])
    void refreshMemories().catch(() => {})
    return () => { memoryGeneration.current++ }
  }, [refreshMemories])

  if (!team) return null

  const activeTab = controlledTab ?? internalTab

  const handleTabClick = (tab: TeamViewTab) => {
    setInternalTab(tab)
    onTabChange?.(tab)
  }

  const coordinator = profiles ? profiles.find(p => p.id === team.coordinatorProfileId) : undefined

  return (
    <div className={css.container}>
      {/* Header */}
      <div className={css.header}>
        <div className={css.headerLeft}>
          <EntityAvatar name={team.name} avatar={team.avatar} small />
          <h2 className={css.teamName} data-testid="team-name">{team.name}</h2>
          <span
            className={css.coordinatorBadge}
            data-testid="coordinator-first-badge"
            title={coordinator ? `${t('coordinator')}: ${coordinator.name}` : undefined}
          >
            {t('coordinatorFirstBadge')}
          </span>
        </div>

        <div className={css.headerActions}>
          <button
            type="button"
            data-testid="open-dock-button"
            className={css.actionButton}
            onClick={() => { setDockOpen(true); onOpenDock?.() }}
          >
            {t('openDock')}
          </button>
          <button
            type="button"
            data-testid="edit-team-button"
            className={css.actionButton}
            onClick={() =>{  setShowEditor(true) }}
          >
            {t('editTeam')}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className={css.tabsBar} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'discussion'}
          data-testid="tab-discussion"
          className={`${css.tabItem} ${activeTab === 'discussion' ? css.tabItemActive : ''}`}
          onClick={() =>{  handleTabClick('discussion') }}
        >
          {t('tabDiscussion')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'tasks'}
          data-testid="tab-tasks"
          className={`${css.tabItem} ${activeTab === 'tasks' ? css.tabItemActive : ''}`}
          onClick={() =>{  handleTabClick('tasks') }}
        >
          {t('tabTasks')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'deliverables'}
          data-testid="tab-deliverables"
          className={`${css.tabItem} ${activeTab === 'deliverables' ? css.tabItemActive : ''}`}
          onClick={() =>{  handleTabClick('deliverables') }}
        >
          {t('tabDeliverables')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'memory'}
          data-testid="tab-memory"
          className={`${css.tabItem} ${activeTab === 'memory' ? css.tabItemActive : ''}`}
          onClick={() => { handleTabClick('memory') }}
        >
          {t('tabMemory')}
        </button>
      </div>

      {/* Main Content Area */}
      <div className={css.contentArea}>
        {/* Tab specific pane */}
        <div data-testid={`tab-content-${activeTab}`}>
          {activeTab === 'discussion' && (
            <div data-testid="discussion-pane" style={{ padding: 12, color: 'var(--dsw-alias-label-secondary)' }}>
              <TeamDiscussion team={team} operations={discussionOps} onProvisioned={onTeamChanged} t={t} />
            </div>
          )}
          {activeTab === 'tasks' && (
            <div data-testid="tasks-pane" style={{ padding: 12, color: 'var(--dsw-alias-label-secondary)' }}>
              <StandingTeamActivity team={team} loadLiveView={loadLiveView} kind="tasks" t={t} />
            </div>
          )}
          {activeTab === 'deliverables' && (
            <div data-testid="deliverables-pane" style={{ padding: 12, color: 'var(--dsw-alias-label-secondary)' }}>
              <StandingTeamActivity team={team} loadLiveView={loadLiveView} kind="deliverables" t={t} />
            </div>
          )}
          {activeTab === 'memory' && (
            <div data-testid="memory-pane" style={{ padding: 12 }}>
              {memoriesFailed && <p role="alert">{t('memoriesLoadFailed')}</p>}
              <MemoryPanel
                scope={{ kind: 'team', teamId: team.id }}
                memories={memories}
                onSaveMemory={onSaveMemory ? async (text) => {
                  await onSaveMemory({ kind: 'team', teamId: team.id }, text)
                  await refreshMemories()
                } : undefined}
                onUpdateMemory={onUpdateMemory ? async (id, text, rev) => {
                  await onUpdateMemory(id, text, rev)
                  await refreshMemories()
                } : undefined}
                onRemoveMemory={onRemoveMemory ? async (id, rev) => {
                  await onRemoveMemory(id, rev)
                  await refreshMemories()
                } : undefined}
                onArchiveMemory={onArchiveMemory ? async (id, rev) => {
                  await onArchiveMemory(id, rev)
                  await refreshMemories()
                } : undefined}
                onUnarchiveMemory={onUnarchiveMemory ? async (id, rev) => {
                  await onUnarchiveMemory(id, rev)
                  await refreshMemories()
                } : undefined}
                onPromoteMemory={onPromoteMemory ? async (id) => {
                  await onPromoteMemory(id)
                  await refreshMemories()
                } : undefined}
                t={t}
              />
            </div>
          )}
        </div>

        {/* Team Seats / Roster Section */}
        <div className={css.seatsSection}>
          <h4 className={css.sectionTitle}>{t('seats')}</h4>
          <div className={css.seatsGrid}>
            {seats.map((seat) => {
              const isSelected = selectedSeatId === seat.id
              const isRetired = seat.retiredAt !== undefined
              const boundProfile = profiles.find(p => p.id === seat.profileId)

              return (
                <div
                  key={seat.id}
                  data-testid={`seat-card-${seat.name}`}
                  className={`${css.seatCard} ${isSelected ? css.seatCardSelected : ''}`}
                  onClick={() =>{  setSelectedSeatId(isSelected ? null : seat.id) }}
                >
                  <div className={css.seatHeader}>
                    <EntityAvatar name={boundProfile?.name ?? seat.title ?? seat.name} avatar={boundProfile?.avatar} small />
                    <span className={css.seatTitle}>{seat.title ?? seat.name}</span>
                    <span className={css.seatName}>{seat.name}</span>
                  </div>

                  <div className={css.seatDuty}>{seat.duty}</div>

                  <div className={css.seatFooter}>
                    <span>{seat.modelOverride?.model ?? (boundProfile?.defaultModel?.model ? `${boundProfile.defaultModel.model} (${t('inheritProfileModel')})` : t('inheritProfileModel'))}</span>
                    <span className={isRetired ? css.statusRetired : css.statusActive}>
                      {isRetired ? t('statusRetired') : seat.activeInstanceId ? t('dockReady') : t('dockUnprovisioned')}
                    </span>
                  </div>

                  {/* Actions for member */}
                  <div className={css.seatActions} onClick={(e) =>{  e.stopPropagation() }}>
                    {onViewActivityLog && (
                      <button
                        type="button"
                        data-testid="view-activity-log"
                        className={css.seatActionButton}
                        onClick={() =>{  onViewActivityLog(seat) }}
                      >
                        {t('viewActivityLog')}
                      </button>
                    )}
                    {onOpenPrivateChat && (
                      <button
                        type="button"
                        data-testid="open-private-chat"
                        className={css.seatActionButton}
                        onClick={() =>{  onOpenPrivateChat(seat.profileId) }}
                      >
                        {t('openPrivateChat')}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <StandingTeamDock open={dockOpen} team={team} seats={seats} profiles={profiles} t={t}
        onClose={() => { setDockOpen(false) }} onViewActivityLog={onViewActivityLog} loadLiveView={loadLiveView} />

      {/* Editor Modal */}
      {showEditor && onSaveTeam && (
        <TeamEditorModal
          t={t}
          isOpen={showEditor}
          team={team}
          seats={seats}
          profiles={profiles}
          models={models}
          onClose={() =>{  setShowEditor(false) }}
          onSave={onSaveTeam}
          onUpdateSeat={onUpdateSeat}
        />
      )}
    </div>
  )
}
