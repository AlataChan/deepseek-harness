/** Terminal-safe display text construction. @module @deepseek-ai/dsh-tui/transcript/display-text */

import stringWidth from 'string-width'

declare const displayTextBrand: unique symbol

/** Text whose terminal control characters have been made inert. */
export type DisplayText = string & { readonly [displayTextBrand]: never }

/** Independent hard limits applied to one display value. */
export interface DisplayTextBudget {
  readonly maxBytes: number
  readonly maxColumns: number
}

const encoder = new TextEncoder()
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const ellipsis = '…'

function assertBudget(name: keyof DisplayTextBudget, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`display text ${name} must be a positive safe integer`)
  }
}

function codePointLabel(codePoint: number): string {
  return `⟦U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}⟧`
}

function isBidiControl(codePoint: number): boolean {
  return codePoint === 0x061C
    || codePoint === 0x200E
    || codePoint === 0x200F
    || (codePoint >= 0x202A && codePoint <= 0x202E)
    || (codePoint >= 0x2066 && codePoint <= 0x2069)
}

function sanitize(input: string): string {
  let output = ''
  for (const character of input.toWellFormed()) {
    const codePoint = character.codePointAt(0)
    if (codePoint === undefined) continue
    if (character === '\t') {
      output += '    '
    } else if (character === '\r') {
      output += '\n'
    } else if (character === '\n') {
      output += character
    } else if (codePoint <= 0x1F) {
      output += String.fromCodePoint(0x2400 + codePoint)
    } else if (codePoint === 0x7F) {
      output += '␡'
    } else if ((codePoint >= 0x80 && codePoint <= 0x9F) || isBidiControl(codePoint)) {
      output += codePointLabel(codePoint)
    } else {
      output += character
    }
  }
  return output
}

function fits(value: string, budget: DisplayTextBudget): boolean {
  return encoder.encode(value).byteLength <= budget.maxBytes
    && stringWidth(value) <= budget.maxColumns
}

function truncate(value: string, budget: DisplayTextBudget): string {
  if (fits(value, budget)) return value
  let output = ''
  for (const { segment } of segmenter.segment(value)) {
    if (!fits(output + segment + ellipsis, budget)) break
    output += segment
  }
  while (output !== '' && !fits(output + ellipsis, budget)) {
    const parts = [...segmenter.segment(output)]
    output = parts.slice(0, -1).map(part => part.segment).join('')
  }
  return fits(output + ellipsis, budget) ? output + ellipsis : ''
}

/**
 * Make arbitrary text inert and bound its terminal footprint.
 * @param input - untrusted text from a model, tool, durable log, or user.
 * @param budget - positive byte and terminal-column limits.
 * @returns sanitized text truncated only at grapheme boundaries.
 */
export function displayText(input: string, budget: DisplayTextBudget): DisplayText {
  assertBudget('maxBytes', budget.maxBytes)
  assertBudget('maxColumns', budget.maxColumns)
  return truncate(sanitize(input), budget) as DisplayText
}
