/**
 * Decision aggregate owner: validated lifecycle transitions over the
 * storage-domain table, the in-memory one-unresolved-per-session index,
 * capacity and retention enforcement, and the pure answer-fact resolver.
 *
 * Single-writer assumption: the owning service instance is the only writer of
 * the `session_decisions` domain, so in-memory indexes stay consistent with
 * the durable table between awaited writes. Every mutating operation is
 * serialized through one store-owned write chain, so concurrent callers
 * observe committed state at their chain slot, never a stale call-time read.
 * @module @deepseek-ai/dsh-experimental-session-decisions/store
 */

import { DecisionError } from './errors.ts'
import { DECISIONS_TABLE, decisionsDomain } from './schema.ts'
import type { DecisionAnswerIndex, DecisionAnswerPointer, DecisionClock, DecisionFacts, DecisionId, DecisionLifecycle, DecisionRecord, DecisionView } from './types.ts'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { createHash } from 'node:crypto'

const ENTRY_FLUSH_PENDING = new Error('Session entry flush is still pending')

/** Validated creation and content bounds for one deployment. */
export interface DecisionLimits {
  /** Maximum number of records retained (open and closed). */
  readonly maxRecords: number
  /** Maximum question lifetime in milliseconds; per-question TTL may shorten it. */
  readonly defaultTtlMs: number
  /** How long closed records are retained before settled ones may be pruned. */
  readonly closedRetentionMs: number
  /** Maximum UTF-8 byte length of a question. */
  readonly maxQuestionBytes: number
  /** Maximum number of choices per question. */
  readonly maxChoices: number
  /** Maximum UTF-8 byte length of one choice label. */
  readonly maxChoiceLabelBytes: number
}

/** Expected result of an answer reservation attempt. */
export type ReserveAnswerResult =
  | { readonly reserved: true; readonly record: DecisionRecord }
  | { readonly reserved: false; readonly record: DecisionRecord }

/**
 * Mint a server-owned decision id: an RFC 4122 v4 UUID.
 * @returns Fresh question UUID.
 */
export function mintDecisionId(): DecisionId {
  return randomUUID() as DecisionId
}

/**
 * UTF-8 byte length of one string; the bound every text limit is measured in.
 * @param value - Value to render or encode.
 * @returns Encoded UTF-8 byte count.
 */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

/**
 * Retry-conflict digest of one submitted payload: SHA-256 over a canonical
 * encoding with fixed key order. Stored only for same/different retry
 * classification; entered evidence is matched by `source.rpcId` alone.
 * @param payload - Answer fields used for validation and conflict detection.
 * @returns SHA-256 digest of the canonical answer fields.
 */
export function digestOf(payload: { choiceOrdinal?: number | undefined; text?: string | undefined }): string {
  return createHash('sha256')
    .update(JSON.stringify({ choiceOrdinal: payload.choiceOrdinal ?? null, text: payload.text ?? null }))
    .digest('hex')
}

/**
 * The feature-allocated Session request identity for one decision, derived
 * deterministically from its server-minted decision id: one decision admits
 * exactly one answer under exactly one request id, and a retry of any
 * outcome re-derives the same identity without a new allocator.
 * @param decisionId - Saved question identity.
 * @returns Stable Session request identity reserved for this question.
 */
export function answerRequestId(decisionId: DecisionId): SessionRequestId {
  return decisionId as string as SessionRequestId
}

/**
 * Resolve the answer-index effect of observed queue facts for one record.
 * Pure and deterministic; the priority encodes the B0 fact table
 * (stage-b0/guard-and-queue-oracles.md, lines 34-41):
 *
 * 1. A `dismissed` tombstone is tracking-closed and is never reopened.
 * 2. Entered durable evidence wins over every unsettled state, including a
 *    committed `withdrawn` tombstone.
 * 3. `admitted` is settled: no later queue fact downgrades it.
 * 4. A committed `withdrawn` tombstone is settled queue-absence evidence and
 *    is not upgraded by later disposal, pending, or claim facts.
 * 5. An unresolved claim (claimed turn not yet settled) is in flight;
 *    pending absence is expected.
 * 6. Live pending evidence on the same Agent is in flight — it upgrades a
 *    degraded reservation back to `submitting` (user edit or promotion).
 * 7. `turnEnded` is the settlement of the matching claimed turn without a
 *    matching entry; service stopping and agent disposal/archive likewise
 *    resolve an unentered reservation as `needs_reconciliation` — this
 *    outranks an uncommitted discard.
 * 8. An unpaired discard on a still-live Agent is queue absence:
 *    `withdrawn` means queue absence only, never user cancellation.
 *
 * Facts can only exist for a saved answer pointer; a record without one is
 * never resolved.
 *
 * @param record - current persisted record.
 * @param facts - observed queue facts for the record's saved request ID.
 * @returns the answer index to apply, or `undefined` to keep the current one.
 */
export function resolveAnswerIndex(
  record: DecisionRecord,
  facts: DecisionFacts,
): DecisionAnswerIndex | undefined {
  if (record.answer === null) return undefined
  if (record.answerIndex === 'dismissed') return undefined
  if (facts.entered) return 'admitted'
  if (record.answerIndex === 'admitted') return undefined
  if (record.answerIndex === 'withdrawn') return undefined
  if (facts.claimed && !facts.turnEnded) return 'submitting'
  if (facts.pending) return 'submitting'
  if (facts.turnEnded || facts.stopping || facts.agentGone) return 'needs_reconciliation'
  if (facts.discarded) return 'withdrawn'
  return undefined
}

/**
 * The record with one resolved answer index committed. `admitted` also
 * closes the record as answered with its first closure timestamp; the other
 * indexes keep the lifecycle untouched. Callers run this inside a
 * `table.update` callback so the resolved target commits atomically on the
 * storage domain's write chain.
 */
function withAnswerIndex(current: DecisionRecord, target: DecisionAnswerIndex, closedAtUtc: string): DecisionRecord {
  if (target === 'admitted') {
    return {
      ...current,
      revision: current.revision + 1,
      answerIndex: 'admitted',
      // A superseded question keeps its staleness fact: the late human
      // entry admits the answer without resurrecting the question as
      // freshly answered. Dismissal never reaches here (index gate above).
      lifecycle: current.lifecycle === 'open' ? 'answered' : current.lifecycle,
      closedAtUtc: current.closedAtUtc ?? closedAtUtc,
    }
  }
  return { ...current, revision: current.revision + 1, answerIndex: target }
}

/**
 * Map one persisted record to the browser-safe Remote view.
 * @param record - Persisted question record.
 * @returns Public question projection without its stored answer pointer.
 */
export function toView(record: DecisionRecord): DecisionView {
  return {
    decisionId: record.decisionId,
    requestId: answerRequestId(record.decisionId),
    sessionId: record.sessionId,
    question: record.question,
    choices: record.choices.map(choice => choice.label),
    createdAtUtc: record.createdAtUtc,
    expiresAtUtc: record.expiresAtUtc,
    revision: record.revision,
    lifecycle: record.lifecycle,
    answerIndex: record.answerIndex,
    hasAnswer: record.answer !== null,
    closedAtUtc: record.closedAtUtc,
    resolutionKind: record.resolution?.kind,
    suspended: record.suspension !== undefined && record.suspension !== null,
  }
}

const noop = (): void => {}

/** Owned decision table: lifecycle transitions plus index/capacity policy. */
export class DecisionStore {
  private readonly table: KvTable<string, DecisionRecord>
  /** Session id of every lifecycle-open record; at most one per session. */
  private readonly unresolved = new Map<SessionId, DecisionId>()
  /** Serialized write chain: every mutation runs at its own chain slot. */
  private chain: Promise<unknown> = Promise.resolve()
  /**
   * Latest accumulated queue facts per record. Sticky evidence (`entered`,
   * `claimed`, `turnEnded`, `discarded`, `stopping`, `agentGone`) is
   * monotonic; `pending` is current queue state and each observation
   * replaces it. Accumulated synchronously, so every write already in the
   * chain resolves against facts observed before its updater executes.
   */
  private readonly observedFacts = new Map<DecisionId, DecisionFacts>()
  /** Invoked after each committed mutation; the sweeper re-arms on it. */
  private readonly notifyChange: () => void

  constructor(
    domain: Domain<typeof decisionsDomain>,
    private readonly clock: DecisionClock,
    private readonly limits: DecisionLimits,
    onChange: () => void = noop,
  ) {
    this.table = domain.table(DECISIONS_TABLE)
    this.notifyChange = onChange
    for (const [key, record] of this.table.entries()) {
      // Record keys must agree with the record identity: the composed answer
      // text and request identity derive from `decisionId`, so a tampered or
      // mis-converted key is a whole-domain failure, not a per-record skip.
      if (key !== record.decisionId) {
        throw new DecisionError('DECISION_INVALID', `Decision record key "${key}" does not match its decisionId "${record.decisionId}"`)
      }
      if (record.lifecycle !== 'open') continue
      const existing = this.unresolved.get(record.sessionId)
      if (existing !== undefined) {
        throw new DecisionError('DECISION_CONFLICT', `Session "${record.sessionId}" has more than one durable open question (${existing}, ${record.decisionId})`)
      }
      this.unresolved.set(record.sessionId, record.decisionId)
    }
  }

  /** Flushes that must complete before an observed entry can change its aggregate. */
  private readonly entryFlushes = new Map<DecisionId, Promise<void>>()

  /**
   * Fence index updates behind the Session owner's durability checkpoint.
   * The caller owns the flush promise and reports failures; failed checkpoints
   * keep this record's writes fenced until the owning service unloads.
   * @param decisionId - Question whose entry was observed.
   * @param flush - Checkpoint covering the matching Session entry.
   */
  deferEntryFlush(decisionId: DecisionId, flush: Promise<void>): void {
    const prior = this.entryFlushes.get(decisionId)
    const barrier = prior === undefined ? flush : Promise.all([prior, flush]).then(noop)
    this.entryFlushes.set(decisionId, barrier)
    void barrier.then(() => {
      if (this.entryFlushes.get(decisionId) === barrier) this.entryFlushes.delete(decisionId)
    }, noop)
  }

  /** Retry only an uncommitted updater when newer entry evidence needs a flush. */
  private async update(decisionId: DecisionId, fn: (current: DecisionRecord) => DecisionRecord): Promise<DecisionRecord> {
    for (;;) {
      await this.entryFlushes.get(decisionId)
      try {
        return await this.table.update(decisionId, (current) => {
          if (this.entryFlushes.has(decisionId)) throw ENTRY_FLUSH_PENDING
          return fn(current)
        })
      } catch (error) {
        if (error !== ENTRY_FLUSH_PENDING) throw error
      }
    }
  }

  /** Run one mutation at the end of the store's serialized write chain. */
  private serialize<T>(job: () => Promise<T>): Promise<T> {
    const result = this.chain.then(job, job)
    this.chain = result.then(noop, noop)
    return result
  }

  /**
   * Synchronously accumulate observed queue facts for one record's saved
   * answer. Callers must accumulate BEFORE queueing any competing write, so
   * the write evaluates the facts inside its `table.update` callback (the
   * domain's own write chain) instead of an enqueue-time snapshot.
   *
   * Evidence classes (B0): `entered` and lifecycle evidence (`stopping`,
   * `agentGone`) are durable and monotonic. `discarded` is sticky historical
   * queue absence. `claimed`/`turnEnded` are transient state of ONE claim
   * cycle; `pending` is current queue state. A live `pending`, `claimed`, or
   * `discarded` observation re-observes the queue for the saved request
   * (insert, claim removal without a discard event, edit, promotion, or
   * re-removal), so the observation replaces the current queue state and
   * resets the previous claim cycle's transient facts instead of
   * masquerading them forward.
   * @param decisionId - Saved question identity.
   * @param facts - Observed Session admission evidence.
   */
  accumulateFacts(decisionId: DecisionId, facts: DecisionFacts): void {
    const prior = this.observedFacts.get(decisionId)
    const requeues = facts.pending !== undefined || facts.claimed !== undefined || facts.discarded !== undefined
    const base = prior !== undefined && requeues
      ? { ...prior, claimed: false, turnEnded: false, pending: facts.pending ?? false }
      : prior
    this.observedFacts.set(decisionId, {
      ...base,
      ...facts,
      entered: base?.entered === true || facts.entered === true,
      claimed: base?.claimed === true || facts.claimed === true,
      turnEnded: base?.turnEnded === true || facts.turnEnded === true,
      discarded: base?.discarded === true || facts.discarded === true,
      stopping: base?.stopping === true || facts.stopping === true,
      agentGone: base?.agentGone === true || facts.agentGone === true,
    })
  }

  /**
   * Resolve one record against its latest accumulated facts and commit the
   * resolved index. The facts are evaluated INSIDE the `table.update`
   * callback, which executes on the storage domain's own write chain: every
   * fact accumulated before the durable update runs wins, whatever was
   * already queued.
   * @param decisionId - Saved question identity.
   * @returns Question after accumulated facts settle through serialized storage.
   */
  settleFacts(decisionId: DecisionId): Promise<DecisionRecord> {
    return this.serialize(async () => {
      const before = this.table.get(decisionId)
      if (!before) throw new DecisionError('DECISION_NOT_FOUND', 'Decision record not found')
      const next = await this.update(decisionId, (current) => {
        const resolved = resolveAnswerIndex(current, this.observedFacts.get(decisionId) ?? {})
        if (resolved === undefined || resolved === current.answerIndex) return current
        return withAnswerIndex(current, resolved, new Date(this.clock.now()).toISOString())
      })
      this.afterCommit(before, next)
      return next
    })
  }

  /**
   * Maintain the unresolved index and change notification after one
   * committed table write. A no-op write (unchanged revision) notifies
   * nothing.
   */
  private afterCommit(before: DecisionRecord, next: DecisionRecord): void {
    if (next.revision === before.revision) return
    if (before.lifecycle === 'open' && next.lifecycle !== 'open') {
      this.unresolved.delete(before.sessionId)
    }
    this.notifyChange()
  }

  private allRecords(): DecisionRecord[] {
    return [...this.table.entries()].map(([, record]) => record)
  }

  /**
   * All records ordered by creation time.
   * @returns Retained question records.
   */
  list(): DecisionRecord[] {
    return this.allRecords()
      .sort((a, b) => a.createdAtUtc.localeCompare(b.createdAtUtc))
  }

  /**
   * One record, or `undefined`.
   * @param decisionId - Saved question identity.
   * @returns Question if it exists.
   */
  get(decisionId: DecisionId): DecisionRecord | undefined {
    return this.table.get(decisionId)
  }

  /**
   * The record whose feature-allocated request ID matches one Session
   * request: the reverse of `answerRequestId`. Observers correlate durable
   * `user/message` entries and inbox mutations by `source.rpcId` alone.
   * @param requestId - Reserved Session prompt identity.
   * @returns Question matching the reserved prompt identity, if any.
   */
  byRequestId(requestId: SessionRequestId): DecisionRecord | undefined {
    return this.allRecords().find(record => answerRequestId(record.decisionId) === requestId)
  }

  /**
   * The lifecycle-open record of one session, or `undefined`.
   * @param sessionId - Asking Session identity.
   * @returns Unresolved question for this Session, if any.
   */
  openOfSession(sessionId: SessionId): DecisionRecord | undefined {
    const decisionId = this.unresolved.get(sessionId)
    return decisionId === undefined ? undefined : this.table.get(decisionId)
  }

  /** Compare-and-swap notification metadata in the owning question record.
   * Publication progress never changes the question revision or answer authority.
   * @param decisionId - Saved question identity.
   * @param expected - Previously observed notification fields; undefined claims an empty slot.
   * @param next - Validated JSON-only publication metadata.
   * @param expectedRevision - Required initial question revision; omitted for publication settlement.
   * @returns Whether this call committed the metadata update.
   */
  writeNotification(decisionId: DecisionId, expected: JsonValue | undefined, next: JsonValue,
    expectedRevision?: number): Promise<boolean> {
    return this.serialize(async () => {
      let committed = false
      await this.update(decisionId, (current) => {
        if (JSON.stringify(current.notificationRefs) !== JSON.stringify(expected)) return current
        if (expectedRevision !== undefined && (current.revision !== expectedRevision
          || current.lifecycle !== 'open' || current.answerIndex !== 'none' || current.suspension
          || Date.parse(current.expiresAtUtc) <= this.clock.now())) return current
        committed = true
        return { ...current, notificationRefs: next }
      })
      return committed
    })
  }

  /**
   * Save a new open question. The one-unresolved check, capacity sweep, and
   * durable write all run inside the serialized chain, so concurrent creates
   * for one session cannot both claim the slot. Refuses creation when
   * retention cannot free capacity.
   * @param input - Question creation fields.
   * @returns Saved question with its initial revision.
   */
  create(input: {
    sessionId: SessionId
    question: string
    choices: readonly string[]
    ttlMs?: number
    /** Live `session.seq` at create time; durable cold-reconcile anchor. */
    contextAnchorSeq?: number
  }): Promise<DecisionRecord> {
    // Pure bound validation stays outside the chain; state-dependent policy
    // runs at the chain slot below.
    if (input.question.length < 1 || utf8ByteLength(input.question) > this.limits.maxQuestionBytes) {
      return Promise.reject(new DecisionError('DECISION_LIMIT_EXCEEDED', 'Question length is out of bounds'))
    }
    if (input.choices.length > this.limits.maxChoices) {
      return Promise.reject(new DecisionError('DECISION_LIMIT_EXCEEDED', `At most ${this.limits.maxChoices} choices are allowed`))
    }
    for (const label of input.choices) {
      if (label.length < 1 || utf8ByteLength(label) > this.limits.maxChoiceLabelBytes) {
        return Promise.reject(new DecisionError('DECISION_LIMIT_EXCEEDED', 'Choice label length is out of bounds'))
      }
    }
    return this.serialize(async () => {
      if (this.unresolved.has(input.sessionId)) {
        throw new DecisionError('DECISION_CONFLICT', 'This session already has an unresolved question')
      }
      if (this.table.size >= this.limits.maxRecords) {
        await this.sweepRetentionAt(this.clock.now())
      }
      if (this.table.size >= this.limits.maxRecords) {
        throw new DecisionError('DECISION_BUSY_CAPACITY', 'Decision storage is at capacity; ask in ordinary chat instead')
      }
      const nowMs = this.clock.now()
      const now = new Date(nowMs).toISOString()
      const ttlMs = input.ttlMs ?? this.limits.defaultTtlMs
      const record: DecisionRecord = {
        formatVersion: 1,
        decisionId: mintDecisionId(),
        sessionId: input.sessionId,
        createdAtUtc: now,
        expiresAtUtc: new Date(nowMs + ttlMs).toISOString(),
        revision: 0,
        question: input.question,
        choices: input.choices.map(label => ({ label })),
        lifecycle: 'open',
        answerIndex: 'none',
        answer: null,
        contextAnchorSeq: input.contextAnchorSeq,
        suspension: null,
      }
      await this.table.put(record.decisionId, record)
      this.unresolved.set(record.sessionId, record.decisionId)
      this.notifyChange()
      return record
    })
  }

  /**
   * Reserve the answer slot for one submitted answer: validate revision,
   * expiry, suspension, and lifecycle, then move the index to `submitting`
   * atomically at the chain slot. Overdue open questions are expired first
   * (expiry at answer time). A record whose index already left `none` returns
   * `reserved: false` for the caller to classify per the retry table.
   * @param decisionId - Saved question identity.
   * @param expectedRevision - Revision required for this mutation.
   * @param answer - Reserved answer identity, digest and admission timestamp.
   * @returns Question and whether this call acquired its single answer reservation.
   */
  reserveAnswer(
    decisionId: DecisionId,
    expectedRevision: number,
    answer: Omit<DecisionAnswerPointer, 'requestId'> & { requestId: SessionRequestId },
  ): Promise<ReserveAnswerResult> {
    return this.serialize(async () => {
      const before = this.table.get(decisionId)
      if (!before) throw new DecisionError('DECISION_NOT_FOUND', 'Decision record not found')
      if (before.lifecycle === 'open' && before.answerIndex === 'none') {
        if (Date.parse(before.expiresAtUtc) <= this.clock.now()) {
          await this.expireOne(before)
          throw new DecisionError('DECISION_EXPIRED', 'The question has expired')
        }
        if (before.suspension !== undefined && before.suspension !== null) {
          throw new DecisionError('DECISION_SUSPENDED', 'The question is paused; resume it before answering')
        }
        if (before.revision !== expectedRevision) {
          throw new DecisionError('DECISION_CONFLICT', 'The question changed since it was read')
        }
        const next = await this.update(decisionId, current => ({
          ...current,
          revision: current.revision + 1,
          answerIndex: 'submitting',
          answer: {
            requestId: answer.requestId,
            choiceOrdinal: answer.choiceOrdinal,
            digest: answer.digest,
          },
        }))
        this.notifyChange()
        return { reserved: true, record: next }
      }
      return { reserved: false, record: before }
    })
  }

  /**
   * Follow a queue edit to its replacement: rewrite the reserved answer's
   * retry-conflict digest to the replacement text's digest. Called when the
   * observers detect a correlated queue splice that removed the pending
   * answer and re-inserted the edited text at the same request identity —
   * the durable answer is the replacement, so a later original-payload
   * retry classifies as a different answer (`DECISION_CONFLICT`), and the
   * replacement's own retry classifies as the same answer.
   * @param decisionId - Saved question identity.
   * @param digest - Digest of the replacement queued answer text.
   * @returns Question tracking the replacement queued answer digest.
   */
  updateAnswerDigest(decisionId: DecisionId, digest: string): Promise<DecisionRecord> {
    return this.serialize(async () => {
      const before = this.table.get(decisionId)
      if (!before) throw new DecisionError('DECISION_NOT_FOUND', 'Decision record not found')
      if (before.answer === null || before.answer.digest === digest) return before
      const answer = before.answer
      const next = await this.update(decisionId, current => ({ ...current, answer: { ...answer, digest } }))
      this.notifyChange()
      return next
    })
  }

  /**
   * Record entered-evidence admission: index `admitted`, lifecycle `answered`.
   * The target resolves INSIDE the `table.update` callback against the
   * latest accumulated facts, so facts observed after queueing (a disposal,
   * a settlement) win over the enqueue-time intent, and a committed
   * `dismissed` tombstone is never reopened.
   * @param decisionId - Saved question identity.
   * @returns Question after durable admission evidence.
   */
  markAdmitted(decisionId: DecisionId): Promise<DecisionRecord> {
    return this.serialize(async () => {
      const before = this.table.get(decisionId)
      if (!before) throw new DecisionError('DECISION_NOT_FOUND', 'Decision record not found')
      if (before.answer === null) {
        throw new DecisionError('DECISION_CONFLICT', 'No answer was reserved for this question')
      }
      const next = await this.update(decisionId, (current) => {
        if (current.answerIndex === 'dismissed') return current
        const target = resolveAnswerIndex(current, this.observedFacts.get(decisionId) ?? {}) ?? 'admitted'
        if (target === current.answerIndex) return current
        return withAnswerIndex(current, target, new Date(this.clock.now()).toISOString())
      })
      if (next.answerIndex === 'dismissed') {
        throw new DecisionError('DECISION_CONFLICT', 'Answer tracking was dismissed and cannot be reopened')
      }
      this.afterCommit(before, next)
      return next
    })
  }

  /**
   * Mark a lost reservation as needing reconciliation. Only a `submitting`
   * reservation can degrade; the target resolves INSIDE the `table.update`
   * callback, so entered evidence observed after queueing commits `admitted`
   * instead of degrading accepted input.
   * @param decisionId - Saved question identity.
   * @returns Question retaining unresolved admission evidence.
   */
  markNeedsReconciliation(decisionId: DecisionId): Promise<DecisionRecord> {
    return this.serialize(async () => {
      const before = this.table.get(decisionId)
      if (!before) throw new DecisionError('DECISION_NOT_FOUND', 'Decision record not found')
      if (before.answerIndex !== 'submitting') return before
      const next = await this.update(decisionId, (current) => {
        const target = resolveAnswerIndex(current, this.observedFacts.get(decisionId) ?? {}) ?? 'needs_reconciliation'
        if (target === current.answerIndex) return current
        return withAnswerIndex(current, target, new Date(this.clock.now()).toISOString())
      })
      this.afterCommit(before, next)
      return next
    })
  }

  /**
   * Record queue absence as a committed `withdrawn` tombstone. The question
   * stays open: queue absence never cancels the question, and explicit
   * dismissal (`dismiss`) remains available for it. Later entered evidence
   * still upgrades the index to `admitted`. The target resolves INSIDE the
   * `table.update` callback: a disposal observed before the withdrawal
   * executes reclassifies an uncommitted discard as `needs_reconciliation`,
   * and entered evidence commits `admitted` — never a withdrawal written
   * over newer observations.
   * @param decisionId - Saved question identity.
   * @returns Question after a queued answer was withdrawn.
   */
  markWithdrawn(decisionId: DecisionId): Promise<DecisionRecord> {
    return this.serialize(async () => {
      const before = this.table.get(decisionId)
      if (!before) throw new DecisionError('DECISION_NOT_FOUND', 'Decision record not found')
      if (before.answerIndex === 'withdrawn') return before
      if (before.answerIndex !== 'submitting' && before.answerIndex !== 'needs_reconciliation') return before
      const next = await this.update(decisionId, (current) => {
        const target = resolveAnswerIndex(current, this.observedFacts.get(decisionId) ?? {}) ?? 'withdrawn'
        if (target === current.answerIndex) return current
        return withAnswerIndex(current, target, new Date(this.clock.now()).toISOString())
      })
      this.afterCommit(before, next)
      return next
    })
  }

  /**
   * Explicit tracking closure of an unresolved reservation (`submitting`,
   * `needs_reconciliation`, or `withdrawn`). Terminal states win inside the
   * `table.update` callback: an already-admitted answer is never dismissible
   * and a committed `dismissed` tombstone is never reopened, whatever facts
   * accumulated after queueing. When entered evidence was observed before
   * this update executes, admission wins (N2): the record commits as
   * answered and the dismissal reports `DECISION_ALREADY_ADMITTED`. A
   * question without a reservation has nothing to dismiss — `cancel` closes
   * it.
   * @param decisionId - Saved question identity.
   * @param expectedRevision - Revision required for this mutation.
   * @returns Tracking-dismissal result; an admitted input is not retracted.
   */
  dismiss(decisionId: DecisionId, expectedRevision: number): Promise<DecisionRecord> {
    return this.serialize(async () => {
      let failure: DecisionError | undefined
      const before = this.table.get(decisionId)
      if (!before) throw new DecisionError('DECISION_NOT_FOUND', 'Decision record not found')
      const next = await this.update(decisionId, (current) => {
        failure = undefined
        if (current.answerIndex === 'admitted') {
          failure = new DecisionError('DECISION_ALREADY_ADMITTED', 'The answer was already admitted; nothing to dismiss')
          return current
        }
        if (current.lifecycle !== 'open') {
          // A settled closed record never reopens; re-dismissing the
          // dismissed tombstone itself is the idempotent no-op.
          if (current.answerIndex !== 'dismissed') {
            failure = new DecisionError('DECISION_TRACKING_CLOSED', 'The question is already closed')
          }
          return current
        }
        if (current.answerIndex === 'none') {
          failure = new DecisionError('DECISION_CONFLICT', 'No answer tracking to dismiss; cancel the question instead')
          return current
        }
        if (current.revision !== expectedRevision) {
          failure = new DecisionError('DECISION_CONFLICT', 'The question changed since it was read')
          return current
        }
        if (current.answer !== null && this.observedFacts.get(decisionId)?.entered === true) {
          // Write barrier inside the domain update: entered evidence observed
          // before this dismissal executes wins — commit admission and report
          // already-admitted to the dismissal caller.
          return withAnswerIndex(current, 'admitted', new Date(this.clock.now()).toISOString())
        }
        return {
          ...current,
          revision: current.revision + 1,
          answerIndex: 'dismissed',
          lifecycle: 'cancelled',
          closedAtUtc: current.closedAtUtc ?? new Date(this.clock.now()).toISOString(),
          resolution: { kind: 'dismissed', atUtc: new Date(this.clock.now()).toISOString() },
        }
      })
      this.afterCommit(before, next)
      if (failure !== undefined) throw failure
      if (next.answerIndex === 'admitted') {
        throw new DecisionError('DECISION_ALREADY_ADMITTED', 'Answer evidence entered before dismissal; tracking is admitted')
      }
      return next
    })
  }

  /**
   * User cancellation of an open question with no answer reservation. A
   * record with an active reservation must use {@link dismiss} instead, so
   * in-flight human input is never silently discarded.
   * @param decisionId - Saved question identity.
   * @param expectedRevision - Revision required for this mutation.
   * @returns Cancellation result with the current question state.
   */
  cancel(decisionId: DecisionId, expectedRevision: number): Promise<DecisionRecord> {
    return this.serialize(async () => {
      const before = this.table.get(decisionId)
      if (!before) throw new DecisionError('DECISION_NOT_FOUND', 'Decision record not found')
      if (before.lifecycle !== 'open') {
        throw new DecisionError('DECISION_TRACKING_CLOSED', 'The question is already closed')
      }
      if (before.answerIndex !== 'none') {
        throw new DecisionError('DECISION_CONFLICT', 'An answer is in progress; dismiss it instead of cancelling')
      }
      if (before.revision !== expectedRevision) {
        throw new DecisionError('DECISION_CONFLICT', 'The question changed since it was read')
      }
      const next = await this.closeWith(decisionId, { answerIndex: before.answerIndex, lifecycle: 'cancelled' })
      this.notifyChange()
      return next
    })
  }

  /**
   * User pause: no answer admission until explicit resume.
   * @param decisionId - Saved question identity.
   * @param expectedRevision - Revision required for this mutation.
   * @param reason - User-visible suspension reason.
   * @returns Suspension result with the current question state.
   */
  pause(decisionId: DecisionId, expectedRevision: number, reason: string): Promise<DecisionRecord> {
    return this.serialize(async () => {
      const before = this.table.get(decisionId)
      if (!before) throw new DecisionError('DECISION_NOT_FOUND', 'Decision record not found')
      if (before.lifecycle !== 'open') {
        throw new DecisionError('DECISION_TRACKING_CLOSED', 'The question is already closed')
      }
      if (before.suspension !== undefined && before.suspension !== null) return before
      if (before.revision !== expectedRevision) {
        throw new DecisionError('DECISION_CONFLICT', 'The question changed since it was read')
      }
      const next = await this.update(decisionId, current => ({
        ...current,
        revision: current.revision + 1,
        suspension: { reason, sinceUtc: new Date(this.clock.now()).toISOString() },
      }))
      this.notifyChange()
      return next
    })
  }

  /**
   * Clear a user pause; admission revalidates expiry and revision afterwards.
   * @param decisionId - Saved question identity.
   * @param expectedRevision - Revision required for this mutation.
   * @returns Question-resumption result; does not resume Goal.
   */
  resume(decisionId: DecisionId, expectedRevision: number): Promise<DecisionRecord> {
    return this.serialize(async () => {
      const before = this.table.get(decisionId)
      if (!before) throw new DecisionError('DECISION_NOT_FOUND', 'Decision record not found')
      if (before.lifecycle !== 'open') {
        throw new DecisionError('DECISION_TRACKING_CLOSED', 'The question is already closed')
      }
      if (before.suspension === undefined || before.suspension === null) return before
      if (before.revision !== expectedRevision) {
        throw new DecisionError('DECISION_CONFLICT', 'The question changed since it was read')
      }
      const next = await this.update(decisionId, current => ({
        ...current,
        revision: current.revision + 1,
        suspension: null,
      }))
      this.notifyChange()
      return next
    })
  }

  /**
   * Supersede an open question after newer user input took over. An answer
   * reservation already in flight stays reserved: the accepted answer still
   * delivers and admits from durable entry evidence, while the question's
   * lifecycle stays `superseded` so the staleness fact survives for the
   * read tool and UI. Dismissal remains the explicit tracking-closed path.
   * @param decisionId - Saved question identity.
   * @returns Question closed by newer context.
   */
  supersede(decisionId: DecisionId): Promise<DecisionRecord> {
    return this.serialize(async () => {
      const before = this.table.get(decisionId)
      if (!before) throw new DecisionError('DECISION_NOT_FOUND', 'Decision record not found')
      if (before.lifecycle !== 'open') return before
      const next = await this.closeWith(decisionId, { answerIndex: before.answerIndex, lifecycle: 'superseded' })
      this.notifyChange()
      return next
    })
  }

  /**
   * Resolve after every write already queued on the serialized chain
   * settles. Teardown calls this after persisting unsettled reservations so
   * the domain closes on a quiescent store.
   */
  async drain(): Promise<void> {
    await this.chain
  }

  /**
   * Expire every overdue open question without an answer reservation.
   * Questions with `submitting` or `needs_reconciliation` evidence stay open
   * until their reservation resolves; a reserved answer is never expired
   * retroactively.
   *
   * @returns the number of records transitioned to `expired`.
   * @param nowMs - UTC epoch milliseconds; omitted to use the store clock.
   */
  expireOverdue(nowMs?: number): Promise<number> {
    return this.serialize(async () => {
      const now = nowMs ?? this.clock.now()
      let count = 0
      for (const record of this.allRecords()) {
        if (record.lifecycle !== 'open') continue
        if (record.answerIndex !== 'none') continue
        if (Date.parse(record.expiresAtUtc) > now) continue
        await this.expireOne(record)
        count += 1
      }
      if (count > 0) this.notifyChange()
      return count
    })
  }

  /**
   * Prune settled closed records whose closed-record retention has elapsed:
   * `answered`, `expired`, `cancelled`, `superseded`, plus closed
   * `withdrawn`/`dismissed` tombstones. Open questions and records with
   * `submitting` or `needs_reconciliation` evidence are never swept, and
   * closed records carry no index entry, so pruning never touches the
   * unresolved index.
   *
   * @returns the deleted decision ids.
   * @param nowMs - UTC epoch milliseconds; omitted to use the store clock.
   */
  sweepRetention(nowMs?: number): Promise<DecisionId[]> {
    return this.serialize(() => this.sweepRetentionAt(nowMs ?? this.clock.now()))
  }

  /** Unsynchronized retention body; callers hold the write chain. */
  private async sweepRetentionAt(now: number): Promise<DecisionId[]> {
    const deleted: DecisionId[] = []
    for (const record of this.allRecords()) {
      if (record.lifecycle === 'open') continue
      if (record.answerIndex === 'submitting' || record.answerIndex === 'needs_reconciliation') continue
      if (!record.closedAtUtc) continue
      if (Date.parse(record.closedAtUtc) + this.limits.closedRetentionMs > now) continue
      await this.table.delete(record.decisionId)
      // Retained-record pruning bounds the fact accumulator too: a pruned
      // record can never receive another fact.
      this.observedFacts.delete(record.decisionId)
      deleted.push(record.decisionId)
    }
    if (deleted.length > 0) this.notifyChange()
    return deleted
  }

  private async expireOne(record: DecisionRecord): Promise<DecisionRecord> {
    // Both callers hold the store write chain and have checked that no answer is reserved.
    return await this.update(record.decisionId, (current) => {
      return {
        ...current,
        revision: current.revision + 1,
        lifecycle: 'expired',
        closedAtUtc: new Date(this.clock.now()).toISOString(),
      }
    }).then((next) => {
      this.unresolved.delete(next.sessionId)
      return next
    })
  }

  private async closeWith(
    decisionId: DecisionId,
    patch: { answerIndex: DecisionAnswerIndex; lifecycle: DecisionLifecycle },
  ): Promise<DecisionRecord> {
    const next = await this.update(decisionId, current => ({
      ...current,
      revision: current.revision + 1,
      answerIndex: patch.answerIndex,
      lifecycle: patch.lifecycle,
      closedAtUtc: current.closedAtUtc ?? new Date(this.clock.now()).toISOString(),
    }))
    this.unresolved.delete(next.sessionId)
    return next
  }
}
