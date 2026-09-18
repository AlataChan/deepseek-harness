/**
 * Library picker. Occupies conversation.askKnowledge.picker, never askData.gate.
 * Rendered as ui-primitives Modal. Create and Add document show the upload panel. The choose-file control is a
 * transparent file input over the visible button so Tauri WebView can open the
 * native picker. The input omits HTML accept and listens on the element.
 * It accepts several files and ingests them one at a time into the one
 * library, because the Host serializes ingest per library and one file costs
 * one carrier deadline; a failed file records its reason and the batch
 * continues. Catalog writes wait for a file or Skip. An existing row hangs
 * on the name, or adds another document.
 */

import { useEffect, useId, useRef, useState } from 'react'
import {
  IconCheckOutline16,
  IconCloseOutline16,
  IconLoadingOutline16,
  IconQueueOutline14,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
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
import { SourceIdentity } from './SourceIdentity.tsx'
import css from './LibraryPicker.module.css'

/** One catalog row the picker can hang. */
export interface PickerLibrary {
  readonly id: string
  readonly displayName: string
  readonly documentCount?: number
}

/** Result of `finishAskKnowledgeIngest` as the picker reads it. */
export interface PickerIngestResult {
  readonly status: 'applied' | 'deferred' | 'failed'
  readonly deferredCount?: number
  readonly rawRelPath?: string
  readonly error?: string
}

/** One file's place in the queued batch. */
type BatchState = 'queued' | 'running' | 'done' | 'failed'

/** One queued file with its own outcome. */
interface BatchEntry {
  readonly name: string
  readonly state: BatchState
  readonly reason?: string
}

/** What one file's ingest settled as. */
type IngestOutcome =
  | { readonly kind: 'applied' }
  | { readonly kind: 'deferred' }
  | { readonly kind: 'failed'; readonly reason: string }

// A new library, and a row still untitled, take the first SUCCESSFUL file's
// stem; every later file in the batch leaves the name alone.
function shouldNameFromStem(library: PickerLibrary | undefined, untitled: string): boolean {
  return library === undefined || isDefaultLibraryName(library.displayName, untitled)
}

function updateBatchEntry(
  entries: readonly BatchEntry[],
  index: number,
  patch: { state: BatchState; reason?: string },
): readonly BatchEntry[] {
  return entries.map((entry, at) => at === index ? { ...entry, ...patch } : entry)
}

function BatchGlyph({ state }: { state: BatchState }) {
  const className = state === 'running' ? `${css.batchGlyph} ${css.batchSpin}` : css.batchGlyph
  const Icon = state === 'queued'
    ? IconQueueOutline14
    : state === 'running'
      ? IconLoadingOutline16
      : state === 'done'
        ? IconCheckOutline16
        : IconCloseOutline16
  return <span className={className} aria-hidden><Icon size={14} /></span>
}

function batchEntryText(entry: BatchEntry, t: (key: AskKnowledgeKey) => string): string {
  /* v8 ignore next -- the driver writes every failed entry with its reason */
  if (entry.state === 'failed') return entry.reason ?? t('ingest.failed')
  if (entry.state === 'done') return t('batchDone')
  if (entry.state === 'running') return t('batchRunning')
  return t('batchQueued')
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

/** Injected actions and remotes. */
export interface LibraryPickerInjected extends LibraryPickerRemotes {
  close: () => void
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
  t,
}: LibraryPickerProps) {
  const [rows, setRows] = useState<readonly PickerLibrary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [phase, setPhase] = useState<'list' | 'upload'>('list')
  const [ingesting, setIngesting] = useState(false)
  const [batch, setBatch] = useState<readonly BatchEntry[]>([])
  const fileInputId = useId()
  const errorId = useId()
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
      setLoading(false)
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

  const ingestOne = async (
    file: File,
    library: PickerLibrary,
    nameFromStem: boolean,
  ): Promise<IngestOutcome> => {
    const begin = await beginIngest(library.id, file.name)
    if (!begin.ok || begin.value === undefined) {
      return { kind: 'failed', reason: begin.error?.message ?? t('ingest.failed') }
    }
    const chunks = encodeIngestChunks(await readFileBytes(file))
    for (const bytes of chunks) {
      const appended = await appendIngestChunk(begin.value, bytes)
      if (!appended.ok) {
        return { kind: 'failed', reason: appended.error?.message ?? t('ingest.failed') }
      }
    }
    const finished = await finishIngest(begin.value)
    if (!finished.ok || finished.value === undefined || finished.value.status === 'failed') {
      return { kind: 'failed', reason: ingestFinishError(finished, t('ingest.failed'), t('ingest.timeout')) }
    }
    if (finished.value.status === 'deferred') return { kind: 'deferred' }
    if (nameFromStem) {
      const stem = ingestFilenameStem(file.name)
      await renameLibrary(library.id, unusedLibraryName(
        rows.map(row => row.displayName),
        stem === '' ? t('picker.create') : stem,
      ))
    }
    return { kind: 'applied' }
  }

  const ingestBatch = async (files: readonly File[]): Promise<void> => {
    setIngesting(true)
    setError(undefined)
    setBatch(files.map(file => ({ name: file.name, state: 'queued' as const })))
    let target = targetRef.current
    let nameFromStem = shouldNameFromStem(target, t('picker.create'))
    let boundId: string | undefined
    try {
      for (const [index, file] of files.entries()) {
        setBatch(current => updateBatchEntry(current, index, { state: 'running' }))
        // Screen the name before any catalog write, so an unsupported file
        // cannot leave an empty library behind.
        if (!isAcceptedIngestExtension(ingestFilenameExtension(file.name))) {
          setBatch(current => updateBatchEntry(current, index, {
            state: 'failed',
            reason: t('error.unsupportedType'),
          }))
          continue
        }
        if (target === undefined) {
          target = await ensureDraft()
          if (target === undefined) return
        }
        let outcome: IngestOutcome
        try {
          outcome = await ingestOne(file, target, nameFromStem)
        } catch (error: unknown) {
          // One unreadable file must not abort the rest of the queue.
          outcome = {
            kind: 'failed',
            reason: error instanceof Error ? error.message : t('ingest.failed'),
          }
        }
        if (outcome.kind === 'applied') {
          nameFromStem = false
          boundId = target.id
          setBatch(current => updateBatchEntry(current, index, { state: 'done' }))
          continue
        }
        // A deferred proposal wrote nothing: its entries wait in a queue no
        // surface reviews, so the file has not landed and must not read as added.
        const reason = outcome.kind === 'deferred' ? t('ingest.deferred') : outcome.reason
        setBatch(current => updateBatchEntry(current, index, { state: 'failed', reason }))
      }
    } finally {
      setIngesting(false)
    }
    if (boundId !== undefined) await hang(boundId)
  }
  const ingestBatchRef = useRef(ingestBatch)
  ingestBatchRef.current = ingestBatch

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
    /* v8 ignore next -- Modal mounts the file input before this upload-phase effect */
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
      const files = [...el.files ?? []]
      if (files.length === 0) {
        if (ignoreEmpty) return
        setError(t('error.emptyPick'))
        return
      }
      busy = true
      ignoreEmpty = true
      el.value = ''
      queueMicrotask(() => { busy = false })
      void ingestBatchRef.current(files)
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

  const title = phase === 'upload' ? t('picker.uploadTitle') : t('picker.title')
  return (
    <Modal
      open
      onClose={close}
      title={title}
      closeLabel={t('picker.close')}
      description={phase === 'upload' ? t('picker.uploadLead') : t('picker.summary')}
      {...css.dialog === undefined ? {} : { className: css.dialog }}
    >
      <div aria-describedby={error === undefined ? undefined : errorId}>
        {phase === 'list' ? (
          <>
            <details className={css.rules}>
              <summary>{t('picker.rulesToggle')}</summary>
              <p>{t('picker.leadAskData')}</p>
              <p>{t('picker.leadLibrary')}</p>
              <p>{t('picker.leadPreset')}</p>
              <p>{t('picker.leadDataMode')}</p>
              <p>{t('picker.leadThicken')}</p>
            </details>
            {loading
              ? (
                <div className={css.skeleton} aria-busy="true" aria-label={t('picker.loading')}>
                  <div className={css.skeletonBar} />
                  <div className={css.skeletonBar} />
                  <div className={css.skeletonBar} />
                </div>
              )
              : (
                <>
                  {rows.length === 0 && error === undefined
                    ? <p className={css.empty}>{t('picker.empty')}</p>
                    : null}
                  <div className={css.list}>
                    {rows.map(row => (
                      <div key={row.id} className={css.libraryRow}>
                        <button
                          type="button"
                          className={css.row}
                          aria-label={row.displayName}
                          onClick={() => { void hang(row.id) }}
                        >
                          <SourceIdentity
                            name={row.displayName}
                            badge={t('picker.typeLibrary')}
                            countTemplate={t('picker.documentCount')}
                            {...row.documentCount === undefined ? {} : { documentCount: row.documentCount }}
                          />
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
              )}
          </>
        ) : (
          <>
            {ingesting ? <p className={css.lead}>{t('ingest.applying')}</p> : null}
            {batch.length > 0 && (
              <ul className={css.batch}>
                {batch.map((entry, index) => (
                  <li
                    key={`${String(index)}-${entry.name}`}
                    className={entry.state === 'failed' ? css.batchFailed : undefined}
                  >
                    <BatchGlyph state={entry.state} />
                    <span>{entry.name}</span>
                    {' · '}
                    <span>{batchEntryText(entry, t)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className={css.list}>
              <div className={css.chooseFile} data-file-pick="library">
                {t('picker.chooseFile')}
                <input
                  id={fileInputId}
                  ref={fileInputRef}
                  className={css.fileInputOverlay}
                  type="file"
                  multiple
                  disabled={ingesting}
                />
              </div>
              <button type="button" className={css.row} disabled={ingesting} onClick={() => { void skipEmpty() }}>
                {t('picker.skipEmpty')}
              </button>
            </div>
          </>
        )}
        {error !== undefined && <p id={errorId} className={css.error} role="alert">{error}</p>}
      </div>
    </Modal>
  )
}
