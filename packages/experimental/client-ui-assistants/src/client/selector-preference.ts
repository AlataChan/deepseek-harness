/** Browser-local display preference, independent of assistant and Session state. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Versioned browser preference key; values are `compact` or `avatars`. */
export const SELECTOR_PREFERENCE_KEY = 'dsh.assistants.selector-layout.v1'

/** Shared display preference observed by Hero and Session selector instances. */
export interface SelectorPreference {
  readonly subscribe: (listener: () => void) => () => void
  readonly getSnapshot: () => boolean
  readonly setExpanded: (expanded: boolean) => void
  readonly refresh: () => void
}

/**
 * Read and persist the avatar shelf preference without touching conversation state.
 * @param storage - browser storage when available; denied storage keeps a window-local preference.
 * @returns shared observable preference, compact by default.
 */
export function createSelectorPreference(storage?: Pick<Storage, 'getItem' | 'setItem'>): SelectorPreference {
  const read = () => {
    try { return storage?.getItem(SELECTOR_PREFERENCE_KEY) === 'avatars' }
    catch (error) { // Browser privacy settings can deny optional preference storage.
      void error
      return false
    }
  }
  const store = createSnapshotStore(read())
  return {
    subscribe: listener => store.subscribe(listener),
    getSnapshot: () => store.getSnapshot(),
    setExpanded: (expanded) => {
      store.set(expanded)
      try { storage?.setItem(SELECTOR_PREFERENCE_KEY, expanded ? 'avatars' : 'compact') }
      catch (error) { // Keep the current window usable when persistence is denied.
        void error
      }
    },
    refresh: () => { store.set(read()) },
  }
}
