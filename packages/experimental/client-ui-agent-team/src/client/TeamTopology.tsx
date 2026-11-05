/** Hierarchical execution view over real Team members, handoffs and task progress. */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type {
  TeamInteractionEdge,
  TeamMemberView as TeamRosterMember,
  TeamView,
} from '@deepseek-ai/dsh-experimental-agent-team/client'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamKey } from './locales.ts'
import css from './TeamAction.module.css'

const TOPOLOGY_PREF_KEY = 'dsh.client.agent-team.topology'
const MOTION_PREF_KEY = 'dsh.client.agent-team.reduceMotion'

function readTopologyPref(): boolean {
  try {
    const raw = sessionStorage.getItem(TOPOLOGY_PREF_KEY)
    if (raw === '0') return false
    if (raw === '1') return true
  } catch {
    /* sessionStorage may be unavailable in locked-down embeds */
  }
  return true
}

function writeTopologyPref(enabled: boolean): void {
  try {
    sessionStorage.setItem(TOPOLOGY_PREF_KEY, enabled ? '1' : '0')
  } catch {
    /* ignore quota / privacy mode */
  }
}

function readReduceMotion(): boolean {
  try {
    return localStorage.getItem(MOTION_PREF_KEY) === '1'
  } catch {
    return false
  }
}

function writeReduceMotion(enabled: boolean): void {
  try {
    localStorage.setItem(MOTION_PREF_KEY, enabled ? '1' : '0')
  } catch {
    /* ignore */
  }
}

function memberStatusKey(status: TeamRosterMember['status']): TeamKey {
  switch (status) {
    case 'running': return 'memberStatus.running'
    case 'inactive': return 'memberStatus.inactive'
    case 'provisioning': return 'memberStatus.provisioning'
    case 'failed': return 'memberStatus.failed'
  }
}

function statusDot(status: TeamRosterMember['status']): 'done' | 'warning' | 'ongoing' | 'error' {
  switch (status) {
    case 'running': return 'ongoing'
    case 'provisioning': return 'warning'
    case 'failed': return 'error'
    case 'inactive':
      return 'done'
  }
}

/** Locale-backed labels used by the topology strip. */
export interface TeamTopologyCopy {
  title: string
  hint: string
  show: string
  hide: string
  empty: string
  edgeMessage: string
  edgeTask: string
  motionReduce: string
  motionFull: string
  memberStatus: (key: TeamKey) => string
  leadRole: string
  workerRole: string
  activityTitle: string
  progress: (done: number, total: number) => string
}

export interface TeamTopologyProps {
  view: TeamView
  copy: TeamTopologyCopy
  /** Incremented when the Team panel opens so the map is revealed and scrolled into view. */
  revealKey?: number
}

/**
 * Spatial view of the same TeamView the panel already loaded.
 * Mount only while the Team panel is open; no timers or second Host API.
 */
export function TeamTopology({ view, copy, revealKey = 0 }: TeamTopologyProps) {
  const [enabled, setEnabled] = useState(readTopologyPref)
  const [reduceMotion, setReduceMotion] = useState(readReduceMotion)
  const [flashIds, setFlashIds] = useState<ReadonlySet<string>>(() => new Set())
  const prevEdges = useRef<ReadonlySet<string>>(new Set(view.interactions.map(edge => edge.id)))
  const flashTimer = useRef<number | undefined>(undefined)
  const markerId = useId().replaceAll(':', '')

  useEffect(() => {
    if (revealKey === 0) return
    setEnabled(true)
    writeTopologyPref(true)
  }, [revealKey])

  useEffect(() => () => { window.clearTimeout(flashTimer.current) }, [])

  useEffect(() => {
    const nextEdgeIds = new Set(view.interactions.map(edge => edge.id))
    const appeared = [...nextEdgeIds].filter(id => !prevEdges.current.has(id))
    prevEdges.current = nextEdgeIds
    if (reduceMotion) {
      window.clearTimeout(flashTimer.current)
      setFlashIds(new Set())
      return
    }
    if (appeared.length === 0) return
    window.clearTimeout(flashTimer.current)
    setFlashIds(new Set(appeared))
    flashTimer.current = window.setTimeout(() => { setFlashIds(new Set()) }, 2600)
  }, [view.interactions, reduceMotion])

  const toggle = (): void => {
    setEnabled((current) => {
      const next = !current
      writeTopologyPref(next)
      return next
    })
  }

  const toggleMotion = (): void => {
    setReduceMotion((current) => {
      const next = !current
      writeReduceMotion(next)
      return next
    })
  }

  const lead = view.members.find(member => member.role === 'lead')
  const teammates = view.members.filter(member => member.role === 'teammate')
  const layoutNames = [
    ...lead === undefined ? [] : [lead.name],
    ...teammates.map(member => member.name),
  ]
  const columns = Math.max(1, Math.min(teammates.length, 3))
  const width = columns * 164
  const height = 192 + Math.max(1, Math.ceil(teammates.length / columns)) * 142 + 30
  const positions = new Map<string, { x: number; y: number }>()
  if (lead !== undefined) positions.set(lead.name, { x: width / 2, y: 8 })
  teammates.forEach((member, index) => {
    positions.set(member.name, { x: (index % columns + 0.5) * 164, y: 192 + Math.floor(index / columns) * 142 })
  })
  const completed = view.tasks.filter(task => task.status === 'completed').length

  return (
    <section className={css.topology} aria-label={copy.title} data-reduce-motion={reduceMotion}>
      <div className={css.topologyHeader}>
        <h3>{copy.title}</h3>
        <button type="button" className={css.smallButton} onClick={toggleMotion} aria-pressed={reduceMotion}>
          {reduceMotion ? copy.motionFull : copy.motionReduce}
        </button>
        <button type="button" className={css.smallButton} onClick={toggle}>
          {enabled ? copy.hide : copy.show}
        </button>
      </div>
      {!enabled ? null : (
        <>
          <p className={css.topologyHint}>{copy.hint}</p>
          {layoutNames.length <= 1 && view.interactions.length === 0 ? (
            <p className={css.topologyEmpty}>{copy.empty}</p>
          ) : (
            <div className={css.topologyCanvas}>
              <div className={css.topologyScene} style={{ minWidth: width, height }}>
                <svg className={css.topologySvg} viewBox={`0 0 ${width} ${height}`} style={{ height }} preserveAspectRatio="none" aria-hidden>
                  <defs>
                    <marker id={`${markerId}-message`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                      <path d="M 0 0 L 8 4 L 0 8 Z" className={css.topologyMessageArrow} />
                    </marker>
                    <marker id={`${markerId}-task`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
                      <path d="M 0 0 L 8 4 L 0 8 Z" className={css.topologyTaskArrow} />
                    </marker>
                  </defs>
                  {view.interactions.map((edge, lane) => renderEdge(edge, positions, flashIds.has(edge.id), copy, lane, markerId))}
                </svg>
                {layoutNames.map((name) => {
                  const member = view.members.find(row => row.name === name)
                  const position = positions.get(name)
                  if (member === undefined || position === undefined) return null
                  const task = view.tasks.find(row => row.ownerName === name && row.status === 'in_progress')
                  return (
                    <div
                      key={name}
                      className={`${css.topologyNode}${member.status === 'running' ? ` ${css.topologyNodeActive}` : ''}`}
                      data-status={member.status}
                      data-role={member.role}
                      style={{ left: `${position.x / width * 100}%`, top: position.y }}
                    >
                      <span className={css.topologyRole}>{member.role === 'lead' ? copy.leadRole : copy.workerRole}</span>
                      <strong>{name}</strong>
                      {member.model !== undefined && <span className={css.topologyModel} title={member.model}>{member.model}</span>}
                      <span className={css.topologyMemberState}>
                        <StateDot state={statusDot(member.status)} />
                        {copy.memberStatus(memberStatusKey(member.status))}
                      </span>
                      {task !== undefined && <span className={css.topologyTask} title={task.subject}>{task.subject}</span>}
                    </div>
                  )
                })}
              </div>
              {view.tasks.length > 0 && (
                <div className={css.topologyProgress}>
                  <span>{copy.progress(completed, view.tasks.length)}</span>
                  <progress max={view.tasks.length} value={completed} aria-label={copy.progress(completed, view.tasks.length)} />
                </div>
              )}
              {view.interactions.length > 0 && (
                <div className={css.topologyFeed} aria-label={copy.activityTitle}>
                  <span className={css.topologyFeedTitle}>{copy.activityTitle}</span>
                  {view.interactions.slice(-3).map(edge => (
                    <div key={edge.id} className={flashIds.has(edge.id) ? css.topologyFeedActive : undefined}>
                      <span>{edge.from} → {edge.to}</span>
                      <span>{edge.kind === 'message' ? copy.edgeMessage : copy.edgeTask}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}

function renderEdge(
  edge: TeamInteractionEdge,
  positions: ReadonlyMap<string, { x: number; y: number }>,
  flash: boolean,
  copy: TeamTopologyCopy,
  lane: number,
  markerId: string,
): ReactNode {
  const from = positions.get(edge.from)
  const to = positions.get(edge.to)
  if (from === undefined || to === undefined) return null
  const sameRow = from.y === to.y
  const sourceY = sameRow ? from.y + 112 : from.y < to.y ? from.y + 112 : from.y
  const targetY = sameRow ? to.y + 112 : from.y < to.y ? to.y : to.y + 112
  const bend = sameRow ? sourceY + 42 + (lane % 2) * 8 : (sourceY + targetY) / 2
  const offset = sameRow ? 0 : (lane % 3 - 1) * 22
  const path = `M ${from.x} ${sourceY} C ${from.x + offset} ${bend} ${to.x + offset} ${bend} ${to.x} ${targetY}`
  const label = edge.kind === 'message' ? copy.edgeMessage : copy.edgeTask
  return (
    <g key={edge.id} className={flash ? css.topologyEdgeFlash : undefined} data-edge-kind={edge.kind}>
      <path
        d={path}
        markerEnd={`url(#${markerId}-${edge.kind === 'message' ? 'message' : 'task'})`}
        className={edge.kind === 'message' ? css.topologyEdgeMessage : css.topologyEdgeTask}
      />
      <text x={(from.x + to.x) / 2 + offset} y={sameRow ? sourceY + 24 : bend - 7} className={css.topologyEdgeLabel}>{label}</text>
      {flash && edge.kind === 'message' && (
        <circle r={5.5} className={css.topologyDot}>
          <animateMotion dur="1.25s" repeatCount="2" path={path} />
        </circle>
      )}
    </g>
  )
}
