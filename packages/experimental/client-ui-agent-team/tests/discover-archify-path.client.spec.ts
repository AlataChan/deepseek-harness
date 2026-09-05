import { describe, expect, it } from 'vitest'
import { discoverArchifyPath, extractArchifyPath } from '../src/client/discoverArchifyPath.ts'

describe('extractArchifyPath', () => {
  it('reads the marker line and strips quotes', () => {
    expect(extractArchifyPath('ARCHIFY_HTML_PATH: /tmp/a.html')).toBe('/tmp/a.html')
    expect(extractArchifyPath('note\nARCHIFY_HTML_PATH: "/tmp/b.html"\n')).toBe('/tmp/b.html')
  })
})

describe('discoverArchifyPath', () => {
  it('returns null without a chat snapshot', () => {
    expect(discoverArchifyPath(undefined)).toBeNull()
  })

  it('ignores incomplete paths mid-stream', () => {
    expect(discoverArchifyPath({
      order: ['a1'],
      nodes: {
        get: () => ({
          kind: 'assistant',
          data: { blocks: [{ kind: 'text', text: 'ARCHIFY_HTML_PATH: /tmp/team-pipeli' }] },
        }),
      },
    })).toBeNull()
  })

  it('prefers the newest assistant node with a complete .html path', () => {
    const chat = {
      order: ['old', 'new'],
      nodes: {
        get(key: string) {
          if (key === 'old') {
            return {
              kind: 'assistant',
              data: { blocks: [{ kind: 'text', text: 'ARCHIFY_HTML_PATH: /old.html' }] },
            }
          }
          if (key === 'new') {
            return {
              kind: 'assistant',
              data: { blocks: [{ kind: 'text', text: 'ARCHIFY_HTML_PATH: /new.html' }] },
            }
          }
          return undefined
        },
      },
    }
    expect(discoverArchifyPath(chat)).toBe('/new.html')
  })

  it('reads turn-tail closing blocks', () => {
    expect(discoverArchifyPath({
      order: ['tail'],
      nodes: {
        get: () => ({
          kind: 'turn-tail',
          data: {
            closing: {
              blocks: [{ kind: 'text', text: 'ARCHIFY_HTML_PATH: notes/out.htm' }],
            },
          },
        }),
      },
    })).toBe('notes/out.htm')
  })
})
