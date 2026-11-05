/** Summary of the currently displayed local comparison. */
import type { ForgeLocalDiff } from '../types.ts'
/**
 * Display additions and deletions for the selected comparison.
 * @param props - bounded diff and localized region label.
 * @returns file and line counts.
 */
export function LocalChangesCard({ diff, label }: { diff: ForgeLocalDiff; label: string }) {
  const additions = diff.files.reduce((sum, file) => sum + file.additions, 0)
  const deletions = diff.files.reduce((sum, file) => sum + file.deletions, 0)
  return <div aria-label={label}>{diff.files.length} · +{additions} −{deletions}</div>
}
