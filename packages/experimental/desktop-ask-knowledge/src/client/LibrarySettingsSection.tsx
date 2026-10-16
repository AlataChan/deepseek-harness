import { useEffect, useState } from 'react'
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
  listDocuments?: (libraryId: string) => Promise<{ ok: boolean; value?: readonly DocumentStatusItem[] }>
  openOriginal?: (item: DocumentStatusItem) => Promise<void>
  viewText?: (item: DocumentStatusItem) => Promise<void>
  viewSources?: (item: DocumentStatusItem) => Promise<void>
  retryStage?: (item: DocumentStatusItem) => Promise<void>
  resumeExtraction?: (item: DocumentStatusItem) => Promise<void>
  cancelProcessing?: (item: DocumentStatusItem) => Promise<void>
  approveBudget?: (item: DocumentStatusItem) => Promise<void>
}

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
  const [docMap, setDocMap] = useState<Record<string, readonly DocumentStatusItem[]>>({})

  useEffect(() => {
    void listLibraries().then((result) => {
      if (result.ok && result.value !== undefined) setRows(result.value)
    })
  }, [listLibraries])

  const refreshDocuments = async (libraryId: string) => {
    if (!listDocuments) return
    try {
      const result = await listDocuments(libraryId)
      if (!result.ok || !result.value) throw new Error(t('error.docsFailed'))
      setDocMap(current => ({ ...current, [libraryId]: result.value ?? [] }))
    } catch (error) { setError(error instanceof Error ? error.message : t('error.docsFailed')) }
  }
  useEffect(() => {
    if (!expandedLibraryId) return
    void refreshDocuments(expandedLibraryId)
    const timer = setInterval(() => { void refreshDocuments(expandedLibraryId) }, 1500)
    return () => clearInterval(timer)
  }, [expandedLibraryId, listDocuments])

  const toggleExpand = (id: string) => setExpandedLibraryId(current => current === id ? undefined : id)
  const operate = (action: ((item: DocumentStatusItem) => Promise<void>) | undefined) => action === undefined ? undefined
    : async (item: DocumentStatusItem) => {
      setError(undefined)
      try { await action(item) } catch (error) { setError(error instanceof Error ? error.message : t('error.docsFailed')) }
      if (item.libraryId) await refreshDocuments(item.libraryId)
    }

  return (
    <section className={css.section}>
      <h2 className={css.title}>{t('settings.section')}</h2>
      <ul className={css.list}>
        {rows.map((row) => {
          const isExpanded = expandedLibraryId === row.id
          const docs = docMap[row.id] ?? []
          return (
            <li key={row.id} className={css.itemWrapper}>
              <div className={css.row}>
                <button
                  type="button"
                  className={css.toggle}
                  onClick={() => toggleExpand(row.id)}
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
                  onClick={() => {
                    void removeLibrary(row.id).then((result) => {
                      if (result.ok) {
                        setError(undefined)
                        setRows(current => current.filter(item => item.id !== row.id))
                        return
                      }
                      setError(result.error?.message ?? t('settings.removeFailed'))
                    })
                  }}
                >
                  {t('settings.remove')}
                </button>
              </div>
              {isExpanded && listDocuments !== undefined && (
                <div className={css.details}>
                  <DocumentList
                    items={docs}
                    t={t}
                    onOpenOriginal={operate(openOriginal)}
                    onViewText={operate(viewText)}
                    onViewSources={operate(viewSources)}
                    onRetry={operate(retryStage)}
                    onResume={operate(resumeExtraction)}
                    onCancel={operate(cancelProcessing)}
                    onApproveBudget={operate(approveBudget)}
                  />
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {error !== undefined && <p className={css.error} role="alert">{error}</p>}
    </section>
  )
}
