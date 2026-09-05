/** Unit coverage for thin Team topology edge derivation. */

import { describe, expect, it } from 'vitest'
import { teamInteractions } from '../src/interactions.ts'
import { emptyTeamState } from '../src/projection.ts'
import { TeamMessageId, TeamTaskId } from '../src/types.ts'
import type { TeamMemberView, TeamTaskView } from '../src/types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

const LEAD = 'lead-session' as SessionId
const WORKER = 'worker-session' as SessionId

const members: TeamMemberView[] = [
  { id: LEAD, name: 'lead', role: 'lead', status: 'idle', diagnostics: [] },
  { id: WORKER, name: 'drafter', role: 'teammate', status: 'running', diagnostics: [] },
]

describe('teamInteractions', () => {
  it('projects mailbox hops without bodies, including delivered ones', () => {
    const state = emptyTeamState(LEAD)
    state.messages.push({
      id: TeamMessageId('msg-1'),
      senderId: LEAD,
      senderName: 'lead',
      targetId: WORKER,
      content: [{ type: 'text', text: 'secret body must not appear in edge id alone' }],
    })
    state.delivered.push(TeamMessageId('msg-1'))
    const edges = teamInteractions(state, members, [])
    expect(edges).toEqual([{
      id: 'message:msg-1',
      from: 'lead',
      to: 'drafter',
      kind: 'message',
    }])
    expect(JSON.stringify(edges)).not.toMatch(/secret body/)
  })

  it('still projects pending mailbox hops before delivery', () => {
    const state = emptyTeamState(LEAD)
    state.messages.push({
      id: TeamMessageId('msg-pending'),
      senderId: LEAD,
      senderName: 'lead',
      targetId: WORKER,
      content: [{ type: 'text', text: 'body' }],
    })
    expect(teamInteractions(state, members, []).map(edge => edge.id)).toEqual(['message:msg-pending'])
  })

  it('projects owner-to-owner task dependency edges', () => {
    const tasks: TeamTaskView[] = [
      {
        id: TeamTaskId('t1'),
        subject: 'first',
        description: 'first',
        revision: 2,
        status: 'completed',
        blockedBy: [],
        writeScopes: [],
        ownerName: 'lead',
        ready: false,
        writeScopeWarnings: [],
      },
      {
        id: TeamTaskId('t2'),
        subject: 'second',
        description: 'second',
        revision: 1,
        status: 'pending',
        blockedBy: [TeamTaskId('t1')],
        writeScopes: [],
        ownerName: 'drafter',
        ready: false,
        writeScopeWarnings: [],
      },
    ]
    expect(teamInteractions(emptyTeamState(LEAD), members, tasks)).toEqual([{
      id: 'task-dep:t1->t2',
      from: 'lead',
      to: 'drafter',
      kind: 'task-dep',
    }])
  })
})
