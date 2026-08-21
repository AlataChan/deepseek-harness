/** Single TUI user-question provider. @module @deepseek-ai/dsh-tui/driver/questions */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  matchesQuestionAnswer,
  UserQuestionError,
  type AskUserQuestionAnswer,
  type AskUserQuestionRequest,
} from '@deepseek-ai/dsh-user-questions'
import { mintInteractionId } from '../state/reducer.ts'
import type { TuiStore } from '../state/store.ts'
import type { InteractionId } from '../state/types.ts'

/** Dependencies for one user-question provider. */
export interface TuiQuestionsOptions {
  readonly owner: () => Agent | undefined
  readonly store: TuiStore
}

interface PendingQuestions {
  readonly id: InteractionId
  readonly request: AskUserQuestionRequest
  readonly resolve: (answer: AskUserQuestionAnswer) => void
  readonly reject: (error: UserQuestionError) => void
  readonly onAbort: () => void
}

/** Atomic settlement face used by terminal interaction input. */
export interface TuiQuestionsController {
  /** Settle the matching request only when the complete answer batch is valid. */
  answer(id: InteractionId, answer: AskUserQuestionAnswer): boolean
  /** Cancel only the matching visible request. */
  cancel(id: InteractionId): boolean
  /** Unregister the provider and reject its current request. */
  dispose(): void
}

function aborted(message: string): UserQuestionError {
  return new UserQuestionError(message, 'ASK_ABORTED')
}

/**
 * Register the one TUI question provider for a controller lifecycle.
 * @param ctx - controller context carrying the Service Definition.
 * @param options - dynamic Agent owner and framework-free store.
 * @returns atomic answer, cancellation, and disposal operations.
 */
export function installTuiQuestions(
  ctx: Context,
  options: TuiQuestionsOptions,
): TuiQuestionsController {
  let pending: PendingQuestions | undefined
  let disposed = false

  const clear = (active: PendingQuestions): void => {
    pending = undefined
    active.request.signal?.removeEventListener('abort', active.onAbort)
    options.store.dispatch({ type: 'interaction/settled', id: active.id })
  }

  const cancel = (id: InteractionId, message: string): boolean => {
    const active = pending
    if (active === undefined || active.id !== id) return false
    clear(active)
    active.reject(aborted(message))
    return true
  }

  const unregister = ctx.userQuestions.registerProvider({
    ask(request): Promise<AskUserQuestionAnswer> {
      if (disposed) return Promise.reject(aborted('tui user-question provider was disposed'))
      if (request.agent !== options.owner()) {
        return Promise.reject(new UserQuestionError(
          'tui user interaction requires the exact owned Agent', 'ASK_NOT_OWNED'))
      }
      if (pending !== undefined || options.store.getSnapshot().interaction !== undefined) {
        return Promise.reject(new UserQuestionError(
          'another terminal interaction is already pending', 'INTERACTION_BUSY'))
      }
      return new Promise<AskUserQuestionAnswer>((resolve, reject) => {
        const id = mintInteractionId()
        const onAbort = (): void => {
          cancel(id, 'ask_user_question was aborted before the user answered')
        }
        pending = { id, request, resolve, reject, onAbort }
        options.store.dispatch({ type: 'interaction/question', id, questions: request.questions })
        request.signal?.addEventListener('abort', onAbort, { once: true })
        if (request.signal?.aborted === true) onAbort()
      })
    },
  })

  return {
    answer(id, answer) {
      const active = pending
      if (active === undefined || active.id !== id) return false
      if (!matchesQuestionAnswer(active.request.questions, answer)) return false
      clear(active)
      active.resolve(answer)
      return true
    },
    cancel: id => cancel(id, 'the user closed this question request'),
    dispose() {
      if (disposed) return
      disposed = true
      unregister()
      if (pending !== undefined) cancel(pending.id, 'tui user-question provider was disposed')
    },
  }
}
