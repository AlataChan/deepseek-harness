/**
 * TTY raw mode, bounded bracketed paste, multiline buffer, and key routing.
 * Uses an incremental state-machine parser to handle escape sequences and
 * bracketed paste markers split across arbitrary chunk boundaries.
 *
 * @module @deepseek-ai/dsh-tui/input
 */

import { splitGraphemes } from './render.ts'

/** Callbacks for submitted drafts, cancellation, exit and input repaint. */
export interface InputHandlers {
  /** Called when the user presses Enter to submit a command or prompt. */
  onSubmit: (text: string) => void
  /** Called when the user presses Ctrl+C. */
  onCancel: () => void
  /** Called on normal exit (Ctrl+D on empty line, or double Ctrl+C). */
  onExit: () => void
  /** Called whenever draft text or cursor changes to request a re-render. */
  onRender: () => void
}

/** Maximum bytes permitted in a single bracketed paste payload. */
export const MAX_PASTE_BYTES = 65536

/** Maximum entries retained in input command history. */
export const MAX_HISTORY_ENTRIES = 500

/** Minimal read stream interface required by the input controller. */
export interface TerminalReadStream {
  readonly isTTY?: boolean | undefined
  readonly isRaw?: boolean | undefined
  setRawMode?(mode: boolean): void
  resume(): void
  pause(): void
  setEncoding(encoding: BufferEncoding): void
  on(event: 'data', listener: (chunk: Buffer | string) => void): this
  removeListener(event: 'data', listener: (chunk: Buffer | string) => void): this
}

/** Configuration options for InputController. */
export interface InputControllerOptions {
  /** Maximum bytes accepted in draft buffer. Defaults to 32768. */
  maxInputBytes?: number
  /** Maximum bytes accepted in bracketed paste buffer. Defaults to 65536. */
  maxPasteBytes?: number
  /** Maximum entries retained in input command history. Defaults to 500. */
  maxHistoryEntries?: number
}

/**
 * Sanitize text destined for the input draft buffer.
 * Strips all C0 controls (except newline and tab), C1 controls (including 8-bit CSI),
 * and ANSI/OSC escape sequences. Converts carriage returns and tabs cleanly.
 *
 * @param text - Raw untrusted or pasted text.
 * @returns Safe printable text string.
 */
export function sanitizeDraftText(text: string): string {
  return text
    // Normalize newlines
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Normalize tab to two spaces
    .replace(/\t/g, '  ')
    // Strip OSC sequences (7-bit and 8-bit)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/gu, '')
    .replace(/\x9d[^\x07\x9c]*(?:\x07|\x9c)/gu, '')
    // Strip CSI sequences (7-bit and 8-bit)
    .replace(/\x1b\[[0-9:;<=>?]*[ -/]*[@-~]/gu, '')
    .replace(/\x9b[0-9:;<=>?]*[ -/]*[@-~]/gu, '')
    // Strip other ESC sequences
    .replace(/\x1b[@-Z\\-_]/gu, '')
    .replace(/\x1b/gu, '')
    // Strip C0 controls except newline (0x00-0x09, 0x0B-0x1F, 0x7F)
    .replace(/[\x00-\x09\x0B-\x1F\x7F]/gu, '')
    // Strip C1 controls (0x80-0x9F)
    .replace(/[\u0080-\u009F]/gu, '')
}

/** Parser state for the incremental stream tokenizer. */
const ParserState = {
  GROUND: 0,
  ESCAPE: 1,
  CSI: 2,
  SS3: 3,
  PASTE: 4,
  PASTE_ESC: 5,
  PASTE_CSI: 6,
} as const
type ParserState = typeof ParserState[keyof typeof ParserState]

/** Input controller managing raw terminal keystrokes, incremental parsing, and line editing. */
export class InputController {
  private draft = ''
  private cursorGraphemeIndex = 0
  private parserState: ParserState = ParserState.GROUND
  private escapeBuffer = ''
  private pasteBuffer = ''
  private ctrlCPressCount = 0
  private multilineMode = false
  private readonly history: string[] = []
  private historyIndex = -1
  private uninstalled = false

  private readonly maxInputBytes: number
  private readonly maxPasteBytes: number
  private readonly maxHistoryEntries: number

  constructor(
    private readonly stdin: TerminalReadStream = process.stdin,
    private readonly handlers: InputHandlers,
    options: InputControllerOptions | number = {},
  ) {
    if (typeof options === 'number') {
      this.maxInputBytes = options
      this.maxPasteBytes = MAX_PASTE_BYTES
      this.maxHistoryEntries = MAX_HISTORY_ENTRIES
    } else {
      this.maxInputBytes = options.maxInputBytes ?? 32768
      this.maxPasteBytes = options.maxPasteBytes ?? MAX_PASTE_BYTES
      this.maxHistoryEntries = options.maxHistoryEntries ?? MAX_HISTORY_ENTRIES
    }
  }

  /**
   * Start listening for raw input on stdin.
   * Enables raw mode on TTY streams.
   */
  start(): void {
    if (this.stdin.isTTY && typeof this.stdin.setRawMode === 'function') {
      try {
        this.stdin.setRawMode(true)
      } catch {
        // Contained
      }
    }
    try {
      this.stdin.resume()
      this.stdin.setEncoding('utf8')
    } catch {
      // Contained
    }
    this.stdin.on('data', this.handleData)
  }

  /** Stop listening and restore stdin mode. */
  stop(): void {
    if (this.uninstalled) return
    this.uninstalled = true
    this.stdin.removeListener('data', this.handleData)
    if (this.stdin.isTTY && typeof this.stdin.setRawMode === 'function') {
      try {
        this.stdin.setRawMode(false)
      } catch {
        // Contained
      }
    }
    try {
      this.stdin.pause()
    } catch {
      // Contained
    }
  }

  /**
   * Get the current input draft string.
   * @returns Current draft text.
   */
  getDraft(): string {
    return this.draft
  }

  /**
   * Set the draft text programmatically.
   * @param text - New draft content.
   */
  setDraft(text: string): void {
    const sanitized = sanitizeDraftText(text)
    this.draft = sanitized
    this.cursorGraphemeIndex = splitGraphemes(sanitized).length
    this.handlers.onRender()
  }

  /**
   * Get the cursor position in grapheme cluster units.
   * @returns Current 0-based grapheme index.
   */
  getCursorIndex(): number {
    return this.cursorGraphemeIndex
  }

  /** Clear the current draft buffer. */
  clearDraft(): void {
    this.draft = ''
    this.cursorGraphemeIndex = 0
    this.historyIndex = -1
    this.handlers.onRender()
  }

  /**
   * Process an incoming text or escape sequence chunk incrementally.
   * Safe against arbitrary splitting across byte or chunk boundaries.
   * @param chunk - Raw input bytes or characters.
   */
  handleChunk(chunk: string): void {
    this.handleData(chunk)
  }

  /** Toggle multiline edit mode.
   * @returns Whether Enter now inserts a newline instead of submitting.
   */
  toggleMultiline(): boolean {
    this.multilineMode = !this.multilineMode
    this.handlers.onRender()
    return this.multilineMode
  }

  private handleData = (data: string | Buffer): void => {
    const chunk = typeof data === 'string' ? data : data.toString('utf8')
    let i = 0
    while (i < chunk.length) {
      if (this.parserState === ParserState.GROUND) {
        const char = chunk[i]
        if (!char) {
          i++
          continue
        }
        if (
          char === '\x1b' ||
          char < ' ' ||
          char === '\x7f' ||
          (char >= '\u0080' && char <= '\u009f')
        ) {
          this.consumeChar(char)
          i++
        } else {
          let j = i + 1
          while (j < chunk.length) {
            const next = chunk[j]
            if (
              !next ||
              next === '\x1b' ||
              next < ' ' ||
              next === '\x7f' ||
              (next >= '\u0080' && next <= '\u009f')
            ) {
              break
            }
            j++
          }
          const textChunk = chunk.slice(i, j)
          this.insertText(textChunk)
          this.ctrlCPressCount = 0
          i = j
        }
      } else {
        const char = chunk[i]
        if (!char) {
          i++
          continue
        }
        this.consumeChar(char)
        i++
      }
    }
  }

  private consumeChar(char: string): void {
    switch (this.parserState) {
      case ParserState.GROUND:
        this.consumeGround(char)
        break

      case ParserState.ESCAPE:
        this.consumeEscape(char)
        break

      case ParserState.CSI:
        this.consumeCsi(char)
        break

      case ParserState.SS3:
        this.consumeSs3(char)
        break

      case ParserState.PASTE:
        this.consumePaste(char)
        break

      case ParserState.PASTE_ESC:
        this.consumePasteEsc(char)
        break

      case ParserState.PASTE_CSI:
        this.consumePasteCsi(char)
        break
    }
  }

  private consumeGround(char: string): void {
    // Escape begins sequence
    if (char === '\x1b') {
      this.parserState = ParserState.ESCAPE
      this.escapeBuffer = '\x1b'
      return
    }

    // Ctrl+C (0x03)
    if (char === '\x03') {
      if (this.draft.length > 0) {
        this.clearDraft()
      } else {
        this.ctrlCPressCount++
        if (this.ctrlCPressCount >= 2) {
          this.handlers.onExit()
        } else {
          this.handlers.onCancel()
        }
      }
      return
    }

    // Reset Ctrl+C counter on any other key
    this.ctrlCPressCount = 0

    // Ctrl+D (0x04) on empty line exits
    if (char === '\x04') {
      if (this.draft.length === 0) {
        this.handlers.onExit()
      }
      return
    }

    // Enter / Return (\r, \n)
    if (char === '\r' || char === '\n') {
      if (this.multilineMode) {
        this.insertText('\n')
        return
      }
      const submitted = this.draft
      this.clearDraft()
      if (submitted.trim().length > 0) {
        this.recordHistory(submitted)
      }
      this.handlers.onSubmit(submitted)
      return
    }

    // Backspace (\x7f or \x08)
    if (char === '\x7f' || char === '\x08') {
      this.handleBackspace()
      return
    }

    // Home / Ctrl+A (\x01)
    if (char === '\x01') {
      this.cursorGraphemeIndex = 0
      this.handlers.onRender()
      return
    }

    // End / Ctrl+E (\x05)
    if (char === '\x05') {
      this.cursorGraphemeIndex = splitGraphemes(this.draft).length
      this.handlers.onRender()
      return
    }

    // Ctrl+U (\x15): Clear to beginning of line
    if (char === '\x15') {
      this.clearDraft()
      return
    }

    // Filter dangerous control codes: C0 (except \t) and C1
    const code = char.charCodeAt(0)
    if ((code < 0x20 && char !== '\t') || (code >= 0x7f && code <= 0x9f)) {
      return
    }

    // Printable character
    this.insertText(char)
  }

  private consumeEscape(char: string): void {
    this.escapeBuffer += char
    if (char === '[') {
      this.parserState = ParserState.CSI
    } else if (char === 'O') {
      this.parserState = ParserState.SS3
    } else if (char === '\r' || char === '\n') {
      // Alt+Enter / Escape+Enter adds a newline to multiline draft
      this.insertText('\n')
      this.parserState = ParserState.GROUND
      this.escapeBuffer = ''
    } else if (char === '\x1b') {
      // Standalone escape followed by another escape
      this.escapeBuffer = '\x1b'
    } else {
      // Unknown single-character escape
      this.parserState = ParserState.GROUND
      this.escapeBuffer = ''
    }
  }

  private consumeCsi(char: string): void {
    this.escapeBuffer += char

    // Bounded escape sequence length: if longer than 32 chars, abort safely
    if (this.escapeBuffer.length > 32) {
      this.parserState = ParserState.GROUND
      this.escapeBuffer = ''
      return
    }

    // Final byte of CSI sequence: ASCII 0x40 to 0x7E (@ through ~)
    const code = char.charCodeAt(0)
    if (code >= 0x40 && code <= 0x7e) {
      this.dispatchCsi(this.escapeBuffer)
      this.escapeBuffer = ''
    }
  }

  private dispatchCsi(seq: string): void {
    // Bracketed paste start: \x1b[200~
    if (seq === '\x1b[200~') {
      this.parserState = ParserState.PASTE
      this.pasteBuffer = ''
      return
    }

    // Bracketed paste end without start: ignore
    if (seq === '\x1b[201~') {
      this.parserState = ParserState.GROUND
      return
    }

    this.parserState = ParserState.GROUND

    // Arrow Up: History previous
    if (seq === '\x1b[A') {
      this.navigateHistoryPrevious()
      return
    }

    // Arrow Down: History next
    if (seq === '\x1b[B') {
      this.navigateHistoryNext()
      return
    }

    // Arrow Right
    if (seq === '\x1b[C') {
      const graphemes = splitGraphemes(this.draft)
      if (this.cursorGraphemeIndex < graphemes.length) {
        this.cursorGraphemeIndex++
        this.handlers.onRender()
      }
      return
    }

    // Arrow Left
    if (seq === '\x1b[D') {
      if (this.cursorGraphemeIndex > 0) {
        this.cursorGraphemeIndex--
        this.handlers.onRender()
      }
      return
    }

    // Delete (\x1b[3~)
    if (seq === '\x1b[3~') {
      this.handleDelete()
      return
    }

    // Home (\x1b[H or \x1b[1~)
    if (seq === '\x1b[H' || seq === '\x1b[1~') {
      this.cursorGraphemeIndex = 0
      this.handlers.onRender()
      return
    }

    // End (\x1b[F or \x1b[4~)
    if (seq === '\x1b[F' || seq === '\x1b[4~') {
      this.cursorGraphemeIndex = splitGraphemes(this.draft).length
      this.handlers.onRender()
    }
  }

  private consumeSs3(char: string): void {
    this.escapeBuffer += char
    this.parserState = ParserState.GROUND
    const seq = this.escapeBuffer
    this.escapeBuffer = ''

    if (seq === '\x1bOA') this.navigateHistoryPrevious()
    else if (seq === '\x1bOB') this.navigateHistoryNext()
    else if (seq === '\x1bOC') {
      const graphemes = splitGraphemes(this.draft)
      if (this.cursorGraphemeIndex < graphemes.length) {
        this.cursorGraphemeIndex++
        this.handlers.onRender()
      }
    } else if (seq === '\x1bOD') {
      if (this.cursorGraphemeIndex > 0) {
        this.cursorGraphemeIndex--
        this.handlers.onRender()
      }
    }
  }

  private consumePaste(char: string): void {
    if (char === '\x1b') {
      this.parserState = ParserState.PASTE_ESC
      return
    }

    // Enforce strict upper bound on paste accumulation
    if (this.pasteBuffer.length < this.maxPasteBytes) {
      this.pasteBuffer += char
    }
  }

  private consumePasteEsc(char: string): void {
    if (char === '[') {
      this.parserState = ParserState.PASTE_CSI
      this.escapeBuffer = '\x1b['
    } else if (char === '\x1b') {
      if (this.pasteBuffer.length < this.maxPasteBytes) {
        this.pasteBuffer += '\x1b'
      }
    } else {
      if (this.pasteBuffer.length < this.maxPasteBytes) {
        this.pasteBuffer += '\x1b' + char
      }
      this.parserState = ParserState.PASTE
    }
  }

  private consumePasteCsi(char: string): void {
    this.escapeBuffer += char
    if (this.escapeBuffer === '\x1b[201~') {
      // Bracketed paste complete
      this.parserState = ParserState.GROUND
      const textToInsert = this.pasteBuffer
      this.pasteBuffer = ''
      this.escapeBuffer = ''
      this.insertText(textToInsert)
      return
    }

    // If escape buffer can no longer match \x1b[201~, flush it back into paste buffer
    if (!'\x1b[201~'.startsWith(this.escapeBuffer)) {
      if (this.pasteBuffer.length < this.maxPasteBytes) {
        this.pasteBuffer += this.escapeBuffer
      }
      this.escapeBuffer = ''
      this.parserState = ParserState.PASTE
    }
  }

  private insertText(text: string): void {
    const sanitized = sanitizeDraftText(text)
    if (!sanitized) return

    const currentBytes = Buffer.byteLength(this.draft, 'utf8')
    if (currentBytes >= this.maxInputBytes) return
    const remainingBytes = this.maxInputBytes - currentBytes
    let allowedText = sanitized
    if (Buffer.byteLength(allowedText, 'utf8') > remainingBytes) {
      const buf = Buffer.from(allowedText, 'utf8').subarray(0, remainingBytes)
      allowedText = buf.toString('utf8')
    }
    if (!allowedText) return

    const currentGraphemes = splitGraphemes(this.draft)
    const before = currentGraphemes.slice(0, this.cursorGraphemeIndex).join('')
    const after = currentGraphemes.slice(this.cursorGraphemeIndex).join('')
    this.draft = before + allowedText + after
    this.cursorGraphemeIndex = splitGraphemes(before + allowedText).length
    this.handlers.onRender()
  }

  private handleBackspace(): void {
    if (this.cursorGraphemeIndex <= 0) return
    const graphemes = splitGraphemes(this.draft)
    graphemes.splice(this.cursorGraphemeIndex - 1, 1)
    this.draft = graphemes.join('')
    this.cursorGraphemeIndex--
    this.handlers.onRender()
  }

  private handleDelete(): void {
    const graphemes = splitGraphemes(this.draft)
    if (this.cursorGraphemeIndex >= graphemes.length) return
    graphemes.splice(this.cursorGraphemeIndex, 1)
    this.draft = graphemes.join('')
    this.handlers.onRender()
  }

  private recordHistory(entry: string): void {
    this.history.push(entry)
    if (this.history.length > this.maxHistoryEntries) {
      this.history.shift()
    }
  }

  private navigateHistoryPrevious(): void {
    if (this.history.length === 0) return
    if (this.historyIndex === -1) {
      this.historyIndex = this.history.length - 1
    } else if (this.historyIndex > 0) {
      this.historyIndex--
    }
    const item = this.history[this.historyIndex]
    if (item !== undefined) {
      this.setDraft(item)
    }
  }

  private navigateHistoryNext(): void {
    if (this.historyIndex < 0) return
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++
      const item = this.history[this.historyIndex]
      if (item !== undefined) this.setDraft(item)
    } else {
      this.historyIndex = -1
      this.clearDraft()
    }
  }
}
