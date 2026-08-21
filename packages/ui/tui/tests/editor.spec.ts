import { describe, expect, it } from 'vitest'
import { createEditorState, reduceEditor } from '../src/state/editor.ts'

function apply(text: string, actions: Parameters<typeof reduceEditor>[1][]) {
  return actions.reduce((state, action) => reduceEditor(state, action).state, createEditorState(text))
}

describe('tui editor', () => {
  it('inserts Unicode and moves by grapheme rather than UTF-16 code unit', () => {
    let state = createEditorState('A👨‍👩‍👧‍👦B')
    state = reduceEditor(state, { type: 'move/home' }).state
    state = reduceEditor(state, { type: 'move/right' }).state
    state = reduceEditor(state, { type: 'move/right' }).state
    expect(state.cursor).toBe('A👨‍👩‍👧‍👦'.length)
    state = reduceEditor(state, { type: 'insert', text: '好' }).state
    expect(state.text).toBe('A👨‍👩‍👧‍👦好B')
  })

  it('distinguishes carriage-return submit from line-feed newline', () => {
    const newline = reduceEditor(createEditorState('one'), { type: 'newline' })
    expect(newline.state.text).toBe('one\n')
    expect(newline.effect).toEqual({ kind: 'none' })

    const submit = reduceEditor(newline.state, { type: 'submit' })
    expect(submit.effect).toEqual({ kind: 'submit', text: 'one\n' })
    expect(submit.state.text).toBe('')
    expect(reduceEditor(createEditorState(), { type: 'submit' }).effect).toEqual({ kind: 'none' })
  })

  it('supports home, end, left, right, backspace, delete, and multiline paste', () => {
    const state = apply('ac', [
      { type: 'move/home' },
      { type: 'move/right' },
      { type: 'insert', text: 'b\nB' },
      { type: 'delete/backward' },
      { type: 'move/home' },
      { type: 'move/right' },
      { type: 'delete/forward' },
      { type: 'move/end' },
      { type: 'move/left' },
    ])
    expect(state.text).toBe('a\nc')
    expect(state.cursor).toBe(state.text.length - 1)
  })

  it('traverses submitted history and restores the draft', () => {
    let state = createEditorState('first')
    state = reduceEditor(state, { type: 'submit' }).state
    state = reduceEditor(state, { type: 'insert', text: 'second' }).state
    state = reduceEditor(state, { type: 'submit' }).state
    state = reduceEditor(state, { type: 'insert', text: 'draft' }).state
    state = reduceEditor(state, { type: 'history/previous' }).state
    expect(state.text).toBe('second')
    state = reduceEditor(state, { type: 'history/previous' }).state
    expect(state.text).toBe('first')
    state = reduceEditor(state, { type: 'history/next' }).state
    expect(state.text).toBe('second')
    state = reduceEditor(state, { type: 'history/next' }).state
    expect(state.text).toBe('draft')
  })

  it('applies the three-stage Ctrl+C policy', () => {
    expect(reduceEditor(createEditorState('draft'), { type: 'ctrl-c', turnActive: true }).effect)
      .toEqual({ kind: 'cancel-turn' })
    const cleared = reduceEditor(createEditorState('draft'), { type: 'ctrl-c', turnActive: false })
    expect(cleared.effect).toEqual({ kind: 'clear-draft' })
    expect(cleared.state.text).toBe('')
    expect(reduceEditor(createEditorState(), { type: 'ctrl-c', turnActive: false }).effect)
      .toEqual({ kind: 'request-exit' })
  })
})
