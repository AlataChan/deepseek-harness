/** Whole-response byte budgeting prevents metadata and CJK undercounting. */
import { expect, it } from 'vitest'
import { boundRetrieveResult, tokenEstimate } from '../src/result-bounds.ts'
const bounds = { maxItems: 12, maxChars: 24000, maxTokens: 6000 }
it('uses UTF-8 bytes as the unverified-tokenizer fallback', () => {
  for (const text of ['abcd', '一老一小', '\\"\n😀']) {
    expect(tokenEstimate(text)).toBeGreaterThanOrEqual(Buffer.byteLength(text, 'utf8'))
  }
})
it('counts complete serialized items, warning metadata and the estimate field', () => {
  const result = boundRetrieveResult([{ path: 'raw/a.md', title: '标题'.repeat(3000), reason: '理由'.repeat(2000), text: '中文正文'.repeat(2000), kind: 'raw' }], [{ ruleId: 'warning', message: '诊断'.repeat(2000) }], bounds)
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(bounds.maxTokens)
  expect(result.tokenEstimate).toBe(Buffer.byteLength(JSON.stringify(result)))
  expect(result.items[0]?.text).toBeTruthy()
  expect(result.warnings.some(warning => warning.ruleId === 'result-truncated')).toBe(true)
})
it('refuses an impossible metadata envelope instead of overrunning it or corrupting paths', () => {
  expect(() => boundRetrieveResult([{ path: 'long/'.repeat(2000), title: 'source', reason: '', text: 'fact', kind: 'raw' }], [], bounds)).toThrow(/metadata|allowance|bound/i)
})
it('never emits an over-budget zero-token success envelope', () => {
  expect(() => boundRetrieveResult([], [], { ...bounds, maxTokens: 0 })).toThrow()
})
