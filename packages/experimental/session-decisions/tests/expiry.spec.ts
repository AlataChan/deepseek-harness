/**
 * Expiry and scheduling determinism: injected clock, bounded monotonic timer
 * re-arm, sweep deadlines, mutation-driven re-arming, contained sweep
 * failures, and disposal quiescence — all without real sleeps.
 * @module tests/expiry
 */

import { describe,expect,it } from 'vitest'
import { MAX_TIMER_DELAY_MS,scheduleAt,systemDecisionClock,type DecisionTimers } from '../src/clock.ts'
import { nextDeadline,runSweeps,scheduleSweeps } from '../src/expiry.ts'
import { FakeClock,openStore,requestId,sessionId,testLimits } from './harness.ts'

/** Manual timer queue: fires jobs in strict due order when advanced. */
function manualTimers(clock: FakeClock): { timers: DecisionTimers; runDue: () => Promise<number> } {
  let nextHandle = 1
  const jobs = new Map<unknown, { at: number; handler: () => PromiseLike<unknown> | undefined; cancelled: boolean }>()
  return {
    timers: {
      // Bivariant narrowing: every scheduleAt callback returns `undefined`
      // explicitly, so the test queue can store the settled promise directly.
      setTimeout(handler: () => PromiseLike<unknown> | undefined, timeoutMs) {
        const handle = nextHandle++
        jobs.set(handle, { at: clock.now() + timeoutMs, handler, cancelled: false })
        return handle
      },
      clearTimeout(handle) {
        const job = jobs.get(handle)
        if (job) job.cancelled = true
      },
    },
    runDue: async (): Promise<number> => {
      let fired = 0
      const settled: PromiseLike<unknown>[] = []
      for (const job of [...jobs.values()].sort((a, b) => a.at - b.at)) {
        if (job.cancelled || job.at > clock.now()) continue
        job.cancelled = true
        const returned = job.handler()
        if (returned !== undefined) settled.push(returned)
        fired += 1
      }
      await Promise.allSettled(settled)
      return fired
    },
  }
}

describe('scheduleAt', () => {
  it('fires through the native timer adapter and permits repeated disposal', async () => {
    const done = Promise.withResolvers<undefined>()
    const dispose = scheduleAt(systemDecisionClock, Date.now(), () => { done.resolve(undefined) })
    await done.promise
    dispose()
    dispose()
  })

  it('ignores a callback already dequeued when its owner is disposed', () => {
    let pending: Parameters<DecisionTimers['setTimeout']>[0] | undefined
    let calls = 0
    const dispose = scheduleAt(new FakeClock(0), 0, () => { calls += 1 }, {
      setTimeout(handler) { pending = handler; return 1 }, clearTimeout() {},
    })
    dispose()
    pending!()
    expect(calls).toBe(0)
  })

  it('fires once at the target time and honors disposal', async () => {
    const clock = new FakeClock(1000)
    const { timers, runDue } = manualTimers(clock)
    const fired: number[] = []
    const cancel = scheduleAt(clock, 1500, () => fired.push(clock.now()), timers)
    expect(await runDue()).toBe(0)
    clock.advance(500)
    expect(await runDue()).toBe(1)
    expect(fired).toEqual([1500])
    clock.advance(10_000)
    expect(await runDue()).toBe(0)
    cancel()

    const cancelled = scheduleAt(clock, 100_000, () => fired.push(clock.now()), timers)
    cancelled()
    clock.advance(200_000)
    expect(await runDue()).toBe(0)
    expect(fired).toEqual([1500])
  })

  it('re-arms in bounded steps when the deadline exceeds the setTimeout ceiling', async () => {
    const clock = new FakeClock(0)
    const { timers, runDue } = manualTimers(clock)
    const fired: number[] = []
    scheduleAt(clock, MAX_TIMER_DELAY_MS + 5000, () => fired.push(clock.now()), timers)
    // Firing at the ceiling re-arms for the remainder before the target time.
    clock.advance(MAX_TIMER_DELAY_MS)
    expect(await runDue()).toBe(1)
    expect(fired).toEqual([])
    clock.advance(1)
    expect(await runDue()).toBe(0)
    clock.advance(4999)
    expect(await runDue()).toBe(1)
    expect(fired).toEqual([MAX_TIMER_DELAY_MS + 5000])
  })

  it('survives clock rollback and fires when time moves forward again', async () => {
    const clock = new FakeClock(0)
    const { timers, runDue } = manualTimers(clock)
    const fired: number[] = []
    const cancel = scheduleAt(clock, 1000, () => fired.push(clock.now()), timers)
    clock.nowMs = 500
    expect(await runDue()).toBe(0)
    clock.nowMs = 2000
    expect(await runDue()).toBe(1)
    expect(fired).toEqual([2000])
    cancel()
  })
})

describe('nextDeadline and sweeps', () => {
  it('picks the earliest open expiry; withdrawn questions only gain a deadline after dismissal', async () => {
    const clock = new FakeClock()
    const fixture = await openStore(clock)
    try {
      const question = await fixture.store.create({ sessionId: sessionId('s1'), question: 'q', choices: [] })
      const reserved = await fixture.store.create({ sessionId: sessionId('s2'), question: 'q', choices: [] })
      await fixture.store.reserveAnswer(reserved.decisionId, 0, { requestId: requestId('r1') })
      expect(nextDeadline(fixture.store, testLimits({ closedRetentionMs: 1000 })))
        .toBe(Date.parse(question.expiresAtUtc))

      // A withdrawn question stays open: queue absence is not a tombstone,
      // so the only remaining deadline is still the open question's expiry.
      const withdrawn = await fixture.store.markWithdrawn(reserved.decisionId)
      expect(nextDeadline(fixture.store, testLimits({ closedRetentionMs: 1000 })))
        .toBe(Date.parse(question.expiresAtUtc))

      // Dismissal settles the tracking: its retention becomes the deadline.
      const dismissed = await fixture.store.dismiss(reserved.decisionId, withdrawn.revision)
      expect(nextDeadline(fixture.store, testLimits({ closedRetentionMs: 1000 })))
        .toBe(Math.min(
          Date.parse(question.expiresAtUtc),
          Date.parse(dismissed.closedAtUtc!) + 1000,
        ))
    } finally {
      await fixture.dispose()
    }
  })

  it('runs expiry then retention in one sweep', async () => {
    const clock = new FakeClock()
    const fixture = await openStore(clock, testLimits({ closedRetentionMs: 1000 }))
    try {
      const open = await fixture.store.create({ sessionId: sessionId('s1'), question: 'q', choices: [] })
      clock.advance(25 * 60 * 60 * 1000)
      expect(await runSweeps(fixture.store)).toBe(1)
      expect(fixture.store.get(open.decisionId)?.lifecycle).toBe('expired')

      // Expired records are settled closed records: pruned after retention.
      clock.advance(500)
      expect(await runSweeps(fixture.store)).toBe(0)
      expect(fixture.store.get(open.decisionId)).toBeDefined()
      clock.advance(600)
      expect(await runSweeps(fixture.store)).toBe(0)
      expect(fixture.store.get(open.decisionId)).toBeUndefined()

      // A dismissed tombstone prunes the same way.
      const tombstone = await fixture.store.create({ sessionId: sessionId('s2'), question: 'q', choices: [] })
      await fixture.store.reserveAnswer(tombstone.decisionId, 0, { requestId: requestId('r1') })
      const withdrawn = await fixture.store.markWithdrawn(tombstone.decisionId)
      await fixture.store.dismiss(tombstone.decisionId, withdrawn.revision)
      clock.advance(500)
      expect(await runSweeps(fixture.store)).toBe(0)
      expect(fixture.store.get(tombstone.decisionId)).toBeDefined()
      clock.advance(600)
      expect(await runSweeps(fixture.store)).toBe(0)
      expect(fixture.store.get(tombstone.decisionId)).toBeUndefined()
    } finally {
      await fixture.dispose()
    }
  })

  it('arms at the next deadline, fires the sweep, and re-arms for retention', async () => {
    const clock = new FakeClock()
    const { timers, runDue } = manualTimers(clock)
    const fixture = await openStore(clock)
    try {
      const open = await fixture.store.create({ sessionId: sessionId('s1'), question: 'q', choices: [] })
      const handle = scheduleSweeps(fixture.store, clock, testLimits(), { timers })
      clock.advance(25 * 60 * 60 * 1000)
      expect(await runDue()).toBe(1)
      await handle.done()
      expect(fixture.store.get(open.decisionId)?.lifecycle).toBe('expired')
      // The expired record is now prunable at closedAt + retention.
      clock.advance(31 * 24 * 60 * 60 * 1000)
      expect(await runDue()).toBe(1)
      await handle.done()
      expect(fixture.store.get(open.decisionId)).toBeUndefined()
      // Nothing is scheduled any more.
      clock.advance(10 * 24 * 60 * 60 * 1000)
      expect(await runDue()).toBe(0)
      handle.stop()
    } finally {
      await fixture.dispose()
    }
  })
})

describe('mutation-driven re-arming (R8)', () => {
  it('arms through notify when the first record appears after an empty start', async () => {
    const clock = new FakeClock()
    const { timers, runDue } = manualTimers(clock)
    const fixture = await openStore(clock)
    try {
      // An empty store schedules nothing; the service wires the store's
      // onChange to handle.notify(), emulated here after the create.
      const handle = scheduleSweeps(fixture.store, clock, testLimits(), { timers })
      clock.advance(25 * 60 * 60 * 1000)
      expect(await runDue()).toBe(0)

      const created = await fixture.store.create({ sessionId: sessionId('s1'), question: 'q', choices: [] })
      handle.notify()
      clock.advance(24 * 60 * 60 * 1000 + 1000)
      expect(await runDue()).toBe(1)
      await handle.done()
      expect(fixture.store.get(created.decisionId)?.lifecycle).toBe('expired')
      handle.stop()
    } finally {
      await fixture.dispose()
    }
  })

  it('re-arms earlier when a new deadline pre-empts a later one', async () => {
    const clock = new FakeClock()
    const { timers, runDue } = manualTimers(clock)
    const fixture = await openStore(clock)
    try {
      const later = await fixture.store.create({ sessionId: sessionId('s1'), question: 'q', choices: [] })
      const handle = scheduleSweeps(fixture.store, clock, testLimits(), { timers })
      // A short-lived question created after scheduling pre-empts the long
      // deadline only when the handle re-arms on the mutation.
      const earlier = await fixture.store.create({ sessionId: sessionId('s2'), question: 'q', choices: [], ttlMs: 1000 })
      handle.notify()
      clock.advance(1000)
      expect(await runDue()).toBe(1)
      await handle.done()
      expect(fixture.store.get(earlier.decisionId)?.lifecycle).toBe('expired')
      expect(fixture.store.get(later.decisionId)?.lifecycle).toBe('open')
      handle.stop()
    } finally {
      await fixture.dispose()
    }
  })

  it('contains a failing sweep through onError without unhandled rejection', async () => {
    const clock = new FakeClock()
    const { timers, runDue } = manualTimers(clock)
    const fixture = await openStore(clock)
    try {
      // A record is needed so the cycle has a deadline to arm at.
      await fixture.store.create({ sessionId: sessionId('s1'), question: 'q', choices: [] })
      const failures: unknown[] = []
      const failing = async (): Promise<number> => {
        throw new Error('boom')
      }
      const original = fixture.store.expireOverdue.bind(fixture.store)
      fixture.store.expireOverdue = failing
      const handle = scheduleSweeps(fixture.store, clock, testLimits(), { timers, onError: error => failures.push(error) })
      clock.advance(25 * 60 * 60 * 1000)
      // The rejection is contained: no unhandled rejection escapes runDue.
      expect(await runDue()).toBe(1)
      await handle.done()
      expect(failures).toHaveLength(1)
      // The cycle re-arms after the failure and reports the next one too.
      clock.advance(1000)
      expect(await runDue()).toBe(1)
      await handle.done()
      expect(failures).toHaveLength(2)
      handle.stop()
      await handle.done()
      fixture.store.expireOverdue = original
    } finally {
      await fixture.dispose()
    }
  })

  it('done() settles an in-flight sweep stopped during disposal', async () => {
    const clock = new FakeClock()
    const { timers, runDue } = manualTimers(clock)
    const fixture = await openStore(clock)
    try {
      const open = await fixture.store.create({ sessionId: sessionId('s1'), question: 'q', choices: [] })
      const handle = scheduleSweeps(fixture.store, clock, testLimits(), { timers })
      clock.advance(25 * 60 * 60 * 1000)
      // The timer handler starts the sweep without awaiting it (matches the
      // production shape), so disposal can race an in-flight run.
      expect(await runDue()).toBe(1)
      handle.stop()
      await handle.done()
      expect(fixture.store.get(open.decisionId)?.lifecycle).toBe('expired')
      // Stopped handles re-arm nothing: advancing time fires no sweep.
      clock.advance(100 * 24 * 60 * 60 * 1000)
      expect(await runDue()).toBe(0)
    } finally {
      await fixture.dispose()
    }
  })
})

it('ignores notifications during an in-flight sweep and after stop', async () => {
  const clock = new FakeClock()
  const fixture = await openStore(clock)
  const { timers, runDue } = manualTimers(clock)
  try {
    await fixture.store.create({ sessionId: sessionId('sweep-notify'), question: 'q', choices: [] })
    const release = Promise.withResolvers<undefined>()
    const entered = Promise.withResolvers<undefined>()
    const original = fixture.store.expireOverdue.bind(fixture.store)
    fixture.store.expireOverdue = async (...args) => {
      entered.resolve(undefined)
      await release.promise
      return original(...args)
    }
    const handle = scheduleSweeps(fixture.store, clock, testLimits(), { timers })
    clock.advance(25 * 60 * 60 * 1000)
    await runDue()
    await entered.promise
    handle.notify()
    expect(await runDue()).toBe(0)
    release.resolve(undefined)
    await handle.done()
    handle.stop()
    handle.notify()
    expect(await runDue()).toBe(0)
  } finally { await fixture.dispose() }
})

it('contains a domain lost between sweep and re-arm', async () => {
  const clock = new FakeClock()
  const fixture = await openStore(clock)
  const { timers, runDue } = manualTimers(clock)
  try {
    await fixture.store.create({ sessionId: sessionId('sweep-close'), question: 'q', choices: [] })
    const original = fixture.store.expireOverdue.bind(fixture.store)
    fixture.store.expireOverdue = async (...args) => {
      const expired = await original(...args)
      await fixture.domain.close()
      return expired
    }
    const failures: unknown[] = []
    const handle = scheduleSweeps(fixture.store, clock, testLimits(), {
      timers, onError: (error) => { failures.push(error) },
    })
    clock.advance(25 * 60 * 60 * 1000)
    await runDue()
    await handle.done()
    expect(failures.length).toBeGreaterThan(0)
    handle.stop()
  } finally { await fixture.dispose() }
})

it('keeps the earliest deadline and retains a legacy closed record without a closure timestamp', async () => {
  const clock = new FakeClock()
  const fixture = await openStore(clock)
  try {
    const earlier = await fixture.store.create({ sessionId: sessionId('earlier'), question: 'q', choices: [], ttlMs: 1000 })
    await fixture.store.create({ sessionId: sessionId('later'), question: 'q', choices: [], ttlMs: 2000 })
    expect(nextDeadline(fixture.store, testLimits())).toBe(Date.parse(earlier.expiresAtUtc))
    const legacy = await fixture.store.create({ sessionId: sessionId('legacy'), question: 'q', choices: [] })
    await fixture.store.cancel(legacy.decisionId, 0)
    const table = fixture.domain.table('decisions')
    await table.update(legacy.decisionId, (current) => {
      const { closedAtUtc: _removed, ...retained } = current
      return retained
    })
    expect(nextDeadline(fixture.store, testLimits())).toBe(Date.parse(earlier.expiresAtUtc))
    await fixture.store.sweepRetention(Number.MAX_SAFE_INTEGER)
    expect(fixture.store.get(legacy.decisionId)).toBeDefined()
  } finally { await fixture.dispose() }
})

it('retains closed questions whose answer admission is still unresolved', async () => {
  const fixture = await openStore(new FakeClock())
  try {
    const q = await fixture.store.create({ sessionId: sessionId('closed-pending'), question: 'q', choices: [] })
    await fixture.store.reserveAnswer(q.decisionId, q.revision, { requestId: requestId('reserved') })
    await fixture.store.supersede(q.decisionId)
    expect(nextDeadline(fixture.store, testLimits())).toBeUndefined()
    await fixture.store.sweepRetention(Number.MAX_SAFE_INTEGER)
    expect(fixture.store.get(q.decisionId)?.answerIndex).toBe('submitting')
    await fixture.store.markNeedsReconciliation(q.decisionId)
    expect(nextDeadline(fixture.store, testLimits())).toBeUndefined()
    await fixture.store.sweepRetention(Number.MAX_SAFE_INTEGER)
    expect(fixture.store.get(q.decisionId)?.answerIndex).toBe('needs_reconciliation')
  } finally { await fixture.dispose() }
})
