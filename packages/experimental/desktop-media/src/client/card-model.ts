/**
 * Card model derived from one media tool call's result metadata.
 * @module @deepseek-ai/dsh-experimental-desktop-media/client/card-model
 */

import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'

/** Work kind shown on cards. */
export type MediaWorkKind = 'video' | 'speech' | 'composed' | 'import'

/** Card lifecycle derived from the call slice alone. */
export type MediaRowState = 'running' | 'ok' | 'error' | 'stopped'

/** Everything a media card presents for one call. */
export interface MediaCardModel {
  readonly state: MediaRowState
  readonly kind: MediaWorkKind | null
  readonly requestId: string | null
  readonly jobId: string | null
  readonly artifactId: string | null
  readonly voiceId: string | null
  readonly output: string | null
}

type Block = ToolCallViewProps['block']

const KINDS: readonly MediaWorkKind[] = ['video', 'speech', 'composed', 'import']

/**
 * Whether a value is a plain object.
 * @param value - unknown value.
 * @returns true for non-array objects.
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * First physical line of a text.
 * @param text - multi-line text.
 * @returns the text before the first newline.
 */
export function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

/**
 * Flatten result text from a settled tool block.
 * @param block - running call or settled result node.
 * @returns joined text, or null while running.
 */
export function resultText(block: Block): string | null {
  if (!('kind' in block)) return null
  const parts = block.content.map(item => item.type === 'text' ? item.text : JSON.stringify(item, null, 2))
  if (parts.length === 0 && block.error !== undefined) parts.push(`${block.error.name}: ${block.error.code}`)
  return parts.join('\n') || null
}

/**
 * Derive the card model of one media call.
 * @param block - running call or settled result node.
 * @returns lifecycle and validated metadata fields.
 */
export function mediaCardModel(block: Block): MediaCardModel {
  const settled = 'kind' in block
  const state: MediaRowState = !settled
    ? 'running'
    : block.error?.code === 'interrupted'
      ? 'stopped'
      : block.isError ? 'error' : 'ok'
  const meta = settled && isRecord(block.meta) ? block.meta : undefined
  const kind = typeof meta?.kind === 'string' && KINDS.includes(meta.kind as MediaWorkKind)
    ? meta.kind as MediaWorkKind
    : null
  return {
    state,
    kind,
    requestId: typeof meta?.requestId === 'string' ? meta.requestId : null,
    jobId: typeof meta?.jobId === 'string' ? meta.jobId : null,
    artifactId: typeof meta?.artifactId === 'string' ? meta.artifactId : null,
    voiceId: typeof meta?.voiceId === 'string' ? meta.voiceId : null,
    output: resultText(block),
  }
}
