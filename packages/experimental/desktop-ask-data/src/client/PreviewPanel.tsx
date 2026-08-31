/**
 * Import preview: table counts, columns, and warnings. Commit lives on the page.
 */

import type { AskDataKey } from './locales.ts'
import css from './DataSourcePage.module.css'

/** One imported table as shown in preview. */
export interface PreviewTable {
  readonly name: string
  readonly rowCount: number
  readonly columns: readonly string[]
}

/** Preview panel props. */
export interface PreviewPanelProps {
  tables: readonly PreviewTable[]
  warnings: readonly string[]
  t: (key: AskDataKey) => string
  warningText: (id: string) => string
}

/**
 * Render preview tables and warning ids.
 * @param props - preview rows.
 * @returns the preview block.
 */
export function PreviewPanel({
  tables, warnings, t, warningText,
}: PreviewPanelProps) {
  return (
    <section className={css.section}>
      <p className={css.limits}>{t('previewLimits')}</p>
      <p className={css.helper}>
        {tables.length} {t('tables')}
      </p>
      <ul className={css.warnings}>
        {tables.map(table => (
          <li key={table.name}>
            {table.name} · {table.rowCount} {t('rows')} · {t('columns')} {table.columns.join(', ')}
          </li>
        ))}
      </ul>
      {warnings.length > 0 && (
        <ul className={css.warnings}>
          {warnings.map(id => (
            <li key={id}>{warningText(id)}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
