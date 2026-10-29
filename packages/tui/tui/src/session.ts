/**
 * Session adapter and command routing for the interactive terminal user interface.
 * Owns a single active AgentHandle, connects model streaming, session switching,
 * replay reconstruction, draft-until-idle queueing, and presenter metadata rendering.
 *
 * @module @deepseek-ai/dsh-tui/session
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import {
  type Agent,
  type AgentHandle,
  type AssistantStreamFrame,
  installModelSelection,
  type ModelSelection,
  type ModelSelectionRef,
} from '@deepseek-ai/dsh-agent'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionAlreadyOwnedError } from '@deepseek-ai/dsh-session-persistence'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolResult } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-session-query'
import type { TerminalRenderer } from './render.ts'
import { renderToolCallView, renderToolResultView } from './render.ts'
import type { LocaleDictionary } from './locales.ts'
import type { TuiStatus } from './types.ts'

/** Maximum characters retained in assistant streaming accumulator. */
export const MAX_STREAM_ACCUMULATOR_CHARS = 32768

/** Options for SessionAdapter. */
export interface SessionAdapterOptions {
  /** Maximum characters retained in assistant streaming accumulator. Defaults to 32768. */
  maxStreamAccumulatorChars?: number
}

/**
 * Execute a promise with a hard timeout, clearing the timer immediately upon completion.
 * @param promise - Underlying promise to execute.
 * @param timeoutMs - Timeout deadline in milliseconds.
 * @param timeoutMessage - Error message if timeout triggers.
 * @returns The operation result, or rejects when the deadline expires.
 */
export async function runWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(timeoutMessage))
    }, timeoutMs)
  })
  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  }
}

/** Notifications for the active session, selected model and terminal view. */
export interface SessionAdapterHandlers {
  onStatusChange: (status: TuiStatus) => void
  onModelChange: (model: string) => void
  onSessionChange: (sessionId: string) => void
  onRenderRequest: (streamingText?: string) => void
}

/** Manages the active agent handle, prompt submissions, commands, and stream notifications. */
export class SessionAdapter {
  private activeHandle: AgentHandle | undefined
  private activeModelSelection: ModelSelectionRef = { current: undefined, assembled: undefined }
  private currentStatus: TuiStatus = 'idle'
  private streamAttemptId: string | undefined
  private streamAccumulator = ''
  private lastRenderedSeq = -1
  private readonly pendingPrompts: string[] = []
  private activeTransitionPromise: Promise<void> | undefined
  private isTransitioning = false
  private disposed = false
  private readonly maxStreamChars: number
  private readonly activeToolCalls = new Map<string, { name: string; args: unknown }>()

  constructor(
    private readonly ctx: Context,
    private readonly renderer: TerminalRenderer,
    private readonly handlers: SessionAdapterHandlers,
    private readonly dict: LocaleDictionary,
    options: SessionAdapterOptions = {},
  ) {
    this.maxStreamChars = options.maxStreamAccumulatorChars ?? MAX_STREAM_ACCUMULATOR_CHARS
    this.setupListeners()
  }

  /** Current active Agent instance, if any. */
  get agent(): Agent | undefined {
    return this.activeHandle?.agent
  }

  /** Current active Session ID string. */
  get sessionId(): string {
    return this.activeHandle?.agent.session.id ?? ''
  }

  /** Current active Model label string. */
  get modelLabel(): string {
    const sel = this.activeModelSelection.current
    if (sel) {
      const base = sel.provider ? `${sel.provider}/${sel.model}` : sel.model
      return sel.reasoningEffort ? `${base} [${sel.reasoningEffort}]` : base
    }
    return this.activeHandle?.agent.options.model ?? 'default'
  }

  /**
   * Initialize a fresh default session on startup.
   */
  async initDefaultSession(): Promise<void> {
    if (this.disposed || this.isTransitioning) return
    const id = SessionId(randomUUID())
    await this.createSession(id)
  }

  /**
   * Create a new agent session.
   * @param id - Unique SessionId.
   */
  async createSession(id: SessionId): Promise<void> {
    if (this.disposed || this.isTransitioning) return
    const transition = (async () => {
      this.isTransitioning = true
      this.resetSessionState()
      await this.quiesceAndRelease()

      try {
        const defaultModel = this.ctx.get('agentDefaultModel')
        const selection = defaultModel ? defaultModel.currentSelection() : undefined
        const agentOptions = selection ? { provider: selection.provider, model: selection.model } : undefined
        const handle = await this.ctx.agents.create({
          sessionId: id,
          meta: { cwd: process.cwd() },
          ...agentOptions ? { agentOptions } : {},
          setup: (agentCtx, agent) => {
            this.activeModelSelection = { current: selection, assembled: undefined }
            installModelSelection(agentCtx, this.activeModelSelection)
            void agent
          },
        })
        if (this.disposed) {
          try {
            handle.agent.cancel({ kind: 'user' })
            await runWithTimeout(handle.dispose(), 2500, 'Late agent handle disposal timed out')
          } catch (err) {
            this.renderer.appendLine(`Late disposal error: ${err instanceof Error ? err.message : String(err)}`, 'error')
            throw err
          }
          return
        }
        this.activeHandle = handle
        this.handlers.onSessionChange(id)
        this.handlers.onModelChange(this.modelLabel)
        this.renderer.appendLine(`${this.dict.sessionCreated}: ${id}`, 'notice')
        this.setStatus('idle')
      } catch (err: unknown) {
        if (err instanceof SessionAlreadyOwnedError || (err instanceof Error && err.name === 'SessionAlreadyOwnedError')) {
          this.renderer.appendLine(this.dict.sessionConflictError, 'error')
        } else {
          this.renderer.appendLine(
            `${this.dict.errorOperationFailed}: ${err instanceof Error ? err.message : String(err)}`,
            'error',
          )
        }
      } finally {
        this.isTransitioning = false
        this.activeTransitionPromise = undefined
      }
    })()
    this.activeTransitionPromise = transition
    await transition
  }

  /**
   * Resume an existing persisted session.
   * @param id - SessionId to load and resume.
   */
  async resumeSession(id: SessionId): Promise<void> {
    if (this.disposed || this.isTransitioning) return
    const transition = (async () => {
      this.isTransitioning = true
      this.resetSessionState()
      await this.quiesceAndRelease()

      try {
        const defaultModel = this.ctx.get('agentDefaultModel')
        const selection = defaultModel ? defaultModel.currentSelection() : undefined
        const agentOptions = selection ? { provider: selection.provider, model: selection.model } : undefined
        const handle = await this.ctx.agents.resume({
          resumeSessionId: id,
          ...agentOptions ? { agentOptions } : {},
          setup: (agentCtx, agent) => {
            this.activeModelSelection = { current: selection, assembled: undefined }
            installModelSelection(agentCtx, this.activeModelSelection)
            void agent
          },
        })
        if (this.disposed) {
          try {
            handle.agent.cancel({ kind: 'user' })
            await runWithTimeout(handle.dispose(), 2500, 'Late agent handle disposal timed out')
          } catch (err) {
            this.renderer.appendLine(`Late disposal error: ${err instanceof Error ? err.message : String(err)}`, 'error')
            throw err
          }
          return
        }
        this.activeHandle = handle
        this.handlers.onSessionChange(id)
        this.handlers.onModelChange(this.modelLabel)
        this.renderer.appendLine(`${this.dict.sessionResumed}: ${id}`, 'notice')
        this.replayHistory(handle.agent)
        this.setStatus('idle')
      } catch (err: unknown) {
        if (err instanceof SessionAlreadyOwnedError || (err instanceof Error && err.name === 'SessionAlreadyOwnedError')) {
          this.renderer.appendLine(this.dict.sessionConflictError, 'error')
        } else {
          this.renderer.appendLine(
            `${this.dict.errorOperationFailed}: ${err instanceof Error ? err.message : String(err)}`,
            'error',
          )
        }
      } finally {
        this.isTransitioning = false
        this.activeTransitionPromise = undefined
      }
    })()
    this.activeTransitionPromise = transition
    await transition
  }

  /**
   * Submit a user message prompt to the active session.
   * Queues input as draft-until-idle if a turn is already executing.
   * @param text - Prompt content string.
   */
  async submitPrompt(text: string): Promise<void> {
    if (this.disposed) return
    const trimmed = text.trim()
    if (!trimmed) return

    // Slash command check
    if (trimmed.startsWith('/')) {
      await this.handleCommand(trimmed)
      return
    }

    if (!this.activeHandle || this.isTransitioning) {
      this.renderer.appendLine('No active session available', 'error')
      return
    }

    // Draft-until-idle admission check
    if (this.currentStatus === 'running' || this.currentStatus === 'cancelling') {
      if (this.pendingPrompts.length >= 3) {
        this.renderer.appendLine(this.dict.pendingTurnBusyError, 'error')
        return
      }
      this.pendingPrompts.push(trimmed)
      this.renderer.appendLine(this.dict.draftQueuedNotice, 'notice')
      return
    }

    this.setStatus('running')

    const message = createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: trimmed }],
    })
    this.activeHandle.agent.followup(message)
  }

  /**
   * Cancel the currently running agent turn.
   */
  cancelActiveTurn(): void {
    if (this.activeHandle && this.currentStatus === 'running') {
      this.setStatus('cancelling')
      this.activeHandle.agent.cancel({ kind: 'user' })
    }
  }

  /**
   * Set the model selection for subsequent requests.
   * @param selection - Provider, model, and optional reasoning effort.
   */
  setModel(selection: ModelSelection): void {
    this.activeModelSelection.current = selection
    this.handlers.onModelChange(this.modelLabel)
    this.renderer.appendLine(`${this.dict.modelSwitchNotice}: ${this.modelLabel}`, 'notice')
  }

  /**
   * Dispose and teardown active agent handle cleanly.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    this.pendingPrompts.length = 0

    const errors: Error[] = []

    if (this.activeTransitionPromise) {
      try {
        await runWithTimeout(
          this.activeTransitionPromise,
          2500,
          'Active session transition timed out during dispose',
        )
      } catch (err) {
        errors.push(err instanceof Error ? err : new Error(String(err)))
      }
    }

    try {
      await this.quiesceAndRelease()
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)))
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, `SessionAdapter dispose failed: ${errors.map(e => e.message).join('; ')}`)
    }
  }

  private resetSessionState(): void {
    this.lastRenderedSeq = -1
    this.streamAccumulator = ''
    this.streamAttemptId = undefined
    this.activeToolCalls.clear()
    this.handlers.onRenderRequest('')
  }

  private setStatus(status: TuiStatus): void {
    this.currentStatus = status
    this.handlers.onStatusChange(status)
    this.handlers.onRenderRequest()
    if (status === 'idle' && this.pendingPrompts.length > 0 && !this.disposed) {
      const nextPrompt = this.pendingPrompts.shift()
      if (nextPrompt) {
        queueMicrotask(() => {
          void this.submitPrompt(nextPrompt)
        })
      }
    }
  }

  private async quiesceAndRelease(): Promise<void> {
    if (!this.activeHandle) return
    const handle = this.activeHandle
    this.activeHandle = undefined

    const errors: Error[] = []

    try {
      handle.agent.cancel({ kind: 'user' })
      await runWithTimeout(handle.agent.whenIdle(), 2500, 'Agent quiesce timed out waiting for idle')
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)))
    }

    try {
      await runWithTimeout(handle.dispose(), 2500, 'Agent handle disposal timed out')
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)))
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, `Failed to cleanly quiesce and release agent: ${errors.map(e => e.message).join('; ')}`)
    }
  }

  private setupListeners(): void {
    // Stream updates
    this.ctx.on('agent/assistant-stream', ({ agent, frame }) => {
      if (this.disposed || agent.id !== this.activeHandle?.agent.id) return
      this.handleStreamFrame(frame)
    })

    // Lifecycle status changes
    this.ctx.on('agent/status', ({ agent, status }) => {
      if (this.disposed || agent.id !== this.activeHandle?.agent.id) return
      if (status === 'idle') {
        this.streamAccumulator = ''
        this.streamAttemptId = undefined
        this.handlers.onRenderRequest('')
        this.setStatus('idle')
      } else {
        this.setStatus('running')
      }
    })

    // Session log events for tool presentation and transcript
    this.ctx.on('session/event', (session, event) => {
      if (this.disposed || session.id !== this.activeHandle?.agent.session.id) return
      this.handleSessionEvent(event)
    })
  }

  private handleStreamFrame(frame: AssistantStreamFrame): void {
    if (frame.type === 'start') {
      this.streamAttemptId = frame.attemptId
      this.streamAccumulator = ''
      this.handlers.onRenderRequest('')
    } else if (frame.type === 'chunk') {
      if (this.streamAttemptId && frame.chunk.type === 'text-delta') {
        this.streamAccumulator += frame.chunk.text
        if (this.streamAccumulator.length > this.maxStreamChars) {
          this.streamAccumulator = this.streamAccumulator.slice(-this.maxStreamChars)
        }
        this.handlers.onRenderRequest(this.streamAccumulator)
      }
    } else {
      this.streamAccumulator = ''
      this.streamAttemptId = undefined
      this.handlers.onRenderRequest('')
    }
  }

  private handleSessionEvent(event: SessionEvent): void {
    if (Number(event.seq) <= this.lastRenderedSeq) return
    this.lastRenderedSeq = Number(event.seq)

    if (event.type === 'tool/call') {
      const data = event.data as { callId?: string; name: string; arguments: string }
      let parsedArgs: unknown
      try {
        parsedArgs = JSON.parse(data.arguments)
      } catch {
        parsedArgs = data.arguments
      }
      if (data.callId) {
        this.activeToolCalls.set(data.callId, { name: data.name, args: parsedArgs })
      }
      const toolRegistry = this.ctx.get('tools')
      const toolDef = toolRegistry?.get(data.name, this.activeHandle?.agent)
      const view = toolDef?.presentCall?.(parsedArgs) ?? {
        card: 'generic' as const,
        title: data.name,
        rawInput: parsedArgs,
      }
      this.renderer.appendLine(renderToolCallView(view), 'tool')
    } else if (event.type === 'tool/result') {
      const data = event.data as {
        message?: { toolCallId?: string; content?: readonly ContentBlock[]; isError?: boolean }
        error?: { reason?: string; name: string }
      }
      const toolCallId = data.message?.toolCallId
      let toolName = 'tool'
      let parsedArgs: unknown = undefined

      if (toolCallId) {
        const cached = this.activeToolCalls.get(toolCallId)
        if (cached) {
          toolName = cached.name
          parsedArgs = cached.args
          this.activeToolCalls.delete(toolCallId)
        }
      }

      if (data.error) {
        this.renderer.appendLine(`✖ ${toolName} error: ${data.error.reason ?? data.error.name}`, 'error')
      } else {
        const toolRegistry = this.ctx.get('tools')
        const toolDef = toolRegistry?.get(toolName, this.activeHandle?.agent)
        const toolResultObj: ToolResult = {
          content: data.message?.content ? [...data.message.content] : [],
          isError: Boolean(data.message?.isError),
        }
        const view = toolDef?.presentResult?.(parsedArgs, toolResultObj) ?? {
          card: 'generic' as const,
          title: `${toolName} completed`,
        }
        this.renderer.appendLine(renderToolResultView(view), 'tool')
      }
    } else if (event.type === 'user/message') {
      const data = event.data as { content?: readonly { type: string; text?: string }[]; text?: string }
      const text =
        data.text ??
        data.content
          ?.filter(c => c.type === 'text')
          .map(c => c.text)
          .join('') ??
        ''
      if (text) {
        this.renderer.appendLine(text, 'user')
      }
    } else if (event.type === 'assistant/message') {
      const data = event.data as {
        message?: { content?: readonly { type: string; text?: string }[] }
        content?: readonly { type: string; text?: string }[]
        text?: string
      }
      const contentList = data.message?.content ?? data.content ?? []
      const text =
        data.text ??
        contentList
          .filter(c => c.type === 'text')
          .map(c => c.text)
          .join('')
      if (text) {
        this.renderer.appendLine(text, 'assistant')
      }
    }
  }

  private replayHistory(agent: Agent): void {
    const session = agent.session
    const total = session.seq
    const startSeq = Math.max(0, total - 100)
    for (let i = startSeq; i < total; i++) {
      // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
      const ev = session.eventAt(SessionSeq(i))
      if (ev) {
        this.handleSessionEvent(ev)
      }
    }
  }

  private async handleCommand(cmd: string): Promise<void> {
    const [name, ...args] = cmd.slice(1).split(/\s+/)
    switch (name) {
      case 'help': {
        this.renderer.appendLine(this.dict.commandHelpTitle, 'notice')
        this.renderer.appendLine(this.dict.commandHelpText, 'notice')
        break
      }
      case 'new': {
        const id = SessionId(randomUUID())
        await this.createSession(id)
        break
      }
      case 'resume': {
        const idStr = args[0]
        if (!idStr) {
          this.renderer.appendLine('Usage: /resume <sessionId>', 'error')
          return
        }
        await this.resumeSession(SessionId(idStr))
        break
      }
      case 'sessions': {
        const query = this.ctx.get('sessionQuery')
        if (!query) {
          this.renderer.appendLine('Session query service is not mounted', 'error')
          return
        }
        const sessions = await query.listSessions()
        this.renderer.appendLine(this.dict.sessionListHeader, 'notice')
        if (sessions.length === 0) {
          this.renderer.appendLine(this.dict.sessionNoHistory, 'notice')
        } else {
          for (const s of sessions.slice(0, 10)) {
            this.renderer.appendLine(`  ${s.header.id} (created: ${new Date(s.header.createdAt).toLocaleTimeString()})`, 'notice')
          }
        }
        break
      }
      case 'model': {
        const modelName = args[0]
        if (!modelName) {
          this.renderer.appendLine(`${this.dict.modelCurrent}: ${this.modelLabel}`, 'notice')
          const llm = this.ctx.get('llm')
          if (llm !== undefined) {
            try {
              const providers = llm.listProviders()
              if (providers.length > 0) {
                this.renderer.appendLine(this.dict.modelSelectPrompt, 'notice')
                for (const prov of providers) {
                  const catalog = await llm.listModels(prov.id)
                  for (const m of catalog.slice(0, 10)) {
                    this.renderer.appendLine(`  ${prov.id}/${m.id} (${m.name})`, 'notice')
                  }
                }
              }
            } catch {
              // Contained
            }
          }
          return
        }

        let provider = ''
        let model = ''
        let effortStr: string | undefined

        const firstArg = args[0] ?? ''
        const secondArg = args[1] ?? ''
        const thirdArg = args[2]

        if (modelName.includes('/')) {
          const slashIdx = modelName.indexOf('/')
          provider = modelName.slice(0, slashIdx)
          model = modelName.slice(slashIdx + 1)
          effortStr = secondArg || undefined
        } else if (args.length >= 3) {
          provider = firstArg
          model = secondArg
          effortStr = thirdArg
        } else if (args.length === 2) {
          if (['low', 'medium', 'high', 'default'].includes(secondArg)) {
            provider = ''
            model = firstArg
            effortStr = secondArg
          } else {
            provider = firstArg
            model = secondArg
            effortStr = undefined
          }
        } else {
          provider = ''
          model = modelName
          effortStr = undefined
        }

        // Validate reasoning effort if provided
        if (effortStr && !['low', 'medium', 'high', 'default'].includes(effortStr)) {
          this.renderer.appendLine(`${this.dict.modelEffortInvalidError}: ${effortStr}`, 'error')
          return
        }

        const effort = effortStr ? ReasoningEffortId(effortStr) : undefined

        // Validate provider and model if llm service is available
        const llm = this.ctx.get('llm')
        if (llm !== undefined) {
          try {
            const providers = llm.listProviders()
            if (provider && providers.length > 0) {
              const provFound = providers.some(p => p.id === provider)
              if (!provFound) {
                this.renderer.appendLine(`${this.dict.modelUnknownError}: provider '${provider}'`, 'error')
                return
              }
            }
            if (provider) {
              const catalog = await llm.listModels(provider)
              if (catalog.length > 0 && !catalog.some(m => m.id === model)) {
                this.renderer.appendLine(`${this.dict.modelUnknownError}: model '${model}' for provider '${provider}'`, 'error')
                return
              }
            }
          } catch (err) {
            this.renderer.appendLine(`${this.dict.errorOperationFailed}: ${err instanceof Error ? err.message : String(err)}`, 'error')
            return
          }
        }

        this.setModel({ provider, model, ...(effort ? { reasoningEffort: effort } : {}) })
        break
      }
      case 'clear': {
        this.renderer.clear()
        this.handlers.onRenderRequest()
        break
      }
      case 'quit': {
        this.ctx.appExit?.(0)
        break
      }
      default: {
        this.renderer.appendLine(`Unknown command: /${name}. Type /help for available commands.`, 'error')
      }
    }
  }
}
