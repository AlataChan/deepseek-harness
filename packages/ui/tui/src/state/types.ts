/** Framework-free terminal application state. @module @deepseek-ai/dsh-tui/state/types */

import type { EditorState } from './editor.ts'
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'
import type { TranscriptProjection } from '../transcript/project.ts'

declare const interactionIdBrand: unique symbol

/** Locally minted identity that prevents stale interaction settlement. */
export type InteractionId = number & { readonly [interactionIdBrand]: never }

/** Terminal dimensions available to layout selectors. */
export interface TerminalDimensions {
  readonly columns: number
  readonly rows: number | undefined
}

/** Input for one row that is ready to enter terminal scrollback. */
export interface TranscriptRowInput {
  readonly kind: 'message' | 'system' | 'error'
  readonly role?: 'user' | 'assistant'
  readonly text: string
}

/** Final transcript row with a controller-lifetime monotonic identity. */
export interface TranscriptRow extends TranscriptRowInput {
  readonly id: number
}

/** Assistant content that remains in the redraw region while streaming. */
export interface LiveAssistantRow {
  readonly id: number
  readonly text: string
}

/** Mutually exclusive terminal overlay. */
export type TuiOverlay =
  | { readonly kind: 'none' }
  | { readonly kind: 'help' }
  | { readonly kind: 'resume' }
  | { readonly kind: 'approval'; readonly id: InteractionId }
  | { readonly kind: 'question'; readonly id: InteractionId }

/** Non-interaction overlay accepted from navigation actions. */
export type NavigationOverlay = Extract<TuiOverlay, { kind: 'help' | 'resume' }>

/** Human decision currently owned by the terminal client. */
export type PendingInteraction =
  | {
    readonly kind: 'approval'
    readonly id: InteractionId
    readonly toolName: string
    readonly callId?: string
    readonly reason?: string
  }
  | {
    readonly kind: 'question'
    readonly id: InteractionId
    readonly questions: readonly AskUserQuestionItem[]
  }

/** Runtime status shown below the transcript. */
export type TuiStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running' }
  | { readonly kind: 'failed'; readonly message: string }

/** Complete framework-independent state consumed by render selectors. */
export interface TuiState {
  readonly finalizedRows: readonly TranscriptRow[]
  readonly liveAssistant: LiveAssistantRow | undefined
  readonly overlay: TuiOverlay
  readonly interaction: PendingInteraction | undefined
  readonly status: TuiStatus
  readonly dimensions: TerminalDimensions
  readonly editor: EditorState
  /** Replay-equivalent durable transcript for the currently owned Session. */
  readonly projection: TranscriptProjection | undefined
  readonly nextRowId: number
  readonly disposed: boolean
}

/** Closed set of facts accepted by the terminal state reducer. */
export type TuiAction =
  | { readonly type: 'transcript/finalize'; readonly row: TranscriptRowInput }
  | { readonly type: 'assistant/live'; readonly text: string }
  | { readonly type: 'assistant/finalize'; readonly row: TranscriptRowInput }
  | { readonly type: 'overlay/open'; readonly overlay: NavigationOverlay }
  | { readonly type: 'overlay/close' }
  | {
    readonly type: 'interaction/approval'
    readonly id: InteractionId
    readonly toolName: string
    readonly callId?: string
    readonly reason?: string
  }
  | {
    readonly type: 'interaction/question'
    readonly id: InteractionId
    readonly questions: readonly AskUserQuestionItem[]
  }
  | { readonly type: 'interaction/settled'; readonly id: InteractionId }
  | { readonly type: 'terminal/resize'; readonly columns: number; readonly rows?: number }
  | { readonly type: 'editor/update'; readonly editor: EditorState }
  | { readonly type: 'transcript/sync'; readonly projection: TranscriptProjection }
  | { readonly type: 'runtime/running' }
  | { readonly type: 'runtime/idle' }
  | { readonly type: 'runtime/failed'; readonly message: string }
  | { readonly type: 'runtime/dispose' }
