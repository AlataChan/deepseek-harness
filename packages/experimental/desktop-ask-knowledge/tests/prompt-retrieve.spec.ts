/** Retrieve prompt states the term rule; it does not replace the executor. */

import { describe, expect, it } from 'vitest'
import { parseAskKnowledgeTerms } from '@deepseek-ai/dsh-host-ask-knowledge'
import { renderAskKnowledgeRetrievePrompt } from '../src/prompt-retrieve.ts'

describe('ask-knowledge retrieve prompt', () => {
  it('tells the model to pass 1 to 6 names and forbids hand edits', () => {
    const text = renderAskKnowledgeRetrievePrompt()
    expect(text).toContain('1 到 6')
    expect(text).toContain('ask_knowledge_retrieve')
    expect(text).toContain('必须先')
    expect(text).toContain('不要用工作区')
    expect(text).toContain('已有命中页的正文')
    expect(text).toContain('.octopus-kb/')
    expect(text).not.toMatch(/只 assert prompt 含 2–6/)
  })

  it('does not treat the prompt as the executor: a sentence still fails parse', () => {
    expect(() => parseAskKnowledgeTerms({ terms: ['报销流程是什么？'] })).toThrow()
    expect(parseAskKnowledgeTerms({ terms: ['党的纪律处分条例'] })).toEqual(['党的纪律处分条例'])
  })
})
