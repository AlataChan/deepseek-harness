/**
 * Pure display-state derivation for one question card, from the browser-safe
 * {@link DecisionView} projection. Copy lives in the locale dictionaries; this
 * module owns only the discriminant and the record choice.
 */
import type { DecisionView } from '../types.ts'

/** Truthful display states one question can present. */
export type QuestionStatusKind =
  | 'active'
  | 'paused'
  | 'expired'
  | 'cancelled'
  | 'superseded'
  | 'submitting'
  | 'admitted'
  | 'needs_reconciliation'
  | 'withdrawn'
  | 'dismissed'

/**
 * Derive the display state of one record.
 *
 * An open record past its persisted expiry presents as expired before the
 * Host's sweep observes it; the server-owned state remains authoritative for
 * every admission action.
 * @param view - browser-safe record projection.
 * @param nowMs - current UTC time in epoch milliseconds.
 * @returns the display state.
 */
export function deriveStatus(view: DecisionView, nowMs: number): QuestionStatusKind {
  // Dismissal is a tracking closure carried by a cancelled record
  // (`resolutionKind: 'dismissed'`, index `dismissed`); it must win over the
  // ordinary cancelled lifecycle or the UI mislabels it as cancellation.
  if (view.resolutionKind === 'dismissed' || view.answerIndex === 'dismissed') return 'dismissed'
  if (view.lifecycle === 'expired') return 'expired'
  if (view.lifecycle === 'cancelled') return 'cancelled'
  if (view.lifecycle === 'superseded') return 'superseded'
  if (view.lifecycle === 'answered') return 'admitted'
  switch (view.answerIndex) {
    case 'submitting': return 'submitting'
    case 'admitted': return 'admitted'
    case 'needs_reconciliation': return 'needs_reconciliation'
    case 'withdrawn': return 'withdrawn'
    case 'none': break
  }
  if (view.suspended) return 'paused'
  return Date.parse(view.expiresAtUtc) <= nowMs ? 'expired' : 'active'
}

/**
 * Pick the record the Session header presents: the latest open record, so a
 * closed question stops occupying the header. Terminal states of a touched
 * record stay visible through the tool card instead.
 * @param views - records of one Session, any order.
 * @returns the record to present, or `undefined` when none is open.
 */
export function pickOpenQuestion(views: readonly DecisionView[]): DecisionView | undefined {
  let latest: DecisionView | undefined
  for (const view of views) {
    if (view.lifecycle !== 'open') continue
    if (latest === undefined || view.createdAtUtc > latest.createdAtUtc) latest = view
  }
  return latest
}

/**
 * The close-tracking action the actual Host service accepts for one open
 * record: `cancel` closes an unreserved question (`answerIndex: 'none'`),
 * `dismiss` closes the tracking of an unresolved in-flight answer
 * (`submitting`, `needs_reconciliation`, `withdrawn`), and the Host refuses
 * both otherwise — an already-admitted answer has nothing to close.
 * @param view - open record to close.
 * @returns the action, or `undefined` when the Host accepts no close action.
 */
export function closeActionFor(view: DecisionView): 'cancel' | 'dismiss' | undefined {
  switch (view.answerIndex) {
    case 'none': return 'cancel'
    case 'submitting':
    case 'needs_reconciliation':
    case 'withdrawn': return 'dismiss'
    case 'admitted':
    case 'dismissed': return undefined
  }
}
