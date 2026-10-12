/**
 * 专业能力 menu rows: Make Video, Make Voiceover, and the clone-sample file
 * control. The clone dialog clips as a body portal sheet.
 */

import { useRef, useState, type ChangeEvent } from 'react'
import { createPortal } from 'react-dom'
import { MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MediaKey } from './locales.ts'
import { MINIMAX_API_KEY_NAME } from './MinimaxKeyCard.tsx'
import type { MediaCredentialsRemotes, MediaSessionRemotes } from './remotes.ts'
import {
  encodeMediaBytes, importedCloneDraft, isCloneAudioName, readCloneFile,
} from './VoicePicker.tsx'
import css from './CreationShortcuts.module.css'

/** Actions the rows need from their registrant. */
export interface CreationShortcutsInjected {
  remotes?: MediaSessionRemotes | undefined
  credentials?: MediaCredentialsRemotes | undefined
  sessionId?: SessionId | undefined
  workspaceId?: string | undefined
}

/** Full props of the 专业能力 creation rows. */
export type CreationShortcutsProps =
  PropsRuntime<'conversation.hero.capabilities.item'>
  & InjectFace<CreationShortcutsInjected>
  & { t: (key: MediaKey) => string }

/**
 * Take the first file from a native picker event.
 * @param event - change or input from the file control.
 * @returns the chosen file, or undefined when the dialog closed empty.
 */
export function fileFromPicker(event: ChangeEvent<HTMLInputElement>): File | undefined {
  return event.target.files?.[0]
}

/**
 * Render Make Video, Make Voiceover, and the clone-sample row.
 * @param props - session input actions, remotes, the menu close seat, and locale.
 * @returns the menu rows and the clone sheet.
 */
export function CreationShortcuts({
  inputActions, sessionId, remotes, credentials, workspaceId, close: closeMenu, t,
}: CreationShortcutsProps) {
  const [file, setFile] = useState<File | undefined>()
  const [authorized, setAuthorized] = useState(false)
  const [speakerIsUser, setSpeakerIsUser] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [notice, setNotice] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const blocked = async (): Promise<string | undefined> => {
    if (inputActions === undefined) return t('preflight.noSession')
    if (remotes === undefined) return t('preflight.unavailable')
    const runtime = await remotes.mediaRuntimeStatus()
    if (!runtime.ok || !runtime.value.ready) return t('works.runtimeMissing')
    if (credentials === undefined) return t('preflight.keyMissing')
    const described = await credentials.describe([MINIMAX_API_KEY_NAME])
    if (!described.ok || described.value[MINIMAX_API_KEY_NAME]?.configured !== true) {
      return t('preflight.keyMissing')
    }
    return undefined
  }
  const send = (key: MediaKey): void => {
    if (inputActions === undefined) {
      setNotice(t('preflight.noSession'))
      return
    }
    const actions = inputActions
    void blocked().then((reason) => {
      if (reason !== undefined) {
        setNotice(reason)
        return
      }
      setNotice(undefined)
      actions.setDraft(t(key))
      actions.submit()
      closeMenu()
    })
  }
  const choose = (event: ChangeEvent<HTMLInputElement>): void => {
    const next = fileFromPicker(event)
    event.target.value = ''
    if (next === undefined) return
    void blocked().then((reason) => {
      if (reason !== undefined) {
        setNotice(reason)
        return
      }
      setNotice(undefined)
      setFile(next)
      setAuthorized(false)
      setError(isCloneAudioName(next.name) ? undefined : t('voice.badFile'))
    })
  }
  const close = (): void => {
    setFile(undefined)
    setAuthorized(false)
    setError(undefined)
    setSaving(false)
  }
  const dismiss = (): void => {
    close()
    closeMenu()
  }
  const confirm = async (): Promise<void> => {
    if (file === undefined || !authorized || saving) return
    if (!isCloneAudioName(file.name)) {
      setError(t('voice.badFile'))
      return
    }
    if (sessionId === undefined || remotes === undefined || inputActions === undefined) {
      setError(t('voice.importFailed'))
      return
    }
    const actions = inputActions
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
    actions.setDraft(importedCloneDraft(
      t('voice.imported'),
      result.value.artifactId,
      file.name,
      t(speakerIsUser ? 'voice.speakerIsUser' : 'voice.speakerAuthorized'),
    ))
    actions.submit()
    dismiss()
  }
  return (
    <>
      {notice === undefined ? null : <p className={css.notice} role="alert">{notice}</p>}
      <MenuItemButton onSelect={() => { send('prompt.video') }}>
        {t('shortcut.video')}
      </MenuItemButton>
      <MenuItemButton onSelect={() => { send('prompt.speech') }}>
        {t('shortcut.speech')}
      </MenuItemButton>
      <MenuItemButton onSelect={() => { fileInputRef.current?.click() }}>
        {t('shortcut.clone')}
      </MenuItemButton>
      <input
        ref={fileInputRef}
        type="file"
        hidden
        aria-label={t('shortcut.clone')}
        onChange={choose}
        onInput={choose}
      />
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
                <button type="button" onClick={dismiss}>{t('voice.cancel')}</button>
                <button type="button" disabled={saving} onClick={() => { void confirm() }}>
                  {t('voice.confirm')}
                </button>
              </div>
            </section>
          </div>,
          document.body,
        )
        : null}
    </>
  )
}
