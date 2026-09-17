/**
 * Maps ask-data rule ids, preview warnings, and wire failure codes onto
 * user-facing copy. Rule ids stay internal: the model-visible paragraph names
 * them, the operator reads sentences.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-data/client/rule-copy
 */

import type { AskDataErrorCode } from '@deepseek-ai/dsh-host-ask-data/client'
import { ASK_DATA_RULE_IDS, type AskDataRuleId } from '../limits.ts'
import { en, zh, type AskDataKey } from './locales.ts'

/** Preview warning ids the Host reports, mapped to their sentence. */
export const WARNING_KEYS: Record<string, AskDataKey> = {
  'merged-cells': 'warningMerged',
  'second-row-header': 'warningSecondHeader',
  'header-empty': 'warningHeaderEmpty',
  'header-duplicate': 'warningHeaderDuplicate',
  'sparse-first-row': 'warningSparse',
  'type-guess': 'warningTypeGuess',
  'sheet-name': 'warningSheetName',
}

/** Wire failure codes, mapped to the sentence that names the cause and the fix. */
export const FAILURE_KEYS: Record<AskDataErrorCode, AskDataKey> = {
  'ask-data-unavailable': 'failureUnavailable',
  'source-missing': 'failureSourceMissing',
  'source-invalid': 'failureSourceInvalid',
  'sqlite3-missing': 'failureSqlite3',
  'csv-encoding': 'failureCsvEncoding',
  'file-too-large': 'failureFileTooLarge',
  'too-many-rows': 'failureTooManyRows',
  'decoded-cell-budget': 'failureTooManyCells',
  'extension-rejected': 'failureExtension',
  'bind-failed': 'failureBind',
}

/**
 * Every rule id, mapped to the sentence that explains it. The `Record` key type
 * is the closed id set, so a rule added to `limits.ts` fails to compile until it
 * carries user-facing copy.
 */
export const RULE_EXPLANATIONS: Record<AskDataRuleId, AskDataKey> = {
  'accept-xlsx-csv': 'failureExtension',
  'one-file-one-source': 'pitfall4',
  'first-row-header': 'pitfall1',
  'header-empty': 'warningHeaderEmpty',
  'header-duplicate': 'warningHeaderDuplicate',
  'type-guess': 'warningTypeGuess',
  'sheet-name': 'warningSheetName',
  'file-size': 'failureFileTooLarge',
  'row-count': 'failureTooManyRows',
  'decoded-cell': 'failureTooManyCells',
  'csv-encoding': 'failureCsvEncoding',
  'no-merge-repair': 'warningMerged',
}

/** Locale dictionaries the rule-coverage assertion reads. */
export const RULE_LOCALES = { zh, en } as const

/**
 * Every rule id this overlay must explain to the operator.
 * @returns the closed id list.
 */
export function requiredRuleIds(): readonly string[] {
  return ASK_DATA_RULE_IDS
}

/**
 * Sentence for one preview warning.
 * @param id - Host warning id.
 * @param t - locale seat.
 * @returns the sentence, or the id verbatim when the Host adds one we do not know.
 */
export function warningCopy(id: string, t: (key: AskDataKey) => string): string {
  const key = WARNING_KEYS[id]
  return key === undefined ? id : t(key)
}

/**
 * Sentence for one failed remote call. Session Controller reports every
 * ask-data failure as `session/ask-data-failed` and carries the seam's own
 * `AskDataError` code in `details`, so the code is read from there.
 * @param code - wire failure code.
 * @param details - wire failure details.
 * @param message - wire message, kept as the fallback for an unknown code.
 * @param t - locale seat.
 * @returns the sentence for a known code, otherwise the wire message.
 */
export function failureCopy(
  code: string,
  details: unknown,
  message: string,
  t: (key: AskDataKey) => string,
): string {
  if (code === 'session/ask-data-unavailable') return t('failureUnavailable')
  const business = readBusinessCode(details)
  const key: AskDataKey | undefined = business === undefined ? undefined : FAILURE_KEYS[business]
  return key === undefined ? message : t(key)
}

function readBusinessCode(details: unknown): AskDataErrorCode | undefined {
  if (typeof details !== 'object' || details === null) return undefined
  const code = (details as Record<string, unknown>).code
  return typeof code === 'string' ? code as AskDataErrorCode : undefined
}
