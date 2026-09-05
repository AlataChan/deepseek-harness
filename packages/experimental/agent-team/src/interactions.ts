/** Derive thin Team topology edges from journal state and task views. */

import type { TeamState } from './projection.ts'
import type { TeamInteractionEdge, TeamMemberView, TeamTaskView } from './types.ts'

/**
 * Build message and task-dependency edges for the Team panel graph.
 * Message edges include pending and delivered mailbox hops (no bodies) so the
 * map stays readable after delivery; task edges link distinct owners.
 * @param state - current Team journal state.
 * @param members - roster views used to resolve message Session ids to names.
 * @param tasks - non-deleted task views with owners and blockers.
 * @returns stable, body-free interaction edges.
 */
export function teamInteractions(
  state: TeamState,
  members: readonly TeamMemberView[],
  tasks: readonly TeamTaskView[],
): TeamInteractionEdge[] {
  const nameById = new Map(members.map(member => [member.id, member.name] as const))
  const edges: TeamInteractionEdge[] = []
  const seen = new Set<string>()

  const push = (edge: TeamInteractionEdge): void => {
    if (seen.has(edge.id)) return
    seen.add(edge.id)
    edges.push(edge)
  }

  for (const message of state.messages) {
    const from = nameById.get(message.senderId)
    const to = nameById.get(message.targetId)
    if (from === undefined || to === undefined || from === to) continue
    // Keep delivered hops so the map still shows who messaged whom after
    // the mailbox empties; light-dot flash keys off new edge ids on refresh.
    push({
      id: `message:${message.id}`,
      from,
      to,
      kind: 'message',
    })
  }

  const taskById = new Map(tasks.map(task => [task.id, task] as const))
  for (const task of tasks) {
    if (task.ownerName === undefined) continue
    for (const blockerId of task.blockedBy) {
      const blocker = taskById.get(blockerId)
      if (blocker?.ownerName === undefined) continue
      if (blocker.ownerName === task.ownerName) continue
      push({
        id: `task-dep:${blocker.id}->${task.id}`,
        from: blocker.ownerName,
        to: task.ownerName,
        kind: 'task-dep',
      })
    }
  }

  return edges
}
