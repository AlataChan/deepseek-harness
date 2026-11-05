/**
 * Pure Host presenters for the persistent-question tools: the model-facing
 * result text, and the persisted `{ decisionId, revision }` presentation
 * metadata the client question card consumes. No state, no I/O — the
 * raw-result card consumer lives in the client face.
 * @module @deepseek-ai/dsh-experimental-session-decisions/presentation
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'

/** Canonical value of one successful `request_persistent_question` call. */
export interface QuestionToolValue {
  readonly decisionId: string
  readonly revision: number
  readonly expiresAtUtc: string
  readonly choices: readonly string[]
}

/**
 * Structural mirror of one saved record as the read tool's canonical value:
 * plain JSON strings for the branded wire IDs, exactly what the output
 * schema validates.
 */
export interface QuestionReadValue {
  readonly decisionId: string
  readonly sessionId: string
  readonly question: string
  readonly choices: readonly string[]
  readonly createdAtUtc: string
  readonly expiresAtUtc: string
  readonly revision: number
  readonly lifecycle: string
  readonly answerIndex: string
  readonly hasAnswer: boolean
  readonly closedAtUtc?: string
  readonly resolutionKind?: string
  readonly suspended: boolean
}

/** Numbered rendering of the question's choices for the result text. */
function choiceLines(choices: readonly string[]): string {
  if (choices.length === 0) return 'The user will answer with free text.'
  return choices.map((label, index) => `${index + 1}. ${label}`).join('\n')
}

/**
 * Model-facing result text of a saved question: format contract plus IDs.
 * @param value - Value to render or encode.
 * @returns Model-visible saved-question result blocks.
 */
export function questionToolRender(value: QuestionToolValue): ContentBlock[] {
  const text = [
    `Question saved and delivered to the user. Decision ID: ${value.decisionId} (revision ${value.revision}).`,
    `It expires at ${value.expiresAtUtc}.`,
    'The turn has ended; wait for the user\'s answer.',
    `The answer arrives as a queued user message starting with "Answer to question ${value.decisionId}:".`,
    'If the user picks a choice, the message names the option; otherwise it carries their free text.',
    `Choices as presented to the user:\n${choiceLines(value.choices)}`,
    `The question and its answer stay readable after context compaction through read_persistent_question with decisionId "${value.decisionId}".`,
  ].join(' ')
  return [{ type: 'text', text }]
}

/**
 * Persisted presentation metadata for the client question card.
 * @param value - Value to render or encode.
 * @returns Persisted question identity and revision for the Client card.
 */
export function questionPresentationMeta(value: QuestionToolValue): { decisionId: string; revision: number } {
  return { decisionId: value.decisionId, revision: value.revision }
}

/**
 * Model-facing result text of a question read: the saved record as JSON.
 * @param value - Value to render or encode.
 * @returns Model-visible JSON result blocks.
 */
export function questionReadRender(value: QuestionReadValue): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

/**
 * Persisted presentation metadata for the client read-result card.
 * @param value - Value to render or encode.
 * @returns Persisted identity and revision for the read-result card.
 */
export function questionReadPresentationMeta(value: QuestionReadValue): { decisionId: string; revision: number } {
  return { decisionId: value.decisionId, revision: value.revision }
}
