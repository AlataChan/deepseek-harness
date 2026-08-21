/** Fresh, resume, and selector terminal runtime controller. @module @deepseek-ai/dsh-tui/driver/controller */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { Agent, ModelSelection } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionId as SessionIdType } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type { DisplayTextBudget } from '../transcript/display-text.ts'
import { createTranscriptProjection, type TranscriptProjection } from '../transcript/project.ts'
import {
  installTuiModelSelection,
  ownTuiSession,
  type OwnedTuiSession,
  type TuiModelSelectionRef,
} from './session.ts'
import {
  chooseResumeSession,
  loadResumeRows,
  requireResumeSession,
  type ResumeRow,
} from './resume.ts'

/** Startup intent accepted from the TUI app bundle. */
export type TuiControllerStartup =
  | { readonly kind: 'fresh'; readonly task?: string }
  | { readonly kind: 'resume-picker' }
  | { readonly kind: 'resume'; readonly sessionId: SessionIdType }

/** Explicit environment and validated limits for one controller. */
export interface TuiControllerOptions {
  readonly startup: TuiControllerStartup
  readonly cwd: string
  readonly displayBudget: DisplayTextBudget
  readonly sessionSelectorLimit: number
  readonly createSessionId?: () => SessionIdType
}

/** One terminal runtime controller, owning zero or one root Agent. */
export interface TuiController {
  readonly agent: Agent | undefined
  readonly modelSelection: TuiModelSelectionRef | undefined
  readonly transcript: TranscriptProjection
  readonly selectorRows: readonly ResumeRow[]
  readonly selectionCancelled: boolean
  /** Resume one id from the current closed selector snapshot. */
  selectSession(sessionId: SessionIdType): Promise<void>
  /** Close the selector without resuming a Session. */
  cancelSelection(): void
  /** Submit one ordinary user follow-up to the owned Agent. */
  submit(text: string): void
  /** Dispose the exact owned Agent once. */
  dispose(): Promise<void>
}

class Controller implements TuiController {
  private owned: OwnedTuiSession | undefined
  private rows: readonly ResumeRow[]
  private cancelled = false
  private disposed = false

  constructor(
    private readonly ctx: Context,
    private readonly fallback: ModelSelection,
    private readonly budget: DisplayTextBudget,
    rows: readonly ResumeRow[],
  ) {
    this.rows = rows
  }

  get agent(): Agent | undefined { return this.owned?.agent }
  get modelSelection(): TuiModelSelectionRef | undefined { return this.owned?.modelSelection }
  get transcript(): TranscriptProjection { return this.owned?.transcript ?? createTranscriptProjection() }
  get selectorRows(): readonly ResumeRow[] { return this.rows }
  get selectionCancelled(): boolean { return this.cancelled }

  /** Adopt one newly created or resumed handle. */
  setOwned(owned: OwnedTuiSession): void {
    this.owned = owned
  }

  async selectSession(sessionId: SessionIdType): Promise<void> {
    if (this.disposed) throw new Error('tui controller is disposed')
    if (this.owned !== undefined) throw new Error('tui controller already owns an Agent')
    const selected = chooseResumeSession(this.rows, sessionId)
    if (selected === undefined) return
    this.rows = Object.freeze([])
    const owned = await resumeOwned(this.ctx, selected, this.fallback, this.budget)
    if (this.disposed) {
      await owned.dispose()
      return
    }
    this.owned = owned
  }

  cancelSelection(): void {
    if (this.owned !== undefined || this.disposed) return
    this.cancelled = true
    this.rows = Object.freeze([])
  }

  submit(text: string): void {
    const agent = this.owned?.agent
    if (agent === undefined) throw new Error('tui controller has no active Agent')
    if (text.length === 0) return
    agent.followup(createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text }],
    }))
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.rows = Object.freeze([])
    await this.owned?.dispose()
    this.owned = undefined
  }
}

async function resumeOwned(
  ctx: Context,
  sessionId: SessionIdType,
  fallback: ModelSelection,
  budget: DisplayTextBudget,
): Promise<OwnedTuiSession> {
  let modelSelection: TuiModelSelectionRef | undefined
  const handle = await ctx.agents.resume({
    resumeSessionId: sessionId,
    setup(agentCtx) { modelSelection = installTuiModelSelection(agentCtx, fallback) },
  })
  if (modelSelection === undefined) {
    await handle.dispose()
    throw new Error('tui: resume setup did not install a model selection')
  }
  return ownTuiSession(handle, modelSelection, budget)
}

/**
 * Create the controller only after the complete Loader tree settles.
 * @param ctx - TUI plugin context carrying Agent, Session, query, and default-model services.
 * @param options - startup intent, process facts, and validated limits.
 * @returns a controller owning one Agent or one immutable resume selector.
 */
export async function createTuiController(
  ctx: Context,
  options: TuiControllerOptions,
): Promise<TuiController> {
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const query = ctx.get('sessionQuery')
  if (agents === undefined || defaultModel === undefined || query === undefined) {
    throw new Error('tui: required Agent, default-model, or session-query service was disposed during startup')
  }
  const fallback = defaultModel.currentSelection()
  if (options.startup.kind === 'resume-picker') {
    const rows = await loadResumeRows(query, options.sessionSelectorLimit)
    return new Controller(ctx, fallback, options.displayBudget, rows)
  }

  const controller = new Controller(ctx, fallback, options.displayBudget, Object.freeze([]))
  if (options.startup.kind === 'resume') {
    await requireResumeSession(query, options.startup.sessionId)
    controller.setOwned(await resumeOwned(ctx, options.startup.sessionId, fallback, options.displayBudget))
    return controller
  }

  let modelSelection: TuiModelSelectionRef | undefined
  const selection = fallback
  const handle = await agents.create({
    sessionId: options.createSessionId?.() ?? SessionId(`session-${randomUUID()}`),
    meta: { cwd: options.cwd },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup(agentCtx) { modelSelection = installTuiModelSelection(agentCtx, fallback) },
  })
  if (modelSelection === undefined) {
    await handle.dispose()
    throw new Error('tui: create setup did not install a model selection')
  }
  controller.setOwned(ownTuiSession(handle, modelSelection, options.displayBudget))
  if (options.startup.task !== undefined) controller.submit(options.startup.task)
  return controller
}
