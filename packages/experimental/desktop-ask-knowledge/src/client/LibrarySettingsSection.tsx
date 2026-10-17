import { useEffect, useRef, useState } from 'react'
import type { AskKnowledgeKey } from './locales.ts'
import { SourceIdentity } from './SourceIdentity.tsx'
import { DocumentList } from './DocumentList.tsx'
import type { DocumentStatusItem } from './DocumentStatus.tsx'
import css from './LibrarySettingsSection.module.css'

/** One catalog row on the management page. */
export interface SettingsLibrary {
  readonly id: string
  readonly displayName: string
  readonly documentCount?: number
}

/** Remotes the settings section needs. */
export interface LibrarySettingsRemotes {
  listLibraries: () => Promise<{ ok: boolean; value?: readonly SettingsLibrary[] }>
  removeLibrary: (libraryId: string) => Promise<{ ok: boolean; error?: { message?: string } }>
  listDocuments?: (libraryId: string) => Promise<{ ok: boolean; value?: readonly DocumentStatusItem[]; warning?: string }>
  addDocument?: (libraryId: string, file: File) => Promise<void>
  openOriginal?: (item: DocumentStatusItem) => Promise<void>
  viewText?: (item: DocumentStatusItem) => Promise<void>
  viewSources?: (item: DocumentStatusItem) => Promise<void>
  retryStage?: (item: DocumentStatusItem) => Promise<void>
  resumeExtraction?: (item: DocumentStatusItem) => Promise<void>
  cancelProcessing?: (item: DocumentStatusItem) => Promise<void>
  approveBudget?: (item: DocumentStatusItem) => Promise<void>
}

type DocumentLoadState =
  | { readonly state: 'ready'; readonly items: readonly DocumentStatusItem[]; readonly error?: string; readonly warning?: string }
  | { readonly state: 'failed'; readonly error?: string }

/** Injected remotes and locale. */
export interface LibrarySettingsSectionProps extends LibrarySettingsRemotes {
  t: (key: AskKnowledgeKey) => string
}

/**
 * Render the 我的知识库 settings section.
 * @param props - remotes and locale.
 * @returns the section.
 */
export function LibrarySettingsSection({
  listLibraries,
  removeLibrary,
  listDocuments,
  addDocument,
  openOriginal,
  viewText,
  viewSources,
  retryStage,
  resumeExtraction,
  cancelProcessing,
  approveBudget,
  t,
}: LibrarySettingsSectionProps) {
  const [rows, setRows] = useState<readonly SettingsLibrary[]>([])
  const [error, setError] = useState<string | undefined>()
  const [expandedLibraryId, setExpandedLibraryId] = useState<string | undefined>()
  const [docMap, setDocMap] = useState<Record<string, DocumentLoadState>>({})
  const [uploading, setUploading] = useState<string | undefined>()
  const [uploadMessage, setUploadMessage] = useState<string | undefined>()
  const uploadBusy = useRef(false)

  const mounted = useRef(true)
  const requestSequences = useRef(new Map<string, number>())
  const cancellations = useRef(new Set<string>())
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    let current = true
    void listLibraries().then((result) => {
      if (!current) return
      if (result.ok && result.value !== undefined) setRows(result.value)
      else setError(t('error.docsFailed'))
    }).catch((error: unknown) => { if (current) setError(error instanceof Error ? error.message : t('error.docsFailed')) })
    return () => { current = false }
  }, [listLibraries])

  const refreshDocuments = async (libraryId: string) => {
    if (!listDocuments || !mounted.current) return
    const sequence = (requestSequences.current.get(libraryId) ?? 0) + 1
    requestSequences.current.set(libraryId, sequence)
    const isCurrent = () => mounted.current && requestSequences.current.get(libraryId) === sequence
    try {
      const result = await listDocuments(libraryId)
      if (!isCurrent()) return
      if (!result.ok || !result.value) throw new Error(t('error.docsFailed'))
      setDocMap(current => ({ ...current, [libraryId]: { state: 'ready', items: result.value ?? [], ...result.warning === undefined ? {} : { warning: result.warning } } }))
    } catch (error) {
      if (!isCurrent()) return
      const message = error instanceof Error ? error.message : t('error.docsFailed')
      setDocMap(current => ({ ...current, [libraryId]: current[libraryId]?.state === 'ready'
        ? { ...current[libraryId], error: message } : { state: 'failed', error: message } }))
    }
  }
  useEffect(() => {
    if (!expandedLibraryId) return
    void refreshDocuments(expandedLibraryId)
    const timer = setInterval(() => { void refreshDocuments(expandedLibraryId) }, 1500)
    return () => { clearInterval(timer) }
  }, [expandedLibraryId, listDocuments])

  const toggleExpand = (id: string) => { setExpandedLibraryId(current => current === id ? undefined : id) }
  const operate = (action: ((item: DocumentStatusItem) => Promise<void>) | undefined, kind: 'other' | 'paid' | 'cancel' = 'other') => action === undefined ? undefined
    : async (item: DocumentStatusItem) => {
      setError(undefined)
      if (kind === 'cancel') cancellations.current.add(item.id)
      else if (kind === 'paid') cancellations.current.delete(item.id)
      try { await action(item) } catch (error) {
        if (kind === 'cancel') cancellations.current.delete(item.id)
        if (mounted.current && (kind === 'cancel' || !cancellations.current.has(item.id))) {
          setError(error instanceof Error ? error.message : t('error.docsFailed'))
        }
      }
      if (mounted.current && item.libraryId) await refreshDocuments(item.libraryId)
    }

  return (
    <section className={css.section}>
      <h2 className={css.title}>{t('settings.section')}</h2>
      <ul className={css.list}>
        {rows.map((row) => {
          const isExpanded = expandedLibraryId === row.id
          const documents = docMap[row.id]
          return (
            <li key={row.id} className={css.itemWrapper}>
              <div className={css.row}>
                <button
                  type="button"
                  className={css.toggle}
                  onClick={() => { toggleExpand(row.id) }}
                  aria-expanded={isExpanded}
                >
                  <SourceIdentity
                    name={row.displayName}
                    badge={t('picker.typeLibrary')}
                    countTemplate={t('picker.documentCount')}
                    {...row.documentCount === undefined ? {} : { documentCount: row.documentCount }}
                  />
                </button>
                <button
                  type="button"
                  className={css.remove}
                  disabled={uploading === row.id}
                  onClick={() => {
                    void removeLibrary(row.id).then((result) => {
                      if (result.ok) {
                        setError(undefined)
                        setRows(current => current.filter(item => item.id !== row.id))
                        return
                      }
                      setError(result.error?.message ?? t('settings.removeFailed'))
                    }).catch((error: unknown) => { if (mounted.current) setError(error instanceof Error ? error.message : t('settings.removeFailed')) })
                  }}
                >
                  {t('settings.remove')}
                </button>
              </div>
              {addDocument !== undefined && <label className={css.upload}>
                {uploading === row.id ? t('batchRunning') : t('settings.addDocuments')}
                <input
                  type="file"
                  multiple
                  aria-label={`${t('settings.addDocuments')}: ${row.displayName}`}
                  disabled={uploading !== undefined}
                  className={css.fileInput}
                  onChange={(event) => {
                    const files = Array.from(event.currentTarget.files ?? [])
                    event.currentTarget.value = ''
                    if (files.length === 0 || uploadBusy.current) return
                    uploadBusy.current = true
                    setUploading(row.id)
                    setExpandedLibraryId(row.id)
                    setError(undefined)
                    setUploadMessage(undefined)
                    void (async () => {
                      const failures: string[] = []
                      let added = 0
                      try {
                        for (const file of files) {
                          try { await addDocument(row.id, file); added += 1 } catch (error) {
                            failures.push(`${file.name}: ${error instanceof Error ? error.message : t('ingest.failed')}`)
                          }
                          if (!mounted.current) break
                          await refreshDocuments(row.id)
                        }
                        const result = await listLibraries()
                        if (mounted.current) {
                          if (result.ok && result.value !== undefined) setRows(result.value)
                          setUploadMessage(t('settings.addedDocuments').replace('{count}', String(added)))
                          if (failures.length > 0) setError(failures.join('\n'))
                        }
                      } catch (error) {
                        if (mounted.current) setError(error instanceof Error ? error.message : t('error.docsFailed'))
                      } finally {
                        uploadBusy.current = false
                        if (mounted.current) setUploading(undefined)
                      }
                    })()
                  }}
                />
              </label>}
              {isExpanded && listDocuments !== undefined && (
                <div className={css.details}>
                  {documents?.state === 'ready' && documents.warning && <p className={css.error} role="alert">{t('docs.migrationWarning').replace('{error}', documents.warning)}</p>}
                  {documents?.state === 'ready' ? <DocumentList
                    items={documents.items}
                    t={t}
                    onOpenOriginal={operate(openOriginal)}
                    onViewText={operate(viewText)}
                    onViewSources={operate(viewSources)}
                    onRetry={operate(retryStage, 'paid')}
                    onResume={operate(resumeExtraction, 'paid')}
                    onCancel={operate(cancelProcessing, 'cancel')}
                    onApproveBudget={operate(approveBudget, 'paid')}
                  /> : documents?.state !== 'failed' ? <p role="status">{t('docs.loading')}</p> : null}
                  {documents?.error && <p className={css.error} role="alert">{documents.error}</p>}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {uploadMessage !== undefined && <p role="status">{uploadMessage}</p>}
      {error !== undefined && <p className={css.error} role="alert">{error}</p>}
    </section>
  )
}
