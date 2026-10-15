/**
 * Tests for S23: Read cursors, scoped search, and usage aggregation.
 * Verifies durable read cursors per logical conversation for cross-window unread state,
 * session-query adapter restricted to permitted session bindings with stable attribution,
 * and usage aggregation including auxiliary calls (new fold) that excludes inherited fork history
 * from duplicate charging by counting only events after each binding's start boundary.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { MessageId } from '@deepseek-ai/dsh-llm'
import { setupAssistantHarness } from './harness.ts'
import {
  ScopeAccessError,
  DurableReadCursorManager,
  type AuxiliaryUsageRecord,
} from '../src/index.ts'

describe('S23: Read cursors, scoped search, and usage aggregation', () => {
  describe('Durable read cursors for cross-window unread state', () => {
    it('manages read cursors monotonically across windows and computes unread count', async () => {
      const harness = await setupAssistantHarness([], {}, { withCatalog: true })
      try {
        const { assistants } = harness
        const convId = 'conv-cross-window-test'

        // Initially no cursor -> unread count is all events up to latestSeq
        expect(assistants.getReadCursor(convId)).toBeUndefined()
        expect(assistants.getUnreadCount(convId, 10)).toBe(11) // latestSeq 10 - (-1) = 11

        // Window 1 reads up to seq 5
        const cur1 = await assistants.setReadCursor(convId, 5, 'window-1')
        expect(cur1.lastReadSeq).toBe(5)
        expect(cur1.windowId).toBe('window-1')
        expect(assistants.getUnreadCount(convId, 10)).toBe(5) // 10 - 5 = 5

        // Window 2 reads up to seq 8
        const cur2 = await assistants.setReadCursor(convId, 8, 'window-2')
        expect(cur2.lastReadSeq).toBe(8)
        expect(cur2.windowId).toBe('window-2')
        expect(assistants.getUnreadCount(convId, 10)).toBe(2) // 10 - 8 = 2

        // Stale window 1 attempts to set an older seq 4; cursor must not rewind
        const cur3 = await assistants.setReadCursor(convId, 4, 'window-1')
        expect(cur3.lastReadSeq).toBe(8)
        expect(assistants.getUnreadCount(convId, 10)).toBe(2)

        // Read all up to 10
        await assistants.setReadCursor(convId, 10, 'window-2')
        expect(assistants.getUnreadCount(convId, 10)).toBe(0)
      } finally {
        await harness.dispose()
      }
    })

    it('persists read cursors durably to disk surviving restart', async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'dsh-cursors-test-'))
      const storagePath = join(tmpDir, 'read-cursors.json')
      try {
        const manager1 = new DurableReadCursorManager({ storagePath })
        await manager1.setReadCursor('conv-1', 42, 'win-main')
        await manager1.setReadCursor('conv-2', 99, 'win-side')

        // Fresh instance reading from disk (simulating restart)
        const manager2 = new DurableReadCursorManager({ storagePath })
        await manager2.load()

        const c1 = manager2.getReadCursor('conv-1')
        expect(c1).toBeDefined()
        expect(c1?.lastReadSeq).toBe(42)
        expect(c1?.windowId).toBe('win-main')

        const c2 = manager2.getReadCursor('conv-2')
        expect(c2).toBeDefined()
        expect(c2?.lastReadSeq).toBe(99)
        expect(c2?.windowId).toBe('win-side')
      } finally {
        rmSync(tmpDir, { recursive: true, force: true })
      }
    })
  })

  describe('Scoped session-query adapter and stable attribution', () => {
    it('restricts queries and searches strictly to permitted sessions and rejects cross-scope access', async () => {
      const harness = await setupAssistantHarness([], {}, { withCatalog: true })
      try {
        const { assistants, ctx } = harness
        await assistants.initCatalog()

        // Create Profile A with Conversation A
        const profileA = await assistants.createProfile({
          name: 'Analyst A',
          responsibility: 'Analysis',
        })
        const sessionA = SessionId('ses-profile-a')
        const convA = await assistants.createConversation(profileA.id, {
          rootSessionId: sessionA,
          title: 'Topic A',
        })

        // Create Profile B with Conversation B
        const profileB = await assistants.createProfile({
          name: 'Designer B',
          responsibility: 'Design',
        })
        const sessionB = SessionId('ses-profile-b')
        await assistants.createConversation(profileB.id, {
          rootSessionId: sessionB,
          title: 'Topic B',
        })

        // Write events into session persistence for both sessions
        const persistence = ctx.get('sessionPersistence')
        expect(persistence).toBeDefined()
        const liveA = ctx.sessions.create(sessionA)
        const handleA = await persistence!.create(liveA.header)
        try {
          await handleA.append([
            {
              type: 'user/message',
              seq: 0 as never,
              time: 1000,
              surfaceOp: 'append',
              data: {
                id: MessageId('u-a-1'),
                role: 'user',
                source: { kind: 'user' },
                content: [{ type: 'text', text: 'Quarterly financial report forecast' }],
              },
            },
            {
              type: 'user/message',
              seq: 1 as never,
              time: 1001,
              surfaceOp: 'append',
              data: {
                id: MessageId('u-a-2'),
                role: 'user',
                source: { kind: 'user' },
                content: [{ type: 'text', text: 'The forecast projects 15% revenue growth in Q3.' }],
              },
            },
          ])
        } finally {
          await handleA.close()
        }

        const liveB = ctx.sessions.create(sessionB)
        const handleB = await persistence!.create(liveB.header)
        try {
          await handleB.append([
            {
              type: 'user/message',
              seq: 0 as never,
              time: 1000,
              surfaceOp: 'append',
              data: {
                id: MessageId('u-b-1'),
                role: 'user',
                source: { kind: 'user' },
                content: [{ type: 'text', text: 'Color palette and layout tokens' }],
              },
            },
            {
              type: 'user/message',
              seq: 1 as never,
              time: 1001,
              surfaceOp: 'append',
              data: {
                id: MessageId('u-b-2'),
                role: 'user',
                source: { kind: 'user' },
                content: [{ type: 'text', text: 'The forecast for design systems uses emerald tokens.' }],
              },
            },
          ])
        } finally {
          await handleB.close()
        }

        // 1. Scoped query under Profile A authorization
        const authA = { profileId: profileA.id, conversationId: convA.id }

        // Searching for 'forecast' under Profile A:
        const searchHits = await assistants.searchEventsScoped(
          { query: 'forecast' },
          authA,
        )

        // Must match ONLY session A, never session B!
        expect(searchHits).toHaveLength(2)
        expect(searchHits.every(h => h.sessionId === sessionA)).toBe(true)

        // Stable attribution check on hit
        const hit = searchHits[0]
        expect(hit?.attribution.conversationId).toBe(convA.id)
        expect(hit?.attribution.profileId).toBe(profileA.id)
        expect(hit?.attribution.authorName).toBe('Analyst A')
        expect(hit?.attribution.sessionId).toBe(sessionA)

        // 2. Cross-scope observation attempt: Profile A caller trying to observe session B
        await expect(
          assistants.observeSessionScoped(sessionB, authA),
        ).rejects.toThrow(ScopeAccessError)
      } finally {
        await harness.dispose()
      }
    })

    it('attaches stable team seat attribution for team discussion searches', async () => {
      const harness = await setupAssistantHarness([], {}, { withCatalog: true })
      try {
        const { assistants, ctx } = harness
        await assistants.initCatalog()

        const profile = await assistants.createProfile({ name: 'Expert', responsibility: 'Tech' })
        const team = await assistants.createTeam({ name: 'Dev Squad', coordinatorProfileId: profile.id })
        const seatSession = SessionId('ses-seat-coder')
        const seat = await assistants.createSeat({
          teamId: team.id,
          profileId: profile.id,
          role: 'teammate',
          name: 'Frontend Lead',
          duty: 'Build UI components',
        })
        await assistants.catalog?.updateSeat(seat.id, {
          activeInstanceId: seatSession,
        })

        const persistence = ctx.get('sessionPersistence')
        expect(persistence).toBeDefined()
        const liveSeat = ctx.sessions.create(seatSession)
        const handle = await persistence!.create(liveSeat.header)
        try {
          await handle.append([
            {
              type: 'user/message',
              seq: 0 as never,
              time: 2000,
              surfaceOp: 'append',
              data: {
                id: MessageId('u-seat'),
                role: 'user',
                source: { kind: 'user' },
                content: [{ type: 'text', text: 'Refactored component architecture successfully' }],
              },
            },
          ])
        } finally {
          await handle.close()
        }

        const searchHits = await assistants.searchEventsScoped(
          { query: 'Refactored' },
          { teamId: team.id },
        )

        expect(searchHits).toHaveLength(1)
        const hit = searchHits[0]
        expect(hit?.attribution.teamId).toBe(team.id)
        expect(hit?.attribution.seatId).toBe(seat.id)
        expect(hit?.attribution.authorName).toBe('Frontend Lead')
        expect(hit?.attribution.authorRole).toBe('teammate')
      } finally {
        await harness.dispose()
      }
    })
  })

  describe('Usage aggregation with auxiliary calls and inherited fork exclusion (new fold)', () => {
    it('strictly excludes inherited fork history from duplicate charging by counting only events after start boundary', async () => {
      const harness = await setupAssistantHarness([])
      try {
        const { assistants } = harness
        const sessionId = SessionId('ses-forked-agent')

        // Mock events:
        // Seq 0..2 are inherited from ancestor fork (e.g. 500 input + 200 output tokens)
        // Fork startBoundarySeq is 3.
        // Seq 3..4 are fresh events in this binding (100 input + 50 output tokens)
        const events: SessionEvent[] = [
          {
            type: 'turn/start',
            seq: 0 as never,
            time: 1000,
            data: { turn: 1 },
          },
          {
            type: 'assistant/message',
            seq: 1 as never,
            time: 1005,
            surfaceOp: 'append',
            data: {
              turn: 1,
              step: 1,
              stream: [],
              message: {
                id: MessageId('m-1'),
                role: 'assistant',
                source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
                content: [{ type: 'text', text: 'ancestor reply 1' }],
              },
              usage: { inputTokens: 300, outputTokens: 120, totalTokens: 420 },
            },
          },
          {
            type: 'assistant/message',
            seq: 2 as never,
            time: 1010,
            surfaceOp: 'append',
            data: {
              turn: 1,
              step: 2,
              stream: [],
              message: {
                id: MessageId('m-2'),
                role: 'assistant',
                source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
                content: [{ type: 'text', text: 'ancestor reply 2' }],
              },
              usage: { inputTokens: 200, outputTokens: 80, totalTokens: 280 },
            },
          },
          // --- FORK BOUNDARY (startBoundarySeq: 3) ---
          {
            type: 'turn/start',
            seq: 3 as never,
            time: 2000,
            data: { turn: 2 },
          },
          {
            type: 'assistant/message',
            seq: 4 as never,
            time: 2010,
            surfaceOp: 'append',
            data: {
              turn: 2,
              step: 1,
              stream: [],
              message: {
                id: MessageId('m-3'),
                role: 'assistant',
                source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
                content: [{ type: 'text', text: 'fresh reply' }],
              },
              usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
            },
          },
        ]

        // Fold with startBoundarySeq: 3
        const usage = assistants.usage.foldSessionUsage(sessionId, 'binding-child', 3, events)

        // Inherited events (seq 1 & 2) must NOT be charged!
        // Only seq 4 is charged: 100 input, 50 output, 150 total.
        expect(usage.assistantCallCount).toBe(1)
        expect(usage.assistantTokens.inputTokens).toBe(100)
        expect(usage.assistantTokens.outputTokens).toBe(50)
        expect(usage.assistantTokens.totalTokens).toBe(150)
        expect(usage.totalTokens.totalTokens).toBe(150)

        // Counter-check: if folded with startBoundarySeq 0, all events would be counted (280 + 420 + 150 = 850)
        const unconstrainedUsage = assistants.usage.foldSessionUsage(sessionId, 'binding-root', 0, events)
        expect(unconstrainedUsage.assistantCallCount).toBe(3)
        expect(unconstrainedUsage.assistantTokens.totalTokens).toBe(850)
      } finally {
        await harness.dispose()
      }
    })

    it('aggregates auxiliary calls into total usage alongside assistant turns', async () => {
      const harness = await setupAssistantHarness([])
      try {
        const { assistants } = harness
        const sessionId = SessionId('ses-aux-test')

        const events: SessionEvent[] = [
          {
            type: 'turn/start',
            seq: 0 as never,
            time: 1000,
            data: { turn: 1 },
          },
          // Standard assistant turn
          {
            type: 'assistant/message',
            seq: 1 as never,
            time: 1010,
            surfaceOp: 'append',
            data: {
              turn: 1,
              step: 1,
              stream: [],
              message: {
                id: MessageId('asst-1'),
                role: 'assistant',
                source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
                content: [{ type: 'text', text: 'turn response' }],
              },
              usage: { inputTokens: 500, outputTokens: 200, totalTokens: 700 },
            },
          },
        ]

        // Record in-session auxiliary call (e.g. title generation or memory review)
        const auxReviewRecord: AuxiliaryUsageRecord = {
          id: 'aux-rev-1',
          sessionId,
          seq: 2,
          provider: 'deepseek',
          model: 'deepseek-reasoner',
          usage: { inputTokens: 150, outputTokens: 30, totalTokens: 180 },
          purpose: 'memory_review',
          timestamp: 1020,
        }
        await assistants.recordAuxiliaryUsage(auxReviewRecord)

        // Record an additional explicit auxiliary call (e.g. prediction)
        const auxRecord: AuxiliaryUsageRecord = {
          id: 'aux-pred-1',
          sessionId,
          seq: 3,
          provider: 'deepseek',
          model: 'deepseek-chat',
          usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
          purpose: 'prediction',
          timestamp: 1030,
        }
        await assistants.recordAuxiliaryUsage(auxRecord)

        const summary = assistants.usage.foldSessionUsage(sessionId, 'binding-main', 0, events)

        // Assistant turns
        expect(summary.assistantCallCount).toBe(1)
        expect(summary.assistantTokens.inputTokens).toBe(500)
        expect(summary.assistantTokens.outputTokens).toBe(200)
        expect(summary.assistantTokens.totalTokens).toBe(700)

        // Auxiliary turns (1 from event + 1 from recorded auxiliary call)
        expect(summary.auxiliaryCallCount).toBe(2)
        expect(summary.auxiliaryTokens.inputTokens).toBe(150 + 80) // 230
        expect(summary.auxiliaryTokens.outputTokens).toBe(30 + 20)  // 50
        expect(summary.auxiliaryTokens.totalTokens).toBe(180 + 100) // 280

        // Total combined usage
        expect(summary.totalTokens.inputTokens).toBe(730)
        expect(summary.totalTokens.outputTokens).toBe(250)
        expect(summary.totalTokens.totalTokens).toBe(980)

        // Model breakdown
        expect(summary.modelBreakdown['deepseek/deepseek-chat']?.totalTokens).toBe(800) // 700 + 100
        expect(summary.modelBreakdown['deepseek/deepseek-reasoner']?.totalTokens).toBe(180)
      } finally {
        await harness.dispose()
      }
    })
  })
})
