/** Local checkout observations shared by the followers of one Session. */
import { FiberState, type Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import { gitIn, hasBranch, inspectCheckout } from './git.ts'
import type { GitConfig } from './git.ts'
import { localChanges } from './local-diff.ts'
import type { DiffConfig } from './local-diff.ts'
import type { ForgeMissingWorktree, ForgePanelState, ForgePanelWorktree, ForgeWorktreeState } from './types.ts'
import { messageOf, within } from './worktree.ts'
import type { WorktreeCreations } from './worktree.ts'

/** Git and diff bounds for the local panel. */
export type PanelConfig = DiffConfig

/** One lazily inspected panel; disposal cancels and drains every Git read. */
export class SessionPanel {
  private current: ForgePanelState
  private readonly listeners = new Set<() => void>()
  private readonly lifetime = new AbortController()
  private readonly tasks = new Set<Promise<void>>()
  private inspectAgain = false
  private inspection: Promise<void> | undefined

  constructor(
    private readonly ctx: Context,
    private readonly config: PanelConfig,
    readonly session: Session,
    private readonly states: ProjectionHandle<ForgeWorktreeState>,
    private readonly creations: WorktreeCreations,
    private readonly onIdle: () => void,
  ) {
    this.current = { directory: ctx.workingDirectory.get(session), checkout: { state: 'pending' }, worktree: this.worktree(), local: null }
    this.reinspect()
  }

  /**
   * Follow the current state and subsequent committed observations.
   * @param signal - follower cancellation.
   * @returns ordered states; slow readers may skip intermediate states.
   */
  async *follow(signal: AbortSignal): AsyncGenerator<ForgePanelState> {
    let wake: (() => void) | undefined
    const changed = (): void => { wake?.() }
    this.listeners.add(changed)
    signal.addEventListener('abort', changed)
    this.lifetime.signal.addEventListener('abort', changed)
    try {
      let previous: ForgePanelState | undefined
      while (!signal.aborted && !this.lifetime.signal.aborted) {
        if (previous !== this.current) { previous = this.current; yield previous; continue }
        await new Promise<void>((resolve) => { wake = resolve })
        wake = undefined
      }
    } finally {
      this.listeners.delete(changed)
      signal.removeEventListener('abort', changed)
      this.lifetime.signal.removeEventListener('abort', changed)
      if (this.listeners.size === 0) this.onIdle()
    }
  }

  /**
   * Reinspect after a committed filesystem-affecting result or directory change.
   * @param event - committed Session event.
   */
  observe(event: SessionEvent): void {
    if (event.type === 'working-directory/change' || event.type === 'tool/result' || event.type === 'worktree/record') this.reinspect()
    this.updateWorktree()
  }

  /** Publish durable and in-flight worktree state together. */
  updateWorktree(): void {
    this.publish({
      ...this.current, directory: this.ctx.workingDirectory.get(this.session),
      worktree: this.worktree(this.current.worktree.missing),
    })
  }

  /** Schedule one inspection after any inspection already in flight. */
  reinspect(): void {
    if (this.lifetime.signal.aborted) return
    this.inspectAgain = true
    if (this.inspection !== undefined) return
    const operation = this.inspectLoop()
    this.inspection = operation
    this.tasks.add(operation)
    void operation.finally(() => { this.tasks.delete(operation); this.inspection = undefined })
  }

  /** A completed restore triggers a fresh checkout inspection. */
  restored(): void { this.reinspect() }

  /**
   * Inspect whether the recorded checkout is missing.
   * @param signal - cancellation.
   * @returns missing checkout details, or null.
   */
  async checkMissing(signal: AbortSignal): Promise<ForgeMissingWorktree | null> {
    const state = this.states.stateOf(this.session)
    return await missingWorktree(
      this.ctx, this.config, this.session, state,
      state.created?.path ?? this.ctx.workingDirectory.get(this.session), signal,
    )
  }

  /** Cancel all reads and await their termination before releasing followers. */
  async dispose(): Promise<void> {
    this.lifetime.abort()
    for (const listener of [...this.listeners]) listener()
    await Promise.allSettled(this.tasks)
    this.listeners.clear()
  }

  private worktree(missing: ForgeMissingWorktree | null = null): ForgePanelWorktree {
    const state = this.states.stateOf(this.session)
    return {
      editable: this.ctx.get('worktrees') !== undefined && !state.locked && state.created === null,
      blocker: this.ctx.sandboxPolicy.resolve({ session: this.session }).mode === 'read-only' ? 'read-only' : null,
      request: state.request, created: state.created, creation: this.creations.of(this.session),
      failure: this.creations.failureOf(this.session), missing,
      restoration: this.creations.restorationOf(this.session), waiting: this.creations.waitingOf(this.session),
    }
  }

  private publish(state: ForgePanelState): void {
    if (this.lifetime.signal.aborted) return
    this.current = state
    for (const listener of [...this.listeners]) listener()
  }

  private stopped(): boolean { return this.lifetime.signal.aborted || this.ctx.fiber.state !== FiberState.ACTIVE }

  private async inspectLoop(): Promise<void> {
    while (this.inspectAgain && !this.stopped()) {
      this.inspectAgain = false
      const directory = this.ctx.workingDirectory.get(this.session)
      try {
        const missing = await this.checkMissing(this.lifetime.signal)
        const inspection = missing === null
          ? await inspectCheckout(this.ctx, this.config, this.session, directory, this.lifetime.signal)
          : undefined
        const local = inspection === undefined ? null : await localChanges(
          this.ctx, this.config, this.session, inspection, this.states.stateOf(this.session).created, this.lifetime.signal,
        )
        if (this.stopped()) return
        if (directory !== this.ctx.workingDirectory.get(this.session)) continue
        this.publish({ directory, checkout: inspection === undefined ? { state: 'none' } : { state: 'ready', checkout: inspection.checkout }, worktree: this.worktree(missing), local })
      } catch (error) {
        if (this.stopped()) return
        if (directory !== this.ctx.workingDirectory.get(this.session)) continue
        this.publish({ ...this.current, directory, checkout: { state: 'failed', message: messageOf(error) }, worktree: this.worktree() })
      }
    }
  }
}

/**
 * Decide whether a Session works inside the worktree it created while that
 * worktree's directory is gone, and whether its branch still exists.
 * @param ctx - context that provides `fs` and the process services.
 * @param config - Git limits.
 * @param session - Session to check.
 * @param state - recorded worktree and restoration completion.
 * @param directory - the Session's current directory.
 * @param signal - cancellation of the check.
 * @returns the unavailable worktree, or null for a valid checkout or a Session working elsewhere.
 * @throws when the filesystem or Git cannot answer.
 */
export async function missingWorktree(
  ctx: Context,
  config: GitConfig,
  session: Session,
  state: ForgeWorktreeState,
  directory: string,
  signal: AbortSignal,
): Promise<ForgeMissingWorktree | null> {
  const created = state.created
  if (created === null || !within(created.path, directory)) return null
  if (!state.restoring && await ctx.fs.lstat(created.path, undefined, signal) !== undefined) {
    const git = gitIn(ctx, config, session, created.path, signal)
    const top = await git('rev-parse', ['rev-parse', '--show-toplevel'], [0, 128])
    if (top.exitCode === 0) {
      const target = await ctx.fs.resolve(created.path, { signal })
      const root = await ctx.fs.resolve(top.stdout.replace(/\r?\n$/, ''), { cwd: created.path, signal })
      if (root.targetKey === target.targetKey) {
        const common = await git('common-dir', ['rev-parse', '--path-format=absolute', '--git-common-dir'])
        const source = await gitIn(ctx, config, session, created.repositoryRoot, signal)(
          'common-dir', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        )
        const actual = await ctx.fs.resolve(common.stdout.replace(/\r?\n$/, ''), { cwd: created.path, signal })
        const expected = await ctx.fs.resolve(source.stdout.replace(/\r?\n$/, ''), { cwd: created.repositoryRoot, signal })
        if (actual.targetKey === expected.targetKey) return null
      }
    }
  }
  try {
    return { branchExists: await hasBranch(ctx, config, session, created.repositoryRoot, created.branch, signal) }
  } catch (error) {
    signal.throwIfAborted()
    if (!state.restoring) throw error
    return { branchExists: null }
  }
}
