/**
 * Canonical base64 decoding for Remote payloads that carry file bytes.
 * @module @deepseek-ai/dsh-api-session-controller/wire-bytes
 */

import { Buffer } from 'node:buffer'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type {} from './types.ts'

const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/** Seam-specific limit and the failure a payload over it reports. */
export interface DecodedBytesPolicy {
  /** Maximum decoded bytes this Remote accepts. */
  readonly limit: number
  /** Remote failure code raised for an oversized payload. */
  readonly code: 'session/ask-data-failed' | 'session/commerce-failed'
  /** Rule id reported with the oversize failure. */
  readonly ruleId: string
}

/**
 * Decode a canonical base64 payload and enforce the seam's decoded-byte cap.
 * The cap is checked from the encoded length first, so an oversized payload
 * never reaches the decoder.
 * @param bytes - wire field.
 * @param policy - decoded-byte cap and the failure it reports.
 * @returns decoded bytes.
 */
export function decodeBase64Payload(bytes: unknown, policy: DecodedBytesPolicy): Uint8Array {
  if (typeof bytes !== 'string') {
    throw new RemoteError('gateway/bad-request', 'bytes must be a canonical base64 string', {})
  }
  if (bytes.length % 4 !== 0) {
    throw new RemoteError('gateway/bad-request', 'bytes must be canonical base64', {})
  }
  const padding = bytes.endsWith('==') ? 2 : bytes.endsWith('=') ? 1 : 0
  const decodedGuess = (bytes.length / 4) * 3 - padding
  if (decodedGuess > policy.limit) {
    throw new RemoteError(policy.code, `file exceeds ${policy.limit} bytes`, {
      code: 'file-too-large',
      ruleId: policy.ruleId,
      limit: policy.limit,
    })
  }
  if (!CANONICAL_BASE64.test(bytes)) {
    throw new RemoteError('gateway/bad-request', 'bytes must be canonical base64', {})
  }
  const buf = Buffer.from(bytes, 'base64')
  if (buf.toString('base64') !== bytes) {
    throw new RemoteError('gateway/bad-request', 'bytes must be canonical base64', {})
  }
  return new Uint8Array(buf)
}
