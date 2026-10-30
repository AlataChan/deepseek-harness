/** Desktop settings section with independently managed channel forms. */
import { useEffect, useId, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConnectionConfig, ImChannel, ImSnapshot } from '../schema.ts'
import type { ImLocaleKey } from './locales.ts'
import css from './ImSettings.module.css'

/** Browser-safe configuration operations injected by the Client plugin. */
export interface ImSettingsActions {
  pickDirectory(this: void): Promise<string | null>
  list(this: void, signal?: AbortSignal): Promise<ImSnapshot[]>
  providers(this: void, signal?: AbortSignal): Promise<string[]>
  models(this: void, provider: string, signal?: AbortSignal): Promise<string[]>
  save(this: void, channel: ImChannel, config: ConnectionConfig, secret: string): Promise<ImSnapshot>
  test(this: void, channel: ImChannel): Promise<ImSnapshot>
  setEnabled(this: void, channel: ImChannel, enabled: boolean): Promise<ImSnapshot>
}
/** Section injection, separate from locale/runtime props. */
export interface ImSettingsInjected { actions: ImSettingsActions }
type Translation = (key: ImLocaleKey) => string
const failureKeys = { startup: 'failureStartup', delivery: 'failureDelivery', storage: 'failureStorage', shutdown: 'failureShutdown' } as const
const blank: ConnectionConfig = { appId: '', tenantId: '', chatId: '', senderId: '', cwd: '', provider: '', model: '' }

/**
 * Render the platform setup and connection controls.
 * @param props - Registered settings actions and locale.
 * @returns Two accessible channel forms.
 */
export function ImSettings({ actions, t }: ImSettingsInjected & PropsLocale<'desktop-im'>) {
  const [rows, setRows] = useState<ImSnapshot[]>()
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const lifetime = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      try {
        const result = await actions.list(lifetime.signal)
        if (!lifetime.signal.aborted) { setRows(result); setFailed(false) }
      } catch (_error) { if (!lifetime.signal.aborted) setFailed(true) }
      if (!lifetime.signal.aborted) timer = setTimeout(() => { void refresh() }, 3000)
    }
    void refresh()
    return () => { lifetime.abort(); clearTimeout(timer) }
  }, [actions, retry])
  return <section className={css.section}>
    <h2>{t('title')}</h2><p>{t('intro')}</p>
    {failed && <div role="alert">{t('failed')} <button onClick={() =>{  setRetry(value => value + 1) }}>{t('retry')}</button></div>}
    {!rows && !failed && <div role="status" aria-label={t('loading')} className={css.spinner} />}
    {rows?.map(row => <ChannelCard key={row.channel} row={row} actions={actions} t={t}
      onChange={(updated) => {
        setRows(previous => previous?.map(item => item.channel === updated.channel ? updated : item))
      }} />)}
  </section>
}

function ChannelCard({ row, actions, t, onChange }: {
  row: ImSnapshot
  actions: ImSettingsActions
  t: Translation
  onChange(this: void, row: ImSnapshot): void
}) {
  const id = useId()
  const [draft, setDraft] = useState<ConnectionConfig>(() => row.config ?? { ...blank })
  const [secret, setSecret] = useState('')
  const [providers, setProviders] = useState<string[]>([])
  const [models, setModels] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const dirty = secret !== '' || JSON.stringify(draft) !== JSON.stringify(row.config ?? blank)
  useEffect(() => {
    const lifetime = new AbortController()
    void actions.providers(lifetime.signal)
      .then((value) => { if (!lifetime.signal.aborted) setProviders(value) })
      .catch(() => { if (!lifetime.signal.aborted) setError(true) })
    return () =>{  lifetime.abort() }
  }, [actions])
  useEffect(() => {
    const lifetime = new AbortController()
    setModels([])
    if (draft.provider) {
      void actions.models(draft.provider, lifetime.signal)
        .then((value) => { if (!lifetime.signal.aborted) setModels(value) })
        .catch(() => { /* Providers may support explicit IDs without a catalog. */ })
    }
    return () =>{  lifetime.abort() }
  }, [actions, draft.provider])
  const run = async (operation: () => Promise<ImSnapshot>, success: ImLocaleKey) => {
    setBusy(true); setError(false)
    try { const updated = await operation(); onChange(updated); if (success === 'saved') { setSecret(''); setDraft(updated.config ?? { ...blank }) } }
    catch (_error) { setError(true) }
    finally { setBusy(false) }
  }
  const chooseWorkspace = async () => {
    setBusy(true); setError(false)
    try {
      const path = await actions.pickDirectory()
      if (path !== null) setDraft(previous => ({ ...previous, cwd: path }))
    } catch (_error) { setError(true) }
    finally { setBusy(false) }
  }
  return <article className={css.card}>
    <header><h3>{t(row.channel)}</h3><span role="status" data-phase={row.phase}>{t(row.phase)}</span></header>
    <p>{t(row.channel === 'feishu' ? 'setupFeishu' : 'setupDingtalk')}</p>
    <p>{t('permissions')}</p>
    <form onSubmit={(event) => { event.preventDefault(); void run(() => actions.save(row.channel, draft, secret), 'saved') }}>
      <fieldset disabled={busy} className={css.fields}>
        {(['appId', 'tenantId', 'chatId', 'senderId', 'cwd'] as const).map(field => <label key={field} htmlFor={`${id}-${field}`}>{t(field)}<input id={`${id}-${field}`} required value={draft[field]} onChange={(event) =>{  setDraft({ ...draft, [field]: event.target.value }) }} /></label>)}
        <label htmlFor={`${id}-secret`}>{t('secret')}<input id={`${id}-secret`} type="password" autoComplete="new-password" required={!row.secretConfigured} value={secret} placeholder={row.secretConfigured ? t('secretSaved') : ''} onChange={(event) =>{  setSecret(event.target.value) }} /></label>
        <label htmlFor={`${id}-provider`}>{t('provider')}<select id={`${id}-provider`} required value={draft.provider} onChange={(event) =>{  setDraft({ ...draft, provider: event.target.value, model: '' }) }}><option value="">{t('choose')}</option>{providers.map(provider => <option key={provider} value={provider}>{provider}</option>)}</select></label>
        <label htmlFor={`${id}-model`}>{t('model')}<input id={`${id}-model`} list={`${id}-models`} required value={draft.model} onChange={(event) =>{  setDraft({ ...draft, model: event.target.value }) }} /><datalist id={`${id}-models`}>{models.map(model => <option key={model} value={model} />)}</datalist><small>{t('customModel')}</small></label>
        <p className={css.full}>{t('identityHelp')}</p>
        <div className={css.actions}>
          <button type="button" onClick={() => { void chooseWorkspace() }}>{t('browse')}</button>
          <button type="submit" disabled={!dirty}>{t('save')}</button>
          <button type="button" disabled={dirty || !row.config || row.enabled || row.phase === 'connected'} onClick={() => void run(() => actions.test(row.channel), 'tested')}>{t('test')}</button>
          <button type="button" disabled={(!row.enabled && dirty) || !row.config} onClick={() => void run(() => actions.setEnabled(row.channel, !row.enabled), row.enabled ? 'disabled' : 'enabled')}>{t(row.enabled ? 'disable' : 'enable')}</button>
        </div>
      </fieldset>
    </form>
    <p>{t('approval')}</p>
    {(error || row.error) && <p role="alert">{t(row.error ? failureKeys[row.error] : 'failed')}</p>}
  </article>
}
