/** Result bounds clip items, chars, and tokens; Config may only lower caps. */

import { describe, expect, it } from 'vitest'
import {
  boundRetrieveResult, clipItemText, ITEM_TEXT_LIMIT, resolveResultBounds, tokenEstimate,
} from '../src/result-bounds.ts'

describe('ask-knowledge result bounds', () => {
  it('clamps Config above the hard top', () => {
    expect(resolveResultBounds({ maxItems: 99, maxChars: 99_000, maxTokens: 99_000 })).toEqual({
      maxItems: 12,
      maxChars: 24_000,
      maxTokens: 6000,
    })
    expect(resolveResultBounds({ maxItems: 3, maxChars: 20, maxTokens: 10 })).toEqual({
      maxItems: 3,
      maxChars: 20,
      maxTokens: 10,
    })
  })

  it('clips one item to 4000 code points and estimates tokens', () => {
    const long = '字'.repeat(ITEM_TEXT_LIMIT + 8)
    expect([...clipItemText(long)]).toHaveLength(ITEM_TEXT_LIMIT)
    expect(tokenEstimate('abcd')).toBe(4)
  })

  it('truncates a multi-item payload at an exact Chinese char cap', () => {
    const items = [
      { path: 'a', title: 'a', reason: '', text: '一二三四五六七八九十', kind: 'concept' as const },
      { path: 'b', title: 'b', reason: '', text: '甲乙丙丁', kind: 'raw' as const },
    ]
    const bounded = boundRetrieveResult(items, [], { maxItems: 12, maxChars: 10, maxTokens: 6000 })
    expect(bounded.items).toHaveLength(1)
    expect(bounded.items[0]?.text).toBe('一二三四五六七八九十')
    expect(bounded.warnings.some(item => item.ruleId === 'result-truncated')).toBe(true)
  })

  it('drops later items when the item cap is reached', () => {
    const items = Array.from({ length: 4 }, (_, index) => ({
      path: `p${index}`,
      title: `t${index}`,
      reason: '',
      text: 'x',
      kind: 'raw' as const,
    }))
    const bounded = boundRetrieveResult(items, [], { maxItems: 2, maxChars: 24_000, maxTokens: 6000 })
    expect(bounded.items).toHaveLength(2)
    expect(bounded.warnings.map(item => item.ruleId)).toContain('result-truncated')
  })
})

it('keeps final serialized payloads within their allowance across Unicode, metadata and truncation boundaries', () => {
  const items = [
    { path: 'raw/a.md', title: '字'.repeat(180), reason: 'reason'.repeat(60),
      text: '😀\\"中文'.repeat(800), kind: 'raw' as const },
    { path: 'raw/b.md', title: 'B', reason: '', text: 'late exception', kind: 'raw' as const },
  ]
  const warnings = [{ ruleId: 'warning'.repeat(20), message: '提示'.repeat(200) }]
  let refusals = 0, successes = 0
  for (const maxTokens of [1, 80, 160, 320, 640, 1024, 2048, 4096, 6000]) {
    for (const maxItems of [1, 2, 12]) {
      for (const maxChars of [1, 8, 128, 24000]) {
        const bounds = { maxTokens, maxItems, maxChars }
        let result
        try { result = boundRetrieveResult(items, warnings, bounds) } catch (error) {
          expect(String(error)).toMatch(/metadata exceeds the payload allowance/)
          refusals++
          continue
        }
        successes++
        const bytes = Buffer.byteLength(JSON.stringify(result))
        expect(bytes).toBeLessThanOrEqual(maxTokens)
        expect(result.tokenEstimate).toBe(bytes)
        expect(result.items.length).toBeLessThanOrEqual(maxItems)
        expect(result.items.reduce((sum, item) => sum + [...item.text].length, 0)).toBeLessThanOrEqual(maxChars)
        expect(result.warnings.some(warning => warning.ruleId === 'result-truncated')).toBe(true)
        for (const item of result.items) {
          expect(items.find(original => original.path === item.path)?.text.startsWith(item.text)).toBe(true)
          expect(item.text.isWellFormed()).toBe(true)
        }
      }
    }
  }
  expect(refusals).toBeGreaterThan(0)
  expect(successes).toBeGreaterThan(0)
})

it('reserves truncation diagnostics when a previously fitting item reaches the final byte boundary', () => {
  const first = { path: 'a', title: 'A', reason: '', text: '😀中文 budget '.repeat(5), kind: 'raw' as const }
  const second = { path: 'b'.repeat(300), title: 'B', reason: '', text: 'late', kind: 'raw' as const }
  const complete = boundRetrieveResult([first], [], resolveResultBounds())
  let retained = 0
  for (const maxTokens of Array.from({ length: 200 }, (_, index) => complete.tokenEstimate - 60 + index)) {
    for (const maxItems of [1, 2]) {
      try {
        const result = boundRetrieveResult([first, second], [], { maxTokens, maxItems, maxChars: 24000 })
        expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(maxTokens)
        expect(result.warnings.map(warning => warning.ruleId)).toContain('result-truncated')
        expect(result.items.every(item => item.text.isWellFormed())).toBe(true)
        retained++
      } catch (error) {
        expect(String(error)).toContain('metadata exceeds the payload allowance')
      }
    }
  }
  expect(retained).toBeGreaterThan(0)
})
