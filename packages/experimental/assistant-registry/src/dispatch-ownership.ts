/**
 * Execution ownership tokens, slot queue arbitration, and foreign ownership conflict detection.
 * @module @deepseek-ai/dsh-experimental-assistant-registry/dispatch-ownership
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId, Session } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, MessageId, MessageSource } from '@deepseek-ai/dsh-llm'
import type { SubagentSendMessageOptions } from '@deepseek-ai/dsh-subagent'
import type { TeamSeatId } from './types.ts'

/** Token representing exclusive execution interval ownership over a Session. */
export interface ExecutionOwnershipToken {
  /** Unique token string for verifying authorized submission. */
  readonly token: string
  /** Group discussion round identity. */
  readonly roundId: string
  /** Slot identity within the group round. */
  readonly slotId: string
  /** Attempt sequence identifier for retry tracking. */
  readonly attemptId: string
  /** Session under exclusive execution ownership. */
  readonly sessionId: SessionId
  /** Optional team seat identity associated with this session. */
  readonly seatId?: TeamSeatId | undefined
  /** Owning coordinator, tool, or slot actor. */
  readonly ownerId: string
  /** Timestamp when ownership was acquired. */
  readonly acquiredAt: number
  /** Authorized delegation chain allowed to submit during this slot. */
  readonly delegationChain: readonly string[]
  /** AbortController for interrupting active execution when this slot is cancelled. */
  readonly abortController: AbortController
}

/** Specific category of foreign ownership conflict. */
export type ConflictType =
  | 'foreign_ownership_detected'
  | 'foreign_prompt_during_slot'
  | 'unresolvable_mixed_ownership'

/** Record detailing an unauthorized foreign submission attempt during an active slot interval. */
export interface ForeignOwnershipConflict {
  /** Session on which the conflict was detected. */
  readonly sessionId: SessionId
  /** Category of conflict. */
  readonly conflictType: ConflictType
  /** Active ownership token that was violated. */
  readonly activeToken: ExecutionOwnershipToken
  /** Actor or submission path that attempted foreign input. */
  readonly attemptedBy: string
  /** Detailed reason or contextual diagnostic message. */
  readonly details: string
  /** Timestamp when the conflict was detected. */
  readonly detectedAt: number
}

/** Error thrown when an execution ownership violation or conflict occurs. */
export class OwnershipConflictError extends Error {
  /**
   * Create an ownership conflict error with detailed diagnostic context.
   * @param conflict - captured foreign ownership conflict record.
   */
  constructor(readonly conflict: ForeignOwnershipConflict) {
    super(`Execution ownership conflict on session "${conflict.sessionId}": ${conflict.conflictType} (${conflict.details})`)
    this.name = 'OwnershipConflictError'
  }
}

/** Lifecycle status of a queued slot input. */
export type SlotInputStatus = 'queued' | 'active' | 'completed' | 'cancelled' | 'failed'

/** A pending or active slot input held in the fork-owned queue before start. */
export interface QueuedSlotInput<T = unknown> {
  /** Unique queue entry identifier. */
  readonly id: string
  /** Group discussion round identity. */
  readonly roundId: string
  /** Slot identity within the round. */
  readonly slotId: string
  /** Attempt sequence identifier. */
  readonly attemptId: string
  /** Destination session identity. */
  readonly targetSessionId: SessionId
  /** Optional team seat identity. */
  readonly seatId?: TeamSeatId | undefined
  /** Payload content to be delivered when the slot starts. */
  readonly payload: T
  /** Timestamp when queued. */
  readonly queuedAt: number
  /** Current lifecycle status. */
  status: SlotInputStatus
  /** Timestamp when slot started execution. */
  startedAt?: number | undefined
  /** Timestamp when slot finished. */
  completedAt?: number | undefined
  /** Timestamp when slot was cancelled. */
  cancelledAt?: number | undefined
  /** Error message if failed. */
  error?: string | undefined
  /** Controller used to abort active work. */
  readonly abortController: AbortController
}

/** Parameters required to acquire execution ownership for a session. */
export interface AcquireOwnershipParams {
  /** Group discussion round identity. */
  readonly roundId: string
  /** Slot identity within the round. */
  readonly slotId: string
  /** Attempt sequence identifier. */
  readonly attemptId: string
  /** Target session identity. */
  readonly sessionId: SessionId
  /** Optional team seat identity. */
  readonly seatId?: TeamSeatId | undefined
  /** Owning actor identity. */
  readonly ownerId: string
  /** Additional authorized actors in the delegation chain. */
  readonly delegationChain?: readonly string[] | undefined
}

/** Parameters required to enqueue an unstarted slot input. */
export interface EnqueueSlotInputParams<T = unknown> {
  /** Group discussion round identity. */
  readonly roundId: string
  /** Slot identity within the round. */
  readonly slotId: string
  /** Attempt sequence identifier. */
  readonly attemptId: string
  /** Target session identity. */
  readonly targetSessionId: SessionId
  /** Optional team seat identity. */
  readonly seatId?: TeamSeatId | undefined
  /** Input payload. */
  readonly payload: T
}

/** Result of a slot cancellation operation. */
export interface CancelSlotResult {
  /** Whether a slot was found and cancelled. */
  readonly cancelled: boolean
  /** Whether the slot was actively executing when cancelled. */
  readonly wasActive: boolean
  /** Cancelled queue entry, if found. */
  readonly item?: QueuedSlotInput | undefined
}

/**
 * Dispatch ownership manager arbitrating execution tokens, slot queue, and foreign conflict detection.
 */
export class DispatchOwnershipManager {
  private readonly activeTokens = new Map<SessionId, ExecutionOwnershipToken>()
  private readonly conflicts = new Map<SessionId, ForeignOwnershipConflict[]>()
  private readonly queuedInputs: QueuedSlotInput[] = []
  private readonly releaseWaiters = new Map<SessionId, Set<() => void>>()
  private subagentWrapperInstalled = false

  /**
   * Construct an ownership manager bound to the Cordis context.
   * @param ctx - live Cordis context for subscribing to session events and wrapping services.
   */
  constructor(private readonly ctx: Context) {
    this.installSessionEventMonitor()
    this.installSubagentInterception()
  }

  /**
   * Acquire exclusive execution ownership over a session.
   * @param params - round, slot, attempt, session, and owner details.
   * @returns established or existing re-entrant ownership token.
   * @throws OwnershipConflictError if the session is held by a different slot.
   */
  acquireOwnership(params: AcquireOwnershipParams): ExecutionOwnershipToken {
    const current = this.activeTokens.get(params.sessionId)
    if (current !== undefined) {
      // Re-entrant: same round and slot
      if (current.roundId === params.roundId && current.slotId === params.slotId) {
        return current
      }
      // Delegation chain check
      if (current.delegationChain.includes(params.ownerId) || current.ownerId === params.ownerId) {
        return current
      }
      // Unresolvable mixed ownership conflict
      const conflict: ForeignOwnershipConflict = {
        sessionId: params.sessionId,
        conflictType: 'unresolvable_mixed_ownership',
        activeToken: current,
        attemptedBy: params.ownerId,
        details: `Session "${params.sessionId}" is already owned by round "${current.roundId}" slot "${current.slotId}" (owner: ${current.ownerId})`,
        detectedAt: Date.now(),
      }
      this.recordConflict(conflict)
      throw new OwnershipConflictError(conflict)
    }

    const token: ExecutionOwnershipToken = {
      token: `token-${randomUUID()}`,
      roundId: params.roundId,
      slotId: params.slotId,
      attemptId: params.attemptId,
      sessionId: params.sessionId,
      seatId: params.seatId,
      ownerId: params.ownerId,
      acquiredAt: Date.now(),
      delegationChain: params.delegationChain ?? [],
      abortController: new AbortController(),
    }
    this.activeTokens.set(params.sessionId, token)
    return token
  }

  /**
   * Release execution ownership for a session.
   * @param tokenOrSessionId - token or target session identifier.
   * @returns true if an active token was removed.
   */
  releaseOwnership(tokenOrSessionId: string | ExecutionOwnershipToken | SessionId): boolean {
    let targetSessionId: SessionId | undefined
    let expectedToken: string | undefined
    if (typeof tokenOrSessionId === 'string') {
      if (tokenOrSessionId.startsWith('token-')) {
        expectedToken = tokenOrSessionId
        for (const [id, token] of this.activeTokens) {
          if (token.token === tokenOrSessionId) {
            targetSessionId = id
            break
          }
        }
      } else {
        targetSessionId = tokenOrSessionId as SessionId
      }
    } else {
      targetSessionId = tokenOrSessionId.sessionId
      expectedToken = tokenOrSessionId.token
    }

    if (targetSessionId === undefined) return false
    const current = this.activeTokens.get(targetSessionId)
    if (current === undefined) return false
    if (expectedToken !== undefined && current.token !== expectedToken) {
      return false
    }

    this.activeTokens.delete(targetSessionId)
    const waiters = this.releaseWaiters.get(targetSessionId)
    if (waiters !== undefined) {
      for (const wake of waiters) {
        try {
          wake()
        } catch {
          // ignore waiter notification errors
        }
      }
      this.releaseWaiters.delete(targetSessionId)
    }
    return true
  }

  /**
   * Look up the currently active ownership token for a session.
   * @param sessionId - target session identity.
   * @returns active token or undefined.
   */
  getOwnership(sessionId: SessionId): ExecutionOwnershipToken | undefined {
    return this.activeTokens.get(sessionId)
  }

  /**
   * Whether a session is currently held under execution ownership.
   * @param sessionId - target session identity.
   * @returns true if owned.
   */
  isOwned(sessionId: SessionId): boolean {
    return this.activeTokens.has(sessionId)
  }

  /**
   * Whether a session is owned by a different slot than the specified round and slot.
   * @param sessionId - target session identity.
   * @param roundId - candidate round identity.
   * @param slotId - candidate slot identity.
   * @returns true if owned by a foreign slot.
   */
  isOwnedByOther(sessionId: SessionId, roundId?: string, slotId?: string): boolean {
    const active = this.activeTokens.get(sessionId)
    if (active === undefined) return false
    if (roundId === undefined || slotId === undefined) return true
    return active.roundId !== roundId || active.slotId !== slotId
  }

  /**
   * Wait until any active ownership on the target session is released.
   * @param sessionId - target session identity.
   * @param signal - optional cancellation signal.
   * @returns promise resolving when free.
   */
  async waitForRelease(sessionId: SessionId, signal?: AbortSignal): Promise<void> {
    if (!this.activeTokens.has(sessionId)) return
    if (signal?.aborted) throw signal.reason

    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        const waiters = this.releaseWaiters.get(sessionId)
        waiters?.delete(wake)
        reject(signal?.reason)
      }
      const wake = (): void => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      let waiters = this.releaseWaiters.get(sessionId)
      if (waiters === undefined) {
        waiters = new Set()
        this.releaseWaiters.set(sessionId, waiters)
      }
      waiters.add(wake)
    })
  }

  /**
   * Record a foreign ownership conflict.
   * @param conflict - captured conflict details.
   */
  recordConflict(conflict: ForeignOwnershipConflict): void {
    let list = this.conflicts.get(conflict.sessionId)
    if (list === undefined) {
      list = []
      this.conflicts.set(conflict.sessionId, list)
    }
    list.push(conflict)
  }

  /**
   * Retrieve all recorded conflicts for a session.
   * @param sessionId - target session identity.
   * @returns list of detected conflicts.
   */
  getConflicts(sessionId: SessionId): readonly ForeignOwnershipConflict[] {
    return this.conflicts.get(sessionId) ?? []
  }

  /**
   * Whether any conflicts have been recorded for a session.
   * @param sessionId - target session identity.
   * @returns true if conflicts exist.
   */
  hasConflict(sessionId: SessionId): boolean {
    const list = this.conflicts.get(sessionId)
    return list !== undefined && list.length > 0
  }

  /**
   * Clear all recorded conflicts for a session.
   * @param sessionId - target session identity.
   */
  clearConflicts(sessionId: SessionId): void {
    this.conflicts.delete(sessionId)
  }

  /**
   * Hold a slot input in the fork-owned queue before the slot starts.
   * @param params - round, slot, attempt, session, and payload.
   * @returns the created queued slot entry.
   */
  enqueueSlotInput<T>(params: EnqueueSlotInputParams<T>): QueuedSlotInput<T> {
    const item: QueuedSlotInput<T> = {
      id: `slot-input-${randomUUID()}`,
      roundId: params.roundId,
      slotId: params.slotId,
      attemptId: params.attemptId,
      targetSessionId: params.targetSessionId,
      seatId: params.seatId,
      payload: params.payload,
      queuedAt: Date.now(),
      status: 'queued',
      abortController: new AbortController(),
    }
    this.queuedInputs.push(item as QueuedSlotInput)
    return item
  }

  /**
   * Start execution for a queued slot, acquiring ownership and transitioning to active.
   * @param roundId - group round identity.
   * @param slotId - slot identity.
   * @param options - optional owner and delegation details.
   * @returns the activated input and newly established ownership token.
   */
  startSlot(
    roundId: string,
    slotId: string,
    options?: { ownerId?: string; delegationChain?: readonly string[] },
  ): { input: QueuedSlotInput; token: ExecutionOwnershipToken } {
    const item = this.queuedInputs.find(i => i.roundId === roundId && i.slotId === slotId && i.status === 'queued')
    if (item === undefined) {
      throw new Error(`No queued slot input found for round "${roundId}" slot "${slotId}"`)
    }
    const token = this.acquireOwnership({
      roundId,
      slotId,
      attemptId: item.attemptId,
      sessionId: item.targetSessionId,
      seatId: item.seatId,
      ownerId: options?.ownerId ?? `coordinator-${roundId}`,
      delegationChain: options?.delegationChain,
    })
    item.status = 'active'
    item.startedAt = Date.now()
    return { input: item, token }
  }

  /**
   * Cancel a slot. If unstarted in queue, removes only that slot input.
   * Active cancellation signals the owner; ownership is retained until quiescence.
   * @param roundId - group round identity.
   * @param slotId - slot identity.
   * @param reason - optional cancellation reason.
   * @returns result stating whether cancellation occurred and whether the slot was active.
   */
  cancelSlot(roundId: string, slotId: string, reason?: string): CancelSlotResult {
    const index = this.queuedInputs.findIndex(i => i.roundId === roundId && i.slotId === slotId && (i.status === 'queued' || i.status === 'active'))
    if (index === -1) {
      return { cancelled: false, wasActive: false }
    }
    const item = this.queuedInputs[index]
    if (item === undefined) {
      return { cancelled: false, wasActive: false }
    }
    if (item.status === 'queued') {
      // Unstarted: remove only that slot's unstarted input from the queue
      this.queuedInputs.splice(index, 1)
      item.status = 'cancelled'
      item.cancelledAt = Date.now()
      return { cancelled: true, wasActive: false, item }
    }

    // Keep ownership until the executing caller observes quiescence and completes the slot.
    item.status = 'cancelled'
    item.cancelledAt = Date.now()
    item.abortController.abort(reason ?? `Slot "${slotId}" of round "${roundId}" cancelled`)
    const token = this.activeTokens.get(item.targetSessionId)
    if (token?.roundId === roundId && token.slotId === slotId) token.abortController.abort(reason)
    return { cancelled: true, wasActive: true, item }
  }

  /**
   * Mark a slot execution as completed or failed, releasing its ownership.
   * @param roundId - group round identity.
   * @param slotId - slot identity.
   * @param error - optional failure error string.
   */
  completeSlot(roundId: string, slotId: string, error?: string): void {
    const item = this.queuedInputs.find(i => i.roundId === roundId && i.slotId === slotId && (i.status === 'active' || i.status === 'cancelled'))
    if (item !== undefined) {
      if (item.status !== 'cancelled') item.status = error !== undefined ? 'failed' : 'completed'
      item.completedAt = Date.now()
      item.error = error
      const token = this.activeTokens.get(item.targetSessionId)
      if (token?.roundId === roundId && token.slotId === slotId) this.releaseOwnership(token)
    }
  }

  /**
   * Retrieve a slot queue entry.
   * @param roundId - group round identity.
   * @param slotId - slot identity.
   * @returns queued input or undefined.
   */
  getSlot(roundId: string, slotId: string): QueuedSlotInput | undefined {
    return this.queuedInputs.find(i => i.roundId === roundId && i.slotId === slotId)
  }

  /**
   * List all queued slot inputs, optionally filtered by round.
   * @param roundId - optional round filter.
   * @returns list of queued slot inputs.
   */
  listQueue(roundId?: string): readonly QueuedSlotInput[] {
    if (roundId === undefined) return [...this.queuedInputs]
    return this.queuedInputs.filter(i => i.roundId === roundId)
  }

  /**
   * Validate submission to a session, detecting foreign ownership and recording conflict if violated.
   * @param sessionId - target session identity.
   * @param callerInfo - candidate caller identity and token.
   * @returns validation result with error details if forbidden.
   */
  validateSubmission(
    sessionId: SessionId,
    callerInfo?: { token?: string | undefined; callerId?: string | undefined; path?: string | undefined },
  ): { allowed: boolean; conflict?: ForeignOwnershipConflict } {
    const active = this.activeTokens.get(sessionId)
    if (active === undefined) {
      return { allowed: true }
    }
    const callerToken = callerInfo?.token
    const callerId = callerInfo?.callerId ?? 'unknown'
    const isAllowed = callerToken === active.token
      || active.delegationChain.includes(callerId)
      || active.ownerId === callerId

    if (isAllowed) {
      return { allowed: true }
    }

    const conflict: ForeignOwnershipConflict = {
      sessionId,
      conflictType: 'foreign_ownership_detected',
      activeToken: active,
      attemptedBy: callerInfo?.path ?? callerId,
      details: `Submission attempted by "${callerId}" while session "${sessionId}" is exclusively owned by round "${active.roundId}" slot "${active.slotId}"`,
      detectedAt: Date.now(),
    }
    this.recordConflict(conflict)
    return { allowed: false, conflict }
  }

  /** Recognize the current slot receipt and its exact child settlement notification. */
  private matchesOwnedSource(active: ExecutionOwnershipToken, source: MessageSource): boolean {
    if (source.kind === 'team-message') return source.roundId === active.roundId
      && source.slotId === active.slotId && source.attemptId === active.attemptId
    if (source.kind !== 'subagent-settled') return false
    const input = this.queuedInputs.find(item => item.roundId === active.roundId
      && item.slotId === active.slotId && item.attemptId === active.attemptId && item.status === 'active')
    return input !== undefined && active.sessionId !== input.targetSessionId
      && source.senderSessionId === input.targetSessionId
  }

  /** Monitor session events to detect foreign inputs (such as sessionController.prompt) during active slots. */
  private installSessionEventMonitor(): void {
    this.ctx.on('agent/inbox/inserted', ({ agent, message }) => {
      const active = this.activeTokens.get(agent.id)
      if (!active) return
      const source = message.source
      if (this.matchesOwnedSource(active, source)) return
      const conflict: ForeignOwnershipConflict = {
        sessionId: agent.id, conflictType: 'foreign_prompt_during_slot', activeToken: active,
        attemptedBy: 'sessionController.prompt',
        details: `Foreign inbox receipt '${message.id}' interrupted owned round '${active.roundId}' slot '${active.slotId}'`,
        detectedAt: Date.now(),
      }
      this.recordConflict(conflict)
      // Refuse only the foreign receipt. Sibling inputs held in the fork queue are unaffected.
      agent.inbox.remove(message.id)
      active.abortController.abort(new OwnershipConflictError(conflict))
      agent.cancel({ kind: 'user' }, { keepInbox: true })
    })
    this.ctx.on('session/event', (session: Session, event: { type: string; data?: unknown; payload?: unknown }) => {
      if (event.type !== 'user/message') return
      const active = this.activeTokens.get(session.id)
      if (active === undefined) return

      const payload = (event.data ?? event.payload) as { source?: MessageSource } | undefined
      const matchesSlot = payload?.source !== undefined && this.matchesOwnedSource(active, payload.source)

      if (!matchesSlot) {
        const conflict: ForeignOwnershipConflict = {
          sessionId: session.id,
          conflictType: 'foreign_prompt_during_slot',
          activeToken: active,
          attemptedBy: 'sessionController.prompt',
          details: `Foreign user/message event received on session "${session.id}" during active slot interval of round "${active.roundId}" slot "${active.slotId}"`,
          detectedAt: Date.now(),
        }
        this.recordConflict(conflict)
        active.abortController.abort(new OwnershipConflictError(conflict))
        this.ctx.get('agents')?.get(session.id)?.cancel({ kind: 'user' }, { keepInbox: true })
      }
    })
  }

  /** Wrap ctx.subagents.sendMessage to detect and reject foreign ownership attempts. */
  private installSubagentInterception(): void {
    if (this.subagentWrapperInstalled) return
    const subagents = this.ctx.get('subagents') as {
      sendMessage?: (
        sender: Agent,
        targetId: SessionId,
        content: ContentBlock[],
        options: SubagentSendMessageOptions & { ownershipToken?: string },
      ) => Promise<MessageId>
    } | undefined

    if (subagents !== undefined && typeof subagents.sendMessage === 'function') {
      const original = subagents.sendMessage.bind(subagents)
      subagents.sendMessage = async (
        sender: Agent,
        targetId: SessionId,
        content: ContentBlock[],
        options: SubagentSendMessageOptions & { ownershipToken?: string },
      ): Promise<MessageId> => {
        const check = this.validateSubmission(targetId, {
          token: options.ownershipToken,
          callerId: sender.id,
          path: 'ctx.subagents.sendMessage',
        })
        if (!check.allowed && check.conflict !== undefined) {
          throw new OwnershipConflictError(check.conflict)
        }
        return await original(sender, targetId, content, options)
      }
      this.subagentWrapperInstalled = true
    }
  }
}
