/** Owner-local card presentation snapshots and callback field validation. */
import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ApprovalActionId } from '../src/approval-actions.ts'
import type { QuestionActionId, PendingQuestionCard } from '../src/question-broker.ts'
import { approvalCard, questionCard, parseQuestionForm } from '../src/interaction-cards.ts'

const question: PendingQuestionCard = {
  actionId: brandString<QuestionActionId>('00000000-0000-4000-8000-000000000002'),
  expiresAt: 2000000000000,
  questions: [{ id: 'choice', question: '选择工作区 / Choose workspace', options: [{ label: 'A' }, { label: 'B' }] }],
}

describe('IM card presentation', () => {
  it.each(['en', 'zh'] as const)('renders localized approval and question cards in %s', (locale) => {
    expect(approvalCard({ actionId: brandString<ApprovalActionId>('00000000-0000-4000-8000-000000000001'),
      deliveryKey: 'private-delivery-routing-key', toolName: 'fixture', summary: 'Change fixture',
      expiresAt: 2000000000000, canAllow: true }, locale)).toMatchSnapshot()
    expect(questionCard(question, locale)).toMatchSnapshot()
  })

  it('maps opaque form values to exact stored labels', () => {
    expect(parseQuestionForm(question, { s0: 'o1', c0: '' })).toEqual({ answers: [{ id: 'choice', selected: ['B'], custom: '' }] })
  })

  it.each([{ s0: 'o2' }, { s0: ['o0', 'o1'] }, { injected: 'allow' }, { c0: ['unexpected'] }])(
    'rejects unknown or malformed form fields %j', (input) => {
      expect(() => parseQuestionForm(question, input)).toThrow()
    })
})
