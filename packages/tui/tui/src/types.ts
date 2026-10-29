/**
 * Type declarations for the interactive terminal user interface.
 * Types only — no runtime code, as required by package conventions.
 *
 * @module @deepseek-ai/dsh-tui/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions'

/** Configuration options for the TUI plugin. */
export interface TuiConfig {
  /** Maximum number of scrollback lines retained in memory. Defaults to 2000. */
  readonly maxScrollbackLines?: number
  /** Maximum input draft byte length. Defaults to 32768. */
  readonly maxInputBytes?: number
  /** Maximum stream accumulator characters before tail windowing. Defaults to 32768. */
  readonly maxStreamAccumulatorChars?: number
  /** Maximum characters permitted in a single scrollback line before truncation. Defaults to 4096. */
  readonly maxScrollbackLineLength?: number
  /** Maximum bytes accepted in bracketed paste buffer. Defaults to 65536. */
  readonly maxPasteBytes?: number
  /** Maximum prompts retained in command history. Defaults to 500. */
  readonly maxHistoryEntries?: number
  /** Minimum interval between streaming screen repaints in milliseconds. Defaults to 33. */
  readonly redrawIntervalMs?: number
  /** Preferred UI language ('zh' | 'en'). Defaults to 'zh'. */
  readonly locale?: 'zh' | 'en'
}

/** Fully resolved, validated runtime configuration for the TUI subsystem. */
export interface ResolvedTuiConfig {
  readonly maxScrollbackLines: number
  readonly maxInputBytes: number
  readonly maxStreamAccumulatorChars: number
  readonly maxScrollbackLineLength: number
  readonly maxPasteBytes: number
  readonly maxHistoryEntries: number
  readonly redrawIntervalMs: number
  readonly locale: 'zh' | 'en'
}

/** Active lifecycle status of the terminal user interface. */
export type TuiStatus =
  | 'idle'
  | 'running'
  | 'cancelling'
  | 'waiting-approval'
  | 'waiting-question'
  | 'exiting'

/** Bounded summary of a pending tool execution approval. */
export interface PendingApprovalView {
  readonly id?: string | undefined
  readonly sessionId: SessionId
  readonly toolName: string
  readonly callId?: ToolCallId | undefined
  readonly reason?: string | undefined
  readonly argumentsSummary: string
  readonly argumentsAvailable: boolean
  readonly signal?: AbortSignal | undefined
  readonly resolve: (outcome: ApprovalOutcome) => void
}

/** Structured question item presented to the terminal operator. */
export interface QuestionOptionItem {
  readonly label: string
  readonly description?: string | undefined
}

/** One question within a pending question batch. */
export interface QuestionItemView {
  readonly id: string
  readonly question: string
  readonly detail?: string | undefined
  readonly multiSelect?: boolean | undefined
  readonly options: readonly QuestionOptionItem[]
}

/** Pending interactive user question batch. */
export interface PendingQuestionBatchView {
  readonly sessionId: SessionId
  readonly questions: readonly QuestionItemView[]
  readonly signal?: AbortSignal | undefined
  readonly resolve: (answers: AskUserQuestionAnswer) => void
  readonly reject: (error: Error) => void
}

/** One displayed line in the scrollback buffer with rendering metadata. */
export interface ScrollbackLine {
  readonly text: string
  readonly kind: 'user' | 'assistant' | 'tool' | 'system' | 'error' | 'notice'
  readonly time: number
}
