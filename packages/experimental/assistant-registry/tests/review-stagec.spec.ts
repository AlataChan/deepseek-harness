import { describe, it, expect, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { setupAssistantHarness, type AssistantTestHarness } from './harness.ts'
import {
  DispatchOwnershipManager,
  GroupRoundId,
  DurableRoundJournal,
  GroupDiscussionId,
  GroupMessageId,
  RoundSlotId,
  TeamSeatId,
} from '../src/index.ts'
async function roundFixture() {
  const h = await setupAssistantHarness()
  const p = await h.assistants.createProfile({ name: 'Review coordinator', responsibility: 'Coordinate' })
  const { team, seats } = await h.assistants.createTeamFromTemplate('blank', { coordinatorProfileId: p.id, name: 'Review team' })
  await h.assistants.bindSeatSession(seats[0]!.id, h.lead.id)
  const discussion = await h.assistants.createDiscussion({ teamId: team.id })
  const request = { discussionId: discussion.id, teamId: team.id, prompt: 'Inspect actual records', id: GroupRoundId('review-round') }
  return { h, p, team, seats, discussion, request, round: await h.assistants.scheduleRound(request) }
}
describe('Independent Stage C controls', { timeout: 30000 }, () => {
  it('restores production-service discussions and cursors with the catalog after restart', async () => {
    const { h, p, discussion } = await roundFixture()
    const root = h.storageRoot
    let reopened: AssistantTestHarness | undefined
    try {
      await h.assistants.setReadCursor(discussion.id, 12, 'window-1')
      await h.dispose(true)
      reopened = await setupAssistantHarness([], {}, { storageRoot: root })
      expect(await reopened.assistants.getProfile(p.id)).toBeDefined()
      expect(reopened.assistants.getDiscussion(discussion.id)).toBeDefined()
      expect(reopened.assistants.getReadCursor(discussion.id)?.lastReadSeq).toBe(12)
    } finally {
      await reopened?.dispose()
      const { rmSync } = await import('node:fs')
      rmSync(root, { recursive: true, force: true })
    }
  })
  it('executes real seat work through the production default executor', async () => {
    const { h, round } = await roundFixture()
    try {
      await h.assistants.executeRound(round.id)
      expect(h.lead.session.snapshotEvents().some(e => e.type === 'assistant/message')).toBe(true)
    } finally {
      await h.dispose()
    }
  })
  it('does not re-execute a completed round with the same admission key', async () => {
    const { h, request, round } = await roundFixture()
    let effects = 0
    const executor = async () => {
      effects++
      return { status: 'completed' as const, text: 'Real effect', tokensUsed: 1 }
    }
    try {
      await h.assistants.executeRound(round.id, { executor })
      await h.assistants.scheduleRound(request)
      await h.assistants.executeRound(round.id, { executor })
      expect(effects).toBe(1)
    } finally {
      await h.dispose()
    }
  })
  it('keeps cancellation terminal when an active executor finishes later', async () => {
    const { h, round } = await roundFixture()
    let finish!: () => void
    const barrier = new Promise<void>((r) => {
      finish = r
    })
    let entered = false
    const running = h.assistants.executeRound(round.id, {
      executor: async () => {
        entered = true
        await barrier
        return { status: 'completed', text: 'Late result', tokensUsed: 1 }
      },
    })
    try {
      await vi.waitFor(() => expect(entered).toBe(true))
      await h.assistants.cancelRound(round.id)
      finish()
      await running
      expect(h.assistants.roundScheduler.journal.getRound(round.id)?.status).toBe('cancelled')
    } finally {
      finish()
      await running
      await h.dispose()
    }
  })
  it('cannot release a new ownership lease using a stale token', async () => {
    const ctx = new Context()
    const manager = new DispatchOwnershipManager(ctx)
    try {
      const sessionId = SessionId('lease-session')
      const first = manager.acquireOwnership({ sessionId, roundId: 'a', slotId: 'a', attemptId: '0', ownerId: 'a' })
      manager.releaseOwnership(first)
      const second = manager.acquireOwnership({ sessionId, roundId: 'b', slotId: 'b', attemptId: '0', ownerId: 'b' })
      manager.releaseOwnership(first)
      expect(manager.getOwnership(sessionId)?.token).toBe(second.token)
    } finally {
      await ctx.fiber.dispose()
    }
  })
  it('deduplicates candidates introduced twice within the same review', async () => {
    const h = await setupAssistantHarness()
    try {
      const p = await h.assistants.createProfile({ name: 'Dedup', responsibility: 'Review' })
      const result = await h.assistants.reviewTurn({
        sessionId: h.lead.id,
        scope: { profileId: p.id },
        turnSeq: 1,
        trigger: 'manual',
        candidateMemories: ['The user prefers concise responses', 'The user prefers concise responses'],
      })
      expect(result.addedMemories).toHaveLength(1)
    } finally {
      await h.dispose()
    }
  })
  it('drops failed model predictions and never invents billed usage', async () => {
    const h = await setupAssistantHarness([], { enableComposerPredictions: true })
    try {
      const result = await h.assistants.predictComposer({ sessionId: h.lead.id, asOfSeq: 1 })
      expect(result).toBeNull()
      expect(h.assistants.usage.getAuxiliaryRecords(h.lead.id)).toHaveLength(0)
    } finally {
      await h.dispose()
    }
  })
  it('accounts for actual failed-attempt usage stored in stream frames', async () => {
    const h = await setupAssistantHarness([
      [
        { type: 'usage', usage: { inputTokens: 7, outputTokens: 4, totalTokens: 11 } },
        { type: 'finish', reason: { kind: 'error', failure: { code: 'SERVER', message: 'Synthetic provider failure' } } },
      ],
    ])
    try {
      h.lead.followup(createUserMessage({ content: [{ type: 'text', text: 'Test usage' }], source: { kind: 'user' } }))
      await h.lead.whenIdle()
      const events = h.lead.session.snapshotEvents()
      expect(events.some(e => e.type === 'assistant/attempt')).toBe(true)
      expect(h.assistants.usage.foldSessionUsage(h.lead.id, 'binding', 0, events).totalTokens.totalTokens).toBe(11)
    } finally {
      await h.dispose()
    }
  })
  it('refuses own coordinator dispatch under foreign execution ownership', async () => {
    const { h, team } = await roundFixture()
    try {
      await h.assistants.updateTeam(team.id, team.revision, { leadSessionId: h.lead.id })
      h.assistants.ownership.acquireOwnership({
        sessionId: h.lead.id,
        roundId: 'owned-round',
        slotId: 'owned-slot',
        attemptId: '0',
        ownerId: 'owner',
      })
      await expect(
        h.assistants.dispatchCoordinator(team.id, {
          requestId: 'foreign-review' as never,
          sessionId: h.lead.id,
          mode: 'queue',
          content: [{ type: 'text', text: 'foreign prompt' }],
        }),
      ).rejects.toThrow(/ownership|conflict/i)
    } finally {
      await h.dispose()
    }
  })
  it('does not mark a failed disk publication as committed or deduplicated', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const path = mkdtempSync(join(tmpdir(), 'review-journal-failure-'))
    try {
      const journal = new DurableRoundJournal({ storagePath: path })
      const roundId = GroupRoundId('round')
      const slotId = RoundSlotId('slot')
      await expect(
        journal.appendTranscriptMessage({
          id: GroupMessageId('msg'),
          discussionId: GroupDiscussionId('disc'),
          roundId,
          slotId,
          authorSeatId: TeamSeatId('seat'),
          authorName: 'Author',
          text: 'reply',
          sourceSessionId: SessionId('session'),
          sourceEventSeq: 1,
          createdAt: 1,
        }),
      ).rejects.toThrow()
      expect(journal.getPostedMessageId(roundId, slotId)).toBeUndefined()
    } finally {
      rmSync(path, { recursive: true, force: true })
    }
  })
})
