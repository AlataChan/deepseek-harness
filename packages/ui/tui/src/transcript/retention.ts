/** Resume-only transcript row retention. @module @deepseek-ai/dsh-tui/transcript/retention */

import type { ProjectedTranscriptRow } from './project.ts'

/** Marker printed before retained rows when older history is not emitted. */
export interface TranscriptOmissionRow {
  readonly kind: 'omission'
  readonly omitted: number
  readonly text: string
}

/** One row eligible for initial static terminal output. */
export type RetainedTranscriptRow = ProjectedTranscriptRow | TranscriptOmissionRow

/**
 * Select the newest finalized rows for initial resume scrollback.
 * @param rows - complete projected finalized transcript.
 * @param limit - validated positive row limit.
 * @returns the original rows when they fit, otherwise one omission marker and the retained tail.
 */
export function retainTranscriptRows(
  rows: readonly ProjectedTranscriptRow[],
  limit: number,
): readonly RetainedTranscriptRow[] {
  if (rows.length <= limit) return rows
  const omitted = rows.length - limit
  return [{
    kind: 'omission',
    omitted,
    text: `${omitted} earlier transcript ${omitted === 1 ? 'row' : 'rows'} omitted`,
  }, ...rows.slice(-limit)]
}
