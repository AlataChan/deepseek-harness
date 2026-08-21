/** Scoped approval answerer for one TUI-owned Agent. @module @deepseek-ai/dsh-tui/driver/approval */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { mintInteractionId } from '../state/reducer.ts'
import type { TuiStore } from '../state/store.ts'
import type { InteractionId } from '../state/types.ts'

/** Dependencies for one approval answerer. */
export interface TuiApprovalOptions {
  readonly owner: () => Agent | undefined
  readonly store: TuiStore
}

interface PendingApproval {
  readonly id: InteractionId
  readonly request: ApprovalRequest
  readonly resolve: (outcome: ApprovalOutcome) => void
  readonly onAbort: () => void
}

/** Imperative settlement face used by terminal input and shutdown. */
export interface TuiApprovalController {
  /** Grant only the matching visible request once. */
  allow(id: InteractionId): boolean
  /** Reject only the matching visible request once. */
  reject(id: InteractionId): boolean
  /** Cancel only the matching visible request once. */
  cancel(id: InteractionId): boolean
  /** Stop answering and cancel the current request without granting it. */
  dispose(): void
}

/**
 * Install one exact-Agent approval waterfall answerer.
 * @param ctx - controller context carrying the approval event.
 * @param options - dynamic Agent owner and framework-free store.
 * @returns single-shot settlement and disposal operations.
 */
export function installTuiApproval(
  ctx: Context,
  options: TuiApprovalOptions,
): TuiApprovalController {
  let pending: PendingApproval | undefined
  let disposed = false

  const settle = (id: InteractionId, outcome: ApprovalOutcome): boolean => {
    const active = pending
    if (active === undefined || active.id !== id) return false
    pending = undefined
    active.request.signal?.removeEventListener('abort', active.onAbort)
    options.store.dispatch({ type: 'interaction/settled', id })
    active.resolve(outcome)
    return true
  }

  const stop = ctx.on('approval/request', (request, next) => {
    if (request.agent !== options.owner()) return next()
    if (disposed || request.signal?.aborted === true) {
      return Promise.resolve<ApprovalOutcome>('cancelled')
    }
    if (pending !== undefined || options.store.getSnapshot().interaction !== undefined) {
      return Promise.resolve<ApprovalOutcome>('unavailable')
    }
    return new Promise<ApprovalOutcome>((resolve) => {
      const id = mintInteractionId()
      const onAbort = (): void => { settle(id, 'cancelled') }
      pending = { id, request, resolve, onAbort }
      options.store.dispatch({
        type: 'interaction/approval', id, toolName: request.toolName,
        ...(request.callId === undefined ? {} : { callId: request.callId }),
        ...(request.reason === undefined ? {} : { reason: request.reason }),
      })
      request.signal?.addEventListener('abort', onAbort, { once: true })
      /* v8 ignore next -- closes the AbortSignal check-to-listener race */
      if (request.signal?.aborted === true) onAbort()
    })
  })

  return {
    allow: id => !disposed && settle(id, 'allowed-once'),
    reject: id => settle(id, 'rejected'),
    cancel: id => settle(id, 'cancelled'),
    dispose() {
      if (disposed) return
      disposed = true
      stop()
      if (pending !== undefined) settle(pending.id, 'cancelled')
    },
  }
}
