/**
 * Memory review and composer predictions (S24).
 * Provides bounded per-turn review with deduplication, secret/instruction rejection,
 * and auxiliary usage accounting; and bounded tool-free composer predictions
 * with revision guarding and usage accounting.
 *
 * @module @deepseek-ai/dsh-experimental-assistant-registry/review-prediction
 */

import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { MessageId } from '@deepseek-ai/dsh-llm'
import { runAuxiliaryInference, type AuxiliaryInferenceResult } from './auxiliary-inference.ts'
import type { UsageAggregator } from './cursors-usage.ts'
import {
  AssistantProfileId,
  TeamDefinitionId,
  type ReviewTurnRequest,
  type ReviewTurnResult,
  type ComposerPredictionRequest,
  type ComposerPredictionResult,
  type AuxiliaryUsageRecord,
  type MemoryEntry,
  type MemoryScope,
  type SaveMemoryOptions,
  type ListMemoryOptions,
} from './types.ts'

/** Minimal memory store interface required for memory review operations. */
export interface ReviewMemoryStore {
  readonly listMemory: (scope: MemoryScope, options?: ListMemoryOptions) => Promise<readonly MemoryEntry[]> | readonly MemoryEntry[]
  readonly saveMemory: (scope: MemoryScope, text: string, options?: SaveMemoryOptions) => Promise<MemoryEntry>
}

/** Regex identifying secrets: API keys, tokens, bearer auth, passwords, private keys. */
export const SECRET_PATTERN =
  // oxlint-disable-next-line @stylistic/max-len -- Keep the secret matcher as one regular expression.
  /(?:sk-[a-z0-9_-]{16,}|ghp_[a-z0-9]{20,}|Bearer\s+[a-z0-9_.-]{16,}|(?:api[_-]?key|password|token)\s*[:=]\s*\S+|BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY)/i

/** Regex identifying prompt injections and system instructions. */
export const INSTRUCTION_PATTERN =
  // oxlint-disable-next-line @stylistic/max-len -- Keep instruction alternatives in one regular expression.
  /(?:ignore\s+(?:all\s+|previous\s+|prior\s+)*instructions|system\s+prompt\s*:|<\s*system\s*>|you\s+are\s+now\s+(?:in\s+)?(?:developer|god|unrestricted)\s+mode|disregard\s+(?:all\s+)?(?:above|previous|guidelines)|new\s+system\s+instruction)/i

/** Options for ReviewPredictionManager. */
export interface ReviewPredictionManagerOptions {
  readonly enableMemoryReview?: boolean | undefined
  readonly enableComposerPredictions?: boolean | undefined
  readonly maxReviewTokens?: number | undefined
  readonly maxPredictionTokens?: number | undefined
  readonly predictionTimeoutMs?: number | undefined
  readonly reviewTimeoutMs?: number | undefined
  readonly maxReviewEventsPerTurn?: number | undefined
}

/**
 * Normalizes text for deduplication comparison.
 * @param str - input text string.
 * @returns normalized string.
 */
function normalizeForComparison(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Checks if a candidate memory is a duplicate of any existing memory entry in scope.
 * @param candidate - candidate memory text.
 * @param existing - existing memory entries in scope.
 * @returns true if duplicate.
 */
export function isDuplicateMemory(candidate: string, existing: readonly MemoryEntry[]): boolean {
  const normCandidate = normalizeForComparison(candidate)
  if (normCandidate.length === 0) return true

  for (const entry of existing) {
    if (entry.removedAt !== undefined) continue
    const normExisting = normalizeForComparison(entry.text)
    if (normCandidate === normExisting) return true
    if (normCandidate.length > 15 && normExisting.includes(normCandidate)) return true
    if (normExisting.length > 15 && normCandidate.includes(normExisting)) return true
  }
  return false
}

/**
 * Evaluates candidate memory text for rejection reasons.
 * @param candidate - candidate text string.
 * @param existing - existing memory entries in scope.
 * @returns rejection reason or null if accepted.
 */
export function evaluateMemoryCandidate(
  candidate: string,
  existing: readonly MemoryEntry[],
): 'duplicate' | 'secret' | 'instruction' | 'empty' | null {
  const trimmed = candidate.trim()
  if (trimmed.length < 3) return 'empty'
  if (SECRET_PATTERN.test(trimmed)) return 'secret'
  if (INSTRUCTION_PATTERN.test(trimmed)) return 'instruction'
  if (isDuplicateMemory(trimmed, existing)) return 'duplicate'
  return null
}

/**
 * Manager providing bounded memory review and contextual composer predictions.
 */
export class ReviewPredictionManager {
  private readonly reviewLocks = new Map<string, Promise<void>>()
  private readonly controllers = new Map<AbortController, SessionId>()
  private closed = false

  constructor(
    private readonly ctx: Context,
    private readonly memoryStore: ReviewMemoryStore,
    private readonly usage: UsageAggregator,
    private readonly options: ReviewPredictionManagerOptions = {},
  ) {}

  /**
   * Stop obsolete inference for one session.
   * @param sessionId - session starting new work.
   */
  cancelSession(sessionId: SessionId): void {
    for (const [controller, owner] of this.controllers) if (owner === sessionId) controller.abort()
  }

  /** Stop auxiliary inference before service teardown. */
  dispose(): void {
    this.closed = true
    for (const controller of this.controllers.keys()) controller.abort()
  }

  private resolveRoute(sessionId?: SessionId): { provider: string; model: string } | undefined {
    if (sessionId) {
      const sessions = this.ctx.get('sessions') as import('@deepseek-ai/dsh-session').SessionStore | undefined
      const session = sessions?.get(sessionId)
      if (!session) return undefined
      const sessionConfig = session.requestHeader()?.config
      if (sessionConfig?.provider && sessionConfig?.model) {
        return { provider: sessionConfig.provider, model: sessionConfig.model }
      }
      const agent = (this.ctx.get('agents') as import('@deepseek-ai/dsh-agent').AgentRegistry | undefined)?.get(sessionId)
      if (agent?.options.provider && agent.options.model) {
        return { provider: agent.options.provider, model: agent.options.model }
      }
    }
    const defaultModel = this.ctx.get('agentDefaultModel') as { currentSelection: () => { provider: string; model: string } } | undefined
    if (defaultModel) {
      const sel = defaultModel.currentSelection()
      if (sel?.provider && sel?.model) {
        return sel
      }
    }
    return undefined
  }

  /**
   * Perform bounded per-turn review of turn events to extract salient memories.
   * Filters out secrets and system instructions, deduplicates against existing memories in scope,
   * adds accepted entries to the catalog, and accounts for auxiliary inference usage.
   * Serializes concurrent calls per scope and turn sequence.
   * @param request - review turn request parameters.
   * @returns review result containing candidate, added, and rejected entries.
   */
  async reviewTurn(request: ReviewTurnRequest): Promise<ReviewTurnResult> {
    if (this.closed) return { candidateMemories: [], addedMemories: [], rejectedReasons: [] }
    const scope =
      request.scope.profileId !== undefined
        ? { kind: 'profile' as const, profileId: request.scope.profileId }
        : request.scope.teamId !== undefined
          ? { kind: 'team' as const, teamId: request.scope.teamId }
          : undefined

    if (!this.options.enableMemoryReview && request.trigger !== 'manual') {
      return {
        candidateMemories: [],
        addedMemories: [],
        rejectedReasons: [],
      }
    }

    if (!scope) {
      return {
        candidateMemories: [],
        addedMemories: [],
        rejectedReasons: [],
      }
    }

    const scopeKey = scope.kind === 'profile' ? `profile:${scope.profileId}` : `team:${scope.teamId}`
    const lockKey = scopeKey

    const prevLock = this.reviewLocks.get(lockKey) ?? Promise.resolve()
    let releaseLock!: () => void
    const currentLock = new Promise<void>((r) => {
      releaseLock = r
    })
    const tail = prevLock.then(() => currentLock)
    this.reviewLocks.set(lockKey, tail)

    await prevLock
    try {
      if (this.closed) return { candidateMemories: [], addedMemories: [], rejectedReasons: [] }
      return await this.doReviewTurn(request, scope)
    } finally {
      releaseLock()
      if (this.reviewLocks.get(lockKey) === tail) {
        this.reviewLocks.delete(lockKey)
      }
    }
  }

  private async doReviewTurn(
    request: ReviewTurnRequest,
    scope: { kind: 'profile'; profileId: AssistantProfileId } | { kind: 'team'; teamId: TeamDefinitionId },
  ): Promise<ReviewTurnResult> {
    const existingMemories = await this.memoryStore.listMemory(scope, {
      includeRemoved: false,
    })

    // Collect turn text messages with strict character and count caps:
    const turnTexts: string[] = []
    if (request.turnTexts && request.turnTexts.length > 0) {
      const sliceLimit = Math.min(this.options.maxReviewEventsPerTurn ?? 10, 10)
      for (const t of request.turnTexts.slice(-sliceLimit)) {
        turnTexts.push(t.slice(0, 500))
      }
    }

    const candidates: string[] = []
    if (request.candidateMemories && request.candidateMemories.length > 0) {
      for (const c of request.candidateMemories.slice(0, 10)) {
        candidates.push(c.slice(0, 200))
      }
    }
    let usageRecord: AuxiliaryUsageRecord | undefined

    const llm = this.ctx.get('llm') as LlmRuntime | undefined
    const maxTokens = this.options.maxReviewTokens ?? 500
    const route = this.resolveRoute(request.sessionId)

    if (llm && route && turnTexts.length > 0) {
      const prompt = `Turn context:\n${turnTexts.join('\n')}\n\nTask: Extract at most 2 concise domain facts, user preferences, or decisions that should be remembered permanently. Return each fact on a separate line starting with '- '. If none, reply 'NONE'.`
      const callOptions = {
        provider: route.provider,
        model: route.model,
        messages: [
          {
            id: MessageId(`review-req-${randomUUID().slice(0, 8)}`),
            role: 'user' as const,
            source: { kind: 'user' as const },
            content: [{ type: 'text' as const, text: prompt }],
          },
        ],
        maxTokens,
      }

      const controller = new AbortController()
      this.controllers.set(controller, request.sessionId)
      const timer = setTimeout(() => controller.abort(), this.options.reviewTimeoutMs ?? 3000)
      let observed: AuxiliaryInferenceResult
      try {
        observed = await runAuxiliaryInference(this.ctx, this.usage, request.sessionId, request.turnSeq, 'memory_review', {
          ...callOptions,
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
        this.controllers.delete(controller)
      }
      if (controller.signal.aborted || this.closed)
        return { candidateMemories: [], addedMemories: [], rejectedReasons: [], ...(observed.record ? { usage: observed.record } : {}) }
      usageRecord = observed.record
      const rawOutput = observed.finish === 'error' || observed.finish === 'aborted' ? '' : observed.text

      // Parse lines:
      if (rawOutput.length > 0 && !rawOutput.toUpperCase().includes('NONE')) {
        const lines = rawOutput.split('\n')
        for (const line of lines) {
          const cleaned = line.replace(/^[-*•]\s*/, '').trim()
          if (cleaned.length > 0 && candidates.length < 10) candidates.push(cleaned.slice(0, 200))
        }
      }
    }

    // Fallback: rule-based candidates if LLM produced none or wasn't available
    if (candidates.length === 0) {
      for (const t of turnTexts) {
        const sentences = t
          .split(/[.!?\n]+/)
          .map(s => s.trim())
          .filter(s => s.length >= 3)
        for (const s of sentences) {
          if (/remember|prefer|decision|always|rule|note|important|fact|system|secret|token|key|password|ignore/i.test(s)) {
            if (candidates.length < 10) candidates.push(s.slice(0, 200))
          }
        }
      }
    }

    const addedMemories: MemoryEntry[] = []
    const rejectedReasons: { text: string; reason: 'duplicate' | 'secret' | 'instruction' | 'empty' }[] = []

    const currentMemories = [...existingMemories]
    for (const candidate of candidates.slice(0, 10)) {
      const rejection = evaluateMemoryCandidate(candidate, currentMemories)
      if (rejection !== null) {
        rejectedReasons.push({ text: candidate, reason: rejection })
        continue
      }

      const added = await this.memoryStore.saveMemory(scope, candidate, {
        sourceSessionId: request.sessionId,
        sourceEventSeq: request.turnSeq,
        author: request.author ?? 'system',
      })
      addedMemories.push(added)
      currentMemories.push(added)
    }

    return {
      candidateMemories: candidates,
      addedMemories,
      rejectedReasons,
      ...(usageRecord !== undefined ? { usage: usageRecord } : {}),
    }
  }

  /**
   * Generate one bounded tool-free prediction for an eligible completed turn.
   * Bounded by maxPredictionTokens and predictionTimeoutMs. Accounts for auxiliary usage.
   * Records auxiliary evidence without adding conversation turns or public replies.
   * @param request - composer prediction request parameters.
   * @param signal - cancellation for the auxiliary model request.
   * @returns composer prediction result or null if disabled / failed.
   */
  async predictComposer(request: ComposerPredictionRequest, signal?: AbortSignal): Promise<ComposerPredictionResult | null> {
    if (this.closed || !this.options.enableComposerPredictions || signal?.aborted) return null
    const route = this.resolveRoute(request.sessionId)
    if (!route || !this.ctx.get('llm')) return null
    const controller = new AbortController()
    this.controllers.set(controller, request.sessionId)
    const abort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => controller.abort(), this.options.predictionTimeoutMs ?? 3000)
    try {
      const recentSnippet =
        request.recentTexts
          ?.slice(-3)
          .map(t => t.slice(0, 300))
          .join('\n') ?? ''
      const prompt = `Recent conversation context:\n${recentSnippet}\nTask: Suggest one concise follow-up question the user might enter next. Return only the suggested text.`
      const observed = await runAuxiliaryInference(this.ctx, this.usage, request.sessionId, request.asOfSeq, 'prediction', {
        provider: route.provider,
        model: route.model,
        messages: [
          {
            id: MessageId(`prediction-${randomUUID()}`),
            role: 'user',
            source: { kind: 'user' },
            content: [{ type: 'text', text: prompt }],
          },
        ],
        maxTokens: this.options.maxPredictionTokens ?? 150,
        signal: controller.signal,
      })
      if (controller.signal.aborted || observed.finish === 'error' || observed.finish === 'aborted') return null
      const text = observed.text.trim().replace(/^["']|["']$/g, '')
      if (!text) return null
      return {
        predictionId: `pred-${randomUUID()}`,
        sessionId: request.sessionId,
        asOfSeq: request.asOfSeq,
        text,
        ...(observed.record ? { usage: observed.record } : {}),
      }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      this.controllers.delete(controller)
    }
  }
}
