/** Fixed-layout Team topology: members as nodes, thin interaction edges. */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  TeamInteractionEdge,
  TeamMemberView as TeamRosterMember,
  TeamView,
} from '@deepseek-ai/dsh-experimental-agent-team/client'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamKey } from './locales.ts'
import css from './TeamAction.module.css'

const TOPOLOGY_PREF_KEY = 'dsh.client.agent-team.topology'

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

function memberStatusKey(status: TeamRosterMember['status']): TeamKey {
  switch (status) {
    case 'running': return 'memberStatus.running'
    case 'idle': return 'memberStatus.idle'
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
    case 'idle':
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
  memberStatus: (key: TeamKey) => string
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
  const [flashIds, setFlashIds] = useState<ReadonlySet<string>>(() => new Set())
  const [pulseNames, setPulseNames] = useState<ReadonlySet<string>>(() => new Set())
  const prevEdges = useRef<ReadonlySet<string>>(new Set())
  const prevStatus = useRef<ReadonlyMap<string, TeamRosterMember['status']>>(new Map())

  useEffect(() => {
    if (revealKey === 0) return
    setEnabled(true)
    writeTopologyPref(true)
  }, [revealKey])

  useEffect(() => {
    const nextEdgeIds = new Set(view.interactions.map(edge => edge.id))
    const appeared = [...nextEdgeIds].filter(id => !prevEdges.current.has(id))
    const nextPulse = new Set<string>()
    for (const member of view.members) {
      const prior = prevStatus.current.get(member.name)
      if (prior !== undefined && prior !== member.status && member.status === 'running') {
        nextPulse.add(member.name)
      }
    }
    prevEdges.current = nextEdgeIds
    prevStatus.current = new Map(view.members.map(member => [member.name, member.status]))
    if (appeared.length === 0 && nextPulse.size === 0) return
    setFlashIds(new Set(appeared))
    setPulseNames(nextPulse)
    const timer = window.setTimeout(() => {
      setFlashIds(new Set())
      setPulseNames(new Set())
    }, 900)
    return () => { window.clearTimeout(timer) }
  }, [view])

  const toggle = (): void => {
    setEnabled((current) => {
      const next = !current
      writeTopologyPref(next)
      return next
    })
  }

  const lead = view.members.find(member => member.role === 'lead')
  const teammates = view.members.filter(member => member.role === 'teammate')
  const layoutNames = [
    ...lead === undefined ? [] : [lead.name],
    ...teammates.map(member => member.name),
  ]
  const indexByName = new Map(layoutNames.map((name, index) => [name, index] as const))

  return (
    <section className={css.topology} aria-label={copy.title}>
      <div className={css.topologyHeader}>
        <h3>{copy.title}</h3>
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
              <svg className={css.topologySvg} viewBox={`0 0 ${Math.max(layoutNames.length, 1) * 120} 88`} aria-hidden>
                {view.interactions.map(edge => renderEdge(edge, indexByName, flashIds.has(edge.id), copy))}
              </svg>
              <div className={css.topologyNodes}>
                {layoutNames.map((name) => {
                  const member = view.members.find(row => row.name === name)
                  if (member === undefined) return null
                  return (
                    <div
                      key={name}
                      className={`${css.topologyNode}${pulseNames.has(name) ? ` ${css.topologyNodePulse}` : ''}`}
                    >
                      <StateDot state={statusDot(member.status)} />
                      <div className={css.topologyNodeText}>
                        <strong>{name}</strong>
                        <span>{copy.memberStatus(memberStatusKey(member.status))}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function renderEdge(
  edge: TeamInteractionEdge,
  indexByName: ReadonlyMap<string, number>,
  flash: boolean,
  copy: TeamTopologyCopy,
): ReactNode {
  const from = indexByName.get(edge.from)
  const to = indexByName.get(edge.to)
  if (from === undefined || to === undefined) return null
  const x1 = from * 120 + 60
  const x2 = to * 120 + 60
  const y = edge.kind === 'message' ? 28 : 48
  const label = edge.kind === 'message' ? copy.edgeMessage : copy.edgeTask
  return (
    <g key={edge.id} className={flash ? css.topologyEdgeFlash : undefined}>
      <line
        x1={x1}
        y1={y}
        x2={x2}
        y2={y}
        className={edge.kind === 'message' ? css.topologyEdgeMessage : css.topologyEdgeTask}
      />
      <text x={(x1 + x2) / 2} y={y - 6} className={css.topologyEdgeLabel}>{label}</text>
    </g>
  )
}
