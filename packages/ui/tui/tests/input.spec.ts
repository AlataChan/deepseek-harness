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
  const selectResume = vi.fn(async (_value: string) => {})
  const cancelResume = vi.fn()
  const approval = { allow: vi.fn(), reject: vi.fn(), cancel: vi.fn(), dispose: vi.fn() }
  const questions = { answer: vi.fn(() => true), cancel: vi.fn(), dispose: vi.fn() }
  const input = createTuiInputDriver({
    store, route, cancelTurn, requestShutdown, openResume, selectResume, cancelResume,
    isTurnActive: () => active,
    approval, questions,
  })
  return {
    store, route, cancelTurn, requestShutdown, openResume, selectResume, cancelResume,
    approval, questions, input, setActive(value: boolean) { active = value },
  }
}

describe('tui semantic input', () => {
  it('submits on Enter and inserts a newline on Ctrl+J', async () => {
    const test = bench()
    await test.input.handle('hello', {})
    await test.input.handle('j', { ctrl: true })
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
    await test.input.handle('r', { ctrl: true })
    expect(test.openResume).toHaveBeenCalledOnce()
  })

  it('cancels active work on the first Ctrl+C and shuts down on a second while cancellation drains', async () => {
    const test = bench()
    test.setActive(true)
    await test.input.handle('c', { ctrl: true })
    expect(test.cancelTurn).toHaveBeenCalledOnce()
    expect(test.requestShutdown).not.toHaveBeenCalled()
    await test.input.handle('c', { ctrl: true })
    expect(test.requestShutdown).toHaveBeenCalledOnce()
  })

  it('returns to idle draft handling when cancellation finished before the next Ctrl+C', async () => {
    const test = bench()
    test.setActive(true)
    await test.input.handle('c', { ctrl: true })
    test.setActive(false)
    await test.input.handle('draft', {})
    await test.input.handle('c', { ctrl: true })
    expect(test.store.getSnapshot().editor.text).toBe('')
    expect(test.requestShutdown).not.toHaveBeenCalled()
  })

  it('clears an idle draft before an empty-draft Ctrl+C requests exit and rejects input after shutdown starts', async () => {
    const test = bench()
    await test.input.handle('draft', {})
    await test.input.handle('c', { ctrl: true })
    expect(test.store.getSnapshot().editor.text).toBe('')
    await test.input.handle('c', { ctrl: true })
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

  it('maps every navigation and deletion key and ignores modified input', async () => {
    const test = bench()
    await test.input.handle('abc', {})
    await test.input.handle('', { name: 'home' })
    await test.input.handle('', { end: true })
    await test.input.handle('', { home: true })
    await test.input.handle('', { rightArrow: true })
    await test.input.handle('', { delete: true })
    await test.input.handle('', { name: 'end' })
    await test.input.handle('', { leftArrow: true })
    await test.input.handle('', { backspace: true })
    await test.input.handle('', { upArrow: true })
    await test.input.handle('', { downArrow: true })
    await test.input.handle('ignored', { ctrl: true })
    await test.input.handle('ignored', { meta: true })
    expect(test.store.getSnapshot().editor.text).toBe('c')
  })

  it('settles approval keys and question cancel/answer input', async () => {
    const test = bench()
    test.store.dispatch({ type: 'interaction/approval', id: 1 as never, toolName: 'bash' })
    await test.input.handle('Y', {})
    await test.input.handle('n', {})
    await test.input.handle('', { escape: true })
    await test.input.handle('x', {})
    expect(test.approval.allow).toHaveBeenCalledWith(1)
    expect(test.approval.reject).toHaveBeenCalledTimes(2)

    test.store.dispatch({ type: 'interaction/settled', id: 1 as never })
    test.store.dispatch({
      type: 'interaction/question', id: 2 as never,
      questions: [
        { id: 'one', question: 'One?', options: [{ label: 'A' }, { label: 'B' }] },
        { id: 'many', question: 'Many?', options: [{ label: 'X' }, { label: 'Y' }], multiSelect: true },
        { id: 'free', question: 'Free?' },
      ],
    })
    await test.input.handle('A; X,custom; words', {})
    await test.input.handle('', { return: true })
    expect(test.questions.answer).toHaveBeenCalledWith(2, { answers: [
      { id: 'one', selected: ['A'] },
      { id: 'many', selected: ['X'], custom: 'X,custom' },
      { id: 'free', selected: [], custom: 'words' },
    ] })
    test.store.dispatch({ type: 'interaction/question', id: 3 as never, questions: [] })
    await test.input.handle('', { name: 'escape' })
    expect(test.questions.cancel).toHaveBeenCalledWith(3)
  })

  it('keeps invalid question batches pending', async () => {
    const test = bench()
    test.store.dispatch({
      type: 'interaction/question', id: 4 as never,
      questions: [{ id: 'one', question: 'One?' }, { id: 'two', question: 'Two?' }],
    })
    await test.input.handle('one', {})
    await test.input.handle('', { return: true })
    expect(test.questions.answer).not.toHaveBeenCalled()

    const empty = bench()
    await empty.input.handle('', { return: true })
    expect(empty.route).not.toHaveBeenCalled()
  })

  it('selects and cancels resume overlays and restores failed selections', async () => {
    const selected = bench()
    selected.store.dispatch({ type: 'overlay/open', overlay: { kind: 'resume' } })
    await selected.input.handle('2', {})
    await selected.input.handle('', { return: true })
    expect(selected.selectResume).toHaveBeenCalledWith('2')

    const failed = bench()
    failed.selectResume.mockRejectedValueOnce(new Error('missing'))
    failed.store.dispatch({ type: 'overlay/open', overlay: { kind: 'resume' } })
    await failed.input.handle('missing', {})
    await failed.input.handle('', { return: true })
    expect(failed.store.getSnapshot().editor.text).toBe('missing')
    await failed.input.handle('', { escape: true })
    expect(failed.cancelResume).toHaveBeenCalledOnce()
  })

  it('ignores ordinary input while active and aborts an in-flight command on reject', async () => {
    const active = bench()
    active.setActive(true)
    await active.input.handle('ignored', {})
    expect(active.store.getSnapshot().editor.text).toBe('')

    const pending = bench()
    const routed = Promise.withResolvers<TuiCommandRoute>()
    pending.route.mockReturnValueOnce(routed.promise)
    await pending.input.handle('wait', {})
    const submit = pending.input.handle('', { return: true })
    pending.input.reject()
    pending.input.reject()
    expect(pending.route.mock.calls[0]?.[1].aborted).toBe(true)
    routed.resolve('accepted')
    await submit
  })
})
