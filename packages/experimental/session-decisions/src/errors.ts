/**
 * Typed feature failure carrying a stable {@link DecisionErrorCode}. Thrown
 * for infrastructure and caller mistakes; expected answer outcomes travel as
 * discriminated result values instead.
 * @module @deepseek-ai/dsh-experimental-session-decisions/errors
 */

import type { DecisionErrorCode } from './types.ts'

/** Feature-owned error with a stable code for Remote mapping and diagnostics. */
export class DecisionError extends Error {
  /** Stable code consumed by callers and diagnostics. */
  readonly code: DecisionErrorCode

  /**
   * @param code - stable error code.
   * @param message - human-readable diagnostic.
   */
  constructor(code: DecisionErrorCode, message: string) {
    super(message)
    this.name = 'DecisionError'
    this.code = code
  }
}
