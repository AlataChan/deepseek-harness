/**
 * Per-session paid-call and spend ceilings.
 * @module @deepseek-ai/dsh-experimental-desktop-media/budget
 */

import { MediaError } from './error.ts'
import type { MediaProjectionState } from './types.ts'

/** Tunable spend limits from plugin config. */
export interface MediaBudgetConfig {
  /** Maximum paid provider calls one session may start. */
  readonly maxPaidCallsPerSession: number
  /** Maximum estimated spend in yuan one session may reach. */
  readonly maxEstimatedSpendYuan: number
}

/**
 * Sum estimated spend already recorded on the session.
 * @param state - media projection.
 * @returns call count and yuan total.
 */
export function spentBudget(state: MediaProjectionState): { calls: number; yuan: number } {
  let calls = 0
  let yuan = 0
  for (const request of Object.values(state.requests)) {
    if (request.stage === 'proposed' || request.stage === 'approved') continue
    calls += 1
    yuan += request.estimatedYuan
  }
  return { calls, yuan }
}

/**
 * Reject a paid call that would exceed remaining budget.
 * @param state - media projection.
 * @param config - session ceilings.
 * @param nextYuan - estimate for this call.
 */
export function assertBudgetAllows(
  state: MediaProjectionState,
  config: MediaBudgetConfig,
  nextYuan: number,
): void {
  const spent = spentBudget(state)
  if (spent.calls + 1 > config.maxPaidCallsPerSession) {
    throw new MediaError('budget-exhausted', 'session paid-call limit reached')
  }
  if (spent.yuan + nextYuan > config.maxEstimatedSpendYuan) {
    throw new MediaError('budget-exhausted', 'session spend limit reached')
  }
}

/** Stage 1 list-price estimates used when the provider does not return a charge. */
export const ESTIMATE_VIDEO_YUAN = 2.5
/** Formal TTS estimate. */
export const ESTIMATE_TTS_YUAN = 0.01
/** Voice-clone estimate including first formal TTS. */
export const ESTIMATE_CLONE_YUAN = 9.91
