import { describe, expect, it } from 'vitest'
import { parseMarkdown } from '../src/transcript/markdown.ts'

const budget = { maxBytes: 10_000, maxColumns: 10_000 }

describe('terminal markdown subset', () => {
  it('projects headings, paragraphs, lists, fenced code, inline code, and links', () => {
    const blocks = parseMarkdown(`# Heading

Paragraph with \`code\` and [site](https://example.com).

- one
- two

\`\`\`ts
const value = 1
\`\`\`
`, budget)

    expect(blocks).toEqual([
      { kind: 'heading', level: 1, content: [{ kind: 'text', text: 'Heading' }] },
      {
        kind: 'paragraph',
        content: [
          { kind: 'text', text: 'Paragraph with ' },
          { kind: 'code', text: 'code' },
          { kind: 'text', text: ' and ' },
          { kind: 'link', label: 'site', url: 'https://example.com' },
          { kind: 'text', text: '.' },
        ],
      },
      { kind: 'list', items: [[{ kind: 'text', text: 'one' }], [{ kind: 'text', text: 'two' }]] },
      { kind: 'code', language: 'ts', text: 'const value = 1' },
    ])
  })

  it('keeps raw HTML and unsupported syntax visible without terminal hyperlinks', () => {
    const blocks = parseMarkdown('<b>raw</b> **strong** [x](\u001B]8;;bad\u0007)', budget)
    expect(blocks).toEqual([{
      kind: 'paragraph',
      content: [
        { kind: 'text', text: '<b>raw</b> **strong** ' },
        { kind: 'link', label: 'x', url: '␛]8;;bad␇' },
      ],
    }])
    expect(JSON.stringify(blocks)).not.toContain('\u001b')
  })

  it('handles empty fences, unterminated fences, paragraph stops, and all list markers', () => {
    expect(parseMarkdown('`code`', budget)).toEqual([
      { kind: 'paragraph', content: [{ kind: 'code', text: 'code' }] },
    ])
    expect(parseMarkdown('```\nbody', budget)).toEqual([
      { kind: 'code', language: undefined, text: 'body' },
    ])
    expect(parseMarkdown('one\ntwo\n## next\n* star\n+ plus\n\n', budget)).toEqual([
      { kind: 'paragraph', content: [{ kind: 'text', text: 'one two' }] },
      { kind: 'heading', level: 2, content: [{ kind: 'text', text: 'next' }] },
      { kind: 'list', items: [
        [{ kind: 'text', text: 'star' }],
        [{ kind: 'text', text: 'plus' }],
      ] },
    ])
  })
})
