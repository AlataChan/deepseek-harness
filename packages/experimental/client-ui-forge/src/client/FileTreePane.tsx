/** File selection within a local diff, separate from project navigation. */
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ForgeDiffFile } from '../types.ts'
import css from './FileTreePane.module.css'
/**
 * Render the ordered changed paths.
 * @param props - changed paths, current selection, and accessible region name.
 * @returns the local file selector.
 */
export function FileTreePane({ files, selected, onSelect, label }: {
  files: readonly ForgeDiffFile[]
  selected: string | undefined
  onSelect: (path: string) => void
  label: string
}) {
  return <nav aria-label={label} className={css.files}>{files.map(file => <Button size="sm" key={file.path} aria-pressed={file.path === selected} onClick={() => { onSelect(file.path) }}>{file.path}</Button>)}</nav>
}
