/** Executor term schema rejects sentences and keeps legal names. */

import { describe, expect, it } from 'vitest'
import { parseAskKnowledgeLookupTerm, parseAskKnowledgeTerms } from '../src/terms.ts'

describe('ask-knowledge terms', () => {
  it('accepts one to six trimmed names including 的', () => {
    expect(parseAskKnowledgeTerms({ terms: ['报销'] })).toEqual(['报销'])
    expect(parseAskKnowledgeTerms({ terms: [' 党的纪律处分条例 '] })).toEqual(['党的纪律处分条例'])
  })

  it('rejects empty, count, length, and sentence punctuation', () => {
    expect(() => parseAskKnowledgeTerms({ terms: [] })).toThrow('ask-knowledge/terms-invalid')
    expect(() => parseAskKnowledgeTerms({ terms: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }))
      .toThrow('ask-knowledge/terms-invalid')
    expect(() => parseAskKnowledgeTerms({ terms: [''] })).toThrow('ask-knowledge/terms-invalid')
    expect(() => parseAskKnowledgeTerms({ terms: ['一二三四五六七八九十壹贰叁肆伍陆柒'] }))
      .toThrow('ask-knowledge/terms-invalid')
    expect(() => parseAskKnowledgeTerms({ terms: ['时限是多久？'] }))
      .toThrow('ask-knowledge/terms-invalid')
    expect(() => parseAskKnowledgeLookupTerm({ term: '什么是报销!' }))
      .toThrow('ask-knowledge/terms-invalid')
    expect(() => parseAskKnowledgeTerms({})).toThrow('ask-knowledge/terms-invalid')
    expect(() => parseAskKnowledgeLookupTerm({ term: 1 })).toThrow('ask-knowledge/terms-invalid')
    expect(() => parseAskKnowledgeLookupTerm({ term: '报销。' })).toThrow('ask-knowledge/terms-invalid')
    expect(parseAskKnowledgeLookupTerm({ term: ' 报销 ' })).toBe('报销')
  })
})
