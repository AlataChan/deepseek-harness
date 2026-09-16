/**
 * Shared mapping from a capability seam's typed failure onto Remote failures.
 * @module @deepseek-ai/dsh-api-session-controller/seam-error
 */

import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type {} from './types.ts'

/** One seam failure in the vocabulary the Remote layer reports. */
export interface SeamFailure {
  /** The seam's own closed failure code. */
  readonly code: string
  readonly message: string
  readonly ruleId?: string | undefined
  readonly limit?: number | undefined
}

/** How one seam's failures map onto Remote failure codes. */
export interface SeamFailureCodes {
  /** Message reported when the caller aborted the request. */
  readonly aborted: string
  /** Remote code reported when the capability itself is absent. */
  readonly unavailable: 'session/ask-data-unavailable' | 'session/commerce-unavailable'
  /** The seam code that means the capability is absent. */
  readonly unavailableSeamCode: string
  /** Remote code reported for every other seam failure. */
  readonly failed: 'session/ask-data-failed' | 'session/commerce-failed'
  /** Read a seam failure out of a thrown value; undefined for anything else. */
  readonly failureOf: (error: unknown) => SeamFailure | undefined
}

/**
 * Map one seam failure onto a RemoteError. An aborted caller and an already
 * mapped RemoteError keep their own answer.
 * @param error - thrown value.
 * @param signal - caller lifetime.
 * @param seam - the seam's failure vocabulary.
 * @returns never; always throws.
 */
export function mapSeamFailure(error: unknown, signal: AbortSignal, seam: SeamFailureCodes): never {
  if (signal.aborted) throw new RemoteError('gateway/cancelled', seam.aborted, {})
  if (error instanceof RemoteError) throw error
  const failure = seam.failureOf(error)
  if (failure === undefined) {
    throw new RemoteError(
      'gateway/internal',
      error instanceof Error ? error.message : String(error),
      {},
    )
  }
  if (failure.code === seam.unavailableSeamCode) {
    throw new RemoteError(seam.unavailable, failure.message, {})
  }
  throw new RemoteError(seam.failed, failure.message, {
    code: failure.code,
    ...failure.ruleId === undefined ? {} : { ruleId: failure.ruleId },
    ...failure.limit === undefined ? {} : { limit: failure.limit },
  })
}
