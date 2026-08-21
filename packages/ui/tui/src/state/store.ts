/** Observable framework-free terminal store. @module @deepseek-ai/dsh-tui/state/store */

import { reduceTuiState } from './reducer.ts'
import type { TuiAction, TuiState } from './types.ts'

/** Minimal observable store consumed by drivers and render adapters. */
export interface TuiStore {
  /** Return the current immutable snapshot. */
  getSnapshot(): TuiState
  /** Subscribe to committed snapshot changes. */
  subscribe(listener: () => void): () => void
  /** Fold one action and publish a changed snapshot. */
  dispatch(action: TuiAction): void
}

function freezeState(state: TuiState): TuiState {
  Object.freeze(state.finalizedRows)
  for (const row of state.finalizedRows) Object.freeze(row)
  if (state.liveAssistant !== undefined) Object.freeze(state.liveAssistant)
  Object.freeze(state.overlay)
  if (state.interaction !== undefined) {
    if (state.interaction.kind === 'question') {
      for (const question of state.interaction.questions) {
        if (question.options !== undefined) {
          for (const option of question.options) Object.freeze(option)
          Object.freeze(question.options)
        }
        if (question.intent !== undefined) Object.freeze(question.intent)
        Object.freeze(question)
      }
      Object.freeze(state.interaction.questions)
    }
    Object.freeze(state.interaction)
  }
  Object.freeze(state.status)
  Object.freeze(state.dimensions)
  Object.freeze(state.editor.history)
  Object.freeze(state.editor)
  if (state.projection !== undefined) {
    Object.freeze(state.projection.rows)
    Object.freeze(state.projection)
  }
  return Object.freeze(state)
}

/**
 * Create one synchronous terminal store.
 * @param initialState - initial reducer state.
 * @returns the narrow store interface.
 */
export function createTuiStore(initialState: TuiState): TuiStore {
  let state = freezeState(initialState)
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dispatch(action) {
      const next = reduceTuiState(state, action)
      if (next === state) return
      state = freezeState(next)
      for (const listener of listeners) listener()
    },
  }
}
