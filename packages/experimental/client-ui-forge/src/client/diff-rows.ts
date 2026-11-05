/** Unified hunk rows with old and new line numbers. */
import type { ForgeDiffHunk } from '../types.ts'
/** One visible hunk line. */
export interface DiffRow { readonly text: string; readonly kind: 'added' | 'deleted' | 'context'; readonly oldLine: number | null; readonly newLine: number | null }
/**
 * Preserve hunk line signs and number each side independently.
 * @param hunk - one Git hunk.
 * @returns rows in patch order.
 */
export function diffRows(hunk: ForgeDiffHunk): DiffRow[] {
  let oldLine = hunk.oldStart
  let newLine = hunk.newStart
  return hunk.lines.map((text) => {
    if (text.startsWith('+')) return { text, kind: 'added', oldLine: null, newLine: newLine++ }
    if (text.startsWith('-')) return { text, kind: 'deleted', oldLine: oldLine++, newLine: null }
    if (text.startsWith(' ')) return { text, kind: 'context', oldLine: oldLine++, newLine: newLine++ }
    return { text, kind: 'context', oldLine: null, newLine: null }
  })
}
