/**
 * Library picker. Occupies conversation.askKnowledge.picker, never askData.gate.
 * Create and Add document show the upload panel. The choose-file control is a
 * transparent file input over the visible button so Tauri WebView can open the
 * native picker. The input omits HTML accept and listens on the element.
 * Catalog writes wait for a file or Skip. An existing row hangs
 * on the name, or adds another document.
 */

import { useEffect, useId, useRef, useState } from 'react'
import { readFileBytes } from './bytes.ts'
import {
  encodeIngestChunks,
  ingestFilenameExtension,
  ingestFilenameStem,
  isAcceptedIngestExtension,
  isDefaultLibraryName,
  unusedLibraryName,
} from './ingest-file.ts'
import type { AskKnowledgeKey } from './locales.ts'
import css from './LibraryPicker.module.css'

/** One catalog row the picker can hang. */
export interface PickerLibrary {
  readonly id: string
  readonly displayName: string
}

/** Result of `finishAskKnowledgeIngest` as the picker reads it. */
export interface PickerIngestResult {
  readonly status: 'applied' | 'deferred' | 'failed'
  readonly deferredCount?: number
  readonly rawRelPath?: string
  readonly error?: string
}

/** Remotes the picker needs. */
export interface LibraryPickerRemotes {
  listLibraries: () => Promise<{ ok: boolean; value?: readonly PickerLibrary[]; error?: { message?: string } }>
  createLibrary: (displayName: string) => Promise<{ ok: boolean; value?: PickerLibrary; error?: { message?: string } }>
  attach: (libraryId: string) => Promise<{ ok: boolean; error?: { message?: string } }>
  renameLibrary: (libraryId: string, displayName: string) => Promise<{ ok: boolean; error?: { message?: string } }>
  removeLibrary: (libraryId: string) => Promise<{ ok: boolean; error?: { message?: string } }>
  beginIngest: (libraryId: string, filename: string) => Promise<{ ok: boolean; value?: string; error?: { message?: string } }>
  appendIngestChunk: (handle: string, bytes: string) => Promise<{ ok: boolean; error?: { message?: string } }>
  finishIngest: (handle: string) => Promise<{ ok: boolean; value?: PickerIngestResult; error?: { message?: string } }>
}

/** First panel when the picker mounts. */
export type LibraryPickerPhase = 'list' | 'upload'

/** Injected actions and remotes. */
export interface LibraryPickerInjected extends LibraryPickerRemotes {
  close: () => void
  /**
   * First panel. The hero chip uses list; the composer plus menu uses upload.
   */
  initialPhase?: LibraryPickerPhase
}

/** Picker props. */
export interface LibraryPickerProps extends LibraryPickerInjected {
  t: (key: AskKnowledgeKey) => string
}

/**
 * Operator-facing text for a failed or empty finish.
 * @param finished - remote result of `finishIngest`.
 * @param fallback - generic failure copy.
 * @param timeout - copy when the carrier timed out.
 * @returns the message to show.
 */
export function ingestFinishError(
  finished: { ok: boolean; value?: PickerIngestResult; error?: { message?: string } },
  fallback: string,
  timeout: string,
): string {
  if (!finished.ok || finished.value === undefined) {
    const message = finished.error?.message ?? fallback
    return message.includes('timed out') ? timeout : message
  }
  if (finished.value.status === 'failed') {
    const detail = finished.value.error?.trim()
    if (detail !== undefined && detail !== '') {
      return detail.includes('timed out') ? timeout : detail
    }
    return fallback
  }
  return fallback
}

/**
 * Render the knowledge-library picker.
 * @param props - remotes, close, optional first panel, and locale.
 * @returns the picker panel.
 */
export function LibraryPicker({
  listLibraries,
  createLibrary,
  attach,
  renameLibrary,
  removeLibrary,
  beginIngest,
  appendIngestChunk,
  finishIngest,
  close,
  initialPhase = 'list',
  t,
}: LibraryPickerProps) {
  const [rows, setRows] = useState<readonly PickerLibrary[]>([])
  const [error, setError] = useState<string | undefined>()
  const [phase, setPhase] = useState<LibraryPickerPhase>(initialPhase)
  const [ingesting, setIngesting] = useState(false)
  const fileInputId = useId()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const draftRef = useRef<PickerLibrary | undefined>(undefined)
  const targetRef = useRef<PickerLibrary | undefined>(undefined)
  const createPromise = useRef<Promise<PickerLibrary | undefined> | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    void listLibraries().then((result) => {
      if (cancelled) return
      if (result.ok && result.value !== undefined) setRows(result.value)
      else setError(result.error?.message ?? t('error.noKey'))
    })
    return () => { cancelled = true }
  }, [listLibraries, t])

  const hang = async (libraryId: string) => {
    const result = await attach(libraryId)
    if (result.ok) close()
    else setError(result.error?.message ?? t('error.unbound'))
  }

  const ensureDraft = (): Promise<PickerLibrary | undefined> => {
    if (draftRef.current !== undefined) return Promise.resolve(draftRef.current)
    if (createPromise.current !== undefined) return createPromise.current
    createPromise.current = createLibrary(
      unusedLibraryName(rows.map(row => row.displayName), t('picker.create')),
    ).then((result) => {
      createPromise.current = undefined
      if (result.ok && result.value !== undefined) {
        draftRef.current = result.value
        return result.value
      }
      setError(result.error?.message ?? t('error.noKey'))
      setPhase('list')
      return undefined
    })
    return createPromise.current
  }

  const ingestFile = async (file: File) => {
    setIngesting(true)
    setError(undefined)
    try {
      if (!isAcceptedIngestExtension(ingestFilenameExtension(file.name))) {
        setError(t('error.unsupportedType'))
        return
      }
      const existing = targetRef.current
      const library = existing ?? await ensureDraft()
      if (library === undefined) return
      const begin = await beginIngest(library.id, file.name)
      if (!begin.ok || begin.value === undefined) {
        setError(begin.error?.message ?? t('ingest.failed'))
        return
      }
      const chunks = encodeIngestChunks(await readFileBytes(file))
      for (const bytes of chunks) {
        const appended = await appendIngestChunk(begin.value, bytes)
        if (!appended.ok) {
          setError(appended.error?.message ?? t('ingest.failed'))
          return
        }
      }
      const finished = await finishIngest(begin.value)
      if (!finished.ok || finished.value === undefined || finished.value.status === 'failed') {
        setError(ingestFinishError(finished, t('ingest.failed'), t('ingest.timeout')))
        return
      }
      if (existing === undefined || isDefaultLibraryName(library.displayName, t('picker.create'))) {
        const stem = ingestFilenameStem(file.name)
        const name = unusedLibraryName(
          rows.map(row => row.displayName),
          stem === '' ? t('picker.create') : stem,
        )
        await renameLibrary(library.id, name)
      }
      await hang(library.id)
    } finally {
      setIngesting(false)
    }
  }
  const ingestFileRef = useRef(ingestFile)
  ingestFileRef.current = ingestFile

  const skipEmpty = async () => {
    if (targetRef.current !== undefined) {
      await hang(targetRef.current.id)
      return
    }
    const library = await ensureDraft()
    if (library !== undefined) await hang(library.id)
  }

  useEffect(() => {
    if (phase !== 'upload') return
    const el = fileInputRef.current
    if (el === null) return
    let cancelled = false
    let ignoreEmpty = false
    let busy = false
    const deliver = (): void => {
      if (cancelled) {
        cancelled = false
        ignoreEmpty = false
        busy = false
        el.value = ''
        return
      }
      if (busy) return
      const file = el.files?.[0]
      if (file === undefined) {
        if (ignoreEmpty) return
        setError(t('error.emptyPick'))
        return
      }
      busy = true
      ignoreEmpty = true
      el.value = ''
      queueMicrotask(() => { busy = false })
      void ingestFileRef.current(file)
    }
    const onReady = (): void => { ignoreEmpty = false }
    const onCancel = (): void => { cancelled = true }
    el.addEventListener('click', onReady)
    el.addEventListener('cancel', onCancel)
    el.addEventListener('change', deliver)
    el.addEventListener('input', deliver)
    return () => {
      el.removeEventListener('click', onReady)
      el.removeEventListener('cancel', onCancel)
      el.removeEventListener('change', deliver)
      el.removeEventListener('input', deliver)
    }
  }, [phase, t])

  const startCreate = () => {
    targetRef.current = undefined
    setError(undefined)
    setPhase('upload')
  }

  const startAdd = (row: PickerLibrary) => {
    targetRef.current = row
    setError(undefined)
    setPhase('upload')
  }

  const removeRow = async (row: PickerLibrary) => {
    setError(undefined)
    const result = await removeLibrary(row.id)
    if (!result.ok) {
      setError(result.error?.message ?? t('settings.removeFailed'))
      return
    }
    setRows(current => current.filter(item => item.id !== row.id))
  }

  return (
    <div className={css.panel} role="dialog" aria-label={phase === 'upload' ? t('picker.uploadTitle') : t('picker.title')}>
      {phase === 'list' ? (
        <>
          <h2 className={css.title}>{t('picker.title')}</h2>
          <p className={css.lead}>{t('picker.leadAskData')}</p>
          <p className={css.lead}>{t('picker.leadLibrary')}</p>
          <p className={css.lead}>{t('picker.leadPreset')}</p>
          <p className={css.lead}>{t('picker.leadDataMode')}</p>
          <p className={css.lead}>{t('picker.leadThicken')}</p>
          <div className={css.list}>
            {rows.map(row => (
              <div key={row.id} className={css.libraryRow}>
                <button type="button" className={css.row} onClick={() => { void hang(row.id) }}>
                  {row.displayName}
                </button>
                <button type="button" className={css.add} onClick={() => { startAdd(row) }}>
                  {t('picker.addDocument')}
                </button>
                <button type="button" className={css.remove} onClick={() => { void removeRow(row) }}>
                  {t('picker.remove')}
                </button>
              </div>
            ))}
            <button type="button" className={css.create} onClick={startCreate}>
              {t('picker.emptyCreate')}
            </button>
          </div>
        </>
      ) : (
        <>
          <h2 className={css.title}>{t('picker.uploadTitle')}</h2>
          <p className={css.lead}>{t('picker.uploadLead')}</p>
          {ingesting ? <p className={css.lead}>{t('ingest.applying')}</p> : null}
          <div className={css.list}>
            <div className={css.chooseFile} data-file-pick="library">
              {t('picker.chooseFile')}
              <input
                id={fileInputId}
                ref={fileInputRef}
                className={css.fileInputOverlay}
                type="file"
                disabled={ingesting}
              />
            </div>
            <button type="button" className={css.row} disabled={ingesting} onClick={() => { void skipEmpty() }}>
              {t('picker.skipEmpty')}
            </button>
          </div>
        </>
      )}
      {error !== undefined && <p className={css.error}>{error}</p>}
    </div>
  )
}
