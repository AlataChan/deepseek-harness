/** Local Changes Remote: checkout inspection, retained worktrees, and local diffs. */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-experimental-worktree'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { inspectCheckout } from './git.ts'
import type { Inspection } from './git.ts'
import { DiffTooLarge, FilterConfigError, forkPoint, localDiff, localText, NoForkPoint } from './local-diff.ts'
import { missingWorktree, SessionPanel } from './panel.ts'
import type { PanelConfig } from './panel.ts'
import type { Config, ForgeLocalDiff, ForgeLocalScope, ForgeMissingWorktree, ForgePanelState, ForgeSessionWorktree, ForgeWorktreeState } from './types.ts'
import { forgeWorktreeProjection, messageOf, within, WORKTREE_RECORD, WorktreeCreations } from './worktree.ts'
import type { HeldWork } from './worktree.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { forgePanel: ForgePanelController }
}

type ControllerConfig = PanelConfig & { readonly maxBranches: number; readonly worktreePrefix: string }

/** Owns local worktree requests and serialized Agent maintenance, without remote publication. */
export class ForgePanelController extends TypertRemoteService {
  static inject = ['sessionProjections', 'workingDirectory', 'fs', 'subprocess', 'sandbox', 'sandboxPolicy', 'agents']
  static Config: z<Config> = z.object({
    gitCommand: z.string().default('git'), gitTimeoutMs: z.number().default(10_000),
    graceMs: z.number().default(1_000), maxOutputBytes: z.number().default(1_048_576),
    maxBranches: z.number().default(50), worktreePrefix: z.string().default('dsh-'),
    maxDiffBytes: z.number().default(8_388_608), maxUntrackedFiles: z.number().default(100),
  })
  private readonly home: Context
  private readonly config: ControllerConfig
  private readonly panels = new Map<Session, SessionPanel>()
  private worktreeStates!: ProjectionHandle<ForgeWorktreeState>
  private creations!: WorktreeCreations
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'forgePanel')
    this.home = ctx
    this.config = config as Required<Config>
    if (this.config.gitCommand.trim().length === 0) throw new Error('forge-panel: gitCommand must not be empty')
    for (const key of ['gitTimeoutMs', 'graceMs', 'maxOutputBytes', 'maxBranches', 'maxDiffBytes', 'maxUntrackedFiles'] as const) {
      const value = this.config[key]
      if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TIMER_DELAY_MS) throw new Error(`forge-panel: ${key} must be a positive bounded integer`)
    }
    if (!branchPrefix(this.config.worktreePrefix)) throw new Error('forge-panel: worktreePrefix must start a valid Git branch name')
  }

  protected async [Service.init](): Promise<void> {
    const ctx = this.home
    const owner = ctx.plugin({ name: 'local-worktree-state', inject: ['sessionProjections'], apply: async (scope: Context) => {
      this.worktreeStates = await scope.sessionProjections.register(forgeWorktreeProjection)
    } })
    await owner
    this.creations = new WorktreeCreations(
      ctx, this.worktreeStates, this.config.worktreePrefix, session => this.panels.get(session)?.updateWorktree(),
    )
    const inbox = ctx.on('agent/inbox/inserted', ({ agent }) => { this.holdTurn(agent) })
    const events = ctx.on('session/event', (session: Session, event: SessionEvent) => { this.panels.get(session)?.observe(event) })
    ctx.effect(() => async () => {
      inbox()
      events()
      this.lifetime.abort(new Error('local worktree panel disposed'))
      const panels = [...this.panels.values()]
      this.panels.clear()
      await this.creations.dispose()
      await Promise.allSettled([...panels.map(panel => panel.dispose()), ...this.pending])
      await owner.dispose()
    }, 'local-worktree-panel: drain before releasing state')
  }

  /**
   * Read a bounded local diff without external diff helpers.
   * @param session - Session to inspect.
   * @param scope - Local comparison to read.
   * @param signal - Cancellation.
   * @returns bounded local comparison.
   */
  @Remote
  async localDiff(session: Session, scope: ForgeLocalScope, signal: AbortSignal): Promise<ForgeLocalDiff> {
    return await this.read(signal, async (operation) => {
      operation.throwIfAborted()
      const inspection = await this.checkoutOf(session, operation)
      const root = inspection.checkout.root
      const fork = scope.kind === 'branch'
        ? forkPoint(inspection, this.worktreeState(session).created)
        : null
      return await diffing(localDiff(this.home, this.config, session, root, fork, scope, operation))
    })
  }

  /**
   * Read the current text of a checkout-relative file.
   * @param session - Session to inspect.
   * @param scope - Local comparison.
   * @param path - Checkout-relative file.
   * @param signal - Cancellation.
   * @returns current file text.
   */
  @Remote
  async localText(session: Session, scope: ForgeLocalScope, path: string, signal: AbortSignal): Promise<string> {
    return await this.read(signal, async (operation) => {
      operation.throwIfAborted()
      const inspection = await this.checkoutOf(session, operation)
      return await diffing(localText(this.home, this.config, session, inspection.checkout.root, scope, path, operation))
    })
  }

  /**
   * Record a request consumed before the first model step.
   * @param session - Session before its first turn.
   * @param from - Local base ref, or null for HEAD.
   * @param signal - Cancellation before recording.
   * @returns after the operation is recorded or completed.
   */
  @Remote
  requestWorktree(session: Session, from: string | null, signal: AbortSignal): void {
    signal.throwIfAborted()
    if (from?.length === 0) throw new RemoteError('forgePanel/invalid-branch', 'The base branch name is empty', {})
    this.editableWorktree(session)
    this.creations.forget(session)
    session.append(WORKTREE_RECORD, { action: 'request', from })
    this.creations.recheck(session)
  }

  /**
   * Withdraw a request and release its waiting message.
   * @param session - Session with an open request.
   * @param signal - Cancellation before recording.
   * @returns after the operation is recorded or completed.
   */
  @Remote
  cancelWorktree(session: Session, signal: AbortSignal): void {
    signal.throwIfAborted()
    if (this.changeableWorktree(session).request === null) return
    this.creations.forget(session)
    session.append(WORKTREE_RECORD, { action: 'cancel' })
    this.creations.recheck(session)
  }

  /**
   * Abort a held attempt while retaining its request for retry.
   * @param session - Session whose held attempt stops.
   * @param signal - Cancellation of the control request.
   * @returns after the operation is recorded or completed.
   */
  @Remote
  stopCreation(session: Session, signal: AbortSignal): void {
    signal.throwIfAborted()
    this.creations.stop(session)
  }

  /**
   * Retry a held creation with a fresh name.
   * @param session - Session waiting after a failed or stopped creation.
   * @param signal - Cancellation of the control request.
   * @returns after the operation is recorded or completed.
   */
  @Remote
  retryWorktree(session: Session, signal: AbortSignal): void {
    signal.throwIfAborted()
    if (!this.creations.retry(session)) {
      throw new RemoteError('forgePanel/not-waiting', 'No message waits for another attempt at the worktree', {})
    }
  }

  /**
   * Restore a removed checkout without changing the execution directory.
   * @param session - Session retaining the missing checkout.
   * @param signal - Cancels restoration.
   * @returns after the operation is recorded or completed.
   */
  @Remote
  async restoreWorktree(session: Session, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const created = this.createdWorktree(session)
    const worktrees = this.home.get('worktrees')
    if (worktrees === undefined) throw new RemoteError('forgePanel/worktrees-unavailable', 'No worktree service is mounted', {})
    await this.maintain(session, async (agent, work) => {
      const operation = AbortSignal.any([signal, work])
      try {
        await this.creations.restore(agent, worktrees, created, operation,
          () => { this.panels.get(session)?.restored() },
          async check => await missingWorktree(this.home, this.config, session, this.worktreeState(session), created.path, check) === null)
      } catch (error) {
        operation.throwIfAborted()
        throw new RemoteError('forgePanel/restore-failed', messageOf(error), {}, { cause: error })
      }
    })
    this.panels.get(session)?.reinspect()
  }

  /**
   * Return to the immutable original project without removing the checkout.
   * @param session - Session retaining the original project identity.
   * @param signal - Cancels directory validation.
   * @returns after the operation is recorded or completed.
   */
  @Remote
  async continueInProject(session: Session, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const created = this.createdWorktree(session)
    await this.maintain(session, async (agent, work) => {
      await this.home.workingDirectory.set(agent, session.header.cwd ?? created.repositoryRoot, AbortSignal.any([signal, work]))
    })
  }

  /**
   * Follow one Session only while the caller retains its stream.
   * @param session - original Session identity.
   * @param signal - ends the subscription.
   * @returns local checkout states in publication order.
   */
  @Remote({ mode: 'stream' })
  async *follow(session: Session, signal: AbortSignal): AsyncIterable<ForgePanelState> {
    yield* this.panelOf(session).follow(signal)
  }

  private holdTurn(agent: Agent): void {
    const session = agent.session
    const state = this.worktreeState(session)
    if (state.request !== null && state.created === null && !state.locked) {
      this.creations.holdCreation(agent)
    } else if (state.created !== null && within(state.created.path, this.home.workingDirectory.get(session))) {
      this.creations.holdRestoration(agent, signal => this.missingFor(session, signal))
    }
  }

  /**
   * Check whether the worktree the Session works in is gone.
   * @param session - Session to check.
   * @param signal - cancellation of the check.
   * @returns the missing worktree, or null while it exists or once the Session works elsewhere.
   * @throws when the filesystem or Git cannot answer.
   */
  private async missingFor(session: Session, signal: AbortSignal): Promise<ForgeMissingWorktree | null> {
    const directory = this.home.workingDirectory.get(session)
    const panel = this.panels.get(session)
    const missing = panel === undefined
      ? await missingWorktree(this.home, this.config, session, this.worktreeState(session), directory, signal)
      : await panel.checkMissing(signal)
    return this.home.workingDirectory.get(session) === directory ? missing : null
  }

  /** Inspect the checkout of the Session's current directory, which local diffs read. */
  private async checkoutOf(session: Session, signal: AbortSignal): Promise<Inspection> {
    const inspection = await inspectCheckout(this.home, this.config, session, this.home.workingDirectory.get(session), signal)
    if (inspection === undefined) throw new RemoteError('forgePanel/not-a-checkout', 'The Session\'s directory is not inside a Git checkout', {})
    return inspection
  }

  private worktreeState(session: Session): ForgeWorktreeState {
    return this.worktreeStates.stateOf(session)
  }

  private editableWorktree(session: Session): ForgeWorktreeState {
    if (this.home.get('worktrees') === undefined) {
      throw new RemoteError('forgePanel/worktrees-unavailable', 'No worktree service is mounted', {})
    }
    return this.changeableWorktree(session)
  }

  /** The worktree state of a Session whose request may still change: no turn started, nothing created, and no attempt running. */
  private changeableWorktree(session: Session): ForgeWorktreeState {
    const state = this.worktreeState(session)
    if (state.locked || state.created !== null) {
      throw new RemoteError('forgePanel/session-started', 'The Session has started, so its worktree can no longer change', {})
    }
    // A creation records its worktree only for the request it started from.
    if (this.creations.of(session) !== null) throw new RemoteError('forgePanel/session-busy', 'The worktree is being created', {})
    return state
  }

  private createdWorktree(session: Session): ForgeSessionWorktree {
    const created = this.worktreeState(session).created
    if (created === null) throw new RemoteError('forgePanel/no-worktree', 'The Session has no created worktree', {})
    return created
  }

  /**
   * Run work as maintenance of the Session's Agent: inside the wait of a
   * message that waits for the removed worktree, else as a task of its own,
   * which the Agent refuses while it has other work.
   */
  private async maintain(session: Session, work: HeldWork): Promise<void> {
    const held = this.creations.within(session, work)
    if (held !== undefined) {
      await held
      return
    }
    const agent = this.home.agents.get(session.id)
    if (agent === undefined) throw new RemoteError('forgePanel/session-busy', 'The Session is not loaded', {})
    let running: Promise<void>
    try {
      running = agent.runMaintenance(async (signal) => { await work(agent, AbortSignal.any([signal, this.lifetime.signal])) })
    } catch (error) {
      throw new RemoteError('forgePanel/session-busy', 'The Session is busy', {}, { cause: error })
    }
    this.pending.add(running)
    try { await running } finally { this.pending.delete(running) }
  }

  private async read<T>(signal: AbortSignal, body: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const operation = AbortSignal.any([signal, this.lifetime.signal])
    operation.throwIfAborted()
    const task = body(operation)
    this.pending.add(task)
    try { return await task } finally { this.pending.delete(task) }
  }

  private panelOf(session: Session): SessionPanel {
    let panel = this.panels.get(session)
    if (panel === undefined) {
      const created: SessionPanel = new SessionPanel(this.home, this.config, session, this.worktreeStates, this.creations, () => {
        if (this.panels.get(session) !== created) return
        this.panels.delete(session)
        void created.dispose()
      })
      panel = created
      this.panels.set(session, panel)
    }
    return panel
  }
}

async function diffing<T>(reading: Promise<T>): Promise<T> {
  try {
    return await reading
  } catch (error) {
    if (error instanceof FilterConfigError) throw new RemoteError('forgePanel/filter-config-failed', error.message, {}, { cause: error })
    if (error instanceof DiffTooLarge) throw new RemoteError('forgePanel/diff-too-large', error.message, {}, { cause: error })
    if (error instanceof NoForkPoint) throw new RemoteError('forgePanel/no-fork-point', error.message, {}, { cause: error })
    throw error
  }
}

function branchPrefix(prefix: string): boolean {
  const name = `${prefix}0`
  if (name.startsWith('-') || name.includes('..') || name.includes('@{')) return false
  for (const char of name) {
    if (char <= ' ' || char === '\x7f' || '~^:?*[\\'.includes(char)) return false
  }
  return name.split('/').every(part => part.length > 0 && !part.startsWith('.') && !part.endsWith('.lock'))
}

export default ForgePanelController
