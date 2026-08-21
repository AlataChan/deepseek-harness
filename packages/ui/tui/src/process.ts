/** Node process access for the terminal client. @module @deepseek-ai/dsh-tui/process */

/** Process facts and effects consumed by the TUI runtime. */
export interface TuiProcess {
  readonly stdin: NodeJS.ReadStream
  readonly stdout: NodeJS.WriteStream
  readonly stderr: NodeJS.WriteStream
  readonly stdinIsTTY: boolean
  readonly stdoutIsTTY: boolean
  readonly columns: number
  readonly rows: number | undefined
  readonly cwd: string
  /** Request normal launcher-owned process exit after TUI cleanup. */
  requestExit(code: number): void
  /** Subscribe to terminal-width changes. */
  onResize(listener: () => void): () => void
  /** Subscribe to stdin termination, which begins normal TUI shutdown. */
  onExit(listener: () => void): () => void
}

/** Injectable process facts used by deterministic adapter tests. */
export interface TuiProcessTestOptions {
  stdin: NodeJS.ReadStream
  stdout: NodeJS.WriteStream
  stderr: NodeJS.WriteStream
  cwd: string
  requestExit(code: number): void
  terminalColumnsFallback: number
}

function positiveInteger(value: number | undefined): number | undefined {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

/** Construct one validated adapter from explicit process facts. */
function createAdapter(options: TuiProcessTestOptions): TuiProcess {
  const stdinIsTTY = options.stdin.isTTY
  const stdoutIsTTY = options.stdout.isTTY
  if (!stdinIsTTY || !stdoutIsTTY) {
    throw new Error('dsh tui requires interactive stdin and stdout; use dsh exec for non-interactive runs')
  }
  return {
    stdin: options.stdin,
    stdout: options.stdout,
    stderr: options.stderr,
    stdinIsTTY,
    stdoutIsTTY,
    get columns() { return positiveInteger(options.stdout.columns) ?? options.terminalColumnsFallback },
    get rows() { return positiveInteger(options.stdout.rows) },
    cwd: options.cwd,
    requestExit: (code) => { options.requestExit(code) },
    onResize(listener) {
      options.stdout.on('resize', listener)
      return () => { options.stdout.off('resize', listener) }
    },
    onExit(listener) {
      options.stdin.on('end', listener)
      return () => { options.stdin.off('end', listener) }
    },
  }
}

/**
 * Construct the production adapter from Node process state.
 * @param terminalColumnsFallback - validated width used when stdout reports no usable width.
 * @param requestExit - launcher-owned exit request called only after TUI cleanup.
 * @returns a validated interactive terminal adapter.
 */
export function createTuiProcess(
  terminalColumnsFallback: number,
  requestExit: (code: number) => void,
): TuiProcess {
  return createAdapter({
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    cwd: process.cwd(),
    requestExit,
    terminalColumnsFallback,
  })
}

/**
 * Construct a deterministic adapter without reading global process state.
 * @param options - explicit streams, current directory, exit request, and validated fallback width.
 * @returns a validated interactive terminal adapter.
 */
export function createTuiProcessForTest(options: TuiProcessTestOptions): TuiProcess {
  return createAdapter(options)
}
