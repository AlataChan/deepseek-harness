/**
 * Single source of v1 ask-data hard rules. UI copy and the model-visible
 * paragraph must be generated from these ids, not rewritten in three places.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-data/limits
 */

/** Closed set of rule ids that every user-visible surface must name. */
export const ASK_DATA_RULE_IDS = [
  'accept-xlsx-csv',
  'one-file-one-source',
  'first-row-header',
  'header-empty',
  'header-duplicate',
  'type-guess',
  'sheet-name',
  'file-size',
  'row-count',
  'decoded-cell',
  'csv-encoding',
  'no-merge-repair',
] as const

/** One rule id from {@link ASK_DATA_RULE_IDS}. */
export type AskDataRuleId = (typeof ASK_DATA_RULE_IDS)[number]

/** Decoded file-byte cap (50 MiB). */
export const MAX_DECODED_FILE_BYTES = 50 * 1024 * 1024

/** Workbook-wide row cap. */
export const MAX_TOTAL_ROWS = 200_000

/** Approximate decoded-cell budget while parsing. */
export const MAX_DECODED_CELL_BYTES = 200 * 1024 * 1024

/** Accepted extensions, without the leading dot. */
export const ACCEPTED_EXTENSIONS = ['xlsx', 'csv'] as const

/** Warning ids that still allow import. */
export const ASK_DATA_WARNING_IDS = [
  'merged-cells',
  'second-row-header',
  'header-empty',
  'header-duplicate',
  'sparse-first-row',
  'type-guess',
  'sheet-name',
] as const

/** One warning id from {@link ASK_DATA_WARNING_IDS}. */
export type AskDataWarningId = (typeof ASK_DATA_WARNING_IDS)[number]

/** Display name of the packaged sample. */
export const SAMPLE_DISPLAY_NAME = '示例：销售明细'

/**
 * Whether `id` is one of the five-surface rule ids.
 * @param id - candidate id.
 * @returns true when the id must appear in every user-visible surface.
 */
export function isAskDataRuleId(id: string): id is AskDataRuleId {
  return (ASK_DATA_RULE_IDS as readonly string[]).includes(id)
}
