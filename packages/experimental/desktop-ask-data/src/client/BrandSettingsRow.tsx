/** Product-mark presets and live previews inside the existing General appearance settings. */
import { useSyncExternalStore } from 'react'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { BRAND_MARK_IDS } from '../brand-settings.ts'
import { BRAND_MARKS } from './brand-marks.ts'
import type { BrandPreference } from './brand-preference.ts'
import css from './BrandSettingsRow.module.css'

/** Injected shared Host preference and typed locale copy. */
export type BrandSettingsRowProps = PropsLocale<'desktop-ask-data'> & { preference: BrandPreference }
/**
 * Render the three offline marks and a preview of their application placements.
 * @param props - shared preference and localized copy.
 * @returns accessible selection buttons and a restore-default action.
 */
export function BrandSettingsRow({ preference, t }: BrandSettingsRowProps) {
  const state = useSyncExternalStore(preference.subscribe, preference.getSnapshot)
  return <section className={css.group} aria-label={t('brand.title')}>
    <div className={css.heading}><span>{t('brand.title')}</span>
      <button type="button" className={css.reset} disabled={!state.writable || state.pending || state.id === 'original'}
        onClick={() => { void preference.select('original') }}>{t('brand.reset')}</button></div>
    <p className={css.description}>{t('brand.description')}</p>
    <div className={css.options}>
      {BRAND_MARK_IDS.map(id => <button key={id} type="button" className={css.option}
        aria-pressed={state.id === id} disabled={!state.writable || state.pending}
        onClick={() => { void preference.select(id) }}>
        <img src={BRAND_MARKS[id]} width={64} height={64} alt="" />
        <span>{t(`brand.${id}`)}</span>
      </button>)}
    </div>
    <div className={css.preview} aria-label={t('brand.preview')}>
      <div className={css.sidebar}><img src={BRAND_MARKS[state.id]} width={28} height={28} alt="" /><span>{t('brandName')}</span></div>
      <div className={css.hero}><img src={BRAND_MARKS[state.id]} width={48} height={48} alt="" /><span>{t('heroHeadline')}</span></div>
    </div>
    {!state.writable && <p className={css.description}>{t('brand.unavailable')}</p>}
  </section>
}
/**
 * Keep save outcomes visible even when the settings panel closes.
 * @param props - shared preference and localized copy.
 * @returns transient save feedback using the shared Toast primitive.
 */
export function BrandSettingsToast({ preference, t }: BrandSettingsRowProps) {
  const { notice } = useSyncExternalStore(preference.subscribe, preference.getSnapshot)
  return notice ? <Toast key={notice.seq} text={t(notice.success ? 'brand.saved' : 'brand.failed')}
    {...notice.success ? { tone: 'success' as const } : {}}
    onDone={() => { preference.dismiss(notice.seq) }} /> : null
}
