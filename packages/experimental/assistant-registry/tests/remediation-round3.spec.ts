import { describe, it, expect, vi } from 'vitest'
import { rmSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { setupAssistantHarness, textResponse } from './harness.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GroupRoundId, DurableRoundJournal } from '../src/index.ts'
async function fixture(script: Parameters<typeof setupAssistantHarness>[0] = [], config: Parameters<typeof setupAssistantHarness>[1] = {}) {
  const h = await setupAssistantHarness(script, config)
  const p = await h.assistants.createProfile({ name: 'Round three', responsibility: 'Coordinate' })
  const { team, seats } = await h.assistants.createTeamFromTemplate('blank', { coordinatorProfileId: p.id, name: 'Round three team' })
  await h.assistants.bindSeatSession(seats[0]!.id, h.lead.id)
  const disc = await h.assistants.createDiscussion({ teamId: team.id })
  const round = await h.assistants.scheduleRound({
    discussionId: disc.id,
    teamId: team.id,
    prompt: 'Actual operation',
    id: GroupRoundId('third-review'),
  })
  return { h, p, round }
}
describe('Stage C production repair controls', { timeout: 30000 }, () => {
  it('cancels the actual provider stream, not only the custom executor signal', async () => {
    const { h, round } = await fixture(['hang'])
    const running = h.assistants.executeRound(round.id)
    const settled = Promise.allSettled([running])
    try {
      await vi.waitFor(() => expect(h.adapter.requests.length).toBe(1))
      await h.assistants.cancelRound(round.id)
      expect(h.adapter.requests[0]!.signal!.aborted).toBe(true)
    } finally {
      h.lead.cancel({ kind: 'user' })
      await settled
      await h.dispose()
    }
  })
  it('publishes a durably committed reply after publication failure and cold restart without re-execution', async () => {
    const { h, round } = await fixture()
    const root = h.storageRoot
    let reopened: Awaited<ReturnType<typeof setupAssistantHarness>> | undefined
    let effects = 0
    const executor = async () => {
      effects++
      return { status: 'completed' as const, text: 'RECOVERABLE_REPLY', tokensUsed: 1 }
    }
    try {
      vi.spyOn(h.assistants.roundScheduler, 'postPublicReply').mockRejectedValueOnce(new Error('Crash point before public post'))
      await expect(h.assistants.executeRound(round.id, { executor })).rejects.toThrow('Crash point')
      await h.dispose(true)
      reopened = await setupAssistantHarness([], {}, { storageRoot: root })
      await reopened.assistants.executeRound(round.id, { executor })
      expect(effects).toBe(1)
      expect(reopened.assistants.roundScheduler.journal.getTranscript(round.discussionId)).toHaveLength(1)
    } finally {
      await reopened?.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  })
  it('marks recovered active execution uncertain rather than completing with a stranded active slot', async () => {
    const { h, round } = await fixture()
    try {
      await h.assistants.roundScheduler.journal.saveRound({
        ...round,
        status: 'active',
        slots: round.slots.map(s => ({ ...s, status: 'active' as const })),
      })
      const r = await h.assistants.executeRound(round.id)
      expect(r.slots.every(s => s.status !== 'active')).toBe(true)
    } finally {
      await h.dispose()
    }
  })
  it('rejects keyed re-admission with changed execution bounds', async () => {
    const { h, round } = await fixture()
    try {
      await expect(
        h.assistants.scheduleRound({
          id: round.id,
          teamId: round.teamId,
          discussionId: round.discussionId,
          prompt: round.prompt,
          bounds: { maxTokensPerRound: 1 },
        }),
      ).rejects.toThrow(/conflict/i)
    } finally {
      await h.dispose()
    }
  })
  it('extracts actual completed-turn text through the automatic memory-review lifecycle', async () => {
    const { h } = await fixture([textResponse('Preference acknowledged')], { enableMemoryReview: true })
    const p = await h.assistants.createProfile({
      name: 'Automatic review',
      responsibility: 'Recall user preferences',
      defaultModel: { provider: 'mock', model: 'mock' },
    })
    try {
      const conversation = await h.assistants.createConversation(p.id)
      const a = h.ctx.agents.get(conversation.rootSessionId)!
      const spy = vi.spyOn(h.assistants, 'reviewTurn')
      const { createUserMessage } = await import('@deepseek-ai/dsh-llm')
      a.followup(
        createUserMessage({
          content: [{ type: 'text', text: 'Remember that the user prefers concise responses' }],
          source: { kind: 'user' },
        }),
      )
      await a.whenIdle()
      expect(a.session.snapshotEvents().some(e => e.type === 'assistant/message')).toBe(true)
      await vi.waitFor(() => expect(spy).toHaveBeenCalled())
      expect(spy.mock.calls.some(([r]) => r.turnTexts?.some(t => t.includes('prefers concise')))).toBe(true)
    } finally {
      await h.dispose()
    }
  })
  it('refuses syntactically valid but structurally invalid durable journal data', async () => {
    const root = mkdtempSync(join(tmpdir(), 'round3-schema-'))
    const path = join(root, 'journal.json')
    const raw = JSON.stringify({ discussions: 'INVALID', rounds: [], transcripts: [] })
    try {
      writeFileSync(path, raw)
      const j = new DurableRoundJournal({ storagePath: path })
      await expect(j.load()).rejects.toThrow()
      await expect(j.flush()).rejects.toThrow()
      expect(readFileSync(path, 'utf8')).toBe(raw)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
  it('logs the actual auxiliary prediction request for durable reconstruction', async () => {
    const h = await setupAssistantHarness([textResponse('Initial turn'), textResponse('Useful next question')], {
      enableComposerPredictions: true,
    })
    try {
      const { createUserMessage } = await import('@deepseek-ai/dsh-llm')
      h.lead.followup(createUserMessage({ content: [{ type: 'text', text: 'PRIVATE_AUX_CONTEXT_773' }], source: { kind: 'user' } }))
      await h.lead.whenIdle()
      const completedEnd = h.lead.session.snapshotEvents().findLast(e => e.type === 'turn/end' && e.data.reason.kind === 'completed')!
      const before = h.lead.session.snapshotEvents().length
      const result = await h.assistants.predictComposer({ sessionId: h.lead.id, asOfSeq: completedEnd.seq })
      expect(result?.text).toBe('Useful next question')
      expect(JSON.stringify(h.lead.session.snapshotEvents().slice(before))).toContain('PRIVATE_AUX_CONTEXT_773')
    } finally {
      await h.dispose()
    }
  })
})
