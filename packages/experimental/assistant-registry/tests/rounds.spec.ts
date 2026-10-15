/**
 * Tests for S22: Group rounds and public transcript.
 * Verifies round scheduler (coordinator-first, explicit recipients, bounded seats/handoffs/tokens),
 * per-seat committed cursors so later speakers see earlier public replies, durable round journal
 * with terminal states per slot, and paginated authorized message/result projection with per-message
 * source attribution.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { setupAssistantHarness } from './harness.ts'
import {
  RoundSlotId,
  RoundBoundsExceededError,
  ScopeAccessError,
  DurableRoundJournal,
  type GroupTranscriptMessage,
  type SlotExecutionResult,
} from '../src/index.ts'

describe('S22: Group rounds and public transcript', () => {
  it('schedules coordinator-first by default, ignoring accidental mentions in prompt text', async () => {
    const harness = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const { assistants } = harness
      await assistants.initCatalog()

      // Create coordinator and researcher profiles
      const coordProfile = await assistants.createProfile({
        name: 'Coordinator',
        responsibility: 'Coordinate team discussion',
      })
      const researcherProfile = await assistants.createProfile({
        name: 'Researcher',
        responsibility: 'Research data',
      })

      // Create team
      const team = await assistants.createTeam({
        name: 'Alpha Team',
        coordinatorProfileId: coordProfile.id,
      })

      // Create seats
      const coordSeat = await assistants.createSeat({
        teamId: team.id,
        profileId: coordProfile.id,
        role: 'coordinator',
        name: 'Lead Coord',
        duty: 'Coordinate',
      })
      const researcherSeat = await assistants.createSeat({
        teamId: team.id,
        profileId: researcherProfile.id,
        role: 'teammate',
        name: 'Data Researcher',
        duty: 'Analyze data',
      })

      // Create group discussion
      const discussion = await assistants.createDiscussion({
        teamId: team.id,
        title: 'Project Kickoff',
      })

      // Plain prompt containing mentions of @Data Researcher
      const round = await assistants.scheduleRound({
        discussionId: discussion.id,
        teamId: team.id,
        prompt: 'Hello @Data Researcher, please summarize the dataset.',
      })

      // Coordinator-first rule:
      // Only 1 slot is scheduled, and it is the coordinator!
      // In-prompt text reference did NOT accidentally dispatch the researcher.
      expect(round.status).toBe('pending')
      expect(researcherSeat.id).toBeDefined()
      expect(round.slots).toHaveLength(1)
      expect(round.slots[0]?.seatId).toBe(coordSeat.id)
      expect(round.slots[0]?.seatRole).toBe('coordinator')
      expect(round.slots[0]?.seatName).toBe('Lead Coord')
    } finally {
      await harness.dispose()
    }
  })

  it('routes to explicit recipients in exact specified order', async () => {
    const harness = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const { assistants } = harness
      await assistants.initCatalog()

      const p1 = await assistants.createProfile({ name: 'P1', responsibility: 'R1' })
      const p2 = await assistants.createProfile({ name: 'P2', responsibility: 'R2' })
      const p3 = await assistants.createProfile({ name: 'P3', responsibility: 'R3' })

      const team = await assistants.createTeam({ name: 'Beta Team', coordinatorProfileId: p1.id })
      const s1 = await assistants.createSeat({ teamId: team.id, profileId: p1.id, role: 'coordinator', name: 'Seat 1', duty: 'D1' })
      const s2 = await assistants.createSeat({ teamId: team.id, profileId: p2.id, role: 'teammate', name: 'Seat 2', duty: 'D2' })
      const s3 = await assistants.createSeat({ teamId: team.id, profileId: p3.id, role: 'teammate', name: 'Seat 3', duty: 'D3' })

      const discussion = await assistants.createDiscussion({ teamId: team.id })

      // Explicit recipient chips: [s3, s2]
      const round = await assistants.scheduleRound({
        discussionId: discussion.id,
        teamId: team.id,
        prompt: 'Review findings',
        recipients: [s3.id, s2.id],
      })

      expect(s1.id).toBeDefined()
      expect(round.slots).toHaveLength(2)
      expect(round.slots[0]?.seatId).toBe(s3.id)
      expect(round.slots[0]?.seatName).toBe('Seat 3')
      expect(round.slots[1]?.seatId).toBe(s2.id)
      expect(round.slots[1]?.seatName).toBe('Seat 2')
    } finally {
      await harness.dispose()
    }
  })

  it('enforces hard bounds on seats, handoffs, and cumulative tokens', async () => {
    const harness = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const { assistants } = harness
      await assistants.initCatalog()

      const p1 = await assistants.createProfile({ name: 'P1', responsibility: 'R1' })
      const team = await assistants.createTeam({ name: 'Bounds Team', coordinatorProfileId: p1.id })
      const s1 = await assistants.createSeat({ teamId: team.id, profileId: p1.id, role: 'coordinator', name: 'Seat 1', duty: 'D1' })
      const s2 = await assistants.createSeat({ teamId: team.id, profileId: p1.id, role: 'teammate', name: 'Seat 2', duty: 'D2' })
      const s3 = await assistants.createSeat({ teamId: team.id, profileId: p1.id, role: 'teammate', name: 'Seat 3', duty: 'D3' })

      const discussion = await assistants.createDiscussion({ teamId: team.id })

      // 1. Seat limit bound
      await expect(
        assistants.scheduleRound({
          discussionId: discussion.id,
          teamId: team.id,
          prompt: 'Exceeding seats',
          recipients: [s1.id, s2.id, s3.id],
          bounds: { maxSeatsPerRound: 2 },
        }),
      ).rejects.toThrow(RoundBoundsExceededError)

      // 2. Handoff bound: maxHandoffsPerRound = 1
      const handoffRound = await assistants.scheduleRound({
        discussionId: discussion.id,
        teamId: team.id,
        prompt: 'Testing handoffs',
        recipients: [s1.id],
        bounds: { maxHandoffsPerRound: 1, maxSeatsPerRound: 5 },
      })

      // Mock executor where each speaker tries to hand off to next
      const executedHandoff = await assistants.executeRound(handoffRound.id, {
        executor: async (slot): Promise<SlotExecutionResult> => {
          if (slot.seatId === s1.id) {
            return {
              status: 'completed',
              text: 'S1 handing off to S2',
              handoffTo: s2.id,
              tokensUsed: 100,
            }
          }
          if (slot.seatId === s2.id) {
            return {
              status: 'completed',
              text: 'S2 attempting second handoff to S3',
              handoffTo: s3.id,
              tokensUsed: 100,
            }
          }
          return { status: 'completed', text: 'S3 reply', tokensUsed: 100 }
        },
      })

      // First handoff from S1 to S2 was scheduled; second handoff from S2 to S3 was bounded and refused!
      expect(executedHandoff.handoffCount).toBe(1)
      expect(executedHandoff.slots).toHaveLength(2)
      expect(executedHandoff.slots[0]?.seatId).toBe(s1.id)
      expect(executedHandoff.slots[1]?.seatId).toBe(s2.id)

      // 3. Token bound: maxTokensPerRound = 200
      const tokenRound = await assistants.scheduleRound({
        discussionId: discussion.id,
        teamId: team.id,
        prompt: 'Testing token budget',
        recipients: [s1.id, s2.id, s3.id],
        bounds: { maxTokensPerRound: 200 },
      })

      const executedTokenRound = await assistants.executeRound(tokenRound.id, {
        executor: async (slot): Promise<SlotExecutionResult> => {
          // Slot 0 consumes 250 tokens, exceeding maxTokensPerRound (200)
          return {
            status: 'completed',
            text: `Reply from ${slot.seatName}`,
            tokensUsed: 250,
          }
        },
      })

      // Slot 0 completed; slot 1 and 2 were cancelled due to token limit
      expect(executedTokenRound.slots[0]?.status).toBe('completed')
      expect(executedTokenRound.slots[1]?.status).toBe('cancelled')
      expect(executedTokenRound.slots[1]?.error).toContain('Round token limit reached')
      expect(executedTokenRound.slots[2]?.status).toBe('cancelled')
      expect(executedTokenRound.status).toBe('completed')
    } finally {
      await harness.dispose()
    }
  })

  it('maintains per-seat committed cursors so later speakers observe earlier public replies', async () => {
    const harness = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const { assistants } = harness
      await assistants.initCatalog()

      const p1 = await assistants.createProfile({ name: 'Speaker 1', responsibility: 'First' })
      const p2 = await assistants.createProfile({ name: 'Speaker 2', responsibility: 'Second' })
      const team = await assistants.createTeam({ name: 'Cursor Team', coordinatorProfileId: p1.id })
      const s1 = await assistants.createSeat({ teamId: team.id, profileId: p1.id, role: 'coordinator', name: 'Seat 1', duty: 'D1' })
      const s2 = await assistants.createSeat({ teamId: team.id, profileId: p2.id, role: 'teammate', name: 'Seat 2', duty: 'D2' })

      const discussion = await assistants.createDiscussion({ teamId: team.id })

      const observedTranscripts: { slotIndex: number; visible: readonly GroupTranscriptMessage[] }[] = []

      const round = await assistants.scheduleRound({
        discussionId: discussion.id,
        teamId: team.id,
        prompt: 'Sequential collaboration test',
        recipients: [s1.id, s2.id],
      })

      const completed = await assistants.executeRound(round.id, {
        executor: async (slot, visibleTranscript): Promise<SlotExecutionResult> => {
          observedTranscripts.push({
            slotIndex: slot.slotIndex,
            visible: visibleTranscript,
          })
          return {
            status: 'completed',
            text: `Public reply from ${slot.seatName} (saw ${visibleTranscript.length} earlier messages)`,
            tokensUsed: 50,
            sourceSessionId: slot.sessionId,
            sourceEventSeq: 1,
          }
        },
      })

      expect(completed.status).toBe('completed')
      expect(observedTranscripts).toHaveLength(2)

      // Slot 0 ran with initial transcript (0 messages)
      expect(observedTranscripts[0]?.slotIndex).toBe(0)
      expect(observedTranscripts[0]?.visible).toHaveLength(0)

      // Slot 1 ran after Slot 0 completed and committed its reply:
      // Its committed cursor observed Slot 0's reply!
      expect(observedTranscripts[1]?.slotIndex).toBe(1)
      expect(observedTranscripts[1]?.visible).toHaveLength(1)
      expect(observedTranscripts[1]?.visible[0]?.authorSeatId).toBe(s1.id)
      expect(observedTranscripts[1]?.visible[0]?.text).toContain('Public reply from Seat 1')

      // Final public transcript contains both messages in order
      const transcript = await assistants.queryPublicTranscript({ discussionId: discussion.id })
      expect(transcript.items).toHaveLength(2)
      expect(transcript.items[0]?.authorSeatId).toBe(s1.id)
      expect(transcript.items[1]?.authorSeatId).toBe(s2.id)
    } finally {
      await harness.dispose()
    }
  })

  it('tracks terminal states per slot in durable journal, including uncertain state without auto-retry', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'dsh-rounds-journal-'))
    const journalPath = join(tmpDir, 'rounds.json')
    const harness = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const { assistants, ctx } = harness
      await assistants.initCatalog()

      const p1 = await assistants.createProfile({ name: 'P1', responsibility: 'R1' })
      const team = await assistants.createTeam({ name: 'Journal Team', coordinatorProfileId: p1.id })
      const s1 = await assistants.createSeat({ teamId: team.id, profileId: p1.id, role: 'coordinator', name: 'Seat 1', duty: 'D1' })
      const s2 = await assistants.createSeat({ teamId: team.id, profileId: p1.id, role: 'teammate', name: 'Seat 2', duty: 'D2' })
      const s3 = await assistants.createSeat({ teamId: team.id, profileId: p1.id, role: 'teammate', name: 'Seat 3', duty: 'D3' })
      const s4 = await assistants.createSeat({ teamId: team.id, profileId: p1.id, role: 'teammate', name: 'Seat 4', duty: 'D4' })

      // Custom round scheduler with storagePath
      const { GroupRoundScheduler } = await import('../src/rounds.ts')
      const scheduler = new GroupRoundScheduler(ctx, assistants.ownership, {
        catalog: assistants.catalog,
        storagePath: journalPath,
      })
      await scheduler.init()

      const discussion = await scheduler.createDiscussion({
        teamId: team.id,
        title: 'Terminal States Discussion',
      })

      const round = await scheduler.scheduleRound({
        discussionId: discussion.id,
        teamId: team.id,
        prompt: 'Testing terminal states',
        recipients: [s1.id, s2.id, s3.id, s4.id],
      })

      let slot2Executions = 0

      const finishedRound = await scheduler.executeRound(round.id, {
        executor: async (slot): Promise<SlotExecutionResult> => {
          if (slot.seatId === s1.id) {
            // Slot 1: silent
            return { status: 'silent', tokensUsed: 10 }
          }
          if (slot.seatId === s2.id) {
            slot2Executions++
            // Slot 2: uncertain side-effects (timeout/unconfirmed)
            return {
              status: 'uncertain',
              executionUncertain: true,
              uncertainExplanation: '执行结果待确认',
              tokensUsed: 40,
            }
          }
          if (slot.seatId === s3.id) {
            // Slot 3: failed
            return {
              status: 'failed',
              error: 'Downstream service error',
              tokensUsed: 5,
            }
          }
          // Slot 4: completed
          return {
            status: 'completed',
            text: 'Seat 4 completed normally',
            tokensUsed: 60,
          }
        },
      })

      // Verify slot terminal states
      expect(finishedRound.slots[0]?.status).toBe('silent')
      expect(finishedRound.slots[1]?.status).toBe('uncertain')
      expect(finishedRound.slots[1]?.executionUncertain).toBe(true)
      expect(finishedRound.slots[1]?.uncertainExplanation).toBe('执行结果待确认')
      // Proven: No automatic retry occurred for uncertain slot!
      expect(slot2Executions).toBe(1)

      expect(finishedRound.slots[2]?.status).toBe('failed')
      expect(finishedRound.slots[2]?.error).toBe('Downstream service error')

      expect(finishedRound.slots[3]?.status).toBe('completed')

      // Reload journal from disk into a fresh instance to prove durability
      const restoredJournal = new DurableRoundJournal({ storagePath: journalPath })
      await restoredJournal.load()

      const restoredRound = restoredJournal.getRound(round.id)
      expect(restoredRound).toBeDefined()
      expect(restoredRound?.slots[0]?.status).toBe('silent')
      expect(restoredRound?.slots[1]?.status).toBe('uncertain')
      expect(restoredRound?.slots[1]?.executionUncertain).toBe(true)
      expect(restoredRound?.slots[2]?.status).toBe('failed')
      expect(restoredRound?.slots[3]?.status).toBe('completed')
    } finally {
      await harness.dispose()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('deduplicates public posting and supports publishing committed replies on crash recovery', async () => {
    const harness = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const { assistants } = harness
      await assistants.initCatalog()

      const p1 = await assistants.createProfile({ name: 'Lead', responsibility: 'Lead' })
      const team = await assistants.createTeam({ name: 'Dedup Team', coordinatorProfileId: p1.id })
      const s1 = await assistants.createSeat({ teamId: team.id, profileId: p1.id, role: 'coordinator', name: 'Seat 1', duty: 'D1' })

      const discussion = await assistants.createDiscussion({ teamId: team.id })
      const round = await assistants.scheduleRound({
        discussionId: discussion.id,
        teamId: team.id,
        prompt: 'Dedup test',
      })

      const slotId = round.slots[0]?.slotId ?? RoundSlotId('slot-0')

      // 1. Post public reply
      const post1 = await assistants.roundScheduler.postPublicReply(round.id, slotId, {
        text: 'Hello world',
        authorSeatId: s1.id,
        authorName: 'Seat 1',
        sourceSessionId: SessionId('ses-lead'),
        sourceEventSeq: 10,
      })

      // 2. Duplicate post call with identical (roundId, slotId)
      const post2 = await assistants.roundScheduler.postPublicReply(round.id, slotId, {
        text: 'Different text attempting duplicate',
        authorSeatId: s1.id,
        authorName: 'Seat 1',
        sourceSessionId: SessionId('ses-lead'),
        sourceEventSeq: 11,
      })

      // Deduplicated: returns the original message, transcript length is strictly 1
      expect(post2.id).toBe(post1.id)
      expect(post2.text).toBe('Hello world')

      const transcript = await assistants.queryPublicTranscript({ discussionId: discussion.id })
      expect(transcript.items).toHaveLength(1)
      expect(transcript.items[0]?.id).toBe(post1.id)

      // 3. Crash recovery: publish committed reply without re-running model/tools
      const recoveryRound = await assistants.scheduleRound({
        discussionId: discussion.id,
        teamId: team.id,
        prompt: 'Recovery prompt',
      })
      const recSlotId = recoveryRound.slots[0]?.slotId ?? RoundSlotId('slot-0')

      // Simulate slot halted with committedReply recorded before publication
      await assistants.roundScheduler.journal.saveRound({
        ...recoveryRound,
        slots: recoveryRound.slots.map(s =>
          s.slotId === recSlotId
            ? {
              ...s,
              status: 'pending',
              committedReply: {
                text: 'Committed response from recovered slot',
                sourceSessionId: SessionId('ses-rec'),
                sourceEventSeq: 42,
              },
            }
            : s,
        ),
      })

      const published = await assistants.publishCommittedReply(recoveryRound.id, recSlotId)
      expect(published.text).toBe('Committed response from recovered slot')
      expect(published.sourceEventSeq).toBe(42)

      const updatedTranscript = await assistants.queryPublicTranscript({ discussionId: discussion.id })
      expect(updatedTranscript.items).toHaveLength(2)
      expect(updatedTranscript.items[1]?.id).toBe(published.id)
    } finally {
      await harness.dispose()
    }
  })

  it('supports paginated authorized message projection with per-message source attribution', async () => {
    const harness = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const { assistants } = harness
      await assistants.initCatalog()

      const p1 = await assistants.createProfile({ name: 'P1', responsibility: 'R1' })
      const teamA = await assistants.createTeam({ name: 'Team A', coordinatorProfileId: p1.id })
      const teamB = await assistants.createTeam({ name: 'Team B', coordinatorProfileId: p1.id })

      const seatA = await assistants.createSeat({ teamId: teamA.id, profileId: p1.id, role: 'coordinator', name: 'Seat A', duty: 'DA' })
      const seatB = await assistants.createSeat({ teamId: teamB.id, profileId: p1.id, role: 'coordinator', name: 'Seat B', duty: 'DB' })

      const discussionA = await assistants.createDiscussion({ teamId: teamA.id, title: 'Discussion A' })

      // Generate 5 messages in discussionA
      for (let i = 0; i < 5; i++) {
        const round = await assistants.scheduleRound({
          discussionId: discussionA.id,
          teamId: teamA.id,
          prompt: `Message ${i}`,
        })
        const slotId = round.slots[0]?.slotId ?? RoundSlotId('slot-0')
        await assistants.roundScheduler.postPublicReply(round.id, slotId, {
          text: `Public content ${i}`,
          authorSeatId: seatA.id,
          authorName: seatA.name,
          authorRole: seatA.role,
          sourceSessionId: SessionId(`ses-step-${i}`),
          sourceEventSeq: i + 1,
        })
      }

      // 1. Authorized query succeeds and verifies source attribution
      const page1 = await assistants.queryPublicTranscript({
        discussionId: discussionA.id,
        teamId: teamA.id,
        callerSeatId: seatA.id,
        limit: 2,
      })

      expect(page1.items).toHaveLength(2)
      expect(page1.hasMore).toBe(true)
      expect(page1.nextCursor).toBeDefined()

      // Source attribution checks
      const msg0 = page1.items[0]
      expect(msg0?.sourceSessionId).toBe('ses-step-0')
      expect(msg0?.sourceEventSeq).toBe(1)
      expect(msg0?.authorSeatId).toBe(seatA.id)
      expect(msg0?.authorName).toBe('Seat A')
      expect(msg0?.authorRole).toBe('coordinator')
      expect(msg0?.text).toBe('Public content 0')
      expect(msg0?.createdAt).toBeGreaterThan(0)

      // 2. Pagination: Page 2 using cursor
      const page2 = await assistants.queryPublicTranscript({
        discussionId: discussionA.id,
        teamId: teamA.id,
        cursor: page1.nextCursor,
        limit: 2,
      })

      expect(page2.items).toHaveLength(2)
      expect(page2.items[0]?.text).toBe('Public content 2')
      expect(page2.items[1]?.text).toBe('Public content 3')
      expect(page2.hasMore).toBe(true)

      // Page 3: final item
      const page3 = await assistants.queryPublicTranscript({
        discussionId: discussionA.id,
        cursor: page2.nextCursor,
        limit: 2,
      })
      expect(page3.items).toHaveLength(1)
      expect(page3.items[0]?.text).toBe('Public content 4')
      expect(page3.hasMore).toBe(false)
      expect(page3.nextCursor).toBeUndefined()

      // 3. Unauthorized access check: seat from Team B cannot query Discussion A
      await expect(
        assistants.queryPublicTranscript({
          discussionId: discussionA.id,
          callerSeatId: seatB.id,
        }),
      ).rejects.toThrow(ScopeAccessError)

      // Query with mismatched teamId throws ScopeAccessError
      await expect(
        assistants.queryPublicTranscript({
          discussionId: discussionA.id,
          teamId: teamB.id,
        }),
      ).rejects.toThrow(ScopeAccessError)
    } finally {
      await harness.dispose()
    }
  })

  it('cancels active and pending slot inputs cleanly without affecting other slots', async () => {
    const harness = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const { assistants } = harness
      await assistants.initCatalog()

      const p1 = await assistants.createProfile({ name: 'Lead', responsibility: 'Lead' })
      const team = await assistants.createTeam({ name: 'Cancel Team', coordinatorProfileId: p1.id })
      const s1 = await assistants.createSeat({ teamId: team.id, profileId: p1.id, role: 'coordinator', name: 'Seat 1', duty: 'D1' })
      const s2 = await assistants.createSeat({ teamId: team.id, profileId: p1.id, role: 'teammate', name: 'Seat 2', duty: 'D2' })

      const discussion = await assistants.createDiscussion({ teamId: team.id })
      const round = await assistants.scheduleRound({
        discussionId: discussion.id,
        teamId: team.id,
        prompt: 'To be cancelled',
        recipients: [s1.id, s2.id],
      })

      // Cancel before execution starts
      const cancelled = await assistants.cancelRound(round.id, 'User clicked stop')
      expect(cancelled.status).toBe('cancelled')
      expect(cancelled.error).toBe('User clicked stop')
      expect(cancelled.slots[0]?.status).toBe('cancelled')
      expect(cancelled.slots[1]?.status).toBe('cancelled')

      // Discussion activeRoundId is cleared
      const disc = assistants.getDiscussion(discussion.id)
      expect(disc?.activeRoundId).toBeUndefined()
    } finally {
      await harness.dispose()
    }
  })
})
