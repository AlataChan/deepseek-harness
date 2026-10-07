/**
 * Models-page footer: store MINIMAX_API_KEY without adding a chat provider.
 */

import { useEffect, useState, type FormEvent } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import type { MediaCredentialsRemotes } from './remotes.ts'
import css from './MinimaxKeyCard.module.css'

/** Credential reference the Host media transport resolves. */
export const MINIMAX_API_KEY_NAME = 'MINIMAX_API_KEY'

/** Actions injected by the browser plugin. */
export interface MinimaxKeyCardInjected {
  credentials?: MediaCredentialsRemotes | undefined
}

/** Full props of the MiniMax key card. */
export type MinimaxKeyCardProps = MinimaxKeyCardInjected & PropsLocale<typeof NS>

/**
 * Read credentials remotes from the Client Remote face when present.
 * @param ctx - client context that may carry `remote.credentials`.
 * @returns the remotes, or undefined when that namespace is absent.
 */
export function mediaCredentialsOf(ctx: ClientContext): MediaCredentialsRemotes | undefined {
  const credentials = (ctx.remote as { credentials?: MediaCredentialsRemotes } | undefined)?.credentials
  if (credentials?.describe === undefined || credentials.set === undefined) return undefined
  return credentials
}

/**
 * Render the MiniMax key field for 做视频 / 做配音.
 * @param props - credentials remotes and locale.
 * @returns the Models footer card.
 */
export function MinimaxKeyCard({ credentials, t }: MinimaxKeyCardProps) {
  const [draft, setDraft] = useState('')
  const [configured, setConfigured] = useState(false)
  const [writable, setWritable] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (credentials === undefined) {
      setWritable(false)
      setError(t('settings.saveFailed'))
      return
    }
    let cancelled = false
    void credentials.describe([MINIMAX_API_KEY_NAME]).then((result) => {
      if (cancelled) return
      if (!result.ok) {
        setError(t('settings.saveFailed'))
        return
      }
      const info = result.value[MINIMAX_API_KEY_NAME]
      setConfigured(info?.configured ?? false)
      setWritable(info?.writable ?? true)
      setError(undefined)
    })
    return () => { cancelled = true }
  }, [credentials, t])

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const value = draft.trim()
    if (value === '') {
      setError(t('settings.blank'))
      return
    }
    if (credentials === undefined || !writable || saving) return
    setSaving(true)
    void credentials.set(MINIMAX_API_KEY_NAME, value).then((result) => {
      setSaving(false)
      if (!result.ok) {
        const message = result.error.message.trim()
        setError(message === '' ? t('settings.saveFailed') : message)
        return
      }
      setDraft('')
      setConfigured(true)
      setError(undefined)
    })
  }

  return (
    <section className={css.card} aria-labelledby="desktop-media-minimax-title">
      <h2 id="desktop-media-minimax-title" className={css.title}>{t('settings.title')}</h2>
      <p className={css.description}>{t('settings.description')}</p>
      <p className={css.status} data-configured={configured || undefined}>
        {configured ? t('settings.configured') : t('settings.missing')}
      </p>
      {!writable && <p className={css.locked}>{t('settings.locked')}</p>}
      <form className={css.form} onSubmit={onSubmit}>
        <label className={css.label} htmlFor="desktop-media-minimax-key">{t('settings.apiKey')}</label>
        <input
          id="desktop-media-minimax-key"
          className={css.input}
          type="password"
          autoComplete="off"
          disabled={!writable}
          value={draft}
          onChange={(event) => { setDraft(event.target.value) }}
        />
        <p className={css.hint}>{t('settings.hint')}</p>
        <button type="submit" className={css.save} disabled={!writable || saving}>
          {t('settings.save')}
        </button>
      </form>
      {error !== undefined && <p className={css.error} role="alert">{error}</p>}
    </section>
  )
}
