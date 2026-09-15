/**
 * Pure external-data escaping and mixed-result bounding. Detection uses a
 * fixed compatibility table and never normalizes returned text.
 * @module @deepseek-ai/dsh-fence-policy/escape
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'

/** Fixed fence label shared by result wrappers and the prompt notice. */
export const FENCE_LABEL = 'external-data'

/**
 * Code points whose NFKC form contains `<` or `&`. This security table is
 * fixed for review and lookup; runtime input is never normalized.
 */
export const ESCAPED_CODE_POINTS: ReadonlySet<number> = new Set([
  0x0026,
  0x003C,
  0xFE60,
  0xFE64,
  0xFF06,
  0xFF1C,
])

const LESS_THAN_CODE_POINTS: ReadonlySet<number> = new Set([0x003C, 0xFE64, 0xFF1C])
const AMPERSAND_CODE_POINTS: ReadonlySet<number> = new Set([0x0026, 0xFE60, 0xFF06])
const ROLES: ReadonlySet<string> = new Set(['system', 'user', 'assistant', 'human', 'developer', 'tool'])
const OPEN = `<${FENCE_LABEL}>\n`
const CLOSE = `\n</${FENCE_LABEL}>`
const TRUNCATION_SUFFIX = '[truncated]'

interface ScannedCodePoint {
  readonly cp: number
  readonly index: number
  readonly next: number
}

function codePointAt(input: string, index: number): number {
  const cp = input.codePointAt(index)
  if (cp === undefined) throw new RangeError('code-point index is outside the string')
  return cp
}

function invisible(cp: number): boolean {
  return (cp >= 0x200B && cp <= 0x200F)
    || (cp >= 0x202A && cp <= 0x202E)
    || (cp >= 0x2060 && cp <= 0x2064)
    || (cp >= 0x2066 && cp <= 0x2069)
    || cp === 0xFEFF
    || (cp >= 0xFE00 && cp <= 0xFE0F)
    || (cp >= 0xE0000 && cp <= 0xE007F)
    || (cp >= 0xE0100 && cp <= 0xE01EF)
}

function control(cp: number): boolean {
  return (cp <= 0x1F && cp !== 0x09 && cp !== 0x0A && cp !== 0x0D)
    || (cp >= 0x7F && cp <= 0x9F)
}

function nextVisible(input: string, from: number): ScannedCodePoint | undefined {
  let index = from
  while (index < input.length) {
    const original = codePointAt(input, index)
    const next = index + (original > 0xFFFF ? 2 : 1)
    if (invisible(original)) {
      index = next
      continue
    }
    return { cp: control(original) ? 0x20 : original, index, next }
  }
  return undefined
}

function delimiterFollows(input: string, from: number): boolean {
  let scanned = nextVisible(input, from)
  if (scanned === undefined) return false
  if ((scanned.cp >= 0x41 && scanned.cp <= 0x5A)
    || (scanned.cp >= 0x61 && scanned.cp <= 0x7A)
    || scanned.cp === 0x21
    || scanned.cp === 0x3F
    || scanned.cp === 0x7C
    || scanned.cp === 0xFF5C) return true
  let spaces = 0
  while (scanned !== undefined && (scanned.cp === 0x20 || scanned.cp === 0x09)) {
    spaces += 1
    if (spaces > 16) return false
    scanned = nextVisible(input, scanned.next)
  }
  return scanned?.cp === 0x2F
}

function characterReferenceFollows(input: string, from: number): boolean {
  let scanned = nextVisible(input, from)
  if (scanned === undefined) return false
  if (scanned.cp === 0x23) {
    scanned = nextVisible(input, scanned.next)
    if (scanned === undefined) return false
    let maximum = 7
    let digit = (cp: number): boolean => cp >= 0x30 && cp <= 0x39
    if (scanned.cp === 0x78 || scanned.cp === 0x58) {
      maximum = 6
      digit = cp => (cp >= 0x30 && cp <= 0x39)
        || (cp >= 0x41 && cp <= 0x46)
        || (cp >= 0x61 && cp <= 0x66)
      scanned = nextVisible(input, scanned.next)
    }
    let count = 0
    while (scanned !== undefined && digit(scanned.cp) && count < maximum) {
      count += 1
      scanned = nextVisible(input, scanned.next)
    }
    return count > 0 && scanned?.cp === 0x3B
  }
  const letter = (cp: number): boolean => (cp >= 0x41 && cp <= 0x5A) || (cp >= 0x61 && cp <= 0x7A)
  const alphanumeric = (cp: number): boolean => letter(cp) || (cp >= 0x30 && cp <= 0x39)
  if (!letter(scanned.cp)) return false
  let count = 0
  while (scanned !== undefined && alphanumeric(scanned.cp) && count < 32) {
    count += 1
    scanned = nextVisible(input, scanned.next)
  }
  return count <= 32 && scanned?.cp === 0x3B
}

function roleColonAt(input: string, from: number): number | undefined {
  let scanned = nextVisible(input, from)
  let spaces = 0
  while (scanned !== undefined && (scanned.cp === 0x20 || scanned.cp === 0x09)) {
    spaces += 1
    if (spaces > 16) return undefined
    scanned = nextVisible(input, scanned.next)
  }
  let role = ''
  while (scanned !== undefined
    && ((scanned.cp >= 0x41 && scanned.cp <= 0x5A) || (scanned.cp >= 0x61 && scanned.cp <= 0x7A))) {
    role += String.fromCodePoint(scanned.cp).toLowerCase()
    if (role.length > 9) return undefined
    scanned = nextVisible(input, scanned.next)
  }
  if (!ROLES.has(role)) return undefined
  spaces = 0
  while (scanned !== undefined && (scanned.cp === 0x20 || scanned.cp === 0x09)) {
    spaces += 1
    if (spaces > 16) return undefined
    scanned = nextVisible(input, scanned.next)
  }
  return scanned !== undefined && (scanned.cp === 0x3A || scanned.cp === 0xFF1A)
    ? scanned.index
    : undefined
}

function hexadecimalReference(cp: number): string {
  return `&#x${cp.toString(16).toUpperCase()};`
}

/**
 * Remove invisible controls and neutralize structural prompt delimiters while
 * retaining ordinary code, URLs, shell syntax, and natural-language text.
 * @param input - untrusted tool-result text.
 * @returns escaped text without Unicode normalization.
 */
export function sanitizeUntrusted(input: string): string {
  const output: string[] = []
  let roleColon = roleColonAt(input, 0)
  let index = 0
  while (index < input.length) {
    const cp = codePointAt(input, index)
    const next = index + (cp > 0xFFFF ? 2 : 1)
    if (invisible(cp)) {
      index = next
      continue
    }
    if (index === roleColon) {
      output.push(cp === 0x3A ? '&#x3A;' : '&#xFF1A;')
    } else if (control(cp)) {
      output.push(' ')
    } else if (LESS_THAN_CODE_POINTS.has(cp) && delimiterFollows(input, next)) {
      output.push(cp === 0x3C ? '&lt;' : hexadecimalReference(cp))
    } else if (AMPERSAND_CODE_POINTS.has(cp) && characterReferenceFollows(input, next)) {
      output.push(cp === 0x26 ? '&amp;' : hexadecimalReference(cp))
    } else {
      output.push(String.fromCodePoint(cp))
    }
    if (cp === 0x0A || cp === 0x0D || cp === 0x2028 || cp === 0x2029) {
      roleColon = roleColonAt(input, next)
    }
    index = next
  }
  return output.join('')
}

/**
 * Wrap one text block in the stable external-data delimiter.
 * @param text - already-sanitized external text.
 * @returns the complete fenced text.
 */
export function fenceText(text: string): string {
  return `${OPEN}${text}${CLOSE}`
}

function fencedBody(text: string): string {
  if (!text.startsWith(OPEN) || !text.endsWith(CLOSE)) {
    throw new TypeError('truncateFenced requires text blocks produced by fenceText()')
  }
  return text.slice(OPEN.length, -CLOSE.length)
}

function escapedTokenAt(text: string, index: number): string | undefined {
  if (text[index] !== '&') return undefined
  const match = /^(?:&amp;|&lt;|&#x[0-9A-F]{1,6};)/.exec(text.slice(index))
  return match?.[0]
}

function prefixWithinBytes(text: string, maximum: number): string {
  let bytes = 0
  let index = 0
  while (index < text.length) {
    const escape = escapedTokenAt(text, index)
    const token = escape ?? String.fromCodePoint(codePointAt(text, index))
    const size = Buffer.byteLength(token, 'utf8')
    if (bytes + size > maximum) break
    bytes += size
    index += token.length
  }
  return text.slice(0, index)
}

function truncatedText(text: string, maximum: number): string {
  const fixedBytes = Buffer.byteLength(fenceText(TRUNCATION_SUFFIX), 'utf8')
  const bodyBytes = maximum - fixedBytes
  const prefix = prefixWithinBytes(fencedBody(text), bodyBytes)
  return fenceText(`${prefix}${TRUNCATION_SUFFIX}`)
}

/**
 * Bound the aggregate UTF-8 bytes of already-fenced text blocks while leaving
 * every non-text block in its original relative position.
 * @param blocks - result blocks whose text members came from {@link fenceText}.
 * @param maxTextBytes - aggregate byte cap for emitted text blocks.
 * @returns bounded blocks; text is dropped when a marked fence cannot fit.
 */
export function truncateFenced(blocks: readonly ContentBlock[], maxTextBytes: number): ContentBlock[] {
  if (!Number.isInteger(maxTextBytes) || maxTextBytes < 0) {
    throw new TypeError('maxTextBytes must be a non-negative integer')
  }
  const total = blocks.reduce(
    (bytes, block) => bytes + (block.type === 'text' ? Buffer.byteLength(block.text, 'utf8') : 0),
    0,
  )
  if (total <= maxTextBytes) return [...blocks]
  const minimum = Buffer.byteLength(fenceText(TRUNCATION_SUFFIX), 'utf8')
  if (maxTextBytes < minimum) return blocks.filter(block => block.type !== 'text')

  const remainingTextBytes = Array<number>(blocks.length + 1).fill(0)
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks.at(index)
    const later = remainingTextBytes.at(index + 1)
    if (block === undefined || later === undefined) throw new RangeError('invalid result block index')
    remainingTextBytes[index] = later
      + (block.type === 'text' ? Buffer.byteLength(block.text, 'utf8') : 0)
  }

  const output: ContentBlock[] = []
  let remaining = maxTextBytes
  let truncated = false
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks.at(index)
    if (block === undefined) throw new RangeError('invalid result block index')
    if (block.type !== 'text') {
      output.push(block)
      continue
    }
    if (truncated) continue
    const size = Buffer.byteLength(block.text, 'utf8')
    const later = remainingTextBytes.at(index + 1)
    if (later === undefined) throw new RangeError('invalid remaining-byte index')
    if (size <= remaining && later <= remaining - size) {
      output.push(block)
      remaining -= size
      continue
    }
    if (size <= remaining && remaining - size >= minimum) {
      output.push(block)
      remaining -= size
      continue
    }
    output.push({ type: 'text', text: truncatedText(block.text, remaining) })
    truncated = true
  }
  return output
}
