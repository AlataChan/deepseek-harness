/**
 * General Settings row that opens the desktop workspace-folder panel.
 */

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import css from './WorkspaceFolderRow.module.css'

/** Full Settings-row props. */
export type WorkspaceFolderRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'desktop-ask-data'>

/**
 * Open the hidden desktop settings control, if the shell mounted one.
 */
function openDesktopSettings(): void {
  document.querySelector<HTMLButtonElement>('[data-testid="desktop-settings-open"]')?.click()
}

/**
 * Render the workspace-folder row.
 * @param props - locale seat.
 * @returns the preference row.
 */
export function WorkspaceFolderRow({ t }: WorkspaceFolderRowProps) {
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('workspaceFolder.title')}</div>
        <div className={css.desc}>{t('workspaceFolder.desc')}</div>
      </div>
      <button type="button" className={css.open} onClick={openDesktopSettings}>
        {t('workspaceFolder.open')}
      </button>
    </div>
  )
}
