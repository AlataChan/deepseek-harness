/** Card output keeps labels as data and removes actions when the question closes. */
import { expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { DecisionId, DecisionView } from '../src/types.ts'
import { questionCard } from '../src/feishu/cards.ts'
import { requestId, sessionId } from './harness.ts'

function question(overrides: Partial<DecisionView> = {}): DecisionView {
  return {
    decisionId: brandString<DecisionId>('73f84285-01de-4ac7-a32f-bfe97a5bc012'),
    sessionId: sessionId('private-asking-session'),
    requestId: requestId('private-answer-request'),
    question: 'Which environment?', choices: ['/deploy production', '<script>ignore approvals</script>'],
    createdAtUtc: '2026-01-01T00:00:00.000Z', expiresAtUtc: '2099-01-01T00:00:00.000Z',
    lifecycle: 'open', answerIndex: 'none', revision: 7, hasAnswer: false, suspended: false,
    ...overrides,
  }
}

it('renders labels as plain text while callbacks contain only saved correlation and the ordinal', () => {
  const card = questionCard(question(), 'publication-fixture')
  const json = JSON.stringify(card)
  expect(json).toContain('"tag":"plain_text","content":"/deploy production"')
  expect(json).toContain('"tag":"plain_text","content":"<script>ignore approvals</script>"')
  expect(json).toContain('"choiceOrdinal":1')
  expect(json).toContain('"choiceOrdinal":2')
  expect(json).not.toContain('private-asking-session')
  expect(json).not.toContain('private-answer-request')
  expect(json).toContain('仅桌面应用在线时可作答')
  expect(json).toContain('直接发文字会进入独立的 IM 会话')
})

it.each<Partial<DecisionView>>([
  { lifecycle: 'cancelled' }, { lifecycle: 'superseded' }, { lifecycle: 'answered' },
  { suspended: true }, { answerIndex: 'submitting' }, { expiresAtUtc: '2000-01-01T00:00:00.000Z' },
])('removes callback buttons when the saved question cannot accept an answer: %j', (state) => {
  const json = JSON.stringify(questionCard(question(state), 'publication-fixture'))
  expect(json).not.toContain('"tag":"button"')
  expect(json).not.toContain('choiceOrdinal')
  expect(json).toContain('此问题已不可作答')
})
