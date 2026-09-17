/** Operator copy covers every rule id and failure code without leaking ids. */

import { describe, expect, it } from 'vitest'
import type { AskDataErrorCode } from '@deepseek-ai/dsh-host-ask-data/client'
import { MAX_DECODED_FILE_BYTES, MAX_TOTAL_ROWS } from '../src/limits.ts'
import { en, zh, type AskDataKey } from '../src/client/locales.ts'
import {
  FAILURE_KEYS, RULE_EXPLANATIONS, RULE_LOCALES, WARNING_KEYS,
  failureCopy, requiredRuleIds, warningCopy,
} from '../src/client/rule-copy.ts'
import { ASK_DATA_RULE_IDS } from '../src/limits.ts'

const t = (key: AskDataKey): string => zh[key]

/** Every wire failure code the seam can report. */
const FAILURE_CODES = [
  'ask-data-unavailable', 'source-missing', 'source-invalid', 'sqlite3-missing', 'csv-encoding',
  'file-too-large', 'too-many-rows', 'decoded-cell-budget', 'extension-rejected', 'bind-failed',
] as const satisfies readonly AskDataErrorCode[]

describe('ask-data rule copy', () => {
  it('covers the same closed rule id set limits.ts declares', () => {
    expect(requiredRuleIds()).toEqual(ASK_DATA_RULE_IDS)
    expect(Object.keys(RULE_EXPLANATIONS).sort()).toEqual([...ASK_DATA_RULE_IDS].sort())
  })

  it('gives every rule id, warning, and failure code copy in both locales', () => {
    for (const locale of [RULE_LOCALES.zh, RULE_LOCALES.en]) {
      for (const key of Object.values(RULE_EXPLANATIONS)) {
        expect(locale[key], `${key} missing`).not.toBe('')
      }
      for (const key of Object.values(WARNING_KEYS)) expect(locale[key]).not.toBe('')
      for (const key of Object.values(FAILURE_KEYS)) expect(locale[key]).not.toBe('')
    }
  })

  it('maps every seam failure code', () => {
    expect(Object.keys(FAILURE_KEYS).sort()).toEqual([...FAILURE_CODES].sort())
  })

  it('keeps rule ids out of every operator-facing string', () => {
    for (const locale of [zh, en]) {
      for (const [key, text] of Object.entries(locale)) {
        for (const id of ASK_DATA_RULE_IDS) {
          expect(text, `${key} leaks ${id}`).not.toContain(id)
        }
      }
    }
  })

  it('states the same limits the constants enforce', () => {
    expect(MAX_DECODED_FILE_BYTES).toBe(50 * 1024 * 1024)
    expect(MAX_TOTAL_ROWS).toBe(200_000)
    expect(JSON.stringify(zh)).toContain('50MB')
    expect(JSON.stringify(zh)).toContain('20 万行')
  })

  it('resolves a sentence from a wire failure and keeps unknown ones verbatim', () => {
    expect(failureCopy('session/ask-data-failed', { code: 'csv-encoding' }, 'raw', t))
      .toBe('CSV 编码不支持，请另存为 UTF-8 或 GB18030 再上传。')
    expect(failureCopy('session/ask-data-unavailable', {}, 'raw', t))
      .toBe('问数暂时不可用，请重开会话再试。')
    expect(failureCopy('session/ask-data-failed', { code: 'brand-new' }, 'raw', t)).toBe('raw')
    expect(failureCopy('session/ask-data-failed', undefined, 'raw', t)).toBe('raw')
    expect(failureCopy('session/ask-data-failed', { code: 7 }, 'raw', t)).toBe('raw')
  })

  it('resolves a known warning id and keeps an unknown one verbatim', () => {
    expect(warningCopy('merged-cells', t)).toBe('有合并单元格，只取左上角。')
    expect(warningCopy('brand-new-warning', t)).toBe('brand-new-warning')
  })
})
