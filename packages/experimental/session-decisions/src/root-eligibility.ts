/**
 * Execution-time eligibility checks for the persistent-question tools: the
 * calling agent must be a runtime root with no owned background work, and
 * must not sit inside PTC or a Team roster. Decisions live in the operation
 * that enforces them; the tools module only translates refusals into
 * model-facing results.
 * @module @deepseek-ai/dsh-experimental-session-decisions/root-eligibility
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-experimental-agent-team'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-subagent'
import type { DecisionErrorCode } from './types.ts'

/** Why one `request_persistent_question` call may not create a question now. */
export type RootEligibility =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: DecisionErrorCode; readonly message: string }

/** The single model-facing fallback appended to every busy/PTC refusal. */
export const ORDINARY_CHAT_FALLBACK =
  'Ask the user in ordinary chat instead, or retry after owned work has settled. Do not stop or replace teammates.'

/** Pinned nested-question refusal (B0): identical on every call. */
export const PTC_REFUSAL_MESSAGE =
  'Persistent questions are unavailable inside PTC programs. Ask the user in ordinary chat instead.'

function busy(message: string): RootEligibility {
  return { ok: false, code: 'DECISION_BUSY_OWNED_WORK', message: `${message} ${ORDINARY_CHAT_FALLBACK}` }
}

/**
 * Whether the calling agent may create one structured question: runtime
 * root scope, no running owned background jobs, no live subagent children,
 * and no Team work in flight. Team provisioning counts as owned work before
 * any child Agent exists, so a Lead waiting on a spawning teammate cannot
 * strand it. PTC nesting is refused by the caller, which owns the exact
 * pinned literal and the save-nothing guarantee ordering.
 * @param ctx - Context carrying the optional jobs, subagent, and Team services.
 * @param agent - the exact live calling agent.
 * @returns Eligibility or the typed ordinary-chat fallback refusal.
 */
export async function checkRootEligibility(ctx: Context, agent: Agent): Promise<RootEligibility> {
  // A forked subagent session is never a root question owner; its answer
  // would deliver into a subagent conversation the desktop composer cannot
  // reach.
  if (agent.session.header.origin === 'subagent') {
    return busy('Persistent questions require a root conversation; this session is a delegated subagent.')
  }
  const jobs = ctx.get('jobs')
  const ownedJob = (): RootEligibility | undefined => {
    const active = jobs?.list(agent.session.id)
      .some(job => job.owner === agent.session.id && (job.status === 'running' || job.status === 'stopping'))
    return active
      ? busy('Background jobs owned by this session are still running; their results would be stranded by a question.')
      : undefined
  }
  const teamBarrier = (): RootEligibility | undefined => {
    const membership = ctx.get('agentTeams')?.tryMembership(agent)
    if (membership === undefined) return undefined
    if (membership.role === 'teammate') {
      return busy('Persistent questions require the Team Lead conversation; teammates answer through the Lead.')
    }
    // Lead: a teammate still running or provisioning owns work the question
    // would strand; inactive/failed history is not a barrier.
    const busyMember = ctx.get('agentTeams')?.listMembers(agent)
      .some(member => member.id !== agent.session.id
        && (member.status === 'running' || member.status === 'provisioning'))
    return busyMember
      ? busy('A Team teammate is still running or provisioning; its results would be stranded by a question.')
      : undefined
  }
  const barrier = teamBarrier() ?? ownedJob()
  if (barrier !== undefined) return barrier
  const subagents = ctx.get('subagents')
  if (subagents !== undefined) {
    const children = await subagents.listChildren(agent.session.id)
    const live = children.some(child => ctx.get('agents')?.get(child.id)?.status === 'running')
    if (live) return busy('Delegated subagents of this session are still running; their results would be stranded by a question.')
  }
  // Revalidate the synchronous ownership checks after the async catalog
  // read: work started mid-check must not slip past the barrier.
  return teamBarrier() ?? ownedJob() ?? { ok: true }
}
