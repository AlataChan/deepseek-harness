/** Store refusals and idempotence through the real durable aggregate owner. */
import { createHash } from 'node:crypto'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { DecisionId } from '../src/types.ts'
import { DecisionStore, mintDecisionId } from '../src/store.ts'
import { FakeClock, openStore, requestId, sessionId } from './harness.ts'

async function world() {
  const clock = new FakeClock()
  const fixture = await openStore(clock)
  onTestFinished(() => fixture.dispose())
  const record = await fixture.store.create({ sessionId: sessionId('refusal-session'), question: 'Which database?', choices: ['SQLite'] })
  return { ...fixture, record, clock }
}

const mutations: Record<string, (store: DecisionStore, id: DecisionId) => Promise<unknown>> = {
  facts: (store, id) => store.settleFacts(id),
  digest: (store, id) => store.updateAnswerDigest(id, createHash('sha256').update('edited answer').digest('hex')),
  admit: (store, id) => store.markAdmitted(id),
  reconcile: (store, id) => store.markNeedsReconciliation(id),
  withdraw: (store, id) => store.markWithdrawn(id),
  dismiss: (store, id) => store.dismiss(id, 0),
  cancel: (store, id) => store.cancel(id, 0),
  pause: (store, id) => store.pause(id, 0, 'user-requested'),
  resume: (store, id) => store.resume(id, 0),
  supersede: (store, id) => store.supersede(id),
}

it.each(Object.entries(mutations))('refuses a missing aggregate before mutation: %s', async (_name, mutate) => {
  const { store } = await world()
  await expect(mutate(store, mintDecisionId())).rejects.toMatchObject({ code: 'DECISION_NOT_FOUND' })
})

it.each(['cancel', 'pause', 'resume'] as const)('refuses %s on a closed question', async (action) => {
  const { store, record } = await world()
  await store.cancel(record.decisionId, record.revision)
  await expect(mutations[action]!(store, record.decisionId)).rejects.toMatchObject({ code: 'DECISION_TRACKING_CLOSED' })
})

it.each(['cancel', 'pause', 'resume'] as const)('revision-checks %s while it can change the record', async (action) => {
  const { store, record } = await world()
  if (action === 'resume') await store.pause(record.decisionId, 0, 'user-requested')
  const invoke = action === 'pause' ? () => store.pause(record.decisionId, 99, 'user-requested')
    : action === 'resume' ? () => store.resume(record.decisionId, 99) : () => store.cancel(record.decisionId, 99)
  await expect(invoke()).rejects.toMatchObject({ code: 'DECISION_CONFLICT' })
})

it('does not invent answer tracking or digest changes on an unreserved record', async () => {
  const { store, record } = await world()
  await expect(store.markAdmitted(record.decisionId)).rejects.toMatchObject({ code: 'DECISION_CONFLICT' })
  expect(await store.updateAnswerDigest(record.decisionId, 'not-used')).toEqual(record)
  expect(await store.markNeedsReconciliation(record.decisionId)).toEqual(record)
  expect(await store.markWithdrawn(record.decisionId)).toEqual(record)
})

it('makes repeated pause and resume idempotent without accepting stale mutations', async () => {
  const { store, record } = await world()
  expect(await store.resume(record.decisionId, record.revision)).toEqual(record)
  const paused = await store.pause(record.decisionId, 0, 'user-requested')
  expect(await store.pause(record.decisionId, 0, 'other-reason')).toEqual(paused)
  const resumed = await store.resume(record.decisionId, paused.revision)
  expect(await store.resume(record.decisionId, 0)).toEqual(resumed)
})

it('updates a queued answer digest once and leaves repeated identical edits unchanged', async () => {
  const { store, record } = await world()
  await store.reserveAnswer(record.decisionId, 0, { requestId: requestId('answer-request') })
  const digest = createHash('sha256').update('edited answer').digest('hex')
  const edited = await store.updateAnswerDigest(record.decisionId, digest)
  expect(edited.answer?.digest).toBe(digest)
  expect(await store.updateAnswerDigest(record.decisionId, digest)).toEqual(edited)
})

it('keeps dismissed tracking closed and rejects admission after its explicit dismissal', async () => {
  const { store, record } = await world()
  await store.reserveAnswer(record.decisionId, 0, { requestId: requestId('answer-request') })
  const dismissed = await store.dismiss(record.decisionId, 1)
  expect(await store.dismiss(record.decisionId, 0)).toEqual(dismissed)
  await expect(store.markAdmitted(record.decisionId)).rejects.toMatchObject({ code: 'DECISION_CONFLICT' })
})

it('refuses dismissal of a question closed without tracking dismissal', async () => {
  const { store, record } = await world()
  await store.cancel(record.decisionId, 0)
  await expect(store.dismiss(record.decisionId, 1)).rejects.toMatchObject({ code: 'DECISION_TRACKING_CLOSED' })
})

it('preserves supersession when later durable evidence admits its reserved human answer', async () => {
  const { store, record } = await world()
  await store.reserveAnswer(record.decisionId, 0, { requestId: requestId('answer-request') })
  await store.supersede(record.decisionId)
  const admitted = await store.markAdmitted(record.decisionId)
  expect(admitted).toMatchObject({ lifecycle: 'superseded', answerIndex: 'admitted' })
  expect(await store.markAdmitted(record.decisionId)).toEqual(admitted)
  expect(await store.markWithdrawn(record.decisionId)).toEqual(admitted)
  expect(await store.markNeedsReconciliation(record.decisionId)).toEqual(admitted)
})

it.each(['stale', 'closed', 'reserved', 'paused', 'expired'] as const)('does not claim a notification after its question becomes %s', async (state) => {
  const { store, record, clock } = await world()
  if (state === 'closed') await store.cancel(record.decisionId, 0)
  if (state === 'reserved') await store.reserveAnswer(record.decisionId, 0, { requestId: requestId('answer-request') })
  if (state === 'paused') await store.pause(record.decisionId, 0, 'user-requested')
  if (state === 'expired') clock.advance(Date.parse(record.expiresAtUtc) + 1)
  const revision = state === 'stale' ? 99 : store.get(record.decisionId)!.revision
  expect(await store.writeNotification(record.decisionId, undefined, { state: 'in_flight' }, revision)).toBe(false)
})

it('keeps a question unchanged when no answer facts have been observed', async () => {
  const { store, record } = await world()
  expect(await store.settleFacts(record.decisionId)).toEqual(record)
})

it('preserves pending evidence instead of degrading or withdrawing a reserved answer', async () => {
  const { store, record } = await world()
  await store.reserveAnswer(record.decisionId, 0, { requestId: requestId('answer-request') })
  store.accumulateFacts(record.decisionId, { pending: true })
  const pending = store.get(record.decisionId)
  expect(await store.markNeedsReconciliation(record.decisionId)).toEqual(pending)
  expect(await store.markWithdrawn(record.decisionId)).toEqual(pending)
})

it('keeps an already withdrawn answer unchanged on repeated withdrawal', async () => {
  const { store, record } = await world()
  await store.reserveAnswer(record.decisionId, 0, { requestId: requestId('answer-request') })
  const withdrawn = await store.markWithdrawn(record.decisionId)
  expect(await store.markWithdrawn(record.decisionId)).toEqual(withdrawn)
})


it('waits for every overlapping Session entry checkpoint before persisting facts', async () => {
  const { store, record } = await world()
  await store.reserveAnswer(record.decisionId, 0, { requestId: requestId('entry-fence') })
  const first = Promise.withResolvers<undefined>()
  const second = Promise.withResolvers<undefined>()
  store.deferEntryFlush(record.decisionId, first.promise)
  store.deferEntryFlush(record.decisionId, second.promise)
  store.accumulateFacts(record.decisionId, { entered: true })
  let finished = false
  const write = store.settleFacts(record.decisionId).then((value) => { finished = true; return value })
  first.resolve(undefined)
  await Promise.resolve()
  expect(finished).toBe(false)
  expect(store.get(record.decisionId)?.answerIndex).toBe('submitting')
  second.resolve(undefined)
  expect(await write).toMatchObject({ answerIndex: 'admitted' })
})

it('rechecks a newly observed entry inside an already queued domain update', async () => {
  const { store, record, domain } = await world()
  await store.reserveAnswer(record.decisionId, 0, { requestId: requestId('entry-race') })
  const table = domain.table('decisions')
  const update = table.update.bind(table)
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const checkpoint = Promise.withResolvers<undefined>()
  vi.spyOn(table, 'update').mockImplementationOnce(async (...args) => {
    entered.resolve(undefined)
    await release.promise
    return update(...args)
  })
  const dismissing = expect(store.dismiss(record.decisionId, 1)).rejects.toMatchObject({ code: 'DECISION_ALREADY_ADMITTED' })
  await entered.promise
  store.deferEntryFlush(record.decisionId, checkpoint.promise)
  store.accumulateFacts(record.decisionId, { entered: true })
  release.resolve(undefined)
  await Promise.resolve()
  expect(store.get(record.decisionId)?.answerIndex).toBe('submitting')
  checkpoint.resolve(undefined)
  await dismissing
  expect(store.get(record.decisionId)).toMatchObject({ answerIndex: 'admitted' })
})

it('keeps admitted indexing closed after a Session entry checkpoint fails', async () => {
  const { store, record } = await world()
  await store.reserveAnswer(record.decisionId, 0, { requestId: requestId('failed-entry') })
  const checkpoint = Promise.withResolvers<undefined>()
  store.deferEntryFlush(record.decisionId, checkpoint.promise)
  store.accumulateFacts(record.decisionId, { entered: true })
  const write = store.settleFacts(record.decisionId)
  const failure = expect(write).rejects.toThrow('Session disk unavailable')
  checkpoint.reject(new Error('Session disk unavailable'))
  await failure
  expect(store.get(record.decisionId)?.answerIndex).toBe('submitting')
})
