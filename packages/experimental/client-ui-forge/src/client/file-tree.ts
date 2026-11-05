/** Stable ordering for checkout-relative changed paths. */
import type { ForgeDiffFile } from '../types.ts'
/**
 * Sort changed files without mutating the Host result.
 * @param files - complete bounded comparison.
 * @returns files ordered by path.
 */
export function orderedFiles(files: readonly ForgeDiffFile[]): ForgeDiffFile[] {
  return [...files].sort((a, b) => a.path.localeCompare(b.path))
}
