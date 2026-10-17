/** Ordered preference writes and notices for composer predictions. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'

/** Fields exposed by the assistant-registry plugin for predictions. */
export interface PredictionSettings {
  enableComposerPredictions: boolean
}

/** Mutation state shared by the preference row and notice toast. */
export interface PredictionMutation {
  busy: boolean
  notice: 'settingSaved' | 'settingSaveFailed' | null
  sequence: number
}

/** Writes the Host setting without publishing an optimistic toggle state. */
export class PredictionSettingPreference {
  /** Observable mutation outcome. */
  readonly state = createSnapshotStore<PredictionMutation>({ busy: false, notice: null, sequence: 0 })

  /** @param form - Host-owned configuration form. */
  constructor(private readonly form: ConfigForm<PredictionSettings>) {}

  /**
   * Persist enablement; refusal or transport failure leaves the accepted value visible.
   * @param enabled - requested prediction state.
   * @returns completion after the write settles.
   */
  async setEnabled(enabled: boolean): Promise<void> {
    if (this.state.getSnapshot().busy) return
    this.state.update((state) => {
      state.busy = true
      state.notice = null
    })
    let accepted = false
    try {
      accepted = await this.form.set('enableComposerPredictions', enabled)
    } catch (_error) {
      // The toast reports the failed write while the form retains accepted state.
    }
    this.state.update((state) => {
      state.busy = false
      state.notice = accepted ? 'settingSaved' : 'settingSaveFailed'
      state.sequence++
    })
  }

  /** Clear the displayed mutation notice. */
  dismiss(): void {
    this.state.update((state) => {
      state.notice = null
    })
  }
}
