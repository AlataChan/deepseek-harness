/** Pure terminal application reducer. @module @deepseek-ai/dsh-tui/state/reducer */

import type {
  InteractionId,
  TranscriptRowInput,
  TuiAction,
  TuiState,
} from './types.ts'
import { createEditorState } from './editor.ts'

export type { TranscriptRowInput } from './types.ts'

let nextInteractionId = 1

function assertNever(value: never): never {
  throw new Error(`tui state: unsupported action ${JSON.stringify(value)}`)
}

/**
 * Mint one process-local interaction identity.
 * @returns the next identity for an approval or question overlay.
 */
export function mintInteractionId(): InteractionId {
  return nextInteractionId++ as InteractionId
}

/**
 * Construct a fresh terminal state.
 * @param dimensions - validated initial terminal dimensions.
 * @returns an idle state with no transcript or pending interaction.
 */
export function createInitialState(dimensions: { columns: number; rows?: number }): TuiState {
  return {
    finalizedRows: [],
    liveAssistant: undefined,
    overlay: { kind: 'none' },
    interaction: undefined,
    status: { kind: 'idle' },
    dimensions: { columns: dimensions.columns, rows: dimensions.rows },
    editor: createEditorState(),
    projection: undefined,
    nextRowId: 1,
    disposed: false,
  }
}

function appendRow(state: TuiState, row: TranscriptRowInput): TuiState {
  return {
    ...state,
    finalizedRows: [...state.finalizedRows, { ...row, id: state.nextRowId }],
    liveAssistant: undefined,
    nextRowId: state.nextRowId + 1,
  }
}

/**
 * Fold one typed internal action into terminal state.
 * @param state - previous immutable state.
 * @param action - external fact or local interaction action.
 * @returns the next immutable state, or the same disposed state.
 */
export function reduceTuiState(state: TuiState, action: TuiAction): TuiState {
  if (state.disposed) return state
  switch (action.type) {
    case 'transcript/finalize':
      return appendRow(state, action.row)
    case 'assistant/live':
      return { ...state, liveAssistant: { id: state.nextRowId, text: action.text } }
    case 'assistant/finalize':
      return appendRow(state, action.row)
    case 'overlay/open':
      return { ...state, overlay: action.overlay }
    case 'overlay/close':
      return state.interaction === undefined ? { ...state, overlay: { kind: 'none' } } : state
    case 'interaction/approval':
      return {
        ...state,
        overlay: { kind: 'approval', id: action.id },
        interaction: {
          kind: 'approval', id: action.id, toolName: action.toolName,
          ...(action.callId === undefined ? {} : { callId: action.callId }),
          ...(action.reason === undefined ? {} : { reason: action.reason }),
        },
      }
    case 'interaction/question':
      return {
        ...state,
        overlay: { kind: 'question', id: action.id },
        interaction: {
          kind: 'question',
          id: action.id,
          questions: action.questions.map(question => ({
            ...question,
            ...(question.options === undefined
              ? {}
              : { options: question.options.map(option => ({ ...option })) }),
            ...(question.intent === undefined ? {} : { intent: { ...question.intent } }),
          })),
        },
      }
    case 'interaction/settled':
      if (state.interaction?.id !== action.id) return state
      return { ...state, overlay: { kind: 'none' }, interaction: undefined }
    case 'terminal/resize':
      return {
        ...state,
        dimensions: { columns: action.columns, rows: action.rows },
      }
    case 'editor/update':
      return { ...state, editor: action.editor }
    case 'transcript/sync':
      return { ...state, projection: action.projection }
    case 'runtime/running':
      return { ...state, status: { kind: 'running' } }
    case 'runtime/idle':
      return { ...state, status: { kind: 'idle' } }
    case 'runtime/failed':
      return { ...state, status: { kind: 'failed', message: action.message } }
    case 'runtime/dispose':
      return {
        ...state,
        disposed: true,
        liveAssistant: undefined,
        overlay: { kind: 'none' },
        interaction: undefined,
      }
    default:
      return assertNever(action)
  }
}
