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
    expect(tokenEstimate('abcd')).toBe(1)
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
