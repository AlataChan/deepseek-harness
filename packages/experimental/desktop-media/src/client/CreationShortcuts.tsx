/**
 * Session-scoped Make Video / Make Voiceover controls.
 * 克隆声音 is the file control itself: the composer clips a separate dialog.
 */

import { useState, type ChangeEvent } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { IconPlayOutline16, IconSparkle16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { NS, type MediaKey } from './locales.ts'
import type { MediaSessionRemotes } from './remotes.ts'
import {
  encodeMediaBytes, importedCloneDraft, isCloneAudioName, readCloneFile,
} from './VoicePicker.tsx'
import css from './CreationShortcuts.module.css'

/** Full props of the conversation input-left shortcuts. */
export type CreationShortcutsProps =
  PropsRuntime<'conversation.input.left'>
  & PropsLocale<typeof NS>
  & {
    remotes?: MediaSessionRemotes
    sessionId?: string
    workspaceId?: string
  }

/**
 * Take the first file from a native picker event.
 * @param event - change or input from the file control.
 * @returns the chosen file, or undefined when the dialog closed empty.
 */
export function fileFromPicker(event: ChangeEvent<HTMLInputElement>): File | undefined {
  return event.target.files?.[0]
}

/**
 * Render Make Video, Make Voiceover, and the clone-sample file control.
 * @param props - session input actions, remotes, and locale.
 * @returns the shortcut row.
 */
export function CreationShortcuts({
  inputActions, sessionId, remotes, workspaceId, t,
}: CreationShortcutsProps) {
  const [file, setFile] = useState<File | undefined>()
  const [authorized, setAuthorized] = useState(false)
  const [speakerIsUser, setSpeakerIsUser] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)
  const send = (key: MediaKey): void => {
    inputActions.setDraft(t(key))
    inputActions.submit()
  }
  const choose = (event: ChangeEvent<HTMLInputElement>): void => {
    const next = fileFromPicker(event)
    event.target.value = ''
    if (next === undefined) return
    setFile(next)
    setAuthorized(false)
    setError(isCloneAudioName(next.name) ? undefined : t('voice.badFile'))
  }
  const close = (): void => {
    setFile(undefined)
    setAuthorized(false)
    setError(undefined)
    setSaving(false)
  }
  const confirm = async (): Promise<void> => {
    if (file === undefined || !authorized || saving) return
    if (!isCloneAudioName(file.name)) {
      setError(t('voice.badFile'))
      return
    }
    if (sessionId === undefined || remotes === undefined) {
      setError(t('voice.importFailed'))
      return
    }
    setSaving(true)
    let encoded: string
    try {
      encoded = encodeMediaBytes(await readCloneFile(file))
    } catch {
      setSaving(false)
      setError(t('voice.readFailed'))
      return
    }
    const result = await remotes.importMediaBytes({
      filename: file.name,
      bytes: encoded,
      sessionId,
      ...workspaceId === undefined ? {} : { workspaceId },
    })
    setSaving(false)
    if (!result.ok) {
      const message = result.error.message.trim()
      setError(message === '' ? t('voice.importFailed') : message)
      return
    }
    inputActions.setDraft(importedCloneDraft(
      t('voice.imported'),
      result.value.artifactId,
      file.name,
      t(speakerIsUser ? 'voice.speakerIsUser' : 'voice.speakerAuthorized'),
    ))
    inputActions.submit()
    close()
  }
  return (
    <div className={css.row}>
      <button
        type="button"
        className={css.chip}
        aria-label={t('shortcut.video')}
        onClick={() => { send('prompt.video') }}
      >
        <IconPlayOutline16 size={14} />
        <span>{t('shortcut.video')}</span>
      </button>
      <button
        type="button"
        className={css.chip}
        aria-label={t('shortcut.speech')}
        onClick={() => { send('prompt.speech') }}
      >
        <IconSparkle16 size={14} />
        <span>{t('shortcut.speech')}</span>
      </button>
      <label className={css.chip}>
        <IconSparkle16 size={14} />
        <span>{t('shortcut.clone')}</span>
        <input
          className={css.fileHit}
          type="file"
          aria-label={t('shortcut.clone')}
          onChange={choose}
          onInput={choose}
        />
      </label>
      {file !== undefined && typeof document !== 'undefined'
        ? createPortal(
          <div className={css.sheetOverlay} role="presentation">
            <section className={css.sheet} role="dialog" aria-label={t('shortcut.clone')}>
              <h2>{t('shortcut.clone')}</h2>
              <p>{file.name}</p>
              <label>
                <input
                  type="checkbox"
                  checked={authorized}
                  onChange={(event) => { setAuthorized(event.target.checked) }}
                />
                {t('voice.consent')}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={speakerIsUser}
                  onChange={(event) => { setSpeakerIsUser(event.target.checked) }}
                />
                {t('voice.speakerIsUser')}
              </label>
              {error === undefined ? null : <p role="alert">{error}</p>}
              <div className={css.sheetActions}>
                <button type="button" onClick={close}>{t('voice.cancel')}</button>
                <button type="button" disabled={saving} onClick={() => { void confirm() }}>
                  {t('voice.confirm')}
                </button>
              </div>
            </section>
          </div>,
          document.body,
        )
        : null}
    </div>
  )
}
