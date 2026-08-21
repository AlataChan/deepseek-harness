import { describe, expect, it, vi } from 'vitest'
import { createTuiInputDriver } from '../src/driver/input.ts'
import type { TuiCommandRoute } from '../src/driver/commands.ts'
import { createInitialState } from '../src/state/reducer.ts'
import { createTuiStore } from '../src/state/store.ts'

function bench() {
  const store = createTuiStore(createInitialState({ columns: 80 }))
  let active = false
  const route = vi.fn<(line: string, signal: AbortSignal) => Promise<TuiCommandRoute>>(async () => 'accepted')
  const cancelTurn = vi.fn(() => { active = true })
  const requestShutdown = vi.fn(async () => {})
  const openResume = vi.fn(async () => {})
  const input = createTuiInputDriver({
    store, route, cancelTurn, requestShutdown, openResume,
    isTurnActive: () => active,
    approval: { allow: vi.fn(), reject: vi.fn(), cancel: vi.fn(), dispose: vi.fn() },
    questions: { answer: vi.fn(), cancel: vi.fn(), dispose: vi.fn() },
  })
  return { store, route, cancelTurn, requestShutdown, openResume, input, setActive(value: boolean) { active = value } }
}

describe('tui semantic input', () => {
  it('submits on Enter and inserts a newline on Ctrl+J', async () => {
    const test = bench()
    await test.input.handle('hello', {})
    await test.input.handle('', { ctrl: true, name: 'j' })
    await test.input.handle('world', {})
    expect(test.store.getSnapshot().editor.text).toBe('hello\nworld')

    await test.input.handle('', { name: 'return' })
    expect(test.route).toHaveBeenCalledWith('hello\nworld', expect.any(AbortSignal))
    expect(test.store.getSnapshot().editor.text).toBe('')
  })

  it('closes overlays on Escape and opens resume on Ctrl+R', async () => {
    const test = bench()
    test.store.dispatch({ type: 'overlay/open', overlay: { kind: 'help' } })
    await test.input.handle('', { name: 'escape' })
    expect(test.store.getSnapshot().overlay.kind).toBe('none')
    await test.input.handle('', { ctrl: true, name: 'r' })
    expect(test.openResume).toHaveBeenCalledOnce()
  })

  it('cancels active work on the first Ctrl+C and shuts down on a second while cancellation drains', async () => {
    const test = bench()
    test.setActive(true)
    await test.input.handle('', { ctrl: true, name: 'c' })
    expect(test.cancelTurn).toHaveBeenCalledOnce()
    expect(test.requestShutdown).not.toHaveBeenCalled()
    await test.input.handle('', { ctrl: true, name: 'c' })
    expect(test.requestShutdown).toHaveBeenCalledOnce()
  })

  it('returns to idle draft handling when cancellation finished before the next Ctrl+C', async () => {
    const test = bench()
    test.setActive(true)
    await test.input.handle('', { ctrl: true, name: 'c' })
    test.setActive(false)
    await test.input.handle('draft', {})
    await test.input.handle('', { ctrl: true, name: 'c' })
    expect(test.store.getSnapshot().editor.text).toBe('')
    expect(test.requestShutdown).not.toHaveBeenCalled()
  })

  it('clears an idle draft before an empty-draft Ctrl+C requests exit and rejects input after shutdown starts', async () => {
    const test = bench()
    await test.input.handle('draft', {})
    await test.input.handle('', { ctrl: true, name: 'c' })
    expect(test.store.getSnapshot().editor.text).toBe('')
    await test.input.handle('', { ctrl: true, name: 'c' })
    expect(test.requestShutdown).toHaveBeenCalledOnce()
    test.input.reject()
    await test.input.handle('ignored', {})
    expect(test.store.getSnapshot().editor.text).toBe('')
  })

  it('restores a command draft when routing asks to preserve it', async () => {
    const test = bench()
    test.route.mockResolvedValueOnce('preserve')
    await test.input.handle('/bad', {})
    await test.input.handle('', { name: 'return' })
    expect(test.store.getSnapshot().editor.text).toBe('/bad')
  })
})
