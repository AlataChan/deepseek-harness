/** Process-local Team filesystem attribution for OCC rejection remedies. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FsErrorRemedy, FsErrorRemedyRequest, FsObservation, FsTarget } from '@deepseek-ai/dsh-fs'
import type { TeamRoster } from './roster.ts'
import type { TeamId } from './types.ts'

function agentFromActor(actor: object | undefined): Agent | undefined {
  if (actor === undefined || !('agent' in actor)) return undefined
  const candidate = actor.agent
  return candidate === undefined ? undefined : candidate as Agent
}

/** Records the last teammate observation for each filesystem target in one process. */
export class TeamAttribution {
  private readonly writers = new Map<TeamId, Map<string, string>>()

  /**
   * @param roster - Team membership resolver used to reject non-Team and Lead observations.
   */
  constructor(private readonly roster: TeamRoster) {}

  /**
   * Record a teammate's positive filesystem mutation observation.
   * @param target - resolved filesystem target.
   * @param observation - present or absent observation from the filesystem tool.
   * @param actor - opaque tool-execution context that may carry the Agent.
   * @param operation - operation reported by fs/observed; legacy undefined observations remain advisory.
   */
  observe(target: FsTarget, observation: FsObservation, actor: object | undefined, operation?: string): void {
    if (observation.kind !== 'present') return
    if (operation !== undefined && operation !== 'write' && operation !== 'edit') return
    const agent = agentFromActor(actor)
    if (agent === undefined) return
    const membership = this.roster.tryMembership(agent)
    if (membership?.role !== 'teammate') return
    let teamMap = this.writers.get(membership.id)
    if (teamMap === undefined) {
      teamMap = new Map()
      this.writers.set(membership.id, teamMap)
    }
    teamMap.set(target.targetKey, membership.name)
  }

  /**
   * Return Team attribution for stale-version failures, or undefined to keep
   * the default filesystem remedy.
   * @param request - filesystem failure, target, operation, and actor.
   * @returns an attribution remedy when a Team teammate last observed the target.
   */
  remedy(request: FsErrorRemedyRequest): FsErrorRemedy {
    if (request.error.code !== 'FS_STALE_VERSION') return undefined
    const agent = agentFromActor(request.actor)
    if (agent === undefined) return undefined
    const membership = this.roster.tryMembership(agent)
    if (membership === undefined) return undefined
    const writerName = this.writers.get(membership.id)?.get(request.target.targetKey)
    if (writerName === undefined) return undefined
    return `last changed by ${writerName}; re-read and rebase, or ask the Lead to re-assign`
  }

  /** Drop process-local attribution state during runtime disposal. */
  clear(): void {
    this.writers.clear()
  }
}
