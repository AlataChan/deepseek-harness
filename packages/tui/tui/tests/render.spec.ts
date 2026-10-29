import { describe, expect, it } from 'vitest'
import { Terminal } from '@xterm/headless'
import {
  clipToWidth,
  layoutDraftWithCursor,
  MAX_SCROLLBACK_LINE_LENGTH,
  measureWidth,
  renderToolCallView,
  renderToolResultView,
  sanitizeUntrustedOutput,
  splitGraphemes,
  TerminalRenderer,
  wrapTextToWidth,
} from '../src/render.ts'
import { getLocale } from '../src/locales.ts'
import { TestWriteStream } from './fixtures.ts'

describe('Terminal Render & Formatting', () => {
  it('correctly formats and sanitizes all standard ToolCallView variants', () => {
    // 1. Generic card
    const generic = renderToolCallView({
      card: 'generic',
      title: 'calculate_sum',
      rawInput: { a: 1, b: 2 },
    })
    expect(generic).toContain('⚙ calculate_sum')
    expect(generic).toContain('[{"a":1,"b":2}]')

    // 2. Terminal card
    const term = renderToolCallView({
      card: 'terminal',
      title: 'pnpm test',
      description: 'Run unit test suite',
      cwd: '/workspace/app',
    })
    expect(term).toContain('▶ $ pnpm test')
    expect(term).toContain('(Run unit test suite)')
    expect(term).toContain('[cwd: /workspace/app]')

    // 3. Diff card
    const diff = renderToolCallView({
      card: 'diff',
      title: 'apply_patch',
      diffs: [
        { path: 'src/index.ts', oldText: null, newText: '...' },
        { path: 'src/types.ts', oldText: null, newText: '...' },
      ],
    })
    expect(diff).toContain('✎ apply_patch: src/index.ts, src/types.ts')
  })

  it('correctly formats and sanitizes all standard ToolResultView variants', () => {
    // 1. Generic result
    const genericRes = renderToolResultView({
      card: 'generic',
      title: 'Calculation completed',
    })
    expect(genericRes).toBe('✔ Calculation completed')

    // 2. Terminal result (success and non-zero exit)
    const termSuccess = renderToolResultView({
      card: 'terminal',
      title: 'Build command',
      exitCode: 0,
      output: 'Build succeeded in 2.1s',
    })
    expect(termSuccess).toContain('✔ Build command (exit 0)')
    expect(termSuccess).toContain('Build succeeded in 2.1s')

    const termKilled = renderToolResultView({
      card: 'terminal',
      title: 'Long task',
      signal: 'SIGTERM',
    })
    expect(termKilled).toContain('(killed by SIGTERM)')

    // 3. Diff result
    const diffRes = renderToolResultView({
      card: 'diff',
      title: 'Changes committed',
      diffs: [
        { path: 'pkg/a.ts', oldText: null, newText: 'a' },
        { path: 'pkg/b.ts', oldText: null, newText: 'b' },
      ],
    })
    expect(diffRes).toContain('✔ Changes committed: pkg/a.ts, pkg/b.ts')

    // 4. Search result (matches and truncation)
    const searchRes = renderToolResultView({
      card: 'search',
      shape: 'matches',
      title: 'grep in codebase',
      total: 42,
      truncated: true,
      files: [],
    })
    expect(searchRes).toBe('✔ grep in codebase (truncated, total: 42)')

    // 5. Read result
    const readRes = renderToolResultView({
      card: 'read',
      path: 'README.md',
      offset: 1,
      lines: [
        { number: 1, text: '# Title' },
        { number: 2, text: 'Hello' },
      ],
      totalLines: 100,
    })
    expect(readRes).toBe('✔ Read README.md (2/100 lines)')

    // 6. Web result
    const webRes = renderToolResultView({
      card: 'web',
      kind: 'fetch',
      title: 'Search results for vitest',
      url: 'https://vitest.dev',
      statusCode: 200,
      truncated: false,
    })
    expect(webRes).toBe('✔ Search results for vitest')
  })

  it('enforces scrollback buffer limits and discards oldest lines', () => {
    const maxLines = 10
    const renderer = new TerminalRenderer(maxLines)

    for (let i = 0; i < 25; i++) {
      renderer.appendLine(`Line ${i}`, 'system')
    }

    const lines = renderer.getLines()
    expect(lines.length).toBe(10)
    expect(lines[0]!.text).toBe('Line 15')
    expect(lines[9]!.text).toBe('Line 24')

    renderer.clear()
    expect(renderer.getLines().length).toBe(0)
  })

  it('sanitizes dangerous escape sequences in tool output and render lines', () => {
    // OSC 52 clipboard injection
    const osc52 = 'Normal text\x1b]52;c;c2VjcmV0\x07More text'
    const cleanOsc = sanitizeUntrustedOutput(osc52)
    expect(cleanOsc).toBe('Normal textMore text')
    expect(cleanOsc).not.toContain('52;c;')

    // CSI cursor movement / screen clear codes
    const csiEscape = 'Line\x1b[2J\x1b[HOverwritten'
    const cleanCsi = sanitizeUntrustedOutput(csiEscape)
    expect(cleanCsi).toBe('LineOverwritten')
    expect(cleanCsi).not.toContain('\x1b[2J')
  })

  it('supports localized status strings and word-wrapping', () => {
    const zh = getLocale('zh')
    const en = getLocale('en')

    expect(zh.statusIdle).toBe('空闲')
    expect(en.statusIdle).toBe('IDLE')
    expect(zh.statusRunning).toBe('运行中...')
    expect(en.statusRunning).toBe('RUNNING...')

    // Word wrap
    const wrapped = wrapTextToWidth('The quick brown fox jumps over the lazy dog', 20)
    expect(wrapped.length).toBeGreaterThanOrEqual(3)
    for (const w of wrapped) {
      expect(measureWidth(w)).toBeLessThanOrEqual(20)
    }
  })

  it('renders streaming text deltas and bounds output to narrow columns (40 cols)', () => {
    const fakeStdout = new TestWriteStream({ columns: 40, rows: 24 })
    const renderer = new TerminalRenderer(100, fakeStdout)
    const dict = getLocale('en')

    renderer.render({
      sessionId: 'test-sess-12345',
      workspace: '/workspace',
      model: 'deepseek-chat',
      status: 'running',
      draft: '',
      cursorGraphemeIndex: 0,
      streamingText: 'Thinking about the quantum properties of photons...',
    }, dict)

    expect(fakeStdout.captured).toContain('▍ Thinking about the quantum')
    expect(fakeStdout.captured).toContain('\x1b[1;1H') // Row 1 explicit positioning
    expect(fakeStdout.captured).not.toContain('\x1b[25;1H') // Does not scroll beyond row 24
  })

  it('calculates multiline cursor row and column offsets accurately', () => {
    const fakeStdout = new TestWriteStream({ columns: 80, rows: 24 })
    const renderer = new TerminalRenderer(100, fakeStdout)
    const dict = getLocale('en')

    // Draft: 3 lines, cursor at line 2 offset 5 ('hello\nworld\nfoo', cursor at 'hello\nwo' -> index 8)
    const draft = 'hello\nworld\nfoo'
    renderer.render({
      sessionId: 'test-sess-cursor',
      workspace: '/workspace',
      model: 'deepseek-chat',
      status: 'idle',
      draft,
      cursorGraphemeIndex: 8, // 'hello\nwo' (line 2, col 3 after prefix)
    }, dict)

    // Cursor positioning code at the end of the frame: \x1b[row;colH
    const cursorMatch = fakeStdout.captured.match(/\x1b\[(\d+);(\d+)H$/)
    expect(cursorMatch).not.toBeNull()
    const row = parseInt(cursorMatch![1]!, 10)
    const col = parseInt(cursorMatch![2]!, 10)

    // Row should be within valid terminal bounds (1..24)
    expect(row).toBeGreaterThan(15)
    expect(row).toBeLessThanOrEqual(24)
    // Prefix '...  ' (5 cols) + 'wo' (2 cols) + 1 = 8
    expect(col).toBe(8)
  })

  it('strips C0 (CR, BS), C1 (0x80-0x9F), 8-bit CSI, and OSC controls from untrusted text', () => {
    const malicious = 'Hello\rWorld\x08Test\x1b[31mRed\x9b2J\u0084Evil\x1b]52;c;secret\x07End'
    const sanitized = sanitizeUntrustedOutput(malicious)

    expect(sanitized).not.toContain('\r')
    expect(sanitized).not.toContain('\x08')
    expect(sanitized).not.toContain('\x9b')
    expect(sanitized).not.toContain('\u0084')
    expect(sanitized).not.toContain('\x1b]52')
    expect(sanitized).toBe('Hello\nWorldTestRedEvilEnd')
  })

  it('clips header text accurately to maxWidth using grapheme column widths without UTF-16 split', () => {
    const mixed = '状态: [运行中] 提示词: 你好世界！'
    // '状态: [运行中] ' = 2+2+1+1+2+2+1+1 = 12
    const clipped10 = clipToWidth(mixed, 10)
    expect(measureWidth(clipped10)).toBeLessThanOrEqual(10)

    const cjkBoundary = '一二三四五' // each is width 2, total 10
    expect(measureWidth(clipToWidth(cjkBoundary, 5))).toBe(4) // 2 chars (4 cols), 3rd would be 6 > 5
    expect(clipToWidth(cjkBoundary, 5)).toBe('一二')
  })

  it('derives cursor-visible input viewport and exact coordinates for mid-draft and boundary CJK cases', () => {
    // 1. Exact wrap with CJK wide character at wrap boundary:
    // maxWidth = 10, prefix = 'dsh> ' (5 cols)
    // remaining columns = 5.
    // 'aa' (2 cols) + '中' (2 cols) = 4 cols left -> 9 cols total.
    // Next '文' (2 cols) -> 9 + 2 = 11 > 10, so it MUST wrap to next line!
    const cjkDraft = 'aa中文'
    const cjkLayout = layoutDraftWithCursor(cjkDraft, splitGraphemes(cjkDraft).length, 10)
    expect(cjkLayout.visualLines.length).toBe(2)
    expect(cjkLayout.visualLines[0]).toBe('dsh> aa中')
    expect(cjkLayout.visualLines[1]).toBe('文')
    expect(cjkLayout.cursorVisualRow).toBe(1)
    expect(cjkLayout.cursorVisualCol).toBe(3) // '文' (2 cols) + 1 = 3

    // 2. Overflowing draft with cursor in the middle:
    // 10 lines of draft, cursor at line 3
    const multilineDraft = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n')
    // Cursor at start of line 3
    const line3Offset = splitGraphemes(Array.from({ length: 3 }, (_, i) => `line ${i}`).join('\n') + '\n').length
    const layout = layoutDraftWithCursor(multilineDraft, line3Offset, 80)
    expect(layout.cursorVisualRow).toBe(3)

    // Render with 15 rows (maxDraftLines = floor(15/3) = 5)
    const fakeStdout = new TestWriteStream({ columns: 40, rows: 15 })
    const renderer = new TerminalRenderer(100, fakeStdout)
    renderer.render({
      sessionId: 'sess-view',
      workspace: '/w',
      model: 'm',
      status: 'idle',
      draft: multilineDraft,
      cursorGraphemeIndex: line3Offset,
    }, getLocale('en'))

    // Hardware cursor must be positioned within the terminal rows (<= 15)
    const cursorMatch = fakeStdout.captured.match(/\x1b\[(\d+);(\d+)H$/)
    expect(cursorMatch).not.toBeNull()
    const row = parseInt(cursorMatch![1]!, 10)
    expect(row).toBeLessThanOrEqual(15)
    expect(row).toBeGreaterThanOrEqual(5)
  })

  it('renders into small terminals (15x8) without clamping dimensions or writing out of bounds', () => {
    const fakeStdout = new TestWriteStream({ columns: 15, rows: 8 })

    const renderer = new TerminalRenderer(100, fakeStdout)
    renderer.render({
      sessionId: 'short-id',
      workspace: '/w',
      model: 'm',
      status: 'idle',
      draft: 'test',
      cursorGraphemeIndex: 4,
    }, getLocale('en'))

    // All line addressing must stay within 1..8 rows
    const matches = [...fakeStdout.captured.matchAll(/\x1b\[(\d+);(\d+)H/g)]
    for (const match of matches) {
      const r = parseInt(match[1]!, 10)
      const c = parseInt(match[2]!, 10)
      expect(r).toBeLessThanOrEqual(8)
      expect(c).toBeLessThanOrEqual(15)
    }
  })

  it('bounds oversized single scrollback lines to MAX_SCROLLBACK_LINE_LENGTH', () => {
    const renderer = new TerminalRenderer(50)
    const notice = renderer.dict.scrollbackTruncationNotice
    // Create an oversized 50KB string
    const oversized = 'a'.repeat(50000)
    renderer.appendLine(oversized, 'user')

    const lines = renderer.getLines()
    expect(lines).toHaveLength(1)
    expect(lines[0]?.text.length).toBe(MAX_SCROLLBACK_LINE_LENGTH + notice.length)
    expect(lines[0]?.text.endsWith(notice)).toBe(true)

    // Multi-line chunk with oversized second line
    renderer.clear()
    const multilineOversized = `short first line\n${'b'.repeat(10000)}\nshort third line`
    renderer.appendLine(multilineOversized, 'assistant')

    const multiLines = renderer.getLines()
    expect(multiLines).toHaveLength(3)
    expect(multiLines[0]?.text).toBe('short first line')
    expect(multiLines[1]?.text.endsWith(notice)).toBe(true)
    expect(multiLines[1]?.text.length).toBe(MAX_SCROLLBACK_LINE_LENGTH + notice.length)
    expect(multiLines[2]?.text).toBe('short third line')
  })

  it('verifies screen layout and hardware cursor placement on real @xterm/headless emulator', async () => {
    const fakeStdout = new TestWriteStream({ columns: 80, rows: 24 })

    const renderer = new TerminalRenderer(100, fakeStdout)
    renderer.appendLine('First line of scrollback', 'system')
    renderer.appendLine('Second line with CJK 中文测试 and emoji 🚀', 'user')

    renderer.render({
      sessionId: 'sess-xterm-test',
      workspace: '/workspace',
      model: 'deepseek-v4-pro',
      status: 'idle',
      draft: 'Draft query with CJK 测试',
      cursorGraphemeIndex: 19, // Cursor right after "测试"
    }, getLocale('zh'))

    // Feed captured escape sequences into real headless xterm
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true })
    await new Promise<void>((resolve) => {
      term.write(fakeStdout.captured, () => { resolve() })
    })

    const buf = term.buffer.active
    // Row 0: Header with session, model, status
    const line0 = buf.getLine(0)?.translateToString(true) ?? ''
    expect(line0).toContain('[当前会话: sess-xte]')
    expect(line0).toContain('[当前模型: deepseek-v4-pro]')
    expect(line0).toContain('[空闲]')

    // Verify scrollback lines rendered
    let foundCjk = false
    for (let r = 0; r < 24; r++) {
      const lineStr = buf.getLine(r)?.translateToString(true) ?? ''
      if (lineStr.includes('中文测试') && lineStr.includes('🚀')) {
        foundCjk = true
      }
    }
    expect(foundCjk).toBe(true)

    // Hardware cursor must be at bottom prompt row
    expect(buf.cursorY).toBe(23)
    // Cursor X must be > prompt prefix 'dsh> ' (which is 5 cols)
    expect(buf.cursorX).toBeGreaterThanOrEqual(5)
  })

  it('truncates lines exceeding maxScrollbackLineLength and appends locale truncation notice', () => {
    const dict = getLocale('zh')
    const renderer = new TerminalRenderer(10, process.stdout, {
      maxScrollbackLineLength: 10,
      dict,
    })

    renderer.appendLine('0123456789ABCDEF', 'user')
    const lines = renderer.getLines()
    expect(lines.length).toBe(1)
    expect(lines[0]?.text).toBe(`0123456789${dict.scrollbackTruncationNotice}`)
  })

  it('bounds scrollback history to maxScrollbackLines', () => {
    const dict = getLocale('zh')
    const renderer = new TerminalRenderer(5, process.stdout, {
      dict,
    })

    for (let i = 0; i < 15; i++) {
      renderer.appendLine(`line ${i}`, 'notice')
    }

    const lines = renderer.getLines()
    expect(lines.length).toBe(5)
    expect(lines[0]?.text).toBe('line 10')
    expect(lines[4]?.text).toBe('line 14')
  })
})
