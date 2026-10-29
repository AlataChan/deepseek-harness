/**
 * T0 Column width and grapheme measurement tests.
 * Asserts Intl.Segmenter cluster segmentation, string-width column counting,
 * line wrapping, and editing under 80-col and 40-col constraints.
 */

import { describe, expect, it } from 'vitest'
import {
  measureWidth,
  sanitizeUntrustedOutput,
  splitGraphemes,
  wrapTextToWidth,
} from '../src/render.ts'

describe('T0 column width and grapheme observation', () => {
  it('segments grapheme clusters correctly across mixed scripts', () => {
    // English
    expect(splitGraphemes('hello')).toEqual(['h', 'e', 'l', 'l', 'o'])

    // CJK and fullwidth punctuation
    expect(splitGraphemes('你好，世界！')).toEqual(['你', '好', '，', '世', '界', '！'])

    // Combining accent (e + acute accent combining mark \u0301)
    const accented = 'e\u0301'
    expect(splitGraphemes(accented)).toHaveLength(1)
    expect(splitGraphemes(`caf${accented}`)).toEqual(['c', 'a', 'f', accented])

    // Emoji with skin tone modifier
    const skinToneEmoji = '👍🏽'
    expect(splitGraphemes(skinToneEmoji)).toEqual([skinToneEmoji])

    // ZWJ family sequence
    const familyEmoji = '👨‍👩‍👧‍👦'
    expect(splitGraphemes(familyEmoji)).toEqual([familyEmoji])

    // Regional indicator flag
    const flagEmoji = '🇨🇳'
    expect(splitGraphemes(flagEmoji)).toEqual([flagEmoji])
  })

  it('measures terminal column width correctly', () => {
    // ASCII is 1 col per char
    expect(measureWidth('hello')).toBe(5)

    // CJK characters and fullwidth punctuation are 2 cols each (6 * 2 = 12)
    expect(measureWidth('你好，世界！')).toBe(12)

    // Emoji with modifier is 2 cols
    expect(measureWidth('👍🏽')).toBe(2)

    // Flag is 2 cols
    expect(measureWidth('🇨🇳')).toBe(2)

    // Family ZWJ is 2 cols on modern terminals
    expect(measureWidth('👨‍👩‍👧‍👦')).toBe(2)

    // Mixed sentence
    const mixed = 'Agent: 你好 👨‍👩‍👧‍👦 [OK]'
    // 'Agent: ' (7) + '你好 ' (5) + '👨‍👩‍👧‍👦 ' (3) + '[OK]' (4) = 19
    expect(measureWidth(mixed)).toBe(19)
  })

  it('wraps text cleanly at 80 and 40 column boundaries without breaking graphemes', () => {
    const text = 'DeepSeek Harness 终端交互前端 (TUI) 为 SSH/本地终端用户提供单用户、多轮、可恢复的交互式界面。'
    const wrapped80 = wrapTextToWidth(text, 80)
    for (const line of wrapped80) {
      expect(measureWidth(line)).toBeLessThanOrEqual(80)
    }

    const wrapped40 = wrapTextToWidth(text, 40)
    for (const line of wrapped40) {
      expect(measureWidth(line)).toBeLessThanOrEqual(40)
    }
    // Recombined graphemes must match original
    expect(wrapped40.join('')).toBe(text)
  })

  it('filters all ANSI, OSC, and control escape sequences', () => {
    // Malicious OSC 52 clipboard injection
    const osc52 = '\x1b]52;c;SGVsbG8=\x07Injected text'
    expect(sanitizeUntrustedOutput(osc52)).toBe('Injected text')

    // OSC 52 with ST terminator (\x1b\)
    const osc52St = '\x1b]52;c;SGVsbG8=\x1b\\Other text'
    expect(sanitizeUntrustedOutput(osc52St)).toBe('Other text')

    // OSC title change
    const titleInject = '\x1b]0;Evil Window Title\x07Visible Content'
    expect(sanitizeUntrustedOutput(titleInject)).toBe('Visible Content')

    // CSI cursor move and screen clear
    const csiInject = '\x1b[2J\x1b[H\x1b[10;20HClean Content\x1b[0m'
    expect(sanitizeUntrustedOutput(csiInject)).toBe('Clean Content')
  })
})
