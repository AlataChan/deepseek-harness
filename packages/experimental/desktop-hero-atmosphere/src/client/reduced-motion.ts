/**
 * Browser reduced-motion snapshot used by the Hero atmosphere plate.
 * @module @deepseek-ai/dsh-experimental-desktop-hero-atmosphere/client/reduced-motion
 */

import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'

/** Browser `MediaQueryList` used by the reduced-motion source. */
export interface ReducedMotionQuery {
  /** Whether the query currently matches. */
  readonly matches: boolean
  /**
   * Subscribe to query changes.
   * @param type - event name; only `change` is used.
   * @param listener - callback invoked when `matches` changes.
   */
  addEventListener(type: 'change', listener: () => void): void
  /**
   * Remove a previously registered listener.
   * @param type - event name; only `change` is used.
   * @param listener - callback previously passed to `addEventListener`.
   */
  removeEventListener(type: 'change', listener: () => void): void
}

/**
 * Observable for `prefers-reduced-motion: reduce`.
 * @param media - query list; defaults to the live window query.
 * @returns a snapshot source bound by the slot renderer.
 */
export function createReducedMotionSource(
  media: ReducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)'),
): ObservableSnapshot<boolean> {
  return {
    getSnapshot: () => media.matches,
    subscribe: (listener) => {
      media.addEventListener('change', listener)
      return () => { media.removeEventListener('change', listener) }
    },
  }
}
