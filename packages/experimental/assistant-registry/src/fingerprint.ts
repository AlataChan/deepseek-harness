/**
 * Deterministic JSON stringification and cryptographic input fingerprinting for provisioning operations.
 * @module @deepseek-ai/dsh-experimental-assistant-registry/fingerprint
 */

import { createHash } from 'node:crypto'

/**
 * Deterministically stringifies any JSON-serializable value by sorting object keys recursively.
 * @param value - value to stringify.
 * @returns canonical JSON string.
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return '[' + value.map(v => canonicalJsonStringify(v)).join(',') + ']'
  }
  const keys = Object.keys(value).sort()
  const entries = keys.map(k => `${JSON.stringify(k)}:${canonicalJsonStringify((value as Record<string, unknown>)[k])}`)
  return '{' + entries.join(',') + '}'
}

/**
 * Computes a deterministic SHA-256 hex fingerprint for a provisioning payload.
 * @param payload - payload object or value.
 * @returns SHA-256 hex string.
 */
export function computeInputFingerprint(payload: unknown): string {
  const canonical = canonicalJsonStringify(payload)
  return createHash('sha256').update(canonical).digest('hex')
}
