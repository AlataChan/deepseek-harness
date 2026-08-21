import { EventEmitter } from 'node:events'
import { renderToString } from 'ink'
import { describe, expect, it, vi } from 'vitest'
import { TuiApp } from '../src/render/app.tsx'
import { startTuiRender } from '../src/render/start.tsx'
import { createInitialState } from '../src/state/reducer.ts'
import { createTuiStore } from '../src/state/store.ts'
import { createEditorState } from '../src/state/editor.ts'
import { createTuiProcessForTest } from '../src/process.ts'
import { SessionId } from '@deepseek-ai/dsh-session'

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
  write(chunk: string | Uint8Array): boolean {
    this.chunks.push(String(chunk))
    return true
  }
}

function renderBench(columns = 80) {
  const stdin = new TestInput()
  const stdout = new TestOutput()
  const stderr = new TestOutput()
  stdout.columns = columns
  const process = createTuiProcessForTest({
    stdin: stdin as never,
    stdout: stdout as never,
    stderr: stderr as never,
    cwd: '/workspace',
    requestExit: vi.fn(),
    terminalColumnsFallback: 80,
  })
  const store = createTuiStore(createInitialState({ columns, rows: 24 }))
  return { stdin, stdout, process, store }
}

describe('inline Ink application', () => {
  it('renders the welcome line, status, composer, resume selector, and failure state', async () => {
    const test = renderBench()
    test.store.dispatch({ type: 'overlay/open', overlay: { kind: 'resume' } })
    const view = startTuiRender(test.store, test.process, {
      resumeRows: [{
        sessionId: SessionId('session-1'), title: 'First task', createdAt: 1, cwd: '/workspace',
      }],
    })
    await view.waitUntilRenderFlush()
    expect(test.stdout.chunks.join('')).toContain('DeepSeek Harness · dsh')
    expect(test.stdout.chunks.join('')).toContain('Status: ready')
    expect(test.stdout.chunks.join('')).toContain('You ›')
    expect(test.stdout.chunks.join('')).toContain('First task')

    test.store.dispatch({ type: 'runtime/failed', message: 'provider unavailable' })
    await view.waitUntilRenderFlush()
    expect(test.stdout.chunks.join('')).toContain('Error: provider unavailable')
    view.unmount()
    await view.waitUntilExit()
  })

  it('subscribes through the store and renders its editor without a component-owned copy', async () => {
    const test = renderBench()
    const view = startTuiRender(test.store, test.process)
    await view.waitUntilRenderFlush()

    test.store.dispatch({ type: 'editor/update', editor: createEditorState('draft from store') })
    test.store.dispatch({ type: 'runtime/running' })
    await view.waitUntilRenderFlush()

    expect(test.stdout.chunks.join('')).toContain('draft from store')
    expect(test.stdout.chunks.join('')).toContain('Status: working')
    view.unmount()
    await view.waitUntilExit()
  })

  it('uses a compact shell when terminal columns are narrow', () => {
    const test = renderBench(38)
    const output = renderToString(<TuiApp store={test.store} />, { columns: 38 })

    expect(output).toContain('dsh')
    expect(output).toContain('ready')
    expect(output).toContain('›')
    expect(output).not.toContain('DeepSeek Harness · dsh')
    expect(output.split('\n').every(line => line.length <= 38)).toBe(true)
  })
})
