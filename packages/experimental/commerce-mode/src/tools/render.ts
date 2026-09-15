/** Bounded model rendering for commerce Provider values. */

import { fenceText, sanitizeUntrusted } from '@deepseek-ai/dsh-fence-policy'

/** Stable suffix used when a commerce render reaches its configured character cap. */
export const COMMERCE_TRUNCATION_SUFFIX = '\n[truncated]'

/** Smallest cap that can retain both fence markers and the truncation suffix. */
export const MIN_RESULT_CHARS = fenceText(COMMERCE_TRUNCATION_SUFFIX).length

function entityLengthAt(text: string, index: number): number {
  if (text[index] !== '&') return 0
  const semicolon = text.indexOf(';', index + 1)
  if (semicolon < 0 || semicolon - index > 16) return 0
  const candidate = text.slice(index, semicolon + 1)
  return /^&(?:amp|lt|#x[0-9a-f]+);$/i.test(candidate) ? candidate.length : 0
}

/** Fence sanitized Provider text within a complete character budget. */
export function renderCommerceText(text: string, maxResultChars: number): string {
  const sanitized = sanitizeUntrusted(text)
  const complete = fenceText(sanitized)
  if (complete.length <= maxResultChars) return complete
  const prefix = '<external-data>\n'
  const suffix = `${COMMERCE_TRUNCATION_SUFFIX}\n</external-data>`
  let available = maxResultChars - prefix.length - suffix.length
  let end = 0
  while (end < sanitized.length && available > 0) {
    const entityLength = entityLengthAt(sanitized, end)
    const codePoint = sanitized.codePointAt(end)
    if (codePoint === undefined) break
    const width = entityLength > 0 ? entityLength : codePoint > 0xFFFF ? 2 : 1
    if (width > available) break
    end += width
    available -= width
  }
  return `${prefix}${sanitized.slice(0, end)}${suffix}`
}
