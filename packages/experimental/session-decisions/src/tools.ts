/**
 * The agent-scoped `./tools` consumer: registers `request_persistent_question`
 * and `read_persistent_question` through `defineTool`. The plugin carries no
 * state — admission, persistence, observers, and guards live on the Host
 * service and its observer bundle; refusals never save a question, send a
 * notification, or disarm a Goal.
 * @module @deepseek-ai/dsh-experimental-session-decisions/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { DecisionId } from './types.ts'
import { checkRootEligibility, PTC_REFUSAL_MESSAGE } from './root-eligibility.ts'
import { utf8ByteLength } from './store.ts'
import {
  questionPresentationMeta,
  questionReadPresentationMeta,
  questionReadRender,
  questionToolRender,
  type QuestionReadValue,
  type QuestionToolValue,
} from './presentation.ts'

/** Function-plugin identity; registered by the feature preset's tools row. */
export const name = 'session-decisions-tools'

/** Injected services: the tools registry of the scope this consumer loads in. */
export const inject: readonly string[] = ['tools']

/** Validated deployment configuration (currently empty; limits live on the service). */
export interface SessionDecisionsToolsConfig {}/** Function-plugin configuration schema. */
export const Config: z<SessionDecisionsToolsConfig> = z.object({})

/** Model-facing description of the question tool. */
const REQUEST_DESCRIPTION =
  'Ask the user one structured question that survives context compaction and ends the current turn. '
  + 'Use it when a decision needs explicit user input: pass the question and either 2 or more choice labels, '
  + 'or no choices for a bounded free-text answer. The user\'s answer arrives as a queued user message; '
  + 'do not call further tools until it does. Refused inside PTC programs, in delegated or Team-teammate '
  + 'conversations, and while owned background work is running.'

/** Model-facing description of the read tool. */
const READ_DESCRIPTION =
  'Read one previously asked persistent question of this conversation by its decision ID, including its '
  + 'choices, expiry, lifecycle, and answer state. Use it after context compaction to recover question '
  + 'context; the result is an ordinary logged tool result.'

/** Canonical output schema of the question tool. */
const QUESTION_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    decisionId: { type: 'string', required: true },
    revision: { type: 'number', required: true },
    expiresAtUtc: { type: 'string', required: true },
    choices: { type: 'array', items: { type: 'string' }, required: true },
  },
} as const

/** Canonical output schema of the read tool. */
const READ_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    decisionId: { type: 'string', required: true },
    sessionId: { type: 'string', required: true },
    question: { type: 'string', required: true },
    choices: { type: 'array', items: { type: 'string' }, required: true },
    createdAtUtc: { type: 'string', required: true },
    expiresAtUtc: { type: 'string', required: true },
    revision: { type: 'number', required: true },
    lifecycle: { type: 'string', required: true },
    answerIndex: { type: 'string', required: true },
    hasAnswer: { type: 'boolean', required: true },
    closedAtUtc: { type: 'string' },
    resolutionKind: { type: 'string' },
    suspended: { type: 'boolean', required: true },
  },
} as const

/** Generic pending presenter shared by both tools. */
function present(title: string, rawInput: string): { card: 'generic'; title: string; kind: 'other'; rawInput: string } {
  return { card: 'generic', title, kind: 'other', rawInput }
}

/** Validate question-tool arguments against the service's feature limits. */
function validateQuestionArgs(
  args: { question: string; choices: readonly string[]; ttlMs?: number },
  limits: { maxQuestionBytes: number; maxChoices: number; maxChoiceLabelBytes: number; defaultTtlMs: number },
): void {
  if (utf8ByteLength(args.question) > limits.maxQuestionBytes) {
    throw new HarnessError('The question exceeds the configured length limit', 'DECISION_LIMIT_EXCEEDED')
  }
  if (args.choices.length > limits.maxChoices) {
    throw new HarnessError(`At most ${limits.maxChoices} choices are allowed`, 'DECISION_LIMIT_EXCEEDED')
  }
  for (const label of args.choices) {
    if (label.length === 0) throw new HarnessError('Choice labels must not be empty', 'DECISION_INVALID')
    if (utf8ByteLength(label) > limits.maxChoiceLabelBytes) {
      throw new HarnessError('A choice label exceeds the configured length limit', 'DECISION_LIMIT_EXCEEDED')
    }
  }
  if (args.ttlMs !== undefined && (!Number.isInteger(args.ttlMs) || args.ttlMs < 1 || args.ttlMs > limits.defaultTtlMs)) {
    throw new HarnessError(`ttlMs must be a whole number between 1 and ${limits.defaultTtlMs}`, 'DECISION_INVALID')
  }
  if (args.choices.length === 1) {
    // A single-choice question is a free-text answer with extra steps: the
    // one ordinal carries no information and its retry semantics confuse
    // the answer path. Refuse before any save.
    throw new HarnessError('A choice question needs at least two options; ask a free-text question instead', 'DECISION_INVALID')
  }
}

/** The service singleton; an absent or isolated service refuses creation. */
function decisionsService(ctx: Context) {
  const service = ctx.get('sessionDecisions')
  if (service === undefined) {
    throw new HarnessError('The persistent-questions feature is not enabled in this deployment', 'DECISION_UNAVAILABLE')
  }
  return service
}

/**
 * Register both tools in the preset scope. The question tool enforces, in
 * order: PTC nesting, root eligibility, producing-step identity, argument
 * bounds, durable save, Goal activation disarm, guard arming, and turn
 * conclusion — so a failure before the save leaves nothing behind.
 */
export function apply(ctx: Context, _config: Record<string, never>): void {
  ctx.tools.register(defineTool({
    name: 'request_persistent_question',
    description: REQUEST_DESCRIPTION,
    parameters: {
      question: {
        type: 'string',
        required: true,
        description: 'The complete question for the user, self-contained and answerable without earlier context.',
      },
      choices: {
        type: 'array',
        items: { type: 'string' },
        description: 'Choice labels in presentation order; pass 2 or more for a choice question, or omit for a free-text answer.',
      },
      ttlMs: {
        type: 'number',
        description: 'Optional expiry override in milliseconds; at most the configured default lifetime.',
      },
    },
    output: {
      schema: QUESTION_VALUE_SCHEMA,
      render: (_args: unknown, value: QuestionToolValue) => questionToolRender(value),
      presentationMeta: (_args: unknown, value: QuestionToolValue) => questionPresentationMeta(value),
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) {
        throw new HarnessError('The question tool requires a calling agent', 'DECISION_INVALID')
      }
      // Nested PTC question: refuse before any persistence, with the pinned
      // B0 literal. A parent program can continue non-tool code after a
      // nested tool returns, so this stays refused in every PTC mode.
      if (exec.parent !== undefined) {
        throw new HarnessError(PTC_REFUSAL_MESSAGE, 'DECISION_PTC_UNSUPPORTED')
      }
      const service = decisionsService(ctx)
      const eligibility = await checkRootEligibility(ctx, agent)
      if (!eligibility.ok) throw new HarnessError(eligibility.message, eligibility.code)
      const identity = service.producingIdentity(agent.session.id, exec.callId)
      if (identity === undefined) {
        throw new HarnessError(
          'The producing step of this question call was not observed; re-ask the question in this turn.',
          'DECISION_CONFLICT',
        )
      }
      const question = args.question.trim()
      if (question.length === 0) throw new HarnessError('The question must not be empty', 'DECISION_INVALID')
      const choices = args.choices ?? []
      validateQuestionArgs({ ...args, choices }, service.limits())
      // Persistence first: every step below the save may fail without
      // leaving an armed guard or a newly disarmed Goal behind.
      const view = await service.create({
        sessionId: agent.session.id,
        question,
        choices,
        ...(args.ttlMs !== undefined ? { ttlMs: args.ttlMs } : {}),
      })
      try {
        ctx.get('goals')?.disarm(agent)
      } catch (error) {
        // The question is already saved; a failed disarm must not strand it.
        ctx.logger.warn('session-decisions: goal disarm after question save failed: %s',
          error instanceof Error ? error.message : String(error))
      }
      service.armProducingGuard(agent, identity)
      exec.concludeTurn()
      await service.notifyQuestion(view.decisionId)
      return {
        decisionId: view.decisionId,
        revision: view.revision,
        expiresAtUtc: view.expiresAtUtc,
        choices: [...view.choices],
      }
    },
    presentCall: args => present('Ask the user a persistent question', args.question),
  }))

  ctx.tools.register(defineTool({
    name: 'read_persistent_question',
    description: READ_DESCRIPTION,
    parameters: {
      decisionId: {
        type: 'string',
        required: true,
        description: 'The decision ID of the question to read, as reported when the question was asked.',
      },
    },
    output: {
      schema: READ_VALUE_SCHEMA,
      render: (_args: unknown, value: QuestionReadValue) => questionReadRender(value),
      presentationMeta: (_args: unknown, value: QuestionReadValue) => questionReadPresentationMeta(value),
    },
    async execute(args, exec) {
      const agent = exec.agent
      // The decision ID arrives over the tool-argument wire as plain JSON;
      // an unknown or malformed ID resolves to no record.
      const view = await decisionsService(ctx).get(args.decisionId as DecisionId)
      // Same-session authorization: a foreign or unknown ID is the same
      // ordinary logged refusal, never a leak of the other record.
      if (agent === undefined || view === undefined || view.sessionId !== agent.session.id) {
        throw new HarnessError('No question with this ID exists in this conversation', 'DECISION_NOT_FOUND')
      }
      return {
        decisionId: view.decisionId,
        sessionId: view.sessionId,
        question: view.question,
        choices: [...view.choices],
        createdAtUtc: view.createdAtUtc,
        expiresAtUtc: view.expiresAtUtc,
        revision: view.revision,
        lifecycle: view.lifecycle,
        answerIndex: view.answerIndex,
        hasAnswer: view.hasAnswer,
        ...(view.closedAtUtc !== undefined ? { closedAtUtc: view.closedAtUtc } : {}),
        ...(view.resolutionKind !== undefined ? { resolutionKind: view.resolutionKind } : {}),
        suspended: view.suspended,
      }
    },
    presentCall: args => present('Read a persistent question', args.decisionId),
  }))
}
