/**
 * Group round scheduler, durable round journal, per-seat committed cursors,
 * and paginated authorized public transcript projection.
 * @module @deepseek-ai/dsh-experimental-assistant-registry/rounds
 */

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { queueHostSubagentPrompt } from '@deepseek-ai/dsh-subagent/internal'
import { readPersistedSession } from './persisted.ts'
import type { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { TeamId, TeamMessageId } from '@deepseek-ai/dsh-experimental-agent-team'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage, lastAssistantStreamChunk } from '@deepseek-ai/dsh-llm'
import {
  GroupDiscussionId,
  GroupMessageId,
  GroupRoundId,
  RoundSlotId,
  TeamDefinitionId,
  TeamSeatId,
  type GroupDiscussion,
  type CreateGroupDiscussionOptions,
  type GroupRoundJournalEntry,
  type GroupTranscriptMessage,
  type QueryPublicTranscriptOptions,
  type QueryPublicTranscriptResult,
  type ResolvedRoundBounds,
  type RoundSlotJournalEntry,
  type ScheduleRoundOptions,
  type SlotExecutionResult,
  type TeamDefinition,
  type TeamSeat,
} from './types.ts'
import { RoundBoundsExceededError } from './errors.ts'
import { ScopeAccessError } from './scope-enforcement.ts'
import type { DispatchOwnershipManager } from './dispatch-ownership.ts'
import type { AssistantCatalog } from './catalog.ts'
import { atomicStageCWrite, parseRoundJournal, StageCStorageCommitError, StageCStorageQueue } from './stage-c-storage.ts'

/** Default bounds for group round execution. */
export const DEFAULT_ROUND_BOUNDS: ResolvedRoundBounds = {
  maxSeatsPerRound: 5,
  maxHandoffsPerRound: 3,
  maxTokensPerRound: 16384,
  slotTimeoutMs: 30000,
}

/** Options for posting a public reply to the group transcript. */
export interface PostPublicReplyOptions {
  readonly text: string
  readonly authorSeatId: TeamSeatId
  readonly authorName: string
  readonly authorRole?: string | undefined
  readonly sourceSessionId: SessionId
  readonly sourceEventSeq: number
  readonly executionUncertain?: boolean | undefined
}

/** Options for executing a group round. */
export interface ExecuteRoundOptions {
  readonly signal?: AbortSignal | undefined
  readonly executor?: (
    slot: RoundSlotJournalEntry,
    visibleTranscript: readonly GroupTranscriptMessage[],
    signal: AbortSignal,
  ) => Promise<SlotExecutionResult>
}

/** Configuration options for DurableRoundJournal. */
export interface DurableRoundJournalOptions {
  /** Optional file path for persisting journal state across process restarts. */
  readonly storagePath?: string | undefined
}

/**
 * Durable journal storing discussion metadata, round execution states, and public transcripts.
 */
export class DurableRoundJournal {
  private readonly discussions = new Map<GroupDiscussionId, GroupDiscussion>()
  private readonly rounds = new Map<GroupRoundId, GroupRoundJournalEntry>()
  private readonly transcripts = new Map<GroupDiscussionId, GroupTranscriptMessage[]>()
  private readonly postedMessageKeys = new Map<string, GroupMessageId>()
  private isCorrupt = false
  private readonly storageQueue = new StageCStorageQueue()

  constructor(private readonly options: DurableRoundJournalOptions = {}) {}

  /**
   * Check whether the journal encountered unreadable or corrupted storage.
   * @returns true if corrupted state was encountered on load.
   */
  get corrupted(): boolean {
    return this.isCorrupt
  }

  /**
   * Load persisted journal state from storage file if configured and available.
   * @returns void promise.
   */
  async load(): Promise<void> {
    return this.storageQueue.run(() => this.loadStored())
  }

  private async loadStored(): Promise<void> {
    if (!this.options.storagePath) return
    try {
      const raw = await readFile(this.options.storagePath, 'utf8')
      const parsed = parseRoundJournal(JSON.parse(raw))
      this.discussions.clear()
      this.rounds.clear()
      this.transcripts.clear()
      this.postedMessageKeys.clear()
      if (Array.isArray(parsed.discussions)) {
        for (const disc of parsed.discussions) {
          this.discussions.set(disc.id, disc)
        }
      }
      if (Array.isArray(parsed.rounds)) {
        for (const r of parsed.rounds) {
          this.rounds.set(r.id, r)
        }
      }
      if (Array.isArray(parsed.transcripts)) {
        for (const [discId, msgs] of parsed.transcripts) {
          const list = msgs.slice()
          this.transcripts.set(GroupDiscussionId(discId), list)
          for (const m of list) {
            this.postedMessageKeys.set(`${m.roundId}:${m.slotId}`, m.id)
          }
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      this.isCorrupt = true
      throw err
    }
  }

  /**
   * Persist current journal state to storage file if configured.
   * Uses atomic temp file and rename. Refuses to overwrite corrupted journal.
   * @returns void promise.
   */
  async flush(): Promise<void> {
    return this.storageQueue.run(() => this.flushStored())
  }

  private async flushStored(): Promise<void> {
    if (!this.options.storagePath) return
    if (this.isCorrupt) {
      throw new Error('Refusing to flush over corrupted round journal')
    }
    try {
      await atomicStageCWrite(this.options.storagePath, {
        discussions: Array.from(this.discussions.values()),
        rounds: Array.from(this.rounds.values()),
        transcripts: Array.from(this.transcripts.entries()),
      })
    } catch (error) {
      if (error instanceof StageCStorageCommitError) this.isCorrupt = true
      throw error
    }
  }

  /**
   * Update the storage path for persistence after initialization.
   * @param storagePath - new storage file path.
   */
  setStoragePath(storagePath: string | undefined): void {
    ;(this.options as { storagePath?: string | undefined }).storagePath = storagePath
  }

  /**
   * Save or update a discussion record.
   * @param discussion - discussion entity.
   * @returns void promise.
   */
  async saveDiscussion(discussion: GroupDiscussion): Promise<void> {
    return this.storageQueue.run(() => this.saveDiscussionStored(discussion))
  }

  private async saveDiscussionStored(discussion: GroupDiscussion): Promise<void> {
    const prev = this.discussions.get(discussion.id)
    this.discussions.set(discussion.id, discussion)
    try {
      await this.flushStored()
    } catch (err) {
      if (prev !== undefined) {
        this.discussions.set(discussion.id, prev)
      } else {
        this.discussions.delete(discussion.id)
      }
      throw err
    }
  }

  /**
   * Retrieve a discussion record by id.
   * @param id - discussion identifier.
   * @returns discussion entity if found.
   */
  getDiscussion(id: GroupDiscussionId): GroupDiscussion | undefined {
    return this.discussions.get(id)
  }

  /**
   * List all discussions belonging to a team.
   * @param teamId - team definition identifier.
   * @returns array of matching discussions.
   */
  listDiscussions(teamId: TeamDefinitionId): readonly GroupDiscussion[] {
    const res: GroupDiscussion[] = []
    for (const d of this.discussions.values()) {
      if (d.teamId === teamId) res.push(d)
    }
    return res
  }

  /**
   * Save or update a group round journal entry.
   * @param round - round journal record.
   * @returns void promise.
   */
  async saveRound(round: GroupRoundJournalEntry): Promise<void> {
    return this.storageQueue.run(() => this.saveRoundStored(round))
  }

  private async saveRoundStored(round: GroupRoundJournalEntry): Promise<void> {
    const prev = this.rounds.get(round.id)
    if (prev?.status === 'cancelled' && round.status !== 'cancelled') return
    this.rounds.set(round.id, round)
    try {
      await this.flushStored()
    } catch (err) {
      if (prev !== undefined) {
        this.rounds.set(round.id, prev)
      } else {
        this.rounds.delete(round.id)
      }
      throw err
    }
  }

  /**
   * Retrieve a round journal record by id.
   * @param id - round identifier.
   * @returns round record if found.
   */
  getRound(id: GroupRoundId): GroupRoundJournalEntry | undefined {
    return this.rounds.get(id)
  }

  /**
   * List all rounds belonging to a discussion.
   * @param discussionId - discussion identifier.
   * @returns array of round records in order of creation.
   */
  listRounds(discussionId: GroupDiscussionId): readonly GroupRoundJournalEntry[] {
    const res: GroupRoundJournalEntry[] = []
    for (const r of this.rounds.values()) {
      if (r.discussionId === discussionId) res.push(r)
    }
    res.sort((a, b) => a.createdAt - b.createdAt)
    return res
  }

  /**
   * Retrieve the active round for a discussion if one exists.
   * @param discussionId - discussion identifier.
   * @returns active round record or undefined.
   */
  getActiveRound(discussionId: GroupDiscussionId): GroupRoundJournalEntry | undefined {
    for (const r of this.rounds.values()) {
      if (r.discussionId === discussionId && (r.status === 'active' || r.status === 'pending')) {
        return r
      }
    }
    return undefined
  }

  /**
   * Append a public message to a discussion transcript with deduplication.
   * @param message - public transcript message.
   * @returns the committed message (existing or newly appended).
   */
  async appendTranscriptMessage(message: GroupTranscriptMessage): Promise<GroupTranscriptMessage> {
    return this.storageQueue.run(() => this.appendTranscriptMessageStored(message))
  }

  private async appendTranscriptMessageStored(message: GroupTranscriptMessage): Promise<GroupTranscriptMessage> {
    const key = `${message.roundId}:${message.slotId}`
    const existingId = this.postedMessageKeys.get(key)
    const list = this.transcripts.get(message.discussionId) ?? []

    if (existingId !== undefined) {
      const found = list.find(m => m.id === existingId)
      if (found) return found
    }

    list.push(message)
    this.transcripts.set(message.discussionId, list)
    this.postedMessageKeys.set(key, message.id)
    try {
      await this.flushStored()
    } catch (err) {
      list.pop()
      if (list.length === 0) {
        this.transcripts.delete(message.discussionId)
      }
      this.postedMessageKeys.delete(key)
      throw err
    }
    return message
  }

  /**
   * Get the complete transcript list for a discussion.
   * @param discussionId - discussion identifier.
   * @returns array of committed public transcript messages.
   */
  getTranscript(discussionId: GroupDiscussionId): readonly GroupTranscriptMessage[] {
    return this.transcripts.get(discussionId) ?? []
  }

  /**
   * Check if a message was already posted for a given round and slot.
   * @param roundId - round identifier.
   * @param slotId - slot identifier.
   * @returns existing message id or undefined.
   */
  getPostedMessageId(roundId: GroupRoundId, slotId: RoundSlotId): GroupMessageId | undefined {
    return this.postedMessageKeys.get(`${roundId}:${slotId}`)
  }
}

/** Dependencies and options for GroupRoundScheduler. */
export interface GroupRoundSchedulerOptions {
  readonly catalog?: AssistantCatalog | undefined
  readonly seatResolver?: ((teamId: TeamDefinitionId) => Promise<readonly TeamSeat[]>) | undefined
  readonly teamResolver?: ((teamId: TeamDefinitionId) => Promise<TeamDefinition | undefined>) | undefined
  readonly storagePath?: string | undefined
}

/**
 * Round scheduler responsible for coordinator-first scheduling, explicit recipient routing,
 * bound enforcement, per-seat committed cursors, durable journaling, and paginated projection.
 */
export class GroupRoundScheduler {
  /** Durable round journal tracking discussions, rounds, and public transcripts. */
  public readonly journal: DurableRoundJournal
  private readonly admissionQueue = new StageCStorageQueue()
  private readonly activeRoundExecutions = new Map<GroupRoundId, Promise<GroupRoundJournalEntry>>()
  private readonly activeRoundAbortControllers = new Map<GroupRoundId, AbortController>()

  constructor(
    public readonly ctx: Context,
    public readonly ownership: DispatchOwnershipManager,
    private readonly options: GroupRoundSchedulerOptions = {},
  ) {
    this.journal = new DurableRoundJournal({
      ...(options.storagePath !== undefined ? { storagePath: options.storagePath } : {}),
    })
  }

  /**
   * Initialize journal storage if persistence path is configured.
   * @returns void promise.
   */
  async init(): Promise<void> {
    await this.journal.load()
  }

  /**
   * Create a new group discussion room.
   * @param options - discussion creation options.
   * @returns newly created discussion.
   */
  async createDiscussion(options: CreateGroupDiscussionOptions): Promise<GroupDiscussion> {
    const id = options.id ? GroupDiscussionId(options.id) : GroupDiscussionId(randomUUID())
    const now = Date.now()
    const discussion: GroupDiscussion = {
      id,
      teamId: options.teamId,
      ...(options.rootSessionId !== undefined ? { rootSessionId: options.rootSessionId } : {}),
      ...(options.title !== undefined ? { title: options.title } : {}),
      createdAt: now,
      updatedAt: now,
    }
    await this.journal.saveDiscussion(discussion)
    return discussion
  }

  /**
   * Get an existing discussion by id.
   * @param id - discussion identifier.
   * @returns discussion or undefined.
   */
  getDiscussion(id: GroupDiscussionId): GroupDiscussion | undefined {
    return this.journal.getDiscussion(id)
  }

  /**
   * List all discussions in a team.
   * @param teamId - team definition identifier.
   * @returns array of discussions.
   */
  listDiscussions(teamId: TeamDefinitionId): readonly GroupDiscussion[] {
    return this.journal.listDiscussions(teamId)
  }

  /**
   * Resolve team seats either through catalog or custom resolver.
   * @param teamId - team identifier.
   * @returns array of active team seats.
   */
  private async resolveSeats(teamId: TeamDefinitionId): Promise<readonly TeamSeat[]> {
    if (this.options.seatResolver) {
      return this.options.seatResolver(teamId)
    }
    if (this.options.catalog) {
      return this.options.catalog.listSeats(teamId)
    }
    return []
  }

  /**
   * Resolve team definition either through catalog or custom resolver.
   * @param teamId - team identifier.
   * @returns team definition or undefined.
   */
  private async resolveTeam(teamId: TeamDefinitionId): Promise<TeamDefinition | undefined> {
    if (this.options.teamResolver) {
      return this.options.teamResolver(teamId)
    }
    if (this.options.catalog) {
      return this.options.catalog.getTeam(teamId)
    }
    return undefined
  }

  /**
   * Schedule a new group round according to coordinator-first and explicit-recipient rules.
   * @param options - round scheduling options.
   * @returns newly scheduled group round journal entry.
   */
  async scheduleRound(options: ScheduleRoundOptions): Promise<GroupRoundJournalEntry> {
    return this.admissionQueue.run(() => this.scheduleRoundStored(options))
  }

  private async scheduleRoundStored(options: ScheduleRoundOptions): Promise<GroupRoundJournalEntry> {
    const bounds: ResolvedRoundBounds = {
      maxSeatsPerRound: options.bounds?.maxSeatsPerRound ?? DEFAULT_ROUND_BOUNDS.maxSeatsPerRound,
      maxHandoffsPerRound: options.bounds?.maxHandoffsPerRound ?? DEFAULT_ROUND_BOUNDS.maxHandoffsPerRound,
      maxTokensPerRound: options.bounds?.maxTokensPerRound ?? DEFAULT_ROUND_BOUNDS.maxTokensPerRound,
      slotTimeoutMs: options.bounds?.slotTimeoutMs ?? DEFAULT_ROUND_BOUNDS.slotTimeoutMs,
    }
    for (const [name, value] of Object.entries(bounds)) {
      if (!Number.isSafeInteger(value) || value < (name === 'maxHandoffsPerRound' ? 0 : 1)) {
        throw new RoundBoundsExceededError(`${name} must be a valid integer execution bound`)
      }
    }
    if (options.id) {
      const existing = this.journal.getRound(options.id)
      if (existing) {
        const recipients = options.recipients?.length ? options.recipients : undefined
        if (
          existing.prompt !== options.prompt ||
          existing.teamId !== options.teamId ||
          existing.discussionId !== options.discussionId ||
          JSON.stringify(existing.recipients) !== JSON.stringify(recipients) ||
          Object.entries(bounds).some(([key, value]) => existing.bounds[key as keyof ResolvedRoundBounds] !== value)
        ) {
          throw new Error(`Admission conflict: round '${options.id}' already exists with different inputs`)
        }
        return existing
      }
    }
    const discussion = this.journal.getDiscussion(options.discussionId)
    if (!discussion) throw new Error(`Group discussion '${options.discussionId}' not found`)
    if (discussion.teamId !== options.teamId) {
      throw new ScopeAccessError(`Discussion '${options.discussionId}' belongs to another team`)
    }

    const team = await this.resolveTeam(options.teamId)
    const allSeats = await this.resolveSeats(options.teamId)
    const activeSeats = allSeats.filter(s => s.retiredAt === undefined)

    let targetSeats: TeamSeat[] = []

    if (options.recipients && options.recipients.length > 0) {
      if (options.recipients.length > bounds.maxSeatsPerRound) {
        throw new RoundBoundsExceededError(
          `Recipient count (${options.recipients.length}) exceeds maximum seats per round (${bounds.maxSeatsPerRound})`,
        )
      }
      for (const recId of options.recipients) {
        const found = activeSeats.find(s => s.id === recId)
        if (!found) {
          throw new Error(`Recipient seat '${recId}' not found or retired in team '${options.teamId}'`)
        }
        targetSeats.push(found)
      }
    } else {
      // Coordinator-first rule:
      // Plain prompt without explicit recipient chips schedules coordinator seat first as slot 0.
      // In-prompt text references (e.g. "@researcher") do NOT dispatch seats accidentally.
      const coordinator =
        activeSeats.find(s => s.role === 'coordinator') ??
        (team ? activeSeats.find(s => s.profileId === team.coordinatorProfileId) : undefined) ??
        activeSeats[0]

      if (!coordinator) {
        throw new Error(`No available coordinator or active seats in team '${options.teamId}'`)
      }
      targetSeats = [coordinator]
    }

    const roundId = options.id ?? GroupRoundId(randomUUID())
    const now = Date.now()

    const slots: RoundSlotJournalEntry[] = targetSeats.map((seat, idx) => ({
      slotId: RoundSlotId(`slot-${idx}`),
      roundId,
      slotIndex: idx,
      seatId: seat.id,
      seatName: seat.name,
      seatRole: seat.role,
      sessionId: seat.activeInstanceId ?? seat.runtimeInstances[0] ?? SessionId(randomUUID()),
      attemptId: 'attempt-0',
      status: 'pending',
      committedCursor: 0,
      tokensUsed: 0,
    }))

    const round: GroupRoundJournalEntry = {
      id: roundId,
      discussionId: options.discussionId,
      teamId: options.teamId,
      status: 'pending',
      prompt: options.prompt,
      ...(options.recipients?.length ? { recipients: [...options.recipients] } : {}),
      slots,
      activeSlotIndex: 0,
      totalTokensUsed: 0,
      handoffCount: 0,
      bounds,
      createdAt: now,
    }

    await this.journal.saveRound(round)
    await this.journal.saveDiscussion({
      ...discussion,
      activeRoundId: roundId,
      updatedAt: now,
    })

    return round
  }

  /**
   * Execute a scheduled group round, stepping through slots with committed cursors and bounds.
   * Serializes concurrent calls per round so only one execution side effect runs.
   * @param roundId - identifier of the round to execute.
   * @param options - execution options including custom executor and cancellation signal.
   * @returns completed or terminated round journal entry.
   */
  async executeRound(roundId: GroupRoundId, options: ExecuteRoundOptions = {}): Promise<GroupRoundJournalEntry> {
    const inFlight = this.activeRoundExecutions.get(roundId)
    if (inFlight) {
      return inFlight
    }

    const executionPromise = (async () => {
      try {
        return await this.doExecuteRound(roundId, options)
      } finally {
        this.activeRoundExecutions.delete(roundId)
        this.activeRoundAbortControllers.get(roundId)?.abort('Round execution settled')
        this.activeRoundAbortControllers.delete(roundId)
      }
    })()

    this.activeRoundExecutions.set(roundId, executionPromise)
    return executionPromise
  }

  /**
   * Internal execution worker for a scheduled group round.
   * @param roundId - identifier of the round.
   * @param options - execution options.
   * @returns final round journal entry.
   */
  private async doExecuteRound(roundId: GroupRoundId, options: ExecuteRoundOptions): Promise<GroupRoundJournalEntry> {
    const initialRound = this.journal.getRound(roundId)
    if (!initialRound) {
      throw new Error(`Group round '${roundId}' not found`)
    }
    if (initialRound.status === 'cancelled' || initialRound.status === 'failed') {
      return initialRound
    }

    const roundAbort = new AbortController()
    if (options.signal) {
      if (options.signal.aborted) {
        roundAbort.abort(options.signal.reason)
      } else {
        options.signal.addEventListener('abort', () => roundAbort.abort(options.signal?.reason), { once: true, signal: roundAbort.signal })
      }
    }
    this.activeRoundAbortControllers.set(roundId, roundAbort)

    // A persisted active slot has no live execution owner after restart. Never replay its effects.
    const recoveredSlots = initialRound.slots.map(slot =>
      slot.status === 'active'
        ? {
          ...slot,
          status: 'uncertain' as const,
          executionUncertain: true,
          uncertainExplanation: 'Execution interrupted before durable settlement; confirmation required',
          completedAt: Date.now(),
        }
        : slot,
    )
    let reconciled = { ...initialRound, slots: recoveredSlots }
    for (const slot of recoveredSlots) {
      if (slot.status === 'completed' && slot.committedReply && !slot.resultMessageId) {
        const message = await this.publishCommittedReply(roundId, slot.slotId)
        reconciled = {
          ...reconciled,
          slots: reconciled.slots.map(s => (s.slotId === slot.slotId ? { ...s, resultMessageId: message.id } : s)),
        }
      }
    }
    if (initialRound.status === 'completed') {
      if (reconciled.slots.some(s => s.status === 'pending')) {
        throw new Error('Completed round contains unexecuted slots')
      }
      await this.journal.saveRound(reconciled)
      return reconciled
    }

    let round: GroupRoundJournalEntry = {
      ...reconciled,
      status: 'active',
      startedAt: Date.now(),
    }
    await this.journal.saveRound(round)

    const allSeats = await this.resolveSeats(round.teamId)
    const activeSeatsMap = new Map<TeamSeatId, TeamSeat>(allSeats.map(s => [s.id, s]))

    let currentSlotIdx = 0

    while (currentSlotIdx < round.slots.length) {
      if (roundAbort.signal.aborted || options.signal?.aborted) {
        round = await this.cancelRoundState(roundId, 'Execution aborted by signal')
        return round
      }

      // Check token bounds: if token budget reached, cancel remaining unstarted slots.
      if (round.totalTokensUsed >= round.bounds.maxTokensPerRound) {
        const updatedSlots = round.slots.map((s, idx) => {
          if (idx >= currentSlotIdx && s.status === 'pending') {
            return {
              ...s,
              status: 'cancelled' as const,
              error: `Round token limit reached (${round.bounds.maxTokensPerRound})`,
            }
          }
          return s
        })
        round = {
          ...round,
          slots: updatedSlots,
          status: 'completed',
          completedAt: Date.now(),
        }
        await this.journal.saveRound(round)
        return round
      }

      const slot = round.slots[currentSlotIdx]
      if (!slot) {
        currentSlotIdx++
        continue
      }
      if (slot.status !== 'pending') {
        currentSlotIdx++
        continue
      }

      // 1. Per-seat committed cursor:
      // Capture the exact visible public transcript up to this execution checkpoint.
      const currentTranscript = this.journal.getTranscript(round.discussionId)
      const committedCursor = currentTranscript.length
      const visibleTranscript = currentTranscript.slice(0, committedCursor)

      const activeSlot: RoundSlotJournalEntry = {
        ...slot,
        status: 'active',
        startedAt: Date.now(),
        committedCursor,
      }

      round = {
        ...round,
        activeSlotIndex: currentSlotIdx,
        slots: round.slots.map((s, i) => (i === currentSlotIdx ? activeSlot : s)),
      }
      await this.journal.saveRound(round)

      // Ownership remains held until the executor has stopped, including cancellation.
      this.ownership.enqueueSlotInput({
        roundId: round.id,
        slotId: activeSlot.slotId,
        attemptId: activeSlot.attemptId,
        targetSessionId: activeSlot.sessionId,
        seatId: activeSlot.seatId,
        payload: { prompt: round.prompt },
      })
      const slotAbort = new AbortController()
      const abortSlot = (): void => slotAbort.abort(roundAbort.signal.reason)
      roundAbort.signal.addEventListener('abort', abortSlot, { once: true })
      if (roundAbort.signal.aborted) abortSlot()
      let timedOut = false
      const timeout = setTimeout(() => {
        timedOut = true
        slotAbort.abort(new Error(`Slot timeout after ${round.bounds.slotTimeoutMs}ms`))
      }, round.bounds.slotTimeoutMs)
      let execResult: SlotExecutionResult
      let token: ReturnType<DispatchOwnershipManager['acquireOwnership']> | undefined
      try {
        slotAbort.signal.throwIfAborted()
        token = this.ownership.startSlot(round.id, activeSlot.slotId, {
          ownerId: `round:${round.id}:slot:${activeSlot.slotId}`,
        }).token
        token.abortController.signal.addEventListener(
          'abort',
          () => {
            slotAbort.abort(token?.abortController.signal.reason)
          },
          { once: true, signal: slotAbort.signal },
        )
        execResult = options.executor
          ? await options.executor(activeSlot, visibleTranscript, slotAbort.signal)
          : await this.executeSlotDefault(round, activeSlot, visibleTranscript, slotAbort.signal)
        if (slotAbort.signal.aborted) {
          execResult = {
            ...execResult,
            status: timedOut ? 'timed_out' : execResult.status === 'uncertain' ? 'uncertain' : 'cancelled',
            text: undefined,
            executionUncertain: timedOut || execResult.executionUncertain,
            error: String(slotAbort.signal.reason ?? 'Cancelled'),
          }
        }
      } catch (err) {
        execResult = {
          status: timedOut ? 'timed_out' : slotAbort.signal.aborted ? 'cancelled' : 'failed',
          error: err instanceof Error ? err.message : String(err),
          tokensUsed: 0,
          executionUncertain: timedOut,
        }
      } finally {
        clearTimeout(timeout)
        roundAbort.signal.removeEventListener('abort', abortSlot)
        this.ownership.completeSlot(round.id, activeSlot.slotId)
        if (token) this.ownership.releaseOwnership(token)
        else this.ownership.cancelSlot(round.id, activeSlot.slotId, 'Ownership admission failed')
      }

      // Check if the round was cancelled while the executor was running
      const latestRound = this.journal.getRound(round.id)
      if (latestRound && latestRound.status === 'cancelled') {
        const previousTokens = latestRound.slots.find(s => s.slotId === activeSlot.slotId)?.tokensUsed ?? 0
        const tokensUsed = execResult.tokensUsed ?? 0
        const settled = {
          ...latestRound,
          slots: latestRound.slots.map(s => (s.slotId === activeSlot.slotId ? { ...s, tokensUsed } : s)),
          totalTokensUsed: latestRound.totalTokensUsed - previousTokens + tokensUsed,
        }
        await this.journal.saveRound(settled)
        return settled
      }
      const latestSlot = latestRound?.slots.find(s => s.slotId === activeSlot.slotId)
      if (latestSlot && latestSlot.status === 'cancelled') {
        currentSlotIdx++
        continue
      }

      // 3. Process slot terminal state & public message commitment
      const now = Date.now()
      const tokensUsed = execResult.tokensUsed ?? 0
      const totalTokens = round.totalTokensUsed + tokensUsed

      // CHECKPOINT 1: Commit slot reply to durable round journal FIRST
      const intermediateSlot: RoundSlotJournalEntry = {
        ...activeSlot,
        status: execResult.status,
        completedAt: now,
        tokensUsed,
        ...(execResult.text !== undefined
          ? {
            committedReply: {
              text: execResult.text,
              sourceSessionId: execResult.sourceSessionId ?? activeSlot.sessionId,
              sourceEventSeq: execResult.sourceEventSeq ?? 1,
            },
          }
          : {}),
        ...(execResult.error !== undefined ? { error: execResult.error } : {}),
        ...(execResult.executionUncertain !== undefined ? { executionUncertain: execResult.executionUncertain } : {}),
        ...(execResult.uncertainExplanation !== undefined
          ? { uncertainExplanation: execResult.uncertainExplanation }
          : execResult.executionUncertain
            ? { uncertainExplanation: '执行结果待确认' }
            : {}),
      }

      round = {
        ...round,
        slots: round.slots.map((s, i) => (i === currentSlotIdx ? intermediateSlot : s)),
        totalTokensUsed: totalTokens,
      }
      await this.journal.saveRound(round)

      const afterCheckpoint = this.journal.getRound(round.id)
      if (afterCheckpoint?.status === 'cancelled') return afterCheckpoint

      // CHECKPOINT 2: Now publish public reply to transcript if completed
      let resultMessageId: GroupMessageId | undefined
      if (execResult.status === 'completed' && execResult.text) {
        const postedMsg = await this.postPublicReply(round.id, activeSlot.slotId, {
          text: execResult.text,
          authorSeatId: activeSlot.seatId,
          authorName: activeSlot.seatName,
          ...(activeSlot.seatRole !== undefined ? { authorRole: activeSlot.seatRole } : {}),
          sourceSessionId: execResult.sourceSessionId ?? activeSlot.sessionId,
          sourceEventSeq: execResult.sourceEventSeq ?? 1,
          ...(execResult.executionUncertain !== undefined ? { executionUncertain: execResult.executionUncertain } : {}),
        })
        resultMessageId = postedMsg.id
      }

      const terminalSlot: RoundSlotJournalEntry = {
        ...intermediateSlot,
        ...(resultMessageId !== undefined ? { resultMessageId } : {}),
      }

      let updatedSlots = round.slots.map((s, i) => (i === currentSlotIdx ? terminalSlot : s))
      let handoffCount = round.handoffCount

      // 4. Handle bounded handoff if requested
      if (execResult.handoffTo) {
        if (handoffCount >= round.bounds.maxHandoffsPerRound) {
          // Bound reached: ignore handoff, do not schedule
        } else if (updatedSlots.length >= round.bounds.maxSeatsPerRound) {
          // Bound reached: ignore handoff, do not schedule
        } else {
          const targetSeat = activeSeatsMap.get(execResult.handoffTo)
          if (targetSeat && targetSeat.retiredAt === undefined) {
            handoffCount++
            const nextIdx = updatedSlots.length
            const newSlot: RoundSlotJournalEntry = {
              slotId: RoundSlotId(`slot-${nextIdx}`),
              roundId: round.id,
              slotIndex: nextIdx,
              seatId: targetSeat.id,
              seatName: targetSeat.name,
              seatRole: targetSeat.role,
              sessionId: targetSeat.activeInstanceId ?? targetSeat.runtimeInstances[0] ?? SessionId(randomUUID()),
              attemptId: 'attempt-0',
              status: 'pending',
              committedCursor: 0,
              tokensUsed: 0,
            }
            updatedSlots = [...updatedSlots, newSlot]
          }
        }
      }

      round = {
        ...round,
        slots: updatedSlots,
        totalTokensUsed: totalTokens,
        handoffCount,
      }
      await this.journal.saveRound(round)

      currentSlotIdx++
    }

    const checkCancelled = this.journal.getRound(round.id)
    if (checkCancelled && checkCancelled.status === 'cancelled') {
      return checkCancelled
    }

    round = {
      ...round,
      status: 'completed',
      completedAt: Date.now(),
    }
    await this.journal.saveRound(round)

    const discussion = this.journal.getDiscussion(round.discussionId)
    if (discussion && discussion.activeRoundId === round.id) {
      await this.journal.saveDiscussion({
        ...discussion,
        activeRoundId: undefined,
        updatedAt: Date.now(),
      })
    }

    return round
  }

  /**
   * Post a public reply to the group transcript with keyed deduplication.
   * @param roundId - round identifier.
   * @param slotId - slot identifier.
   * @param reply - message payload with source attribution.
   * @returns public transcript message.
   */
  async postPublicReply(roundId: GroupRoundId, slotId: RoundSlotId, reply: PostPublicReplyOptions): Promise<GroupTranscriptMessage> {
    const round = this.journal.getRound(roundId)
    if (!round) {
      throw new Error(`Round '${roundId}' not found`)
    }

    if (round.status === 'cancelled') throw new Error('Cannot publish a cancelled round reply')

    const messageId = GroupMessageId(randomUUID())
    const msg: GroupTranscriptMessage = {
      id: messageId,
      discussionId: round.discussionId,
      roundId,
      slotId,
      authorSeatId: reply.authorSeatId,
      authorName: reply.authorName,
      ...(reply.authorRole !== undefined ? { authorRole: reply.authorRole } : {}),
      text: reply.text,
      sourceSessionId: reply.sourceSessionId,
      sourceEventSeq: reply.sourceEventSeq,
      createdAt: Date.now(),
      ...(reply.executionUncertain !== undefined ? { executionUncertain: reply.executionUncertain } : {}),
    }

    return this.journal.appendTranscriptMessage(msg)
  }

  /**
   * Publish a committed but not-yet-posted reply during crash recovery.
   * Deduplicates and guarantees external effects are never auto-repeated.
   * @param roundId - round identifier.
   * @param slotId - slot identifier.
   * @returns committed public message.
   */
  async publishCommittedReply(roundId: GroupRoundId, slotId: RoundSlotId): Promise<GroupTranscriptMessage> {
    const round = this.journal.getRound(roundId)
    if (!round) {
      throw new Error(`Round '${roundId}' not found`)
    }
    const slot = round.slots.find(s => s.slotId === slotId)
    if (!slot) {
      throw new Error(`Slot '${slotId}' not found in round '${roundId}'`)
    }
    if (!slot.committedReply) {
      throw new Error(`Slot '${slotId}' has no committed reply to publish`)
    }

    return this.postPublicReply(roundId, slotId, {
      text: slot.committedReply.text,
      authorSeatId: slot.seatId,
      authorName: slot.seatName,
      authorRole: slot.seatRole,
      sourceSessionId: slot.committedReply.sourceSessionId,
      sourceEventSeq: slot.committedReply.sourceEventSeq,
      ...(slot.executionUncertain !== undefined ? { executionUncertain: slot.executionUncertain } : {}),
    })
  }

  /**
   * Cancel an in-progress or pending group round.
   * Cancels active slot execution and pending slot inputs.
   * @param roundId - round identifier.
   * @param reason - cancellation reason.
   * @returns updated round journal entry.
   */
  async cancelRound(roundId: GroupRoundId, reason?: string): Promise<GroupRoundJournalEntry> {
    const ownedAgents =
      this.ctx
        .get('agents')
        ?.list()
        .filter(agent => this.ownership.getOwnership(agent.id)?.roundId === roundId && agent.status === 'running') ?? []
    const cancelled = await this.cancelRoundState(roundId, reason)
    await Promise.all(ownedAgents.map(agent => agent.whenIdle()))
    if (ownedAgents.length) await this.activeRoundExecutions.get(roundId)
    return this.journal.getRound(roundId) ?? cancelled
  }

  /** Record terminal cancellation and signal owned work without waiting on the scheduler itself. */
  private async cancelRoundState(roundId: GroupRoundId, reason?: string): Promise<GroupRoundJournalEntry> {
    const roundAbort = this.activeRoundAbortControllers.get(roundId)
    if (roundAbort) {
      roundAbort.abort(reason ?? 'Round cancelled')
    }

    const round = this.journal.getRound(roundId)
    if (!round) {
      throw new Error(`Round '${roundId}' not found`)
    }

    if (round.status === 'completed' || round.status === 'cancelled' || round.status === 'failed') return round

    const updatedSlots = round.slots.map((s) => {
      if (s.status === 'active') {
        this.ownership.cancelSlot(roundId, s.slotId, reason)
        return {
          ...s,
          status: 'cancelled' as const,
          completedAt: Date.now(),
          error: reason ?? 'Cancelled',
        }
      }
      if (s.status === 'pending') {
        this.ownership.cancelSlot(roundId, s.slotId, reason)
        return {
          ...s,
          status: 'cancelled' as const,
          completedAt: Date.now(),
          error: reason ?? 'Cancelled',
        }
      }
      return s
    })

    const updatedRound: GroupRoundJournalEntry = {
      ...round,
      status: 'cancelled',
      slots: updatedSlots,
      completedAt: Date.now(),
      ...(reason !== undefined ? { error: reason } : {}),
    }

    await this.journal.saveRound(updatedRound)

    const discussion = this.journal.getDiscussion(round.discussionId)
    if (discussion && discussion.activeRoundId === round.id) {
      await this.journal.saveDiscussion({
        ...discussion,
        activeRoundId: undefined,
        updatedAt: Date.now(),
      })
    }

    return updatedRound
  }

  /**
   * Query the public transcript with scope authorization, pagination, and per-message source attribution.
   * @param options - query options including discussionId, callerSeatId, teamId, limit, and cursor.
   * @returns paginated transcript result.
   */
  async queryPublicTranscript(options: QueryPublicTranscriptOptions): Promise<QueryPublicTranscriptResult> {
    const discussion = this.journal.getDiscussion(options.discussionId)
    if (!discussion) {
      throw new Error(`Group discussion '${options.discussionId}' not found`)
    }

    // Authorization verification:
    if (options.teamId !== undefined && options.teamId !== discussion.teamId) {
      throw new ScopeAccessError(
        `Discussion '${options.discussionId}' belongs to team '${discussion.teamId}', caller specified '${options.teamId}'`,
      )
    }

    if (options.callerSeatId !== undefined) {
      const seats = await this.resolveSeats(discussion.teamId)
      const seat = seats.find(s => s.id === options.callerSeatId)
      if (!seat) {
        throw new ScopeAccessError(`Caller seat '${options.callerSeatId}' is not an authorized member of team '${discussion.teamId}'`)
      }
    }

    const allMessages = this.journal.getTranscript(options.discussionId)
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100)

    let startIndex = 0
    if (options.cursor) {
      const cursorIdx = allMessages.findIndex(m => m.id === options.cursor)
      if (cursorIdx >= 0) {
        startIndex = cursorIdx + 1
      }
    }

    const items = allMessages.slice(startIndex, startIndex + limit)
    const hasMore = startIndex + limit < allMessages.length
    const lastItem = items.length > 0 ? items[items.length - 1] : undefined
    const nextCursor = hasMore && lastItem !== undefined ? lastItem.id : undefined

    return {
      items,
      ...(nextCursor !== undefined ? { nextCursor } : {}),
      hasMore,
    }
  }

  /** Sum observed provider usage for all settled attempts in the owned interval. */
  private observedTokens(events: ReturnType<import('@deepseek-ai/dsh-session').Session['snapshotEvents']>): number {
    let total = 0
    for (const event of events) {
      if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') continue
      const usage = lastAssistantStreamChunk(event.data.stream, 'usage')?.usage
      if (usage) total += usage.totalTokens ?? usage.inputTokens + usage.outputTokens
    }
    return total
  }

  /**
   * Own an initially idle Agent until its whole activity becomes idle again.
   * @param round - group round being executed.
   * @param activeSlot - slot record under execution.
   * @param visibleTranscript - public transcript up to committed cursor.
   * @param signal - optional cancellation signal.
   * @returns execution result with source attribution and tokens used.
   */
  private async executeSlotDefault(
    round: GroupRoundJournalEntry,
    activeSlot: RoundSlotJournalEntry,
    visibleTranscript: readonly GroupTranscriptMessage[],
    signal?: AbortSignal,
  ): Promise<SlotExecutionResult> {
    const registry = this.ctx.get('agents') as AgentRegistry | undefined
    const controller = this.ctx.get('sessionController')
    let liveAgent = registry?.get(activeSlot.sessionId)
    const persistence = this.ctx.get('sessionPersistence')
    if (!liveAgent && !persistence) throw new Error('Cold seat routing requires session persistence')
    const persisted = liveAgent || !persistence ? undefined : await readPersistedSession(persistence, activeSlot.sessionId, signal)
    const header = liveAgent?.session.header ?? persisted?.header
    const parentSessionId = header?.origin === 'subagent' ? header.parentSession : undefined
    const needsChildResume = !liveAgent && parentSessionId !== undefined
    let parentAgent = needsChildResume && parentSessionId ? registry?.get(parentSessionId) : undefined
    if (needsChildResume && parentSessionId && !parentAgent) {
      if (!controller) throw new Error('Cold child routing requires the SessionController')
      const parent = await controller.resolveAgent(parentSessionId)
      if ('error' in parent) throw parent.error
      parentAgent = parent.agent
    }
    if (!liveAgent && !parentSessionId) {
      if (!controller) throw new Error('Cold seat routing requires the SessionController')
      const resumed = await controller.resolveAgent(activeSlot.sessionId)
      if ('error' in resumed) throw resumed.error
      liveAgent = resumed.agent
    }
    signal?.throwIfAborted()
    if (liveAgent && (liveAgent.status !== 'idle' || liveAgent.inbox.nextTurn.length + liveAgent.inbox.nextStep.length > 0)) {
      throw new Error('Cannot start round slot on an agent with foreign active or pending work')
    }
    if (parentAgent && (parentAgent.status !== 'idle' || parentAgent.inbox.nextTurn.length + parentAgent.inbox.nextStep.length > 0)) {
      throw new Error('Cannot resume a child while its parent has foreign active or pending work')
    }
    const parentToken = parentAgent
      ? this.ownership.acquireOwnership({
        roundId: round.id,
        slotId: activeSlot.slotId,
        attemptId: activeSlot.attemptId,
        sessionId: parentAgent.id,
        seatId: activeSlot.seatId,
        ownerId: `round:${round.id}:slot:${activeSlot.slotId}:parent-notice`,
      })
      : undefined
    const parentPreSeq = parentAgent?.session.snapshotEvents().at(-1)?.seq ?? 0
    const childSettlement = parentAgent ? Promise.withResolvers<void>() : undefined
    const disposeSettlement = childSettlement
      ? this.ctx.effect(() => {
        const stop = this.ctx.on('subagent/end', (info) => {
          if (info.id === activeSlot.sessionId) childSettlement.resolve()
        })
        return () => {
          stop()
          childSettlement.resolve()
        }
      }, 'round: child settlement observer')
      : () => {}
    let acceptedChild = false
    const ownedToken = this.ownership.getOwnership(activeSlot.sessionId)
    const preEvents = liveAgent?.session.snapshotEvents() ?? persisted?.events ?? []
    const preSeq = preEvents.at(-1)?.seq ?? 0

    // Propagate shared public transcript so downstream speakers receive prior public replies
    let promptText = round.prompt
    if (visibleTranscript && visibleTranscript.length > 0) {
      const transcriptContext = visibleTranscript.map(m => `[${m.authorName || m.authorRole || 'Teammate'}]: ${m.text}`).join('\n')
      promptText = `[Shared Group Transcript]\n${transcriptContext}\n\n[Current Task]\n${round.prompt}`
    }

    const ownedMessage = createUserMessage({
      content: [{ type: 'text', text: promptText }],
      source: {
        kind: 'team-message',
        teamId: TeamId(this.journal.getDiscussion(round.discussionId)?.rootSessionId ?? parentSessionId ?? activeSlot.sessionId),
        messageId: TeamMessageId(`round:${round.id}:slot:${activeSlot.slotId}:attempt:${activeSlot.attemptId}`),
        senderId: this.journal.getDiscussion(round.discussionId)?.rootSessionId ?? parentSessionId ?? activeSlot.sessionId,
        senderName: 'Group coordinator',
        roundId: round.id,
        slotId: activeSlot.slotId,
        attemptId: activeSlot.attemptId,
      },
    })
    let receiptId = ownedMessage.id
    const cancelOwned = (): void => {
      liveAgent = registry?.get(activeSlot.sessionId) ?? liveAgent
      liveAgent?.inbox.remove(receiptId)
      const ownedPending = [...(liveAgent?.inbox.nextTurn ?? []), ...(liveAgent?.inbox.nextStep ?? [])].filter(
        message =>
          message.source.kind === 'team-message' &&
          message.source.roundId === round.id &&
          message.source.slotId === activeSlot.slotId &&
          message.source.attemptId === activeSlot.attemptId,
      )
      for (const message of ownedPending) liveAgent?.inbox.remove(message.id)
      liveAgent?.cancel({ kind: 'user' }, { keepInbox: true })
      if (parentAgent && parentToken && this.ownership.getOwnership(parentAgent.id)?.token === parentToken.token) {
        for (const message of [...parentAgent.inbox.nextTurn, ...parentAgent.inbox.nextStep]) {
          if (message.source.kind === 'subagent-settled' && message.source.senderSessionId === activeSlot.sessionId)
            parentAgent.inbox.remove(message.id)
        }
        parentAgent.cancel({ kind: 'user' }, { keepInbox: true })
      }
    }
    const disposeLimit = this.ctx.on('agent/request', async ({ agent }, next) => {
      const resolved = await next()
      if (agent.id !== activeSlot.sessionId && agent.id !== parentAgent?.id) return resolved
      const consumed =
        this.observedTokens(
          ((liveAgent ?? registry?.get(activeSlot.sessionId))?.session.snapshotEvents() ?? []).filter(e => e.seq > preSeq),
        ) + this.observedTokens((parentAgent?.session.snapshotEvents() ?? []).filter(e => e.seq > parentPreSeq))
      const remaining = round.bounds.maxTokensPerRound - round.totalTokensUsed - consumed
      if (remaining <= 0) throw new RoundBoundsExceededError('Round token budget exhausted')
      return { ...resolved, maxTokens: Math.min(resolved.maxTokens ?? remaining, remaining) }
    })
    const cancelFromParent = (): void => ownedToken?.abortController.abort(parentToken?.abortController.signal.reason)
    parentToken?.abortController.signal.addEventListener('abort', cancelFromParent, { once: true })
    signal?.addEventListener('abort', cancelOwned, { once: true })
    try {
      if (parentAgent) {
        const subagents = this.ctx.get('subagents')
        if (!subagents) throw new Error('Cold child routing requires the subagent continuation runtime')
        receiptId = await queueHostSubagentPrompt(
          subagents,
          parentAgent,
          activeSlot.sessionId,
          [...ownedMessage.content],
          ownedMessage.source,
          signal ?? new AbortController().signal,
        )
        acceptedChild = true
        liveAgent = registry?.get(activeSlot.sessionId)
      } else {
        liveAgent?.followup(ownedMessage)
      }
      if (!liveAgent) throw new Error(`Child seat '${activeSlot.sessionId}' failed to become resident`)
      if (signal?.aborted) cancelOwned()
      await liveAgent.whenIdle()
      await childSettlement?.promise
      await parentAgent?.whenIdle()
    } finally {
      if (signal?.aborted) {
        cancelOwned()
        await liveAgent?.whenIdle()
        if (acceptedChild) await childSettlement?.promise
        await parentAgent?.whenIdle()
      }
      disposeSettlement()
      parentToken?.abortController.signal.removeEventListener('abort', cancelFromParent)
      if (parentToken) this.ownership.releaseOwnership(parentToken)
      signal?.removeEventListener('abort', cancelOwned)
      disposeLimit()
    }

    const postEvents = liveAgent.session.snapshotEvents()
    const newEvents = postEvents.filter(e => e.seq > preSeq)
    const msgEvent = newEvents.findLast(e => e.type === 'assistant/message')

    let replyText = ''
    const replyTokens =
      this.observedTokens(newEvents) +
      this.observedTokens((parentAgent?.session.snapshotEvents() ?? []).filter(e => e.seq > parentPreSeq))

    if (msgEvent) {
      const msgData = msgEvent.data
      if (msgData.message?.content && Array.isArray(msgData.message.content)) {
        replyText = msgData.message.content
          .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
          .map(c => c.text)
          .join('')
      }
    }

    // Failed and cancelled attempts contribute usage without publishing a success reply.
    if (
      (ownedToken &&
        this.ownership.getConflicts(activeSlot.sessionId).some(conflict => conflict.activeToken.token === ownedToken.token)) ||
      (parentToken &&
        parentAgent &&
        this.ownership.getConflicts(parentAgent.id).some(conflict => conflict.activeToken.token === parentToken.token))
    ) {
      return {
        status: 'uncertain',
        executionUncertain: true,
        error: 'Foreign input interrupted the owned execution interval; confirmation required',
        tokensUsed: replyTokens,
      }
    }
    if (signal?.aborted) return { status: 'cancelled', tokensUsed: replyTokens }
    if (!msgEvent || !replyText) {
      return {
        status: 'failed',
        error: 'No response message produced by agent',
        tokensUsed: replyTokens,
      }
    }

    return {
      status: 'completed',
      text: replyText,
      tokensUsed: replyTokens,
      sourceSessionId: activeSlot.sessionId,
      sourceEventSeq: msgEvent.seq,
    }
  }
}
