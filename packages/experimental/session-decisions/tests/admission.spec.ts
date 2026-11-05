/** Admission and retry behavior through the real Session command controller. */
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { describe,expect,it } from 'vitest'
import type { AnswerSubmitOutcome } from '../src/index.ts'
import { answerRequestId,mintDecisionId } from '../src/index.ts'

import { admissionHarness,SESSION } from './admission-world.ts'

/** Submit and expect a rejected outcome with the given code. */
async function expectRejection(
  run: () => Promise<AnswerSubmitOutcome>,
  reason: string,
): Promise<void> {
  const outcome = await run()
  expect(outcome.outcome).toBe('rejected')
  expect(outcome).toMatchObject({ reason })
}

describe('admission through the real session controller', () => {
  it('reserves, delivers exactly one queued prompt, and classifies retries', async () => {
    const { service, followup } = await admissionHarness()
    const view = await service.create({ sessionId: SESSION, question: 'Which database?', choices: ['Postgres', 'SQLite'] })
    const requestId = answerRequestId(view.decisionId)

    const accepted = await service.submit(view.decisionId, 0, requestId, { choiceOrdinal: 1 })
    expect(accepted).toMatchObject({ outcome: 'accepted', requestId })
    expect(accepted.outcome === 'accepted' && accepted.revision).toBe(view.revision + 1)
    expect(followup).toHaveBeenCalledTimes(1)
    const message = followup.mock.calls[0]![0]
    expect(JSON.stringify(message)).toContain(`Answer to question ${view.decisionId}: option 1`)
    expect(message.source).toMatchObject({ kind: 'user', rpcId: requestId })
    // The reservation stays submitting until durable entry evidence settles it.
    expect(await service.get(view.decisionId)).toMatchObject({ answerIndex: 'submitting', hasAnswer: true })

    // Retry table: same identity and payload replays without a second prompt.
    expect(await service.submit(view.decisionId, view.revision + 1, requestId, { choiceOrdinal: 1 }))
      .toMatchObject({ outcome: 'submitting', requestId })
    expect(followup).toHaveBeenCalledTimes(1)

    // A different payload for the same slot is a hard conflict.
    await expectRejection(
      () => service.submit(view.decisionId, view.revision + 1, requestId, { choiceOrdinal: 2 }),
      'DECISION_CONFLICT',
    )
    expect(followup).toHaveBeenCalledTimes(1)

    // A foreign request id is rejected before any reservation or prompt.
    await expectRejection(
      () => service.submit(view.decisionId, view.revision + 1, answerRequestId(mintDecisionId()), { choiceOrdinal: 1 }),
      'DECISION_CONFLICT',
    )
    expect(followup).toHaveBeenCalledTimes(1)
  })

  it('keeps a throwing delivery submitting when the queue commit is durably observable', async () => {
    const { service, followup, followupThrowsAfterEnqueue } = await admissionHarness()
    const view = await service.create({ sessionId: SESSION, question: 'Which database?', choices: ['Postgres'] })
    const requestId = answerRequestId(view.decisionId)
    followupThrowsAfterEnqueue()

    const outcome = await service.submit(view.decisionId, 0, requestId, { choiceOrdinal: 1 })
    expect(outcome).toMatchObject({ outcome: 'submitting', requestId })
    expect(followup).toHaveBeenCalledTimes(1)
    expect(await service.get(view.decisionId)).toMatchObject({ answerIndex: 'submitting' })

    // Durable entry evidence settles it despite the rejection.
    expect(await service.applyFacts(view.decisionId, { entered: true }))
      .toMatchObject({ answerIndex: 'admitted', lifecycle: 'answered' })
    expect(followup).toHaveBeenCalledTimes(1)
  })

  it('degrades a bare rejection to needs_reconciliation without re-prompting on retry', async () => {
    const { service, followup } = await admissionHarness()
    const view = await service.create({ sessionId: SESSION, question: 'Which database?', choices: ['Postgres'] })
    const requestId = answerRequestId(view.decisionId)
    followup.mockImplementation(() => {
      throw new Error('fixture: prompt rejected before enqueue')
    })

    expect(await service.submit(view.decisionId, 0, requestId, { choiceOrdinal: 1 }))
      .toMatchObject({ outcome: 'reconciliation_required', requestId })
    expect(await service.get(view.decisionId)).toMatchObject({ answerIndex: 'needs_reconciliation' })
    // The retry table reports the degraded state without a second prompt.
    expect(await service.submit(view.decisionId, view.revision + 1, requestId, { choiceOrdinal: 1 }))
      .toMatchObject({ outcome: 'reconciliation_required', requestId })
    // Exception: reconciliation is reported for ANY caller id and payload,
    // with the immutable saved request id on the response.
    expect(await service.submit(view.decisionId, view.revision + 1, answerRequestId(mintDecisionId()), { choiceOrdinal: 2 }))
      .toMatchObject({ outcome: 'reconciliation_required', requestId })
    expect(followup).toHaveBeenCalledTimes(1)
  })

  it('closes dismissed tracking for the saved request regardless of payload, conflicts otherwise', async () => {
    const { service, followup } = await admissionHarness()
    const view = await service.create({ sessionId: SESSION, question: 'Which database?', choices: ['Postgres'] })
    const requestId = answerRequestId(view.decisionId)
    await service.submit(view.decisionId, 0, requestId, { choiceOrdinal: 1 })
    await service.applyFacts(view.decisionId, { discarded: true })
    expect(await service.dismiss(view.decisionId, (await service.get(view.decisionId))!.revision).then(r => r.ok)).toBe(true)

    // Same saved request id closes tracking even with a different payload.
    expect(await service.submit(view.decisionId, 0, requestId, { choiceOrdinal: 1 }))
      .toMatchObject({ outcome: 'tracking_closed', requestId })
    expect(await service.submit(view.decisionId, 0, requestId, { text: 'different' }))
      .toMatchObject({ outcome: 'tracking_closed', requestId })
    // A foreign request id conflicts.
    await expectRejection(
      () => service.submit(view.decisionId, 0, answerRequestId(mintDecisionId()), { choiceOrdinal: 1 }),
      'DECISION_CONFLICT',
    )
    expect(followup).toHaveBeenCalledTimes(1)
  })

  it('upgrades degraded reservations on later entry evidence through the resolver', async () => {
    const { service, followup } = await admissionHarness()
    const view = await service.create({ sessionId: SESSION, question: 'Which database?', choices: ['Postgres'] })
    const requestId = answerRequestId(view.decisionId)
    followup.mockImplementation(() => {
      throw new Error('fixture: prompt rejected before enqueue')
    })
    await service.submit(view.decisionId, 0, requestId, { choiceOrdinal: 1 })

    expect(await service.applyFacts(view.decisionId, { entered: true }))
      .toMatchObject({ answerIndex: 'admitted', lifecycle: 'answered' })
    // Settlement sticks: later bare facts never reopen an admitted record.
    expect(await service.applyFacts(view.decisionId, { turnEnded: true }))
      .toMatchObject({ answerIndex: 'admitted' })
  })

  it('records queue absence as withdrawal that keeps the question open until dismissal', async () => {
    const { service, followup } = await admissionHarness()
    const view = await service.create({ sessionId: SESSION, question: 'Which database?', choices: ['Postgres'] })
    const requestId = answerRequestId(view.decisionId)
    await service.submit(view.decisionId, 0, requestId, { choiceOrdinal: 1 })

    const withdrawn = await service.applyFacts(view.decisionId, { discarded: true })
    expect(withdrawn).toMatchObject({ answerIndex: 'withdrawn', lifecycle: 'open' })
    // The withdrawn question is still the session's unresolved question.
    await expect(service.create({ sessionId: SESSION, question: 'again', choices: [] }))
      .rejects.toMatchObject({ code: 'DECISION_CONFLICT' })
    await expect(service.cancel(view.decisionId, withdrawn!.revision))
      .resolves.toMatchObject({ ok: false, reason: 'DECISION_CONFLICT' })
    // Explicit dismissal is the only tracking closure.
    const dismissed = await service.dismiss(view.decisionId, withdrawn!.revision)
    expect(dismissed.ok && dismissed.record).toMatchObject({ answerIndex: 'dismissed', lifecycle: 'cancelled' })
    expect(followup).toHaveBeenCalledTimes(1)
  })

  it('composes the pinned free-text prefix', async () => {
    const { service, followup } = await admissionHarness()
    const view = await service.create({ sessionId: SESSION, question: 'Summarize', choices: [] })
    const requestId = answerRequestId(view.decisionId)
    expect(await service.submit(view.decisionId, 0, requestId, { text: 'hello /skill' }))
      .toMatchObject({ outcome: 'accepted', requestId })
    const message = followup.mock.calls[0]![0]
    const text = message.content.find(part => part.type === 'text')
    expect(text).toMatchObject({ text: `Answer to question ${view.decisionId}:\nhello /skill` })
    expect(followup).toHaveBeenCalledTimes(1)
  })

  it('rejects oversized answers by UTF-8 bytes before any reservation', async () => {
    const { service, followup } = await admissionHarness({ maxAnswerTextBytes: 4 })
    const view = await service.create({ sessionId: SESSION, question: 'Summarize', choices: [] })
    const requestId = answerRequestId(view.decisionId)
    // '你好' is 6 UTF-8 bytes: over a 4-byte limit even under 2 characters.
    await expectRejection(
      () => service.submit(view.decisionId, 0, requestId, { text: '你好' }),
      'DECISION_LIMIT_EXCEEDED',
    )
    expect(await service.get(view.decisionId)).toMatchObject({ answerIndex: 'none', hasAnswer: false })
    expect(followup).toHaveBeenCalledTimes(0)
  })

  it('rejects unknown questions and stale revisions without prompting', async () => {
    const { service, followup } = await admissionHarness()
    const view = await service.create({ sessionId: SESSION, question: 'Which database?', choices: ['Postgres'] })
    const requestId: SessionRequestId = answerRequestId(view.decisionId)
    const unknown = mintDecisionId()
    await expectRejection(
      () => service.submit(unknown, 0, answerRequestId(unknown), { choiceOrdinal: 1 }),
      'DECISION_NOT_FOUND',
    )
    await expectRejection(
      () => service.submit(view.decisionId, 7, requestId, { choiceOrdinal: 1 }),
      'DECISION_CONFLICT',
    )
    expect(followup).toHaveBeenCalledTimes(0)
    expect(view.requestId).toBe(requestId)
  })
})

describe('trusted admitAnswer beforePrompt hook (B2)', () => {
  it('invokes the hook exactly once after reservation and before the one queued prompt', async () => {
    const { service, followup } = await admissionHarness()
    const view = await service.create({ sessionId: SESSION, question: 'Which database?', choices: ['Postgres'] })
    const order: string[] = []
    followup.mockImplementation(() => {
      order.push('prompt')
    })
    const outcome = await service.admitAnswer(
      view.decisionId,
      view.revision,
      { choiceOrdinal: 1 },
      async (reserved) => {
        order.push('hook')
        expect(reserved).toEqual({
          decisionId: view.decisionId,
          sessionId: view.sessionId,
          requestId: view.requestId,
        })
      },
    )
    expect(outcome).toMatchObject({ outcome: 'accepted', requestId: view.requestId })
    expect(order).toEqual(['hook', 'prompt'])
    expect(followup).toHaveBeenCalledTimes(1)
    expect(await service.get(view.decisionId)).toMatchObject({ answerIndex: 'submitting', hasAnswer: true })
  })

  it('leaves the reservation submitting and never prompts or resets when the hook fails', async () => {
    const { service, followup } = await admissionHarness()
    const view = await service.create({ sessionId: SESSION, question: 'Which database?', choices: ['Postgres'] })
    const outcome = await service.admitAnswer(view.decisionId, view.revision, { choiceOrdinal: 1 }, async () => {
      throw new Error('fixture: hook failed')
    })
    expect(outcome).toMatchObject({ outcome: 'submitting', requestId: view.requestId })
    expect(followup).toHaveBeenCalledTimes(0)
    // Reserved and unresolved — no degradation, no reset.
    expect(await service.get(view.decisionId)).toMatchObject({ answerIndex: 'submitting' })

    // A non-none retry classifies from the reservation without invoking the
    // hook again and without a second prompt.
    let hookCalls = 0
    const retry = await service.admitAnswer(view.decisionId, view.revision + 1, { choiceOrdinal: 1 }, async () => {
      hookCalls += 1
    })
    expect(retry).toMatchObject({ outcome: 'submitting', requestId: view.requestId })
    expect(hookCalls).toBe(0)
    expect(followup).toHaveBeenCalledTimes(0)
  })
  it('derives the Goal-disarm view from the owning agent live Goal state', async () => {
    const { service, goalState } = await admissionHarness()
    const view = await service.create({ sessionId: SESSION, question: 'Goal?', choices: ['A'] })

    // No Goal: the derived field is omitted entirely.
    expect('goalDisarmed' in ((await service.get(view.decisionId)) ?? {})).toBe(false)
    // Active armed Goal: live, but not disarmed.
    goalState.current = { phase: 'active', activation: 'armed' }
    expect('goalDisarmed' in ((await service.get(view.decisionId)) ?? {})).toBe(false)
    // Active disarmed Goal: the view carries the disarm derivation.
    goalState.current = { phase: 'active', activation: 'disarmed' }
    expect(await service.get(view.decisionId)).toMatchObject({ goalDisarmed: true })
    // Paused Goal: phase gates the derivation even when disarmed.
    goalState.current = { phase: 'paused', activation: 'disarmed' }
    expect('goalDisarmed' in ((await service.get(view.decisionId)) ?? {})).toBe(false)
  })

})
