// @vitest-environment jsdom
/** VS Code Client Plugin assembly over real slots and test-owned service faces. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { EditorContextId, type EditorContextSnapshot, type IdeEvent, type IdeMethodMap } from '@deepseek-ai/dsh-client-connection-vscode/protocol'
import type { VsCodeIdePort } from '@deepseek-ai/dsh-client-connection-vscode/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { SlotMap } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject } from '../src/client/index.ts'

afterEach(cleanup)

type InputZone = SlotMap['conversation.input.left']['owner']

const EMPTY_INPUT: InputZone['input'] = {
  draft: '', imageIds: [], draftRev: 0, phase: 'plain', occurrences: [], queue: [],
}

function snapshot(id: string, kind: EditorContextSnapshot['kind'] = 'selection'): EditorContextSnapshot {
  return {
    id: EditorContextId(id),
    kind,
    uri: 'file:///workspace/src/main.ts',
    workspacePath: 'src/main.ts',
    languageId: 'typescript',
    version: 1,
    ...(kind === 'selection'
      ? { range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 5 } }
      : {}),
    text: kind === 'diagnostics' ? '[]' : 'value',
    capturedAt: 1,
  }
}

class IdeHarness implements VsCodeIdePort {
  readonly handlers = new Map<keyof IdeMethodMap, (payload: unknown) => unknown>()
  readonly listeners = new Set<(event: IdeEvent) => void>()
  readonly requests: (keyof IdeMethodMap)[] = []
  selectedRoot = () => Promise.resolve({ workspaceRoot: '/workspace' })
  captureResult: EditorContextSnapshot | null | undefined
  private captureId = 0

  request<K extends keyof IdeMethodMap>(
    method: K,
    _payload: IdeMethodMap[K]['payload'],
  ): Promise<IdeMethodMap[K]['result']> {
    this.requests.push(method)
    if (method === 'workspace.getSelectedRoot') return this.selectedRoot()
    if (this.captureResult !== undefined) return Promise.resolve(this.captureResult)
    this.captureId += 1
    const kind = method === 'editor.captureFile'
      ? 'file'
      : method === 'editor.captureDiagnostics'
        ? 'diagnostics'
        : 'selection'
    return Promise.resolve(snapshot(`capture-${String(this.captureId)}`, kind))
  }

  handle<K extends keyof IdeMethodMap>(
    method: K,
    handler: (payload: IdeMethodMap[K]['payload']) => IdeMethodMap[K]['result'] | Promise<IdeMethodMap[K]['result']>,
  ): () => void {
    const erased = handler as (payload: unknown) => unknown
    this.handlers.set(method, erased)
    return () => { if (this.handlers.get(method) === erased) this.handlers.delete(method) }
  }

  subscribeEvents(listener: (event: IdeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  emit(event: IdeEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

async function bench(options: { initialRootFailure?: unknown; initialSession?: boolean } = {}) {
  const runtime = await SlotTestRuntime.create()
  if (options.initialSession !== false) await runtime.sessions.add({ id: 's1' })
  runtime.workspaces.stub('connectWorkspace', () => Promise.resolve('s1'))
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('zh')
  runtime.provide('locale', locale)
  runtime.slots.installLocale(locale)
  const ide = new IdeHarness()
  if (options.initialRootFailure !== undefined) {
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- exercises normalization of an unknown provider rejection.
    ide.selectedRoot = () => Promise.reject(options.initialRootFailure)
  }
  runtime.provide('vscodeIde', ide)
  const sourceDisposer = vi.fn()
  let registeredSource: InputTriggerSource | undefined
  runtime.provide('inputTriggers', {
    registerSource: (source) => {
      registeredSource = source
      return sourceDisposer
    },
  })
  const appendReference = vi.fn(() => true)
  const notify = vi.fn()
  const sessionInput: ReturnType<IConversation['input']['for']> = {
    beginCommand: () => false,
    insertReference: () => false,
    setDraft: () => {},
    addImages: () => false,
    removeImage: () => {},
    pruneImages: () => {},
    submit: () => {},
    notify,
    state: createSnapshotStore(EMPTY_INPUT),
  }
  runtime.provide('conversation', {
    appendReference,
    input: { for: () => sessionInput },
  })
  await runtime.declare({ 'conversation.input.left': { kind: 'list', scope: 'session' } })
  await runtime.mount({ apply, inject })
  return { runtime, ide, appendReference, notify, sourceDisposer, source: () => registeredSource }
}

function owner(runtime: SlotTestRuntime): InputZone {
  return {
    session: runtime.sessions.binding('s1')!.session.getSnapshot(),
    input: EMPTY_INPUT,
  }
}

describe('ui-vscode apply', () => {
  it('registers the initial root and exposes Webview lifecycle handlers', async () => {
    const b = await bench()
    await vi.waitFor(() => {
      expect(b.runtime.workspaces.calls.map(call => call.method)).toEqual(['create', 'connectWorkspace'])
    })
    expect(b.runtime.sessions.calls.at(-1)).toEqual({ method: 'open', args: ['s1'] })
    expect(b.source()).toMatchObject({ trigger: '@', name: 'ide-context' })
    expect(await b.ide.handlers.get('webview.getTurnState')?.({})).toEqual({ running: false })
    await b.runtime.sessions.updateSnapshot('s1', (draft) => { draft.running = true })
    expect(await b.ide.handlers.get('webview.getTurnState')?.({})).toEqual({ running: true })
    expect(await b.ide.handlers.get('webview.newSession')?.({})).toEqual({})
    expect(b.runtime.workspaces.calls.at(-1)).toEqual({ method: 'startSession', args: [undefined] })
    await b.runtime.dispose()
    expect(b.sourceDisposer).toHaveBeenCalledOnce()
    expect(b.ide.handlers.size).toBe(0)
    expect(b.ide.listeners.size).toBe(0)
  })

  it('captures all three actions from the composer and appends their immutable ids', async () => {
    const b = await bench()
    b.runtime.renderSlot('conversation.input.left', owner(b.runtime))
    for (const [index, label] of ['当前选区', '当前文件', '当前文件的问题'].entries()) {
      fireEvent.click(screen.getByRole('button', { name: '添加编辑器上下文' }))
      fireEvent.click(screen.getByRole('menuitem', { name: label }))
      await waitFor(() => {
        expect(b.appendReference).toHaveBeenCalledTimes(index + 1)
        expect(screen.getByRole<HTMLButtonElement>('button', { name: '添加编辑器上下文' }).disabled).toBe(false)
      })
    }
    expect(b.ide.requests).toEqual([
      'workspace.getSelectedRoot',
      'editor.captureSelection',
      'editor.captureFile',
      'editor.captureDiagnostics',
    ])
    expect(b.appendReference).toHaveBeenNthCalledWith(1, expect.objectContaining({ ref: 'capture-1' }))
    expect(b.appendReference).toHaveBeenNthCalledWith(2, expect.objectContaining({ ref: 'capture-2' }))
    expect(b.appendReference).toHaveBeenNthCalledWith(3, expect.objectContaining({ ref: 'capture-3' }))
    await b.runtime.dispose()
  })

  it('handles selected-root and command-captured events and reports refused input', async () => {
    const b = await bench()
    b.ide.emit({ type: 'ide/event', event: 'workspace.selected', payload: { workspaceRoot: '/next' } })
    await vi.waitFor(() => {
      expect(b.runtime.workspaces.calls.some(call => call.method === 'create' && (call.args[0] as { path: string }).path === '/next')).toBe(true)
    })
    b.ide.emit({ type: 'ide/event', event: 'runtime.state', payload: { state: 'ready' } })
    b.appendReference.mockReturnValueOnce(false)
    b.ide.emit({
      type: 'ide/event', event: 'editor.contextCaptured', payload: { snapshot: snapshot('command-1') },
    })
    expect(b.notify).toHaveBeenCalledWith('error', '输入正在提交，请稍后重试。')
    const multiline = snapshot('command-2')
    delete multiline.workspacePath
    multiline.range = { startLine: 1, startColumn: 0, endLine: 3, endColumn: 1 }
    b.ide.emit({ type: 'ide/event', event: 'editor.contextCaptured', payload: { snapshot: multiline } })
    expect(b.appendReference).toHaveBeenLastCalledWith(expect.objectContaining({
      label: 'file:///workspace/src/main.ts:2-4',
    }))
    await b.runtime.dispose()
  })

  it('reports an event append failure without escaping the event listener', async () => {
    const b = await bench()
    b.appendReference.mockImplementationOnce(() => { throw new Error('scope disposed') })
    expect(() => {
      b.ide.emit({ type: 'ide/event', event: 'editor.contextCaptured', payload: { snapshot: snapshot('command-3') } })
    }).not.toThrow()
    expect(b.notify).toHaveBeenCalledWith('error', '添加编辑器上下文失败。 scope disposed')
    const transportClosed = { toString: () => 'transport closed' }
    b.appendReference.mockImplementationOnce(() => { throw transportClosed })
    b.ide.emit({
      type: 'ide/event', event: 'editor.contextCaptured', payload: { snapshot: snapshot('command-4') },
    })
    expect(b.notify).toHaveBeenCalledWith('error', '添加编辑器上下文失败。 transport closed')
    await b.runtime.dispose()
  })

  it('returns empty and busy capture outcomes to the composer control', async () => {
    const b = await bench()
    b.runtime.renderSlot('conversation.input.left', owner(b.runtime))
    b.ide.captureResult = null
    fireEvent.click(screen.getByRole('button', { name: '添加编辑器上下文' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '当前文件' }))
    expect((await screen.findByRole('status')).textContent).toBe('没有可添加的编辑器上下文。')

    b.ide.captureResult = snapshot('busy-file', 'file')
    b.appendReference.mockReturnValueOnce(false)
    fireEvent.click(screen.getByRole('button', { name: '添加编辑器上下文' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '当前文件' }))
    expect((await screen.findByRole('status')).getAttribute('title')).toBe('输入正在提交，请稍后重试。')
    await b.runtime.dispose()
  })

  it('answers lifecycle calls and ignores editor events before a session exists', async () => {
    const b = await bench({ initialRootFailure: 'root missing', initialSession: false })
    await vi.waitFor(() => { expect(b.ide.handlers.has('webview.getTurnState')).toBe(true) })
    expect(await b.ide.handlers.get('webview.getTurnState')?.({})).toEqual({ running: false })
    b.ide.emit({ type: 'ide/event', event: 'editor.contextCaptured', payload: { snapshot: snapshot('orphan') } })
    expect(b.appendReference).not.toHaveBeenCalled()
    expect(b.notify).not.toHaveBeenCalled()
    await b.runtime.dispose()
  })

  it('reports initial-root and later selection failures without poisoning event handling', async () => {
    const b = await bench({ initialRootFailure: new Error('root unavailable') })
    await vi.waitFor(() => {
      expect(b.notify).toHaveBeenCalledWith('error', '无法打开所选工作区。 root unavailable')
    })
    b.runtime.workspaces.stub('create', () => Promise.reject(new Error('invalid root')))
    b.ide.emit({ type: 'ide/event', event: 'workspace.selected', payload: { workspaceRoot: '/invalid' } })
    await vi.waitFor(() => {
      expect(b.notify).toHaveBeenCalledWith('error', '无法打开所选工作区。 invalid root')
    })
    await b.runtime.dispose()
  })

  it('reports non-Error selected-root failures', async () => {
    const b = await bench()
    await vi.waitFor(() => {
      expect(b.runtime.workspaces.calls.some(call => call.method === 'connectWorkspace')).toBe(true)
    })
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- exercises normalization of an unknown Workspace rejection.
    b.runtime.workspaces.stub('create', () => Promise.reject('invalid root'))
    b.ide.emit({ type: 'ide/event', event: 'workspace.selected', payload: { workspaceRoot: '/invalid' } })
    await vi.waitFor(() => {
      expect(b.notify).toHaveBeenCalledWith('error', '无法打开所选工作区。 invalid root')
    })
    await b.runtime.dispose()
  })

  it('fails loud without the shell-provided IDE port', () => {
    expect(() => { apply({ get: () => undefined } as never) }).toThrow('vscodeIde service is unavailable')
  })
})
