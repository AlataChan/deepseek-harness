/**
 * First grapheme and a stable hue for a library avatar.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/client/library-initial
 */

const HUE_COUNT = 3

/**
 * First grapheme of a library name for the identity avatar.
 * @param displayName - catalog display name.
 * @returns one grapheme, or `?` when the name is empty.
 */
export function libraryInitial(displayName: string): string {
  const trimmed = displayName.trim()
  if (trimmed === '') return '?'
  /* v8 ignore start -- Node 22 and jsdom ship Intl.Segmenter */
  if (typeof Intl === 'undefined' || !('Segmenter' in Intl)) {
    return [...trimmed][0] ?? '?'
  }
  /* v8 ignore stop */
  const first = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed)][0]
  /* v8 ignore next -- Segmenter yields a grapheme for every non-empty string */
  return first?.segment ?? '?'
}

/**
 * Hue index 0..2 from the display name, for the three theme avatar fills.
 * @param displayName - catalog display name.
 * @returns 0, 1, or 2.
 */
export function libraryHueIndex(displayName: string): 0 | 1 | 2 {
  let hash = 0
  for (const unit of displayName) {
    const point = unit.codePointAt(0)
    /* v8 ignore next -- for-of string units always have a code point */
    if (point === undefined) continue
    hash = (hash + point) % HUE_COUNT
  }
  return hash as 0 | 1 | 2
}

/**
 * Replace `{count}` in a locale template.
 * @param template - dictionary value containing `{count}`.
 * @param count - ingested document count.
 * @returns the filled sentence.
 */
export function formatDocumentCount(template: string, count: number): string {
  return template.replace('{count}', String(count))
}
