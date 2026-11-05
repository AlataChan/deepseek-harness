/**
 * Pure presenters for the persistent-question tools: the model-facing
 * format contract, choice rendering, and the exact persisted presentation
 * metadata. No state, no I/O.
 * @module tests/presentation
 */

import { describe, expect, it } from 'vitest'
import {
  questionPresentationMeta,
  questionReadPresentationMeta,
  questionReadRender,
  questionToolRender,
  type QuestionReadValue,
  type QuestionToolValue,
} from '../src/presentation.ts'

const toolValue: QuestionToolValue = {
  decisionId: '11111111-1111-4111-8111-111111111111',
  revision: 3,
  expiresAtUtc: '2026-11-05T00:00:00.000Z',
  choices: ['Postgres', 'SQLite'],
}

const readValue: QuestionReadValue = {
  decisionId: toolValue.decisionId,
  sessionId: 'ordering-session',
  question: 'Which database?',
  choices: ['Postgres'],
  createdAtUtc: '2026-11-04T00:00:00.000Z',
  expiresAtUtc: toolValue.expiresAtUtc,
  revision: 2,
  lifecycle: 'open',
  answerIndex: 'submitting',
  hasAnswer: true,
  suspended: false,
}

describe('questionToolRender', () => {
  it('renders the format contract, IDs, and numbered choices in one text block', () => {
    const blocks = questionToolRender(toolValue)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.type).toBe('text')
    const text = blocks[0]!.type === 'text' ? blocks[0]!.text : ''
    expect(text).toContain(`Decision ID: ${toolValue.decisionId} (revision ${toolValue.revision})`)
    expect(text).toContain(`It expires at ${toolValue.expiresAtUtc}.`)
    expect(text).toContain(`starting with "Answer to question ${toolValue.decisionId}:"`)
    expect(text).toContain('1. Postgres\n2. SQLite')
    expect(text).toContain(`read_persistent_question with decisionId "${toolValue.decisionId}"`)
  })

  it('renders the free-text contract when the question has no choices', () => {
    const [block] = questionToolRender({ ...toolValue, choices: [] })
    expect(block && block.type === 'text' && block.text).toContain('The user will answer with free text.')
  })
})

describe('presentation metadata', () => {
  it('carries exactly the decisionId and revision for both tools', () => {
    expect(questionPresentationMeta(toolValue)).toEqual({ decisionId: toolValue.decisionId, revision: 3 })
    expect(questionReadPresentationMeta(readValue)).toEqual({ decisionId: readValue.decisionId, revision: 2 })
    expect(Object.keys(questionPresentationMeta(toolValue)).sort()).toEqual(['decisionId', 'revision'])
  })
})

describe('questionReadRender', () => {
  it('renders the read value as JSON that survives compaction round-trips', () => {
    const [block] = questionReadRender(readValue)
    expect(block!.type).toBe('text')
    const parsed = JSON.parse(block!.type === 'text' ? block!.text : '') as QuestionReadValue
    expect(parsed).toEqual(readValue)
  })
})
