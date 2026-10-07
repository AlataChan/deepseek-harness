/**
 * System and cloned voice picker with in-picker clone consent.
 */

import { useEffect, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import type { MediaSessionRemotes, MediaVoiceRow } from './remotes.ts'
import css from './VoicePicker.module.css'

/** Actions the picker needs from the conversation seat. */
export interface VoicePickerInjected {
  remotes: MediaSessionRemotes
  sessionId: string
  workspaceId?: string
  encodeBytes: (bytes: Uint8Array) => string
  onImported?: (artifactId: string, label: string, speakerIsUser: boolean) => void
  /** Open the upload form immediately. The tool card keeps it behind 新增克隆. */
  startAdding?: boolean
  onCancel?: () => void
}

/** Full props of the voice picker. */
export type VoicePickerProps = VoicePickerInjected & PropsLocale<typeof NS>

/**
 * Whether a filename is a clone sample the Host will admit.
 * @param filename - user-visible name.
 * @returns true for mp3, m4a, or wav.
 */
export function isCloneAudioName(filename: string): boolean {
  return /\.(mp3|m4a|wav)$/i.test(filename)
}

/**
 * Fill the imported-sample draft from locale copy.
 * @param template - `voice.imported`, with `{id}`, `{label}`, and `{speaker}`.
 * @param artifactId - registered sample id.
 * @param label - display name.
 * @param speaker - localized speaker sentence.
 * @returns the draft sent after a successful import.
 */
export function importedCloneDraft(
  template: string,
  artifactId: string,
  label: string,
  speaker: string,
): string {
  return template
    .replaceAll('{id}', artifactId)
    .replaceAll('{label}', label)
    .replaceAll('{speaker}', speaker)
}

/**
 * Read a picked file. `File.arrayBuffer` can reject in WKWebView.
 * @param file - native picker result.
 * @returns file bytes.
 */
export async function readCloneFile(file: File): Promise<Uint8Array> {
  try {
    if (typeof file.arrayBuffer === 'function') {
      return new Uint8Array(await file.arrayBuffer())
    }
  } catch {
    // WKWebView can reject arrayBuffer after the picker returns a File.
  }
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(new Uint8Array(reader.result))
      else reject(new Error('FileReader failed'))
    }
    reader.onerror = () => {
      reject(reader.error ?? new Error('FileReader failed'))
    }
    reader.readAsArrayBuffer(file)
  })
}

/**
 * Encode decoded file bytes as standard base64.
 * @param bytes - decoded file bytes.
 * @returns canonical base64.
 */
export function encodeMediaBytes(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

/**
 * Render system voices, cloned voices, and the add-clone form.
 * @param props - remotes, session, and locale.
 * @returns the picker.
 */
export function VoicePicker({
  remotes, sessionId, workspaceId, encodeBytes, onImported, startAdding = false, onCancel, t,
}: VoicePickerProps) {
  const [voices, setVoices] = useState<readonly MediaVoiceRow[]>([])
  const [adding, setAdding] = useState(startAdding)
  const [label, setLabel] = useState('')
  const [file, setFile] = useState<File | undefined>()
  const [speakerIsUser, setSpeakerIsUser] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const ac = new AbortController()
    void remotes.listMediaVoices(ac.signal).then((result) => {
      if (result.ok) setVoices(result.value)
    })
    return () => { ac.abort() }
  }, [remotes])

  const system = voices.filter(row => row.system)
  const mine = voices.filter(row => !row.system)

  useEffect(() => {
    const input = fileRef.current
    if (input === null || !adding) return
    const take = (): void => {
      const next = input.files?.[0]
      if (next !== undefined) {
        setFile(next)
        setError(undefined)
      }
    }
    // WKWebView delivers the File on `input` and may not bubble `change` to React.
    input.addEventListener('change', take)
    input.addEventListener('input', take)
    return () => {
      input.removeEventListener('change', take)
      input.removeEventListener('input', take)
    }
  }, [adding])

  const confirm = async (): Promise<void> => {
    if (file === undefined || !authorized || saving) return
    if (!isCloneAudioName(file.name)) {
      setError(t('voice.badFile'))
      return
    }
    setSaving(true)
    let encoded: string
    try {
      encoded = encodeBytes(await readCloneFile(file))
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
    if (result.ok) {
      onImported?.(result.value.artifactId, label || file.name, speakerIsUser)
      setAdding(false)
      setAuthorized(false)
      setFile(undefined)
      setError(undefined)
      return
    }
    const message = result.error.message.trim()
    setError(message === '' ? t('voice.importFailed') : message)
  }

  return (
    <div className={css.picker}>
      <section aria-label={t('voice.system')}>
        <h3>{t('voice.system')}</h3>
        <ul>
          {system.map(voice => <li key={voice.voiceId}>{voice.label}</li>)}
        </ul>
      </section>
      <section aria-label={t('voice.mine')}>
        <h3>{t('voice.mine')}</h3>
        <ul>
          {mine.map(voice => <li key={voice.voiceId}>{voice.label}</li>)}
        </ul>
        {adding
          ? (
            <div className={css.add}>
              <input aria-label={t('voice.add')} value={label} onChange={(event) => { setLabel(event.target.value) }} />
              <label className={css.fileLabel}>
                {file === undefined ? t('voice.file') : file.name}
                <input ref={fileRef} aria-label={t('voice.file')} type="file" />
              </label>
              <p className={css.hint}>{t('voice.fileHint')}</p>
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
              <button type="button" onClick={() => {
                setAdding(false)
                onCancel?.()
              }}>{t('voice.cancel')}</button>
              <button type="button" disabled={saving} onClick={() => { void confirm() }}>
                {t('voice.confirm')}
              </button>
              {error === undefined ? null : <p role="alert">{error}</p>}
            </div>
          )
          : (
            <button type="button" onClick={() => { setAdding(true) }}>{t('voice.add')}</button>
          )}
      </section>
    </div>
  )
}
