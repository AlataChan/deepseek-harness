import { EventEmitter } from 'node:events'
import React from 'react'
import { renderToString } from 'ink'
import { describe, expect, it, vi } from 'vitest'
import { TuiApp } from '../src/render/app.tsx'
import { Overlays } from '../src/render/overlays.tsx'
import { TranscriptTool } from '../src/render/transcript.tsx'
import { startTuiRender } from '../src/render/start.tsx'
import { createInitialState } from '../src/state/reducer.ts'
import { createTuiStore } from '../src/state/store.ts'

void React
import { createEditorState } from '../src/state/editor.ts'
import { createTuiProcessForTest } from '../src/process.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createTranscriptProjection, type ProjectedTranscriptRow } from '../src/transcript/project.ts'
import type { TuiInputKey } from '../src/driver/input.ts'

class TestInput extends EventEmitter {
  readonly isTTY = true
  isRaw = false
  private readonly values: string[] = []
  setRawMode(value: boolean): this { this.isRaw = value; return this }
  resume(): this { return this }
  pause(): this { return this }
  setEncoding(): this { return this }
  ref(): this { return this }
  unref(): this { return this }
  read(): string | null { return this.values.shift() ?? null }
  pushInput(value: string): void { this.values.push(value); this.emit('readable') }
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

  it('renders help, empty resume, approval, and question overlay variants', () => {
    const test = renderBench()
    test.store.dispatch({ type: 'overlay/open', overlay: { kind: 'help' } })
    expect(renderToString(<TuiApp store={test.store} />)).toContain('Keyboard help')
    test.store.dispatch({ type: 'overlay/open', overlay: { kind: 'resume' } })
    expect(renderToString(<TuiApp store={test.store} />)).toContain('No saved sessions')
    test.store.dispatch({
      type: 'interaction/approval', id: 1 as never, toolName: 'bash',
    })
    expect(renderToString(<TuiApp store={test.store} />)).toContain('Approval required')
    test.store.dispatch({
      type: 'interaction/question', id: 2 as never,
      questions: [{ id: 'many', question: 'Choose', multiSelect: true }],
    })
    expect(renderToString(<TuiApp store={test.store} />)).toContain('Select one or more')
    expect(renderToString(<Overlays
      overlay={{ kind: 'resume' }} interaction={undefined}
      resumeRows={[{ sessionId: SessionId('plain'), title: 'Plain', createdAt: 1, cwd: undefined }]}
    />)).toContain('Plain · plain')
    expect(renderToString(<Overlays
      overlay={{ kind: 'approval', id: 3 as never }} interaction={undefined} resumeRows={[]}
    />)).toBe('')
    expect(renderToString(<Overlays
      overlay={{ kind: 'question', id: 4 as never }} interaction={undefined} resumeRows={[]}
    />)).toBe('')
  })

  it('renders projected transcript variants with default and tool-owned cards', () => {
    const rows: ProjectedTranscriptRow[] = [
      { kind: 'message', sourceSeq: 1, role: 'user', text: 'hello' as never },
      { kind: 'message', sourceSeq: 2, role: 'assistant', text: 'answer' as never },
      { kind: 'reasoning', sourceSeq: 3, text: 'thought' as never },
      { kind: 'command', sourceSeq: 4, commandId: 'c', phase: 'running', name: 'help' as never, text: undefined },
      { kind: 'command', sourceSeq: 4, commandId: 'c2', phase: 'success', name: undefined, text: 'done' as never },
      { kind: 'retry', sourceSeq: 5, phase: 'waiting', retry: 1, text: 'retrying' as never },
      { kind: 'status', sourceSeq: 6, text: 'status' as never },
      { kind: 'error', sourceSeq: 7, text: 'failure' as never },
      { kind: 'tool-call', sourceSeq: 8, callId: 'tool', name: '', arguments: '{}' },
      {
        kind: 'tool-result', sourceSeq: 9, callId: 'tool', name: 'bash', arguments: '{}',
        text: 'done' as never, content: [], isError: false, error: undefined, meta: undefined,
      },
    ]
    const projection = {
      ...createTranscriptProjection(), rows,
      liveReasoning: 'live thought' as never, liveAssistant: 'live answer' as never,
    }
    const store = createTuiStore(createInitialState({ columns: 80 }))
    store.dispatch({ type: 'transcript/sync', projection })
    const fallback = renderToString(<TuiApp store={store} />)
    expect(fallback).toContain('Tool')
    expect(fallback).toContain('Reasoning')
    expect(fallback).toContain('Command')
    const projectedTool = {
      callId: 'tool', name: 'bash' as never, title: 'Projected bash' as never,
      phase: 'result' as const, isError: false,
      detail: { card: 'generic' as const, content: ['safe' as never] },
    }
    const projectTool = vi.fn(() => projectedTool)
    expect(renderToString(<TuiApp store={store} projectTool={projectTool} />)).toContain('Projected bash')
    expect(projectTool).toHaveBeenCalledTimes(2)
    expect(renderToString(<TranscriptTool model={projectedTool} />)).toContain('Projected bash')

    store.dispatch({ type: 'transcript/finalize', row: { kind: 'system', text: 'local system' } })
    store.dispatch({ type: 'transcript/finalize', row: { kind: 'error', text: 'local error' } })
    store.dispatch({ type: 'transcript/finalize', row: { kind: 'message', role: 'user', text: 'local user' } })
    store.dispatch({ type: 'assistant/live', text: 'local live' })
    const local = renderToString(<TuiApp store={store} />)
    expect(local).toContain('System')
    expect(local).toContain('Error')
    expect(local).toContain('local live')
  })

  it('forwards terminal input and reports rejected input handlers', async () => {
    const test = renderBench()
    const handle = vi.fn<(input: string, key: TuiInputKey) => Promise<void>>(
      async () => { throw new Error('input failed') },
    )
    const view = startTuiRender(test.store, test.process, {
      input: { handle, reject: vi.fn() }, getResumeRows: () => [],
      projectTool: () => ({
        callId: 'unused', name: 'unused' as never, title: 'unused' as never,
        phase: 'call', isError: false, detail: { card: 'generic', content: [] },
      }),
    })
    await view.waitUntilRenderFlush()
    test.stdin.pushInput('x')
    await new Promise(resolve => setImmediate(resolve))
    await view.waitUntilRenderFlush()
    expect(handle).toHaveBeenCalled()
    expect(test.store.getSnapshot().status).toEqual({ kind: 'failed', message: 'input failed' })
    handle.mockRejectedValue('string failure')
    test.stdin.pushInput('\r')
    test.stdin.pushInput('\n')
    await new Promise(resolve => setImmediate(resolve))
    await view.waitUntilRenderFlush()
    expect(test.store.getSnapshot().status).toEqual({ kind: 'failed', message: 'string failure' })
    handle.mockResolvedValueOnce(undefined)
    test.stdin.pushInput('\u001b')
    await new Promise(resolve => setImmediate(resolve))
    view.unmount()
    await view.waitUntilExit()
  })
})
