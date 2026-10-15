/** Shared Host-backed mark selection and mutation feedback for all mounted brand slots. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { BrandMarkId, BrandSettings } from '../brand-settings.ts'

/** Accepted mark and settings readiness; mutation outcomes survive closing Settings. */
export interface BrandPreferenceState {
  readonly id: BrandMarkId
  readonly writable: boolean
  readonly pending: boolean
  readonly notice: { readonly seq: number; readonly success: boolean } | undefined
}
/** Client lifetime of one Host settings namespace. */
export interface BrandPreference {
  readonly subscribe: (listener: () => void) => () => void
  readonly getSnapshot: () => BrandPreferenceState
  readonly select: (id: BrandMarkId) => Promise<void>
  readonly dismiss: (seq: number) => void
  readonly dispose: () => void
}
/**
 * Observe accepted Host settings; failed writes leave the accepted mark intact.
 * @param form - revision-fenced durable Host configuration.
 * @returns shared preference with explicit listener teardown.
 */
export function createBrandPreference(form: ConfigForm<BrandSettings>): BrandPreference {
  const store = createSnapshotStore<BrandPreferenceState>({ id: 'original', writable: false, pending: false, notice: undefined })
  const lifetime = { disposed: false }
  const isDisposed = (): boolean => lifetime.disposed
  let noticeSeq = 0
  const adopt = () => {
    if (isDisposed()) return
    const source = form.getSnapshot()
    store.set({ ...store.getSnapshot(), id: source.value?.brandMark ?? store.getSnapshot().id,
      writable: source.status === 'ready' && source.writable && source.mode === 'host' })
  }
  const unsubscribe = form.subscribe(adopt)
  adopt()
  return {
    subscribe: listener => store.subscribe(listener),
    getSnapshot: () => store.getSnapshot(),
    select: async (id) => {
      const state = store.getSnapshot()
      if (lifetime.disposed || !state.writable || state.pending || state.id === id) return
      store.set({ ...state, pending: true, notice: undefined })
      let success = false
      try { success = await form.set('brandMark', id) }
      catch (error) { // Transport failures are reported by the shell-owned outcome toast.
        void error
      }
      if (isDisposed()) return
      adopt()
      store.set({ ...store.getSnapshot(), pending: false, notice: { seq: ++noticeSeq, success } })
    },
    dismiss: (seq) => {
      if (store.getSnapshot().notice?.seq === seq) store.set({ ...store.getSnapshot(), notice: undefined })
    },
    dispose: () => { lifetime.disposed = true; unsubscribe() },
  }
}
