/**
 * Tests for Stage C prerequisites: keyed dispatch admission, execution ownership tokens,
 * slot queue holding, keyed cancellation, and foreign ownership conflict detection.
 */

import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { setupAssistantHarness } from './harness.ts'
import { OwnershipConflictError } from '../src/dispatch-ownership.ts'

const SIGNAL = new AbortController().signal

function textBlocks(text: string): ContentBlock[] {
  return [{ type: 'text', text }]
}

async function storedEvents(
  ctx: {
    sessionPersistence: {
      open: (
        id: SessionId,
        mode: 'read',
      ) => Promise<{ read: () => Promise<{ events: readonly { type: string; data?: unknown }[] }>; close: () => Promise<void> }>
    }
  },
  id: SessionId,
) {
  const handle = await ctx.sessionPersistence.open(id, 'read')
  try {
    return (await handle.read()).events
  } finally {
    await handle.close()
  }
}

describe('Stage C prerequisites: dispatch ownership, keyed admission, and cancellation', () => {
  describe('Keyed dispatch admission and deduplication', () => {
    it('persists roundId, slotId, and attemptId to mailbox snapshot and receipt', async () => {
      const harness = await setupAssistantHarness([], {}, { withAgentTeams: true })
      try {
        const { ctx, lead } = harness
        const teamService = ctx.agentTeams

        // Spawn a teammate
        const spawned = await teamService.spawnTeammate(lead, {
          name: 'researcher',
          description: 'Team researcher',
          prompt: textBlocks('You are the researcher.'),
          context: 'fresh',
          provider: 'spawn',
          signal: SIGNAL,
        })
        const targetSessionId = spawned.member.id

        // Send message with keyed dispatch admission
        const result = await teamService.sendMessage(lead, {
          target: 'researcher',
          content: textBlocks('Analyze user requirements.'),
          signal: SIGNAL,
          roundId: 'round-101',
          slotId: 'slot-1',
          attemptId: 'attempt-0',
        })

        expect(result.status).toBe('accepted')
        expect(result.roundId).toBe('round-101')
        expect(result.slotId).toBe('slot-1')
        expect(result.attemptId).toBe('attempt-0')

        // Target session should record the message source with matching keys
        const events = await storedEvents(ctx, targetSessionId)
        const teamMessageEvent = events.find(
          e => e.type === 'user/message' && (e as { data?: { source?: { kind?: string } } })?.data?.source?.kind === 'team-message',
        )
        expect(teamMessageEvent).toBeDefined()

        const source = (
          teamMessageEvent as { data?: { source?: { kind?: string; roundId?: string; slotId?: string; attemptId?: string } } }
        )?.data?.source
        expect(source?.kind).toBe('team-message')
        expect(source?.roundId).toBe('round-101')
        expect(source?.slotId).toBe('slot-1')
        expect(source?.attemptId).toBe('attempt-0')
      } finally {
        await harness.dispose()
      }
    })

    it('deduplicates duplicate sends with the same keys without re-delivery', async () => {
      const harness = await setupAssistantHarness([], {}, { withAgentTeams: true })
      try {
        const { ctx, lead } = harness
        const teamService = ctx.agentTeams

        const spawned = await teamService.spawnTeammate(lead, {
          name: 'analyst',
          description: 'Team analyst',
          prompt: textBlocks('You are the analyst.'),
          context: 'fresh',
          provider: 'spawn',
          signal: SIGNAL,
        })
        const targetSessionId = spawned.member.id

        // First send
        const first = await teamService.sendMessage(lead, {
          target: 'analyst',
          content: textBlocks('Process data batch 1.'),
          signal: SIGNAL,
          roundId: 'round-202',
          slotId: 'slot-data',
          attemptId: 'attempt-1',
        })
        expect(first.status).toBe('accepted')

        // Duplicate send with exact same keys
        const duplicate = await teamService.sendMessage(lead, {
          target: 'analyst',
          content: textBlocks('Process data batch 1.'),
          signal: SIGNAL,
          roundId: 'round-202',
          slotId: 'slot-data',
          attemptId: 'attempt-1',
        })

        // Returns existing receipt with same messageId and status
        expect(duplicate.messageId).toBe(first.messageId)
        expect(duplicate.status).toBe('accepted')
        expect(duplicate.roundId).toBe('round-202')
        expect(duplicate.slotId).toBe('slot-data')
        expect(duplicate.attemptId).toBe('attempt-1')

        // Target session has exactly 1 user/message event for this message, no duplicate delivery
        const stored = await storedEvents(ctx, targetSessionId)
        const targetMessages = stored.filter((e) => {
          if (e.type !== 'user/message') return false
          const s = (e as { data?: { source?: { messageId?: string } } })?.data?.source
          return s?.messageId === first.messageId
        })
        expect(targetMessages).toHaveLength(1)
      } finally {
        await harness.dispose()
      }
    })
  })

  describe('Execution ownership tokens and arbitration', () => {
    it('manages exclusive ownership tokens and supports re-entrancy and delegation', async () => {
      const harness = await setupAssistantHarness()
      try {
        const { assistants } = harness
        const seatSessionId = SessionId('seat-session-1')

        // Acquire ownership for slot-1
        const token1 = assistants.acquireExecutionOwnership({
          roundId: 'round-1',
          slotId: 'slot-1',
          attemptId: 'attempt-0',
          sessionId: seatSessionId,
          ownerId: 'coordinator-lead',
          delegationChain: ['tool-delegator-1'],
        })

        expect(token1.roundId).toBe('round-1')
        expect(token1.slotId).toBe('slot-1')
        expect(assistants.getExecutionOwnership(seatSessionId)).toBe(token1)

        // Re-entrant acquisition by same slot returns active token
        const reentrant = assistants.acquireExecutionOwnership({
          roundId: 'round-1',
          slotId: 'slot-1',
          attemptId: 'attempt-1',
          sessionId: seatSessionId,
          ownerId: 'coordinator-lead',
        })
        expect(reentrant.token).toBe(token1.token)

        // Authorized delegation actor can re-acquire without conflict
        const delegated = assistants.acquireExecutionOwnership({
          roundId: 'round-1',
          slotId: 'slot-1',
          attemptId: 'attempt-0',
          sessionId: seatSessionId,
          ownerId: 'tool-delegator-1',
        })
        expect(delegated.token).toBe(token1.token)

        // Release ownership
        const released = assistants.releaseExecutionOwnership(seatSessionId)
        expect(released).toBe(true)
        expect(assistants.getExecutionOwnership(seatSessionId)).toBeUndefined()
      } finally {
        await harness.dispose()
      }
    })

    it('rejects unresolvable mixed ownership and records conflict state', async () => {
      const harness = await setupAssistantHarness()
      try {
        const { assistants } = harness
        const seatSessionId = SessionId('seat-session-conflict')

        // Slot 1 acquires ownership
        assistants.acquireExecutionOwnership({
          roundId: 'round-1',
          slotId: 'slot-1',
          attemptId: 'attempt-0',
          sessionId: seatSessionId,
          ownerId: 'coordinator-lead',
        })

        // Competing Slot 2 tries to acquire ownership on the same session
        let caughtError: OwnershipConflictError | undefined
        try {
          assistants.acquireExecutionOwnership({
            roundId: 'round-1',
            slotId: 'slot-2',
            attemptId: 'attempt-0',
            sessionId: seatSessionId,
            ownerId: 'competing-slot-2',
          })
        } catch (error) {
          if (error instanceof OwnershipConflictError) {
            caughtError = error
          }
        }

        expect(caughtError).toBeDefined()
        expect(caughtError?.conflict.conflictType).toBe('unresolvable_mixed_ownership')
        expect(caughtError?.conflict.sessionId).toBe(seatSessionId)
        expect(caughtError?.conflict.attemptedBy).toBe('competing-slot-2')

        // Visible conflict state exists
        expect(assistants.hasOwnershipConflict(seatSessionId)).toBe(true)
        const conflicts = assistants.getOwnershipConflicts(seatSessionId)
        expect(conflicts).toHaveLength(1)
        expect(conflicts[0]?.conflictType).toBe('unresolvable_mixed_ownership')

        // Original ownership remains intact
        const active = assistants.getExecutionOwnership(seatSessionId)
        expect(active?.slotId).toBe('slot-1')
      } finally {
        await harness.dispose()
      }
    })
  })

  describe('Slot queue holding and keyed cancellation', () => {
    it('holds slot inputs in the fork-owned queue and removes only unstarted cancelled input', async () => {
      const harness = await setupAssistantHarness()
      try {
        const { assistants } = harness
        const sessionA = SessionId('seat-a')
        const sessionB = SessionId('seat-b')
        const sessionC = SessionId('seat-c')

        // Enqueue three slot inputs
        const inputA = assistants.enqueueSlotInput({
          roundId: 'round-group',
          slotId: 'slot-a',
          attemptId: 'att-0',
          targetSessionId: sessionA,
          payload: { prompt: 'Input for A' },
        })
        const inputB = assistants.enqueueSlotInput({
          roundId: 'round-group',
          slotId: 'slot-b',
          attemptId: 'att-0',
          targetSessionId: sessionB,
          payload: { prompt: 'Input for B' },
        })
        const inputC = assistants.enqueueSlotInput({
          roundId: 'round-group',
          slotId: 'slot-c',
          attemptId: 'att-0',
          targetSessionId: sessionC,
          payload: { prompt: 'Input for C' },
        })

        expect(inputA.status).toBe('queued')
        expect(inputB.status).toBe('queued')
        expect(inputC.status).toBe('queued')
        expect(assistants.listQueuedSlotInputs('round-group')).toHaveLength(3)

        // Cancel slot B while unstarted
        const cancelResult = assistants.cancelSlot('round-group', 'slot-b', 'User cancelled slot B')
        expect(cancelResult.cancelled).toBe(true)
        expect(cancelResult.wasActive).toBe(false)
        expect(cancelResult.item?.status).toBe('cancelled')

        // INVARIANT: Only slot B was removed from the active queue! Slot A and C remain intact
        const remainingQueue = assistants.listQueuedSlotInputs('round-group')
        expect(remainingQueue).toHaveLength(2)
        expect(remainingQueue.map(i => i.slotId)).toEqual(['slot-a', 'slot-c'])

        // Now start slot A
        const { input: activeA, token: tokenA } = assistants.startSlot('round-group', 'slot-a')
        expect(activeA.status).toBe('active')
        expect(assistants.getExecutionOwnership(sessionA)).toBe(tokenA)

        // Cancel active slot A
        const cancelActiveResult = assistants.cancelSlot('round-group', 'slot-a', 'Interrupted during execution')
        expect(cancelActiveResult.cancelled).toBe(true)
        expect(cancelActiveResult.wasActive).toBe(true)
        expect(activeA.abortController.signal.aborted).toBe(true)

        // Keep ownership until the cancelled executor stops.
        expect(assistants.getExecutionOwnership(sessionA)).toBe(tokenA)
        assistants.completeSlot('round-group', 'slot-a')
        expect(assistants.getExecutionOwnership(sessionA)).toBeUndefined()

        // Slot C remains in queue, ready to start
        const { input: activeC, token: tokenC } = assistants.startSlot('round-group', 'slot-c')
        expect(activeC.status).toBe('active')
        expect(assistants.getExecutionOwnership(sessionC)).toBe(tokenC)

        // Slot C completes cleanly
        assistants.completeSlot('round-group', 'slot-c')
        expect(activeC.status).toBe('completed')
        expect(assistants.getExecutionOwnership(sessionC)).toBeUndefined()
      } finally {
        await harness.dispose()
      }
    })
  })

  describe('Covering all submission paths and foreign ownership conflict detection', () => {
    it('Path 1: serializes mailbox delivery behind active ownership until released', async () => {
      const harness = await setupAssistantHarness([], {}, { withAgentTeams: true })
      try {
        const { ctx, lead, assistants } = harness
        const teamService = ctx.agentTeams

        const spawned = await teamService.spawnTeammate(lead, {
          name: 'writer',
          description: 'Team writer',
          prompt: textBlocks('You are the writer.'),
          context: 'fresh',
          provider: 'spawn',
          signal: SIGNAL,
        })
        const writerId = spawned.member.id

        // Slot acquires ownership on writer
        const token = assistants.acquireExecutionOwnership({
          roundId: 'round-exclusive',
          slotId: 'slot-1',
          attemptId: 'att-0',
          sessionId: writerId,
          ownerId: 'slot-worker',
        })

        // Unrelated mailbox message is sent while slot is active
        let messageDelivered = false
        const sendPromise = teamService
          .sendMessage(lead, {
            target: 'writer',
            content: textBlocks('Concurrent message waiting for slot to finish.'),
            signal: SIGNAL,
          })
          .then((res) => {
            messageDelivered = true
            return res
          })

        // Allow microtasks to execute: mailbox message must NOT deliver immediately, it waits behind active ownership
        await new Promise(resolve => setTimeout(resolve, 50))
        expect(messageDelivered).toBe(false)

        // Now release ownership
        assistants.releaseExecutionOwnership(token)

        // Mailbox delivery should now unblock and complete
        const sendResult = await sendPromise
        expect(sendResult.status).toBe('accepted')
        expect(messageDelivered).toBe(true)
      } finally {
        await harness.dispose()
      }
    })

    it('Path 2: detects foreign ownership on ctx.subagents.sendMessage and rejects silent interleaving', async () => {
      const harness = await setupAssistantHarness([], {}, { withAgentTeams: true })
      try {
        const { ctx, lead, assistants } = harness
        const teamService = ctx.agentTeams

        const spawned = await teamService.spawnTeammate(lead, {
          name: 'editor',
          description: 'Team editor',
          prompt: textBlocks('You are the editor.'),
          context: 'fresh',
          provider: 'spawn',
          signal: SIGNAL,
        })
        const editorId = spawned.member.id

        // Acquire exclusive ownership for slot-work
        assistants.acquireExecutionOwnership({
          roundId: 'round-bypass',
          slotId: 'slot-work',
          attemptId: 'att-0',
          sessionId: editorId,
          ownerId: 'slot-worker',
        })

        // Attempt bypass via ctx.subagents.sendMessage from lead without valid token
        let sendError: OwnershipConflictError | undefined
        try {
          await ctx.subagents.sendMessage(lead, editorId, textBlocks('Direct subagent bypass'), {
            signal: SIGNAL,
          })
        } catch (error) {
          if (error instanceof OwnershipConflictError) {
            sendError = error
          }
        }

        expect(sendError).toBeDefined()
        expect(sendError?.conflict.conflictType).toBe('foreign_ownership_detected')
        expect(sendError?.conflict.attemptedBy).toBe('ctx.subagents.sendMessage')

        // Visible conflict state recorded on the session
        expect(assistants.hasOwnershipConflict(editorId)).toBe(true)
        const conflicts = assistants.getOwnershipConflicts(editorId)
        expect(conflicts.some(c => c.conflictType === 'foreign_ownership_detected')).toBe(true)
      } finally {
        await harness.dispose()
      }
    })

    it('Path 3: detects foreign prompt during active slot interval and establishes visible conflict state', async () => {
      const harness = await setupAssistantHarness([textResponse('foreign response')], {}, { withAgentTeams: true })
      try {
        const { ctx, lead, assistants } = harness
        const teamService = ctx.agentTeams

        await teamService.spawnTeammate(lead, {
          name: 'coder',
          description: 'Team coder',
          prompt: textBlocks('You are the coder.'),
          context: 'fresh',
          provider: 'spawn',
          signal: SIGNAL,
        })
        // Start active slot on lead session
        assistants.acquireExecutionOwnership({
          roundId: 'round-prompt-test',
          slotId: 'slot-lead-work',
          attemptId: 'att-0',
          sessionId: lead.id,
          ownerId: 'lead-slot-worker',
        })

        expect(assistants.hasOwnershipConflict(lead.id)).toBe(false)

        // An external prompt arrives on lead during the slot's interval via sessionController.prompt
        const controller = harness.controller
        await controller.prompt(
          {
            requestId: 'req-outside-prompt' as never,
            sessionId: lead.id,
            mode: 'queue',
            content: [{ type: 'text', text: 'Foreign prompt during slot interval' }],
          },
          SIGNAL,
        )

        await lead.whenIdle()

        // Monitor detects foreign input during slot interval and records visible conflict
        expect(assistants.hasOwnershipConflict(lead.id)).toBe(true)
        const leadConflicts = assistants.getOwnershipConflicts(lead.id)
        expect(leadConflicts).toHaveLength(1)
        expect(leadConflicts[0]?.conflictType).toBe('foreign_prompt_during_slot')
        expect(leadConflicts[0]?.attemptedBy).toBe('sessionController.prompt')

        // Clearing conflicts restores clean state
        assistants.clearOwnershipConflicts(lead.id)
        expect(assistants.hasOwnershipConflict(lead.id)).toBe(false)
        expect(assistants.getOwnershipConflicts(lead.id)).toHaveLength(0)
      } finally {
        await harness.dispose()
      }
    })
  })
})
