/**
 * Branded media identifiers.
 * @module @deepseek-ai/dsh-experimental-desktop-media/ids
 */

import { randomUUID } from 'node:crypto'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'

/** Durable creation request. */
export type MediaRequestId = Branded<'MediaRequestId'>

/**
 * Brand a request id.
 * @param id - raw id.
 * @returns branded request id.
 */
export function MediaRequestId(id: string): MediaRequestId {
  return brandString<MediaRequestId>(id)
}

/** Durable imported or generated artifact. */
export type MediaArtifactId = Branded<'MediaArtifactId'>

/**
 * Brand an artifact id.
 * @param id - raw id.
 * @returns branded artifact id.
 */
export function MediaArtifactId(id: string): MediaArtifactId {
  return brandString<MediaArtifactId>(id)
}

/** Durable voice catalogue row. */
export type MediaVoiceId = Branded<'MediaVoiceId'>

/**
 * Brand a voice id.
 * @param id - raw id.
 * @returns branded voice id.
 */
export function MediaVoiceId(id: string): MediaVoiceId {
  return brandString<MediaVoiceId>(id)
}

/**
 * Mint an opaque id with a letter prefix.
 * @param prefix - leading letter.
 * @returns branded-ready raw id.
 */
export function mintMediaId(prefix: 'r' | 'a' | 'v'): string {
  return `${prefix}_${randomUUID()}`
}
