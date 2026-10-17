/** A foreground turn may prepare its editable next-message suggestion while its reply streams. */
import { expect, it, vi } from 'vitest'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { setupAssistantHarness, textResponse } from './harness.ts'

it('starts one same-route suggestion before the task ends and reuses it after completion', async () => {
  const h = await setupAssistantHarness(undefined, { enableComposerPredictions: true })
  const releaseMain = Promise.withResolvers<undefined>()
  const pendingMain = '已完成社区培训计划初稿，正在说明场地、报名、预算和后续需要核对的数据。接下来还会继续核验'
  const suggestion = '请核对培训预算的各项合计数。'
  const requests: { provider: string; model: string; messages: string }[] = []
  let mainFinished = false
  vi.spyOn(h.adapter, 'stream').mockImplementation(async function* (options): AsyncIterable<StreamChunk> {
    requests.push({ provider: options.provider, model: options.model, messages: JSON.stringify(options.messages) })
    if (requests.length === 1) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: pendingMain }
      await releaseMain.promise
      yield { type: 'block-end', index: 0, block: { type: 'text', text: pendingMain } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      mainFinished = true
      return
    }
    yield* textResponse(suggestion)
  })
  try {
    await h.controller.prompt({ sessionId: h.lead.id, mode: 'queue', requestId: 'early-prediction' as never,
      content: [{ type: 'text', text: '规划社区培训，列出待核对的预算项目' }] }, new AbortController().signal)
    await vi.waitFor(() => { expect(requests).toHaveLength(2) }, { timeout: 1500 })
    expect(mainFinished).toBe(false)
    expect(requests[1]!.provider).toBe(requests[0]!.provider)
    expect(requests[1]!.model).toBe(requests[0]!.model)
    expect(requests[1]!.messages).toContain('社区培训')
    releaseMain.resolve(undefined)
    await h.lead.whenIdle()
    const end = h.lead.session.snapshotEvents().findLast(event => event.type === 'turn/end')
    expect(end?.data.reason.kind).toBe('completed')
    const result = await h.assistants.predictComposer({ sessionId: h.lead.id, asOfSeq: end!.seq, draftText: '' })
    expect(result?.text).toBe(suggestion)
    expect(result?.asOfSeq).toBe(end!.seq)
    expect(requests).toHaveLength(2)
    expect(h.lead.session.snapshotEvents().filter(event => event.type === 'assistant/auxiliary')).toHaveLength(2)
  } finally {
    releaseMain.resolve(undefined)
    await h.lead.whenIdle()
    vi.restoreAllMocks()
    await h.dispose()
  }
})

it('does not publish an unfinished early suggestion after a new turn starts', async () => {
  const h = await setupAssistantHarness(undefined, { enableComposerPredictions: true })
  const releaseSuggestion = Promise.withResolvers<undefined>()
  let requests = 0
  vi.spyOn(h.adapter, 'stream').mockImplementation(async function* (): AsyncIterable<StreamChunk> {
    requests++
    if (requests === 2) {
      await releaseSuggestion.promise
      yield* textResponse('请核对培训预算。')
      return
    }
    yield* textResponse(requests === 1
      ? '已完成社区培训计划初稿，正在说明场地、报名、预算和后续需要核对的数据。'
      : '第二轮已经开始')
  })
  try {
    await h.controller.prompt({ sessionId: h.lead.id, mode: 'queue', requestId: 'early-first' as never,
      content: [{ type: 'text', text: '制定社区培训计划' }] }, new AbortController().signal)
    await h.lead.whenIdle()
    await vi.waitFor(() => { expect(requests).toBe(2) })
    const firstEnd = h.lead.session.snapshotEvents().findLast(event => event.type === 'turn/end')!
    const pending = h.assistants.predictComposer({ sessionId: h.lead.id, asOfSeq: firstEnd.seq, draftText: '' })
    await h.controller.prompt({ sessionId: h.lead.id, mode: 'queue', requestId: 'early-second' as never,
      content: [{ type: 'text', text: '现在换一个话题' }] }, new AbortController().signal)
    releaseSuggestion.resolve(undefined)
    expect(await pending).toBeNull()
    await h.lead.whenIdle()
  } finally {
    releaseSuggestion.resolve(undefined)
    await h.lead.whenIdle()
    vi.restoreAllMocks()
    await h.dispose()
  }
})

it('does not start one suggestion for each background teammate seat', async () => {
  const h = await setupAssistantHarness(undefined, { enableComposerPredictions: true }, { withCatalog: true })
  const releaseMain = Promise.withResolvers<undefined>()
  let requests = 0
  vi.spyOn(h.adapter, 'stream').mockImplementation(async function* (): AsyncIterable<StreamChunk> {
    requests++
    const reply = '已完成社区培训计划初稿，正在说明场地、报名、预算和后续需要核对的数据。'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    await releaseMain.promise
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })
  try {
    const profile = await h.assistants.createProfile({ name: 'Planning assistant', responsibility: 'Plan events' })
    const team = await h.assistants.createTeam({ name: 'Planning team', coordinatorProfileId: profile.id })
    const seat = await h.assistants.createSeat({
      teamId: team.id, profileId: profile.id, role: 'teammate', name: 'planner', duty: 'Plan events',
    })
    await h.assistants.bindSeatSession(seat.id, h.lead.id)
    await h.controller.prompt({ sessionId: h.lead.id, mode: 'queue', requestId: 'teammate-no-prediction' as never,
      content: [{ type: 'text', text: '制定社区培训计划' }] }, new AbortController().signal)
    await vi.waitFor(() => { expect(requests).toBe(1) })
    expect(h.lead.session.snapshotEvents().filter(event => event.type === 'assistant/auxiliary')).toHaveLength(0)
  } finally {
    releaseMain.resolve(undefined)
    await h.lead.whenIdle()
    vi.restoreAllMocks()
    await h.dispose()
  }
})
