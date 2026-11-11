/**
 * Decision store lifecycle and policy: validated transitions over a real
 * durable storage domain, one-unresolved-per-session, capacity and retention,
 * the S2 answer-fact resolver priority (dismissed stays closed; entered
 * evidence wins over withdrawal and bare rejection), serialized concurrent
 * writes, and open-time record validation.
 * @module tests/store
 */

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { DecisionError } from '../src/errors.ts'
import { DECISIONS_TABLE, decisionsDomain } from '../src/schema.ts'
import { DecisionStore, mintDecisionId, resolveAnswerIndex, toView } from '../src/store.ts'
import { FakeClock, openStore, requestId, sessionId, testLimits } from './harness.ts'
import type { DecisionFacts, DecisionRecord } from '../src/types.ts'

async function saveQuestion(extras?: { ttlMs?: number; question?: string; choices?: string[] }): Promise<{ store: Awaited<ReturnType<typeof openStore>>['store']; fixture: Awaited<ReturnType<typeof openStore>>; record: DecisionRecord }> {
  const fixture = await openStore(new FakeClock())
  const record = await fixture.store.create({
    sessionId: sessionId('session-1'),
    question: extras?.question ?? 'Which database?',
    choices: extras?.choices ?? ['Postgres', 'SQLite'],
    ...(extras?.ttlMs === undefined ? {} : { ttlMs: extras.ttlMs }),
  })
  return { store: fixture.store, fixture, record }
}

function errorCode(run: () => Promise<unknown>): Promise<string> {
  return run().then(
    () => 'no-error',
    (error: unknown) => (error instanceof DecisionError ? error.code : String(error)),
  )
}

/**
 * Gate the store's next durable table update behind deterministic test
 * control: `entered` resolves when the update job reached the domain write
 * chain but its callback has NOT executed yet, and `release()` lets the
 * original update run. This pins the barrier tests to the real
 * domain-updater gap — a store that resolves facts only at its own chain
 * slot fails them.
 */
function gateNextUpdate(table: KvTable<string, DecisionRecord>): {
  entered: Promise<void>
  release(): void
} {
  const original = table.update.bind(table)
  let resolveEntered!: () => void
  let releaseGate!: () => void
  const entered = new Promise<void>((resolve) => { resolveEntered = resolve })
  const gate = new Promise<void>((resolve) => { releaseGate = resolve })
  table.update = (key, fn) => {
    resolveEntered()
    return gate.then(() => original(key, fn))
  }
  void gate.then(() => {
    table.update = original
  })
  return { entered, release: releaseGate }
}

/** Real digest fixture: the schema validates SHA-256 hex on persistence. */
function digest(seed: string): string {
  return createHash('sha256').update(seed).digest('hex')
}

describe('create', () => {
  it('saves an open question with server-minted id, default expiry, and revision 0', async () => {
    const { fixture, record } = await saveQuestion()
    try {
      expect(record.lifecycle).toBe('open')
      expect(record.answerIndex).toBe('none')
      expect(record.revision).toBe(0)
      expect(record.answer).toBeNull()
      expect(record.decisionId).toMatch(/^[0-9a-f-]{36}$/)
      expect(record.choices.map((choice: { label: string }) => choice.label)).toEqual(['Postgres', 'SQLite'])
      expect(Date.parse(record.expiresAtUtc) - Date.parse(record.createdAtUtc)).toBe(testLimits().defaultTtlMs)
    } finally {
      await fixture.dispose()
    }
  })

  it('refuses a second unresolved question for the same session, allows it after closure', async () => {
    const { store, fixture, record } = await saveQuestion()
    try {
      expect(await errorCode(() => store.create({ sessionId: sessionId('session-1'), question: 'again', choices: [] })))
        .toBe('DECISION_CONFLICT')
      await store.cancel(record.decisionId, 0)
      const second = await store.create({ sessionId: sessionId('session-1'), question: 'again', choices: [] })
      expect(second.lifecycle).toBe('open')
    } finally {
      await fixture.dispose()
    }
  })

  it('enforces question, choice, and count bounds', async () => {
    const { store, fixture } = await saveQuestion()
    try {
      expect(await errorCode(() => store.create({ sessionId: sessionId('session-2'), question: 'x'.repeat(1025), choices: [] })))
        .toBe('DECISION_LIMIT_EXCEEDED')
      expect(await errorCode(() => store.create({ sessionId: sessionId('session-2'), question: 'ok', choices: ['a'.repeat(65)] })))
        .toBe('DECISION_LIMIT_EXCEEDED')
      expect(await errorCode(() => store.create({ sessionId: sessionId('session-2'), question: 'ok', choices: ['1', '2', '3', '4', '5'] })))
        .toBe('DECISION_LIMIT_EXCEEDED')
    } finally {
      await fixture.dispose()
    }
  })

  it('refuses creation at capacity even after retention cannot free anything', async () => {
    const fixture = await openStore(new FakeClock(), testLimits({ maxRecords: 2 }))
    try {
      await fixture.store.create({ sessionId: sessionId('s1'), question: 'q', choices: [] })
      await fixture.store.create({ sessionId: sessionId('s2'), question: 'q', choices: [] })
      expect(await errorCode(() => fixture.store.create({ sessionId: sessionId('s3'), question: 'q', choices: [] })))
        .toBe('DECISION_BUSY_CAPACITY')
    } finally {
      await fixture.dispose()
    }
  })

  it('frees capacity by pruning settled closed records before refusing', async () => {
    const clock = new FakeClock()
    const fixture = await openStore(clock, testLimits({ maxRecords: 2, closedRetentionMs: 1000 }))
    try {
      const first = await fixture.store.create({ sessionId: sessionId('s1'), question: 'q', choices: [] })
      await fixture.store.reserveAnswer(first.decisionId, 0, { requestId: requestId('r1') })
      await fixture.store.markWithdrawn(first.decisionId)
      // A withdrawn question stays open: dismissal settles it for retention.
      const withdrawn = fixture.store.get(first.decisionId)!
      await fixture.store.dismiss(first.decisionId, withdrawn.revision)
      await fixture.store.create({ sessionId: sessionId('s2'), question: 'q', choices: [] })
      clock.advance(2000)
      const third = await fixture.store.create({ sessionId: sessionId('s3'), question: 'q', choices: [] })
      expect(third.lifecycle).toBe('open')
    } finally {
      await fixture.dispose()
    }
  })

  it('serializes concurrent creates for one session into one winner', async () => {
    const fixture = await openStore(new FakeClock())
    try {
      const results = await Promise.allSettled([
        fixture.store.create({ sessionId: sessionId('s1'), question: 'q1', choices: [] }),
        fixture.store.create({ sessionId: sessionId('s1'), question: 'q2', choices: [] }),
      ])
      const fulfilled = results.filter(result => result.status === 'fulfilled')
      const rejected = results.filter(result => result.status === 'rejected')
      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(DecisionError)
      expect(((rejected[0] as PromiseRejectedResult).reason as DecisionError).code).toBe('DECISION_CONFLICT')
    } finally {
      await fixture.dispose()
    }
  })
})

describe('reserveAnswer', () => {
  it('reserves once, then classifies further submissions as taken', async () => {
    const { store, fixture, record } = await saveQuestion()
    try {
      const reserved = await store.reserveAnswer(record.decisionId, 0, { requestId: requestId('r1'), digest: digest('d1') })
      expect(reserved.reserved).toBe(true)
      expect(reserved.record.answerIndex).toBe('submitting')
      expect(reserved.record.answer).toMatchObject({ requestId: 'r1', digest: digest('d1') })
      const replay = await store.reserveAnswer(record.decisionId, reserved.record.revision, { requestId: requestId('r2'), digest: digest('d2') })
      expect(replay.reserved).toBe(false)
      expect(replay.record.answerIndex).toBe('submitting')
      expect(replay.record.answer).toMatchObject({ requestId: 'r1', digest: digest('d1') })
    } finally {
      await fixture.dispose()
    }
  })

  it('resolves concurrent reservations into exactly one winner', async () => {
    const { store, fixture, record } = await saveQuestion()
    try {
      const [first, second] = await Promise.all([
        store.reserveAnswer(record.decisionId, 0, { requestId: requestId('r1'), digest: digest('d1') }),
        store.reserveAnswer(record.decisionId, 0, { requestId: requestId('r2'), digest: digest('d2') }),
      ])
      const reserved = [first, second].filter(result => result.reserved)
      expect(reserved).toHaveLength(1)
      // The stored answer pointer is the winner's identity, never overwritten
      // by the loser: one decision admits exactly one request.
      const saved = store.get(record.decisionId)!
      expect(saved.answerIndex).toBe('submitting')
      expect(saved.answer?.requestId).toBe(reserved[0]!.record.answer?.requestId)
    } finally {
      await fixture.dispose()
    }
  })

  it('rejects a stale revision with DECISION_CONFLICT', async () => {
    const { store, fixture, record } = await saveQuestion()
    try {
      expect(await errorCode(() => store.reserveAnswer(record.decisionId, 7, { requestId: requestId('r1') })))
        .toBe('DECISION_CONFLICT')
    } finally {
      await fixture.dispose()
    }
  })

  it('expires an overdue open question at answer time and refuses with DECISION_EXPIRED', async () => {
    const clock = new FakeClock()
    const fixture = await openStore(clock)
    try {
      const record = await fixture.store.create({ sessionId: sessionId('session-1'), question: 'Which database?', choices: ['Postgres'] })
      clock.advance(25 * 60 * 60 * 1000)
      expect(await errorCode(() => fixture.store.reserveAnswer(record.decisionId, 0, { requestId: requestId('r1') })))
        .toBe('DECISION_EXPIRED')
      expect(fixture.store.get(record.decisionId)?.lifecycle).toBe('expired')
    } finally {
      await fixture.dispose()
    }
  })

  it('never expires a just-reserved question when a sweep races the reservation', async () => {
    const clock = new FakeClock()
    const fixture = await openStore(clock)
    try {
      const record = await fixture.store.create({
        sessionId: sessionId('session-1'),
        question: 'Which database?',
        choices: ['Postgres'],
        ttlMs: 1,
      })
      clock.advance(1000)
      // Whichever write wins the chain slot, the outcome is consistent: the
      // reservation succeeds and stays open, or the expiry closes it and the
      // reservation is refused — never a reserved-and-expired record.
      const [reserved] = await Promise.allSettled([
        fixture.store.reserveAnswer(record.decisionId, 0, { requestId: requestId('r1') }),
        fixture.store.expireOverdue(),
      ])
      const saved = fixture.store.get(record.decisionId)!
      if (reserved.status === 'fulfilled' && reserved.value.reserved) {
        expect(saved.lifecycle).toBe('open')
        expect(saved.answerIndex).toBe('submitting')
      } else {
        expect(saved.lifecycle).toBe('expired')
      }
    } finally {
      await fixture.dispose()
    }
  })

  it('refuses admission while paused and allows it after resume', async () => {
    const { store, fixture, record } = await saveQuestion()
    try {
      await store.pause(record.decisionId, 0, 'reviewing')
      expect(await errorCode(() => store.reserveAnswer(record.decisionId, 1, { requestId: requestId('r1') })))
        .toBe('DECISION_SUSPENDED')
      const resumed = await store.resume(record.decisionId, 1)
      expect(resumed.suspension).toBeNull()
      const reserved = await store.reserveAnswer(record.decisionId, 2, { requestId: requestId('r1') })
      expect(reserved.reserved).toBe(true)
    } finally {
      await fixture.dispose()
    }
  })

  it('refuses unknown records with DECISION_NOT_FOUND', async () => {
    const { store, fixture } = await saveQuestion()
    try {
      expect(await errorCode(() => store.reserveAnswer(mintDecisionId(), 0, { requestId: requestId('r1') })))
        .toBe('DECISION_NOT_FOUND')
    } finally {
      await fixture.dispose()
    }
  })
})

describe('settlement transitions', () => {
  it('marks admitted from submitting: answered, closed, evidence retained', async () => {
    const { store, fixture, record } = await saveQuestion()
    try {
      await store.reserveAnswer(record.decisionId, 0, { requestId: requestId('r1') })
      const admitted = await store.markAdmitted(record.decisionId)
      expect(admitted.answerIndex).toBe('admitted')
      expect(admitted.lifecycle).toBe('answered')
      expect(admitted.closedAtUtc).toBeDefined()
      expect(admitted.answer?.requestId).toBe('r1')
      expect(await store.markAdmitted(record.decisionId)).toBe(admitted)
    } finally {
      await fixture.dispose()
    }
  })

  it('degrades submitting to needs_reconciliation and keeps other states untouched', async () => {
    const { store, fixture, record } = await saveQuestion()
    try {
      expect(await store.markNeedsReconciliation(record.decisionId).then(r => r.answerIndex)).toBe('none')
      await store.reserveAnswer(record.decisionId, 0, { requestId: requestId('r1') })
      expect(await store.markNeedsReconciliation(record.decisionId).then(r => r.answerIndex)).toBe('needs_reconciliation')
      expect(await store.markNeedsReconciliation(record.decisionId).then(r => r.answerIndex)).toBe('needs_reconciliation')
    } finally {
      await fixture.dispose()
    }
  })

  it('records withdrawal as queue absence without cancelling the question', async () => {
    const { store, fixture, record } = await saveQuestion()
    try {
      expect(await store.markWithdrawn(record.decisionId).then(r => r.answerIndex)).toBe('none')
      await store.reserveAnswer(record.decisionId, 0, { requestId: requestId('r1') })
      const withdrawn = await store.markWithdrawn(record.decisionId)
      expect(withdrawn.answerIndex).toBe('withdrawn')
      // Queue absence is not user cancellation: the question stays open and
      // remains the session's unresolved question.
      expect(withdrawn.lifecycle).toBe('open')
      expect(withdrawn.closedAtUtc).toBeUndefined()
      expect(await errorCode(() => store.create({ sessionId: sessionId('session-1'), question: 'again', choices: [] })))
        .toBe('DECISION_CONFLICT')
      // Explicit dismissal is the tracking closure for a withdrawn answer.
      const dismissed = await store.dismiss(record.decisionId, withdrawn.revision)
      expect(dismissed.answerIndex).toBe('dismissed')
      expect(dismissed.lifecycle).toBe('cancelled')
    } finally {
      await fixture.dispose()
    }
  })

  it('resolves dismiss-versus-admit races into one consistent terminal state', async () => {
    const { store, fixture, record } = await saveQuestion()
    try {
      await store.reserveAnswer(record.decisionId, 0, { requestId: requestId('r1') })
      const [admitted, dismissed] = await Promise.allSettled([
        store.markAdmitted(record.decisionId),
        store.dismiss(record.decisionId, 1),
      ])
      const saved = store.get(record.decisionId)!
      expect(['admitted', 'dismissed']).toContain(saved.answerIndex)
      if (saved.answerIndex === 'admitted') {
        expect(admitted.status).toBe('fulfilled')
        expect(dismissed.status).toBe('rejected')
      } else {
        expect(dismissed.status).toBe('fulfilled')
        expect(admitted.status).toBe('rejected')
      }
    } finally {
      await fixture.dispose()
    }
  })

  it('dismisses an unresolved reservation and refuses admitted evidence', async () => {
    const { store, fixture, record } = await saveQuestion()
    try {
      await store.reserveAnswer(record.decisionId, 0, { requestId: requestId('r1') })
      const dismissed = await store.dismiss(record.decisionId, 1)
      expect(dismissed.answerIndex).toBe('dismissed')
      expect(dismissed.lifecycle).toBe('cancelled')
      expect(dismissed.resolution).toMatchObject({ kind: 'dismissed' })
      expect(dismissed.answer?.requestId).toBe('r1')

      const { fixture: other, record: otherRecord } = await saveQuestion()
      try {
        await other.store.reserveAnswer(otherRecord.decisionId, 0, { requestId: requestId('r2') })
        await other.store.markAdmitted(otherRecord.decisionId)
        expect(await errorCode(() => other.store.dismiss(otherRecord.decisionId, otherRecord.revision)))
          .toBe('DECISION_ALREADY_ADMITTED')
      } finally {
        await other.dispose()
      }
    } finally {
      await fixture.dispose()
    }
  })

  it('refuses dismissal of a question with no answer tracking', async () => {
    const { store, fixture, record } = await saveQuestion()
    try {
      // A reservation-free open question belongs to cancel, not dismiss.
      expect(await errorCode(() => store.dismiss(record.decisionId, 0))).toBe('DECISION_CONFLICT')
      expect((await store.cancel(record.decisionId, 0)).lifecycle).toBe('cancelled')
    } finally {
      await fixture.dispose()
    }
  })

  it('dismisses is revision-checked', async () => {
    const { store, fixture, record } = await saveQuestion()
    try {
      await store.reserveAnswer(record.decisionId, 0, { requestId: requestId('r1') })
      expect(await errorCode(() => store.dismiss(record.decisionId, 99))).toBe('DECISION_CONFLICT')
    } finally {
      await fixture.dispose()
    }
  })

  it('cancels only reservation-free open questions', async () => {
    const { store, fixture, record } = await saveQuestion()
    try {
      const cancelled = await store.cancel(record.decisionId, 0)
      expect(cancelled.lifecycle).toBe('cancelled')

      const { fixture: other, record: otherRecord } = await saveQuestion()
      try {
        await other.store.reserveAnswer(otherRecord.decisionId, 0, { requestId: requestId('r1') })
        expect(await errorCode(() => other.store.cancel(otherRecord.decisionId, 1))).toBe('DECISION_CONFLICT')
      } finally {
        await other.dispose()
      }
    } finally {
      await fixture.dispose()
    }
  })

  it('refuses cancellation of a withdrawn question; dismissal closes it', async () => {
    const { store, fixture, record } = await saveQuestion()
    try {
      await store.reserveAnswer(record.decisionId, 0, { requestId: requestId('r1') })
      const withdrawn = await store.markWithdrawn(record.decisionId)
      expect(await errorCode(() => store.cancel(record.decisionId, withdrawn.revision))).toBe('DECISION_CONFLICT')
      expect((await store.dismiss(record.decisionId, withdrawn.revision)).lifecycle).toBe('cancelled')
    } finally {
      await fixture.dispose()
    }
  })

  it('supersedes open questions, including one with an accepted pending answer', async () => {
    const { store, fixture, record } = await saveQuestion()
    try {
      const superseded = await store.supersede(record.decisionId)
      expect(superseded.lifecycle).toBe('superseded')

      // An in-flight reservation no longer blocks supersession: the accepted
      // answer still settles from durable evidence while the question keeps
      // its staleness fact. A late matching entry admits the answer without
      // resurrecting the superseded question as freshly answered.
      const { fixture: other, record: otherRecord } = await saveQuestion()
      try {
        const otherId = otherRecord.decisionId
        await other.store.reserveAnswer(otherRecord.decisionId, 0, { requestId: requestId('r1') })
        const stale = await other.store.supersede(otherId)
        expect(stale.lifecycle).toBe('superseded')
        expect(stale.answerIndex).toBe('submitting')
        other.store.accumulateFacts(otherId, { entered: true })
        const admitted = await other.store.settleFacts(otherId)
        expect(admitted.answerIndex).toBe('admitted')
        expect(admitted.lifecycle).toBe('superseded')
      } finally {
        await other.dispose()
      }
    } finally {
      await fixture.dispose()
    }
  })
})

describe('expiry and retention', () => {
  it('expires only overdue open questions without reservations', async () => {
    const clock = new FakeClock()
    const fixture = await openStore(clock)
    try {
      const open = await fixture.store.create({ sessionId: sessionId('s1'), question: 'q', choices: [] })
      const reserved = await fixture.store.create({ sessionId: sessionId('s2'), question: 'q', choices: [] })
      const closed = await fixture.store.create({ sessionId: sessionId('s3'), question: 'q', choices: [] })
      await fixture.store.cancel(closed.decisionId, 0)
      await fixture.store.reserveAnswer(reserved.decisionId, 0, { requestId: requestId('r1') })
      clock.advance(25 * 60 * 60 * 1000)
      expect(await fixture.store.expireOverdue()).toBe(1)
      expect(fixture.store.get(open.decisionId)?.lifecycle).toBe('expired')
      expect(fixture.store.get(reserved.decisionId)?.lifecycle).toBe('open')
      expect(fixture.store.get(closed.decisionId)?.lifecycle).toBe('cancelled')
    } finally {
      await fixture.dispose()
    }
  })

  it('prunes every settled closed record after retention, never unresolved evidence', async () => {
    const clock = new FakeClock()
    const fixture = await openStore(clock, testLimits({ closedRetentionMs: 1000, maxRecords: 8 }))
    try {
      const withdrawn = await fixture.store.create({ sessionId: sessionId('s1'), question: 'q', choices: [] })
      await fixture.store.reserveAnswer(withdrawn.decisionId, 0, { requestId: requestId('r1') })
      await fixture.store.markWithdrawn(withdrawn.decisionId)
      await fixture.store.dismiss(withdrawn.decisionId, fixture.store.get(withdrawn.decisionId)!.revision)
      const answered = await fixture.store.create({ sessionId: sessionId('s2'), question: 'q', choices: [] })
      await fixture.store.reserveAnswer(answered.decisionId, 0, { requestId: requestId('r2') })
      await fixture.store.markAdmitted(answered.decisionId)
      const cancelled = await fixture.store.create({ sessionId: sessionId('s3'), question: 'q', choices: [] })
      await fixture.store.cancel(cancelled.decisionId, 0)
      const submitting = await fixture.store.create({ sessionId: sessionId('s4'), question: 'q', choices: [] })
      await fixture.store.reserveAnswer(submitting.decisionId, 0, { requestId: requestId('r3') })
      const reconciling = await fixture.store.create({ sessionId: sessionId('s5'), question: 'q', choices: [] })
      await fixture.store.reserveAnswer(reconciling.decisionId, 0, { requestId: requestId('r4') })
      await fixture.store.markNeedsReconciliation(reconciling.decisionId)

      clock.advance(500)
      expect(await fixture.store.sweepRetention()).toEqual([])
      clock.advance(600)
      const pruned = await fixture.store.sweepRetention()
      expect(pruned).toContain(withdrawn.decisionId)
      expect(pruned).toContain(answered.decisionId)
      expect(pruned).toContain(cancelled.decisionId)
      // Open questions and unresolved answer evidence are never swept.
      expect(fixture.store.get(submitting.decisionId)).toBeDefined()
      expect(fixture.store.get(reconciling.decisionId)).toBeDefined()
    } finally {
      await fixture.dispose()
    }
  })

  it('keeps the unresolved index intact when a closed record is pruned while a newer question is open', async () => {
    const clock = new FakeClock()
    const fixture = await openStore(clock, testLimits({ closedRetentionMs: 1000 }))
    try {
      const first = await fixture.store.create({ sessionId: sessionId('s1'), question: 'q1', choices: [] })
      await fixture.store.cancel(first.decisionId, 0)
      clock.advance(2000)
      // Q2 opens after Q1 closed; pruning the elapsed Q1 must not delete
      // Q2's index entry for the shared session.
      const second = await fixture.store.create({ sessionId: sessionId('s1'), question: 'q2', choices: [] })
      await fixture.store.sweepRetention()
      expect(fixture.store.get(first.decisionId)).toBeUndefined()
      expect(fixture.store.get(second.decisionId)).toBeDefined()
      expect(await errorCode(() => fixture.store.create({ sessionId: sessionId('s1'), question: 'q3', choices: [] })))
        .toBe('DECISION_CONFLICT')
    } finally {
      await fixture.dispose()
    }
  })
})

describe('open-time validation', () => {
  it('fails the whole open when a record key does not match its decisionId', async () => {
    const root = await mkdtemp(join(tmpdir(), 'session-decisions-key-'))
    const ctx = new Context()
    try {
      await ctx.plugin(Storage)
      await ctx.plugin(StorageJson, { root })
      await ctx.plugin(StorageDomain, { backend: 'json' })
      const unitFile = join(root, 'session_decisions.json')
      const id = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f'
      await writeFile(unitFile, JSON.stringify({
        unit: { name: 'session_decisions', version: 1 },
        global: null,
        tables: { decisions: { 'not-the-id': {
          formatVersion: 1,
          decisionId: id,
          sessionId: 'session-1',
          createdAtUtc: '2026-01-01T00:00:00.000Z',
          expiresAtUtc: '2026-01-02T00:00:00.000Z',
          revision: 0,
          question: 'q',
          choices: [],
          lifecycle: 'open',
          answerIndex: 'none',
          answer: null,
          suspension: null,
        } } },
      }))
      await expect(errorCode(async () => {
        const domain = await ctx.storageDomain.open(decisionsDomain)
        new DecisionStore(domain, new FakeClock(), testLimits())
      })).resolves.toBe('DECISION_INVALID')
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails the whole open when two durable open records share one session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'session-decisions-dup-'))
    const ctx = new Context()
    try {
      await ctx.plugin(Storage)
      await ctx.plugin(StorageJson, { root })
      await ctx.plugin(StorageDomain, { backend: 'json' })
      const unitFile = join(root, 'session_decisions.json')
      const record = (id: string): object => ({
        formatVersion: 1,
        decisionId: id,
        sessionId: 'session-1',
        createdAtUtc: '2026-01-01T00:00:00.000Z',
        expiresAtUtc: '2026-01-02T00:00:00.000Z',
        revision: 0,
        question: 'q',
        choices: [],
        lifecycle: 'open',
        answerIndex: 'none',
        answer: null,
        suspension: null,
      })
      await writeFile(unitFile, JSON.stringify({
        unit: { name: 'session_decisions', version: 1 },
        global: null,
        tables: { decisions: {
          '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f': record('0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f'),
          '1f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f': record('1f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f'),
        } },
      }))
      await expect(errorCode(async () => {
        const domain = await ctx.storageDomain.open(decisionsDomain)
        new DecisionStore(domain, new FakeClock(), testLimits())
      })).resolves.toBe('DECISION_CONFLICT')
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('resolveAnswerIndex (S2 priority)', () => {
  const base: DecisionRecord = {
    formatVersion: 1,
    decisionId: mintDecisionId(),
    sessionId: sessionId('s1'),
    createdAtUtc: '2026-01-01T00:00:00.000Z',
    expiresAtUtc: '2026-01-02T00:00:00.000Z',
    revision: 2,
    question: 'q',
    choices: [],
    lifecycle: 'open',
    answerIndex: 'submitting',
    answer: { requestId: requestId('r1'), digest: digest('d1') },
  }

  function withIndex(answerIndex: DecisionRecord['answerIndex']): DecisionRecord {
    return { ...base, answerIndex }
  }

  const facts = (overrides: DecisionFacts): DecisionFacts => overrides

  it('never resolves a record without a saved answer pointer', () => {
    expect(resolveAnswerIndex({ ...base, answer: null }, facts({ entered: true }))).toBeUndefined()
  })

  it('keeps a dismissed tombstone closed regardless of later entry', () => {
    expect(resolveAnswerIndex(withIndex('dismissed'), facts({ entered: true }))).toBeUndefined()
  })

  it('upgrades withdrawn and needs_reconciliation on entered evidence', () => {
    expect(resolveAnswerIndex(withIndex('withdrawn'), facts({ entered: true }))).toBe('admitted')
    expect(resolveAnswerIndex(withIndex('needs_reconciliation'), facts({ entered: true }))).toBe('admitted')
  })

  it('keeps submitting while pending or claimed', () => {
    expect(resolveAnswerIndex(base, facts({ pending: true }))).toBe('submitting')
    expect(resolveAnswerIndex(base, facts({ claimed: true }))).toBe('submitting')
  })

  it('degrades submitting on bare rejection, stop, or agent loss', () => {
    expect(resolveAnswerIndex(base, facts({ turnEnded: true }))).toBe('needs_reconciliation')
    expect(resolveAnswerIndex(base, facts({ stopping: true }))).toBe('needs_reconciliation')
    expect(resolveAnswerIndex(base, facts({ agentGone: true }))).toBe('needs_reconciliation')
  })

  it('records queue absence as withdrawn', () => {
    expect(resolveAnswerIndex(base, facts({ discarded: true }))).toBe('withdrawn')
  })

  it('resolves combined fact sets by B0 priority', () => {
    // A settled claim degrades even though the claim fact also holds.
    expect(resolveAnswerIndex(base, facts({ claimed: true, turnEnded: true }))).toBe('needs_reconciliation')
    // A re-queued edit/promotion is live queue state and outranks the settled claim.
    expect(resolveAnswerIndex(base, facts({ claimed: true, turnEnded: true, pending: true }))).toBe('submitting')
    // Live pending outranks the historical discard of an earlier entry.
    expect(resolveAnswerIndex(base, facts({ discarded: true, pending: true }))).toBe('submitting')
    // Disposal observed before the withdrawn write outranks an uncommitted discard.
    expect(resolveAnswerIndex(base, facts({ discarded: true, agentGone: true }))).toBe('needs_reconciliation')
    // Pending evidence upgrades a degraded reservation back to in-flight.
    expect(resolveAnswerIndex(withIndex('needs_reconciliation'), facts({ pending: true }))).toBe('submitting')
  })

  it('keeps settled states untouched without entry', () => {
    expect(resolveAnswerIndex(withIndex('admitted'), facts({}))).toBeUndefined()
    expect(resolveAnswerIndex(withIndex('none'), facts({}))).toBeUndefined()
  })
})

describe('fact write barriers (R1)', () => {
  it('commits admission when entered evidence lands after a dismissal was queued', async () => {
    const { store, fixture, record } = await saveQuestion()
    try {
      await store.reserveAnswer(record.decisionId, 0, { requestId: requestId('r1') })
      // Hold the dismissal inside the domain write chain, before its update
      // callback executes.
      const gate = gateNextUpdate(fixture.domain.table(DECISIONS_TABLE))
      const dismissal = store.dismiss(record.decisionId, 1)
      await gate.entered
      // The observation lands inside the domain-updater gap: the callback
      // must still honor it.
      store.accumulateFacts(record.decisionId, { entered: true })
      gate.release()
      await expect(dismissal).rejects.toMatchObject({ code: 'DECISION_ALREADY_ADMITTED' })
      expect(store.get(record.decisionId)).toMatchObject({ answerIndex: 'admitted', lifecycle: 'answered' })
      // The committed admitted record refuses dismissal from here on.
      await expect(errorCode(() => store.dismiss(record.decisionId, 2))).resolves.toBe('DECISION_ALREADY_ADMITTED')
    } finally {
      await fixture.dispose()
    }
  })

  it('reclassifies a queued withdrawal to needs_reconciliation when disposal lands first', async () => {
    const { store, fixture, record } = await saveQuestion()
    try {
      await store.reserveAnswer(record.decisionId, 0, { requestId: requestId('r1') })
      // The discard observation queues the settlement write...
      store.accumulateFacts(record.decisionId, { discarded: true })
      // ...held inside the domain write chain, before its callback executes.
      const gate = gateNextUpdate(fixture.domain.table(DECISIONS_TABLE))
      const settle = store.settleFacts(record.decisionId)
      await gate.entered
      // The disposal lands inside the domain-updater gap.
      store.accumulateFacts(record.decisionId, { agentGone: true })
      gate.release()
      await expect(settle.then(r => r.answerIndex)).resolves.toBe('needs_reconciliation')
      // A directly queued withdrawal behind the same facts also resolves
      // inside its update callback instead of writing over the disposal.
      expect((await store.markWithdrawn(record.decisionId)).answerIndex).toBe('needs_reconciliation')
    } finally {
      await fixture.dispose()
    }
  })

  it('never reopens already-committed dismissed tracking', async () => {
    const { store, fixture, record } = await saveQuestion()
    try {
      await store.reserveAnswer(record.decisionId, 0, { requestId: requestId('r1') })
      await store.dismiss(record.decisionId, 1)
      store.accumulateFacts(record.decisionId, { entered: true })
      const settled = await store.settleFacts(record.decisionId)
      expect(settled.answerIndex).toBe('dismissed')
      await expect(errorCode(() => store.markAdmitted(record.decisionId))).resolves.toBe('DECISION_CONFLICT')
    } finally {
      await fixture.dispose()
    }
  })

  it('keeps already-committed withdrawn protected from later disposal and pending', async () => {
    const { store, fixture, record } = await saveQuestion()
    try {
      await store.reserveAnswer(record.decisionId, 0, { requestId: requestId('r1') })
      store.accumulateFacts(record.decisionId, { discarded: true })
      const withdrawn = await store.settleFacts(record.decisionId)
      expect(withdrawn.answerIndex).toBe('withdrawn')
      store.accumulateFacts(record.decisionId, { agentGone: true, pending: true })
      const after = await store.settleFacts(record.decisionId)
      expect(after.answerIndex).toBe('withdrawn')
      expect(after.revision).toBe(withdrawn.revision)
    } finally {
      await fixture.dispose()
    }
  })

  it('resets transient claim facts when a new queue cycle is observed', async () => {
    const { store, fixture, record } = await saveQuestion()
    try {
      await store.reserveAnswer(record.decisionId, 0, { requestId: requestId('r1') })
      store.accumulateFacts(record.decisionId, { claimed: true, turnEnded: true })
      // The re-queued edit is a new queue cycle: the settled claim no longer
      // describes the queue, and the fresh discard of that entry withdraws.
      store.accumulateFacts(record.decisionId, { pending: true })
      store.accumulateFacts(record.decisionId, { discarded: true })
      expect((await store.settleFacts(record.decisionId)).answerIndex).toBe('withdrawn')
    } finally {
      await fixture.dispose()
    }
  })
})

describe('durability and restart', () => {
  it('rebuilds the unresolved index from the durable domain after reopen', async () => {
    const clock = new FakeClock()
    const first = await openStore(clock)
    const root = first.root
    const created = await first.store.create({ sessionId: sessionId('s1'), question: 'q', choices: [] })
    await first.store.reserveAnswer(created.decisionId, 0, { requestId: requestId('r1') })
    await first.close()

    // Reopen the same root in a fresh context: the index rebuild must see
    // the persisted reservation and keep one-unresolved enforced.
    const ctx = new Context()
    try {
      await ctx.plugin(Storage)
      await ctx.plugin(StorageJson, { root })
      await ctx.plugin(StorageDomain, { backend: 'json' })
      const domain = await ctx.storageDomain.open(decisionsDomain)
      const reopened = new DecisionStore(domain, clock, testLimits())
      expect(reopened.get(created.decisionId)?.answerIndex).toBe('submitting')
      expect(await errorCode(() => reopened.create({ sessionId: sessionId('s1'), question: 'q2', choices: [] })))
        .toBe('DECISION_CONFLICT')
      await domain.close()
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('view mapping', () => {
  it('projects records with wire request metadata but no digest or answer body', async () => {
    const { store, fixture, record } = await saveQuestion()
    try {
      await store.reserveAnswer(record.decisionId, 0, { requestId: requestId('r1'), digest: digest('d1') })
      const view = toView(store.get(record.decisionId)!)
      // Wire metadata: the feature-allocated request identity, derived from
      // the server-minted decision id. Legitimate Remote transport data.
      expect(view.requestId).toBe(record.decisionId)
      expect(view.hasAnswer).toBe(true)
      // The retry-conflict digest and the saved answer pointer body never
      // leave the Host: they are durable correlation data, not client data.
      // (Assert against the real digest value: random UUIDs can contain any
      // short hex fixture substring by chance.)
      const wire = JSON.stringify(view)
      expect(wire).not.toContain('digest')
      expect(wire).not.toContain(digest('d1'))
      expect(view.suspended).toBe(false)
    } finally {
      await fixture.dispose()
    }
  })
})

describe('notification publication ownership', () => {
  it('claims one publication without changing question revision and updates it by compare-and-swap', async () => {
    const fixture = await openStore(new FakeClock())
    try {
      const question = await fixture.store.create({ sessionId: sessionId('publication-session'), question: 'Choose', choices: ['A', 'B'] })
      const pending = { publicationId: 'p1', state: 'in_flight' }
      expect(await fixture.store.writeNotification(question.decisionId, undefined, pending, question.revision)).toBe(true)
      expect(await fixture.store.writeNotification(question.decisionId, undefined, { publicationId: 'p2' }, question.revision)).toBe(false)
      expect(fixture.store.get(question.decisionId)?.revision).toBe(question.revision)
      expect(await fixture.store.writeNotification(question.decisionId, pending, { ...pending, state: 'sent', messageId: 'platform-id' })).toBe(true)
      expect(await fixture.store.writeNotification(question.decisionId, pending, { ...pending, state: 'unknown' })).toBe(false)
    } finally { await fixture.dispose() }
  })
})
