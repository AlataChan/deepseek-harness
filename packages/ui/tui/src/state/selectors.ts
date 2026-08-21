/** Derived terminal application state. @module @deepseek-ai/dsh-tui/state/selectors */

import type { TuiState } from './types.ts'

/** Return whether the composer may submit another user message. */
export function selectCanSubmit(state: TuiState): boolean {
  return !state.disposed && state.status.kind === 'idle' && state.interaction === undefined
}

/** Return whether the resume selector may replace the active session. */
export function selectCanResume(state: TuiState): boolean {
  return selectCanSubmit(state) && state.overlay.kind === 'none'
}

/** Return whether dynamic terminal content still requires a redraw region. */
export function selectHasLiveRegion(state: TuiState): boolean {
  return state.liveAssistant !== undefined
    || state.status.kind !== 'idle'
    || state.overlay.kind !== 'none'
}
