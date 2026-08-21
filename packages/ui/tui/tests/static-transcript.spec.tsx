import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createTuiProcessForTest } from '../src/process.ts'
import { startTuiRender } from '../src/render/start.tsx'
import { createInitialState } from '../src/state/reducer.ts'
import { createTuiStore } from '../src/state/store.ts'
import { createTranscriptProjection } from '../src/transcript/project.ts'
import { displayText } from '../src/transcript/display-text.ts'

class TestInput extends EventEmitter {
  readonly isTTY = true
  isRaw = false
  setRawMode(value: boolean): this { this.isRaw = value; return this }
  resume(): this { return this }
  pause(): this { return this }
  setEncoding(): this { return this }
}

class TestOutput extends EventEmitter {
  readonly isTTY = true
  readonly chunks: string[] = []
  columns = 80
  rows = 24
  write(chunk: string | Uint8Array): boolean { this.chunks.push(String(chunk)); return true }
}

function occurrences(value: string, needle: string): number {
  return value.split(needle).length - 1
}

describe('inline transcript scrollback', () => {
  it('prints each finalized monotonic row once while live output redraws', async () => {
    const stdin = new TestInput()
    const stdout = new TestOutput()
    const stderr = new TestOutput()
    const process = createTuiProcessForTest({
      stdin: stdin as never,
      stdout: stdout as never,
      stderr: stderr as never,
      cwd: '/workspace',
      requestExit: vi.fn(),
      terminalColumnsFallback: 80,
    })
    const store = createTuiStore(createInitialState({ columns: 80, rows: 24 }))
    const view = startTuiRender(store, process)
    await view.waitUntilRenderFlush()

    store.dispatch({
      type: 'transcript/finalize', row: { kind: 'message', role: 'user', text: 'alpha-final' },
    })
    await view.waitUntilRenderFlush()
    store.dispatch({ type: 'assistant/live', text: 'hel-live' })
    await view.waitUntilRenderFlush()
    store.dispatch({ type: 'assistant/live', text: 'hello-live' })
    await view.waitUntilRenderFlush()
    store.dispatch({
      type: 'assistant/finalize', row: { kind: 'message', role: 'assistant', text: 'hello-final' },
    })
    store.dispatch({
      type: 'transcript/finalize', row: { kind: 'system', text: 'omega-final' },
    })
    await view.waitUntilRenderFlush()
    view.unmount()
    await view.waitUntilExit()

    const output = stdout.chunks.join('')
    expect(occurrences(output, 'alpha-final')).toBe(1)
    expect(occurrences(output, 'hello-final')).toBe(1)
    expect(occurrences(output, 'omega-final')).toBe(1)
  })

  it('renders durable projection rows appended after the renderer mounts', async () => {
    const stdin = new TestInput()
    const stdout = new TestOutput()
    const stderr = new TestOutput()
    const process = createTuiProcessForTest({
      stdin: stdin as never,
      stdout: stdout as never,
      stderr: stderr as never,
      cwd: '/workspace',
      requestExit: vi.fn(),
      terminalColumnsFallback: 80,
    })
    const store = createTuiStore(createInitialState({ columns: 80, rows: 24 }))
    const view = startTuiRender(store, process)
    await view.waitUntilRenderFlush()
    const empty = createTranscriptProjection()
    const text = (value: string) => displayText(value, { maxBytes: 1_000, maxColumns: 1_000 })
    store.dispatch({
      type: 'transcript/sync',
      projection: { ...empty, rows: [{ kind: 'message', sourceSeq: 1, role: 'user', text: text('projected-user') }] },
    })
    await view.waitUntilRenderFlush()
    expect(stdout.chunks.join('')).toContain('projected-user')
    store.dispatch({
      type: 'transcript/sync',
      projection: {
        ...empty,
        rows: [
          { kind: 'message', sourceSeq: 1, role: 'user', text: text('projected-user') },
          { kind: 'tool-call', sourceSeq: 2, callId: 'call-1', name: 'bash', arguments: '{"command":"echo projected-tool"}' },
        ],
      },
    })
    await view.waitUntilRenderFlush()
    const rendered = stdout.chunks.join('')
    expect(rendered).toContain('projected-user')
    expect(rendered).toContain('echo projected-tool')
    view.unmount()
    await view.waitUntilExit()
  })
})
