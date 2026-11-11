/**
 * Session-decisions feature: structured, expiring questions answered through
 * the normal Session prompt path. Host service default export; the types
 * subpath carries the browser-safe vocabulary.
 * @module @deepseek-ai/dsh-experimental-session-decisions
 */

export { default } from './service.ts'
export type { AnswerSubmitPayload, SessionDecisionsConfig } from './service.ts'
export { composeChoiceAnswer, composeTextAnswer } from './service.ts'
export { DecisionError } from './errors.ts'
export { DECISIONS_TABLE, decisionRecordSchema, decisionsDomain } from './schema.ts'
export { answerRequestId, DecisionStore, mintDecisionId, resolveAnswerIndex, toView, utf8ByteLength, type DecisionLimits, type ReserveAnswerResult } from './store.ts'
export { MAX_TIMER_DELAY_MS, scheduleAt, systemDecisionClock, systemDecisionTimers, type DecisionTimers } from './clock.ts'
export { nextDeadline, runSweeps, scheduleSweeps, type SweepHandle } from './expiry.ts'
export { DecisionObservers, type ProducingStepIdentity } from './observers.ts'
export { checkRootEligibility, ORDINARY_CHAT_FALLBACK, PTC_REFUSAL_MESSAGE, type RootEligibility } from './root-eligibility.ts'
export {
  questionPresentationMeta,
  questionReadPresentationMeta,
  questionReadRender,
  questionToolRender,
  type QuestionReadValue,
  type QuestionToolValue,
} from './presentation.ts'
export type {
  AnswerSubmitOutcome,
  DecisionAnswerIndex,
  DecisionAnswerPointer,
  DecisionChoice,
  DecisionClock,
  DecisionFacts,
  DecisionId,
  DecisionLifecycle,
  DecisionRecord,
  DecisionResolution,
  DecisionSuspension,
  DecisionView,
  RecordMutationOutcome,
} from './types.ts'
