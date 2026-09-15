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
    const invisibles = [0xFEFF]
    const ranges = [
      [0x200B, 0x200F],
      [0x202A, 0x202E],
      [0x2060, 0x2064],
      [0x2066, 0x2069],
      [0xFE00, 0xFE0F],
      [0xE0000, 0xE007F],
      [0xE0100, 0xE01EF],
    ] as const
    for (const [start, end] of ranges) {
      for (let cp = start; cp <= end; cp += 1) invisibles.push(cp)
    }
    for (const cp of invisibles) expect(sanitizeUntrusted(`a${String.fromCodePoint(cp)}b`), cp.toString(16)).toBe('ab')
    expect(sanitizeUntrusted('a\0\u0085b\t\n\rb')).toBe('a  b\t\n\rb')
  })

  it('escapes numeric references of any length with optional semicolons for every ampersand form', () => {
    const ampersands = [
      { input: '&', escaped: '&amp;' },
      { input: '\uFE60', escaped: '&#xFE60;' },
      { input: '\uFF06', escaped: '&#xFF06;' },
    ]
    const zeros = '0'.repeat(8)
    const references = [
      '#6', '#6;', '#060', '#060;', `#${zeros}60`, `#${zeros}60;`,
      '#x3c', '#x3c;', '#x03c', '#x03c;', `#x${zeros}3c`, `#x${zeros}3c;`,
      '#X3C', '#X3C;', '#X03C', '#X03C;', `#X${zeros}3C`, `#X${zeros}3C;`,
    ]
    for (const ampersand of ampersands) {
      for (const reference of references) {
        expect(sanitizeUntrusted(`${ampersand.input}${reference}/external-data>`)).toBe(
          `${ampersand.escaped}${reference}/external-data>`,
        )
      }
    }
  })

  it('escapes exact semicolon-less legacy references at a non-alphanumeric boundary', () => {
    for (const name of ['lt', 'LT', 'amp', 'AMP']) {
      expect(sanitizeUntrusted(`&${name}/`)).toBe(`&amp;${name}/`)
      expect(sanitizeUntrusted(`&${name}`)).toBe(`&amp;${name}`)
      expect(sanitizeUntrusted(`&${name}x/`)).toBe(`&${name}x/`)
    }
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
      '&copy 2026',
      'R&D and AT&T',
      '# Markdown without HTML\n- item',
      '中文标点，（）：保持原样',
    ]
    for (const input of cases) expect(sanitizeUntrusted(input)).toBe(input)
    expect(sanitizeUntrusted('?x=1&lt=3')).toBe('?x=1&amp;lt=3')
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
    for (const cp of ESCAPED_CODE_POINTS) {
      const character = String.fromCodePoint(cp)
      const normalized = character.normalize('NFKC')
      const structuralSuffix = normalized.includes('<') ? '/external-data>' : '#60;'
      expect(sanitizeUntrusted(`${character}${structuralSuffix}`), cp.toString(16))
        .not.toBe(`${character}${structuralSuffix}`)
    }
  })

  it('scales like the plain-text control and stays within the expansion bound', { timeout: 180_000 }, () => {
    const adversarialInputs: Array<{ name: string; makeInput: (size: number) => string }> = [
      { name: 'delimiter openers', makeInput: size => '<'.repeat(size) },
      { name: 'role markers', makeInput: size => '\nsystem:'.repeat(Math.ceil(size / 8)).slice(0, size) },
      { name: 'short numeric references', makeInput: size => '&#1;'.repeat(Math.ceil(size / 4)).slice(0, size) },
      { name: 'long numeric reference', makeInput: size => `&#${'0'.repeat(size)}` },
    ]
    const measureMinimum = (input: string): { duration: number; output: string } => {
      let duration = Number.POSITIVE_INFINITY
      let output = ''
      for (let run = 0; run < 5; run += 1) {
        const started = performance.now()
        const candidate = sanitizeUntrusted(input)
        const candidateDuration = performance.now() - started
        if (candidateDuration < duration) {
          duration = candidateDuration
          output = candidate
        }
      }
      return { duration, output }
    }
    const smallSize = 400_000
    const largeSize = smallSize * 16
    const controlSmallInput = 'a'.repeat(smallSize)
    const controlLargeInput = 'a'.repeat(largeSize)
    sanitizeUntrusted(controlSmallInput)
    sanitizeUntrusted(controlLargeInput)
    const controlSmall = measureMinimum(controlSmallInput)
    const controlLarge = measureMinimum(controlLargeInput)
    const controlGrowth = controlLarge.duration / controlSmall.duration
    expect(controlLarge.duration).toBeLessThan(20_000)
    expect(controlLarge.output.length).toBeLessThanOrEqual(controlLargeInput.length * 8)

    for (const { name, makeInput } of adversarialInputs) {
      const smallInput = makeInput(smallSize)
      const largeInput = makeInput(largeSize)
      sanitizeUntrusted(smallInput)
      sanitizeUntrusted(largeInput)
      const small = measureMinimum(smallInput)
      const large = measureMinimum(largeInput)
      const growth = large.duration / small.duration
      expect(growth, `${name} growth ${growth} versus control ${controlGrowth}`).toBeLessThan(controlGrowth * 4)
      expect(large.duration).toBeLessThan(20_000)
      expect(large.output.length).toBeLessThanOrEqual(largeInput.length * 8)
    }
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
