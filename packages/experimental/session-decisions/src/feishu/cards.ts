/** Bounded Feishu question cards; choice text stays display data. */
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { DecisionView } from '../types.ts'

/** Render buttons only for a currently actionable finite-choice question.
 * @param view - Current question projection.
 * @param publicationId - Server-created publication identity.
 * @param allowAnswers - Whether this publication still permits an answer; callback settlements pass false.
 * @returns JSON-only card; callbacks carry ordinals, never choice labels as instructions.
 */
export function questionCard(view: DecisionView, publicationId: string, allowAnswers = true): Record<string, JsonValue> {
  const actionable = allowAnswers && view.lifecycle === 'open' && view.answerIndex === 'none' && !view.suspended
    && Date.parse(view.expiresAtUtc) > Date.now()
  const elements: JsonValue[] = [
    { tag: 'div', text: { tag: 'plain_text', content: view.question } },
    { tag: 'note', elements: [{ tag: 'plain_text', content: `有效期至 ${view.expiresAtUtc}。仅桌面应用在线时可作答。` }] },
    { tag: 'note', elements: [{ tag: 'plain_text', content: '按钮用于回答此问题；直接发文字会进入独立的 IM 会话。也可回到桌面中的原对话回答。' }] },
  ]
  if (actionable) elements.push({ tag: 'action', actions: view.choices.map((label, index) => ({
    tag: 'button', text: { tag: 'plain_text', content: label }, type: 'default',
    value: { kind: 'session-question', publicationId, decisionId: view.decisionId, revision: view.revision, choiceOrdinal: index + 1 },
  })) })
  else elements.push({ tag: 'div', text: { tag: 'plain_text', content: '此问题已不可作答，请回到桌面查看。' } })
  return { config: { wide_screen_mode: true }, header: { title: { tag: 'plain_text', content: '等待您的决定' } }, elements }
}
