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
import { displayText, type DisplayTextBudget } from '../transcript/display-text.ts'
import { retainTranscriptRows } from '../transcript/retention.ts'
import type { TuiStore } from '../state/store.ts'
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
import { installTuiApproval, type TuiApprovalController } from './approval.ts'
import { installTuiQuestions, type TuiQuestionsController } from './questions.ts'

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
  readonly resumeTranscriptRows: number
  readonly store: TuiStore
  readonly createSessionId?: () => SessionIdType
}

/** One terminal runtime controller, owning zero or one root Agent. */
export interface TuiController {
  readonly agent: Agent | undefined
  readonly modelSelection: TuiModelSelectionRef | undefined
  readonly transcript: TranscriptProjection
  readonly selectorRows: readonly ResumeRow[]
  readonly selectionCancelled: boolean
  readonly store: TuiStore
  readonly approval: TuiApprovalController
  readonly questions: TuiQuestionsController
  /** Resume one id from the current closed selector snapshot. */
  selectSession(sessionId: SessionIdType): Promise<void>
  /** Close the selector without resuming a Session. */
  cancelSelection(): void
  /** Submit one ordinary user follow-up to the owned Agent. */
  submit(text: string): void
  /** Load an immutable resume selector while the current Agent stays idle. */
  openResumeSelector(): Promise<void>
  /** Cancel active work with the stable user cause. */
  cancelActive(): void
  /** Settle any visible interaction without granting it. */
  settleInteractions(): void
  /** Await the current Agent's complete activity drain. */
  whenIdle(): Promise<void>
  /** Flush the current Session when one is owned. */
  flush(): Promise<void>
  /** Dispose the exact owned Agent once. */
  dispose(): Promise<void>
}

class Controller implements TuiController {
  private owned: OwnedTuiSession | undefined
  private rows: readonly ResumeRow[]
  private cancelled = false
  private disposed = false
  readonly approval: TuiApprovalController
  readonly questions: TuiQuestionsController

  constructor(
    private readonly ctx: Context,
    private readonly fallback: ModelSelection,
    private readonly budget: DisplayTextBudget,
    private readonly selectorLimit: number,
    private readonly resumeRowsLimit: number,
    rows: readonly ResumeRow[],
    readonly store: TuiStore,
  ) {
    this.rows = rows
    this.approval = installTuiApproval(ctx, { owner: () => this.agent, store })
    this.questions = installTuiQuestions(ctx, { owner: () => this.agent, store })
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

  private publish(projection: TranscriptProjection): void {
    this.store.dispatch({ type: 'transcript/sync', projection })
    this.store.dispatch({ type: projection.turn.kind === 'running' ? 'runtime/running' : 'runtime/idle' })
  }

  /** Wrap one Agent handle with this controller's projection observers. */
  ownHandle(
    handle: Parameters<typeof ownTuiSession>[0],
    selection: TuiModelSelectionRef,
    resumed: boolean,
  ): OwnedTuiSession {
    return ownTuiSession(
      handle,
      selection,
      this.budget,
      (projection) => {
        if (!resumed) {
          this.publish(projection)
          return
        }
        const rows = retainTranscriptRows(projection.rows, this.resumeRowsLimit).map(row => (
          row.kind === 'omission'
            ? { kind: 'status' as const, sourceSeq: -1, text: displayText(row.text, this.budget) }
            : row
        ))
        this.publish({ ...projection, rows })
      },
      (status) => { this.store.dispatch({ type: status === 'running' ? 'runtime/running' : 'runtime/idle' }) },
    )
  }

  async selectSession(sessionId: SessionIdType): Promise<void> {
    if (this.disposed) throw new Error('tui controller is disposed')
    const selected = chooseResumeSession(this.rows, sessionId)
    if (selected === undefined) return
    if (this.owned?.agent.id === selected) {
      this.rows = Object.freeze([])
      this.store.dispatch({ type: 'overlay/close' })
      return
    }
    this.rows = Object.freeze([])
    const owned = await resumeOwned(
      this.ctx, selected, this.fallback, this.budget,
      (handle, selection) => this.ownHandle(handle, selection, true),
    )
    // dispose() may run while the asynchronous persistence resume is pending.
    if (this.disposed) {
      await owned.dispose()
      return
    }
    const previous = this.owned
    this.owned = owned
    this.store.dispatch({ type: 'overlay/close' })
    await previous?.dispose()
  }

  cancelSelection(): void {
    if (this.disposed) return
    this.cancelled = true
    this.rows = Object.freeze([])
    this.store.dispatch({ type: 'overlay/close' })
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

  async openResumeSelector(): Promise<void> {
    if (this.disposed) throw new Error('tui controller is disposed')
    if (this.agent?.status === 'running' || this.store.getSnapshot().interaction !== undefined) {
      throw new Error('tui: cannot resume while a turn or interaction is active')
    }
    const query = this.ctx.get('sessionQuery')
    if (query === undefined) throw new Error('tui: session-query service was disposed')
    this.rows = await loadResumeRows(query, this.selectorLimit)
    this.store.dispatch({ type: 'overlay/open', overlay: { kind: 'resume' } })
  }

  cancelActive(): void {
    this.agent?.cancel({ kind: 'user' })
  }

  settleInteractions(): void {
    const interaction = this.store.getSnapshot().interaction
    if (interaction?.kind === 'approval') this.approval.cancel(interaction.id)
    if (interaction?.kind === 'question') this.questions.cancel(interaction.id)
  }

  async whenIdle(): Promise<void> {
    await this.agent?.whenIdle()
  }

  async flush(): Promise<void> {
    const agent = this.agent
    if (agent !== undefined) await this.ctx.sessions.flush(agent.session)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.rows = Object.freeze([])
    this.approval.dispose()
    this.questions.dispose()
    await this.owned?.dispose()
    this.owned = undefined
    this.store.dispatch({ type: 'runtime/dispose' })
  }
}

async function resumeOwned(
  ctx: Context,
  sessionId: SessionIdType,
  fallback: ModelSelection,
  budget: DisplayTextBudget,
  own: (handle: Parameters<typeof ownTuiSession>[0], selection: TuiModelSelectionRef) => OwnedTuiSession =
    (handle, selection) => ownTuiSession(handle, selection, budget),
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
  return own(handle, modelSelection)
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
    return new Controller(
      ctx, fallback, options.displayBudget, options.sessionSelectorLimit,
      options.resumeTranscriptRows, rows, options.store,
    )
  }

  const controller = new Controller(
    ctx, fallback, options.displayBudget, options.sessionSelectorLimit,
    options.resumeTranscriptRows, Object.freeze([]), options.store,
  )
  try {
    if (options.startup.kind === 'resume') {
      await requireResumeSession(query, options.startup.sessionId)
      controller.setOwned(await resumeOwned(
        ctx, options.startup.sessionId, fallback, options.displayBudget,
        (handle, selection) => controller.ownHandle(handle, selection, true),
      ))
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
    controller.setOwned(controller.ownHandle(handle, modelSelection, false))
    if (options.startup.task !== undefined) controller.submit(options.startup.task)
    return controller
  } catch (error) {
    await controller.dispose()
    throw error
  }
}
