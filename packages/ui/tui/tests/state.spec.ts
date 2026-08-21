import { describe, expect, it, vi } from 'vitest'
import {
  createInitialState,
  mintInteractionId,
  reduceTuiState,
  type TranscriptRowInput,
} from '../src/state/reducer.ts'
import { createTuiStore } from '../src/state/store.ts'

function row(text: string): TranscriptRowInput {
  return { kind: 'message', role: 'assistant', text }
}

describe('tui state', () => {
  it('starts fresh with one idle redraw region', () => {
    expect(createInitialState({ columns: 80, rows: 24 })).toMatchObject({
      finalizedRows: [],
      liveAssistant: undefined,
      overlay: { kind: 'none' },
      interaction: undefined,
      status: { kind: 'idle' },
      dimensions: { columns: 80, rows: 24 },
      disposed: false,
    })
  })

  it('assigns monotonic finalized row ids and owns one live assistant row', () => {
    let state = createInitialState({ columns: 80 })
    state = reduceTuiState(state, { type: 'assistant/live', text: 'hel' })
    state = reduceTuiState(state, { type: 'assistant/live', text: 'hello' })
    expect(state.liveAssistant).toEqual({ id: 1, text: 'hello' })

    state = reduceTuiState(state, { type: 'assistant/finalize', row: row('hello') })
    state = reduceTuiState(state, { type: 'transcript/finalize', row: row('again') })
    expect(state.finalizedRows.map(item => [item.id, item.text])).toEqual([
      [1, 'hello'],
      [2, 'again'],
    ])
    expect(state.liveAssistant).toBeUndefined()
  })

  it('keeps overlays exclusive and interactions owned by opaque ids', () => {
    const approvalId = mintInteractionId()
    const questionId = mintInteractionId()
    let state = createInitialState({ columns: 80 })
    state = reduceTuiState(state, { type: 'overlay/open', overlay: { kind: 'help' } })
    state = reduceTuiState(state, {
      type: 'interaction/approval', id: approvalId, toolName: 'bash', reason: 'Allow?',
    })
    expect(state.overlay).toEqual({ kind: 'approval', id: approvalId })
    expect(state.interaction).toEqual({
      kind: 'approval', id: approvalId, toolName: 'bash', reason: 'Allow?',
    })

    state = reduceTuiState(state, {
      type: 'interaction/question',
      id: questionId,
      questions: [{ id: 'choice', question: 'Which one?', options: [{ label: 'A' }, { label: 'B' }] }],
    })
    expect(state.overlay).toEqual({ kind: 'question', id: questionId })
    expect(state.interaction?.id).toBe(questionId)

    state = reduceTuiState(state, { type: 'interaction/settled', id: approvalId })
    expect(state.interaction?.id).toBe(questionId)
    state = reduceTuiState(state, { type: 'interaction/settled', id: questionId })
    expect(state.interaction).toBeUndefined()
    expect(state.overlay).toEqual({ kind: 'none' })
  })

  it('records resize and runtime failure before disposal becomes terminal', () => {
    let state = createInitialState({ columns: 80 })
    state = reduceTuiState(state, { type: 'terminal/resize', columns: 120, rows: 40 })
    state = reduceTuiState(state, { type: 'runtime/failed', message: 'boom' })
    expect(state.dimensions).toEqual({ columns: 120, rows: 40 })
    expect(state.status).toEqual({ kind: 'failed', message: 'boom' })

    state = reduceTuiState(state, { type: 'runtime/dispose' })
    expect(state.disposed).toBe(true)
    expect(state.overlay).toEqual({ kind: 'none' })
    expect(state.interaction).toBeUndefined()
    expect(reduceTuiState(state, { type: 'assistant/live', text: 'late' })).toBe(state)
  })
})

describe('tui store', () => {
  it('publishes immutable snapshots through the narrow store interface', () => {
    const store = createTuiStore(createInitialState({ columns: 80 }))
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    store.dispatch({ type: 'transcript/finalize', row: row('hello') })

    expect(listener).toHaveBeenCalledOnce()
    expect(Object.isFrozen(store.getSnapshot())).toBe(true)
    expect(Object.isFrozen(store.getSnapshot().finalizedRows)).toBe(true)
    unsubscribe()
    store.dispatch({ type: 'terminal/resize', columns: 100 })
    expect(listener).toHaveBeenCalledOnce()
  })
})
