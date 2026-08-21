import { describe, expect, it, vi } from 'vitest'
import {
  createInitialState,
  mintInteractionId,
  reduceTuiState,
  type TranscriptRowInput,
} from '../src/state/reducer.ts'
import { createTuiStore } from '../src/state/store.ts'
import { selectCanResume, selectCanSubmit, selectHasLiveRegion } from '../src/state/selectors.ts'
import { createTranscriptProjection } from '../src/transcript/project.ts'

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

  it('covers idle transitions, editor synchronization, and guarded overlay closing', () => {
    let state = createInitialState({ columns: 80 })
    const editor = { ...state.editor, text: 'draft', cursor: 5 }
    state = reduceTuiState(state, { type: 'editor/update', editor })
    state = reduceTuiState(state, { type: 'runtime/running' })
    state = reduceTuiState(state, { type: 'runtime/idle' })
    state = reduceTuiState(state, { type: 'overlay/open', overlay: { kind: 'help' } })
    state = reduceTuiState(state, { type: 'overlay/close' })
    expect(state).toMatchObject({ editor, status: { kind: 'idle' }, overlay: { kind: 'none' } })

    const id = mintInteractionId()
    state = reduceTuiState(state, { type: 'interaction/approval', id, toolName: 'bash', callId: 'call' })
    expect(reduceTuiState(state, { type: 'overlay/close' })).toBe(state)
    expect(() => reduceTuiState(state, { type: 'unknown' } as never)).toThrow(/unsupported action/)
  })

  it('derives submit, resume, and live-region availability', () => {
    let state = createInitialState({ columns: 80 })
    expect([selectCanSubmit(state), selectCanResume(state), selectHasLiveRegion(state)])
      .toEqual([true, true, false])
    state = reduceTuiState(state, { type: 'assistant/live', text: 'live' })
    expect(selectHasLiveRegion(state)).toBe(true)
    state = reduceTuiState(state, { type: 'assistant/finalize', row: row('done') })
    state = reduceTuiState(state, { type: 'runtime/running' })
    expect([selectCanSubmit(state), selectCanResume(state), selectHasLiveRegion(state)])
      .toEqual([false, false, true])
    state = reduceTuiState(state, { type: 'runtime/idle' })
    state = reduceTuiState(state, { type: 'overlay/open', overlay: { kind: 'help' } })
    expect([selectCanSubmit(state), selectCanResume(state), selectHasLiveRegion(state)])
      .toEqual([true, false, true])
  })

  it('copies optional question fields and synchronizes a projection', () => {
    const id = mintInteractionId()
    let state = createInitialState({ columns: 80 })
    state = reduceTuiState(state, {
      type: 'interaction/question', id,
      questions: [
        { id: 'plain', question: 'Plain?' },
        { id: 'intent', question: 'Intent?', intent: { kind: 'plan-review', approve: 'Approve' } },
      ],
    })
    const projection = createTranscriptProjection()
    state = reduceTuiState(state, { type: 'transcript/sync', projection })
    expect(state.projection).toBe(projection)
    expect(state.interaction).toEqual(expect.objectContaining({ kind: 'question' }))
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
    store.dispatch({ type: 'runtime/dispose' })
    store.dispatch({ type: 'runtime/idle' })
  })

  it('deep-freezes live, interaction, and projection values', () => {
    const store = createTuiStore(createInitialState({ columns: 80 }))
    store.dispatch({ type: 'assistant/live', text: 'live' })
    expect(Object.isFrozen(store.getSnapshot().liveAssistant)).toBe(true)
    store.dispatch({
      type: 'interaction/question', id: mintInteractionId(),
      questions: [{
        id: 'choice', question: 'Pick', options: [{ label: 'A' }],
        intent: { kind: 'plan-review', approve: 'A' },
      }],
    })
    const interaction = store.getSnapshot().interaction
    expect(Object.isFrozen(interaction)).toBe(true)
    if (interaction?.kind !== 'question') throw new Error('question interaction missing')
    expect(Object.isFrozen(interaction.questions[0]?.options?.[0])).toBe(true)
    const projection = createTranscriptProjection()
    store.dispatch({ type: 'transcript/sync', projection })
    expect(Object.isFrozen(store.getSnapshot().projection?.rows)).toBe(true)

    store.dispatch({
      type: 'interaction/approval', id: mintInteractionId(), toolName: 'bash',
    })
    expect(Object.isFrozen(store.getSnapshot().interaction)).toBe(true)
    store.dispatch({
      type: 'interaction/question', id: mintInteractionId(),
      questions: [{ id: 'plain', question: 'Plain?' }],
    })
    expect(Object.isFrozen(store.getSnapshot().interaction)).toBe(true)
  })
})
