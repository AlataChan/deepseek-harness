import { describe, expect, it } from 'vitest'
import { InputController, type InputHandlers } from '../src/input.ts'
import { TestReadStream } from './fixtures.ts'

function createTestController(handlers: Partial<InputHandlers> = {}, maxInputBytes = 32768): InputController {
  const fakeStdin = new TestReadStream()
  return new InputController(fakeStdin, {
    onSubmit: () => {},
    onCancel: () => {},
    onExit: () => {},
    onRender: () => {},
    ...handlers,
  }, maxInputBytes)
}

describe('InputController', () => {
  it('accumulates bracketed paste and does not submit until user presses Enter', () => {
    let submitted: string | undefined
    const controller = createTestController({
      onSubmit: (val) => { submitted = val },
    })

    // Bracketed paste start
    controller.handleChunk('\x1b[200~')
    controller.handleChunk('first line\nsecond line')
    controller.handleChunk('\x1b[201~')

    expect(submitted).toBeUndefined()
    expect(controller.getDraft()).toBe('first line\nsecond line')

    // Submit with enter
    controller.handleChunk('\r')
    expect(submitted).toBe('first line\nsecond line')
    expect(controller.getDraft()).toBe('')
  })

  it('supports multiline drafting via Alt+Enter', () => {
    let submitted: string | undefined
    const controller = createTestController({
      onSubmit: (val) => { submitted = val },
    })

    controller.handleChunk('line 1')
    controller.handleChunk('\x1b\r') // Alt+Enter
    controller.handleChunk('line 2')
    expect(controller.getDraft()).toBe('line 1\nline 2')

    controller.handleChunk('\n') // Enter submits
    expect(submitted).toBe('line 1\nline 2')
    expect(controller.getDraft()).toBe('')
  })

  it('handles grapheme-aware cursor navigation and deletion for ZWJ emoji, combining accents, and CJK', () => {
    const controller = createTestController()

    // Draft: "Aé👨‍👩‍👧‍👦文"
    controller.handleChunk('A')
    controller.handleChunk('e\u0301')
    controller.handleChunk('👨‍👩‍👧‍👦')
    controller.handleChunk('文')

    expect(controller.getDraft()).toBe('Ae\u0301👨‍👩‍👧‍👦文')
    expect(controller.getCursorIndex()).toBe(4)

    // Backspace: deletes '文' (1 grapheme)
    controller.handleChunk('\x7f')
    expect(controller.getDraft()).toBe('Ae\u0301👨‍👩‍👧‍👦')
    expect(controller.getCursorIndex()).toBe(3)

    // Backspace: deletes '👨‍👩‍👧‍👦' (entire ZWJ cluster)
    controller.handleChunk('\x7f')
    expect(controller.getDraft()).toBe('Ae\u0301')
    expect(controller.getCursorIndex()).toBe(2)

    // Backspace: deletes combining 'e\u0301'
    controller.handleChunk('\x7f')
    expect(controller.getDraft()).toBe('A')
    expect(controller.getCursorIndex()).toBe(1)

    // Left arrow to start
    controller.handleChunk('\x1b[D')
    expect(controller.getCursorIndex()).toBe(0)

    // Delete forward: deletes 'A'
    controller.handleChunk('\x1b[3~')
    expect(controller.getDraft()).toBe('')
    expect(controller.getCursorIndex()).toBe(0)
  })

  it('navigates history on Up and Down arrow keys', () => {
    let submitted: string | undefined
    const controller = createTestController({
      onSubmit: (val) => { submitted = val },
    })

    controller.handleChunk('command 1\r')
    expect(submitted).toBe('command 1')

    controller.handleChunk('command 2\r')
    expect(submitted).toBe('command 2')

    // Up arrow recalls 'command 2'
    controller.handleChunk('\x1b[A')
    expect(controller.getDraft()).toBe('command 2')

    // Up arrow recalls 'command 1'
    controller.handleChunk('\x1b[A')
    expect(controller.getDraft()).toBe('command 1')

    // Down arrow returns to 'command 2'
    controller.handleChunk('\x1b[B')
    expect(controller.getDraft()).toBe('command 2')

    // Down arrow returns to blank current draft
    controller.handleChunk('\x1b[B')
    expect(controller.getDraft()).toBe('')
  })

  it('handles Ctrl+C differently based on draft and execution state', () => {
    let cancelled = false
    let exited = false

    const controller = createTestController({
      onCancel: () => { cancelled = true },
      onExit: () => { exited = true },
    })

    // 1. Non-empty draft: Ctrl+C clears draft without cancelling or exiting
    controller.handleChunk('unfinished input')
    controller.handleChunk('\x03') // Ctrl+C
    expect(controller.getDraft()).toBe('')
    expect(cancelled).toBe(false)
    expect(exited).toBe(false)

    // 2. Empty draft, first Ctrl+C calls cancel
    controller.handleChunk('\x03')
    expect(cancelled).toBe(true)
    expect(exited).toBe(false)

    // 3. Consecutive Ctrl+C calls exit
    controller.handleChunk('\x03')
    expect(exited).toBe(true)
  })

  it('handles Ctrl+D (EOF) by exiting when draft is empty', () => {
    let exited = false
    const controller = createTestController({
      onExit: () => { exited = true },
    })

    // Non-empty draft: Ctrl+D does not exit
    controller.handleChunk('hello')
    controller.handleChunk('\x04') // Ctrl+D
    expect(exited).toBe(false)

    // Clear draft
    controller.clearDraft()
    // Empty draft: Ctrl+D triggers exit
    controller.handleChunk('\x04')
    expect(exited).toBe(true)
  })

  it('correctly handles bracketed-paste split across every single byte boundary', () => {
    let submitted: string | undefined
    const controller = createTestController({
      onSubmit: (val) => { submitted = val },
    })

    const sequence = '\x1b[200~split byte content\x1b[201~'
    // Feed one byte at a time
    for (const ch of sequence) {
      controller.handleChunk(ch)
    }

    expect(controller.getDraft()).toBe('split byte content')
    expect(submitted).toBeUndefined()

    controller.handleChunk('\r')
    expect(submitted).toBe('split byte content')
  })

  it('drops excess bytes beyond MAX_PASTE_BYTES during oversized pastes', () => {
    const controller = createTestController({}, 100000)

    controller.handleChunk('\x1b[200~')
    // Feed 70000 bytes ('a' repeated)
    const big = 'a'.repeat(70000)
    controller.handleChunk(big)
    controller.handleChunk('\x1b[201~')

    // Must be bounded to 65536 bytes
    expect(controller.getDraft().length).toBe(65536)
  })

  it('sanitizes C0 and C1 controls, OSC, and ANSI escape sequences from pasted text', () => {
    const controller = createTestController()

    // OSC 52 clipboard set sequence, CSI clear screen \x1b[2J, C0 backspace \x08, C1 control \u009b
    const malicious = '\x1b[200~safe\x1b]52;c;evil\x07text\x08with\x1b[2Jcontrols\u009b\x1b[201~'
    controller.handleChunk(malicious)

    const draft = controller.getDraft()
    expect(draft).not.toContain('\x1b]52')
    expect(draft).not.toContain('\x1b[2J')
    expect(draft).not.toContain('\x08')
    expect(draft).not.toContain('\u009b')
    expect(draft).toContain('safetextwithcontrols')
  })

  it('enforces maximum history capacity bounds at 500 entries', () => {
    const controller = createTestController()

    // Submit 550 entries
    for (let i = 0; i < 550; i++) {
      controller.handleChunk(`cmd ${i}\r`)
    }

    // Up arrow 500 times should succeed, but cmd 0..49 should be pruned
    for (let i = 0; i < 500; i++) {
      controller.handleChunk('\x1b[A')
    }
    // Oldest surviving entry should be cmd 50
    expect(controller.getDraft()).toBe('cmd 50')
  })

  it('enforces custom configured maxPasteBytes and maxHistoryEntries bounds', () => {
    let submitted = ''
    const fakeStdin = new TestReadStream()
    const controller = new InputController(
      fakeStdin,
      {
        onSubmit: (text) => { submitted = text },
        onCancel: () => {},
        onExit: () => {},
        onRender: () => {},
      },
      {
        maxInputBytes: 1000,
        maxPasteBytes: 30,
        maxHistoryEntries: 5,
      },
    )

    // 1. Custom tiny paste bound: 30 bytes
    const giantPaste = 'A'.repeat(100)
    controller.handleChunk('\x1b[200~')
    controller.handleChunk(giantPaste)
    controller.handleChunk('\x1b[201~')
    expect(controller.getDraft().length).toBe(30)

    // Clear draft with Ctrl+U
    controller.handleChunk('\x15')
    expect(controller.getDraft()).toBe('')

    // 2. Custom tiny history bound: 5 entries
    for (let i = 0; i < 10; i++) {
      controller.handleChunk(`custom ${i}\r`)
    }
    // Navigate back through history
    for (let i = 0; i < 5; i++) {
      controller.handleChunk('\x1b[A')
    }
    // Oldest surviving entry must be custom 5 (items 0..4 pruned)
    expect(controller.getDraft()).toBe('custom 5')
    expect(submitted).toBe('custom 9')
  })
})
