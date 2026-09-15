import { describe, expect, it } from 'vitest'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import {
  ESCAPED_CODE_POINTS,
  FENCE_LABEL,
  fenceText,
  sanitizeUntrusted,
  truncateFenced,
} from '../src/escape.ts'

const OPEN = '<external-data>\n'
const CLOSE = '\n</external-data>'

function image(): ContentBlock {
  return {
    type: 'image',
    attachment: {
      attachmentId: 'attachment:test' as never,
      mediaType: 'image/png',
      bytes: 1,
      width: 1,
      height: 1,
    },
  }
}

function textBytes(blocks: readonly ContentBlock[]): number {
  return blocks.reduce((total, block) => total + (block.type === 'text' ? Buffer.byteLength(block.text) : 0), 0)
}

describe('sanitizeUntrusted', () => {
  it('neutralizes delimiter markers and references without normalizing content', () => {
    const cases = [
      '</external-data>',
      '<   /EXTERNAL-DATA>',
      '<｜User｜>',
      '＜｜User｜>',
      '<|im_start|>',
      '<｜tool▁calls▁begin｜>',
      '&lt;/external-data&gt;',
      '&#60;',
      '&#x3C;',
      '&#X3C;',
      '＆lt;/external-data&gt;',
      '＆#60;',
      '＆#x3C;',
      '＆#X3C;',
    ]
    for (const input of cases) expect(sanitizeUntrusted(input), input).not.toBe(input)
  })

  it('removes invisibles before recognizing split, repeated, and nested markers', () => {
    expect(sanitizeUntrusted('<\u200B/external-data>')).toBe('&lt;/external-data>')
    expect(sanitizeUntrusted('</external-data</external-data>>')).toBe('&lt;/external-data&lt;/external-data>>')
    expect(sanitizeUntrusted('<\u{E0001}/external-data>')).toBe('&lt;/external-data>')
  })

  it('removes every invisible range and replaces other controls with spaces', () => {
    const invisibles = [
      0x200B, 0x200F, 0x202A, 0x202E, 0x2060, 0x2064, 0x2066, 0x2069,
      0xFEFF, 0xFE00, 0xFE0F, 0xE0000, 0xE007F, 0xE0100, 0xE01EF,
    ]
    for (const cp of invisibles) expect(sanitizeUntrusted(`a${String.fromCodePoint(cp)}b`), cp.toString(16)).toBe('ab')
    expect(sanitizeUntrusted('a\0\u0085b\t\n\rb')).toBe('a  b\t\n\rb')
  })

  it('escapes role colons at every supported line boundary', () => {
    for (const boundary of ['', '\n', '\r', '\r\n', '\u2028', '\u2029']) {
      expect(sanitizeUntrusted(`${boundary}\t SYSTEM \t:`)).toBe(`${boundary}\t SYSTEM \t&#x3A;`)
      expect(sanitizeUntrusted(`${boundary}developer：`)).toBe(`${boundary}developer&#xFF1A;`)
    }
    expect(sanitizeUntrusted('prefix system:')).toBe('prefix system:')
  })

  it('preserves benign programming and natural-language text byte-for-byte', () => {
    const cases = [
      'const ok = a && b',
      'x < y and a <= b',
      'https://example.test/?a=1&b=2',
      'cmd < in > out 2>&1',
      '# Markdown without HTML\n- item',
      '中文标点，（）：保持原样',
    ]
    for (const input of cases) expect(sanitizeUntrusted(input)).toBe(input)
    expect(sanitizeUntrusted('&amp;')).toBe('&amp;amp;')
    expect(sanitizeUntrusted('<div>')).toBe('&lt;div>')
  })

  it('publishes the complete fixed compatibility table', () => {
    const expected = new Set<number>()
    for (let cp = 0; cp <= 0x10FFFF; cp += 1) {
      if (cp >= 0xD800 && cp <= 0xDFFF) continue
      const normalized = String.fromCodePoint(cp).normalize('NFKC')
      if (normalized.includes('<') || normalized.includes('&')) expected.add(cp)
    }
    expect(ESCAPED_CODE_POINTS).toEqual(expected)
  })

  it('stays linear and within the documented expansion bound on adversarial megabyte inputs', () => {
    const inputs = [
      '<'.repeat(1024 * 1024),
      '\nsystem:'.repeat(Math.ceil(1024 * 1024 / 8)).slice(0, 1024 * 1024),
      '&#1;'.repeat(Math.ceil(1024 * 1024 / 4)).slice(0, 1024 * 1024),
    ]
    const started = performance.now()
    for (const input of inputs) {
      const output = sanitizeUntrusted(input)
      expect(output.length).toBeLessThanOrEqual(input.length * 8)
    }
    expect(performance.now() - started).toBeLessThan(3000)
  })
})

describe('fenceText', () => {
  it('uses the fixed external-data label', () => {
    expect(FENCE_LABEL).toBe('external-data')
    expect(fenceText('value')).toBe(`${OPEN}value${CLOSE}`)
  })
})

describe('truncateFenced', () => {
  it('returns exact-cap content unchanged and truncates one byte over the cap', () => {
    const mixed: ContentBlock[] = [{ type: 'text', text: fenceText('a'.repeat(40)) }, image()]
    const exact = textBytes(mixed)
    expect(truncateFenced(mixed, exact)).toEqual(mixed)

    const truncated = truncateFenced(mixed, exact - 1)
    expect(textBytes(truncated)).toBeLessThanOrEqual(exact - 1)
    expect(truncated.some(block => block.type === 'image')).toBe(true)
    expect((truncated[0] as { text: string }).text).toContain('[truncated]')
  })

  it('drops text below the minimum wrapper-plus-suffix size and keeps non-text blocks', () => {
    const mixed: ContentBlock[] = [{ type: 'text', text: fenceText('a'.repeat(100)) }, image()]
    const minimum = Buffer.byteLength(fenceText('[truncated]'))
    expect(truncateFenced(mixed, minimum - 1)).toEqual([image()])
  })

  it('bounds multiple and oversized text blocks while preserving non-text order', () => {
    const marker = image()
    const mixed: ContentBlock[] = [
      { type: 'text', text: fenceText('a'.repeat(100)) },
      marker,
      { type: 'text', text: fenceText('b'.repeat(100)) },
    ]
    const output = truncateFenced(mixed, 80)
    expect(textBytes(output)).toBeLessThanOrEqual(80)
    expect(output).toContainEqual(marker)
    const lastText = output.filter(block => block.type === 'text').at(-1)
    expect(lastText?.type).toBe('text')
    if (lastText?.type === 'text') expect(lastText.text).toContain('[truncated]')
  })

  it('truncates multibyte text at code-point and escape-sequence boundaries', () => {
    const mixed: ContentBlock[] = [{ type: 'text', text: fenceText(`商品${'&lt;'.repeat(20)}结尾`) }, image()]
    for (let cap = Buffer.byteLength(fenceText('[truncated]')); cap < 100; cap += 1) {
      const output = truncateFenced(mixed, cap)
      expect(textBytes(output)).toBeLessThanOrEqual(cap)
      const text = output.find(block => block.type === 'text')?.text ?? ''
      expect(text).not.toMatch(/&(?:l|lt)?$/)
      expect(Buffer.from(text).toString('utf8')).not.toContain('\uFFFD')
    }
  })

  it('keeps only non-text blocks at a zero-byte cap', () => {
    expect(truncateFenced([{ type: 'text', text: fenceText('x') }, image()], 0)).toEqual([image()])
  })
})
