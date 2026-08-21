import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createTuiProcess, createTuiProcessForTest } from '../src/process.ts'

class FakeInput extends EventEmitter {
  isRaw = false
  readonly setRawMode = vi.fn((value: boolean) => { this.isRaw = value })
  readonly pause = vi.fn()
  constructor(readonly isTTY: boolean) { super() }
}

class FakeOutput extends EventEmitter {
  readonly chunks: string[] = []
  columns?: number
  rows?: number

  constructor(readonly isTTY: boolean) { super() }

  write(chunk: string): boolean {
    this.chunks.push(chunk)
    return true
  }
}

function createTestProcess(options: {
  stdinIsTTY?: boolean
  stdoutIsTTY?: boolean
  columns?: number
  rows?: number
} = {}) {
  const stdin = new FakeInput(options.stdinIsTTY ?? true)
  const stdout = new FakeOutput(options.stdoutIsTTY ?? true)
  const stderr = new FakeOutput(true)
  if (options.columns !== undefined) stdout.columns = options.columns
  if (options.rows !== undefined) stdout.rows = options.rows
  const requestExit = vi.fn()
  const terminal = createTuiProcessForTest({
    stdin: stdin as never,
    stdout: stdout as never,
    stderr: stderr as never,
    cwd: '/workspace',
    requestExit,
    terminalColumnsFallback: 80,
  })
  return { stdin, stdout, stderr, requestExit, terminal }
}

describe('tui process adapter', () => {
  it('requires interactive stdin and stdout and names the automation command', () => {
    expect(() => createTestProcess({ stdinIsTTY: false })).toThrow(/dsh exec/)
    expect(() => createTestProcess({ stdoutIsTTY: false })).toThrow(/dsh exec/)
  })

  it('exposes streams, cwd, exit requests, and configured column fallback', () => {
    const fallback = createTestProcess()
    expect(fallback.terminal.columns).toBe(80)
    expect(fallback.terminal.cwd).toBe('/workspace')
    expect(fallback.terminal.stdinIsTTY).toBe(true)
    expect(fallback.terminal.stdoutIsTTY).toBe(true)
    fallback.terminal.requestExit(7)
    expect(fallback.requestExit).toHaveBeenCalledWith(7)

    const measured = createTestProcess({ columns: 132 })
    expect(measured.terminal.columns).toBe(132)
  })

  it('disposes resize and terminal-exit subscriptions', () => {
    const { stdin, stdout, terminal } = createTestProcess()
    const resized = vi.fn()
    const exited = vi.fn()
    const stopResize = terminal.onResize(resized)
    const stopExit = terminal.onExit(exited)

    stdout.emit('resize')
    stdin.emit('end')
    expect(resized).toHaveBeenCalledOnce()
    expect(exited).toHaveBeenCalledOnce()

    stopResize()
    stopExit()
    stdout.emit('resize')
    stdin.emit('end')
    expect(resized).toHaveBeenCalledOnce()
    expect(exited).toHaveBeenCalledOnce()
  })

  it('validates dimensions and restores raw input mode', () => {
    const measured = createTestProcess({ columns: -1, rows: 40 })
    expect(measured.terminal.columns).toBe(80)
    expect(measured.terminal.rows).toBe(40)
    measured.stdin.isRaw = true
    measured.terminal.restoreInput()
    expect(measured.stdin.setRawMode).toHaveBeenCalledWith(false)
    expect(measured.stdin.pause).toHaveBeenCalledOnce()

    const idle = createTestProcess({ rows: 0 })
    idle.terminal.restoreInput()
    expect(idle.stdin.setRawMode).not.toHaveBeenCalled()
    expect(idle.terminal.rows).toBeUndefined()
  })

  it('constructs the production adapter from the current process streams', () => {
    expect(() => createTuiProcess(80, vi.fn())).toThrow(/requires interactive stdin and stdout/)
  })
})
