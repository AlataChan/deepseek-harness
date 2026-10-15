/** Saved standing-team roster and existing collaboration observations. */
import { useEffect, useState } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TeamActionInjected } from '@deepseek-ai/dsh-experimental-client-ui-agent-team/client'
import type { AssistantProfile, TeamDefinition, TeamSeat } from '@deepseek-ai/dsh-experimental-assistant-registry/types'
import type { AssistantLocaleKey } from './locales.ts'
import { EntityAvatar } from './EntityAvatar.tsx'
import css from './StandingTeamDock.module.css'

/** Read-only Agent Team projection already provided by the collaboration plugin. */
export type StandingTeamLiveView = Extract<Awaited<ReturnType<TeamActionInjected['load']>>, { ok: true }>['value']

/** Saved roster and optional observation actions; no execution or provisioning capability. */
export interface StandingTeamDockProps {
  readonly open: boolean
  readonly team: TeamDefinition
  readonly seats: readonly TeamSeat[]
  readonly profiles: readonly AssistantProfile[]
  readonly onClose: () => void
  readonly onViewActivityLog?: ((seat: TeamSeat) => void) | undefined
  readonly loadLiveView?: ((sessionId: SessionId) => Promise<StandingTeamLiveView | undefined>) | undefined
  readonly t: (key: AssistantLocaleKey) => string
}

function useStandingActivity(active: boolean, team: TeamDefinition, loadLiveView: StandingTeamDockProps['loadLiveView']) {
  const [view, setView] = useState<StandingTeamLiveView | undefined>()
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setView(undefined)
    setFailed(false)
    if (!active || !team.leadSessionId || !loadLiveView) {
      setLoading(false)
      return
    }
    let alive = true
    let pending = false
    const sessionId = team.leadSessionId
    const refresh = async () => {
      if (pending) return
      pending = true
      try {
        const next = await loadLiveView(sessionId)
        if (alive) {
          setView(next)
          setFailed(false)
        }
      } catch {
        if (alive) setFailed(true)
      } finally {
        pending = false
        if (alive) setLoading(false)
      }
    }
    setLoading(true)
    void refresh()
    const timer = window.setInterval(() => {
      void refresh()
    }, 1500)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [active, team.id, team.leadSessionId, loadLiveView])

  return { view, failed, loading }
}

/**
 * Display saved members immediately and observe an existing coordinator only while open.
 * @param props - saved team roster, localized copy and optional read-only loader.
 * @returns a shared modal that never provisions seats or submits prompts.
 */
export function StandingTeamDock({ open, team, seats, profiles, onClose, onViewActivityLog, loadLiveView, t }: StandingTeamDockProps) {
  const { view, failed, loading } = useStandingActivity(open, team, loadLiveView)

  const members = seats.filter(seat => seat.retiredAt === undefined)
  const coordinatorProfile = profiles.find(profile => profile.id === team.coordinatorProfileId)
  const showCoordinatorProfile = !members.some(seat => seat.role === 'coordinator') && coordinatorProfile !== undefined
  const membersBySession = new Map(view?.members.map(member => [member.id, member]))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${t('dockTitle')} · ${team.name}`}
      closeLabel={t('dockClose')}
      description={t('dockStandingHint')}
      className={css.dialog ?? ''}
      contentClassName={css.content ?? ''}
    >
      <section className={css.body} data-testid="standing-team-dock">
        <p className={css.hint}>{t('dockReadOnlyHint')}</p>
        {failed && (
          <p role="alert" className={css.hint}>
            {t('dockLoadFailed')}
          </p>
        )}
        {members.length === 0 && !showCoordinatorProfile && <p className={css.hint}>{t('dockNoMembers')}</p>}
        <ul className={css.roster}>
          {showCoordinatorProfile && coordinatorProfile && (
            <li className={css.member} data-testid="standing-coordinator-profile">
              <div className={css.memberHeading}>
                <EntityAvatar name={coordinatorProfile.name} avatar={coordinatorProfile.avatar} small />
                <strong>{coordinatorProfile.name}</strong>
                <span className={css.badge}>{t('coordinator')}</span>
              </div>
              <p className={css.duty}>{coordinatorProfile.responsibility}</p>
              <div className={css.memberMeta}>
                <span>{team.leadSessionId ? t('dockReady') : t('dockUnprovisioned')}</span>
                <span>
                  {coordinatorProfile.defaultModel
                    ? `${coordinatorProfile.defaultModel.provider} / ${coordinatorProfile.defaultModel.model}`
                    : t('inheritProfileModel')}
                </span>
              </div>
            </li>
          )}
          {members.map((seat) => {
            const profile = profiles.find(candidate => candidate.id === seat.profileId)
            const sessionId = seat.activeInstanceId ?? (seat.role === 'coordinator' ? team.leadSessionId : undefined)
            const live = sessionId ? membersBySession.get(sessionId) : undefined
            const route = seat.modelOverride ?? profile?.defaultModel
            return (
              <li key={seat.id} className={css.member} data-testid={`standing-member-${seat.id}`}>
                <div className={css.memberHeading}>
                  <EntityAvatar name={profile?.name ?? seat.title ?? seat.name} avatar={profile?.avatar} small />
                  <strong>{profile?.name ?? seat.title ?? seat.name}</strong>
                  <span className={css.badge}>{seat.role === 'coordinator' ? t('coordinator') : seat.name}</span>
                </div>
                <p className={css.duty}>{seat.duty}</p>
                <div className={css.memberMeta}>
                  <span>{live?.status === 'running' ? t('statusActive') : sessionId ? t('dockReady') : t('dockUnprovisioned')}</span>
                  <span>{route ? `${route.provider} / ${route.model}` : t('inheritProfileModel')}</span>
                </div>
                {seat.activeInstanceId && onViewActivityLog && (
                  <button
                    type="button"
                    className={css.action}
                    onClick={() => {
                      onViewActivityLog(seat)
                    }}
                  >
                    {t('dockOpenSession')}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
        {team.leadSessionId && loadLiveView && (
          <section className={css.observations} aria-busy={loading}>
            <h3>{t('dockInteractions')}</h3>
            {view?.interactions.length ? (
              <ul>
                {view.interactions.map(edge => (
                  <li key={edge.id}>
                    {edge.from} → {edge.to}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={css.hint}>{t('dockLiveUnavailable')}</p>
            )}
            <h3>{t('tabTasks')}</h3>
            {view?.tasks.length ? (
              <ul>
                {view.tasks.map(task => (
                  <li key={task.id}>
                    {task.subject}
                    {task.ownerName ? ` · ${task.ownerName}` : ''}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={css.hint}>{t('emptyTasks')}</p>
            )}
          </section>
        )}
      </section>
    </Modal>
  )
}

/**
 * Show saved tasks or completed teammate output without starting a team session.
 * @param props - existing team, read-only loader, selected projection and localized copy.
 * @returns observed tasks or worker summaries, with explicit unavailable/error states.
 */
export function StandingTeamActivity({
  team,
  loadLiveView,
  kind,
  t,
}: Pick<StandingTeamDockProps, 'team' | 'loadLiveView' | 't'> & { readonly kind: 'tasks' | 'deliverables' }) {
  const { view, failed, loading } = useStandingActivity(true, team, loadLiveView)
  const outputs = view?.members.filter(member => member.result?.outcome === 'completed' && member.result.summary) ?? []
  return (
    <section className={css.body} aria-busy={loading}>
      {failed && <p role="alert">{t('dockLoadFailed')}</p>}
      {!team.leadSessionId ? (
        <p className={css.hint}>{t('dockUnprovisioned')}</p>
      ) : !loadLiveView || !view ? (
        <p className={css.hint}>{loading ? t('dockStandingHint') : t('dockLiveUnavailable')}</p>
      ) : kind === 'tasks' ? (
        view.tasks.length > 0 ? (
          <ul className={css.roster}>
            {view.tasks.map(task => (
              <li key={task.id} className={css.member}>
                <strong>{task.subject}</strong>
                {task.description && <p className={css.duty}>{task.description}</p>}
                {task.ownerName && <span className={css.hint}>{task.ownerName}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className={css.hint}>{t('emptyTasks')}</p>
        )
      ) : outputs.length > 0 ? (
        <ul className={css.roster}>
          {outputs.map(member => (
            <li key={member.id} className={css.member}>
              <strong>{member.name}</strong>
              <p className={css.duty}>{member.result?.summary}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className={css.hint}>{t('emptyDeliverables')}</p>
      )}
    </section>
  )
}
