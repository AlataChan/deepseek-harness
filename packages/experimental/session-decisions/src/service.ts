/**
 * Host service owning the session-decisions feature: the decision domain,
 * the answer-admission reservation (single owner, also consumed by B2
 * workflow callbacks), expiry/retention sweeps, and the browser-facing
 * Remote surface.
 *
 * Domain-open failures isolate as an unavailable feature with visible
 * diagnostics: ordinary Host and chat boot continue, answer admission and
 * creation refuse, and no composition dependency breaks. Required session
 * services gate activation declaratively instead: an enabled composition
 * waits inside the injection callback until they are available and unwinds
 * its activation if one is later lost.
 * @module @deepseek-ai/dsh-experimental-session-decisions
 */

import type {} from '@deepseek-ai/dsh-experimental-desktop-im'
import { TenantReceiptStorage } from '@deepseek-ai/dsh-experimental-im-feishu'
import { FeishuQuestions, decisionReceiptDomain, publicationSchema } from './feishu/index.ts'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPromptRequest, SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { systemDecisionClock } from './clock.ts'
import { scheduleSweeps, type SweepHandle } from './expiry.ts'
import { DecisionError } from './errors.ts'
import { decisionsDomain } from './schema.ts'
import { answerRequestId, DecisionStore, digestOf, toView, utf8ByteLength, type DecisionLimits } from './store.ts'
import { DecisionObservers, type ProducingStepIdentity } from './observers.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-goal'
import type { AnswerSubmitOutcome, AnswerSubmitPayload, DecisionClock, DecisionErrorCode, DecisionFacts, DecisionId, DecisionRecord, DecisionView, RecordMutationOutcome } from './types.ts'

export type { AnswerSubmitPayload } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The session-decisions feature service. */
    sessionDecisions: SessionDecisionsService
  }
}

/** Validated deployment configuration. */
export interface SessionDecisionsConfig {
  /** Feature switch; a disabled service opens no domain and admits nothing. */
  enabled: boolean
  /** Publish finite-choice questions through an explicitly enabled desktop Feishu channel. */
  feishuEnabled: boolean
  /** Default question lifetime in milliseconds. */
  defaultTtlMs: number
  /** Closed-record retention in milliseconds. */
  closedRetentionMs: number
  /** Maximum number of retained records (open and closed). */
  maxRecords: number
  /** Maximum UTF-8 byte length of a question. */
  maxQuestionBytes: number
  /** Maximum number of choices per question. */
  maxChoices: number
  /** Maximum UTF-8 byte length of one choice label. */
  maxChoiceLabelBytes: number
  /** Maximum UTF-8 byte length of a free-text answer. */
  maxAnswerTextBytes: number
  /**
   * Maximum durable Session events scanned per session at boot
   * reconciliation. Reaching the bound before the log's end leaves the
   * unscanned remainder honestly unknown: open questions refuse admission
   * and outstanding reservations degrade, never silently trusted.
   */
  reconcileMaxEvents: number
}

/**
 * Exact composed answer sentence for an ordinal choice (B0-pinned literal).
 * @param decisionId - Saved question identity.
 * @param choiceOrdinal - One-based selected choice.
 * @returns Server-composed choice answer without model-authored labels.
 */
export function composeChoiceAnswer(decisionId: DecisionId, choiceOrdinal: number): string {
  return `Answer to question ${decisionId}: option ${choiceOrdinal}`
}

/**
 * Exact composed answer text for a free-text answer (B0-pinned prefix).
 * @param decisionId - Saved question identity.
 * @param text - Human answer text.
 * @returns Server-composed decision prefix followed by the human text.
 */
export function composeTextAnswer(decisionId: DecisionId, text: string): string {
  return `Answer to question ${decisionId}:\n${text}`
}

/**
 * Retry-conflict digest of one submitted payload: SHA-256 over a canonical
 * encoding with fixed key order. Stored only for same/different retry
 * classification; entered evidence is matched by `source.rpcId` alone.
 */
function sameAnswer(record: DecisionRecord, requestId: SessionRequestId, digest: string): boolean {
  return record.answer?.requestId === requestId && record.answer.digest === digest
}

/** Records admitted to a post-anchor Session scan have a concrete starting offset. */
type AnchoredDecisionRecord = DecisionRecord & { readonly contextAnchorSeq: number }

function hasContextAnchor(record: DecisionRecord): record is AnchoredDecisionRecord {
  return record.contextAnchorSeq !== undefined
}

function rejection(requestId: SessionRequestId, reason: DecisionErrorCode, message: string): AnswerSubmitOutcome {
  return { outcome: 'rejected', requestId, reason, message }
}

/** The session-decisions Host service; Remote namespace `sessionDecisions`. */
export default class SessionDecisionsService extends TypertRemoteService {
  static inject = ['storageDomain']

  static Config: z<SessionDecisionsConfig> = z.object({
    enabled: z.boolean().default(true),
    feishuEnabled: z.boolean().default(false),
    // Durations exceed the setTimeout ceiling on purpose: sweep timers re-arm
    // in bounded steps, so long TTLs and retentions stay expressible.
    defaultTtlMs: z.number().min(1).default(24 * 60 * 60 * 1000),
    closedRetentionMs: z.number().min(1).default(30 * 24 * 60 * 60 * 1000),
    maxRecords: z.natural().min(1).default(1000),
    maxQuestionBytes: z.natural().min(1).default(16384),
    maxChoices: z.natural().min(1).default(8),
    maxChoiceLabelBytes: z.natural().min(1).default(512),
    maxAnswerTextBytes: z.natural().min(1).default(16384),
    reconcileMaxEvents: z.natural().min(1).default(100_000),
  })

  private readonly config: SessionDecisionsConfig
  private readonly clock: DecisionClock = systemDecisionClock
  private store: DecisionStore | undefined
  /** Named reason the feature is unavailable; `undefined` when operational. */
  private unavailableReason: string | undefined
  private sweeper: SweepHandle | undefined
  /** Host-wide event observers; present only while the store is operational. */
  private observers: DecisionObservers | undefined
  /** Set at teardown start: no admission, reservation, or prompt afterward. */
  private stopping = false
  private feishu: FeishuQuestions | undefined
  private dependencyContext: Context | undefined
  /**
   * Records whose admission this process closed after a refused create's
   * durable closure failed: admission answers `reconciliation_required`
   * instead of admitting an answer to superseded context.
   */
  private readonly refusedAdmissions = new Set<DecisionId>()

  constructor(ctx: Context, config: SessionDecisionsConfig) {
    super(ctx, 'sessionDecisions')
    this.config = config
  }

  protected async [Service.init](): Promise<void> {
    if (!this.config.enabled) return
    // Enabled compositions require the session path: a missing controller,
    // store, agent registry, or projection would make every reservation a
    // wasted single admission. The requirement is declarative — activation
    // runs inside the injection callback context, which the framework only
    // enters once every required service is actually available, whatever
    // order the composition mounted them in, and whose effects unwind if a
    // dependency is later lost. Awaiting `inject` alone is not an
    // availability barrier and resources created after it would not track
    // dependency loss. A disabled service never demands the session stack.
    const required = ['sessionController', 'sessions', 'agents', 'sessionProjections',
      ...this.config.feishuEnabled ? ['desktopIm', 'sessionPersistence'] as const : []] as const
    if (required.every(name => this.ctx.get(name) !== undefined)) {
      // Fast path: the stack is already present, so activation completes
      // within init and plugin load still implies readiness.
      await this.ctx.inject([...required], depsCtx => this.activate(depsCtx))
      return
    }
    // Named waiting reason while the deps have not arrived yet: status and
    // invocations report the real activation state instead of "disabled".
    this.unavailableReason = `waiting for required services: ${required.join(', ')}`
    this.ctx.inject([...required], depsCtx => this.activate(depsCtx))
  }

  /**
   * Open the domain and start the feature once the injected session stack is
   * available. The teardown effect registers on the injection callback
   * context, so it unwinds both on plugin unload and on dependency loss. One
   * invalid record fails the whole open (`invalid-record`); the feature
   * isolates as unavailable with a visible diagnostic instead of breaking
   * Host or chat boot — records are never quarantined or skipped.
   */
  private async activate(depsCtx: Context): Promise<void> {
    this.dependencyContext = depsCtx
    // Reload after a dependency loss re-enters here: stale stopping and
    // unavailable state from the previous activation must not survive.
    this.stopping = false
    let receiptDomain: Domain<typeof decisionReceiptDomain> | undefined
    try {
      const domain = await this.ctx.storageDomain.open(decisionsDomain)
      depsCtx.effect(() => async () => {
        // Teardown order (B1): close admission, stop timers, drain the write
        // chain, persist unsettled reserved answers as unknown, unsubscribe
        // observers, close the domain.
        this.stopping = true
        await this.feishu?.close()
        this.feishu = undefined
        this.sweeper?.stop()
        await this.sweeper?.done()
        this.sweeper = undefined
        if (this.store !== undefined) {
          for (const record of this.store.list()) {
            if (record.answer === null || record.answerIndex === 'admitted'
              || record.answerIndex === 'withdrawn' || record.answerIndex === 'dismissed') continue
            try {
              await this.store.markNeedsReconciliation(record.decisionId)
            } catch (error) {
              this.ctx.logger.error('session-decisions: teardown settlement failed for %s: %s',
                record.decisionId, error instanceof Error ? error.message : String(error))
            }
          }
          await this.store.drain()
        }
        this.observers?.dispose()
        this.observers = undefined
        const closed = await Promise.allSettled([domain.close(), receiptDomain?.close()])
        receiptDomain = undefined
        for (const result of closed) {
          if (result.status === 'rejected') {
            this.ctx.logger.error('session-decisions: domain close failed: %s', String(result.reason))
          }
        }
        this.store = undefined
        this.dependencyContext = undefined
        this.unavailableReason = 'the feature was unloaded or lost a required service'
      }, 'sessionDecisions.domain')
      this.store = new DecisionStore(domain, this.clock, this.limits(), () => { this.sweeper?.notify() })
      await this.store.expireOverdue(this.clock.now())
      this.sweeper = scheduleSweeps(this.store, this.clock, { closedRetentionMs: this.config.closedRetentionMs }, {
        onError: (error) => {
          // A failed sweep means decision-durability is broken: contain it,
          // degrade to the unavailable state, and stop the failing cycle.
          const reason = error instanceof Error ? error.message : String(error)
          this.ctx.logger.error('session-decisions: decision sweep failed, feature degraded: %s', reason)
          this.sweeper?.stop()
          this.store = undefined
          this.unavailableReason = reason
        },
      })
      this.observers = new DecisionObservers(
        depsCtx,
        () => this.store,
        (decisionId, facts) => {
          void this.applyObservedFacts(decisionId, facts).catch((error: unknown) => {
            this.ctx.logger.error('session-decisions: fact settlement failed for %s: %s',
              decisionId, error instanceof Error ? error.message : String(error))
          })
        },
        (decisionId) => {
          // The durable supersede failed, so the stale question stays open
          // and answerable in this process too: close its admission.
          this.refusedAdmissions.add(decisionId)
        },
      )
      this.observers.start()
      await this.reconcileDurableEvidence()
      if (this.config.feishuEnabled) {
        // The domain effect owns callback drainage and both stores; separate effects unload concurrently.
        receiptDomain = await this.ctx.storageDomain.open(decisionReceiptDomain)
        this.feishu = new FeishuQuestions(
          depsCtx, this, depsCtx.desktopIm, new TenantReceiptStorage(receiptDomain), this.config.reconcileMaxEvents,
        )
      }
    } catch (error) {
      // One invalid record fails the whole open (`invalid-record`); the
      // feature isolates as unavailable with a visible diagnostic instead of
      // breaking Host or chat boot. Records are never quarantined or skipped.
      this.sweeper?.stop()
      await this.sweeper?.done()
      this.sweeper = undefined
      this.observers?.dispose()
      this.observers = undefined
      await this.store?.drain()
      this.store = undefined
      this.dependencyContext = undefined
      this.unavailableReason = error instanceof Error ? error.message : String(error)
      this.ctx.logger.error('session-decisions: decision domain unavailable, feature disabled: %s', this.unavailableReason)
    }
  }

  /** The live injection context owns access to the required Session services. */
  private get activeContext(): Context {
    if (this.dependencyContext === undefined) {
      throw new DecisionError('DECISION_UNAVAILABLE', 'The persistent-questions dependencies are unavailable')
    }
    return this.dependencyContext
  }

  /** The owned store; throws when the feature is disabled or isolated. */
  private get decisions(): DecisionStore {
    if (!this.store) {
      throw new DecisionError('DECISION_UNAVAILABLE', this.unavailableReason ?? 'The persistent-questions feature is disabled')
    }
    return this.store
  }

  /**
   * Validated feature limits, shared with the tools consumer for arg validation.
   * @returns Validated question bounds.
   */
  limits(): DecisionLimits {
    return {
      maxRecords: this.config.maxRecords,
      defaultTtlMs: this.config.defaultTtlMs,
      closedRetentionMs: this.config.closedRetentionMs,
      maxQuestionBytes: this.config.maxQuestionBytes,
      maxChoices: this.config.maxChoices,
      maxChoiceLabelBytes: this.config.maxChoiceLabelBytes,
    }
  }

  /** Degrade an unexpected storage failure into the typed unavailable state. */
  private degrade(error: unknown): never {
    if (error instanceof DecisionError) throw error
    const reason = error instanceof Error ? error.message : String(error)
    this.ctx.logger.error('session-decisions: decision storage failed: %s', reason)
    throw new DecisionError('DECISION_UNAVAILABLE', reason)
  }

  /**
   * Save a new open question. Public admission owner for the question tool
   * (B1.3) and workflow callers (B2): validation, one-unresolved, and
   * capacity policy all enforce here, not in Remote closures.
   * @param input - Question creation fields.
   * @returns Saved question with its initial revision.
   */
  async create(input: { sessionId: SessionId; question: string; choices: readonly string[]; ttlMs?: number }): Promise<DecisionView> {
    if (this.stopping) throw new DecisionError('DECISION_UNAVAILABLE', 'The persistent-questions feature is stopping')
    // Baseline: the open producing step's step-start generation (the model
    // is answering that context), or for non-tool callers the generation at
    // their own entry. A later bump means ordinary input raced the save.
    const baseline = this.observers?.stepGeneration(input.sessionId)
      ?? this.observers?.observedGeneration(input.sessionId) ?? 0
    if ((this.observers?.observedGeneration(input.sessionId) ?? 0) !== baseline) {
      throw new DecisionError('DECISION_CONFLICT', 'New input arrived before the question could be saved')
    }
    // Durable cold-reconcile anchor: the Session log length at create entry.
    // Every later durable `user/message` or inbox splice carries a strictly
    // greater seq, so boot reconciliation reads exactly the post-create
    // evidence (R2/R3); `undefined` (cold session) means no anchor and
    // conservative no-claim behavior.
    const contextAnchorSeq = this.ctx.get('sessions')?.get(input.sessionId)?.seq
    // Exact-optional input: omit the anchor when the session has no durable
    // log yet, instead of passing `undefined` explicitly.
    const anchor = contextAnchorSeq === undefined ? {} : { contextAnchorSeq }
    try {
      const view = this.viewOf(await this.decisions.create({ ...input, ...anchor }))
      const current = this.observers?.observedGeneration(input.sessionId) ?? 0
      if (current !== baseline) {
        // The input superseded nothing by itself (the record had no
        // unresolved index mid-write), so close the refused record here:
        // the saved history is superseded, never an actionable open
        // question. A failed closure stays visible in the log.
        try {
          await this.decisions.supersede(view.decisionId)
        } catch (supersedeError) {
          this.ctx.logger.error('session-decisions: refused create could not be closed for %s: %s',
            view.decisionId, supersedeError instanceof Error ? supersedeError.message : String(supersedeError))
          // The durable closure failed, so the saved record would stay open
          // and actionable and could admit an answer to superseded context.
          // Close this process's admission for the record: a `submitting`
          // reservation degrades durably, and a fresh open record is refused
          // at the admission gate. A restart re-derives the same refusal at
          // boot reconciliation: the record's post-anchor scan finds the
          // raced ordinary input and supersedes the stale question; if that
          // closure also fails, the record is unverifiable and refuses
          // admission again — never answerable on superseded context.
          try {
            await this.decisions.markNeedsReconciliation(view.decisionId)
          } catch (closeError) {
            this.ctx.logger.warn('session-decisions: refused create could not degrade reservation for %s: %s',
              view.decisionId, closeError instanceof Error ? closeError.message : String(closeError))
          }
          this.refusedAdmissions.add(view.decisionId)
        }
        throw new DecisionError('DECISION_CONFLICT', 'New input arrived while the question was being saved')
      }
      return view
    } catch (error) {
      this.degrade(error)
    }
  }

  /**
   * Answer-admission owner: validate the payload and its request identity,
   * reserve the answer slot, deliver exactly one Session prompt (`queue`
   * mode), flush durability, and leave settlement to durable evidence. Every
   * outcome returns the immutable feature-allocated request id; retries
   * classify per the B0 retry table without a second prompt.
   * @param decisionId - Saved question identity.
   * @param expectedRevision - Revision required for this mutation.
   * @param requestId - Reserved Session prompt identity.
   * @param payload - Answer fields used for validation and conflict detection.
   * @returns Admission outcome; uncertainty never permits another prompt.
   */
  @Remote
  async submit(
    decisionId: DecisionId,
    expectedRevision: number,
    requestId: SessionRequestId,
    payload: AnswerSubmitPayload,
  ): Promise<AnswerSubmitOutcome> {
    return this.admitWith(decisionId, expectedRevision, requestId, payload, undefined)
  }

  /**
   * Trusted local admission for B2 workflow callbacks: identical validation,
   * reservation, and one-prompt delivery to {@link submit}, without a caller
   * request identity (the feature's allocated ID is always used), plus the
   * optional `beforePrompt` hook. The hook runs exactly once, after the
   * reservation commits and before the one queued prompt, and receives only
   * the reserved decision, Session, and request identities. Hook failure
   * leaves the reservation unresolved: never reset, never resent, never
   * prompted — the retry table reports `submitting` until durable evidence
   * settles it.
   * @param decisionId - Saved question identity.
   * @param expectedRevision - Revision required for this mutation.
   * @param payload - Answer fields used for validation and conflict detection.
   * @param beforePrompt - Trusted local hook invoked after reservation and before the one queued prompt.
   * @returns Admission outcome for the shared desktop and verified-channel path.
   */
  async admitAnswer(
    decisionId: DecisionId,
    expectedRevision: number,
    payload: AnswerSubmitPayload,
    beforePrompt?: (reserved: { decisionId: DecisionId; sessionId: SessionId; requestId: SessionRequestId }) => Promise<void>,
  ): Promise<AnswerSubmitOutcome> {
    return this.admitWith(decisionId, expectedRevision, answerRequestId(decisionId), payload, beforePrompt)
  }

  /** Shared admission body of {@link submit} and {@link admitAnswer}. */
  private async admitWith(
    decisionId: DecisionId,
    expectedRevision: number,
    requestId: SessionRequestId,
    payload: AnswerSubmitPayload,
    beforePrompt: ((reserved: { decisionId: DecisionId; sessionId: SessionId; requestId: SessionRequestId }) => Promise<void>) | undefined,
  ): Promise<AnswerSubmitOutcome> {
    if (this.stopping) {
      return rejection(requestId, 'DECISION_UNAVAILABLE', 'The persistent-questions feature is stopping')
    }
    if (this.refusedAdmissions.has(decisionId)) {
      return { outcome: 'reconciliation_required', requestId: answerRequestId(decisionId) }
    }
    const digest = digestOf(payload)
    const allocated = answerRequestId(decisionId)
    try {
      const record = this.decisions.get(decisionId)
      if (!record) throw new DecisionError('DECISION_NOT_FOUND', 'Decision record not found')
      // B0 retry-table exceptions ahead of the generic identity gate: a
      // degraded reservation reports reconciliation for any caller, and a
      // dismissed tracking closes for the saved request regardless of the
      // replayed payload. Known-record responses carry the immutable
      // saved/allocated request id, never the caller's variant.
      if (record.answerIndex === 'needs_reconciliation') {
        return { outcome: 'reconciliation_required', requestId: allocated }
      }
      if (record.answerIndex === 'dismissed') {
        return record.answer?.requestId === requestId
          ? { outcome: 'tracking_closed', requestId }
          : rejection(allocated, 'DECISION_CONFLICT', 'A different answer request was recorded for this question')
      }
      if (requestId !== allocated) {
        return rejection(allocated, 'DECISION_CONFLICT', 'The answer request does not match the question\'s allocated identity')
      }
      const text = this.validatePayload(record, payload)
      const reservation = await this.decisions.reserveAnswer(decisionId, expectedRevision, { requestId: allocated, digest })
      if (!reservation.reserved) return this.classifyExisting(reservation.record, allocated, digest)
      // The reservation is committed. The hook (when present) runs before
      // the one prompt; its failure leaves the slot reserved and unresolved.
      if (beforePrompt !== undefined) {
        try {
          await beforePrompt({ decisionId, sessionId: reservation.record.sessionId, requestId: allocated })
        } catch (error) {
          this.ctx.logger.error('session-decisions: beforePrompt hook failed for %s; the answer stays reserved: %s',
            decisionId, error instanceof Error ? error.message : String(error))
          return { outcome: 'submitting', requestId: allocated }
        }
      }
      return await this.deliver(reservation.record, allocated, text)
    } catch (error) {
      if (error instanceof DecisionError && error.code === 'DECISION_UNAVAILABLE') throw error
      if (error instanceof DecisionError) return rejection(allocated, error.code, error.message)
      this.degrade(error)
    }
  }

  /** Validate the payload against the saved record's choices and bounds. */
  private validatePayload(record: DecisionRecord, payload: AnswerSubmitPayload): string {
    const hasOrdinal = payload.choiceOrdinal !== undefined
    const hasText = payload.text !== undefined && payload.text.length > 0
    if (hasOrdinal === hasText) {
      throw new DecisionError('DECISION_INVALID', 'Provide exactly one of choiceOrdinal or text')
    }
    if (hasOrdinal) {
      const ordinal = payload.choiceOrdinal
      if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > record.choices.length) {
        throw new DecisionError('DECISION_INVALID', `choiceOrdinal must be between 1 and ${record.choices.length}`)
      }
      return composeChoiceAnswer(record.decisionId, ordinal)
    }
    const text = payload.text as string
    if (utf8ByteLength(text) > this.config.maxAnswerTextBytes) {
      throw new DecisionError('DECISION_LIMIT_EXCEEDED', 'Answer text exceeds the configured limit')
    }
    return composeTextAnswer(record.decisionId, text)
  }

  /** Retry-table classification for a submission that found the slot taken. */
  private classifyExisting(record: DecisionRecord, requestId: SessionRequestId, digest: string): AnswerSubmitOutcome {
    switch (record.answerIndex) {
      case 'submitting':
      case 'admitted':
      case 'withdrawn':
        if (!sameAnswer(record, requestId, digest)) {
          return rejection(requestId, 'DECISION_CONFLICT', 'A different answer was already submitted for this question')
        }
        break
      case 'needs_reconciliation':
        return { outcome: 'reconciliation_required', requestId }
      case 'dismissed':
        return sameAnswer(record, requestId, digest)
          ? { outcome: 'tracking_closed', requestId }
          : rejection(requestId, 'DECISION_CONFLICT', 'A different answer was already submitted for this question')
      case 'none':
        return rejection(
          requestId,
          record.lifecycle === 'expired' ? 'DECISION_EXPIRED' : 'DECISION_TRACKING_CLOSED',
          'The question is closed',
        )
    }
    switch (record.answerIndex) {
      case 'submitting': return { outcome: 'submitting', requestId }
      case 'admitted': return { outcome: 'admitted', requestId }
      default: return { outcome: 'withdrawn', requestId }
    }
  }

  /** Deliver the composed answer as exactly one queued Session prompt. */
  private async deliver(record: DecisionRecord, requestId: SessionRequestId, text: string): Promise<AnswerSubmitOutcome> {
    const request: SessionPromptRequest = {
      requestId,
      sessionId: record.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text }],
    }
    try {
      await this.activeContext.sessionController.prompt(request, new AbortController().signal)
    } catch (error) {
      // A prompt throw after followup() enqueued must not reset the index:
      // pending or entered facts outrank the bare rejection. Only when the
      // check finds neither does the reservation degrade to
      // needs_reconciliation; later entered evidence upgrades it again.
      const facts = this.collectPromptFacts(record.sessionId, requestId)
      // An unsettled claim (message already taken into a turn whose
      // step/end has not fired yet) is in flight exactly like pending
      // state: it must not classify as reconciliation_required.
      if (facts.pending || facts.entered || this.observers?.hasUnsettledClaim(record.decisionId) === true) {
        return { outcome: 'submitting', requestId }
      }
      if (facts.pending === false || facts.agentGone) {
        await this.decisions.markNeedsReconciliation(record.decisionId)
        this.ctx.logger.warn('session-decisions: answer prompt rejected for %s: %s', record.decisionId, error instanceof Error ? error.message : String(error))
        return { outcome: 'reconciliation_required', requestId }
      }
      // Pending state is unobservable (inbox projection inactive): keep the
      // reservation in submitting so the retry table stays honest.
      this.ctx.logger.warn('session-decisions: answer prompt rejected with unobservable queue state for %s', record.decisionId)
      return { outcome: 'submitting', requestId }
    }
    // Flush before reporting acceptance: the admitted human message must be
    // durable before the outcome leaves the Host. A missing session or store
    // after successful admission is a composition failure, never skipped.
    const sessions = this.ctx.get('sessions')
    const session = sessions?.get(record.sessionId)
    if (!sessions || !session) {
      throw new DecisionError('DECISION_UNAVAILABLE', `Session "${record.sessionId}" is not live in the session store after answer admission`)
    }
    try {
      if (!await sessions.flush(session)) {
        throw new DecisionError('DECISION_UNAVAILABLE', 'The answer has no participating Session durability owner')
      }
    } catch (error) {
      // Durability of the admitted message failed; the answer stays queued
      // in the record's submitting state and the retry table classifies it.
      this.ctx.logger.error('session-decisions: flush after answer admission failed for %s: %s', record.decisionId, error instanceof Error ? error.message : String(error))
      return { outcome: 'submitting', requestId }
    }
    return { outcome: 'accepted', requestId, revision: this.decisions.get(record.decisionId)?.revision ?? 0 }
  }

  /**
   * Point-in-time queue facts for one saved request ID, from the public
   * inbox projection. Entered durable evidence is deliberately not scanned
   * here: B1.3's event-driven observers own entered-evidence settlement
   * through {@link applyFacts}. This covers the prompt-throw path only.
   */
  private collectPromptFacts(sessionId: SessionId, requestId: SessionRequestId): DecisionFacts {
    const matches = (source: UserMessage['source']): boolean =>
      source.kind === 'user' && 'rpcId' in source && source.rpcId === requestId
    const agents = this.ctx.get('agents')
    const agent = agents?.get(sessionId)
    if (!agents || !agent) return { agentGone: true }
    const state = this.activeContext.sessionProjections.stateOf(agent.session, 'inbox')
    if (state === undefined) return {}
    const pending = [...state['next-turn'], ...state['next-step']]
      .some(message => matches(message.source))
    return { pending }
  }

  /** Read private notification metadata for the trusted channel adapter.
   * @param decisionId - Saved question identity.
   * @returns JSON-only publication fields, when present.
   */
  notification(decisionId: DecisionId): Promise<JsonValue | undefined> {
    return Promise.resolve(this.decisions.get(decisionId)?.notificationRefs)
  }

  /** Compare-and-swap publication progress through the aggregate's single writer.
   * @param decisionId - Saved question identity.
   * @param expected - Previously read metadata; undefined claims an empty slot.
   * @param next - Validated publication metadata.
   * @param expectedRevision - Initial question revision, omitted for settlement.
   * @returns Whether this call committed the update.
   */
  writeNotification(decisionId: DecisionId, expected: JsonValue | undefined, next: JsonValue,
    expectedRevision?: number): Promise<boolean> {
    return this.decisions.writeNotification(decisionId, expected, next, expectedRevision)
  }

  /** Publish one optional notification after the question guard and turn conclusion are armed.
   * @param decisionId - Saved question identity.
   * @returns Completion of the bounded publication attempt; a saved question remains usable on failure.
   */
  async notifyQuestion(decisionId: DecisionId): Promise<void> {
    try { await this.feishu?.publish(decisionId) }
    catch (_error) { this.ctx.logger.warn('Feishu question notification could not be confirmed; use the desktop question') }
  }

  /**
   * Questions belonging to the asking Session.
   * @param sessionId - Asking Session identity.
   * @returns Questions belonging to the asking Session.
   */
  @Remote
  catalog(sessionId: SessionId): Promise<DecisionView[]> {
    try {
      return Promise.resolve(this.decisions.list()
        .filter(record => record.sessionId === sessionId)
        .map(record => this.viewOf(record)))
    } catch (error) {
      this.degrade(error)
    }
  }

  /**
   * Question if it exists.
   * @param decisionId - Saved question identity.
   * @returns Question if it exists.
   */
  @Remote
  get(decisionId: DecisionId): Promise<DecisionView | undefined> {
    try {
      const record = this.decisions.get(decisionId)
      return Promise.resolve(record ? this.viewOf(record) : undefined)
    } catch (error) {
      this.degrade(error)
    }
  }

  /**
   * Feature availability for diagnostics: available state or the named failure.
   * @returns Feature availability and an optional unavailability reason.
   */
  @Remote
  status(): Promise<{ available: boolean; reason?: string }> {
    if (!this.store) return Promise.resolve({ available: false, reason: this.unavailableReason ?? 'The persistent-questions feature is disabled' })
    return Promise.resolve({ available: true })
  }

  /**
   * Tracking-dismissal result; an admitted input is not retracted.
   * @param decisionId - Saved question identity.
   * @param expectedRevision - Revision required for this mutation.
   * @returns Tracking-dismissal result; an admitted input is not retracted.
   */
  @Remote
  async dismiss(decisionId: DecisionId, expectedRevision: number): Promise<RecordMutationOutcome> {
    try {
      return { ok: true, record: this.viewOf(await this.decisions.dismiss(decisionId, expectedRevision)) }
    } catch (error) {
      return this.mutationFailure(error)
    }
  }

  /**
   * Cancellation result with the current question state.
   * @param decisionId - Saved question identity.
   * @param expectedRevision - Revision required for this mutation.
   * @returns Cancellation result with the current question state.
   */
  @Remote
  async cancel(decisionId: DecisionId, expectedRevision: number): Promise<RecordMutationOutcome> {
    try {
      return { ok: true, record: this.viewOf(await this.decisions.cancel(decisionId, expectedRevision)) }
    } catch (error) {
      return this.mutationFailure(error)
    }
  }

  /**
   * Suspension result with the current question state.
   * @param decisionId - Saved question identity.
   * @param expectedRevision - Revision required for this mutation.
   * @param reason - User-visible suspension reason.
   * @returns Suspension result with the current question state.
   */
  @Remote
  async pause(decisionId: DecisionId, expectedRevision: number, reason: string): Promise<RecordMutationOutcome> {
    try {
      return { ok: true, record: this.viewOf(await this.decisions.pause(decisionId, expectedRevision, reason)) }
    } catch (error) {
      return this.mutationFailure(error)
    }
  }

  /**
   * Question-resumption result; does not resume Goal.
   * @param decisionId - Saved question identity.
   * @param expectedRevision - Revision required for this mutation.
   * @returns Question-resumption result; does not resume Goal.
   */
  @Remote
  async resume(decisionId: DecisionId, expectedRevision: number): Promise<RecordMutationOutcome> {
    try {
      return { ok: true, record: this.viewOf(await this.decisions.resume(decisionId, expectedRevision)) }
    } catch (error) {
      return this.mutationFailure(error)
    }
  }

  private mutationFailure(error: unknown): RecordMutationOutcome {
    if (error instanceof DecisionError && error.code !== 'DECISION_UNAVAILABLE') {
      return { ok: false, reason: error.code, message: error.message }
    }
    this.degrade(error)
  }

  /**
   * Producing-step identity of one observed tool call, delegated to the
   * observers. `undefined` (feature off, degraded, or call not observed)
   * refuses the question tool without writing.
   * @param sessionId - Asking Session identity.
   * @param callId - Tool call identity in the producing step.
   * @returns Identity when the tool call belongs to the observed producing step.
   */
  producingIdentity(sessionId: SessionId, callId: string): ProducingStepIdentity | undefined {
    return this.observers?.producingIdentity(sessionId, callId)
  }

  /**
   * Arm the session's deny-all question guard for the producing step,
   * delegated to the observers. A no-op while the feature is degraded or
   * stopping — and then the tool result has already been saved durably.
   * @param agent - Agent owning the producing step.
   * @param identity - Observed producing-step identity.
   */
  armProducingGuard(agent: Agent, identity: ProducingStepIdentity): void {
    this.observers?.armProducingGuard(agent, identity)
  }

  /** Preserve synchronous evidence priority while fencing its index write behind durable Session entry. */
  private async applyObservedFacts(decisionId: DecisionId, facts: DecisionFacts): Promise<void> {
    const store = this.decisions
    const record = store.get(decisionId)
    if (record === undefined) return
    if (facts.entered) {
      const flush = this.confirmEnteredRecord(record)
      store.deferEntryFlush(decisionId, flush)
      await Promise.all([flush, this.applyFacts(decisionId, facts)])
    } else {
      await this.applyFacts(decisionId, facts)
    }
  }

  /** A failed entry checkpoint cannot authorize an admitted index. */
  private async confirmEnteredRecord(record: DecisionRecord): Promise<void> {
    try {
      const sessions = this.activeContext.sessions
      const session = sessions.get(record.sessionId)
      if (session === undefined || !await sessions.flush(session)) {
        throw new DecisionError('DECISION_UNAVAILABLE', 'The answer entry has no participating Session durability owner')
      }
    } catch (error) {
      this.sweeper?.stop()
      this.observers?.dispose()
      this.observers = undefined
      this.store = undefined
      this.unavailableReason = error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  /**
   * Apply observed queue facts to one record. B1.3's observers call this on
   * Session events; it lives on the service so fact settlement has a single
   * admission owner. Facts accumulate synchronously BEFORE any write is
   * queued, so a competing write already in the chain (a dismissal, a
   * withdrawal) resolves against them inside its durable update, and the
   * settle write below resolves again at its own chain slot — the latest
   * synchronous facts always win inside the actual storage execution.
   * @param decisionId - Saved question identity.
   * @param facts - Observed Session admission evidence.
   * @returns Current view after applying evidence, or undefined if the question is absent.
   */
  async applyFacts(decisionId: DecisionId, facts: DecisionFacts): Promise<DecisionView | undefined> {
    const record = this.decisions.get(decisionId)
    if (!record) return undefined
    this.decisions.accumulateFacts(decisionId, facts)
    return this.viewOf(await this.decisions.settleFacts(decisionId))
  }

  /**
   * Boot reconciliation from durable Session evidence (R2/R3). Runs once
   * after the store opens, before the feature serves reads. For every record
   * with a context anchor it scans the owning session's stored log from that
   * anchor onward in fixed-size windows through the public read-only
   * persistence handle — exact offsets, no search APIs, at most
   * `reconcileMaxEvents` events per session:
   *
   * - Entered evidence (R3): a durable `user/message` carrying the record's
   *   allocated request id reconstructs an admission whose index write may
   *   have failed (`submitting`/`needs_reconciliation` persisted) as
   *   `admitted`.
   * - Ordinary input (R2): a post-anchor `user/message` without the record's
   *   request id, or an inbox splice inserting a non-correlated message,
   *   supersedes the session's open question — a stale answerable question
   *   never survives a restart, and unchanged-context questions stay
   *   answerable. A failed supersede closes in-process admission too.
   * - Uncertain evidence (fail closed): a reservation without durable entry
   *   evidence degrades to the honest `needs_reconciliation` unknown, and an
   *   open question whose context currency is unproven — no anchor, no
   *   readable log, or a scan that hit the event bound before the log's end —
   *   refuses admission (retry answers `reconciliation_required`) while the
   *   ordinary cancel and dismiss flows stay available. Refusals re-derive at
   *   every boot; they are never persisted, and a complete scan without
   *   ordinary evidence keeps the question answerable.
   *
   * A session missing from storage or unreadable is skipped with a warning —
   * its records keep their persisted state and are treated as unverifiable.
   */
  private async reconcileDurableEvidence(): Promise<void> {
    const persistence = this.ctx.get('sessionPersistence')
    const anchored = new Map<SessionId, AnchoredDecisionRecord[]>()
    const unverifiable: DecisionRecord[] = []
    for (const record of this.decisions.list()) {
      if (!hasContextAnchor(record) || !persistence) {
        // Owned by this runtime: a record created before the anchor field
        // existed (or a Host without session persistence) cannot prove its
        // context currency from durable evidence — fail closed instead of
        // staying answerable.
        unverifiable.push(record)
        continue
      }
      const group = anchored.get(record.sessionId)
      if (group === undefined) anchored.set(record.sessionId, [record])
      else group.push(record)
    }
    await this.degradeUnverifiable(unverifiable)
    if (!persistence) return
    for (const [sessionId, group] of anchored) {
      try {
        const handle = await persistence.open(sessionId, 'read')
        try {
          await this.reconcileSessionLog(handle, group)
        } finally {
          await handle.close()
        }
      } catch (error) {
        this.ctx.logger.warn('session-decisions: boot evidence reconcile skipped for session %s: %s',
          sessionId, error instanceof Error ? error.message : String(error))
        // The scan did not reach the end, so context currency is
        // unproven for these records: fail closed instead of trusting
        // the persisted state.
        await this.degradeUnverifiable(group)
      }
    }
  }

  /**
   * Fail closed for every record whose evidence scan did not complete: an
   * outstanding reservation degrades to the honest unknown, and an open
   * question without a reservation refuses admission. The refusal is
   * process-local but re-derived at every boot from the same unverifiable
   * condition, so it survives restarts without a persisted tombstone.
   */
  private async degradeUnverifiable(group: readonly DecisionRecord[]): Promise<void> {
    for (const record of group) {
      if (record.answer !== null) {
        if (record.answerIndex !== 'submitting') continue
        try {
          await this.decisions.markNeedsReconciliation(record.decisionId)
        } catch (error) {
          this.ctx.logger.error('session-decisions: boot degrade failed for %s: %s',
            record.decisionId, error instanceof Error ? error.message : String(error))
        }
        continue
      }
      if (record.lifecycle === 'open') this.refusedAdmissions.add(record.decisionId)
    }
  }

  /** One session's post-anchor log scan; caller owns the read handle. */
  private async reconcileSessionLog(
    handle: { read: (offset?: number, length?: number) => Promise<{ events: readonly SessionEvent[] }> },
    group: readonly AnchoredDecisionRecord[],
  ): Promise<void> {
    const correlated = new Map<SessionRequestId, DecisionRecord>()
    for (const record of group) {
      if (record.answer !== null) correlated.set(record.answer.requestId, record)
    }
    const entered = new Set<DecisionId>()
    const stale = new Set<DecisionId>()
    const ordinaryAt = (seq: number): void => {
      for (const record of group) {
        if (record.lifecycle === 'open' && seq >= record.contextAnchorSeq) {
          stale.add(record.decisionId)
        }
      }
    }
    const start = Math.min(...group.map(record => record.contextAnchorSeq))
    const windowSize = 256
    let scanned = 0
    let complete = false
    for (let offset = start; scanned < this.config.reconcileMaxEvents;) {
      const length = Math.min(windowSize, this.config.reconcileMaxEvents - scanned)
      const slice = await handle.read(offset, length)
      for (const event of slice.events) {
        if (event.type === 'user/message') {
          const source = event.data.source
          const rpcId = source.kind === 'user' && 'rpcId' in source ? source.rpcId : undefined
          const match = rpcId === undefined ? undefined : correlated.get(rpcId)
          if (match !== undefined) entered.add(match.decisionId)
          else ordinaryAt(event.seq)
          continue
        }
        if (event.type === 'agent/inbox/spliced') {
          for (const message of event.data.inserted) {
            const source = message.source
            const rpcId = source.kind === 'user' && 'rpcId' in source ? source.rpcId : undefined
            if (rpcId === undefined || !correlated.has(rpcId)) ordinaryAt(event.seq)
          }
        }
      }
      scanned += slice.events.length
      if (slice.events.length < length) {
        complete = true
        break
      }
      offset += slice.events.length
    }
    // Uncertain reservations (R3 fail closed): a `submitting` reservation
    // without durable entry evidence is an honest unknown after restart —
    // the queued answer may or may not have entered before the crash. A live
    // pending observation (restored agent) keeps it `submitting` inside the
    // resolver; a later durable entry upgrades it again.
    for (const record of group) {
      if (record.answer === null || record.answerIndex !== 'submitting' || entered.has(record.decisionId)) continue
      try {
        await this.decisions.markNeedsReconciliation(record.decisionId)
      } catch (error) {
        this.ctx.logger.error('session-decisions: boot degrade failed for %s: %s',
          record.decisionId, error instanceof Error ? error.message : String(error))
      }
    }
    // R2: ordinary post-anchor input supersedes the open question durably;
    // a failed closure also closes this process's admission.
    for (const decisionId of stale) {
      try {
        await this.decisions.supersede(decisionId)
      } catch (error) {
        this.ctx.logger.error('session-decisions: boot supersede failed for %s: %s',
          decisionId, error instanceof Error ? error.message : String(error))
        this.refusedAdmissions.add(decisionId)
      }
    }
    // R2 fail closed: an open question without a reservation whose post-anchor
    // scan did not reach the log's end cannot prove its context currency —
    // refuse admission instead of trusting a partially scanned history.
    if (!complete) {
      for (const record of group) {
        if (record.lifecycle !== 'open' || record.answer !== null) continue
        if (stale.has(record.decisionId)) continue
        this.refusedAdmissions.add(record.decisionId)
      }
    }
    // R3: reconstruct admissions whose index write failed from the durable
    // entry evidence itself.
    for (const record of group) {
      if (record.answer === null) continue
      if (record.answerIndex !== 'submitting' && record.answerIndex !== 'needs_reconciliation') continue
      if (!entered.has(record.decisionId)) continue
      try {
        await this.applyFacts(record.decisionId, { entered: true })
      } catch (error) {
        this.ctx.logger.error('session-decisions: boot admission reconstruct failed for %s: %s',
          record.decisionId, error instanceof Error ? error.message : String(error))
      }
    }
  }

  /**
   * The record's view with the per-read Goal derivation attached: `true`
   * only when the owning Agent is exactly live and its Goal is phase-active
   * with `activation: 'disarmed'`. Omitted for unknown, cold, no-Goal, and
   * paused-Goal sessions; never persisted on the record.
   */
  private viewOf(record: DecisionRecord): DecisionView {
    const baseView = toView(record)
    const notification = publicationSchema.safeParse(record.notificationRefs)
    const view: DecisionView = notification.success ? { ...baseView, notificationStatus: notification.data.state } : baseView
    const agent = this.ctx.get('agents')?.get(record.sessionId)
    const goal = agent === undefined ? undefined : this.ctx.get('goals')?.get(agent)
    if (goal !== undefined && goal.phase === 'active' && goal.activation === 'disarmed') {
      return { ...view, goalDisarmed: true }
    }
    return view
  }
}
