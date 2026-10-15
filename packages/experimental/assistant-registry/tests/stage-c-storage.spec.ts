/** Durable Stage C files reject malformed state and publish only successful commits. */
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { setupAssistantHarness, textResponse } from './harness.ts'
import { describe, expect, it } from 'vitest'
import { DurableReadCursorManager, UsageAggregator } from '../src/cursors-usage.ts'
import { DurableRoundJournal } from '../src/rounds.ts'
import { parseRoundJournal } from '../src/stage-c-storage.ts'

async function fixture(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'stagec-storage-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const charge = {
  id: 'charge-1',
  sessionId: SessionId('session-1'),
  seq: 7,
  provider: 'mock',
  model: 'mock',
  usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
  purpose: 'prediction' as const,
  timestamp: 1,
}

const journal = {
  discussions: [{ id: 'discussion', teamId: 'team', createdAt: 1, updatedAt: 1 }],
  rounds: [
    {
      id: 'round',
      discussionId: 'discussion',
      teamId: 'team',
      status: 'active',
      prompt: 'Inspect',
      slots: [
        {
          slotId: 'slot',
          roundId: 'round',
          slotIndex: 0,
          seatId: 'seat',
          seatName: 'Coordinator',
          seatRole: 'coordinator',
          sessionId: 'session',
          attemptId: 'attempt',
          status: 'active',
          committedCursor: 0,
          tokensUsed: 0,
        },
      ],
      activeSlotIndex: 0,
      totalTokensUsed: 0,
      handoffCount: 0,
      bounds: { maxSeatsPerRound: 5, maxHandoffsPerRound: 3, maxTokensPerRound: 1000, slotTimeoutMs: 1000 },
      createdAt: 1,
    },
  ],
  transcripts: [],
}

describe('Stage C durable storage validation', () => {
  it('rejects valid JSON with missing or invalid journal collections', () => {
    expect(() => parseRoundJournal({ discussions: 'INVALID', rounds: [], transcripts: [] })).toThrow()
    expect(() => parseRoundJournal({ discussions: [], rounds: [] })).toThrow()
    expect(parseRoundJournal({ discussions: [], rounds: [], transcripts: [] }).rounds).toEqual([])
  })

  it('permits interrupted active execution but rejects completed rounds containing active slots', () => {
    expect(parseRoundJournal(journal).rounds[0]?.status).toBe('active')
    expect(() => parseRoundJournal({ ...journal, rounds: [{ ...journal.rounds[0], status: 'completed' }] })).toThrow(/unfinished/)
  })

  it('rejects orphan records and inconsistent numeric accounting before loading state', () => {
    expect(() => parseRoundJournal({ ...journal, discussions: [] })).toThrow(/discussion/)
    expect(() => parseRoundJournal({ ...journal, rounds: [{ ...journal.rounds[0], totalTokensUsed: 1 }] })).toThrow(/accounting/)
    expect(() => parseRoundJournal({ ...journal, discussions: [journal.discussions[0], journal.discussions[0]] })).toThrow(/Duplicate/)
  })

  it('preserves semantically corrupt cursor storage through load, mutations and disposal flush', async () => {
    await fixture(async (root) => {
      const path = join(root, 'cursor.json')
      const original = '[{"conversationId":"conv","lastReadSeq":-9,"readAt":0}]\n'
      await writeFile(path, original)
      const cursors = new DurableReadCursorManager({ storagePath: path })
      await expect(cursors.load()).rejects.toThrow()
      await expect(cursors.setReadCursor('conv', 4)).rejects.toThrow(/corrupt/)
      await expect(cursors.flush()).rejects.toThrow(/corrupt/)
      expect(cursors.getReadCursor('conv')).toBeUndefined()
      expect(await readFile(path, 'utf8')).toBe(original)
    })
  })

  it('keeps semantically invalid journal bytes through rejected load and flush', async () => {
    await fixture(async (root) => {
      const path = join(root, 'rounds.json')
      const original = '{"discussions":"INVALID","rounds":[],"transcripts":[]}\n'
      await writeFile(path, original)
      const journal = new DurableRoundJournal({ storagePath: path })
      await expect(journal.load()).rejects.toThrow()
      expect(journal.corrupted).toBe(true)
      await expect(journal.flush()).rejects.toThrow(/corrupt/)
      expect(await readFile(path, 'utf8')).toBe(original)
    })
  })

  it('serializes competing cursor updates and retains both conversations across restart', async () => {
    await fixture(async (root) => {
      const path = join(root, 'cursor.json')
      const cursors = new DurableReadCursorManager({ storagePath: path })
      await Promise.all([cursors.setReadCursor('a', 9), cursors.setReadCursor('a', 2), cursors.setReadCursor('b', 12)])
      const reopened = new DurableReadCursorManager({ storagePath: path })
      await reopened.load()
      expect(reopened.getReadCursor('a')?.lastReadSeq).toBe(9)
      expect(reopened.getReadCursor('b')?.lastReadSeq).toBe(12)
    })
  })

  it('does not expose a cursor update rejected by durable replacement', async () => {
    await fixture(async (root) => {
      const path = join(root, 'directory')
      await mkdir(path)
      const cursors = new DurableReadCursorManager({ storagePath: path })
      await expect(cursors.setReadCursor('a', 1)).rejects.toThrow()
      expect(cursors.getReadCursor('a')).toBeUndefined()
    })
  })

  it('rejects inconsistent auxiliary usage without overwriting its durable file', async () => {
    await fixture(async (root) => {
      const path = join(root, 'usage.json')
      const original = `${JSON.stringify([{ ...charge, usage: { ...charge.usage, totalTokens: -3 } }])}\n`
      await writeFile(path, original)
      const usage = new UsageAggregator(new Context())
      usage.setStoragePath(path)
      await expect(usage.load()).rejects.toThrow()
      await expect(usage.recordAuxiliaryUsage(charge)).rejects.toThrow(/corrupt/)
      await expect(usage.flush()).rejects.toThrow(/corrupt/)
      expect(await readFile(path, 'utf8')).toBe(original)
    })
  })

  it('deduplicates concurrent replayed charges and repeated loads', async () => {
    await fixture(async (root) => {
      const path = join(root, 'usage.json')
      const usage = new UsageAggregator(new Context())
      usage.setStoragePath(path)
      await Promise.all([usage.recordAuxiliaryUsage(charge), usage.recordAuxiliaryUsage(charge)])
      await usage.load()
      await usage.load()
      expect(usage.getAuxiliaryRecords(charge.sessionId)).toEqual([charge])
      await expect(usage.recordAuxiliaryUsage({ ...charge, seq: 8 })).rejects.toThrow(/Conflicting/)
    })
  })

  it('counts logged auxiliary outcome and persisted billing identity once after cold restart', async () => {
    await fixture(async (root) => {
      const harness = await setupAssistantHarness(
        [textResponse('Please summarize the constraints.')],
        {
          enableComposerPredictions: true,
        },
        { storageRoot: root },
      )
      const sessionId = harness.lead.id
      let tokens = 0
      try {
        const prediction = await harness.assistants.predictComposer({
          sessionId,
          asOfSeq: 0,
          recentTexts: ['Distinctive auxiliary audit context'],
        })
        expect(prediction).not.toBeNull()
        tokens = prediction!.usage!.usage.totalTokens
        const events = harness.lead.session.snapshotEvents()
        expect(events.filter(event => event.type === 'assistant/auxiliary')).toHaveLength(2)
        const summary = harness.assistants.usage.foldSessionUsage(sessionId, 'binding', 0, events)
        expect(summary.auxiliaryCallCount).toBe(1)
        expect(summary.auxiliaryTokens.totalTokens).toBe(tokens)
        expect(summary.assistantCallCount).toBe(0)
      } finally {
        await harness.dispose(true)
      }
      const reopened = await setupAssistantHarness([], {}, { storageRoot: root, leadSessionId: SessionId('reopened-lead') })
      try {
        const summary = await reopened.assistants.aggregateUsage({
          sessionBindings: [
            {
              sessionId,
              bindingId: 'binding',
              startBoundarySeq: 0,
            },
          ],
        })
        expect(summary[0]?.auxiliaryCallCount).toBe(1)
        expect(summary[0]?.auxiliaryTokens.totalTokens).toBe(tokens)
        expect(summary[0]?.assistantCallCount).toBe(0)
      } finally {
        await reopened.dispose(true)
      }
    })
  })

  it('resolves catalog usage selectors to distinct private and team runtime sessions', async () => {
    const harness = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const profile = await harness.assistants.createProfile({ name: 'Usage profile', responsibility: 'Count usage' })
      const conversation = await harness.assistants.createConversation(profile.id, harness.lead.id)
      const { team, seats } = await harness.assistants.createTeamFromTemplate('blank', {
        name: 'Usage team',
        coordinatorProfileId: profile.id,
      })
      await harness.assistants.bindSeatSession(seats[0]!.id, harness.lead.id)
      const aggregator = new UsageAggregator(harness.ctx, async () => harness.catalog)
      const byProfile = await aggregator.aggregateUsage({ profileId: profile.id })
      expect(byProfile.map(summary => summary.sessionId)).toEqual([harness.lead.id])
      const byTeam = await aggregator.aggregateUsage({ teamId: team.id })
      expect(byTeam.map(summary => summary.sessionId)).toEqual([harness.lead.id])
      const byConversation = await aggregator.aggregateUsage({ conversationId: conversation.id })
      expect(byConversation.map(summary => summary.bindingId)).toEqual([conversation.id])
    } finally {
      await harness.dispose()
    }
  })

  it('does not retain auxiliary billing after a failed commit', async () => {
    await fixture(async (root) => {
      const path = join(root, 'directory')
      await mkdir(path)
      const usage = new UsageAggregator(new Context())
      usage.setStoragePath(path)
      await expect(usage.recordAuxiliaryUsage(charge)).rejects.toThrow()
      expect(usage.getAuxiliaryRecords(charge.sessionId)).toEqual([])
    })
  })
})
