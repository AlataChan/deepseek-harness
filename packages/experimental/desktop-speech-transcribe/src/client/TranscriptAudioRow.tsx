/**
 * 专业能力 menu row: pick a local recording, stage it into the session
 * workspace through the Host, and submit a transcription request for the
 * `speech_transcribe` tool.
 */

import { useRef, useState, type ChangeEvent } from 'react'
import { MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SpeechTranscribeKey } from './locales.ts'
import type { TranscriptAudioRemotes } from './remotes.ts'
import css from './TranscriptAudioRow.module.css'

/** Maximum upload size the row pre-checks, mirroring the overlay default. */
export const MAX_UPLOAD_MIB = 64

/** Actions and seats the row receives from its registrant and owner. */
export interface TranscriptAudioRowInjected {
  remotes?: TranscriptAudioRemotes | undefined
  sessionId?: SessionId | undefined
  workspaceId?: string | undefined
}

/** Full props of the 录音转文字 row. */
export type TranscriptAudioRowProps =
  PropsRuntime<'conversation.hero.capabilities.item'>
  & InjectFace<TranscriptAudioRowInjected>
  & { t: (key: SpeechTranscribeKey, params?: Record<string, unknown>) => string }

/**
 * Take the first file from a native picker event.
 * @param event - change or input from the file control.
 * @returns the chosen file, or undefined when the dialog closed empty.
 */
export function fileFromPicker(event: ChangeEvent<HTMLInputElement>): File | undefined {
  return event.target.files?.[0]
}

/**
 * Read a picked file. `File.arrayBuffer` can reject in WKWebView.
 * @param file - native picker result.
 * @returns file bytes.
 */
export async function readAudioFile(file: File): Promise<Uint8Array> {
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
export function encodeAudioBytes(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

/**
 * Render the 录音转文字 menu row.
 * @param props - session input actions, remotes, the menu close seat, and locale.
 * @returns the row, its hidden file control, and any inline notice.
 */
export function TranscriptAudioRow({
  inputActions, sessionId, remotes, workspaceId, close: closeMenu, t,
}: TranscriptAudioRowProps) {
  const [notice, setNotice] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const stage = async (file: File): Promise<void> => {
    if (inputActions === undefined) {
      setNotice(t('row.noSession'))
      return
    }
    if (remotes === undefined || sessionId === undefined) {
      setNotice(t('row.unavailable'))
      return
    }
    const actions = inputActions
    const remotesFace = remotes
    // The picker's `accept` list is advisory; refuse an oversized file before
    // its bytes are read into memory.
    if (file.size > MAX_UPLOAD_MIB * 1024 * 1024) {
      setNotice(t('row.tooLarge', { mib: String(MAX_UPLOAD_MIB) }))
      return
    }
    setBusy(true)
    let bytes: Uint8Array
    try {
      bytes = await readAudioFile(file)
    } catch {
      setBusy(false)
      setNotice(t('row.readFailed'))
      return
    }
    if (bytes.byteLength > MAX_UPLOAD_MIB * 1024 * 1024) {
      setBusy(false)
      setNotice(t('row.tooLarge', { mib: String(MAX_UPLOAD_MIB) }))
      return
    }
    try {
      const result = await remotesFace.importTranscriptAudio({
        filename: file.name,
        bytes: encodeAudioBytes(bytes),
        sessionId,
        ...workspaceId === undefined ? {} : { workspaceId },
      })
      if (!result.ok) {
        const message = result.error.message.trim()
        setNotice(message === '' ? t('row.importFailed') : message)
        return
      }
      setNotice(undefined)
      actions.setDraft(t('row.draft', { path: result.value.path }))
      actions.submit()
      closeMenu()
    } catch {
      // A terminated transport rejects instead of returning a failure result.
      setNotice(t('row.importFailed'))
    } finally {
      setBusy(false)
    }
  }
  const choose = (event: ChangeEvent<HTMLInputElement>): void => {
    const next = fileFromPicker(event)
    event.target.value = ''
    if (next === undefined) return
    void stage(next)
  }
  return (
    <>
      {notice === undefined ? null : <p className={css.notice} role="alert">{notice}</p>}
      <MenuItemButton disabled={busy} onSelect={() => { fileInputRef.current?.click() }}>
        {t('row.label')}
      </MenuItemButton>
      <input
        ref={fileInputRef}
        type="file"
        hidden
        aria-label={t('row.label')}
        accept="audio/*,.m4a,.mp3,.wav,.aac"
        onChange={choose}
        onInput={choose}
      />
    </>
  )
}
