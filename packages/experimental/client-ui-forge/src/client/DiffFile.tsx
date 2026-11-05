/** Read-only local unified diff; content is rendered as text. */
import type { ForgeDiffFile } from '../types.ts'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { diffRows } from './diff-rows.ts'
import css from './LocalReviewTab.module.css'
/**
 * Render one changed file without publication or comment actions.
 * @param props - bounded file hunks and localized copy.
 * @returns escaped text rows.
 */
export function DiffFile({ file, t }: { file: ForgeDiffFile } & PropsLocale<'worktree-review'>) {
  return <article aria-label={file.path} className={css.file}>
    <h3>{file.path} <span>+{file.additions} −{file.deletions}</span></h3>
    {file.binary ? <p>{t('binary')}</p> : file.oversized ? <p>{t('oversized')}</p> : file.hunks.map((hunk, index) => <pre key={index} className={css.patch}>
      {diffRows(hunk).map((row, line) => <span key={line} className={css[row.kind]}><span className={css.number}>{row.oldLine ?? ''}</span><span className={css.number}>{row.newLine ?? ''}</span>{row.text}{'\n'}</span>)}
    </pre>)}
  </article>
}
