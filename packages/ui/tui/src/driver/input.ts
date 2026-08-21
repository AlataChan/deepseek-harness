/** Semantic Ink input adapter for the framework-free TUI core. @module @deepseek-ai/dsh-tui/driver/input */

import type { AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions'
import type { TuiApprovalController } from './approval.ts'
import type { TuiCommandRoute } from './commands.ts'
import type { TuiQuestionsController } from './questions.ts'
import { reduceEditor } from '../state/editor.ts'
import type { EditorAction } from '../state/editor.ts'
import type { TuiStore } from '../state/store.ts'

/** Ink-compatible subset used by the deterministic input driver. */
export interface TuiInputKey {
  readonly name?: string
  readonly ctrl?: boolean
  readonly meta?: boolean
  readonly shift?: boolean
  readonly leftArrow?: boolean
  readonly rightArrow?: boolean
  readonly upArrow?: boolean
  readonly downArrow?: boolean
  readonly backspace?: boolean
  readonly delete?: boolean
  readonly escape?: boolean
  readonly return?: boolean
}

/** Effects and state required by the terminal key decoder. */
export interface TuiInputOptions {
  readonly store: TuiStore
  readonly route: (line: string, signal: AbortSignal) => Promise<TuiCommandRoute>
  readonly cancelTurn: () => void
  readonly requestShutdown: () => Promise<void>
  readonly openResume: () => Promise<void>
  readonly selectResume?: (value: string) => Promise<void>
  readonly cancelResume?: () => void
  readonly isTurnActive: () => boolean
  readonly approval: TuiApprovalController
  readonly questions: TuiQuestionsController
}

/** Imperative input face installed into the Ink composer. */
export interface TuiInputDriver {
  /** Decode and apply one Ink input callback. */
  handle(input: string, key: TuiInputKey): Promise<void>
  /** Permanently reject new input and abort an in-flight command. */
  reject(): void
}

function editorAction(key: TuiInputKey): EditorAction | undefined {
  if (key.leftArrow === true) return { type: 'move/left' }
  if (key.rightArrow === true) return { type: 'move/right' }
  if (key.upArrow === true) return { type: 'history/previous' }
  if (key.downArrow === true) return { type: 'history/next' }
  if (key.backspace === true) return { type: 'delete/backward' }
  if (key.delete === true) return { type: 'delete/forward' }
  if (key.name === 'home') return { type: 'move/home' }
  if (key.name === 'end') return { type: 'move/end' }
  return undefined
}

function questionAnswer(
  questions: Extract<ReturnType<TuiStore['getSnapshot']>['interaction'], { kind: 'question' }>,
  text: string,
): AskUserQuestionAnswer | undefined {
  const parts = text.split(';').map(value => value.trim())
  if (parts.length !== questions.questions.length || parts.some(value => value === '')) return undefined
  return {
    answers: questions.questions.map((question, index) => {
      const value = parts[index] ?? ''
      const labels = new Set(question.options?.map(option => option.label) ?? [])
      const selected = question.multiSelect === true
        ? value.split(',').map(label => label.trim()).filter(label => labels.has(label))
        : labels.has(value) ? [value] : []
      return {
        id: question.id,
        selected,
        ...(selected.length === 0 || (question.multiSelect === true && selected.length < value.split(',').length)
          ? { custom: value }
          : {}),
      }
    }),
  }
}

/**
 * Create one stateful input decoder.
 * @param options - framework-free store and controller effects.
 * @returns an adapter that owns command cancellation and Ctrl+C escalation state.
 */
export function createTuiInputDriver(options: TuiInputOptions): TuiInputDriver {
  let rejected = false
  let cancelling = false
  let activeCommand: AbortController | undefined

  const updateEditor = (action: EditorAction): ReturnType<typeof reduceEditor> => {
    const transition = reduceEditor(options.store.getSnapshot().editor, action)
    options.store.dispatch({ type: 'editor/update', editor: transition.state })
    return transition
  }

  return {
    async handle(input, key) {
      if (rejected) return
      const state = options.store.getSnapshot()
      const interaction = state.interaction
      const isEscape = key.escape === true || key.name === 'escape'
      const isReturn = key.return === true || key.name === 'return'

      if (interaction?.kind === 'approval') {
        if (input.toLowerCase() === 'y') options.approval.allow(interaction.id)
        else if (input.toLowerCase() === 'n' || isEscape) options.approval.reject(interaction.id)
        return
      }
      if (interaction?.kind === 'question') {
        if (isEscape) {
          options.questions.cancel(interaction.id)
          return
        }
        if (isReturn) {
          const answer = questionAnswer(interaction, state.editor.text)
          if (answer !== undefined && options.questions.answer(interaction.id, answer)) {
            options.store.dispatch({ type: 'editor/update', editor: reduceEditor(state.editor, { type: 'submit' }).state })
          }
          return
        }
      }

      if (key.ctrl === true && key.name === 'c') {
        if (cancelling && options.isTurnActive()) {
          await options.requestShutdown()
          return
        }
        cancelling = false
        if (options.isTurnActive()) {
          cancelling = true
          activeCommand?.abort(new Error('terminal command cancelled'))
          options.cancelTurn()
          return
        }
        const transition = updateEditor({ type: 'ctrl-c', turnActive: false })
        if (transition.effect.kind === 'request-exit') await options.requestShutdown()
        return
      }
      if (!options.isTurnActive()) cancelling = false
      if (options.isTurnActive()) return
      if (key.ctrl === true && key.name === 'j') {
        updateEditor({ type: 'newline' })
        return
      }
      if (key.ctrl === true && key.name === 'r') {
        await options.openResume()
        return
      }
      if (isEscape) {
        if (state.overlay.kind === 'resume') options.cancelResume?.()
        options.store.dispatch({ type: 'overlay/close' })
        return
      }
      if (isReturn) {
        const before = options.store.getSnapshot().editor
        const transition = updateEditor({ type: 'submit' })
        if (transition.effect.kind !== 'submit') return
        if (state.overlay.kind === 'resume' && options.selectResume !== undefined) {
          try {
            await options.selectResume(transition.effect.text)
          } catch {
            options.store.dispatch({ type: 'editor/update', editor: before })
          }
          return
        }
        const abort = new AbortController()
        activeCommand = abort
        const result = await options.route(transition.effect.text, abort.signal)
        if (activeCommand === abort) activeCommand = undefined
        if (result === 'preserve') options.store.dispatch({ type: 'editor/update', editor: before })
        return
      }
      const action = editorAction(key)
      if (action !== undefined) {
        updateEditor(action)
        return
      }
      if (input !== '' && key.ctrl !== true && key.meta !== true) updateEditor({ type: 'insert', text: input })
    },
    reject() {
      if (rejected) return
      rejected = true
      activeCommand?.abort(new Error('terminal input closed'))
      activeCommand = undefined
    },
  }
}
