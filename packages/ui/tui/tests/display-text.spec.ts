import { describe, expect, it } from 'vitest'
import { displayText, type DisplayText } from '../src/transcript/display-text.ts'

const generous = { maxBytes: 10_000, maxColumns: 10_000 }

function raw(value: DisplayText): string {
  return value as string
}

describe('terminal display text', () => {
  it('makes title, hyperlink, erase, and cursor-control payloads inert', () => {
    const input = '\u001B]0;owned\u0007title'
      + '\u001B]8;;https://example.com\u0007link\u001B]8;;\u0007'
      + '\u001B[2K\u001B[4A'
    const value = raw(displayText(input, generous))
    expect(value).not.toMatch(/[\u001B\u0007]/u)
    expect(value).toContain('␛]0;owned␇')
    expect(value).toContain('␛[2K␛[4A')
  })

  it('normalizes controls, bidi marks, tabs, newlines, and malformed surrogates', () => {
    const value = raw(displayText('a\t\r\nb\u0000\u0085\u202E\uD800', generous))
    expect(value).toBe('a    \n\nb␀⟦U+0085⟧⟦U+202E⟧�')
  })

  it('truncates on grapheme boundaries under byte and column budgets', () => {
    const family = '👨‍👩‍👧‍👦'
    expect(raw(displayText(`A${family}BC`, { maxBytes: 100, maxColumns: 4 })))
      .toBe(`A${family}…`)

    const byteBudget = new TextEncoder().encode(`A${family}…`).byteLength
    expect(raw(displayText(`A${family}BCDE`, { maxBytes: byteBudget, maxColumns: 100 })))
      .toBe(`A${family}…`)
  })

  it('rejects non-positive byte and column budgets', () => {
    expect(() => displayText('x', { maxBytes: 0, maxColumns: 1 })).toThrow(/maxBytes/)
    expect(() => displayText('x', { maxBytes: 1, maxColumns: 0 })).toThrow(/maxColumns/)
  })
})
