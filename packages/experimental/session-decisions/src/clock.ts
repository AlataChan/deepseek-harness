/**
 * Injected UTC time plus bounded monotonic delay scheduling. Timers re-arm
 * when a deadline exceeds the platform `setTimeout` ceiling, so long retained
 * sweeps (30-day closed-record retention) fire without drift and without
 * unbounded delay values.
 * @module @deepseek-ai/dsh-experimental-session-decisions/clock
 */

import type { DecisionClock } from './types.ts'

export type { DecisionClock }

/** Largest delay `setTimeout` accepts; larger deadlines re-arm in bounded steps. */
export const MAX_TIMER_DELAY_MS = 2 ** 31 - 1

/** System wall clock; tests inject a fake {@link DecisionClock} instead. */
export const systemDecisionClock: DecisionClock = {
  now: () => Date.now(),
}

/** Timer seams injected in tests; production passes the host globals. */
export interface DecisionTimers {
  setTimeout(handler: () => void | PromiseLike<unknown>, timeoutMs: number): unknown
  clearTimeout(handle: unknown): void
}

/** Host timer globals wrapped in the {@link DecisionTimers} seam. */
export const systemDecisionTimers: DecisionTimers = {
  setTimeout: (handler, timeoutMs) => setTimeout((): void => { void handler() }, timeoutMs),
  clearTimeout: (handle) => { clearTimeout(handle as ReturnType<typeof setTimeout>) },
}

/**
 * Schedule `fire` at absolute UTC time `atMs`. Returns a disposer that
 * prevents any later firing. When the target time already passed, `fire` runs
 * on the next macrotask, never synchronously inside the call.
 *
 * @param clock - injected UTC clock.
 * @param atMs - absolute target time in epoch milliseconds.
 * @param fire - callback invoked at or after `atMs`.
 * @param timers - timer seam; defaults to host globals.
 * @returns disposer that cancels the pending (and any re-armed) timer.
 */
export function scheduleAt(
  clock: DecisionClock,
  atMs: number,
  fire: () => void,
  timers: DecisionTimers = systemDecisionTimers,
): () => void {
  let disposed = false
  let handle: unknown
  const arm = (): void => {
    const delay = Math.min(Math.max(atMs - clock.now(), 0), MAX_TIMER_DELAY_MS)
    handle = timers.setTimeout(() => {
      if (disposed) return undefined
      if (clock.now() < atMs) {
        arm()
        return undefined
      }
      fire()
    }, delay)
  }
  arm()
  return () => {
    disposed = true
    if (handle !== undefined) timers.clearTimeout(handle)
    handle = undefined
  }
}
