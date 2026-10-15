/**
 * Durable read cursors for cross-window unread state, scoped session-query adapter
 * with stable attribution, and usage aggregation with auxiliary fold and fork boundary exclusion.
 * @module @deepseek-ai/dsh-experimental-assistant-registry/cursors-usage
 */

import { readFile } from 'node:fs/promises'
import {
  atomicStageCWrite,
  isMissingFile,
  parseAuxiliaryUsage,
  parseReadCursors,
  StageCStorageCommitError,
  StageCStorageQueue,
} from './stage-c-storage.ts'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import {
  AssistantConversationId,
  AssistantProfileId,
  TeamDefinitionId,
  type AggregateUsageRequest,
  type AuxiliaryUsageRecord,
  type BindingUsageSummary,
  type ReadCursorRecord,
  type ScopedSearchResultAttribution,
  type ScopedSessionEventHit,
  type TokenUsageMetrics,
} from './types.ts'
import { ScopeAccessError } from './scope-enforcement.ts'
import type { AssistantCatalog } from './catalog.ts'

/** Configuration options for DurableReadCursorManager. */
export interface DurableReadCursorOptions {
  /** Optional file path for persisting read cursors to disk across restarts. */
  readonly storagePath?: string | undefined
}

/**
 * Manages durable read cursors per logical conversation or discussion for cross-window unread state.
 */
export class DurableReadCursorManager {
  private readonly cursors = new Map<string, ReadCursorRecord>()
  private readonly storageQueue = new StageCStorageQueue()
  private storagePath: string | undefined
  private corrupt = false

  constructor(options: DurableReadCursorOptions = {}) {
    this.storagePath = options.storagePath
  }

  /**
   * Configure the profile-owned cursor file before loading durable state.
   * @param storagePath - profile-owned durable cursor file.
   */
  setStoragePath(storagePath: string | undefined): void {
    this.storagePath = storagePath
  }

  /**
   * Load cursor records atomically after validating the complete file.
   * @returns completion after all cursor records have been validated and loaded.
   */
  load(): Promise<void> {
    return this.storageQueue.run(async () => {
      if (!this.storagePath) return
      try {
        const records = parseReadCursors(JSON.parse(await readFile(this.storagePath, 'utf8')))
        this.cursors.clear()
        for (const record of records) this.cursors.set(record.conversationId, record)
        this.corrupt = false
      } catch (error) {
        if (isMissingFile(error)) return
        this.corrupt = true
        throw error
      }
    })
  }

  /**
   * Persist committed cursors without overwriting rejected storage.
   * @returns completion after committed cursor state reaches durable storage.
   */
  flush(): Promise<void> {
    return this.storageQueue.run(() => this.persist(Array.from(this.cursors.values())))
  }

  private async persist(records: ReadCursorRecord[]): Promise<void> {
    if (this.corrupt) throw new Error('Refusing to overwrite corrupt read cursor storage')
    if (this.storagePath) {
      try {
        await atomicStageCWrite(this.storagePath, records)
      } catch (error) {
        if (error instanceof StageCStorageCommitError) this.corrupt = true
        throw error
      }
    }
  }

  /**
   * Advance a cursor only after the complete replacement succeeds; concurrent updates serialize.
   * @param conversationId - logical conversation or discussion identifier.
   * @param lastReadSeq - highest event or message sequence read.
   * @param windowId - optional window making the update.
   * @returns the durably committed cursor.
   */
  setReadCursor(conversationId: string, lastReadSeq: number, windowId?: string): Promise<ReadCursorRecord> {
    return this.storageQueue.run(async () => {
      const record = parseReadCursors([
        {
          conversationId,
          lastReadSeq: Math.max(this.cursors.get(conversationId)?.lastReadSeq ?? -1, lastReadSeq),
          readAt: Date.now(),
          ...(windowId !== undefined ? { windowId } : {}),
        },
      ])[0]
      if (record === undefined) throw new Error('Read cursor validation returned no record')
      const next = new Map(this.cursors)
      next.set(conversationId, record)
      await this.persist(Array.from(next.values()))
      this.cursors.set(conversationId, record)
      return record
    })
  }

  /**
   * Retrieve the durable read cursor for a conversation or discussion.
   * @param conversationId - logical conversation identifier.
   * @returns read cursor record if found.
   */
  getReadCursor(conversationId: string): ReadCursorRecord | undefined {
    return this.cursors.get(conversationId)
  }

  /**
   * Calculate the number of unread events given the current latest sequence number.
   * @param conversationId - logical conversation identifier.
   * @param latestSeq - current latest event sequence number.
   * @returns count of unread events (>= 0).
   */
  getUnreadCount(conversationId: string, latestSeq: number): number {
    const cursor = this.cursors.get(conversationId)
    const lastRead = cursor?.lastReadSeq ?? -1
    return Math.max(0, latestSeq - lastRead)
  }
}

/** Authorization parameters for scoped session querying and event search. */
export interface ScopedQueryAuthorization {
  readonly profileId?: AssistantProfileId | undefined
  readonly teamId?: TeamDefinitionId | undefined
  readonly conversationId?: AssistantConversationId | undefined
  readonly allowedSessionIds?: readonly SessionId[] | undefined
}

/**
 * Session-query adapter that enforces strict scope boundaries on session observations
 * and searches, attaching stable author and conversation attribution to all results.
 */
export class ScopedSessionQueryAdapter {
  constructor(
    private readonly ctx: Context,
    private readonly catalogResolver: () => Promise<AssistantCatalog | undefined>,
  ) {}

  /**
   * Resolve all permitted session IDs under the specified scope.
   * @param auth - scope authorization parameters.
   * @returns set of permitted session identifiers.
   */
  async resolvePermittedSessions(auth: ScopedQueryAuthorization): Promise<Set<SessionId>> {
    const permitted = new Set<SessionId>()

    if (auth.allowedSessionIds) {
      for (const id of auth.allowedSessionIds) permitted.add(id)
    }

    const catalog = await this.catalogResolver()
    if (!catalog) return permitted

    if (auth.conversationId) {
      const conv = catalog.getConversation(auth.conversationId)
      if (conv) permitted.add(conv.rootSessionId)
    }

    if (auth.profileId) {
      const allConvs = catalog.listConversations()
      for (const conv of allConvs) {
        if (conv.profileId === auth.profileId && conv.archivedAt === undefined) {
          permitted.add(conv.rootSessionId)
        }
      }
    }

    if (auth.teamId) {
      const team = catalog.getTeam(auth.teamId)
      if (team && team.leadSessionId) {
        permitted.add(team.leadSessionId)
      }
      const seats = catalog.listSeats(auth.teamId)
      for (const seat of seats) {
        if (seat.retiredAt === undefined) {
          if (seat.activeInstanceId) permitted.add(seat.activeInstanceId)
          for (const instId of seat.runtimeInstances) {
            permitted.add(instId)
          }
        }
      }
    }

    return permitted
  }

  /**
   * Assert that a session ID is within the authorized scope.
   * @param sessionId - target session identifier.
   * @param auth - scope authorization parameters.
   * @throws ScopeAccessError if the session is not permitted.
   */
  async assertSessionPermitted(sessionId: SessionId, auth: ScopedQueryAuthorization): Promise<void> {
    const permitted = await this.resolvePermittedSessions(auth)
    if (!permitted.has(sessionId)) {
      throw new ScopeAccessError(`Session '${sessionId}' is not permitted under the requested scope`)
    }
  }

  /**
   * Observe a session within authorized scope boundaries.
   * @param sessionId - target session identifier.
   * @param auth - scope authorization parameters.
   * @returns session observation handle.
   * @throws ScopeAccessError if session is not permitted.
   */
  async observeSession(sessionId: SessionId, auth: ScopedQueryAuthorization): Promise<unknown> {
    await this.assertSessionPermitted(sessionId, auth)
    const sessionQuery = this.ctx.get('sessionQuery') as SessionQueryEngine | undefined
    if (!sessionQuery) {
      throw new Error('sessionQuery service not available on Context')
    }
    return sessionQuery.observeSession(sessionId)
  }

  /**
   * Search events across permitted sessions with stable author attribution.
   * @param request - search text and limit.
   * @param auth - scope authorization parameters.
   * @returns array of matched event hits with stable attribution.
   */
  async searchEvents(
    request: { query: string; limit?: number },
    auth: ScopedQueryAuthorization,
  ): Promise<readonly ScopedSessionEventHit[]> {
    const permitted = await this.resolvePermittedSessions(auth)
    if (permitted.size === 0) return []

    const persistence = this.ctx.get('sessionPersistence') as SessionPersistence | undefined
    if (!persistence) return []

    const catalog = await this.catalogResolver()
    const queryLower = request.query.toLowerCase()
    const limit = request.limit ?? 50
    const hits: ScopedSessionEventHit[] = []

    for (const sessionId of permitted) {
      if (hits.length >= limit) break
      let events: readonly SessionEvent[] = []
      try {
        const handle = await persistence.open(sessionId, 'read')
        try {
          const res = await handle.read()
          events = res.events
        } finally {
          await handle.close()
        }
      } catch {
        continue
      }

      // Determine attribution for this session
      let attribution: ScopedSearchResultAttribution = {
        sessionId,
        eventSeq: 0,
        authorName: 'Assistant',
      }

      if (catalog) {
        // Check conversations
        for (const c of catalog.listConversations()) {
          if (c.rootSessionId === sessionId) {
            const prof = catalog.getProfile(c.profileId)
            attribution = {
              conversationId: c.id,
              profileId: c.profileId,
              authorName: prof?.name ?? 'Assistant',
              sessionId,
              eventSeq: 0,
            }
            break
          }
        }
        // Check seats
        if (attribution.profileId === undefined) {
          for (const t of catalog.listTeams()) {
            for (const s of catalog.listSeats(t.id)) {
              if (s.activeInstanceId === sessionId || s.runtimeInstances.includes(sessionId)) {
                attribution = {
                  teamId: s.teamId,
                  seatId: s.id,
                  profileId: s.profileId,
                  authorName: s.name,
                  authorRole: s.role,
                  sessionId,
                  eventSeq: 0,
                }
                break
              }
            }
            if (attribution.seatId !== undefined) break
          }
        }
      }

      for (const ev of events) {
        if (hits.length >= limit) break
        const eventText = extractTextFromEvent(ev)
        if (eventText && eventText.toLowerCase().includes(queryLower)) {
          hits.push({
            sessionId,
            eventSeq: ev.seq,
            type: ev.type,
            text: eventText,
            attribution: {
              ...attribution,
              eventSeq: ev.seq,
            },
          })
        }
      }
    }

    return hits
  }
}

/**
 * Extract searchable text content from a session event.
 * @param ev - session event.
 * @returns text string if present.
 */
function extractTextFromEvent(ev: SessionEvent): string | undefined {
  if (!ev.data) return undefined
  const data = ev.data as Record<string, unknown>
  if (typeof data.text === 'string') return data.text
  if (typeof data.content === 'string') return data.content
  if (data.message && typeof data.message === 'object') {
    const msg = data.message as Record<string, unknown>
    if (typeof msg.text === 'string') return msg.text
    if (typeof msg.content === 'string') return msg.content
    if (Array.isArray(msg.content)) {
      const parts: string[] = []
      for (const part of msg.content) {
        if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
          parts.push(part.text)
        }
      }
      if (parts.length > 0) return parts.join(' ')
    }
  }
  if (Array.isArray(data.content)) {
    const parts: string[] = []
    for (const part of data.content) {
      if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
        parts.push(part.text)
      }
    }
    if (parts.length > 0) return parts.join(' ')
  }
  return undefined
}

/**
 * Empty zeroed token usage metrics.
 */
function emptyMetrics(): TokenUsageMetrics {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
}

/**
 * Add two token usage metrics.
 * @param a - first metric.
 * @param b - second metric.
 * @returns combined metrics.
 */
function addMetrics(a: TokenUsageMetrics, b: TokenUsageMetrics): TokenUsageMetrics {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  }
}

/**
 * Usage aggregator implementing the new fold that accounts for assistant and auxiliary calls
 * and strictly excludes inherited fork history from duplicate charging.
 */
export class UsageAggregator {
  private readonly auxiliaryRecords = new Map<SessionId, AuxiliaryUsageRecord[]>()
  private readonly storageQueue = new StageCStorageQueue()
  private storagePath: string | undefined
  private corrupt = false

  constructor(
    private readonly ctx: Context,
    private readonly catalogResolver?: (() => Promise<AssistantCatalog | undefined>) | undefined,
  ) {}

  /**
   * Configure the profile-owned billing file before loading durable state.
   * @param storagePath - profile-owned durable auxiliary billing file.
   */
  setStoragePath(storagePath: string | undefined): void {
    this.storagePath = storagePath
  }

  /**
   * Load billing records atomically after validating the complete file.
   * @returns completion after validating and replacing all in-memory auxiliary records.
   */
  load(): Promise<void> {
    return this.storageQueue.run(async () => {
      if (!this.storagePath) return
      try {
        const records = parseAuxiliaryUsage(JSON.parse(await readFile(this.storagePath, 'utf8')))
        this.auxiliaryRecords.clear()
        for (const record of records) {
          const sessionRecords = this.auxiliaryRecords.get(record.sessionId) ?? []
          sessionRecords.push(record)
          this.auxiliaryRecords.set(record.sessionId, sessionRecords)
        }
        this.corrupt = false
      } catch (error) {
        if (isMissingFile(error)) return
        this.corrupt = true
        throw error
      }
    })
  }

  /**
   * Persist committed billing without overwriting rejected storage.
   * @returns completion after committed billing state reaches durable storage.
   */
  flush(): Promise<void> {
    return this.storageQueue.run(() => this.persist(this.allRecords()))
  }

  private allRecords(): AuxiliaryUsageRecord[] {
    return Array.from(this.auxiliaryRecords.values()).flat()
  }

  private async persist(records: AuxiliaryUsageRecord[]): Promise<void> {
    if (this.corrupt) throw new Error('Refusing to overwrite corrupt auxiliary usage storage')
    if (this.storagePath) {
      try {
        await atomicStageCWrite(this.storagePath, records)
      } catch (error) {
        if (error instanceof StageCStorageCommitError) this.corrupt = true
        throw error
      }
    }
  }

  /**
   * Commit one observed inference charge; replaying its identity cannot bill twice.
   * @param record - provider-reported auxiliary usage and attribution.
   * @returns completion after the billing record is durable.
   */
  recordAuxiliaryUsage(record: AuxiliaryUsageRecord): Promise<void> {
    return this.storageQueue.run(async () => {
      const validated = parseAuxiliaryUsage([record])[0]
      if (validated === undefined) throw new Error('Auxiliary usage validation returned no record')
      const records = this.allRecords()
      const existing = records.find(item => item.id === validated.id)
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(validated)) throw new Error('Conflicting auxiliary usage identity')
        return
      }
      await this.persist([...records, validated])
      const sessionRecords = this.auxiliaryRecords.get(validated.sessionId) ?? []
      this.auxiliaryRecords.set(validated.sessionId, [...sessionRecords, validated])
    })
  }

  /**
   * Retrieve all recorded auxiliary usage records for a session.
   * @param sessionId - target session identifier.
   * @returns array of auxiliary usage records.
   */
  getAuxiliaryRecords(sessionId: SessionId): readonly AuxiliaryUsageRecord[] {
    return this.auxiliaryRecords.get(sessionId) ?? []
  }

  /**
   * Fold token usage across session events starting strictly after the start boundary sequence.
   * Events prior to startBoundarySeq represent inherited fork history and are excluded from charging.
   * @param sessionId - target session identifier.
   * @param bindingId - binding or conversation identifier.
   * @param startBoundarySeq - starting sequence boundary (events < startBoundarySeq are excluded).
   * @param events - raw session events.
   * @param options - optional time filters.
   * @returns computed binding usage summary.
   */
  foldSessionUsage(
    sessionId: SessionId,
    bindingId: string,
    startBoundarySeq: number,
    events: readonly SessionEvent[],
    options?: { fromTimestamp?: number | undefined; toTimestamp?: number | undefined },
  ): BindingUsageSummary {
    let assistantTokens = emptyMetrics()
    let auxiliaryTokens = emptyMetrics()
    let assistantCallCount = 0
    let auxiliaryCallCount = 0
    const modelBreakdown: Record<string, TokenUsageMetrics> = {}
    const billedAuxiliaryIds = new Set<string>()

    // Fold session events:
    for (const ev of events) {
      // INHERITED FORK HISTORY EXCLUSION:
      // Strictly skip any event with seq < startBoundarySeq.
      if (ev.seq < startBoundarySeq) {
        continue
      }

      if (options?.fromTimestamp !== undefined && ev.time < options.fromTimestamp) {
        continue
      }
      if (options?.toTimestamp !== undefined && ev.time > options.toTimestamp) {
        continue
      }

      const data = ev.data as Record<string, unknown> | undefined
      if (!data) continue

      const isAuxiliaryEvent = ev.type === 'assistant/auxiliary'
      if (isAuxiliaryEvent && data.phase !== 'result') continue
      const isAux = isAuxiliaryEvent || Boolean(data.isAuxiliary || data.auxiliary || data.purpose === 'auxiliary')
      const auxiliaryId = isAux && typeof data.id === 'string' ? data.id : undefined
      if (auxiliaryId && billedAuxiliaryIds.has(auxiliaryId)) continue
      let provider = typeof data.provider === 'string' ? data.provider : undefined
      let model = typeof data.model === 'string' ? data.model : undefined
      if ((!provider || !model) && data.message && typeof data.message === 'object') {
        const msg = data.message as Record<string, unknown>
        if (msg.source && typeof msg.source === 'object') {
          const src = msg.source as Record<string, unknown>
          if (typeof src.provider === 'string') provider ??= src.provider
          if (typeof src.model === 'string') model ??= src.model
        }
      }
      provider ??= 'default'
      model ??= 'default'
      const modelKey = `${provider}/${model}`

      // Check for usage in event:
      let eventUsage: TokenUsageMetrics | undefined
      if (data.usage && typeof data.usage === 'object') {
        const u = data.usage as Record<string, unknown>
        const inputTokens = typeof u.inputTokens === 'number' ? u.inputTokens : typeof u.prompt_tokens === 'number' ? u.prompt_tokens : 0
        const outputTokens =
          typeof u.outputTokens === 'number' ? u.outputTokens : typeof u.completion_tokens === 'number' ? u.completion_tokens : 0
        const totalTokens = typeof u.totalTokens === 'number' ? u.totalTokens : inputTokens + outputTokens
        eventUsage = { inputTokens, outputTokens, totalTokens }
      } else if (typeof data.tokensUsed === 'number') {
        eventUsage = { inputTokens: 0, outputTokens: data.tokensUsed, totalTokens: data.tokensUsed }
      } else if (Array.isArray(data.stream)) {
        for (const frame of data.stream) {
          if (frame && typeof frame === 'object') {
            const f = frame as Record<string, unknown>
            const chunk = (f.chunk && typeof f.chunk === 'object' ? f.chunk : f) as Record<string, unknown>
            if (chunk.type === 'usage' && chunk.usage && typeof chunk.usage === 'object') {
              const u = chunk.usage as Record<string, unknown>
              const inputTokens =
                typeof u.inputTokens === 'number' ? u.inputTokens : typeof u.prompt_tokens === 'number' ? u.prompt_tokens : 0
              const outputTokens =
                typeof u.outputTokens === 'number' ? u.outputTokens : typeof u.completion_tokens === 'number' ? u.completion_tokens : 0
              const totalTokens = typeof u.totalTokens === 'number' ? u.totalTokens : inputTokens + outputTokens
              eventUsage = { inputTokens, outputTokens, totalTokens }
              break
            }
          }
        }
      }

      if (eventUsage) {
        if (isAux) {
          if (auxiliaryId) billedAuxiliaryIds.add(auxiliaryId)
          auxiliaryTokens = addMetrics(auxiliaryTokens, eventUsage)
          auxiliaryCallCount++
        } else {
          assistantTokens = addMetrics(assistantTokens, eventUsage)
          assistantCallCount++
        }
        const existingModel = modelBreakdown[modelKey] ?? emptyMetrics()
        modelBreakdown[modelKey] = addMetrics(existingModel, eventUsage)
      }
    }

    // Fold recorded auxiliary records for this session:
    const auxList = this.auxiliaryRecords.get(sessionId) ?? []
    for (const aux of auxList) {
      if (billedAuxiliaryIds.has(aux.id)) continue
      if (aux.seq < startBoundarySeq) continue
      if (options?.fromTimestamp !== undefined && aux.timestamp < options.fromTimestamp) continue
      if (options?.toTimestamp !== undefined && aux.timestamp > options.toTimestamp) continue

      auxiliaryTokens = addMetrics(auxiliaryTokens, aux.usage)
      auxiliaryCallCount++
      const modelKey = `${aux.provider}/${aux.model}`
      const existingModel = modelBreakdown[modelKey] ?? emptyMetrics()
      modelBreakdown[modelKey] = addMetrics(existingModel, aux.usage)
    }

    return {
      bindingId,
      sessionId,
      startBoundarySeq,
      assistantTokens,
      auxiliaryTokens,
      totalTokens: addMetrics(assistantTokens, auxiliaryTokens),
      assistantCallCount,
      auxiliaryCallCount,
      modelBreakdown,
    }
  }

  private async resolveBindings(request: AggregateUsageRequest): Promise<NonNullable<AggregateUsageRequest['sessionBindings']>> {
    if (request.sessionBindings) return request.sessionBindings
    if (!request.profileId && !request.teamId && !request.conversationId) return []
    const catalog = await this.catalogResolver?.()
    if (!catalog) throw new Error('Assistant catalog unavailable for usage selectors')
    if (request.profileId && !catalog.getProfile(request.profileId)) throw new Error('Unknown usage profile')
    if (request.teamId && !catalog.getTeam(request.teamId)) throw new Error('Unknown usage team')
    if (request.conversationId && !catalog.getConversation(request.conversationId)) throw new Error('Unknown usage conversation')
    const bindings = new Map<SessionId, NonNullable<AggregateUsageRequest['sessionBindings']>[number]>()
    for (const conversation of catalog.listConversations(undefined, true)) {
      if (
        request.teamId ||
        (request.profileId && conversation.profileId !== request.profileId) ||
        (request.conversationId && conversation.id !== request.conversationId)
      )
        continue
      bindings.set(conversation.rootSessionId, {
        sessionId: conversation.rootSessionId,
        bindingId: conversation.id,
        startBoundarySeq: 0,
        profileId: conversation.profileId,
      })
    }
    if (!request.conversationId)
      for (const team of catalog.listTeams({ includeArchived: true })) {
        if (request.teamId && team.id !== request.teamId) continue
        for (const seat of catalog.listSeats(team.id)) {
          if (request.profileId && seat.profileId !== request.profileId) continue
          const sessions = new Set([...seat.runtimeInstances, ...(seat.activeInstanceId ? [seat.activeInstanceId] : [])])
          for (const sessionId of sessions)
            bindings.set(sessionId, {
              sessionId,
              bindingId: seat.id,
              startBoundarySeq: 0,
              profileId: seat.profileId,
              teamId: team.id,
              seatId: seat.id,
            })
        }
        if (
          team.leadSessionId &&
          !bindings.has(team.leadSessionId) &&
          (!request.profileId || team.coordinatorProfileId === request.profileId)
        ) {
          bindings.set(team.leadSessionId, {
            sessionId: team.leadSessionId,
            bindingId: team.id,
            startBoundarySeq: 0,
            profileId: team.coordinatorProfileId,
            teamId: team.id,
          })
        }
      }
    return [...bindings.values()]
  }

  /**
   * Aggregate usage over multiple sessions or bindings according to request criteria.
   * @param request - criteria including session bindings and time bounds.
   * @returns array of binding usage summaries.
   */
  async aggregateUsage(request: AggregateUsageRequest): Promise<readonly BindingUsageSummary[]> {
    const persistence = this.ctx.get('sessionPersistence') as SessionPersistence | undefined
    const bindings = await this.resolveBindings(request)
    const summaries: BindingUsageSummary[] = []

    for (const b of bindings) {
      let startBoundarySeq = b.startBoundarySeq
      let events: readonly SessionEvent[] = []
      if (persistence) {
        try {
          const handle = await persistence.open(b.sessionId, 'read')
          try {
            startBoundarySeq = Math.max(startBoundarySeq, handle.inheritedEventCount)
            const res = await handle.read()
            events = res.events
          } finally {
            await handle.close()
          }
        } catch {
          // If session persistence unreadable, fall back to empty events
        }
      }

      const summary = this.foldSessionUsage(b.sessionId, b.bindingId, startBoundarySeq, events, {
        ...(request.fromTimestamp !== undefined ? { fromTimestamp: request.fromTimestamp } : {}),
        ...(request.toTimestamp !== undefined ? { toTimestamp: request.toTimestamp } : {}),
      })
      summaries.push(summary)
    }

    return summaries
  }
}
