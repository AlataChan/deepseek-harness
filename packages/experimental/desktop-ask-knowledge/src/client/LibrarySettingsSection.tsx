/**
 * Settings page: 我的知识库. Manage rows; do not ask from here.
 */

import { useEffect, useState } from 'react'
import type { AskKnowledgeKey } from './locales.ts'
import { SourceIdentity } from './SourceIdentity.tsx'
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
export function LibrarySettingsSection({ listLibraries, removeLibrary, t }: LibrarySettingsSectionProps) {
  const [rows, setRows] = useState<readonly SettingsLibrary[]>([])
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    void listLibraries().then((result) => {
      if (result.ok && result.value !== undefined) setRows(result.value)
    })
  }, [listLibraries])

  return (
    <section className={css.section}>
      <h2 className={css.title}>{t('settings.section')}</h2>
      <ul className={css.list}>
        {rows.map(row => (
          <li key={row.id} className={css.row}>
            <SourceIdentity
              name={row.displayName}
              badge={t('picker.typeLibrary')}
              documentCount={row.documentCount}
              countTemplate={t('picker.documentCount')}
            />
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
          </li>
        ))}
      </ul>
      {error !== undefined && <p className={css.error} role="alert">{error}</p>}
    </section>
  )
}
