/** Pure selection-free terminal editor reducer. @module @deepseek-ai/dsh-tui/state/editor */

/** Terminal composer state with UTF-16 cursor offsets at grapheme boundaries. */
export interface EditorState {
  readonly text: string
  readonly cursor: number
  readonly history: readonly string[]
  readonly historyIndex: number | undefined
  readonly historyDraft: string
}

/** Semantic input actions emitted by the terminal decoder. */
export type EditorAction =
  | { readonly type: 'insert'; readonly text: string }
  | { readonly type: 'submit' }
  | { readonly type: 'newline' }
  | { readonly type: 'move/left' | 'move/right' | 'move/home' | 'move/end' }
  | { readonly type: 'delete/backward' | 'delete/forward' }
  | { readonly type: 'history/previous' | 'history/next' }
  | { readonly type: 'ctrl-c'; readonly turnActive: boolean }

/** External effect selected by one editor transition. */
export type EditorEffect =
  | { readonly kind: 'none' }
  | { readonly kind: 'submit'; readonly text: string }
  | { readonly kind: 'cancel-turn' }
  | { readonly kind: 'clear-draft' }
  | { readonly kind: 'request-exit' }

/** One pure editor state transition and its requested external effect. */
export interface EditorTransition {
  readonly state: EditorState
  readonly effect: EditorEffect
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const noEffect: EditorEffect = { kind: 'none' }

function assertNever(value: never): never {
  throw new Error(`tui editor: unsupported action ${JSON.stringify(value)}`)
}

function boundaries(text: string): number[] {
  const offsets = [...segmenter.segment(text)].map(segment => segment.index)
  return [...offsets, text.length]
}

function previousBoundary(text: string, cursor: number): number {
  const values = boundaries(text)
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index]
    if (value !== undefined && value < cursor) return value
  }
  return 0
}

function nextBoundary(text: string, cursor: number): number {
  return boundaries(text).find(value => value > cursor) ?? text.length
}

function transition(state: EditorState, patch: Partial<EditorState>): EditorTransition {
  return { state: { ...state, ...patch }, effect: noEffect }
}

/**
 * Construct editor state with its cursor after the initial text.
 * @param text - optional initial draft.
 * @returns fresh editor state.
 */
export function createEditorState(text = ''): EditorState {
  return {
    text,
    cursor: text.length,
    history: [],
    historyIndex: undefined,
    historyDraft: '',
  }
}

/**
 * Fold one semantic terminal key into the composer.
 * @param state - previous editor state.
 * @param action - decoded key or paste action.
 * @returns next editor state and any requested controller effect.
 */
export function reduceEditor(state: EditorState, action: EditorAction): EditorTransition {
  switch (action.type) {
    case 'insert': {
      const text = state.text.slice(0, state.cursor) + action.text + state.text.slice(state.cursor)
      return transition(state, {
        text,
        cursor: state.cursor + action.text.length,
        historyIndex: undefined,
      })
    }
    case 'submit':
      if (state.text.length === 0) return { state, effect: noEffect }
      return {
        state: {
          text: '',
          cursor: 0,
          history: [...state.history, state.text],
          historyIndex: undefined,
          historyDraft: '',
        },
        effect: { kind: 'submit', text: state.text },
      }
    case 'newline':
      return reduceEditor(state, { type: 'insert', text: '\n' })
    case 'move/left':
      return transition(state, { cursor: previousBoundary(state.text, state.cursor) })
    case 'move/right':
      return transition(state, { cursor: nextBoundary(state.text, state.cursor) })
    case 'move/home':
      return transition(state, { cursor: 0 })
    case 'move/end':
      return transition(state, { cursor: state.text.length })
    case 'delete/backward': {
      const start = previousBoundary(state.text, state.cursor)
      if (start === state.cursor) return { state, effect: noEffect }
      return transition(state, {
        text: state.text.slice(0, start) + state.text.slice(state.cursor),
        cursor: start,
        historyIndex: undefined,
      })
    }
    case 'delete/forward': {
      const end = nextBoundary(state.text, state.cursor)
      if (end === state.cursor) return { state, effect: noEffect }
      return transition(state, {
        text: state.text.slice(0, state.cursor) + state.text.slice(end),
        historyIndex: undefined,
      })
    }
    case 'history/previous': {
      if (state.history.length === 0) return { state, effect: noEffect }
      const index = state.historyIndex === undefined
        ? state.history.length - 1
        : Math.max(0, state.historyIndex - 1)
      const text = historyEntry(state.history, index)
      return transition(state, {
        text,
        cursor: text.length,
        historyIndex: index,
        historyDraft: state.historyIndex === undefined ? state.text : state.historyDraft,
      })
    }
    case 'history/next': {
      if (state.historyIndex === undefined) return { state, effect: noEffect }
      const index = state.historyIndex + 1
      if (index >= state.history.length) {
        return transition(state, {
          text: state.historyDraft,
          cursor: state.historyDraft.length,
          historyIndex: undefined,
        })
      }
      const text = historyEntry(state.history, index)
      return transition(state, { text, cursor: text.length, historyIndex: index })
    }
    case 'ctrl-c':
      if (action.turnActive) return { state, effect: { kind: 'cancel-turn' } }
      if (state.text.length > 0) {
        return {
          state: { ...state, text: '', cursor: 0, historyIndex: undefined, historyDraft: '' },
          effect: { kind: 'clear-draft' },
        }
      }
      return { state, effect: { kind: 'request-exit' } }
    default:
      return assertNever(action)
  }
}

function historyEntry(history: readonly string[], index: number): string {
  const entry = history[index]
  /* v8 ignore next -- reducer transitions establish the history index range. */
  if (entry === undefined) throw new Error('tui editor history index is out of range')
  return entry
}
