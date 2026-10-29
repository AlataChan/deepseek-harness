/**
 * Approval and user-questions terminal interaction provider.
 * Manages human confirmation prompts, PTC dispatch-start subCallId argument lookup,
 * serialized FIFO interaction queue, recursive secret redaction, and fail-closed security invariants.
 *
 * @module @deepseek-ai/dsh-tui/interaction
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import { SessionSeq, type Session } from '@deepseek-ai/dsh-session'
import type { TerminalRenderer } from './render.ts'
import type { LocaleDictionary } from './locales.ts'
import type { PendingApprovalView, PendingQuestionBatchView, QuestionItemView } from './types.ts'

/** Summary and status of arguments discovered for a tool call. */
export interface ApprovalArgumentsInfo {
  readonly found: boolean
  readonly argumentsSummary: string
  readonly kind?: 'native' | 'ptc'
  readonly rawArguments?: unknown
}

const SENSITIVE_KEY_PATTERN = /(?:password|secret|token|credential|api_key|apikey|private_key|auth)/i

/**
 * Recursively redact sensitive keys from nested objects and arrays.
 * Unconditionally masks matching keys and safely bounds deep/large data structures.
 * @param val - Value to recursively redact.
 * @param depth - Current recursion depth.
 * @returns Redacted object or primitive.
 */
export function redactSecrets(val: unknown, depth = 0): unknown {
  if (val === null || typeof val !== 'object') {
    return val
  }
  if (depth > 8) {
    return '[Truncated]'
  }
  if (Array.isArray(val)) {
    const maxItems = 50
    const sliced = val.slice(0, maxItems).map(item => redactSecrets(item, depth + 1))
    if (val.length > maxItems) {
      sliced.push('[Truncated]')
    }
    return sliced
  }
  const result: Record<string, unknown> = {}
  const entries = Object.entries(val as Record<string, unknown>)
  const maxEntries = 50
  for (const [k, v] of entries.slice(0, maxEntries)) {
    if (SENSITIVE_KEY_PATTERN.test(k)) {
      result[k] = '********'
    } else if (typeof v === 'object' && v !== null) {
      result[k] = redactSecrets(v, depth + 1)
    } else if (typeof v === 'string') {
      result[k] = v.length > 80 ? `${v.slice(0, 80)}...` : v
    } else {
      result[k] = v
    }
  }
  if (entries.length > maxEntries) {
    result._truncated = '[Truncated]'
  }
  return result
}

/**
 * Summarize and bound a tool argument payload, recursively redacting known secret fields.
 * @param args - Parsed or raw arguments.
 * @returns Bounded sanitized string summary.
 */
export function summarizeArguments(args: unknown): string {
  if (typeof args !== 'object' || args === null) {
    return String(args).slice(0, 200)
  }
  const clean = redactSecrets(args)
  const str = JSON.stringify(clean)
  return str.length > 300 ? `${str.slice(0, 300)}...` : str
}

/**
 * Look up arguments for a pending tool approval from the session log.
 * Handles both native 'tool/call' (by callId) and PTC 'tool/ptc-dispatch-start' (by subCallId).
 * @param session - The requesting agent's session.
 * @param callId - ToolCallId to look up.
 * @param expectedName - Expected tool name.
 * @returns Found status and sanitized argument summary.
 */
export function lookupApprovalArguments(
  session: Session,
  callId: string | undefined,
  expectedName: string,
): ApprovalArgumentsInfo {
  if (!callId) {
    return { found: false, argumentsSummary: '' }
  }

  // Search reverse from latest event
  const count = session.seq
  for (let seq = count - 1; seq >= 0; seq--) {
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const event = session.eventAt(SessionSeq(seq))
    if (!event) continue

    // If already settled, do not allow re-approval
    if (event.type === 'tool/result') {
      const data = event.data as { message?: { toolCallId?: string } }
      if (data.message?.toolCallId === callId) {
        return { found: false, argumentsSummary: '' }
      }
    }
    if (event.type === 'tool/ptc-dispatch') {
      const data = event.data as { subCallId?: string }
      if (data.subCallId === callId) {
        return { found: false, argumentsSummary: '' }
      }
    }

    if (event.type === 'tool/call') {
      const data = event.data as { callId: string; name: string; arguments: string }
      if (data.callId === callId) {
        if (data.name !== expectedName) {
          return { found: false, argumentsSummary: '' }
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(data.arguments)
        } catch {
          parsed = data.arguments
        }
        return {
          found: true,
          argumentsSummary: summarizeArguments(parsed),
          kind: 'native',
          rawArguments: parsed,
        }
      }
    }

    if (event.type === 'tool/ptc-dispatch-start') {
      const data = event.data as { subCallId: string; name: string; arguments: string | Record<string, unknown> }
      if (data.subCallId === callId) {
        if (data.name !== expectedName) {
          return { found: false, argumentsSummary: '' }
        }
        let parsed: unknown = data.arguments
        if (typeof data.arguments === 'string') {
          try {
            parsed = JSON.parse(data.arguments)
          } catch {
            parsed = data.arguments
          }
        }
        return {
          found: true,
          argumentsSummary: summarizeArguments(parsed),
          kind: 'ptc',
          rawArguments: parsed,
        }
      }
    }
  }

  return { found: false, argumentsSummary: '' }
}

/** Terminal interaction focus callbacks and the current Agent owner. */
export interface InteractionProviderHandlers {
  onInteractionStart: (promptText: string) => void
  onInteractionEnd: () => void
  getActiveAgent: () => Agent | undefined
}

interface QueuedApproval {
  readonly kind: 'approval'
  readonly item: PendingApprovalView
  readonly reqAgentId: string
  readonly cleanup: () => void
}

interface QueuedQuestion {
  readonly kind: 'question'
  readonly item: PendingQuestionBatchView
  readonly reqAgentId: string
  questionIndex: number
  accumulatedAnswers: Array<{ id: string; selected: string[]; custom?: string }>
  readonly cleanup: () => void
}

type QueuedInteraction = QueuedApproval | QueuedQuestion

/** Provides interactive terminal responses to approval requests and user questions. */
export class InteractionProvider {
  private activeItem: QueuedInteraction | undefined
  private readonly queue: QueuedInteraction[] = []

  constructor(
    private readonly ctx: Context,
    private readonly renderer: TerminalRenderer,
    private readonly handlers: InteractionProviderHandlers,
    private readonly dict: LocaleDictionary,
  ) {
    this.registerAnswerers()
  }

  /** Check whether an interactive prompt currently holds the focus. */
  get hasActiveInteraction(): boolean {
    return this.activeItem !== undefined
  }

  /**
   * Handle raw key or text input directed at the active interaction.
   * @param input - Submitted string or key character.
   * @returns true if consumed by the interaction.
   */
  handleInput(input: string): boolean {
    if (!this.activeItem) return false

    // Revalidate active agent
    const currentAgent = this.handlers.getActiveAgent()
    if (!currentAgent || currentAgent.id !== this.activeItem.reqAgentId) {
      this.cancelPending()
      return false
    }

    if (this.activeItem.kind === 'approval') {
      return this.handleApprovalInput(this.activeItem, input)
    }
    return this.handleQuestionInput(this.activeItem, input)
  }

  /**
   * Cancel any pending interactions (e.g. on session switch or shutdown).
   */
  cancelPending(): void {
    const items = [this.activeItem, ...this.queue].filter(Boolean) as QueuedInteraction[]
    this.activeItem = undefined
    this.queue.length = 0

    for (const entry of items) {
      entry.cleanup()
      if (entry.kind === 'approval') {
        entry.item.resolve('cancelled')
      } else {
        entry.item.reject(new Error('Question cancelled'))
      }
    }
    this.handlers.onInteractionEnd()
  }

  private handleApprovalInput(entry: QueuedApproval, input: string): boolean {
    const trimmed = input.trim().toLowerCase()
    if (trimmed === 'y') {
      if (!entry.item.argumentsAvailable) {
        this.renderer.appendLine(this.dict.approvalArgsUnavailable, 'error')
        return true
      }
      entry.cleanup()
      this.activeItem = undefined
      entry.item.resolve('allowed-once')
      this.renderer.appendLine(`${this.dict.approvalTitle} -> ${this.dict.approvalOutcomeAllowed}`, 'notice')
      this.advanceQueue()
      return true
    }
    if (trimmed === 'n') {
      entry.cleanup()
      this.activeItem = undefined
      entry.item.resolve('rejected')
      this.renderer.appendLine(`${this.dict.approvalTitle} -> ${this.dict.approvalOutcomeRejected}`, 'notice')
      this.advanceQueue()
      return true
    }
    if (trimmed === 'c') {
      entry.cleanup()
      this.activeItem = undefined
      entry.item.resolve('cancelled')
      this.renderer.appendLine(`${this.dict.approvalTitle} -> ${this.dict.approvalOutcomeCancelled}`, 'notice')
      this.advanceQueue()
      return true
    }

    // Default Enter or unrecognized key
    this.renderer.appendLine(this.dict.approvalEnterWarning, 'notice')
    return true
  }

  private handleQuestionInput(entry: QueuedQuestion, input: string): boolean {
    const trimmed = input.trim()
    const question = entry.item.questions[entry.questionIndex]
    if (!question) {
      entry.cleanup()
      this.activeItem = undefined
      entry.item.resolve({ answers: entry.accumulatedAnswers })
      this.advanceQueue()
      return true
    }

    if (question.multiSelect) {
      // Parse comma or space separated numbers
      const parts = trimmed.split(/[\s,]+/).filter(Boolean)
      const nums = parts.map(p => parseInt(p, 10))
      const allValid =
        nums.length > 0 &&
        nums.every(n => !isNaN(n) && n >= 1 && n <= question.options.length)
      if (allValid) {
        const selected = nums.map(n => question.options[n - 1]?.label ?? '')
        entry.accumulatedAnswers.push({ id: question.id, selected })
        this.renderer.appendLine(`${this.dict.questionAnswerSelected}: ${selected.join(', ')}`, 'notice')
        return this.advanceQuestion(entry)
      }
    } else {
      // Single-select choice by number
      const num = parseInt(trimmed, 10)
      if (!isNaN(num) && num >= 1 && num <= question.options.length) {
        const selected = question.options[num - 1]?.label ?? ''
        entry.accumulatedAnswers.push({ id: question.id, selected: [selected] })
        this.renderer.appendLine(`${this.dict.questionAnswerSelected}: ${selected}`, 'notice')
        return this.advanceQuestion(entry)
      }
    }

    // Freeform custom text response
    if (trimmed.length > 0) {
      entry.accumulatedAnswers.push({ id: question.id, selected: [], custom: trimmed })
      this.renderer.appendLine(`${this.dict.questionAnswerCustom}: ${trimmed}`, 'notice')
      return this.advanceQuestion(entry)
    }

    this.renderer.appendLine(this.dict.questionInvalidChoice, 'notice')
    return true
  }

  private advanceQuestion(entry: QueuedQuestion): boolean {
    entry.questionIndex += 1
    if (entry.questionIndex < entry.item.questions.length) {
      this.renderQuestionPrompt(entry)
      return true
    }

    // Completed all questions in the batch
    entry.cleanup()
    this.activeItem = undefined
    entry.item.resolve({ answers: entry.accumulatedAnswers })
    this.advanceQueue()
    return true
  }

  private renderApprovalPrompt(entry: QueuedApproval): void {
    const item = entry.item
    const promptLines = [
      this.dict.approvalTitle,
      `  ${this.dict.approvalTool}: ${item.toolName}`,
      item.reason ? `  ${this.dict.approvalReason}: ${item.reason}` : '',
      item.argumentsAvailable
        ? `  ${this.dict.approvalArgs}: ${item.argumentsSummary}`
        : `  ${this.dict.approvalArgs}: ${this.dict.approvalArgsUnavailable}`,
      `  ${this.dict.approvalOptionAllow} | ${this.dict.approvalOptionReject} | ${this.dict.approvalOptionCancel}`,
    ]
      .filter(Boolean)
      .join('\n')

    this.renderer.appendLine(promptLines, 'notice')
    this.handlers.onInteractionStart(this.dict.approvalTitle)
  }

  private renderQuestionPrompt(entry: QueuedQuestion): void {
    const q: QuestionItemView | undefined = entry.item.questions[entry.questionIndex]
    if (!q) return

    const total = entry.item.questions.length
    const progress = total > 1 ? ` (${entry.questionIndex + 1}/${total})` : ''
    const optionsText = q.options
      .map((o, idx) => `  [${idx + 1}] ${o.label}${o.description ? ` (${o.description})` : ''}`)
      .join('\n')

    const hint = q.multiSelect ? this.dict.questionMultiChoiceHint : this.dict.questionSingleChoiceHint

    const promptLines = [
      `${this.dict.questionTitle}${progress}: ${q.question}`,
      q.detail ? `  ${q.detail}` : '',
      optionsText,
      `  ${hint}`,
      `  ${this.dict.questionCustomPrompt}`,
    ]
      .filter(Boolean)
      .join('\n')

    this.renderer.appendLine(promptLines, 'notice')
    this.handlers.onInteractionStart(this.dict.questionTitle)
  }

  private activate(entry: QueuedInteraction): void {
    const currentAgent = this.handlers.getActiveAgent()
    if (!currentAgent || currentAgent.id !== entry.reqAgentId) {
      entry.cleanup()
      if (entry.kind === 'approval') entry.item.resolve('cancelled')
      else entry.item.reject(new Error('Agent deactivated'))
      this.advanceQueue()
      return
    }

    if (entry.item.signal?.aborted) {
      entry.cleanup()
      if (entry.kind === 'approval') entry.item.resolve('cancelled')
      else entry.item.reject(new Error('Aborted'))
      this.advanceQueue()
      return
    }

    this.activeItem = entry
    if (entry.kind === 'approval') {
      this.renderApprovalPrompt(entry)
    } else {
      this.renderQuestionPrompt(entry)
    }
  }

  private advanceQueue(): void {
    this.activeItem = undefined
    while (this.queue.length > 0) {
      const next = this.queue.shift()
      if (!next) break
      if (next.item.signal?.aborted) {
        next.cleanup()
        if (next.kind === 'approval') next.item.resolve('cancelled')
        else next.item.reject(new Error('Aborted'))
        continue
      }
      this.activate(next)
      return
    }
    this.handlers.onInteractionEnd()
  }

  private handleAbort(entry: QueuedInteraction): void {
    if (this.activeItem === entry) {
      entry.cleanup()
      this.activeItem = undefined
      if (entry.kind === 'approval') entry.item.resolve('cancelled')
      else entry.item.reject(new Error('Aborted'))
      this.advanceQueue()
      return
    }
    const idx = this.queue.indexOf(entry)
    if (idx >= 0) {
      this.queue.splice(idx, 1)
      entry.cleanup()
      if (entry.kind === 'approval') entry.item.resolve('cancelled')
      else entry.item.reject(new Error('Aborted'))
    }
  }

  private registerAnswerers(): void {
    // approval/request waterfall listener
    this.ctx.on('approval/request', async (req: ApprovalRequest, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome> => {
      const currentAgent = this.handlers.getActiveAgent()
      if (!currentAgent || req.agent.id !== currentAgent.id) {
        return await next()
      }

      if (req.signal?.aborted) {
        return 'cancelled'
      }

      const argInfo = lookupApprovalArguments(req.agent.session, req.callId, req.toolName)

      return await new Promise<ApprovalOutcome>((resolve) => {
        let abortHandler: (() => void) | undefined
        const cleanup = (): void => {
          if (abortHandler && req.signal) {
            req.signal.removeEventListener('abort', abortHandler)
            abortHandler = undefined
          }
        }

        const item: PendingApprovalView = {
          sessionId: req.agent.session.id,
          toolName: req.toolName,
          callId: req.callId,
          reason: req.reason,
          argumentsSummary: argInfo.argumentsSummary,
          argumentsAvailable: argInfo.found,
          signal: req.signal,
          resolve,
        }

        const queued: QueuedApproval = {
          kind: 'approval',
          item,
          reqAgentId: req.agent.id,
          cleanup,
        }

        if (req.signal) {
          abortHandler = () => { this.handleAbort(queued) }
          req.signal.addEventListener('abort', abortHandler, { once: true })
        }

        if (!this.activeItem) {
          this.activate(queued)
        } else {
          this.queue.push(queued)
        }
      })
    })

    // user-questions/request waterfall listener
    this.ctx.on(
      'user-questions/request',
      async (request: AskUserQuestionRequest, next: () => Promise<AskUserQuestionAnswer>): Promise<AskUserQuestionAnswer> => {
        const currentAgent = this.handlers.getActiveAgent()
        if (!currentAgent || (request.agent && request.agent.id !== currentAgent.id)) {
          return await next()
        }

        if (request.signal?.aborted) {
          throw new Error('Question aborted')
        }

        if (request.questions.length === 0) {
          return { answers: [] }
        }

        return await new Promise<AskUserQuestionAnswer>((resolve, reject) => {
          let abortHandler: (() => void) | undefined
          const cleanup = (): void => {
            if (abortHandler && request.signal) {
              request.signal.removeEventListener('abort', abortHandler)
              abortHandler = undefined
            }
          }

          const item: PendingQuestionBatchView = {
            sessionId: currentAgent.session.id,
            questions: request.questions.map(q => ({
              id: q.id,
              question: q.question,
              detail: q.detail,
              multiSelect: q.multiSelect,
              options: (q.options ?? []).map(o => ({ label: o.label, description: o.description })),
            })),
            signal: request.signal,
            resolve,
            reject,
          }

          const queued: QueuedQuestion = {
            kind: 'question',
            item,
            reqAgentId: currentAgent.id,
            questionIndex: 0,
            accumulatedAnswers: [],
            cleanup,
          }

          if (request.signal) {
            abortHandler = () => { this.handleAbort(queued) }
            request.signal.addEventListener('abort', abortHandler, { once: true })
          }

          if (!this.activeItem) {
            this.activate(queued)
          } else {
            this.queue.push(queued)
          }
        })
      },
    )
  }
}
