/** React subscription adapter for the framework-free TUI store. @module @deepseek-ai/dsh-tui/render/use-store */

import { useSyncExternalStore } from 'react'
import type { TuiStore } from '../state/store.ts'
import type { TuiState } from '../state/types.ts'

/**
 * Read the current terminal state and subscribe to committed changes.
 * @param store - framework-free application store.
 * @returns the exact immutable snapshot published by the store.
 */
export function useTuiStore(store: TuiStore): TuiState {
  return useSyncExternalStore(
    listener => store.subscribe(listener),
    () => store.getSnapshot(),
  )
}
