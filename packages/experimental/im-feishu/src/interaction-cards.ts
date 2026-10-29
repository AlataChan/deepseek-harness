/** Feishu Card 2.0 presentation; callback data contains opaque action IDs only. */
import type { AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions'
import { z } from 'zod'
import type { PendingApprovalCard } from './approval-broker.ts'
import type { PendingQuestionCard } from './question-broker.ts'

const copy = {
  en: { approval: 'Permission request', allow: 'Allow once', reject: 'Reject', unavailable: 'Arguments unavailable; approval disabled',
    questions: 'Your answer is needed', choose: 'Choose an option', other: 'Other answer', submit: 'Submit answer' },
  zh: { approval: '操作审批', allow: '仅批准本次', reject: '拒绝', unavailable: '参数不可用，无法批准',
    questions: '需要您的回答', choose: '请选择', other: '其他回答', submit: '提交回答' },
} as const
/** Locale belongs to the explicitly configured IM surface. */
export type ImCardLocale = keyof typeof copy
const plain = (content: string) => ({ tag: 'plain_text', content })
const text = (content: string) => ({ tag: 'div', text: plain(content) })

/**
 * Build a redacted approval card with single-use callback actions.
 * @param card - Current tenant-produced redacted approval card.
 * @param locale - Explicit surface locale.
 * @returns Card 2.0 JSON, with no raw arguments or external routing identity in button values.
 */
export function approvalCard(card: PendingApprovalCard, locale: ImCardLocale): Record<string, unknown> {
  const labels = copy[locale]
  const button = (decision: 'allow' | 'reject', label: string) => ({ tag: 'button', text: plain(label),
    type: decision === 'allow' ? 'primary' : 'danger', disabled: decision === 'allow' && !card.canAllow,
    behaviors: [{ type: 'callback', value: { actionId: card.actionId, kind: 'approval', decision } }],
  })
  return { schema: '2.0', config: { enable_forward: false }, header: { title: plain(labels.approval) },
    body: { elements: [text(card.toolName), text(card.summary ?? labels.unavailable),
      button('allow', labels.allow), button('reject', labels.reject)] } }
}

/**
 * Build a structured question form with opaque option identifiers.
 * @param card - Bounded current structured questions.
 * @param locale - Explicit surface locale.
 * @returns A form with indexed opaque component/option names; user labels are plain text.
 */
export function questionCard(card: PendingQuestionCard, locale: ImCardLocale): Record<string, unknown> {
  if (card.questions.length > 30) throw new Error('Question card exceeds platform element limit')
  const labels = copy[locale]
  const elements: Record<string, unknown>[] = []
  card.questions.forEach((question, index) => {
    elements.push(text(question.question))
    if (question.detail) elements.push(text(question.detail))
    if (question.options?.length) {
      elements.push({ tag: question.multiSelect ? 'multi_select_static' : 'select_static', name: `s${index}`,
        placeholder: plain(labels.choose), options: question.options.map((option, optionIndex) => ({
          text: plain(option.label), value: `o${optionIndex}`,
        })) })
    }
    elements.push({ tag: 'input', name: `c${index}`, placeholder: plain(labels.other), input_type: 'multiline_text', max_length: 1000 })
  })
  elements.push({ tag: 'button', name: `question_${card.actionId}`, text: plain(labels.submit),
    type: 'primary', form_action_type: 'submit' })
  return { schema: '2.0', config: { enable_forward: false }, header: { title: plain(labels.questions) },
    body: { elements: [{ tag: 'form', name: 'questions', elements }] } }
}

/**
 * Resolve submitted values against the exact published questions.
 * @param card - Exact stored question card that was published.
 * @param input - Validated SDK form_value object from a verified callback.
 * @returns Structured answers matching the original question and option labels.
 */
export function parseQuestionForm(card: PendingQuestionCard, input: unknown): AskUserQuestionAnswer {
  const form = z.record(z.string(), z.union([z.string(), z.array(z.string())])).parse(input)
  const expected = new Set(card.questions.flatMap((question, index) => [
    `c${index}`, ...(question.options?.length ? [`s${index}`] : []),
  ]))
  if (Object.keys(form).some(key => !expected.has(key))) throw new Error('Unknown question form component')
  return { answers: card.questions.map((question, index) => {
    const selected = form[`s${index}`]
    const values = selected === undefined || selected === '' ? [] : typeof selected === 'string' ? [selected] : selected
    const custom = form[`c${index}`]
    if (custom !== undefined && typeof custom !== 'string') throw new Error('Custom answer must be text')
    if (values.length > 1 && !question.multiSelect) throw new Error('Multiple answers to single-select question')
    return { id: question.id, selected: values.map((value) => {
      if (!/^o(?:0|[1-9]\d*)$/.test(value)) throw new Error('Unknown option identity')
      const option = question.options?.[Number(value.slice(1))]
      if (!option) throw new Error('Option outside question')
      return option.label
    }), ...(custom !== undefined ? { custom } : {}) }
  }) }
}
