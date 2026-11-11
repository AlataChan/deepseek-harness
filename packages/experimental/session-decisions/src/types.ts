/**
 * Public vocabulary of the session-decisions feature: one expiring structured
 * question per Session, its lifecycle, and its answer-admission index. Types
 * only; runtime owners live in their own modules.
 * @module @deepseek-ai/dsh-experimental-session-decisions/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Server-minted RFC 4122 v4 UUID of one decision record. */
export type DecisionId = Branded<'decision-id'>

/** Canonical JSON-only value; re-exported from `@deepseek-ai/dsh-util-values`. */
export type { JsonValue }

/**
 * Question lifecycle. `answered` is written only from durable Session
 * evidence; `expired`, `cancelled`, and `superseded` are service-owned
 * closures that never retract an already-admitted human answer.
 */
export type DecisionLifecycle = 'open' | 'answered' | 'expired' | 'cancelled' | 'superseded'

/**
 * Answer-admission index. `withdrawn` records queue absence without a cause;
 * it is not user cancellation. `dismissed` is the explicit tracking-closed
 * tombstone. Every non-`none` value forbids another prompt for the record.
 */
export type DecisionAnswerIndex =
  | 'none'
  | 'submitting'
  | 'admitted'
  | 'needs_reconciliation'
  | 'withdrawn'
  | 'dismissed'

/** One choice of a saved question. Labels are model-authored display data. */
export interface DecisionChoice {
  readonly label: string
}

/**
 * Answer pointer retained for retry-conflict checks and Session-evidence
 * correlation. The digest is the canonical lowercase SHA-256 hex of the
 * exact submitted payload (validated at the durable boundary); entered
 * evidence is matched by `source.rpcId` alone because pre-step consumers may
 * rewrite human text.
 */
export interface DecisionAnswerPointer {
  readonly requestId: SessionRequestId
  readonly choiceOrdinal?: number | undefined
  readonly digest?: string | undefined
}

/** Explicit tracking closure recorded by `dismissUnresolvedAnswer`. */
export interface DecisionResolution {
  readonly kind: 'dismissed'
  readonly atUtc: string
}

/** User pause state; a paused question admits no answer until explicit resume. */
export interface DecisionSuspension {
  readonly reason: string
  readonly sinceUtc: string
}

/** One persisted decision record (storage-domain formatVersion 1 envelope). */
export interface DecisionRecord {
  readonly formatVersion: 1
  readonly decisionId: DecisionId
  readonly sessionId: SessionId
  readonly createdAtUtc: string
  readonly expiresAtUtc: string
  readonly revision: number
  readonly question: string
  readonly choices: readonly DecisionChoice[]
  readonly lifecycle: DecisionLifecycle
  readonly answerIndex: DecisionAnswerIndex
  readonly answer: DecisionAnswerPointer | null
  /** JSON-only notification references persisted with the record. */
  readonly notificationRefs?: JsonValue | undefined
  /**
   * Live `session.seq` captured when the question entered the durable Session
   * (create path); `undefined` for records created before the field existed.
   * Cold boot reconciliation reads durable Session evidence from this anchor
   * onward: any non-correlated ordinary `user/message` after the anchor
   * proves the answer's context was superseded. Absence fails closed — an
   * open record without an anchor cannot prove context currency and refuses
   * admission as unverifiable; it is never superseded or guessed from time.
   */
  readonly contextAnchorSeq?: number | undefined
  readonly closedAtUtc?: string | undefined
  readonly resolution?: DecisionResolution | undefined
  readonly suspension?: DecisionSuspension | null | undefined
}

/** Injected UTC wall clock (epoch milliseconds). */
export interface DecisionClock {
  /** Current UTC time in epoch milliseconds. */
  now(): number
}

/** Browser-safe projection of one decision record for Remote consumers. */
export interface DecisionView {
  readonly decisionId: DecisionId
  readonly sessionId: SessionId
  readonly question: string
  /** Choice labels in question order; model-authored display data. */
  readonly choices: readonly string[]
  readonly createdAtUtc: string
  readonly expiresAtUtc: string
  readonly revision: number
  readonly lifecycle: DecisionLifecycle
  readonly answerIndex: DecisionAnswerIndex
  /** Whether a saved answer pointer exists on the record. */
  readonly hasAnswer: boolean
  /**
   * Feature-allocated request ID correlated with this question's prompts;
   * wire correlation metadata only, never composed into user-visible text.
   */
  readonly requestId: SessionRequestId
  readonly closedAtUtc?: string | undefined
  readonly resolutionKind?: 'dismissed' | undefined
  /** Whether the question is user-paused right now. */
  readonly suspended: boolean
  /**
   * Derived per read, never persisted on the record: the owning Agent's Goal
   * is phase-active with `activation: 'disarmed'`, so the model may resume it
   * in the answer turn. Omitted when unknown — no Goal, cold session, or a
   * truly paused Goal phase. Derived by the Host on `get`/`catalog`.
   */
  readonly goalDisarmed?: boolean | undefined
  /** Notification transport progress, independent of answer admission. */
  readonly notificationStatus?: 'in_flight' | 'sent' | 'failed' | 'unknown' | undefined
}

/**
 * Observed queue facts for one record's answer, collected from live inbox
 * state, durable Session evidence, and process lifecycle. The resolver
 * combines them with the record's current index; it never observes raw
 * request IDs in product copy.
 */
export interface DecisionFacts {
  /** Durable `user/message` entry carrying the record's request ID. */
  readonly entered?: boolean
  /** Answer message pending in a live agent inbox (next turn or step). */
  readonly pending?: boolean
  /** Answer message claimed into a turn that has not settled yet. */
  readonly claimed?: boolean
  /** A claimed turn ended without a matching entry. */
  readonly turnEnded?: boolean
  /** Queue absence without a committed cause (unpaired discard). */
  readonly discarded?: boolean
  /** The owning service is stopping. */
  readonly stopping?: boolean
  /** The owning agent no longer exists. */
  readonly agentGone?: boolean
}

/**
 * Typed outcome of one answer submission over the Remote surface. Every
 * variant carries the immutable request ID echoed for wire correlation.
 */
export type AnswerSubmitOutcome =
  | { readonly outcome: 'accepted'; readonly revision: number; readonly requestId: SessionRequestId }
  | { readonly outcome: 'submitting'; readonly requestId: SessionRequestId }
  | { readonly outcome: 'admitted'; readonly requestId: SessionRequestId }
  | { readonly outcome: 'withdrawn'; readonly requestId: SessionRequestId }
  | { readonly outcome: 'tracking_closed'; readonly requestId: SessionRequestId }
  | { readonly outcome: 'reconciliation_required'; readonly requestId: SessionRequestId }
  | {
    readonly outcome: 'rejected'
    readonly reason: DecisionErrorCode
    readonly message: string
    readonly requestId: SessionRequestId
  }

/** Typed outcome of one record mutation (dismiss, cancel, pause, resume). */
export type RecordMutationOutcome =
  | { readonly ok: true; readonly record: DecisionView }
  | { readonly ok: false; readonly reason: DecisionErrorCode; readonly message: string }

/** Validated answer payload over the Remote surface. */
export interface AnswerSubmitPayload {
  /** 1-based choice ordinal; exclusive with `text`. */
  readonly choiceOrdinal?: number
  /** Free-text answer; exclusive with `choiceOrdinal`. */
  readonly text?: string
}

/** Typed stable error codes carried by {@link DecisionError}. */
export type DecisionErrorCode =
  | 'DECISION_UNAVAILABLE'
  | 'DECISION_NOT_FOUND'
  | 'DECISION_CONFLICT'
  | 'DECISION_EXPIRED'
  | 'DECISION_SUSPENDED'
  | 'DECISION_TRACKING_CLOSED'
  | 'DECISION_ALREADY_ADMITTED'
  | 'DECISION_RECONCILIATION_REQUIRED'
  | 'DECISION_BUSY_CAPACITY'
  | 'DECISION_BUSY_OWNED_WORK'
  | 'DECISION_LIMIT_EXCEEDED'
  | 'DECISION_INVALID'
