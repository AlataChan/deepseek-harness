/**
 * Settings page: 我的知识库. Manage rows; do not ask from here.
 */

import { useEffect, useState } from 'react'
import type { AskKnowledgeKey } from './locales.ts'

/** One catalog row on the management page. */
export interface SettingsLibrary {
  readonly id: string
  readonly displayName: string
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
    <section>
      <h2>{t('settings.section')}</h2>
      <ul>
        {rows.map(row => (
          <li key={row.id}>
            <span>{row.displayName}</span>
            <button
              type="button"
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
      {error !== undefined && <p>{error}</p>}
    </section>
  )
}
