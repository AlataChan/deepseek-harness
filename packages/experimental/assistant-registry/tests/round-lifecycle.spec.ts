/** Real owned execution, bounded dispatch, and recovery through the production assistant service. */
import { rmSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { setupAssistantHarness, textResponse } from './harness.ts'
import { GroupRoundId, GroupRoundScheduler } from '../src/index.ts'

async function fixture(script: Parameters<typeof setupAssistantHarness>[0] = []) {
  const h = await setupAssistantHarness(script)
  const profile = await h.assistants.createProfile({ name: 'Lifecycle', responsibility: 'Coordinate' })
  const { team, seats } = await h.assistants.createTeamFromTemplate('blank', {
    coordinatorProfileId: profile.id, name: 'Lifecycle team',
  })
  await h.assistants.bindSeatSession(seats[0]!.id, h.lead.id)
  const discussion = await h.assistants.createDiscussion({ teamId: team.id })
  const request = { discussionId: discussion.id, teamId: team.id, prompt: 'Actual operation', id: GroupRoundId('lifecycle') }
  const round = await h.assistants.scheduleRound(request)
  return { h, round, request, seats }
}

describe('Production group round lifecycle', { timeout: 30000 }, () => {
  it('cancels a real provider, waits for ownership release, and preserves sibling queued input', async () => {
    const { h, round } = await fixture(['hang', textResponse('Sibling reply')])
    const running = h.assistants.executeRound(round.id)
    try {
      await vi.waitFor(() => expect(h.adapter.requests).toHaveLength(1))
      h.assistants.ownership.enqueueSlotInput({ roundId: 'sibling', slotId: 'sibling-slot', attemptId: 'attempt-0',
        targetSessionId: h.lead.id, payload: 'Sibling input' })
      await h.assistants.cancelRound(round.id)
      expect(h.adapter.requests[0]!.signal!.aborted).toBe(true)
      expect(h.lead.status).toBe('idle')
      expect(h.assistants.ownership.getOwnership(h.lead.id)).toBeUndefined()
      expect(h.assistants.ownership.getSlot('sibling', 'sibling-slot')?.status).toBe('queued')
      expect((await running).status).toBe('cancelled')
      expect(h.assistants.roundScheduler.journal.getTranscript(round.discussionId)).toHaveLength(0)
    } finally {
      h.lead.cancel({ kind: 'user' })
      await running
      await h.dispose()
    }
  })

  it('acknowledges background start before owned execution completes so serialized callers can cancel', async () => {
    const { h, round } = await fixture(['hang'])
    try {
      const receipt = await h.assistants.startRound(round.id)
      expect(receipt.id).toBe(round.id)
      await vi.waitFor(() => expect(h.adapter.requests).toHaveLength(1))
      await h.assistants.startRound(round.id)
      expect(h.adapter.requests).toHaveLength(1)
      const cancelled = await h.assistants.cancelRound(round.id)
      expect(cancelled.status).toBe('cancelled')
      expect(h.adapter.requests[0]?.signal?.aborted).toBe(true)
      expect(h.lead.status).toBe('idle')
      expect((await h.assistants.getRound(round.id))?.status).toBe('cancelled')
    } finally { await h.dispose() }
  })

  it('reaches global unload quiescence while a cold child is executing in the background', async () => {
    const h = await setupAssistantHarness([], {}, { withAgentTeams: true })
    let reopened: Awaited<ReturnType<typeof setupAssistantHarness>> | undefined
    try {
      const profile = await h.assistants.createProfile({ name: 'Disposal coordinator', responsibility: 'Coordinate',
        defaultModel: { provider: 'mock', model: 'mock' } })
      const { team, seats } = await h.assistants.createTeamFromTemplate('document', {
        coordinatorProfileId: profile.id, name: 'Disposal team' })
      await h.assistants.provisionTeam(team.id)
      await Promise.all(h.ctx.agents.list().map(agent => agent.whenIdle()))
      const teammate = seats.find(seat => seat.role === 'teammate')!
      await h.dispose(true)
      reopened = await setupAssistantHarness(['hang'], {}, { storageRoot: h.storageRoot, withAgentTeams: true })
      const discussion = await reopened.assistants.createDiscussion({ teamId: team.id })
      const round = await reopened.assistants.scheduleRound({ teamId: team.id, discussionId: discussion.id,
        prompt: 'Background cold disposal', recipients: [teammate.id] })
      await reopened.assistants.startRound(round.id)
      await vi.waitFor(() => expect(reopened!.adapter.requests).toHaveLength(1))
      await reopened.ctx.fiber.dispose()
      expect(reopened.adapter.requests[0]?.signal?.aborted).toBe(true)
      expect((await reopened.assistants.getRound(round.id))?.status).toBe('cancelled')
      expect(reopened.assistants.ownership.getOwnership(round.slots[0]!.sessionId)).toBeUndefined()
      await expect(reopened.assistants.startRound(round.id)).rejects.toThrow(/disposed/i)
    } finally {
      await reopened?.dispose()
      rmSync(h.storageRoot, { recursive: true, force: true })
    }
  })

  it.each(['direct Agent followup', 'official sessionController prompt'] as const)('refuses %s during the exact owned interval without attributing a foreign reply', async (path) => {
    const { h, round } = await fixture(['hang', textResponse('Foreign reply must not run')])
    const running = h.assistants.executeRound(round.id)
    try {
      await vi.waitFor(() => expect(h.adapter.requests).toHaveLength(1))
      if (path === 'direct Agent followup') {
        h.lead.followup(createUserMessage({ content: [{ type: 'text', text: 'Foreign input' }], source: { kind: 'user' } }))
      } else {
        await h.controller.prompt({ requestId: 'foreign-slot-prompt' as never, sessionId: h.lead.id,
          mode: 'queue', content: [{ type: 'text', text: 'Foreign input' }] }, new AbortController().signal)
      }
      const settled = await running
      expect(h.adapter.requests).toHaveLength(1)
      expect(h.adapter.requests[0]?.signal?.aborted).toBe(true)
      expect(settled.slots[0]?.status).toBe('uncertain')
      expect(settled.slots[0]?.executionUncertain).toBe(true)
      expect(h.lead.status).toBe('idle')
      expect(h.assistants.ownership.getOwnership(h.lead.id)).toBeUndefined()
      expect(h.assistants.roundScheduler.journal.getTranscript(round.discussionId)).toHaveLength(0)
      expect(h.lead.inbox.nextTurn).toHaveLength(0)
    } finally {
      h.lead.cancel({ kind: 'user' })
      await running
      await h.dispose()
    }
  })

  it('resumes a provisioned coordinator and child seat for a new round after a production cold restart', async () => {
    const h = await setupAssistantHarness([], {}, { withAgentTeams: true })
    let reopened: Awaited<ReturnType<typeof setupAssistantHarness>> | undefined
    try {
      const profile = await h.assistants.createProfile({ name: 'Cold coordinator', responsibility: 'Coordinate',
        defaultModel: { provider: 'mock', model: 'mock' } })
      const { team, seats } = await h.assistants.createTeamFromTemplate('document', {
        coordinatorProfileId: profile.id, name: 'Cold team' })
      await h.assistants.provisionTeam(team.id)
      await Promise.all(h.ctx.agents.list().map(agent => agent.whenIdle()))
      const coordinator = seats.find(seat => seat.role === 'coordinator')!
      const teammate = seats.find(seat => seat.role === 'teammate')!
      const boundCoordinator = (await h.assistants.listSeats(team.id)).find(seat => seat.id === coordinator.id)!
      const boundTeammate = (await h.assistants.listSeats(team.id)).find(seat => seat.id === teammate.id)!
      await h.dispose(true)
      reopened = await setupAssistantHarness([textResponse('Cold coordinator reply'), textResponse('Cold teammate reply'), textResponse('Automatic acknowledgement'), textResponse('Second child reply'), 'hang'],
        {}, { storageRoot: h.storageRoot, withAgentTeams: true })
      expect(reopened.ctx.agents.get(boundCoordinator.activeInstanceId!)).toBeUndefined()
      expect(reopened.ctx.agents.get(boundTeammate.activeInstanceId!)).toBeUndefined()
      let scheduler!: GroupRoundScheduler
      const scope = reopened.ctx.inject(['storageDomain', 'storage'], (scoped) => {
        scheduler = new GroupRoundScheduler(scoped, reopened!.assistants.ownership, { catalog: reopened!.assistants.catalog })
      })
      await scope.await()
      const discussion = await scheduler.createDiscussion({ teamId: team.id })
      const round = await scheduler.scheduleRound({ discussionId: discussion.id, teamId: team.id,
        prompt: 'Continue after restart', recipients: [coordinator.id, teammate.id] })
      const result = await scheduler.executeRound(round.id)
      expect(result.slots.map(slot => slot.status)).toEqual(['completed', 'completed'])
      expect(reopened.adapter.requests).toHaveLength(3)
      const notice = reopened.adapter.requests[2]?.messages.findLast(message => message.role === 'user')
      expect(notice?.source?.kind).toBe('subagent-settled')
      const transcript = await scheduler.queryPublicTranscript({ discussionId: discussion.id })
      expect(transcript.items.map(message => message.text)).toEqual(['Cold coordinator reply', 'Cold teammate reply'])
      expect(transcript.items[1]?.sourceSessionId).toBe(boundTeammate.activeInstanceId)
      expect(transcript.items[1]?.sourceEventSeq).toBeGreaterThan(0)
      expect(JSON.stringify(reopened.adapter.requests[1]?.messages)).toContain('Cold coordinator reply')
      expect(result.totalTokensUsed).toBe(30 + 'Cold coordinator reply'.length + 'Cold teammate reply'.length + 'Automatic acknowledgement'.length)
      expect(reopened.adapter.requests[2]?.maxTokens).toBeLessThan(reopened.adapter.requests[1]!.maxTokens!)
      expect(reopened.ctx.agents.get(boundCoordinator.activeInstanceId!)?.status).toBe('idle')
      expect(reopened.assistants.ownership.getOwnership(boundCoordinator.activeInstanceId!)).toBeUndefined()

      // The cold child's subsequent parent acknowledgement is part of the same bounded owned interval.
      const second = await scheduler.scheduleRound({ discussionId: discussion.id, teamId: team.id,
        prompt: 'Second cold delivery', recipients: [teammate.id] })
      const running = scheduler.executeRound(second.id)
      await vi.waitFor(() => expect(reopened!.adapter.requests).toHaveLength(5))
      await scheduler.cancelRound(second.id)
      expect(reopened.adapter.requests[4]?.signal?.aborted).toBe(true)
      expect((await running).status).toBe('cancelled')
      expect(reopened.ctx.agents.get(boundCoordinator.activeInstanceId!)?.status).toBe('idle')
      expect(reopened.assistants.ownership.getOwnership(boundCoordinator.activeInstanceId!)).toBeUndefined()
      expect((await scheduler.queryPublicTranscript({ discussionId: discussion.id })).items).toHaveLength(2)
    } finally {
      await reopened?.dispose()
      rmSync(h.storageRoot, { recursive: true, force: true })
    }
  })

  it('times out the actual owned stream and supplies the request generation limit', async () => {
    const { h, request } = await fixture(['hang'])
    try {
      const bounded = await h.assistants.scheduleRound({ ...request, id: GroupRoundId('bounded'),
        bounds: { slotTimeoutMs: 100, maxTokensPerRound: 37 } })
      const result = await h.assistants.executeRound(bounded.id)
      expect(result.slots[0]?.status).toBe('timed_out')
      expect(h.adapter.requests).toHaveLength(1)
      expect(h.adapter.requests[0]?.maxTokens).toBe(37)
      expect(h.adapter.requests[0]?.signal?.aborted).toBe(true)
      expect(h.lead.status).toBe('idle')
      expect(h.assistants.ownership.getOwnership(h.lead.id)).toBeUndefined()
    } finally { await h.dispose() }
  })

  it('publishes a retained checkpoint once after cold restart without repeating effects', async () => {
    const { h, round } = await fixture()
    let reopened: Awaited<ReturnType<typeof setupAssistantHarness>> | undefined
    let effects = 0
    const executor = async () => { effects++; return { status: 'completed' as const, text: 'Recoverable reply', tokensUsed: 1 } }
    try {
      vi.spyOn(h.assistants.roundScheduler, 'postPublicReply').mockRejectedValueOnce(new Error('Publication IO failed'))
      await expect(h.assistants.executeRound(round.id, { executor })).rejects.toThrow('Publication IO failed')
      await h.dispose(true)
      reopened = await setupAssistantHarness([], {}, { storageRoot: h.storageRoot })
      await reopened.assistants.executeRound(round.id, { executor })
      await reopened.assistants.executeRound(round.id, { executor })
      expect(effects).toBe(1)
      expect(reopened.assistants.roundScheduler.journal.getTranscript(round.discussionId)).toHaveLength(1)
      expect(reopened.assistants.roundScheduler.journal.getRound(round.id)?.slots[0]?.resultMessageId).toBeDefined()
    } finally {
      await reopened?.dispose()
      rmSync(h.storageRoot, { recursive: true, force: true })
    }
  })

  it('settles interrupted execution uncertain and never repeats its side effects', async () => {
    const { h, round } = await fixture()
    try {
      await h.assistants.roundScheduler.journal.saveRound({ ...round, status: 'active',
        slots: round.slots.map(slot => ({ ...slot, status: 'active' as const })) })
      const executor = vi.fn()
      const recovered = await h.assistants.executeRound(round.id, { executor })
      expect(recovered.slots[0]?.status).toBe('uncertain')
      expect(recovered.slots[0]?.executionUncertain).toBe(true)
      expect(executor).not.toHaveBeenCalled()
    } finally { await h.dispose() }
  })

  it('rejects recipient/bound changes and serializes simultaneous admission of the same key', async () => {
    const { h, round, request, seats } = await fixture()
    try {
      await expect(h.assistants.scheduleRound({ ...request, bounds: { maxTokensPerRound: 1 } })).rejects.toThrow(/conflict/i)
      await expect(h.assistants.scheduleRound({ ...request, recipients: [seats[0]!.id] })).rejects.toThrow(/conflict/i)
      const [a, b] = await Promise.all([h.assistants.scheduleRound(request), h.assistants.scheduleRound(request)])
      expect(a).toEqual(round)
      expect(b).toEqual(round)
      await expect(h.assistants.scheduleRound({ ...request, id: GroupRoundId('invalid'), bounds: { slotTimeoutMs: 0 } })).rejects.toThrow(/bound/i)
    } finally { await h.dispose() }
  })

  it('rejects a busy agent interval rather than attributing foreign work to a slot', async () => {
    const { h, round } = await fixture(['hang'])
    h.lead.followup(createUserMessage({ content: [{ type: 'text', text: 'Foreign task' }], source: { kind: 'user' } }))
    try {
      await vi.waitFor(() => expect(h.adapter.requests).toHaveLength(1))
      const result = await h.assistants.executeRound(round.id)
      expect(result.slots[0]?.status).toBe('failed')
      expect(result.slots[0]?.error).toMatch(/foreign active/)
      expect(h.adapter.requests[0]!.signal!.aborted).toBe(false)
    } finally { h.lead.cancel({ kind: 'user' }); await h.lead.whenIdle(); await h.dispose() }
  })
})
