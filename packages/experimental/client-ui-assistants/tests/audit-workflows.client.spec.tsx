// @vitest-environment jsdom

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import {
  AssistantProfileId,
  TeamDefinitionId,
  TeamSeatId,
  GroupDiscussionId,
  GroupRoundId,
  type GroupRoundJournalEntry,
  type AssistantProfile,
  type TeamDefinition,
  type TeamSeat,
} from '@deepseek-ai/dsh-experimental-assistant-registry/types'
import { registerUi, type AssistantClientOps } from '../src/client/mount.ts'
import type { AssistantDirectoryInjected } from '../src/client/AssistantDirectory.tsx'
import { TeamDiscussion, type TeamDiscussionOps } from '../src/client/TeamDiscussion.tsx'
import { TeamView } from '../src/client/TeamView.tsx'
import { StandingTeamDock, type StandingTeamLiveView } from '../src/client/StandingTeamDock.tsx'
import { SessionId } from '@deepseek-ai/dsh-session'
import { TeamEditorModal } from '../src/client/TeamEditorModal.tsx'
import { zh } from '../src/client/locales.ts'

type TeamTaskId = StandingTeamLiveView['tasks'][number]['id']

const t = makeTranslate(zh)
const profile: AssistantProfile = {
  id: AssistantProfileId('audit-profile'),
  name: '审核员',
  responsibility: '审核材料',
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
}
const team: TeamDefinition = {
  id: TeamDefinitionId('audit-team'),
  name: '材料小组',
  coordinatorProfileId: profile.id,
  templateOrigin: 'blank',
  seatIds: [TeamSeatId('audit-seat')],
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
}
const seat: TeamSeat = {
  id: TeamSeatId('audit-seat'),
  teamId: team.id,
  profileId: profile.id,
  role: 'coordinator',
  name: 'coordinator',
  duty: '统筹',
  modelOverride: { provider: 'served', model: 'override' },
  runtimeInstances: [],
  createdAt: 1,
  updatedAt: 1,
}
const contexts: Context[] = []

afterEach(async () => {
  cleanup()
  for (const context of contexts.splice(0)) await context.fiber.dispose()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function mountedOperations(wire?: object, ops?: AssistantClientOps): AssistantDirectoryInjected {
  const context = new Context()
  contexts.push(context)
  let injected: AssistantDirectoryInjected | undefined
  if (wire) context.provide('remote', { assistants: wire } as never)
  context.slots = {
    inject: (_name: string, callback: () => void) => callback(),
    register: (options: { name: string; inject?: () => AssistantDirectoryInjected }) => {
      if (options.name === 'main') injected = options.inject?.()
      return () => {}
    },
  } as never
  context.locale = { register: () => () => {}, bind: () => t } as never
  registerUi(context, ops)
  if (!injected) throw new Error('Assistant directory was not registered')
  return injected
}

describe('Independent mounted workflow adapter controls', () => {
  it('transmits an explicit null to clear a seat override through JSON RPC', async () => {
    const updateSeat = vi.fn(async () => ({ ok: true as const, value: seat }))
    const operations = mountedOperations({ updateSeat })
    await operations.onUpdateSeat?.(seat.id, { modelOverride: null })
    expect(updateSeat).toHaveBeenCalledOnce()
    const serialized = JSON.parse(JSON.stringify(updateSeat.mock.calls[0]))
    expect(serialized).toEqual([seat.id, { modelOverride: null }])
  })

  it('does not silently acknowledge unavailable mutations', async () => {
    const operations = mountedOperations()
    if (!operations.onUpdateSeat) return
    await expect(Promise.resolve().then(() => operations.onUpdateSeat?.(seat.id, { duty: '新职责' }))).rejects.toThrow()
  })

  it('reopens the team editor with the current durable team values', () => {
    const props = { isOpen: false, team, seats: [seat], profiles: [profile], models: [], t, onClose: vi.fn(), onSave: vi.fn() }
    const view = render(<TeamEditorModal {...props} />)
    view.rerender(<TeamEditorModal {...props} team={{ ...team, name: '已经更新的团队', revision: 2 }} isOpen />)
    expect((screen.getByTestId('edit-team-name-input') as HTMLInputElement).value).toBe('已经更新的团队')
  })
})

describe('Standing collaboration panel', () => {
  it('opens before any task exists, without a callback or provider provisioning', async () => {
    const loadLiveView = vi.fn(async () => ({ members: [], tasks: [], interactions: [] }))
    render(<TeamView team={team} seats={[seat]} profiles={[profile]} t={t} loadLiveView={loadLiveView} />)
    fireEvent.click(screen.getByTestId('open-dock-button'))
    const dock = screen.getByTestId('standing-team-dock')
    expect(dock.textContent).toContain(profile.name)
    expect(dock.textContent).toContain('served / override')
    expect(loadLiveView).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('standing-team-dock')).toBeNull())
  })

  it('shows the real coordinator profile for an older saved team with no seat rows', () => {
    const loadLiveView = vi.fn(async () => undefined)
    render(
      <StandingTeamDock
        open
        team={{ ...team, seatIds: [] }}
        seats={[]}
        profiles={[profile]}
        onClose={vi.fn()}
        loadLiveView={loadLiveView}
        t={t}
      />,
    )
    expect(screen.getByTestId('standing-coordinator-profile').textContent).toContain(profile.name)
    expect(screen.getByTestId('standing-coordinator-profile').textContent).toContain(profile.responsibility)
    expect(screen.queryByText(zh.dockNoMembers)).toBeNull()
    expect(loadLiveView).not.toHaveBeenCalled()
  })

  it('reads existing live collaboration and stops polling after close', async () => {
    vi.useFakeTimers()
    const loadLiveView = vi.fn(async () => ({
      members: [],
      tasks: [
        {
          id: 'stored-task' as TeamTaskId,
          subject: '真实已保存任务',
          revision: 1,
          description: '',
          status: 'pending' as const,
          blockedBy: [],
          writeScopes: [],
          ready: true,
          writeScopeWarnings: [],
        },
      ],
      interactions: [{ id: 'stored-edge', from: 'lead', to: 'archivist', kind: 'message' as const }],
    }))
    const props = {
      open: true,
      team: { ...team, leadSessionId: SessionId('stored-lead') },
      seats: [seat],
      profiles: [profile],
      onClose: vi.fn(),
      t,
    }
    const view = render(<StandingTeamDock {...props} loadLiveView={loadLiveView} />)
    await act(async () => {})
    expect(screen.getByText('真实已保存任务')).toBeTruthy()
    expect(screen.getByText('lead → archivist')).toBeTruthy()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(loadLiveView).toHaveBeenCalledTimes(2)
    view.rerender(<StandingTeamDock {...props} open={false} loadLiveView={loadLiveView} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(loadLiveView).toHaveBeenCalledTimes(2)
  })
})

describe('Standing-team discussion lifecycle', () => {
  const discussionId = GroupDiscussionId('stored-discussion')
  const roundId = GroupRoundId('stored-round')
  const discussion = { id: discussionId, teamId: team.id, rootSessionId: SessionId('stored-coordinator'), createdAt: 1, updatedAt: 1 }
  const pendingRound: GroupRoundJournalEntry = {
    id: roundId,
    discussionId,
    teamId: team.id,
    status: 'pending',
    prompt: '请审核材料',
    slots: [],
    activeSlotIndex: 0,
    totalTokensUsed: 0,
    handoffCount: 0,
    bounds: { maxSeatsPerRound: 5, maxHandoffsPerRound: 3, maxTokensPerRound: 1000, slotTimeoutMs: 30000 },
    createdAt: 1,
  }
  function operations(overrides: Partial<TeamDiscussionOps> = {}): TeamDiscussionOps {
    return {
      listDiscussions: vi.fn(async () => []),
      createDiscussion: vi.fn(async () => discussion),
      provisionTeam: vi.fn(async () => ({ coordinatorSessionId: SessionId('stored-coordinator') })),
      scheduleRound: vi.fn(async () => pendingRound),
      startRound: vi.fn(async () => ({ ...pendingRound, status: 'active' as const })),
      getRound: vi.fn(async () => ({ ...pendingRound, status: 'completed' as const })),
      cancelRound: vi.fn(async () => ({ ...pendingRound, status: 'cancelled' as const })),
      queryPublicTranscript: vi.fn(async () => ({ items: [], hasMore: false })),
      ...overrides,
    }
  }

  it('reads on mount without provisioning or starting model work', async () => {
    const ops = operations()
    render(<TeamDiscussion team={team} operations={ops} t={t} />)
    await waitFor(() => expect(ops.listDiscussions).toHaveBeenCalledWith(team.id))
    expect(ops.provisionTeam).not.toHaveBeenCalled()
    expect(ops.scheduleRound).not.toHaveBeenCalled()
    expect(ops.startRound).not.toHaveBeenCalled()
  })

  it('starts an admitted task once even if the view closes before admission responds', async () => {
    const admission = Promise.withResolvers<GroupRoundJournalEntry>()
    const scheduleRound = vi.fn(() => admission.promise)
    const ops = operations({ scheduleRound })
    const view = render(<TeamDiscussion team={team} operations={ops} t={t} />)
    fireEvent.change(screen.getByLabelText(zh.discussionPrompt), { target: { value: pendingRound.prompt } })
    await waitFor(() => expect((screen.getByRole('button', { name: zh.discussionSend }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: zh.discussionSend }))
    await waitFor(() => expect(scheduleRound).toHaveBeenCalledOnce())
    view.unmount()
    await act(async () => {
      admission.resolve(pendingRound)
    })
    expect(ops.startRound).toHaveBeenCalledExactlyOnceWith(roundId)
  })

  it('does not restore an active status from a late poll after cancellation', async () => {
    const late = Promise.withResolvers<GroupRoundJournalEntry>()
    const activeRound = { ...pendingRound, status: 'active' as const }
    let reads = 0
    const getRound = vi.fn(async () => (++reads === 1 ? activeRound : late.promise))
    const ops = operations({ listDiscussions: async () => [{ ...discussion, activeRoundId: roundId }], getRound })
    render(<TeamDiscussion team={team} operations={ops} t={t} />)
    await waitFor(() => expect(getRound).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: zh.discussionCancel }))
    await waitFor(() => expect(screen.queryByRole('button', { name: zh.discussionCancel })).toBeNull())
    await act(async () => {
      late.resolve(activeRound)
    })
    expect(screen.queryByRole('button', { name: zh.discussionCancel })).toBeNull()
  })

  it('submits the entered task through provisioning, admission and nonblocking start', async () => {
    const ops = operations()
    render(<TeamDiscussion team={team} operations={ops} t={t} />)
    fireEvent.change(screen.getByLabelText(zh.discussionPrompt), { target: { value: pendingRound.prompt } })
    await waitFor(() => expect((screen.getByRole('button', { name: zh.discussionSend }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: zh.discussionSend }))
    await waitFor(() => expect(ops.startRound).toHaveBeenCalledExactlyOnceWith(roundId))
    expect(ops.provisionTeam).toHaveBeenCalledExactlyOnceWith(team.id)
    expect(ops.scheduleRound).toHaveBeenCalledWith({ teamId: team.id, discussionId, prompt: pendingRound.prompt })
    await waitFor(() => expect(screen.queryByRole('button', { name: zh.discussionCancel })).toBeNull())
  })
})
