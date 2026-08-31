/**
 * Per-session mutex shared by commitAskData, prompt, and agentPresets.select.
 * Reentrant on the same AsyncLocalStorage stack. External select while commit
 * holds the lock rejects `session/busy` (waiting would deadlock).
 * @module @deepseek-ai/dsh-api-session-controller/session-gate
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'

/** How a second caller treats a lock already held by another stack. */
export type SessionGateContention = 'wait' | 'reject'

/**
 * Per-session exclusive gate with same-stack reentry.
 */
export class SessionCallGate {
  private readonly als = new AsyncLocalStorage<ReadonlySet<string>>()
  private readonly holders = new Set<string>()
  private readonly waiters = new Map<string, Promise<void>>()

  /**
   * Whether another stack holds `sessionId` (this stack's reentry is not held).
   * @param sessionId - Session identity.
   * @returns true when an external caller would contend.
   */
  isExternallyHeld(sessionId: SessionId): boolean {
    return this.holders.has(sessionId) && this.als.getStore()?.has(sessionId) !== true
  }

  /**
   * Whether this stack already owns `sessionId`.
   * @param sessionId - Session identity.
   * @returns true inside a nested `run` for the same id.
   */
  isReentrant(sessionId: SessionId): boolean {
    return this.als.getStore()?.has(sessionId) === true
  }

  /**
   * Run `task` while holding `sessionId`.
   * @param sessionId - Session identity.
   * @param contention - wait for the holder, or reject `session/busy`.
   * @param task - exclusive work.
   * @returns the task result.
   */
  async run<T>(
    sessionId: SessionId,
    contention: SessionGateContention,
    task: () => Promise<T>,
  ): Promise<T> {
    if (this.isReentrant(sessionId)) return task()
    if (this.holders.has(sessionId) && contention === 'reject') {
      throw new RemoteError(
        'session/busy',
        `session "${sessionId}" is busy`,
        { sessionId },
      )
    }
    while (this.holders.has(sessionId)) {
      await this.waiters.get(sessionId)
    }
    this.holders.add(sessionId)
    let release!: () => void
    this.waiters.set(sessionId, new Promise<void>((resolve) => { release = resolve }))
    const owned = new Set(this.als.getStore())
    owned.add(sessionId)
    try {
      return await this.als.run(owned, task)
    } finally {
      this.holders.delete(sessionId)
      this.waiters.delete(sessionId)
      release()
    }
  }
}

/** One Host-wide FIFO for every `commitAskData`. */
export class CommitFifo {
  private chain: Promise<void> = Promise.resolve()

  /**
   * Enqueue `task` behind every earlier commit.
   * @param task - exclusive commit body.
   * @returns the task result.
   */
  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task)
    this.chain = run.then(() => undefined, () => undefined)
    return run
  }
}
