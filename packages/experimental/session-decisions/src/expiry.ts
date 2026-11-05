/**
 * Expiry and retention orchestration over the decision store: compute the
 * next deadline and keep one self-re-arming sweep timer armed. All
 * transitions stay in the store; this module only decides when to run them.
 * The handle re-arms whenever the store reports a committed mutation, so a
 * question created after an empty start — or one whose deadline pre-empts a
 * later retention date — is swept on time. Sweep failures are contained and
 * reported through `onError` instead of becoming unhandled rejections.
 * @module @deepseek-ai/dsh-experimental-session-decisions/expiry
 */

import { scheduleAt } from './clock.ts'
import { DecisionStore } from './store.ts'
import type { DecisionClock, DecisionTimers } from './clock.ts'
import type { DecisionLimits } from './store.ts'

/**
 * Next UTC epoch-millisecond deadline that needs a sweep: the earliest open
 * question expiry, or the earliest prunable settled record's retention
 * elapse. `undefined` when nothing is scheduled.
 * @param store - Owned question store.
 * @param limits - Validated question or retention limits.
 * @returns Earliest expiry or retention deadline, or undefined when none exists.
 */
export function nextDeadline(
  store: DecisionStore,
  limits: Pick<DecisionLimits, 'closedRetentionMs'>,
): number | undefined {
  let next: number | undefined
  for (const record of store.list()) {
    if (record.lifecycle === 'open' && record.answerIndex === 'none') {
      const expiry = Date.parse(record.expiresAtUtc)
      if (next === undefined || expiry < next) next = expiry
      continue
    }
    if (record.lifecycle === 'open') continue
    if (record.answerIndex === 'submitting' || record.answerIndex === 'needs_reconciliation') continue
    if (!record.closedAtUtc) continue
    const retention = Date.parse(record.closedAtUtc) + limits.closedRetentionMs
    if (next === undefined || retention < next) next = retention
  }
  return next
}

/**
 * Run both sweeps once and return the number of expired records.
 * Retention results are not counted; pruning is silent by design.
 * @param store - Owned question store.
 * @param nowMs - UTC epoch milliseconds; omitted to use the store clock.
 * @returns Number of questions expired; retained-record pruning is not counted.
 */
export async function runSweeps(store: DecisionStore, nowMs?: number): Promise<number> {
  const expired = await store.expireOverdue(nowMs)
  await store.sweepRetention(nowMs)
  return expired
}

/** Control surface of the running sweep cycle. */
export interface SweepHandle {
  /** Stop the cycle; the next deadline never fires. */
  stop(): void
  /** Resolves after any in-flight sweep settles, so disposal can quiesce. */
  done(): Promise<void>
  /**
   * Re-arm at the new earliest deadline after a committed store mutation.
   * Ignored while a sweep is running; the running sweep re-arms on completion.
   */
  notify(): void
}

/**
 * Keep sweeps running: arms one timer at the next deadline, runs both sweeps
 * when it fires, re-arms after completion and on store mutation, and contains
 * sweep failures through `onError`.
 *
 * @param store - owned decision store.
 * @param clock - injected UTC clock.
 * @param limits - retention bound for deadline computation.
 * @param options - timer seam for tests and the containment sink for sweep
 *   failures (default: failures are swallowed, which callers should not rely on).
 * @returns handle to stop, quiesce, and re-arm the cycle.
 */
export function scheduleSweeps(
  store: DecisionStore,
  clock: DecisionClock,
  limits: Pick<DecisionLimits, 'closedRetentionMs'>,
  options: { timers?: DecisionTimers; onError?: (error: unknown) => void } = {},
): SweepHandle {
  const timers = options.timers
  const onError = options.onError
  const lifecycle: { disposed: boolean } = { disposed: false }
  let running = false
  let cancel: (() => void) | undefined
  let inflight: Promise<void> = Promise.resolve()

  const arm = (): void => {
    if (lifecycle.disposed || running) return
    cancel?.()
    cancel = undefined
    const at = nextDeadline(store, limits)
    if (at === undefined) return
    cancel = scheduleAt(clock, at, () => {
      // runOnce contains its own failures, so inflight never rejects.
      inflight = runOnce()
    }, timers)
  }

  const runOnce = async (): Promise<void> => {
    running = true
    cancel?.()
    cancel = undefined
    try {
      await runSweeps(store)
    } catch (error) {
      // Containment: a failed sweep must not become an unhandled rejection
      // (Node can crash the Host) and must still re-arm for the next deadline.
      onError?.(error)
    } finally {
      running = false
      // arm() re-arms only when not disposed; re-arm failures (e.g. a domain
      // closed under a racing sweep) take the same containment path as sweep
      // failures: no unhandled rejection.
      try {
        arm()
      } catch (error) {
        onError?.(error)
      }
    }
  }

  arm()
  return {
    stop: () => {
      lifecycle.disposed = true
      cancel?.()
      cancel = undefined
    },
    done: () => inflight,
    notify: arm,
  }
}
