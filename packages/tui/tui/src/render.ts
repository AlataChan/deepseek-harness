/**
 * Bounded, sanitized terminal rendering, streaming presentation, and escape sequence management.
 * Provides grapheme-aware width measurement, complete C0/C1 and ANSI filtering,
 * shared tool card rendering, multiline cursor placement, and safe terminal state restoration.
 *
 * @module @deepseek-ai/dsh-tui/render
 */

import stringWidth from 'string-width'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import type { ScrollbackLine, TuiStatus } from './types.ts'
import { type LocaleDictionary, getLocale } from './locales.ts'
import type { TerminalReadStream } from './input.ts'

/** Minimal write stream interface required by the terminal renderer. */
export interface TerminalWriteStream {
  readonly isTTY?: boolean | undefined
  readonly columns?: number | undefined
  readonly rows?: number | undefined
  write(buffer: string | Uint8Array): boolean
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * Split text into grapheme clusters using Intl.Segmenter.
 * @param text - Input string to segment.
 * @returns Array of grapheme cluster strings.
 */
export function splitGraphemes(text: string): string[] {
  return [...segmenter.segment(text)].map(s => s.segment)
}

/**
 * Measure display column width of a string or grapheme cluster.
 * @param text - Text to measure.
 * @returns Column count on standard terminal.
 */
export function measureWidth(text: string): number {
  return stringWidth(text)
}

/**
 * Strip all ANSI, CSI, OSC (e.g. OSC 52), C0 (except newline/tab), and C1 controls from untrusted output.
 * @param text - Untrusted model, tool, or pasted output.
 * @returns Sanitized plain text safe for terminal rendering.
 */
export function sanitizeUntrustedOutput(text: string): string {
  return text
    // Normalize carriage returns
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Strip 7-bit and 8-bit OSC sequences (including OSC 52 clipboard sequences)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/gu, '')
    .replace(/\x9d[^\x07\x9c]*(?:\x07|\x9c)/gu, '')
    // Strip 7-bit and 8-bit CSI sequences
    .replace(/\x1b\[[0-9:;<=>?]*[ -/]*[@-~]/gu, '')
    .replace(/\x9b[0-9:;<=>?]*[ -/]*[@-~]/gu, '')
    // Strip other ESC sequences
    .replace(/\x1b[@-Z\\-_]/gu, '')
    .replace(/\x1b/gu, '')
    // Strip C0 controls except newline and tab (\x00-\x08, \x0B-\x1F, \x7F)
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/gu, '')
    // Strip C1 controls (\x80-\x9F)
    .replace(/[\u0080-\u009F]/gu, '')
}

/**
 * Clip a string to maxWidth display columns using grapheme boundary awareness.
 * @param text - Text to clip.
 * @param maxWidth - Column width limit.
 * @returns Clipped string that fits within maxWidth.
 */
export function clipToWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return ''
  const graphemes = splitGraphemes(text)
  let result = ''
  let curWidth = 0
  for (const g of graphemes) {
    const gw = measureWidth(g)
    if (curWidth + gw > maxWidth) break
    result += g
    curWidth += gw
  }
  return result
}

/** Result of laying out multiline draft with exact hardware cursor placement. */
export interface DraftLayoutResult {
  readonly visualLines: string[]
  readonly cursorVisualRow: number
  readonly cursorVisualCol: number
}

/**
 * Layout draft into wrapped visual lines and compute cursor visual coordinates.
 * Honors wide CJK characters and wrap boundaries.
 * @param draft - Input draft string.
 * @param cursorGraphemeIndex - Cursor index in grapheme clusters.
 * @param maxWidth - Available terminal columns.
 * @param firstPrefix - Prompt prefix for first visual line.
 * @param subsequentPrefix - Prompt prefix for subsequent visual lines.
 * @returns Draft visual lines and cursor visual row/column.
 */
export function layoutDraftWithCursor(
  draft: string,
  cursorGraphemeIndex: number,
  maxWidth: number,
  firstPrefix = 'dsh> ',
  subsequentPrefix = '...  ',
): DraftLayoutResult {
  const rawLines = draft.split('\n')
  const visualLines: string[] = []
  let cursorVisualRow = 0
  let cursorVisualCol = 1

  let globalGraphemeIndex = 0
  let cursorFound = false

  for (let rawIdx = 0; rawIdx < rawLines.length; rawIdx++) {
    const rawLine = rawLines[rawIdx]
    if (rawLine === undefined) continue
    const lineGraphemes = splitGraphemes(rawLine)
    const pfx = rawIdx === 0 ? firstPrefix : subsequentPrefix

    let curVisualLine = pfx
    let curVisualWidth = measureWidth(pfx)

    // Check if cursor is at the very beginning of this raw line
    if (!cursorFound && globalGraphemeIndex === cursorGraphemeIndex) {
      cursorVisualRow = visualLines.length
      cursorVisualCol = curVisualWidth + 1
      cursorFound = true
    }

    for (let i = 0; i < lineGraphemes.length; i++) {
      const g = lineGraphemes[i]
      if (g === undefined) continue
      const gw = measureWidth(g)
      // Check wrap boundary
      if (curVisualWidth + gw > maxWidth && curVisualLine.length > 0) {
        visualLines.push(curVisualLine)
        curVisualLine = ''
        curVisualWidth = 0
      }
      curVisualLine += g
      curVisualWidth += gw
      globalGraphemeIndex++

      if (!cursorFound && globalGraphemeIndex === cursorGraphemeIndex) {
        cursorVisualRow = visualLines.length
        cursorVisualCol = curVisualWidth + 1
        cursorFound = true
      }
    }

    visualLines.push(curVisualLine)

    // Account for newline between raw lines
    if (rawIdx < rawLines.length - 1) {
      globalGraphemeIndex++
    }
  }

  if (!cursorFound) {
    cursorVisualRow = Math.max(0, visualLines.length - 1)
    const lastLine = visualLines[cursorVisualRow] ?? ''
    cursorVisualCol = measureWidth(lastLine) + 1
  }

  cursorVisualCol = Math.min(maxWidth, Math.max(1, cursorVisualCol))
  return { visualLines, cursorVisualRow, cursorVisualCol }
}

/**
 * Wrap a single line of text into multiple lines fitting within maxWidth columns.
 * Word/grapheme boundary aware.
 * @param text - Line text to wrap.
 * @param maxWidth - Column width limit.
 * @returns Array of wrapped line strings.
 */
export function wrapTextToWidth(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [text]
  const graphemes = splitGraphemes(text)
  const lines: string[] = []
  let currentLine = ''
  let currentWidth = 0

  for (const g of graphemes) {
    if (g === '\n') {
      lines.push(currentLine)
      currentLine = ''
      currentWidth = 0
      continue
    }
    const gw = measureWidth(g)
    if (currentWidth + gw > maxWidth && currentLine.length > 0) {
      lines.push(currentLine)
      currentLine = g
      currentWidth = gw
    } else {
      currentLine += g
      currentWidth += gw
    }
  }
  lines.push(currentLine)
  return lines
}

/** Global restoration state tracking modes entered by the TUI. */
export interface TerminalModeState {
  enteredAlternateScreen: boolean
  bracketedPasteEnabled: boolean
  cursorHidden: boolean
  originalIsRaw?: boolean | undefined
  admissionStopped: boolean
}

const activeTerminalModes: TerminalModeState = {
  enteredAlternateScreen: false,
  bracketedPasteEnabled: false,
  cursorHidden: false,
  originalIsRaw: undefined,
  admissionStopped: false,
}

/**
 * Get active terminal mode state tracking for auditing or diagnostics.
 * @returns Clone of active terminal mode flags.
 */
export function getTerminalModeState(): Readonly<TerminalModeState> {
  return { ...activeTerminalModes }
}

/**
 * Enter the terminal's alternate screen buffer and enable bracketed paste.
 * @param stdout - Process stdout stream.
 * @param stdin - Process stdin stream to record original raw state.
 */
export function enterAlternateScreen(
  stdout: TerminalWriteStream = process.stdout,
  stdin: TerminalReadStream = process.stdin,
): void {
  if (activeTerminalModes.originalIsRaw === undefined) {
    activeTerminalModes.originalIsRaw = stdin.isRaw
  }
  if (!stdout.isTTY) return

  try {
    stdout.write('\x1b[?1049h\x1b[?2004h\x1b[H')
    activeTerminalModes.enteredAlternateScreen = true
    activeTerminalModes.bracketedPasteEnabled = true
  } catch {
    // Contained
  }
}

/**
 * Check whether the alternate screen is currently active.
 * @returns true if entered and not yet restored.
 */
export function isAlternateScreenActive(): boolean {
  return activeTerminalModes.enteredAlternateScreen
}

/**
 * Synchronously restore terminal state. Idempotent and exception-contained.
 * Restores only the terminal modes that were actually entered, restores original raw mode,
 * and marks admission as stopped.
 *
 * @param stdout - Process stdout stream.
 * @param stdin - Process stdin stream.
 */
export function restoreTerminalNow(
  stdout: TerminalWriteStream = process.stdout,
  stdin: TerminalReadStream = process.stdin,
): void {
  activeTerminalModes.admissionStopped = true

  try {
    if (stdout.isTTY) {
      let resetSeq = ''
      if (activeTerminalModes.bracketedPasteEnabled) {
        resetSeq += '\x1b[?2004l'
        activeTerminalModes.bracketedPasteEnabled = false
      }
      if (activeTerminalModes.cursorHidden) {
        resetSeq += '\x1b[?25h'
        activeTerminalModes.cursorHidden = false
      }
      if (activeTerminalModes.enteredAlternateScreen) {
        resetSeq += '\x1b[?1049l'
        activeTerminalModes.enteredAlternateScreen = false
      }
      if (resetSeq.length > 0) {
        stdout.write(resetSeq)
      }
    }
  } catch {
    // Contained: broken pipe or closed stream must not prevent remaining cleanup.
  }

  try {
    if (stdin.isTTY && typeof stdin.setRawMode === 'function') {
      stdin.setRawMode(activeTerminalModes.originalIsRaw ?? false)
    }
  } catch {
    // Contained
  }

  try {
    stdin.pause()
  } catch {
    // Contained
  }
}

/**
 * Render a tool call view into a human-readable formatted terminal card.
 * @param view - Provider-neutral ToolCallView.
 * @returns Formatted lines describing the call.
 */
export function renderToolCallView(view: ToolCallView): string {
  switch (view.card) {
    case 'terminal': {
      const desc = view.description ? ` (${sanitizeUntrustedOutput(view.description)})` : ''
      const cwd = view.cwd ? ` [cwd: ${sanitizeUntrustedOutput(view.cwd)}]` : ''
      return `▶ $ ${sanitizeUntrustedOutput(view.title)}${desc}${cwd}`
    }
    case 'diff': {
      const files = view.diffs.map(d => sanitizeUntrustedOutput(d.path)).join(', ')
      return `✎ ${sanitizeUntrustedOutput(view.title)}: ${files}`
    }
    case 'generic':
    default: {
      let rawStr = ''
      if (view.rawInput !== undefined) {
        rawStr = typeof view.rawInput === 'string' ? view.rawInput : JSON.stringify(view.rawInput)
      }
      const raw = rawStr ? ` [${sanitizeUntrustedOutput(rawStr)}]` : ''
      return `⚙ ${sanitizeUntrustedOutput(view.title)}${raw}`
    }
  }
}

/**
 * Render a tool result view into a human-readable formatted terminal card.
 * @param view - Provider-neutral ToolResultView.
 * @returns Formatted lines describing the result.
 */
export function renderToolResultView(view: ToolResultView): string {
  switch (view.card) {
    case 'terminal': {
      const title = view.title ? sanitizeUntrustedOutput(view.title) : 'Command execution finished'
      const status = view.exitCode !== undefined ? `(exit ${view.exitCode})` : view.signal ? `(killed by ${view.signal})` : ''
      const out = view.output ? `\n${sanitizeUntrustedOutput(view.output).trimEnd()}` : ''
      return `✔ ${title} ${status}${out}`
    }
    case 'diff': {
      const title = view.title ? sanitizeUntrustedOutput(view.title) : 'File changes applied'
      const paths = view.diffs.map(d => sanitizeUntrustedOutput(d.path)).join(', ')
      return `✔ ${title}: ${paths}`
    }
    case 'search': {
      const title = view.title ? sanitizeUntrustedOutput(view.title) : 'Search completed'
      const trunc = view.truncated ? ` (truncated, total: ${view.total})` : ` (${view.total} matches)`
      return `✔ ${title}${trunc}`
    }
    case 'read': {
      const title = view.title ? sanitizeUntrustedOutput(view.title) : `Read ${sanitizeUntrustedOutput(view.path)}`
      return `✔ ${title} (${view.lines.length}/${view.totalLines} lines)`
    }
    case 'web': {
      const title = view.title ? sanitizeUntrustedOutput(view.title) : 'Web retrieval finished'
      return `✔ ${title}`
    }
    case 'generic':
    default: {
      const title = view.title ? sanitizeUntrustedOutput(view.title) : 'Tool completed'
      return `✔ ${title}`
    }
  }
}

/** State passed to {@link TerminalRenderer.render}. */
export interface RenderState {
  sessionId: string
  workspace: string
  model: string
  status: TuiStatus
  draft: string
  cursorGraphemeIndex: number
  interactionPrompt?: string | undefined
  streamingText?: string | undefined
}

/** Maximum characters permitted in a single scrollback line entry before truncation. */
export const MAX_SCROLLBACK_LINE_LENGTH = 4096

/** Configuration options for TerminalRenderer. */
export interface RendererOptions {
  /** Maximum characters permitted in a single scrollback line before truncation. Defaults to 4096. */
  maxScrollbackLineLength?: number
  /** Locale dictionary for UI notices. Defaults to zh. */
  dict?: LocaleDictionary
}

/** Terminal renderer managing output lines, streaming, multiline draft, and view composing. */
export class TerminalRenderer {
  private readonly scrollback: ScrollbackLine[] = []
  /** Maximum retained characters in each scrollback line. */
  readonly maxLineLength: number
  /** Locale dictionary used for renderer-owned notices. */
  readonly dict: LocaleDictionary

  constructor(
    private readonly maxScrollback: number = 2000,
    private readonly stdout: TerminalWriteStream = process.stdout,
    options: RendererOptions = {},
  ) {
    this.maxLineLength = options.maxScrollbackLineLength ?? MAX_SCROLLBACK_LINE_LENGTH
    this.dict = options.dict ?? getLocale('zh')
  }

  /**
   * Append text to the scrollback buffer, enforcing line length and memory bounds.
   * Multi-line text is split into distinct lines; oversized lines are truncated safely.
   * @param text - Text content to append.
   * @param kind - Semantic category of line.
   */
  appendLine(text: string, kind: ScrollbackLine['kind'] = 'system'): void {
    const rawLines = text.split('\n')
    for (const raw of rawLines) {
      let sanitized = sanitizeUntrustedOutput(raw)
      if (sanitized.length > this.maxLineLength) {
        sanitized = `${sanitized.slice(0, this.maxLineLength)}${this.dict.scrollbackTruncationNotice}`
      }
      this.scrollback.push({ text: sanitized, kind, time: Date.now() })
    }
    if (this.scrollback.length > this.maxScrollback) {
      this.scrollback.splice(0, this.scrollback.length - this.maxScrollback)
    }
  }

  /** Clear all scrollback lines. */
  clear(): void {
    this.scrollback.length = 0
  }

  /**
   * Get all active scrollback lines.
   * @returns Readonly array of scrollback lines.
   */
  getLines(): readonly ScrollbackLine[] {
    return this.scrollback
  }

  /**
   * Render the complete terminal view.
   * Uses explicit line addressing (\x1b[row;1H) to avoid trailing newline scrolling.
   * Calculates cursor position accurately for multiline, column-wrapped drafts.
   *
   * @param state - Current UI header state, input buffer, streaming deltas, and prompt info.
   * @param dict - Locale dictionary.
   */
  render(state: RenderState, dict: LocaleDictionary): void {
    if (!this.stdout.isTTY || activeTerminalModes.admissionStopped) return

    const cols = Math.max(1, this.stdout.columns || 80)
    const rows = Math.max(1, this.stdout.rows || 24)
    const contentCols = cols

    // Status map
    const statusMap: Record<TuiStatus, string> = {
      idle: dict.statusIdle,
      running: dict.statusRunning,
      cancelling: dict.statusCancelling,
      'waiting-approval': dict.statusWaitingApproval,
      'waiting-question': dict.statusWaitingQuestion,
      exiting: dict.statusExiting,
    }
    const statusStr = statusMap[state.status]
    const headerLeft = `[${dict.sessionCurrent}: ${state.sessionId.slice(0, 8)}] [${dict.modelCurrent}: ${state.model}]`
    const headerRight = `[${statusStr}]`
    const leftWidth = measureWidth(headerLeft)
    const rightWidth = measureWidth(headerRight)
    let headerLine = ''
    if (leftWidth + rightWidth + 1 <= contentCols) {
      const spaceCount = contentCols - leftWidth - rightWidth
      headerLine = headerLeft + ' '.repeat(spaceCount) + headerRight
    } else {
      headerLine = clipToWidth(`${headerLeft} ${headerRight}`, contentCols)
    }
    const divider = '─'.repeat(contentCols)

    // Calculate multiline draft layout and hardware cursor coordinates
    const { visualLines, cursorVisualRow, cursorVisualCol } = layoutDraftWithCursor(
      state.draft,
      state.cursorGraphemeIndex,
      contentCols,
    )

    // Bounded viewport for multiline draft: keep cursor visible while leaving scrollback space
    const hasInteraction = Boolean(state.interactionPrompt)
    const maxDraftLines = Math.min(6, Math.max(1, Math.floor(rows / 3)))
    let displayedDraftLines = visualLines
    let viewStart = 0
    if (visualLines.length > maxDraftLines) {
      viewStart = Math.max(0, cursorVisualRow - maxDraftLines + 1)
      viewStart = Math.min(viewStart, visualLines.length - maxDraftLines)
      displayedDraftLines = visualLines.slice(viewStart, viewStart + maxDraftLines)
    }
    const draftLineCount = displayedDraftLines.length
    const cursorRowInView = Math.max(0, cursorVisualRow - viewStart)

    // Reserved rows:
    // Row 1: Header line
    // Row 2: Top divider
    // Row (rows - draftLineCount - (interaction ? 1 : 0)): Bottom divider
    // Interaction row: (optional)
    // Draft rows: draftLineCount
    const reservedRows = 2 + 1 + (hasInteraction ? 1 : 0) + draftLineCount
    const availableScrollRows = Math.max(0, rows - reservedRows)

    // Prepare streaming lines if currently streaming
    const streamingLines: string[] = []
    if (state.streamingText && state.streamingText.length > 0) {
      const sanitizedStreaming = sanitizeUntrustedOutput(state.streamingText)
      const wrappedStreaming = wrapTextToWidth(`▍ ${sanitizedStreaming}`, contentCols)
      // Display up to 5 lines of in-progress streaming
      streamingLines.push(...wrappedStreaming.slice(-5))
    }

    // Allocate available scroll area between scrollback and streaming
    const availableForScrollback = Math.max(0, availableScrollRows - streamingLines.length)
    const displayLines: string[] = []
    for (let i = this.scrollback.length - 1; i >= 0 && displayLines.length < availableForScrollback; i--) {
      const line = this.scrollback[i]
      if (line === undefined) continue
      const prefix = line.kind === 'user' ? '> ' : line.kind === 'error' ? '✖ ' : ''
      const wrapped = wrapTextToWidth(prefix + line.text, contentCols)
      for (let j = wrapped.length - 1; j >= 0 && displayLines.length < availableForScrollback; j--) {
        const w = wrapped[j]
        if (w !== undefined) displayLines.unshift(w)
      }
    }

    // Append streaming lines to display
    displayLines.push(...streamingLines)

    // Build frame with absolute cursor addressing on every line to prevent scrolling
    let frame = ''

    // Row 1: Header
    if (rows >= 1) {
      frame += `\x1b[1;1H\x1b[2K\x1b[7m${headerLine}\x1b[0m`
    }

    // Row 2: Top Divider
    if (rows >= 2) {
      frame += `\x1b[2;1H\x1b[2K\x1b[90m${divider}\x1b[0m`
    }

    // Scrollback display rows (Row 3 through Row (2 + availableScrollRows))
    for (let r = 0; r < availableScrollRows; r++) {
      const screenRow = 3 + r
      const line = displayLines[r] ?? ''
      frame += `\x1b[${screenRow};1H\x1b[2K${line}`
    }

    // Bottom divider row
    const bottomDividerRow = 3 + availableScrollRows
    if (bottomDividerRow <= rows) {
      frame += `\x1b[${bottomDividerRow};1H\x1b[2K\x1b[90m${divider}\x1b[0m`
    }

    // Interaction prompt row (if active)
    let currentRow = bottomDividerRow + 1
    if (hasInteraction && state.interactionPrompt && currentRow <= rows) {
      frame += `\x1b[${currentRow};1H\x1b[2K\x1b[1;33m${clipToWidth(state.interactionPrompt, contentCols)}\x1b[0m`
      currentRow++
    }

    // Input draft rows
    const inputStartRow = currentRow
    for (let d = 0; d < draftLineCount && (inputStartRow + d) <= rows; d++) {
      const rowNum = inputStartRow + d
      const lineContent = displayedDraftLines[d] ?? ''
      frame += `\x1b[${rowNum};1H\x1b[2K${lineContent}`
    }

    // Position hardware cursor
    const finalCursorRow = Math.min(rows, inputStartRow + cursorRowInView)
    const finalCursorCol = Math.min(contentCols, cursorVisualCol)
    frame += `\x1b[${finalCursorRow};${finalCursorCol}H`

    try {
      this.stdout.write(frame)
    } catch {
      // Contained
    }
  }
}
