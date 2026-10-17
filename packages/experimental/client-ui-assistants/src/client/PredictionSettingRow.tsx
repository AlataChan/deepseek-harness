/** General settings row and toast for composer predictions. */
import { Switch, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PredictionMutation, PredictionSettings } from './prediction-preference.ts'
import { NS } from './locales.ts'
import css from './ComposerPrediction.module.css'

/** Accepted settings and mutation callbacks supplied by the plugin. */
export interface PredictionSettingInjected {
  hooks: {
    form: ObservableSnapshot<ConfigFormSnapshot<PredictionSettings>>
    mutation: ObservableSnapshot<PredictionMutation>
  }
  setEnabled(enabled: boolean): Promise<void>
  dismiss(): void
}

type Face = InjectFace<PredictionSettingInjected> & PropsLocale<typeof NS>

/**
 * Render the composer prediction General Settings row.
 * @param props - settings hooks, writer and localized copy.
 * @returns the general settings row.
 */
export function PredictionSettingRow({ useForm, useMutation, setEnabled, t }: PropsRuntime<'settings.general.item'> & Face) {
  const form = useForm(value => value)
  const busy = useMutation(value => value.busy)
  return (
    <div className={css.settingRow}>
      <div className={css.settingInfo}>
        <div className={css.settingTitle}>{t('settingPredictionTitle')}</div>
        <div className={css.settingDescription}>{t('settingPredictionDescription')}</div>
      </div>
      <Switch
        checked={form.value?.enableComposerPredictions === true}
        label={t('settingPredictionTitle')}
        disabled={busy || form.status !== 'ready' || !form.writable}
        onChange={(enabled) => { void setEnabled(enabled) }}
      />
    </div>
  )
}

/**
 * Toast for prediction settings outcome.
 * @param props - mutation hook, dismissal and localized copy.
 * @returns toast or null.
 */
export function PredictionSettingToast({ useMutation, dismiss, t }: PropsRuntime<'shell.overlay'> & Face) {
  const state = useMutation(value => value)
  if (state.notice === null) return null
  return (
    <Toast
      key={state.sequence}
      text={t(state.notice)}
      onDone={dismiss}
      {...(state.notice === 'settingSaved' ? { tone: 'success' as const } : {})}
    />
  )
}
