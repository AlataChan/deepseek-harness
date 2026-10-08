/**
 * Hash-bound pilot and spend approval.
 * @module @deepseek-ai/dsh-experimental-desktop-media/approval
 */

import { MediaError } from './error.ts'
import type { MediaRequestRecord } from './types.ts'

/** Fields a later paid call must still match. */
export interface ApprovalBinding {
  readonly requestId: string
  readonly inputHashes: readonly string[]
  readonly promptHash: string
  readonly estimatedYuan: number
}

/**
 * Compare two hash lists without regard to order.
 * @param left - first list.
 * @param right - second list.
 * @returns true when they contain the same digests.
 */
export function sameHashSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const seen = new Set(left)
  return right.every(item => seen.has(item))
}

/**
 * Confirm a stored request still matches the approval binding.
 * @param request - durable request.
 * @param binding - approval written before the paid call.
 * @throws {@link MediaError} `approval-mismatch` when hashes or spend changed.
 */
export function assertApprovalMatches(
  request: MediaRequestRecord,
  binding: ApprovalBinding,
): void {
  if (request.requestId !== binding.requestId) {
    throw new MediaError('approval-mismatch', 'approval does not name this request')
  }
  if (request.promptHash !== binding.promptHash) {
    throw new MediaError('approval-mismatch', 'approved prompt hash changed')
  }
  if (!sameHashSet(request.inputHashes, binding.inputHashes)) {
    throw new MediaError('approval-mismatch', 'approved input hashes changed')
  }
  if (request.estimatedYuan > binding.estimatedYuan) {
    throw new MediaError('approval-mismatch', 'approved spend ceiling is too small')
  }
}
