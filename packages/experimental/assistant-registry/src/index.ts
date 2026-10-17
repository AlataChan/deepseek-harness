/**
 * Persistent assistant and team catalog, scoped route selection, and lifecycle registry.
 * @module @deepseek-ai/dsh-experimental-assistant-registry
 */

import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { Context, Service, type Volatile } from '@deepseek-ai/cordis'
import { completedPredictionContext, streamingPredictionContext } from './prediction-context.ts'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import { SessionId, type Session, type SessionStore } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type { AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import type { TeamService, TeamView as AgentTeamView } from '@deepseek-ai/dsh-experimental-agent-team'
import { requireInstitutionSquad } from '@deepseek-ai/dsh-experimental-agent-team'
import { foldSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import type { ModelSelection, Agent } from '@deepseek-ai/dsh-agent'
import { contentHasImage, LlmError, ReasoningEffortId, type LlmCallConfig, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionPromptRequest, SessionPromptValue } from '@deepseek-ai/dsh-api-session-controller'
import {
  AssistantConversationId,
  AssistantProfileId,
  TeamDefinitionId,
  TeamSeatId,
  type AssistantConversation,
  type AssistantModelSelection,
  type AssistantProfile,
  type CapturedRoute,
  type CreateAssistantProfileOptions,
  type CreateAssistantConversationOptions,
  type UpdateAssistantProfileOptions,
  type TeamDefinition,
  type TeamSeat,
  type CreateTeamDefinitionOptions,
  type UpdateTeamDefinitionOptions,
  type CreateTeamSeatOptions,
  type UpdateTeamSeatOptions,
  type TeamTemplateOrigin,
  type RetireSeatOptions,
  type TeamCapacityAccounting,
  type InstitutionAdoptionRecord,
  type AdoptInstitutionSquadOptions,
  type RepairInstitutionAdoptionOptions,
  MemoryEntryId,
  ProvisioningOperationId,
  type CapabilityPolicy,
  type ProvisioningContext,
  type MemoryEntry,
  type MemoryScope,
  type SaveMemoryOptions,
  type ListMemoryOptions,
  MEMORY_TEXT_MAX_LENGTH,
  GroupRoundId,
  GroupDiscussionId,
  RoundSlotId,
  type GroupDiscussion,
  type CreateGroupDiscussionOptions,
  type GroupRoundJournalEntry,
  type GroupTranscriptMessage,
  type QueryPublicTranscriptOptions,
  type QueryPublicTranscriptResult,
  type ScheduleRoundOptions,
  type ReadCursorRecord,
  type ScopedSessionEventHit,
  type AuxiliaryUsageRecord,
  type BindingUsageSummary,
  type AggregateUsageRequest,
  type ReviewTurnRequest,
  type ReviewTurnResult,
  type ComposerPredictionRequest,
  type ComposerPredictionResult,
  type ComposerPredictionContext,
} from './types.ts'
import { readPersistedSession, type PersistedSessionView } from './persisted.ts'
import { installRouteOverride, modelSwitchNotice, routeLabel, sameRoute } from './route-override.ts'

import { installRoleInjection, formatAssistantRoleText, ASSISTANT_ROLE_SECTION_ORDER } from './role-injection.ts'
import {
  installMemoryInjection,
  formatAssistantMemoryText,
  parseAssistantMemorySnapshot,
  type ReconstructedMemorySnapshotEntry,
  ASSISTANT_MEMORY_SECTION_ORDER,
} from './memory-injection.ts'
import { installCreationTools, createAssistantCreateTool, createTeamCreateTool } from './creation-tool.ts'
import { AssistantCatalog, type AssistantCatalogOptions } from './catalog.ts'
import { CatalogWriteLease } from './lease.ts'
import { computeInputFingerprint, canonicalJsonStringify } from './fingerprint.ts'
import {
  assistantsDomainSpec,
  assistantProfileSchema,
  assistantConversationSchema,
  provisioningOperationSchema,
  modelSelectionSchema,
  teamDefinitionSchema,
  teamSeatSchema,
  capabilityPolicySchema,
} from './schema.ts'
import {
  CatalogAlreadyOwnedError,
  RevisionConflictError,
  ProvisioningConflictError,
  AmbiguousAllocationError,
  RoundBoundsExceededError,
} from './errors.ts'
import {
  GroupRoundScheduler,
  DurableRoundJournal,
  DEFAULT_ROUND_BOUNDS,
  type PostPublicReplyOptions,
  type ExecuteRoundOptions,
  type DurableRoundJournalOptions,
  type GroupRoundSchedulerOptions,
} from './rounds.ts'
import {
  DurableReadCursorManager,
  ScopedSessionQueryAdapter,
  UsageAggregator,
  type DurableReadCursorOptions,
  type ScopedQueryAuthorization,
} from './cursors-usage.ts'
import {
  ReviewPredictionManager,
  SECRET_PATTERN,
  INSTRUCTION_PATTERN,
  isDuplicateMemory,
  evaluateMemoryCandidate,
  truncateToUtf8Bytes,
  buildBoundedConversationContext,
  buildBoundedPredictionPrompt,
  parseAndValidatePrediction,
  ASSISTANT_PREFIX_PATTERN,
  type ReviewPredictionManagerOptions,
} from './review-prediction.ts'
import { TEAM_TEMPLATES, getTeamTemplate } from './templates.ts'
import {
  intersectCapabilities,
  installScopeEnforcement,
  assertScopeAccess,
  extractTargetSessionIds,
  ScopeAccessError,
  type EffectiveCapabilities,
  type ScopeEnforcementOptions,
} from './scope-enforcement.ts'
import {
  DispatchOwnershipManager,
  OwnershipConflictError,
  type ExecutionOwnershipToken,
  type ConflictType,
  type ForeignOwnershipConflict,
  type SlotInputStatus,
  type QueuedSlotInput,
  type AcquireOwnershipParams,
  type EnqueueSlotInputParams,
  type CancelSlotResult,
} from './dispatch-ownership.ts'

export type * from './types.ts'
export type { TeamView as AgentTeamView } from '@deepseek-ai/dsh-experimental-agent-team'
export {
  AssistantProfileId,
  AssistantConversationId,
  TeamDefinitionId,
  TeamSeatId,
  MemoryEntryId,
  ProvisioningOperationId,
  GroupRoundId,
  GroupDiscussionId,
  GroupMessageId,
  RoundSlotId,
  MEMORY_TEXT_MAX_LENGTH,
  MEMORY_SNAPSHOT_MAX_ENTRIES,
  MEMORY_SNAPSHOT_MAX_BYTES,
} from './types.ts'
export { installRouteOverride, modelSwitchNotice, routeLabel, sameRoute }
export { installRoleInjection, formatAssistantRoleText, ASSISTANT_ROLE_SECTION_ORDER }
export {
  installMemoryInjection,
  formatAssistantMemoryText,
  parseAssistantMemorySnapshot,
  type ReconstructedMemorySnapshotEntry,
  ASSISTANT_MEMORY_SECTION_ORDER,
}
export { installCreationTools, createAssistantCreateTool, createTeamCreateTool }
export { AssistantCatalog, type AssistantCatalogOptions }
export { CatalogWriteLease }
export { computeInputFingerprint, canonicalJsonStringify }
export {
  assistantsDomainSpec,
  assistantProfileSchema,
  assistantConversationSchema,
  provisioningOperationSchema,
  modelSelectionSchema,
  teamDefinitionSchema,
  teamSeatSchema,
  capabilityPolicySchema,
}
export { CatalogAlreadyOwnedError, RevisionConflictError, ProvisioningConflictError, AmbiguousAllocationError, RoundBoundsExceededError }
export {
  GroupRoundScheduler,
  DurableRoundJournal,
  DEFAULT_ROUND_BOUNDS,
  type PostPublicReplyOptions,
  type ExecuteRoundOptions,
  type DurableRoundJournalOptions,
  type GroupRoundSchedulerOptions,
}
export {
  DurableReadCursorManager,
  ScopedSessionQueryAdapter,
  UsageAggregator,
  type DurableReadCursorOptions,
  type ScopedQueryAuthorization,
}
export {
  ReviewPredictionManager,
  SECRET_PATTERN,
  INSTRUCTION_PATTERN,
  isDuplicateMemory,
  evaluateMemoryCandidate,
  truncateToUtf8Bytes,
  buildBoundedConversationContext,
  buildBoundedPredictionPrompt,
  parseAndValidatePrediction,
  ASSISTANT_PREFIX_PATTERN,
  type ReviewPredictionManagerOptions,
}
export { TEAM_TEMPLATES, getTeamTemplate }
export {
  intersectCapabilities,
  installScopeEnforcement,
  assertScopeAccess,
  extractTargetSessionIds,
  ScopeAccessError,
  type EffectiveCapabilities,
  type ScopeEnforcementOptions,
}
export {
  DispatchOwnershipManager,
  OwnershipConflictError,
  type ExecutionOwnershipToken,
  type ConflictType,
  type ForeignOwnershipConflict,
  type SlotInputStatus,
  type QueuedSlotInput,
  type AcquireOwnershipParams,
  type EnqueueSlotInputParams,
  type CancelSlotResult,
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Persistent assistant and team catalog, scoped route selection, and lifecycle registry. */
    assistants: AssistantService
  }
}

/** Allocation key prefix for one teammate seat's runtime session. */
const SEAT_ALLOCATION_PREFIX = 'seat:'

/**
 * Settling window for the storage facility: it publishes `storageDomain` before its provider
 * chain becomes active, so an eager catalog open during that window retries until this deadline.
 * A fixed protocol bound, not deployment configuration.
 */
const CATALOG_DEPENDENCY_SETTLE_TIMEOUT_MS = 5_000

/** Delay between catalog open attempts while the storage facility settles. */
const CATALOG_DEPENDENCY_SETTLE_RETRY_MS = 10

type EarlyPrediction = {
  session: Session
  attemptId: string
  binding: string
  route: { provider: string; model: string; reasoningEffort?: string }
  controller: AbortController
  promise: Promise<ComposerPredictionResult | null>
}

/** Deployment configuration for assistant registry. */
export interface Config {
  /** Maximum number of active assistant profiles. */
  readonly maxProfiles?: number
  /** Custom lock path for catalog lease acquisition. */
  readonly lockPath?: string
  /** Whether to automatically open the catalog on service activation (defaults to true if storageDomain is present). */
  readonly autoOpen?: boolean
  /** Deployment-wide allowed-tool ceiling intersected into every assistant-bound agent; empty means unrestricted. */
  readonly deploymentAllowedTools?: string[]
  /** Deployment-wide tool denials applied to every assistant-bound agent. */
  readonly deploymentDisallowedTools?: string[]
  /** Deployment-wide allowed-path ceiling for every assistant-bound agent; empty means unrestricted. */
  readonly deploymentAllowedPaths?: string[]
  /** Whether terminal tools stay available to assistant-bound agents (defaults to true). */
  readonly deploymentAllowTerminal?: boolean
  /** Whether subagent tools stay available to assistant-bound agents (defaults to true). */
  readonly deploymentAllowSubagents?: boolean
  /** Whether bounded memory review is enabled (defaults to false). */
  readonly enableMemoryReview?: boolean
  /** Whether composer follow-up predictions are enabled (defaults to false). */
  readonly enableComposerPredictions?: Volatile<boolean> | boolean
  /** Token ceiling for memory review auxiliary calls (defaults to 500). */
  readonly maxReviewTokens?: number
  /** Token ceiling including provider reasoning for composer predictions (defaults to 1024). */
  readonly maxPredictionTokens?: number
  /** Whole-request deadline in ms; 0 disables it (default 0). */
  readonly predictionTimeoutMs?: number
  /** First nonblank-text deadline in ms; 0 disables it (default 0). */
  readonly predictionFirstTextTimeoutMs?: number
  /** Timeout in ms for memory review auxiliary calls (defaults to 3000). */
  readonly reviewTimeoutMs?: number
  /** Byte ceiling for serialized prediction context (defaults to 8192). */
  readonly predictionContextMaxBytes?: number
  /** Visible reply characters before an early suggestion can start (defaults to 30). */
  readonly predictionEarlyMinChars?: number
}

/**
 * Service managing persistent assistant profiles, conversation bindings,
 * scoped model routing, and lifecycle states.
 */
export class AssistantService extends TypertRemoteService {
  static inject = ['storageDomain', 'storage']

  static Config = z.object({
    maxProfiles: z.natural().default(64),
    lockPath: z.string(),
    autoOpen: z.boolean().default(true),
    deploymentAllowedTools: z.array(z.string()).required(false),
    deploymentDisallowedTools: z.array(z.string()).required(false),
    deploymentAllowedPaths: z.array(z.string()).required(false),
    deploymentAllowTerminal: z.boolean().required(false),
    deploymentAllowSubagents: z.boolean().required(false),
    enableMemoryReview: z.boolean().default(false),
    enableComposerPredictions: z.boolean().default(false).volatile(),
    maxReviewTokens: z.natural().default(500),
    maxPredictionTokens: z.natural().default(1024),
    predictionTimeoutMs: z.natural().default(0),
    predictionFirstTextTimeoutMs: z.natural().default(0),
    reviewTimeoutMs: z.natural().default(3000),
    predictionContextMaxBytes: z.natural().default(8192),
    predictionEarlyMinChars: z.natural().min(1).default(30),
  })

  /**
   * Whether composer predictions are currently enabled via live volatile getter or boolean.
   * @returns true if enabled.
   */
  isComposerPredictionsEnabled(): boolean {
    const val = this.config.enableComposerPredictions
    if (val && typeof val === 'object' && 'get' in val && typeof (val as { get: () => unknown }).get === 'function') {
      return (val as Volatile<boolean>).get() === true
    }
    return val === true
  }

  private get agents(): AgentRegistry | undefined {
    return this.ctx.get('agents')
  }

  private get llm(): LlmRuntime | undefined {
    return this.ctx.get('llm')
  }

  private get sessions(): SessionStore | undefined {
    return this.ctx.get('sessions')
  }

  private get sessionController(): SessionController | undefined {
    return this.ctx.get('sessionController')
  }

  private get sessionPersistence(): SessionPersistence | undefined {
    return this.ctx.get('sessionPersistence')
  }

  private get agentTeams(): TeamService | undefined {
    return this.ctx.get('agentTeams')
  }

  private readonly profiles = new Map<AssistantProfileId, AssistantProfile>()
  private readonly conversations = new Map<AssistantConversationId, AssistantConversation>()
  private readonly conversationBySession = new Map<string, AssistantConversationId>()

  private readonly teams = new Map<TeamDefinitionId, TeamDefinition>()
  private readonly emptyRosterRepairs = new Map<TeamDefinitionId, Promise<void>>()
  private readonly seats = new Map<TeamSeatId, TeamSeat>()
  private readonly sessionToTeam = new Map<string, TeamDefinitionId>()
  private readonly adoptions = new Map<string, InstitutionAdoptionRecord>()

  private readonly seatOverrides = new Map<TeamSeatId, AssistantModelSelection>()
  private readonly seatRevisions = new Map<TeamSeatId, number>()
  private readonly sessionToSeat = new Map<string, TeamSeatId>()

  private readonly lifecycleChanges = new Set<string>()

  private readonly memories = new Map<MemoryEntryId, MemoryEntry>()

  private readonly capturedRoutes = new Map<string, CapturedRoute>()
  private readonly stepMessages = new Map<string, readonly UserMessage[]>()
  private readonly roleInstaller: ReturnType<typeof installRoleInjection>
  private readonly memoryInstaller: ReturnType<typeof installMemoryInjection>
  /** Disposer for registered assistant and team creation tools. */
  public readonly creationToolsDisposer: () => void

  /** Exclusive execution ownership manager for coordinator dispatch, tools, and child arbitration. */
  public readonly ownership: DispatchOwnershipManager

  /** Group round scheduler for coordinator-first, bounded multi-speaker discussion rounds. */
  public readonly roundScheduler: GroupRoundScheduler

  /** Durable read cursor manager for tracking cross-window unread state. */
  public readonly readCursors: DurableReadCursorManager

  /** Scoped session-query adapter enforcing strict scope boundaries and stable attribution. */
  public readonly scopedQuery: ScopedSessionQueryAdapter

  /** Usage aggregator implementing the new fold with auxiliary call accounting. */
  public readonly usage: UsageAggregator

  /** Manager providing bounded memory review and contextual composer predictions. */
  public readonly reviewPredictions: ReviewPredictionManager

  /** Active persistent catalog instance if opened or attached. */
  public catalog?: AssistantCatalog | undefined

  private catalogInitPromise?: Promise<AssistantCatalog | undefined> | undefined
  private readonly completedReviewTasks = new Map<string, Promise<void>>()
  private readonly predictionTurnStarts = new Map<SessionId, { session: Session; seq: number; turn: number }>()
  private readonly predictionReplyPrefixes = new Map<SessionId, { attemptId: string; turn: number; text: string }>()
  private readonly earlyPredictions = new Map<SessionId, EarlyPrediction>()
  private readonly backgroundRoundTasks = new Map<GroupRoundId, Promise<void>>()
  private readonly backgroundRoundErrors = new Map<GroupRoundId, Error>()
  private disposed = false

  constructor(
    ctx: Context,
    private readonly config: Config = {},
  ) {
    super(ctx, 'assistants')
    this.authorizeSessionSource = this.authorizeSessionSource.bind(this)
    this.ownership = new DispatchOwnershipManager(ctx)
    const storageDir = this.config.lockPath
      ? dirname(this.config.lockPath)
      : this.config.autoOpen !== false
        ? dshHomePath('storages')
        : undefined
    const readCursorsPath = storageDir ? join(storageDir, 'assistant-read-cursors.json') : undefined
    const roundsJournalPath = storageDir ? join(storageDir, 'assistant-rounds.json') : undefined

    this.readCursors = new DurableReadCursorManager({
      ...(readCursorsPath !== undefined ? { storagePath: readCursorsPath } : {}),
    })
    this.scopedQuery = new ScopedSessionQueryAdapter(ctx, async () => {
      return this.catalog ?? (await this.initCatalog())
    })
    this.usage = new UsageAggregator(ctx, async () => this.catalog ?? (await this.initCatalog()))
    this.roundScheduler = new GroupRoundScheduler(ctx, this.ownership, {
      catalog: this.catalog,
      ...(roundsJournalPath !== undefined ? { storagePath: roundsJournalPath } : {}),
      seatResolver: async (teamId) => {
        const cat = this.catalog ?? (await this.initCatalog())
        if (cat) return cat.listSeats(teamId)
        return this.listSeats(teamId)
      },
      teamResolver: async (teamId) => {
        const cat = this.catalog ?? (await this.initCatalog())
        if (this.lifecycleChanges.has(teamId)) throw new Error('Team configuration is changing')
        const team = cat ? cat.getTeam(teamId) : await this.getTeam(teamId)
        if (team?.deletedAt !== undefined) throw new Error('Team was permanently deleted')
        return team
      },
    })
    ctx.effect(
      () => async () => {
        await this.dispose()
      },
      'assistant-registry: flush on dispose',
    )
    this.reviewPredictions = new ReviewPredictionManager(
      ctx,
      {
        listMemory: (scope, opts) => this.listMemory(scope, opts),
        saveMemory: (scope, text, opts) => this.saveMemory(scope, text, opts),
      },
      this.usage,
      {
        enableMemoryReview: config.enableMemoryReview,
        enableComposerPredictions: config.enableComposerPredictions,
        isPredictionEnabled: () => this.isComposerPredictionsEnabled(),
        maxReviewTokens: config.maxReviewTokens,
        maxPredictionTokens: config.maxPredictionTokens,
        predictionTimeoutMs: config.predictionTimeoutMs,
        predictionFirstTextTimeoutMs: config.predictionFirstTextTimeoutMs,
        reviewTimeoutMs: config.reviewTimeoutMs,
        predictionContextMaxBytes: config.predictionContextMaxBytes,
      },
    )
    installRouteOverride(ctx, this)
    this.roleInstaller = installRoleInjection(ctx, this)
    this.memoryInstaller = installMemoryInjection(ctx, this)
    this.creationToolsDisposer = installCreationTools(ctx, this)

    ctx.inject(['settings'], (child) => {
      child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
    })

    ctx.on('loader/volatile-update', () => {
      if (!this.isComposerPredictionsEnabled()) {
        this.reviewPredictions.cancelAllPredictions()
        this.cancelEarlyPredictions()
      }
    })

    ctx.on('session/event', (session, event) => {
      if (event.type === 'turn/start') {
        this.reviewPredictions.cancelSession(session.id)
        this.cancelEarlyPrediction(session.id)
        this.predictionTurnStarts.set(session.id, { session, seq: event.seq, turn: event.data.turn })
      }
      if (event.type === 'turn/end' && event.data.reason.kind !== 'completed') {
        this.cancelEarlyPrediction(session.id)
        this.predictionTurnStarts.delete(session.id)
      }
      if (event.type === 'turn/end' && event.data.reason.kind === 'completed' &&
        !this.earlyPredictions.has(session.id)) this.predictionTurnStarts.delete(session.id)
      if (event.type === 'model/selection') {
        const convId = this.conversationBySession.get(String(session.id))
        if (!convId) return
        const conv = this.conversations.get(convId)
        if (!conv || conv.archivedAt !== undefined) return
        if (event.seq > (conv.modelCheckpoint ?? -1)) {
          const selection = event.data as ModelSelection
          void this.setConversationModelOverride(convId, selection, event.seq).catch((error: unknown) => {
            if (this.getConversationBySessionSync(session.id)?.id === convId) {
              console.error('Failed to persist assistant model selection:', error)
            }
          })
        }
      } else if (this.config.enableMemoryReview && event.type === 'turn/end' && event.data.reason.kind === 'completed') {
        const conv = this.getConversationBySessionSync(session.id)
        const teamId = this.getTeamIdBySessionSync(session.id)
        const seat = this.getSeatBySessionSync(session.id)
        const scope =
          teamId && seat?.retiredAt === undefined
            ? { teamId }
            : conv && conv.archivedAt === undefined
              ? { profileId: conv.profileId }
              : undefined
        if (!scope) return
        const key = `${session.id}:${event.seq}`
        if (this.completedReviewTasks.has(key)) return
        const review = Promise.resolve()
          .then(async () => {
            const context = await this.readCompletedTurnContext(session.id, event.seq, false)
            if (!context) return
            await this.reviewTurn({
              sessionId: session.id,
              scope,
              turnSeq: event.seq,
              trigger: 'turn_completed',
              turnTexts: context.recentTexts,
            })
          })
          .catch((error: unknown) => {
            this.ctx.logger.warn('Automatic memory review failed: %s', error)
          })
        this.completedReviewTasks.set(key, review)
        void review.finally(() => {
          this.completedReviewTasks.delete(key)
        })
      }
    })

    ctx.on('agent/assistant-stream', ({ agent, frame }) => {
      if (!this.isComposerPredictionsEnabled()) return
      const sessionId = agent.session.id
      if (frame.type === 'start') {
        this.predictionReplyPrefixes.set(sessionId, { attemptId: String(frame.attemptId), turn: frame.turn, text: '' })
        return
      }
      if (frame.type === 'end') {
        const early = this.earlyPredictions.get(sessionId)
        if (early?.attemptId === String(frame.attemptId) &&
          (frame.outcome.kind === 'abandoned' || frame.outcome.eventType === 'assistant/attempt')) {
          this.cancelEarlyPrediction(sessionId)
        } else {
          this.predictionReplyPrefixes.delete(sessionId)
        }
        return
      }
      if (frame.chunk.type !== 'text-delta' || this.earlyPredictions.has(sessionId)) return
      const prefix = this.predictionReplyPrefixes.get(sessionId)
      if (!prefix || prefix.attemptId !== String(frame.attemptId)) return
      prefix.text = (prefix.text + frame.chunk.text).slice(0, this.config.predictionContextMaxBytes ?? 8192)
      const minChars = this.config.predictionEarlyMinChars ?? 30
      for (const ending of prefix.text.matchAll(/[。！？]|[.!?](?:\s|$)/gu)) {
        if (ending.index + 1 < minChars) continue
        this.startEarlyPrediction(agent, prefix.attemptId, prefix.turn, prefix.text.slice(0, ending.index + 1))
        break
      }
    }, { global: true })

    ctx.on('agent/disposed', ({ agent }) => {
      this.cancelEarlyPrediction(agent.session.id)
      this.predictionTurnStarts.delete(agent.session.id)
    })

    ctx.on('agent/created', ({ agent }) => {
      const sessionId = agent.session.id
      installScopeEnforcement(agent, () => this.getEffectiveCapabilities(sessionId), {
        callerSessionId: sessionId,
        authorizeSessionSource: (caller, target) => this.authorizeSessionSource(caller, target),
      })
    })

    const isolateMap = this.ctx[Context.isolate] as Record<string, symbol> | undefined
    const key = isolateMap?.['assistants']
    if (key) {
      const impl = this.ctx.reflect.store[key]
      if (impl) {
        impl.fiber = this.ctx.root.fiber
      }
    }

    ctx.effect(() => {
      return async () => {
        if (this.catalog) {
          await this.catalog.close()
          this.catalog = undefined
        }
      }
    }, 'assistantRegistry.catalogLifecycle()')
  }

  /**
   * Cordis lifecycle initialization hook. Opens the catalog during plugin loading.
   */
  protected async [Service.init](): Promise<void> {
    if (this.config.autoOpen !== false && !this.catalog) {
      await this.initCatalog()
    }
  }

  /**
   * Wait for the storage domain service to become resolvable.
   *
   * The storage facility publishes its service before its provider chain activates, and the Loader
   * mounts entries concurrently, so a consumer can start ahead of its dependency. The wait is bounded
   * by {@link CATALOG_DEPENDENCY_SETTLE_TIMEOUT_MS}; with auto-open disabled the service resolves as
   * absent immediately, which keeps direct construction on in-memory state.
   * @returns true when the storage domain service is resolvable.
   */
  private async waitForStorageService(): Promise<boolean> {
    if (this.ctx.get('storageDomain', false) !== undefined) return true
    const deadline = this.config.autoOpen === false ? Date.now() : Date.now() + 500
    for (;;) {
      if (this.ctx.get('storageDomain', false) !== undefined) return true
      if (Date.now() >= deadline) return false
      await new Promise(resolve => setTimeout(resolve, CATALOG_DEPENDENCY_SETTLE_RETRY_MS))
    }
  }

  /**
   * Await durable catalog readiness before a public operation reads or writes catalog-backed state.
   * Direct construction without a storage service keeps the service on in-memory state and resolves with undefined.
   * @returns the opened catalog, or undefined without a storage service.
   */
  private async ensureCatalogReady(): Promise<AssistantCatalog | undefined> {
    if (this.catalog) return this.catalog
    return await this.initCatalog()
  }

  /**
   * Initializes and opens the persistent catalog if available in the current context.
   * @param options - optional catalog open options.
   * @returns opened catalog or undefined if storageDomain is absent.
   */
  async initCatalog(options: AssistantCatalogOptions = {}): Promise<AssistantCatalog | undefined> {
    if (this.catalog) return this.catalog
    if (this.catalogInitPromise) return this.catalogInitPromise

    const effectiveLockPath = options.lockPath ?? this.config.lockPath
    const effectiveOptions: AssistantCatalogOptions = {
      ...options,
      ...(effectiveLockPath !== undefined ? { lockPath: effectiveLockPath } : {}),
    }

    this.catalogInitPromise = (async () => {
      try {
        if (this.catalog) return this.catalog
        if (!(await this.waitForStorageService())) return undefined
        const catalog = await this.openCatalogWhenDependenciesSettled(effectiveOptions)
        if (catalog === undefined) return undefined
        this.attachCatalog(catalog)
        this.loadFromCatalog()
        if (effectiveLockPath) {
          const storageDir = dirname(effectiveLockPath)
          this.readCursors.setStoragePath(join(storageDir, 'assistant-read-cursors.json'))
          this.roundScheduler.journal.setStoragePath(join(storageDir, 'assistant-rounds.json'))
          this.usage.setStoragePath(join(storageDir, 'assistant-auxiliary-usage.json'))
        }
        await this.roundScheduler.journal.load()
        await this.readCursors.load()
        await this.usage.load()
        return catalog
      } finally {
        this.catalogInitPromise = undefined
      }
    })()

    return this.catalogInitPromise
  }

  /**
   * Open the catalog, retrying only while the storage facility is settling.
   *
   * The storage facility publishes its service before its provider chain becomes active, so a
   * consumer that starts during that window sees a transient inactive-dependency error. Every other
   * failure (lease already held, missing backend, schema mismatch) is thrown on the first attempt.
   * @param options - resolved catalog open options.
   * @returns opened catalog.
   */
  private async openCatalogWhenDependenciesSettled(options: AssistantCatalogOptions): Promise<AssistantCatalog | undefined> {
    const deadline = Date.now() + CATALOG_DEPENDENCY_SETTLE_TIMEOUT_MS
    for (;;) {
      if (!this.ctx.get('storageDomain')) {
        // A non-strict read still finds a published service whose provider chain has not activated yet.
        if (this.ctx.get('storageDomain', false) === undefined) return undefined
        if (Date.now() >= deadline) throw new Error('Storage domain service did not become available')
        await new Promise(resolve => setTimeout(resolve, CATALOG_DEPENDENCY_SETTLE_RETRY_MS))
        continue
      }
      try {
        return await AssistantCatalog.open(this.ctx, options)
      } catch (error: unknown) {
        const settling = error instanceof Error && (error.message.includes('inactive context') || error.message.includes('without inject'))
        if (!settling || Date.now() >= deadline) throw error
        await new Promise(resolve => setTimeout(resolve, CATALOG_DEPENDENCY_SETTLE_RETRY_MS))
      }
    }
  }

  /**
   * Attaches an authoritative persistent catalog to the service.
   * @param catalog - persistent catalog instance.
   */
  attachCatalog(catalog: AssistantCatalog): void {
    this.catalog = catalog
  }

  /**
   * Initializes in-memory state from the attached persistent catalog.
   */
  loadFromCatalog(): void {
    if (!this.catalog) return
    const profiles = this.catalog.listProfiles(true)
    for (const profile of profiles) {
      this.profiles.set(profile.id, profile)
    }
    const conversations = this.catalog.listConversations(undefined, true)
    for (const conv of conversations) {
      this.conversations.set(conv.id, conv)
      this.conversationBySession.set(String(conv.rootSessionId), conv.id)
    }
    const teams = this.catalog.listTeams({ includeArchived: true, includeDeleted: true })
    for (const team of teams) {
      this.teams.set(team.id, team)
      if (team.leadSessionId) {
        this.sessionToTeam.set(String(team.leadSessionId), team.id)
      }
      const seats = this.catalog.listSeats(team.id)
      for (const seat of seats) {
        this.seats.set(seat.id, seat)
        if (seat.modelOverride) {
          this.seatOverrides.set(seat.id, seat.modelOverride)
        }
        for (const inst of seat.runtimeInstances) {
          this.sessionToSeat.set(String(inst), seat.id)
          this.sessionToTeam.set(String(inst), team.id)
        }
      }
    }
    const adoptions = this.catalog.listAdoptions()
    for (const adoption of adoptions) {
      this.adoptions.set(adoption.squadId, adoption)
    }
    const memories = this.catalog.listAllMemories()
    for (const mem of memories) {
      this.memories.set(mem.id, mem)
    }
  }

  /**
   * Validate a proposed model selection against the served LLM catalog.
   * Rejects immediately if the provider or model is unavailable or incompatible.
   * @param model - model selection to validate.
   * @param signal - optional cancellation signal.
   * @returns resolved call config if valid.
   */
  async validateRoute(model: AssistantModelSelection | ModelSelection, signal?: AbortSignal): Promise<LlmCallConfig> {
    if (!this.llm) {
      return {
        provider: model.provider,
        model: model.model,
        ...(model.reasoningEffort !== undefined ? { reasoningEffort: model.reasoningEffort as ReasoningEffortId } : {}),
      }
    }
    const callConfig: LlmCallConfig = {
      provider: model.provider,
      model: model.model,
      ...(model.reasoningEffort !== undefined ? { reasoningEffort: model.reasoningEffort as ReasoningEffortId } : {}),
    }
    return await this.llm.resolveCallConfig(callConfig, signal)
  }

  /**
   * Whether the given session is bound to an assistant profile or team seat.
   * @param sessionId - target session identifier.
   * @returns true if the session is bound to an assistant profile or team seat.
   */
  isAssistantBound(sessionId: SessionId | string): boolean {
    return (
      this.conversationBySession.has(String(sessionId)) ||
      this.sessionToSeat.has(String(sessionId)) ||
      this.getSeatBySessionSync(sessionId) !== undefined
    )
  }

  /**
   * Whether the given session belongs to a retired team seat.
   * @param sessionId - target session identifier.
   * @returns true if session is bound to a retired seat.
   */
  isSessionRetired(sessionId: SessionId | string): boolean {
    const seatId = this.sessionToSeat.get(String(sessionId))
    if (!seatId) return false
    const seat = this.getSeatSync(seatId)
    return seat?.retiredAt !== undefined
  }

  /**
   * Synchronously retrieve an assistant conversation binding by its root session identifier.
   * @param sessionId - root session identifier.
   * @returns conversation binding if found.
   */
  getConversationBySessionSync(sessionId: SessionId | string): AssistantConversation | undefined {
    const id = this.conversationBySession.get(String(sessionId))
    if (!id) return undefined
    return this.conversations.get(id) ?? (this.catalog ? this.catalog.getConversation(id) : undefined)
  }

  /**
   * Synchronously look up a seat by session ID across live mappings and catalog history.
   * @param sessionId - session identifier.
   * @returns team seat if found.
   */
  getSeatBySessionSync(sessionId: SessionId | string): TeamSeat | undefined {
    const seatId = this.sessionToSeat.get(String(sessionId))
    if (seatId) {
      const seat = this.getSeatSync(seatId)
      if (seat) return seat
    }
    const allSeats = this.catalog ? this.catalog.listAllSeats() : [...this.seats.values()]
    const sidStr = String(sessionId)
    for (const seat of allSeats) {
      const activeMatches = seat.activeInstanceId !== undefined && String(seat.activeInstanceId) === sidStr
      if (seat.runtimeInstances.some(inst => String(inst) === sidStr) || activeMatches) {
        this.sessionToSeat.set(sidStr, seat.id)
        this.sessionToTeam.set(sidStr, seat.teamId)
        return seat
      }
    }
    return undefined
  }

  /**
   * Synchronously resolve the team ID associated with a session, if any.
   * @param sessionId - session identifier.
   * @returns team definition ID or undefined.
   */
  getTeamIdBySessionSync(sessionId: SessionId | string): TeamDefinitionId | undefined {
    const seat = this.getSeatBySessionSync(sessionId)
    if (seat?.teamId) return seat.teamId
    const sid = String(sessionId)
    const direct = this.sessionToTeam.get(sid)
    if (direct) return direct
    for (const team of this.teams.values()) {
      if (team.leadSessionId && String(team.leadSessionId) === sid) {
        this.sessionToTeam.set(sid, team.id)
        return team.id
      }
    }
    return undefined
  }

  /**
   * Resolves the effective route for a session according to the frozen precedence:
   * explicit conversation override -> seat override -> profile default.
   * @param sessionId - session identifier.
   * @returns resolved route snapshot with source revisions, or undefined.
   */
  resolveEffectiveRoute(sessionId: SessionId | string): CapturedRoute | undefined {
    const conv = this.getConversationBySessionSync(sessionId)
    const seat = this.getSeatBySessionSync(sessionId)
    const profile = (conv ? this.getProfileSync(conv.profileId) : undefined) ?? (seat ? this.getProfileSync(seat.profileId) : undefined)

    if (!conv && !seat) return undefined
    if (!profile) return undefined

    const seatId = this.sessionToSeat.get(String(sessionId)) ?? seat?.id
    const seatOverride = seatId ? this.seatOverrides.get(seatId) : undefined
    const effectiveSeatOverride = seatOverride ?? seat?.modelOverride
    const seatRev = seatId ? this.seatRevisions.get(seatId) : undefined

    if (conv?.modelOverride !== undefined) {
      return {
        route: conv.modelOverride,
        source: 'conversation',
        conversationRevision: conv.modelCheckpoint ?? conv.updatedAt,
        profileRevision: profile.revision,
        ...(seatRev !== undefined ? { seatRevision: seatRev } : {}),
      }
    }

    if (effectiveSeatOverride !== undefined) {
      return {
        route: effectiveSeatOverride,
        source: 'seat',
        ...(conv !== undefined ? { conversationRevision: conv.modelCheckpoint ?? conv.updatedAt } : {}),
        profileRevision: profile.revision,
        ...(seatRev !== undefined ? { seatRevision: seatRev } : {}),
      }
    }

    if (profile.defaultModel !== undefined) {
      return {
        route: profile.defaultModel,
        source: 'profile',
        ...(conv !== undefined ? { conversationRevision: conv.modelCheckpoint ?? conv.updatedAt } : {}),
        profileRevision: profile.revision,
        ...(seatRev !== undefined ? { seatRevision: seatRev } : {}),
      }
    }

    return undefined
  }

  /**
   * Stores the captured route snapshot for an in-flight request.
   * @param sessionId - target session identifier.
   * @param captured - immutable captured route snapshot.
   */
  captureRouteForRequest(sessionId: SessionId | string, captured: CapturedRoute): void {
    this.capturedRoutes.set(String(sessionId), captured)
  }

  /**
   * Retrieves the captured route snapshot for an in-flight request.
   * @param sessionId - target session identifier.
   * @returns captured route snapshot if present.
   */
  getCapturedRoute(sessionId: SessionId | string): CapturedRoute | undefined {
    return this.capturedRoutes.get(String(sessionId))
  }

  /**
   * Clears the captured route snapshot for a session.
   * @param sessionId - target session identifier.
   */
  clearCapturedRoute(sessionId: SessionId | string): void {
    this.capturedRoutes.delete(String(sessionId))
  }

  /**
   * Records user messages entering the step for capability inspection.
   * @param sessionId - target session identifier.
   * @param messages - step user messages to record.
   */
  recordStepMessages(sessionId: SessionId | string, messages: readonly UserMessage[]): void {
    this.stepMessages.set(String(sessionId), messages)
  }

  /**
   * Checks whether the current step or session history carries images.
   * @param sessionId - session identifier.
   * @param session - live Session instance.
   * @returns true if any message carries image content.
   */
  requestCarriesImages(sessionId: SessionId | string, session: Session): boolean {
    const historyMessages = session.deriveMessages()
    if (historyMessages.some(m => contentHasImage(m.content))) {
      return true
    }
    const stepMsgs = this.stepMessages.get(String(sessionId)) ?? []
    return stepMsgs.some(m => contentHasImage(m.content))
  }

  /**
   * Synchronously retrieve a team definition by identifier.
   * @param id - team definition identifier.
   * @returns team definition if found.
   */
  getTeamSync(id: TeamDefinitionId): TeamDefinition | undefined {
    if (this.catalog) {
      return this.catalog.getTeam(id)
    }
    return this.teams.get(id)
  }

  /**
   * Synchronously retrieve a team seat by identifier.
   * @param id - team seat identifier.
   * @returns team seat if found.
   */
  getSeatSync(id: TeamSeatId): TeamSeat | undefined {
    if (this.catalog) {
      return this.catalog.getSeat(id)
    }
    return this.seats.get(id)
  }

  /**
   * Compute effective capabilities for a session via strict intersection of deployment, conversation,
   * profile, team, and seat policies. Role or duty text can never widen permissions.
   * @param sessionId - target session identifier.
   * @returns effective capabilities policy.
   */
  getEffectiveCapabilities(sessionId: SessionId | string): EffectiveCapabilities {
    const conv = this.getConversationBySessionSync(sessionId)
    const profileFromConv = conv ? this.getProfileSync(conv.profileId) : undefined

    const seatId = this.sessionToSeat.get(String(sessionId))
    const seat = seatId ? this.getSeatSync(seatId) : undefined
    const profileFromSeat = seat ? this.getProfileSync(seat.profileId) : undefined

    const profile = profileFromConv ?? profileFromSeat

    const teamId = this.sessionToTeam.get(String(sessionId)) ?? seat?.teamId
    const team = teamId ? this.getTeamSync(teamId) : undefined

    return intersectCapabilities(
      this.deploymentCapabilityCeiling(),
      conv?.capabilities,
      profile?.capabilities,
      team?.capabilities,
      seat?.capabilities,
    )
  }

  /**
   * Build the deployment-wide capability ceiling from the validated configuration.
   * @returns deployment capability policy, empty when nothing is configured.
   */
  private deploymentCapabilityCeiling(): CapabilityPolicy {
    const allowedTools = this.config.deploymentAllowedTools
    const disallowedTools = this.config.deploymentDisallowedTools
    const allowedPaths = this.config.deploymentAllowedPaths
    return {
      ...(allowedTools !== undefined && allowedTools.length > 0 ? { allowedTools } : {}),
      ...(disallowedTools !== undefined && disallowedTools.length > 0 ? { disallowedTools } : {}),
      ...(allowedPaths !== undefined && allowedPaths.length > 0 ? { allowedPaths } : {}),
      ...(this.config.deploymentAllowTerminal === false ? { allowTerminal: false } : {}),
      ...(this.config.deploymentAllowSubagents === false ? { allowSubagents: false } : {}),
    }
  }

  /**
   * List the sessions one binding may read: a private conversation reads only itself; a team member
   * reads its team's lead and seat instances.
   * @param sessionId - caller session identifier.
   * @returns permitted sessions, or undefined when the caller has no assistant binding.
   */
  allowedSessionsFor(sessionId: SessionId | string): readonly SessionId[] | undefined {
    const conv = this.getConversationBySessionSync(sessionId)
    if (conv) return [conv.rootSessionId]

    const seatId = this.sessionToSeat.get(String(sessionId))
    const seat = seatId ? this.getSeatSync(seatId) : this.getSeatBySessionSync(sessionId)
    if (!seat) return undefined

    const permitted = new Set<string>([String(seat.activeInstanceId ?? ''), ...seat.runtimeInstances.map(String)])
    const team = this.getTeamSync(seat.teamId)
    if (team?.leadSessionId) permitted.add(String(team.leadSessionId))
    for (const sibling of this.listSeatsSync(seat.teamId)) {
      for (const instance of sibling.runtimeInstances) permitted.add(String(instance))
      if (sibling.activeInstanceId) permitted.add(String(sibling.activeInstanceId))
    }
    permitted.delete('')
    return [...permitted].map(id => SessionId(id))
  }

  /**
   * Authorize one session-history target for a calling session.
   * Providers and tool guards consult this authority; a provider that cannot enforce the restriction
   * must mark the capability unavailable instead of claiming isolation.
   * @param callerSessionId - caller session identifier.
   * @param targetSessionId - referenced session identifier.
   * @returns true when permitted, false when denied, undefined when the caller has no session scope.
   */
  authorizeSessionSource(callerSessionId: SessionId | string, targetSessionId: SessionId | string): boolean | undefined {
    const allowed = this.allowedSessionsFor(callerSessionId)
    if (allowed === undefined) return undefined
    if (String(callerSessionId) === String(targetSessionId)) return true
    try {
      assertScopeAccess(SessionId(String(targetSessionId)), allowed, `session history visible to '${callerSessionId}'`)
      return true
    } catch {
      return false
    }
  }

  /**
   * Bind a runtime session identifier to a team seat.
   * @param seatId - target seat identifier.
   * @param sessionId - runtime session identifier.
   */
  async bindSeatSession(seatId: TeamSeatId, sessionId: SessionId): Promise<void> {
    await this.ensureCatalogReady()
    this.sessionToSeat.set(String(sessionId), seatId)
    const seat = this.getSeatSync(seatId)
    if (seat) {
      this.sessionToTeam.set(String(sessionId), seat.teamId)
      const updatedInstances = seat.runtimeInstances.includes(sessionId) ? seat.runtimeInstances : [...seat.runtimeInstances, sessionId]
      if (this.catalog) {
        const updated = await this.catalog.updateSeat(seatId, {
          ...(seat.runtimeInstances.includes(sessionId) ? {} : { appendInstanceId: sessionId }),
          activeInstanceId: sessionId,
        })
        this.seats.set(seatId, updated)
      } else {
        this.seats.set(seatId, {
          ...seat,
          runtimeInstances: updatedInstances,
          activeInstanceId: sessionId,
          updatedAt: Date.now(),
        })
      }
      if (this.agents) {
        const liveAgent = this.agents.get(sessionId)
        if (liveAgent) {
          this.roleInstaller.maybeInstall(liveAgent)
          this.memoryInstaller.maybeInstall(liveAgent)
        }
      }
    }
  }

  /**
   * Set or clear a team seat's model override.
   * @param seatId - team seat identifier.
   * @param model - model selection override.
   * @param revision - optional checkpoint revision.
   * @returns updated team seat if found.
   */
  async setSeatModelOverride(
    seatId: TeamSeatId,
    model?: AssistantModelSelection | ModelSelection,
    revision?: number,
  ): Promise<TeamSeat | undefined> {
    await this.ensureCatalogReady()
    const existing = this.getSeatSync(seatId)
    if (existing?.retiredAt !== undefined) {
      throw new Error(`Cannot update retired team seat '${seatId}'`)
    }
    if (model !== undefined) {
      await this.validateRoute(model)
    }

    let updated: TeamSeat | undefined
    if (this.catalog && existing) {
      updated = await this.catalog.updateSeat(seatId, { modelOverride: model })
      this.seats.set(seatId, updated)
    } else if (existing) {
      updated = {
        ...existing,
        modelOverride: model,
        updatedAt: Date.now(),
      }
      this.seats.set(seatId, updated)
    }

    if (model !== undefined) this.seatOverrides.set(seatId, model)
    else this.seatOverrides.delete(seatId)
    this.seatRevisions.set(seatId, revision ?? (this.seatRevisions.get(seatId) ?? 0) + 1)

    for (const [sessionId, boundSeatId] of this.sessionToSeat.entries()) {
      if (boundSeatId === seatId) {
        this.syncAgentSelection(sessionId)
      }
    }
    return updated
  }

  /**
   * Bind a session to a team seat for seat-level routing.
   * @param sessionId - session identifier.
   * @param seatId - team seat identifier.
   */
  bindSessionToSeat(sessionId: SessionId | string, seatId: TeamSeatId): void {
    this.sessionToSeat.set(String(sessionId), seatId)
  }

  /**
   * List all non-archived assistant profiles, or all profiles including archived ones.
   * @param includeArchived - whether to include archived profiles.
   * @returns list of matching assistant profiles.
   */
  async listProfiles(includeArchived: boolean = false): Promise<readonly AssistantProfile[]> {
    await this.ensureCatalogReady()
    if (this.catalog) {
      return this.catalog.listProfiles(includeArchived)
    }
    const all = [...this.profiles.values()].filter(p => p.deletedAt === undefined)
    return includeArchived ? all : all.filter(p => p.archivedAt === undefined)
  }

  /**
   * Retrieve an assistant profile by identifier.
   * @param id - profile identifier.
   * @returns profile if found, otherwise undefined.
   */
  async getProfile(id: AssistantProfileId): Promise<AssistantProfile | undefined> {
    await this.ensureCatalogReady()
    if (this.catalog) {
      return this.catalog.getProfile(id)
    }
    return this.profiles.get(id)
  }

  /**
   * Synchronously retrieve an assistant profile by identifier.
   * @param id - profile identifier.
   * @returns profile if found, otherwise undefined.
   */
  getProfileSync(id: AssistantProfileId): AssistantProfile | undefined {
    if (this.catalog) {
      return this.catalog.getProfile(id)
    }
    return this.profiles.get(id)
  }

  /**
   * Resolve the profile behind one session's binding: its private conversation first, then its team seat.
   * @param sessionId - session identifier.
   * @returns bound profile if the session belongs to an assistant conversation or a team seat.
   */
  getBoundProfileSync(sessionId: SessionId | string): AssistantProfile | undefined {
    const conv = this.getConversationBySessionSync(sessionId)
    if (conv) return this.getProfileSync(conv.profileId)
    const seat = this.getSeatBySessionSync(sessionId)
    return seat ? this.getProfileSync(seat.profileId) : undefined
  }

  /**
   * Read the application default model selection when no profile default was chosen.
   * @returns selection from the app default model service, or undefined when unavailable.
   */
  private appDefaultModelSelection(): AssistantModelSelection | undefined {
    const service = this.ctx.get('agentDefaultModel') as
      | {
        currentSelection?: () => { provider: string; model: string; reasoningEffort?: string } | undefined
      }
      | undefined
    const selection = service?.currentSelection?.()
    if (selection === undefined) return undefined
    return {
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort !== undefined ? { reasoningEffort: selection.reasoningEffort } : {}),
    }
  }

  /**
   * Create a new persistent assistant profile.
   * @param options - creation options.
   * @returns the created assistant profile.
   */
  async createProfile(options: CreateAssistantProfileOptions): Promise<AssistantProfile> {
    await this.ensureCatalogReady()
    // A profile created without an explicit model captures the application default, so its route stays
    // stable when the application default later changes.
    const defaultModel = options.defaultModel ?? this.appDefaultModelSelection()
    const resolved: CreateAssistantProfileOptions = defaultModel === undefined ? options : { ...options, defaultModel }
    if (defaultModel !== undefined) {
      await this.validateRoute(defaultModel)
    }
    let profile: AssistantProfile
    if (this.catalog) {
      profile = await this.catalog.createProfile(resolved)
    } else {
      const id = AssistantProfileId(options.id ?? `asst-${Math.random().toString(36).slice(2, 10)}`)
      if (this.profiles.has(id)) {
        throw new Error(`Assistant profile ${id} already exists`)
      }
      const now = Date.now()
      profile = {
        id,
        name: options.name,
        avatar: options.avatar,
        responsibility: options.responsibility,
        instructions: options.instructions,
        ...(options.capabilities !== undefined ? { capabilities: options.capabilities } : {}),
        revision: 1,
        defaultModel,
        createdAt: now,
        updatedAt: now,
      }
    }
    this.profiles.set(profile.id, profile)
    return profile
  }

  /**
   * Update an existing assistant profile.
   * @param id - profile identifier.
   * @param options - updated fields.
   * @param expectedRevision - optional expected revision guard.
   * @returns updated assistant profile.
   */
  async updateProfile(
    id: AssistantProfileId,
    options: UpdateAssistantProfileOptions,
    expectedRevision?: number,
  ): Promise<AssistantProfile> {
    await this.ensureCatalogReady()
    const existing = this.getProfileSync(id)
    if (!existing) {
      throw new Error(`Assistant profile ${id} not found`)
    }
    if (options.defaultModel !== undefined) {
      await this.validateRoute(options.defaultModel)
    }
    if (existing.deletedAt !== undefined) throw new Error('Assistant profile was permanently deleted')
    let updated: AssistantProfile
    if (this.catalog) {
      updated = await this.catalog.updateProfile(id, options, expectedRevision)
    } else {
      updated = {
        ...existing,
        name: options.name ?? existing.name,
        avatar: options.avatar !== undefined ? options.avatar : existing.avatar,
        responsibility: options.responsibility ?? existing.responsibility,
        instructions: options.instructions !== undefined ? options.instructions : existing.instructions,
        capabilities: options.capabilities !== undefined ? options.capabilities : existing.capabilities,
        defaultModel: options.defaultModel !== undefined ? options.defaultModel : existing.defaultModel,
        revision: existing.revision + 1,
        updatedAt: Date.now(),
      }
    }
    this.profiles.set(id, updated)
    for (const conv of this.conversations.values()) {
      if (conv.profileId === id) {
        this.syncAgentSelection(conv.rootSessionId)
      }
    }
    return updated
  }

  /**
   * Soft-archive an assistant profile.
   * @param id - profile identifier.
   */
  async archiveProfile(id: AssistantProfileId): Promise<void> {
    await this.ensureCatalogReady()
    const existing = this.getProfileSync(id)
    if (!existing) {
      throw new Error(`Assistant profile ${id} not found`)
    }
    if (existing.archivedAt !== undefined) return
    let updated: AssistantProfile
    if (this.catalog) {
      updated = await this.catalog.archiveProfile(id)
    } else {
      updated = {
        ...existing,
        archivedAt: Date.now(),
        updatedAt: Date.now(),
      }
    }
    this.profiles.set(id, updated)
  }

  /**
   * Unarchive an assistant profile.
   * @param id - profile identifier.
   */
  async unarchiveProfile(id: AssistantProfileId): Promise<void> {
    await this.ensureCatalogReady()
    const existing = this.getProfileSync(id)
    if (!existing) {
      throw new Error(`Assistant profile ${id} not found`)
    }
    if (existing.archivedAt === undefined) return
    if (existing.deletedAt !== undefined) throw new Error('Assistant profile was permanently deleted')
    let updated: AssistantProfile
    if (this.catalog) {
      updated = await this.catalog.unarchiveProfile(id)
    } else {
      const { archivedAt: _archivedAt, ...rest } = existing
      updated = {
        ...rest,
        revision: existing.revision + 1,
        updatedAt: Date.now(),
      }
    }
    this.profiles.set(id, updated)
  }

  /**
   * Reject execution during lifecycle changes or after irreversible deletion.
   * @param sessionId - Session about to assemble or execute a model request.
   */
  assertSessionUsable(sessionId: SessionId): void {
    const conv = this.getConversationBySessionSync(sessionId)
    const seat = this.getSeatBySessionSync(sessionId)
    const teamId = this.getTeamIdBySessionSync(sessionId)
    const profileId = conv?.profileId ?? seat?.profileId
    if (this.lifecycleChanges.has(String(sessionId))
      || (profileId && this.lifecycleChanges.has(profileId))
      || (teamId && this.lifecycleChanges.has(teamId))) throw new Error('Assistant configuration is changing')
    if (profileId && this.getProfileSync(profileId)?.deletedAt !== undefined) {
      throw new Error('Assistant was permanently deleted; start an ordinary conversation to continue')
    }
    if (teamId && this.getTeamSync(teamId)?.deletedAt !== undefined) throw new Error('Team was permanently deleted')
  }

  private assertSessionIdle(sessionId: SessionId): void {
    const agent = this.agents?.get(sessionId)
    if (agent && (agent.status !== 'idle' || agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.length > 0)) {
      throw new Error('Stop the running task before changing this assistant')
    }
  }

  /**
   * Unbind only an idle, pristine private Session; historical conversations keep their identity.
   * @param sessionId - live blank Session whose assistant selection is cancelled.
   */
  @Remote('clearConversationBinding')
  async clearConversationBinding(sessionId: SessionId): Promise<void> {
    await this.ensureCatalogReady()
    if (this.lifecycleChanges.has(sessionId)) throw new Error('Assistant configuration is changing')
    this.lifecycleChanges.add(sessionId)
    try {
      const conv = this.getConversationBySessionSync(sessionId)
      if (!conv) return
      if (this.getTeamIdBySessionSync(sessionId)) throw new Error('Team Sessions cannot be unbound')
      this.assertSessionIdle(sessionId)
      const query = this.ctx.get('sessionQuery')
      if (!query || !this.sessions?.get(sessionId)) throw new Error('Cannot verify a blank live Session')
      const observation = await query.observeSession(sessionId)
      try {
        if (observation.events.some(e => e.type === 'turn/start' || e.type === 'user/message'
          || e.type === 'request/header' || e.type === 'system/message')) {
          throw new Error('Start a new ordinary conversation to preserve existing history')
        }
      } finally { observation[Symbol.dispose]() }
      this.assertSessionIdle(sessionId)
      if (this.catalog) await this.catalog.deleteConversationBinding(conv.id)
      this.conversations.delete(conv.id)
      this.conversationBySession.delete(String(sessionId))
      this.capturedRoutes.delete(String(sessionId))
      this.stepMessages.delete(String(sessionId))
      this.reviewPredictions.cancelSession(sessionId)
    } finally { this.lifecycleChanges.delete(sessionId) }
  }

  /**
   * Permanently remove reusable assistant configuration while retaining historical Session logs.
   * @param id - confirmed profile identifier.
   * @param expectedRevision - revision displayed at confirmation.
   */
  @Remote('deleteProfile')
  async deleteProfile(id: AssistantProfileId, expectedRevision: number): Promise<void> {
    await this.ensureCatalogReady()
    if (!this.catalog) throw new Error('Permanent deletion requires the durable assistant catalog')
    if (this.lifecycleChanges.has(id)) throw new Error('Assistant configuration is changing')
    this.lifecycleChanges.add(id)
    try {
      for (const conv of this.conversations.values()) {
        if (conv.profileId === id) this.assertSessionIdle(conv.rootSessionId)
      }
      const deleted = await this.catalog.deleteProfile(id, expectedRevision)
      this.profiles.set(id, deleted)
      for (const conv of this.conversations.values()) {
        if (conv.profileId === id) this.reviewPredictions.cancelSession(conv.rootSessionId)
      }
      for (const seat of this.seats.values()) {
        if (seat.profileId === id) {
          for (const sessionId of seat.runtimeInstances) this.reviewPredictions.cancelSession(sessionId)
        }
      }
      for (const [key, entry] of this.memories) {
        if (entry.scope.kind === 'profile' && entry.scope.profileId === id) this.memories.delete(key)
      }
    } finally { this.lifecycleChanges.delete(id) }
  }

  /**
   * Permanently remove team configuration after all owned work has stopped.
   * @param id - confirmed team identifier.
   * @param expectedRevision - revision displayed at confirmation.
   */
  @Remote('deleteTeam')
  async deleteTeam(id: TeamDefinitionId, expectedRevision: number): Promise<void> {
    await this.ensureCatalogReady()
    if (!this.catalog) throw new Error('Permanent deletion requires the durable assistant catalog')
    if (this.lifecycleChanges.has(id)) throw new Error('Team configuration is changing')
    this.lifecycleChanges.add(id)
    try {
      const team = this.getTeamSync(id)
      if (team?.leadSessionId) this.assertSessionIdle(team.leadSessionId)
      for (const seat of this.listSeatsSync(id)) {
        for (const session of seat.runtimeInstances) this.assertSessionIdle(session)
        if (seat.activeInstanceId) this.assertSessionIdle(seat.activeInstanceId)
      }
      for (const discussion of this.roundScheduler.listDiscussions(id)) {
        if (this.roundScheduler.journal.getActiveRound(discussion.id)) throw new Error('Stop the active team round before deleting')
      }
      const deleted = await this.catalog.deleteTeam(id, expectedRevision)
      this.teams.set(id, deleted)
      if (team?.leadSessionId) this.reviewPredictions.cancelSession(team.leadSessionId)
      for (const seat of this.listSeatsSync(id)) {
        for (const sessionId of seat.runtimeInstances) this.reviewPredictions.cancelSession(sessionId)
      }
      for (const [key, entry] of this.memories) {
        if (entry.scope.kind === 'team' && entry.scope.teamId === id) this.memories.delete(key)
      }
    } finally { this.lifecycleChanges.delete(id) }
  }

  /**
   * List conversations associated with an assistant profile, or all conversations.
   * @param profileId - optional profile identifier filter.
   * @param includeArchived - whether to include archived conversations (defaults to false).
   * @returns list of matching conversation bindings.
   */
  async listConversations(profileId?: AssistantProfileId, includeArchived: boolean = false): Promise<readonly AssistantConversation[]> {
    await this.ensureCatalogReady()
    if (this.catalog) {
      return this.catalog.listConversations(profileId, includeArchived)
    }
    let all = [...this.conversations.values()]
    if (profileId !== undefined) {
      all = all.filter(c => c.profileId === profileId)
    }
    return includeArchived ? all : all.filter(c => c.archivedAt === undefined)
  }

  /**
   * Retrieve an assistant conversation binding by its identifier.
   * @param id - conversation binding identifier.
   * @returns conversation binding if found.
   */
  async getConversation(id: AssistantConversationId): Promise<AssistantConversation | undefined> {
    await this.ensureCatalogReady()
    if (this.catalog) {
      return this.catalog.getConversation(id)
    }
    return this.conversations.get(id)
  }

  /**
   * Retrieve an assistant conversation binding by its root session identifier.
   * @param sessionId - root session identifier.
   * @returns conversation binding if found.
   */
  async getConversationBySession(sessionId: SessionId): Promise<AssistantConversation | undefined> {
    await this.ensureCatalogReady()
    return this.getConversationBySessionSync(sessionId)
  }

  /**
   * Create an assistant conversation binding for a root session, or allocate a fresh session.
   * If rootSessionId is omitted, allocates a fresh session through the official SessionController.
   * @param profileId - assistant profile identifier.
   * @param rootSessionIdOrOptions - session identifier or creation options.
   * @param options - optional binding parameters if rootSessionId was passed as second argument.
   * @returns created conversation binding.
   */
  async createConversation(
    profileId: AssistantProfileId,
    rootSessionIdOrOptions?: SessionId | CreateAssistantConversationOptions,
    options?: CreateAssistantConversationOptions,
  ): Promise<AssistantConversation> {
    await this.ensureCatalogReady()
    const profile = this.getProfileSync(profileId)
    if (!profile) {
      throw new Error(`Assistant profile ${profileId} not found`)
    }
    if (profile.archivedAt !== undefined) {
      throw new Error(`Cannot create conversation for archived assistant profile ${profileId}`)
    }

    let rootSessionId: SessionId | undefined
    let opts: CreateAssistantConversationOptions = {}
    if (typeof rootSessionIdOrOptions === 'string') {
      rootSessionId = rootSessionIdOrOptions
      if (options) opts = options
    } else if (typeof rootSessionIdOrOptions === 'object') {
      opts = rootSessionIdOrOptions
      rootSessionId = opts.rootSessionId
    } else if (options) {
      opts = options
      rootSessionId = opts.rootSessionId
    }

    if (rootSessionId === undefined) {
      if (this.sessionController) {
        const created = await this.sessionController.create({
          ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
        })
        rootSessionId = created.sessionId
      } else {
        rootSessionId = SessionId(randomUUID())
      }
    }

    if (opts.modelOverride !== undefined) {
      await this.validateRoute(opts.modelOverride)
    }

    this.assertSessionUsable(rootSessionId)
    if (this.lifecycleChanges.has(profileId) || this.getProfileSync(profileId)?.deletedAt !== undefined) {
      throw new Error('Assistant configuration is unavailable')
    }
    const boundExisting = this.conversationBySession.get(String(rootSessionId))
    if (boundExisting) {
      throw new Error(`Session ${rootSessionId} is already bound to conversation ${boundExisting}`)
    }

    const liveSession = this.sessions?.get(rootSessionId)
    const checkpoint = liveSession ? Math.max(-1, liveSession.seq - 1) : -1

    const id = AssistantConversationId(opts.id ?? `asst-conv-${randomUUID().slice(0, 8)}`)
    const now = Date.now()
    let conversation: AssistantConversation = {
      id,
      profileId,
      rootSessionId,
      ...(opts.title !== undefined ? { title: opts.title } : {}),
      ...(opts.modelOverride !== undefined ? { modelOverride: opts.modelOverride } : {}),
      ...(opts.capabilities !== undefined ? { capabilities: opts.capabilities } : {}),
      modelCheckpoint: checkpoint,
      createdAt: now,
      updatedAt: now,
    }

    if (this.catalog) {
      conversation = await this.catalog.createConversation(conversation)
    }

    this.conversations.set(id, conversation)
    this.conversationBySession.set(String(rootSessionId), id)

    if (this.agents) {
      const liveAgent = this.agents.get(rootSessionId)
      if (liveAgent) {
        this.roleInstaller.maybeInstall(liveAgent)
        this.memoryInstaller.maybeInstall(liveAgent)
      }
    }
    this.syncAgentSelection(rootSessionId)

    if (opts.modelOverride === undefined && this.sessionPersistence) {
      conversation = await this.seedConversationFromPersistence(id)
    }

    return conversation
  }

  /**
   * Start a new topic (allocating a fresh root session) for an assistant profile.
   * @param profileId - assistant profile identifier.
   * @param options - optional creation options.
   * @returns newly created assistant conversation binding.
   */
  async startNewTopic(profileId: AssistantProfileId, options: CreateAssistantConversationOptions = {}): Promise<AssistantConversation> {
    await this.ensureCatalogReady()
    return await this.createConversation(profileId, options)
  }

  /**
   * Set or update explicit conversation-scoped model override.
   * @param id - conversation identifier.
   * @param model - model selection override.
   * @param checkpoint - optional replay sequence checkpoint.
   * @returns updated conversation binding.
   */
  async setConversationModelOverride(
    id: AssistantConversationId,
    model?: AssistantModelSelection,
    checkpoint?: number,
  ): Promise<AssistantConversation> {
    await this.ensureCatalogReady()
    const existing = this.conversations.get(id)
    if (!existing) {
      throw new Error(`Assistant conversation ${id} not found`)
    }
    if (existing.archivedAt !== undefined) {
      throw new Error(`Cannot update archived assistant conversation ${id}`)
    }
    if (model !== undefined) {
      await this.validateRoute(model)
    }
    let effectiveCheckpoint = checkpoint
    if (effectiveCheckpoint === undefined) {
      const liveSession = this.sessions?.get(existing.rootSessionId)
      effectiveCheckpoint = liveSession ? Math.max(-1, liveSession.seq - 1) : (existing.modelCheckpoint ?? -1)
    }
    let updated: AssistantConversation = {
      ...existing,
      modelOverride: model,
      modelCheckpoint: effectiveCheckpoint,
      updatedAt: Date.now(),
    }
    if (this.catalog) {
      updated = await this.catalog.updateConversation(id, {
        modelOverride: model,
        modelCheckpoint: effectiveCheckpoint,
      })
    }
    this.conversations.set(id, updated)
    this.syncAgentSelection(updated.rootSessionId)
    return updated
  }

  /**
   * Atomically clear conversation-scoped model override and advance replay checkpoint.
   * @param id - conversation identifier.
   * @param checkpoint - optional explicit sequence checkpoint.
   * @returns updated conversation binding inheriting from profile/seat.
   */
  async clearConversationModelOverride(id: AssistantConversationId, checkpoint?: number): Promise<AssistantConversation> {
    await this.ensureCatalogReady()
    const existing = this.conversations.get(id)
    if (!existing) {
      throw new Error(`Assistant conversation ${id} not found`)
    }
    if (existing.archivedAt !== undefined) {
      throw new Error(`Cannot clear override on archived assistant conversation ${id}`)
    }
    let effectiveCheckpoint = checkpoint
    if (effectiveCheckpoint === undefined) {
      const liveSession = this.sessions?.get(existing.rootSessionId)
      effectiveCheckpoint = liveSession ? Math.max(-1, liveSession.seq - 1) : (existing.modelCheckpoint ?? -1)
    }
    let updated: AssistantConversation = {
      ...existing,
      modelOverride: undefined,
      modelCheckpoint: effectiveCheckpoint,
      updatedAt: Date.now(),
    }
    if (this.catalog) {
      updated = await this.catalog.updateConversation(id, {
        modelOverride: undefined,
        modelCheckpoint: effectiveCheckpoint,
      })
    }
    this.conversations.set(id, updated)
    this.syncAgentSelection(updated.rootSessionId)
    return updated
  }

  /**
   * Soft-archive an assistant conversation binding record.
   * @param id - conversation identifier.
   * @returns archived conversation binding.
   */
  async archiveConversation(id: AssistantConversationId): Promise<AssistantConversation> {
    await this.ensureCatalogReady()
    const existing = this.conversations.get(id)
    if (!existing) {
      throw new Error(`Assistant conversation ${id} not found`)
    }
    if (existing.archivedAt !== undefined) {
      return existing
    }
    let updated: AssistantConversation
    if (this.catalog) {
      updated = await this.catalog.archiveConversation(id)
    } else {
      updated = {
        ...existing,
        archivedAt: Date.now(),
        updatedAt: Date.now(),
      }
    }
    this.conversations.set(id, updated)
    return updated
  }

  /**
   * Seed conversation model override from durable model/selection events on the session.
   * Respects replay checkpoint: only events strictly newer than modelCheckpoint are eligible.
   * @param id - conversation identifier.
   * @param persistence - optional session persistence instance (defaults to ctx.sessionPersistence).
   * @param signal - optional cancellation signal.
   * @returns conversation binding with updated override if eligible events were found.
   */
  async seedConversationFromPersistence(
    id: AssistantConversationId,
    persistence?: SessionPersistence,
    signal?: AbortSignal,
  ): Promise<AssistantConversation> {
    await this.ensureCatalogReady()
    const conv = this.conversations.get(id)
    if (!conv) {
      throw new Error(`Assistant conversation ${id} not found`)
    }
    const store = persistence ?? this.sessionPersistence
    if (!store) {
      return conv
    }

    try {
      const { events } = await readPersistedSession(store, conv.rootSessionId, signal)
      const checkpoint = conv.modelCheckpoint ?? -1
      const eligible = events.filter(e => e.type === 'model/selection' && e.seq > checkpoint)
      const latest = eligible.at(-1)
      if (latest !== undefined) {
        const selection = latest.data as ModelSelection
        return await this.setConversationModelOverride(id, selection, latest.seq)
      }
    } catch {
      // If session is not yet persisted or unreadable, retain current state
    }
    return conv
  }

  /**
   * List all permitted session identifiers for active conversations of a profile, or all profiles.
   * Excludes archived conversations and conversations whose profile is archived.
   * @param profileId - optional profile identifier filter.
   * @param includeArchived - whether to include archived conversations and profiles.
   * @returns array of permitted SessionId instances.
   */
  async listPermittedSessions(profileId?: AssistantProfileId, includeArchived: boolean = false): Promise<readonly SessionId[]> {
    await this.ensureCatalogReady()
    const allProfiles = await this.listProfiles(includeArchived)
    const activeProfileIds = new Set(allProfiles.map(p => p.id))

    const convs = await this.listConversations(profileId, includeArchived)
    return convs.filter(c => includeArchived || activeProfileIds.has(c.profileId)).map(c => c.rootSessionId)
  }

  /**
   * Synchronizes the effective route to SessionController's in-memory selection reference
   * if SessionController is available and the session is active.
   * @param sessionId - target session identifier.
   */
  syncAgentSelection(sessionId: SessionId | string): void {
    if (!this.agents) return
    const agent = this.agents.get(sessionId as SessionId)
    if (!agent) return
    const effective = this.resolveEffectiveRoute(sessionId)
    if (!effective) return

    const sc = this.sessionController
    if (!sc) return
    const agents = Reflect.get(sc, 'agents') as
      | {
        selectionFor?: (a: Agent) => { current?: ModelSelection | undefined; assembled?: ModelSelection | undefined }
      }
      | undefined
    if (agents?.selectionFor) {
      try {
        const selectionRef = agents.selectionFor(agent)
        {
          selectionRef.current = {
            provider: effective.route.provider,
            model: effective.route.model,
            ...(effective.route.reasoningEffort !== undefined
              ? { reasoningEffort: ReasoningEffortId(effective.route.reasoningEffort) }
              : {}),
          }
          selectionRef.assembled = undefined
        }
      } catch {
        // Ignore if projection not initialized
      }
    }
  }

  /**
   * Clears assembled selection on the agent's installed selection reference
   * to prevent duplicate or false switch notices from the official listener.
   * @param sessionId - target session identifier.
   */
  clearAssembledSelection(sessionId: SessionId | string): void {
    if (!this.agents) return
    const agent = this.agents.get(sessionId as SessionId)
    if (!agent) return

    const sc = this.sessionController
    if (!sc) return
    const agents = Reflect.get(sc, 'agents') as
      | {
        selectionFor?: (a: Agent) => { current?: ModelSelection | undefined; assembled?: ModelSelection | undefined }
      }
      | undefined
    if (agents?.selectionFor) {
      try {
        const selectionRef = agents.selectionFor(agent)
        selectionRef.assembled = undefined
      } catch {
        // Ignore if projection not initialized
      }
    }
  }

  /**
   * Submit a prompt through the assistant submission operation.
   *
   * Ordering and admission invariants (Step S5):
   * 1. Resolves effective route for the session.
   * 2. Validates route against served catalog (throws immediately if unavailable/invalid).
   * 3. Validates modality: if prompt carries images, verifies effective route has 'image' input modality.
   *    Rejects visibly before admission with UNSUPPORTED_CONTENT if not.
   * 4. Synchronizes effective route to agent selection controller.
   * 5. Delegates to official SessionController.prompt.
   *
   * @param request - prompt request.
   * @param signal - optional cancellation signal.
   * @returns acknowledgement from SessionController.
   */
  async submitPrompt(request: SessionPromptRequest, signal?: AbortSignal): Promise<SessionPromptValue> {
    await this.ensureCatalogReady()
    this.assertSessionUsable(request.sessionId)
    const conv = this.getConversationBySessionSync(request.sessionId)
    if (conv) {
      if (conv.archivedAt !== undefined) {
        throw new Error(`Cannot submit prompt to archived assistant conversation '${conv.id}'`)
      }
      const profile = this.getProfileSync(conv.profileId)
      if (profile?.archivedAt !== undefined) {
        throw new Error(`Cannot submit prompt to archived assistant profile '${profile.id}'`)
      }
    }

    const teamId = this.sessionToTeam.get(String(request.sessionId))
    if (teamId) {
      const team = this.getTeamSync(teamId)
      if (team?.archivedAt !== undefined) {
        throw new Error(`Cannot submit prompt to archived team '${team.id}'`)
      }
    }

    const seatId = this.sessionToSeat.get(String(request.sessionId))
    if (seatId) {
      const seat = this.getSeatSync(seatId)
      if (seat?.retiredAt !== undefined) {
        throw new Error(`Cannot submit prompt to retired seat '${seat.id}'`)
      }
    }

    const effective = this.resolveEffectiveRoute(request.sessionId)
    if (effective) {
      await this.validateRoute(effective.route, signal)
    }

    const hasImage = request.content.some(part => part.type === 'image')
    const llm = this.llm
    if (hasImage && effective && llm) {
      const info = await llm.resolveModelInfo(effective.route.provider, effective.route.model, signal)
      if (info.inputModalities !== undefined && !info.inputModalities.includes('image')) {
        throw new LlmError(`Model "${effective.route.model}" does not support image input.`, 'UNSUPPORTED_CONTENT')
      }
    }

    this.syncAgentSelection(request.sessionId)

    if (!this.sessionController) {
      throw new Error('SessionController is not mounted on Context')
    }

    return await this.sessionController.prompt(request, signal ?? new AbortController().signal)
  }

  /**
   * List team definitions with optional archived filter.
   * @param includeArchived - whether to include archived teams (defaults to false).
   * @returns list of team definitions.
   */
  async listTeams(includeArchived: boolean = false): Promise<readonly TeamDefinition[]> {
    await this.ensureCatalogReady()
    if (this.catalog) {
      return this.catalog.listTeams({ includeArchived })
    }
    const all = [...this.teams.values()].filter(t => t.deletedAt === undefined)
    return includeArchived ? all : all.filter(t => t.archivedAt === undefined)
  }

  /**
   * Retrieve a team definition by identifier.
   * @param id - team definition identifier.
   * @returns team definition if found.
   */
  async getTeam(id: TeamDefinitionId): Promise<TeamDefinition | undefined> {
    await this.ensureCatalogReady()
    return this.getTeamSync(id)
  }

  /**
   * Read the current live team activity without restoring dormant sessions.
   * @param teamId - saved team identifier.
   * @returns current roster, tasks, and interactions, or undefined when dormant.
   */
  @Remote('getTeamActivity')
  async getTeamActivity(teamId: TeamDefinitionId): Promise<AgentTeamView | undefined> {
    await this.ensureCatalogReady()
    const team = this.getTeamSync(teamId)
    if (!team) throw new Error(`Team definition '${teamId}' not found`)
    const lead = team.leadSessionId === undefined ? undefined : this.agents?.get(team.leadSessionId)
    const teams = this.agentTeams
    if (!lead || !teams) return undefined
    const seat = this.getSeatBySessionSync(lead.id)
    if (
      !seat ||
      seat.teamId !== team.id ||
      seat.role !== 'coordinator' ||
      seat.profileId !== team.coordinatorProfileId ||
      seat.retiredAt !== undefined ||
      seat.activeInstanceId !== team.leadSessionId
    )
      return undefined
    const membership = teams.membership(lead)
    if (membership.root !== lead || membership.role !== 'lead') return undefined
    return teams.remoteView(lead)
  }

  /**
   * Create a new team definition record.
   * @param options - creation options.
   * @returns created team definition.
   */
  async createTeam(options: CreateTeamDefinitionOptions): Promise<TeamDefinition> {
    await this.ensureCatalogReady()
    let team: TeamDefinition
    if (this.catalog) {
      team = await this.catalog.createTeam(options)
    } else {
      const coordinator = this.getProfileSync(options.coordinatorProfileId)
      if (!coordinator) {
        throw new Error(`Coordinator profile '${options.coordinatorProfileId}' not found`)
      }
      const now = Date.now()
      team = {
        id: options.id !== undefined ? TeamDefinitionId(options.id) : TeamDefinitionId(randomUUID()),
        name: options.name,
        ...(options.avatar !== undefined ? { avatar: options.avatar } : {}),
        ...(options.description !== undefined ? { description: options.description } : {}),
        coordinatorProfileId: options.coordinatorProfileId,
        ...(options.sharedWorkspaceId !== undefined ? { sharedWorkspaceId: options.sharedWorkspaceId } : {}),
        ...(options.templateOrigin !== undefined ? { templateOrigin: options.templateOrigin } : {}),
        seatIds: [],
        ...(options.capabilities !== undefined ? { capabilities: options.capabilities } : {}),
        revision: 1,
        createdAt: now,
        updatedAt: now,
      }
    }
    this.teams.set(team.id, team)
    return team
  }

  /**
   * Update an existing team definition record with CAS revision check.
   * @param id - team definition identifier.
   * @param expectedRevision - expected revision for CAS update.
   * @param options - update options.
   * @returns updated team definition.
   */
  async updateTeam(id: TeamDefinitionId, expectedRevision: number, options: UpdateTeamDefinitionOptions): Promise<TeamDefinition> {
    await this.ensureCatalogReady()
    let updated: TeamDefinition
    if (this.catalog) {
      updated = await this.catalog.updateTeam(id, expectedRevision, options)
    } else {
      const existing = this.teams.get(id)
      if (!existing) {
        throw new Error(`Team definition '${id}' not found`)
      }
      if (existing.archivedAt !== undefined) {
        throw new Error(`Cannot update archived team definition '${id}'`)
      }
      if (existing.revision !== expectedRevision) {
        throw new RevisionConflictError('team', id, expectedRevision, existing.revision)
      }
      if (
        options.coordinatorProfileId !== undefined &&
        options.coordinatorProfileId !== existing.coordinatorProfileId &&
        (existing.leadSessionId !== undefined || this.listSeatsSync(id).some(seat => seat.role === 'coordinator'))
      ) {
        throw new Error('Cannot change coordinator profile after the team roster is initialized')
      }
      if (options.coordinatorProfileId !== undefined) {
        const coordinator = this.getProfileSync(options.coordinatorProfileId)
        if (!coordinator) {
          throw new Error(`Coordinator profile '${options.coordinatorProfileId}' not found`)
        }
      }
      updated = {
        ...existing,
        ...(options.name !== undefined ? { name: options.name } : {}),
        ...(options.avatar !== undefined ? { avatar: options.avatar } : {}),
        ...(options.description !== undefined ? { description: options.description } : {}),
        ...(options.coordinatorProfileId !== undefined ? { coordinatorProfileId: options.coordinatorProfileId } : {}),
        ...(options.leadSessionId !== undefined ? { leadSessionId: options.leadSessionId } : {}),
        ...(options.sharedWorkspaceId !== undefined ? { sharedWorkspaceId: options.sharedWorkspaceId } : {}),
        ...(options.seatIds !== undefined ? { seatIds: options.seatIds } : {}),
        ...(options.capabilities !== undefined ? { capabilities: options.capabilities } : {}),
        revision: existing.revision + 1,
        updatedAt: Date.now(),
      }
    }
    this.teams.set(id, updated)
    if (updated.leadSessionId) {
      this.sessionToTeam.set(String(updated.leadSessionId), updated.id)
    }
    return updated
  }

  /**
   * Soft-archive a team definition record.
   * @param id - team definition identifier.
   * @returns archived team definition.
   */
  async archiveTeam(id: TeamDefinitionId): Promise<TeamDefinition> {
    await this.ensureCatalogReady()
    let archived: TeamDefinition
    if (this.catalog) {
      archived = await this.catalog.archiveTeam(id)
    } else {
      const existing = this.teams.get(id)
      if (!existing) {
        throw new Error(`Team definition '${id}' not found`)
      }
      if (existing.archivedAt !== undefined) return existing
      archived = {
        ...existing,
        archivedAt: Date.now(),
        updatedAt: Date.now(),
      }
    }
    this.teams.set(id, archived)
    return archived
  }

  /**
   * Create a new team seat record.
   * @param options - creation options.
   * @returns created team seat.
   */
  async createSeat(options: CreateTeamSeatOptions): Promise<TeamSeat> {
    await this.ensureCatalogReady()
    let seat: TeamSeat
    if (this.catalog) {
      seat = await this.catalog.createSeat(options)
    } else {
      const team = this.teams.get(options.teamId)
      if (!team) {
        throw new Error(`Team definition '${options.teamId}' not found`)
      }
      const existingSeats = this.listSeatsSync(options.teamId)
      const reservedNames = new Set<string>()
      for (const s of existingSeats) {
        reservedNames.add(s.name)
        for (const inst of s.runtimeInstances) {
          reservedNames.add(inst)
        }
      }
      if (reservedNames.has(options.name)) {
        throw new Error(`Teammate name '${options.name}' is permanently reserved in team '${options.teamId}'`)
      }
      const profile = this.getProfileSync(options.profileId)
      if (!profile) {
        throw new Error(`Assistant profile '${options.profileId}' not found`)
      }
      const now = Date.now()
      seat = {
        id: options.id !== undefined ? TeamSeatId(options.id) : TeamSeatId(randomUUID()),
        teamId: options.teamId,
        profileId: options.profileId,
        role: options.role,
        name: options.name,
        duty: options.duty,
        title: options.title,
        ...('modelOverride' in options ? { modelOverride: options.modelOverride } : {}),
        ...(options.capabilities !== undefined ? { capabilities: options.capabilities } : {}),
        runtimeInstances: [],
        createdAt: now,
        updatedAt: now,
      }
      if (!team.seatIds.includes(seat.id)) {
        const updatedTeam: TeamDefinition = {
          ...team,
          seatIds: [...team.seatIds, seat.id],
          updatedAt: now,
        }
        this.teams.set(team.id, updatedTeam)
      }
    }
    this.seats.set(seat.id, seat)
    if (seat.modelOverride) {
      this.seatOverrides.set(seat.id, seat.modelOverride)
    }
    return seat
  }

  /**
   * Retrieve a team seat by identifier.
   * @param id - team seat identifier.
   * @returns team seat if found.
   */
  async getSeat(id: TeamSeatId): Promise<TeamSeat | undefined> {
    await this.ensureCatalogReady()
    return this.getSeatSync(id)
  }

  /**
   * Synchronously list all seats belonging to a team.
   * @param teamId - team definition identifier.
   * @returns list of team seats.
   */
  listSeatsSync(teamId: TeamDefinitionId): readonly TeamSeat[] {
    if (this.catalog) {
      return this.catalog.listSeats(teamId)
    }
    return [...this.seats.values()].filter(s => s.teamId === teamId)
  }

  /**
   * List all seats belonging to a team.
   * @param teamId - team definition identifier.
   * @returns list of team seats.
   */
  async listSeats(teamId: TeamDefinitionId): Promise<readonly TeamSeat[]> {
    await this.ensureCatalogReady()
    return this.listSeatsSync(teamId)
  }

  /**
   * Update an existing team seat.
   * @param id - team seat identifier.
   * @param options - update options.
   * @returns updated team seat.
   */
  async updateSeat(id: TeamSeatId, options: UpdateTeamSeatOptions): Promise<TeamSeat> {
    await this.ensureCatalogReady()
    const existingCheck = this.getSeatSync(id)
    if (!existingCheck) {
      throw new Error(`Team seat '${id}' not found`)
    }
    if (existingCheck.retiredAt !== undefined) {
      throw new Error(`Cannot update retired team seat '${id}'`)
    }
    if (options.modelOverride !== undefined) await this.validateRoute(options.modelOverride)
    let updated: TeamSeat
    if (this.catalog) {
      updated = await this.catalog.updateSeat(id, options)
    } else {
      const existing = existingCheck
      const appendInstanceId = options.appendInstanceId
      const instances =
        appendInstanceId === undefined
          ? existing.runtimeInstances
          : existing.runtimeInstances.includes(appendInstanceId)
            ? existing.runtimeInstances
            : [...existing.runtimeInstances, appendInstanceId]
      updated = {
        ...existing,
        ...(options.name !== undefined ? { name: options.name } : {}),
        ...(options.duty !== undefined ? { duty: options.duty } : {}),
        ...(options.title !== undefined ? { title: options.title } : {}),
        ...(options.modelOverride !== undefined ? { modelOverride: options.modelOverride } : {}),
        ...(options.capabilities !== undefined ? { capabilities: options.capabilities } : {}),
        ...(options.activeInstanceId !== undefined ? { activeInstanceId: options.activeInstanceId } : {}),
        ...(options.retiredAt !== undefined ? { retiredAt: options.retiredAt } : {}),
        runtimeInstances: instances,
        updatedAt: Date.now(),
      }
    }
    this.seats.set(id, updated)
    if (updated.modelOverride) this.seatOverrides.set(id, updated.modelOverride)
    else this.seatOverrides.delete(id)
    if ('modelOverride' in options) {
      this.seatRevisions.set(id, (this.seatRevisions.get(id) ?? 0) + 1)
      for (const [sessionId, seatId] of this.sessionToSeat) {
        if (seatId === id) this.syncAgentSelection(sessionId)
      }
    }
    for (const inst of updated.runtimeInstances) {
      this.sessionToSeat.set(String(inst), updated.id)
      this.sessionToTeam.set(String(inst), updated.teamId)
    }
    return updated
  }

  /**
   * Retire a team seat.
   * Prevents future routing to this seat while preserving history.
   * @param id - team seat identifier.
   * @param options - optional retirement options (e.g. force).
   * @returns retired team seat.
   */
  @Remote('seat_retire')
  async retireSeat(id: TeamSeatId, options?: RetireSeatOptions): Promise<TeamSeat> {
    await this.ensureCatalogReady()
    const existing = this.getSeatSync(id)
    if (!existing) {
      throw new Error(`Team seat '${id}' not found`)
    }
    if (existing.retiredAt !== undefined) return existing

    // Pre-retirement task safety check
    if (!options?.force && this.agentTeams) {
      const team = this.getTeamSync(existing.teamId)
      if (team?.leadSessionId) {
        const leadAgent = this.agents?.get(team.leadSessionId)
        if (leadAgent) {
          const tasks = this.agentTeams.listTasks(leadAgent)
          const hasUnfinished = tasks.some(t => t.ownerName === existing.name && (t.status === 'pending' || t.status === 'in_progress'))
          if (hasUnfinished) {
            throw new Error(`Cannot retire seat '${id}': seat has pending or in-progress tasks`)
          }
        }
      }
    }

    let retired: TeamSeat
    if (this.catalog) {
      retired = await this.catalog.retireSeat(id)
    } else {
      retired = {
        ...existing,
        activeInstanceId: undefined,
        retiredAt: Date.now(),
        updatedAt: Date.now(),
      }
    }
    this.seats.set(id, retired)
    for (const sessionId of existing.runtimeInstances) this.reviewPredictions.cancelSession(sessionId)
    if (existing.activeInstanceId) this.reviewPredictions.cancelSession(existing.activeInstanceId)
    return retired
  }

  /**
   * Replace a failed runtime instance on a seat with a fresh instance name.
   * Reserves the new name permanently before any spawn, requires a real runtime spawn through the team's
   * live lead, applies the seat's effective route at spawn, and preserves the failed instance's history.
   * A denied or failed spawn propagates; it is never replaced by an unrelated root session.
   * @param seatId - target seat identifier.
   * @param newInstanceName - fresh instance name.
   * @returns updated team seat.
   */
  @Remote('seat_replace_instance')
  async replaceSeatInstance(seatId: TeamSeatId, newInstanceName: SessionId | string): Promise<TeamSeat> {
    await this.ensureCatalogReady()
    const existing = this.getSeatSync(seatId)
    if (!existing) {
      throw new Error(`Team seat '${seatId}' not found`)
    }
    if (existing.retiredAt !== undefined) {
      throw new Error(`Cannot replace instance on retired team seat '${seatId}'`)
    }
    const nameStr = String(newInstanceName)
    const team = this.getTeamSync(existing.teamId)

    // Reserve the replacement name before allocation: a failed spawn must not free the name for reuse.
    if (this.catalog) {
      await this.catalog.reserveSeatRuntimeName(seatId, nameStr)
    } else {
      const reserved = new Set<string>()
      for (const s of this.listSeatsSync(existing.teamId)) {
        reserved.add(s.name)
        for (const inst of s.runtimeInstances) reserved.add(String(inst))
        for (const runtimeName of s.runtimeNames ?? []) reserved.add(runtimeName)
      }
      if (reserved.has(nameStr)) {
        throw new Error(`Instance name '${nameStr}' is permanently reserved in team '${existing.teamId}'`)
      }
    }

    const runtimeSessionId = await this.spawnReplacementInstance(existing, nameStr, team)

    // The spawned child can quiesce and detach from the session store; the seat's active instance must
    // stay resolvable as a runtime session for this Host.
    if (this.agentTeams && this.sessions && this.sessions.get(runtimeSessionId) === undefined) {
      this.sessions.create(runtimeSessionId)
    }

    let updated: TeamSeat
    if (this.catalog) {
      updated = await this.catalog.replaceSeatInstance(seatId, runtimeSessionId)
    } else {
      updated = {
        ...existing,
        runtimeNames: [...(existing.runtimeNames ?? []), nameStr],
        activeInstanceId: runtimeSessionId,
        runtimeInstances: [...existing.runtimeInstances, runtimeSessionId],
        updatedAt: Date.now(),
      }
    }
    this.seats.set(seatId, updated)
    this.sessionToSeat.set(String(runtimeSessionId), seatId)
    this.sessionToTeam.set(String(runtimeSessionId), existing.teamId)
    return updated
  }

  /**
   * Spawn the replacement runtime instance through the team's live lead.
   * @param seat - seat receiving the replacement.
   * @param name - reserved runtime instance name.
   * @param team - owning team definition, if any.
   * @returns admitted runtime session identifier.
   */
  private async spawnReplacementInstance(seat: TeamSeat, name: string, team: TeamDefinition | undefined): Promise<SessionId> {
    if (!this.agentTeams || !team?.leadSessionId) {
      // No runtime provider is mounted: record the caller-supplied instance id without inventing a session.
      return SessionId(name)
    }
    const lead = this.agents?.get(team.leadSessionId)
    if (!lead) {
      throw new Error(`Cannot spawn replacement instance '${name}': team lead session '${team.leadSessionId}' is not live`)
    }
    const profile = this.getProfileSync(seat.profileId)
    const route = seat.modelOverride ?? profile?.defaultModel
    const spawned = await this.agentTeams.spawnTeammate(lead, {
      name,
      description: `${seat.title ?? seat.name}：${seat.duty}`,
      context: 'fresh',
      provider: 'spawn',
      prompt: [{ type: 'text', text: `替换实例已就绪：${seat.duty}` }],
      signal: new AbortController().signal,
      ...(route ? { agentOptions: { provider: route.provider, model: route.model } } : {}),
    })
    return spawned.member.id
  }

  /**
   * Retrieve capacity accounting for a team, separating live occupancy from history.
   * @param teamId - team definition identifier.
   * @param maxCapacity - optional team capacity ceiling (defaults to 10).
   * @returns capacity accounting metrics.
   */
  @Remote('team_capacity')
  async getCapacityAccounting(teamId: TeamDefinitionId, maxCapacity?: number): Promise<TeamCapacityAccounting> {
    await this.ensureCatalogReady()
    const effectiveMaxCapacity = maxCapacity ?? 10
    if (this.catalog) {
      return this.catalog.getCapacityAccounting(teamId, effectiveMaxCapacity)
    }
    const team = this.getTeamSync(teamId)
    if (!team) {
      throw new Error(`Team definition '${teamId}' not found`)
    }
    const seats = this.listSeatsSync(teamId)
    // Capacity counts live instances: active instance or never-provisioned seat; failed and retired are history.
    const liveSeats = seats.filter(
      s => s.retiredAt === undefined && (s.activeInstanceId !== undefined || s.runtimeInstances.length === 0),
    )
    const retiredSeats = seats.filter(s => s.retiredAt !== undefined)
    return {
      teamId,
      maxCapacity: effectiveMaxCapacity,
      liveCount: liveSeats.length,
      retiredCount: retiredSeats.length,
      totalHistoricalSeats: seats.length,
      availableSlots: Math.max(0, effectiveMaxCapacity - liveSeats.length),
    }
  }

  /**
   * Create an editable independent team definition and seats copied from a template.
   * @param templateId - template identifier ('blank', 'document', 'case', 'comms').
   * @param options - creation options.
   * @returns created team and seats.
   */
  async createTeamFromTemplate(
    templateId: TeamTemplateOrigin,
    options: {
      coordinatorProfileId: AssistantProfileId
      name?: string
      avatar?: string
      description?: string
      sharedWorkspaceId?: string
    },
  ): Promise<{ team: TeamDefinition; seats: readonly TeamSeat[] }> {
    await this.ensureCatalogReady()
    let result: { team: TeamDefinition; seats: readonly TeamSeat[] }
    if (this.catalog) {
      result = await this.catalog.createTeamFromTemplate(templateId, options)
    } else {
      const template = getTeamTemplate(templateId)
      if (!template) {
        throw new Error(`Team template '${templateId}' not found`)
      }
      const team = await this.createTeam({
        name: options.name ?? template.name,
        avatar: options.avatar,
        description: options.description ?? template.description,
        coordinatorProfileId: options.coordinatorProfileId,
        sharedWorkspaceId: options.sharedWorkspaceId,
        templateOrigin: templateId,
      })

      const createdSeats: TeamSeat[] = []
      // 1. Create coordinator seat
      const coordinatorSeat = await this.createSeat({
        teamId: team.id,
        profileId: options.coordinatorProfileId,
        role: 'coordinator',
        name: 'coordinator',
        duty: '协调员，统筹小队任务分配与各工种协作',
        title: '协调员',
      })
      createdSeats.push(coordinatorSeat)

      // 2. Create teammate seats
      for (const seatTpl of template.seats) {
        let profile = [...this.profiles.values()].find(p => p.name === seatTpl.title && p.archivedAt === undefined)
        if (!profile) {
          profile = await this.createProfile({
            name: seatTpl.title,
            responsibility: seatTpl.duty,
            capabilities: seatTpl.defaultCapabilities,
          })
        }
        const seat = await this.createSeat({
          teamId: team.id,
          profileId: profile.id,
          role: 'teammate',
          name: seatTpl.name,
          duty: seatTpl.duty,
          title: seatTpl.title,
          capabilities: seatTpl.defaultCapabilities,
        })
        createdSeats.push(seat)
      }

      result = { team, seats: createdSeats }
    }

    this.teams.set(result.team.id, result.team)
    for (const seat of result.seats) {
      this.seats.set(seat.id, seat)
    }
    return result
  }

  private async repairEmptyTeamRoster(teamId: TeamDefinitionId): Promise<void> {
    const pending = this.emptyRosterRepairs.get(teamId)
    if (pending) return await pending
    const repair = (async () => {
      const seats = this.listSeatsSync(teamId)
      const team = this.getTeamSync(teamId)
      if (!team || team.archivedAt !== undefined) throw new Error(`Cannot initialize team '${teamId}'`)
      if (seats.length !== 0) {
        const coordinators = seats.filter(seat => seat.role === 'coordinator' && seat.retiredAt === undefined)
        const coordinator = coordinators.length === 1 ? coordinators[0] : undefined
        if (
          team.leadSessionId !== undefined &&
          coordinator?.profileId === team.coordinatorProfileId &&
          coordinator.activeInstanceId === undefined &&
          coordinator.runtimeInstances.length === 0
        ) {
          await this.bindSeatSession(coordinator.id, team.leadSessionId)
        }
        return
      }
      const profile = this.getProfileSync(team.coordinatorProfileId)
      if (!profile || profile.archivedAt !== undefined) throw new Error(`Coordinator profile '${team.coordinatorProfileId}' is unavailable`)
      const seat = await this.createSeat({
        teamId,
        profileId: profile.id,
        role: 'coordinator',
        name: 'coordinator',
        duty: profile.responsibility,
      })
      if (team.leadSessionId !== undefined) await this.bindSeatSession(seat.id, team.leadSessionId)
    })()
    this.emptyRosterRepairs.set(teamId, repair)
    try {
      await repair
    } finally {
      if (this.emptyRosterRepairs.get(teamId) === repair) this.emptyRosterRepairs.delete(teamId)
    }
  }

  /**
   * Provision a team and all its non-retired seats into live runtime sessions.
   * Coordinator binds to the lead session; teammates are spawned as fresh instances.
   * Legacy empty rosters receive their coordinator seat only when explicitly provisioned.
   *
   * The operation is committed to the provisioning ledger before any session allocation, checkpoints
   * the coordinator and every seat allocation, and resumes by operation identity after a crash. A
   * changed seat set starts a new operation; a divergent payload for the same identity is a conflict.
   * @param teamId - team definition identifier.
   * @param options - optional signal or context.
   * @returns provisioned team and seat instance sessions.
   */
  async provisionTeam(
    teamId: TeamDefinitionId,
    options?: { signal?: AbortSignal },
  ): Promise<{
    team: TeamDefinition
    coordinatorSessionId: SessionId
    seatInstances: Record<string, SessionId>
  }> {
    await this.ensureCatalogReady()
    const savedTeam = await this.getTeam(teamId)
    if (!savedTeam) {
      throw new Error(`Team definition '${teamId}' not found`)
    }
    if (savedTeam.archivedAt !== undefined) {
      throw new Error(`Cannot provision archived team '${teamId}'`)
    }

    await this.repairEmptyTeamRoster(teamId)
    const team = this.getTeamSync(teamId) ?? savedTeam

    const seats = await this.listSeats(team.id)
    const teammateNames = seats
      .filter(seat => seat.role === 'teammate' && seat.retiredAt === undefined)
      .map(seat => seat.name)
      .sort()

    if (!this.catalog) {
      const allocations = await this.provisionTeamSeats(team, teammateNames, options)
      const seatInstances: Record<string, SessionId> = {}
      for (const [key, value] of Object.entries(allocations)) {
        if (key.startsWith(SEAT_ALLOCATION_PREFIX)) {
          seatInstances[key.slice(SEAT_ALLOCATION_PREFIX.length)] = SessionId(value)
        }
      }
      const coordinatorValue = allocations.coordinator
      if (coordinatorValue === undefined) {
        throw new Error(`Provisioning team '${team.id}' completed without a coordinator allocation`)
      }
      return { team: this.getTeamSync(team.id) ?? team, coordinatorSessionId: SessionId(coordinatorValue), seatInstances }
    }

    const operationId = ProvisioningOperationId(
      `provision-team:${team.id}:${createHash('sha256').update(teammateNames.join('\u0000')).digest('hex').slice(0, 12)}`,
    )
    const result = await this.catalog.executeProvisioning<{ readonly teamId: string; readonly seats: readonly string[] }>({
      id: operationId,
      payload: { teamId: String(team.id), seats: teammateNames },
      run: async context => await this.provisionTeamSeats(team, teammateNames, options, context),
    })

    const seatInstances: Record<string, SessionId> = {}
    for (const [key, value] of Object.entries(result.allocations)) {
      if (key.startsWith(SEAT_ALLOCATION_PREFIX)) {
        seatInstances[key.slice(SEAT_ALLOCATION_PREFIX.length)] = SessionId(value)
      }
    }
    const coordinatorValue = result.allocations.coordinator
    if (coordinatorValue === undefined) {
      throw new Error(`Provisioning operation '${operationId}' completed without a coordinator allocation`)
    }
    return {
      team: this.getTeamSync(team.id) ?? team,
      coordinatorSessionId: SessionId(coordinatorValue),
      seatInstances,
    }
  }

  /**
   * Run one provisioning pass over the team's coordinator and teammate seats.
   * @param team - team definition being provisioned.
   * @param teammateNames - teammate seat names in this pass.
   * @param options - optional signal.
   * @param context - provisioning context when the pass runs inside the ledger.
   * @returns the allocation record for this pass.
   */
  private async provisionTeamSeats(
    team: TeamDefinition,
    teammateNames: readonly string[],
    options?: { signal?: AbortSignal },
    context?: ProvisioningContext,
  ): Promise<Record<string, string>> {
    const allocations: Record<string, string> = { ...(context?.allocations ?? {}) }

    // 1. Coordinator: reuse the recorded allocation, the bound lead, or a fresh private conversation.
    let coordinatorSessionId = allocations.coordinator !== undefined ? SessionId(allocations.coordinator) : team.leadSessionId
    if (coordinatorSessionId === undefined) {
      if (this.sessionController) {
        const conv = await this.createConversation(team.coordinatorProfileId, {
          title: team.name,
          cwd: team.sharedWorkspaceId,
        })
        coordinatorSessionId = conv.rootSessionId
      } else {
        coordinatorSessionId = SessionId(`team-lead-${randomUUID()}`)
      }
      await this.updateTeam(team.id, team.revision, { leadSessionId: coordinatorSessionId })
      this.sessionToTeam.set(String(coordinatorSessionId), team.id)
    }
    if (allocations.coordinator === undefined) {
      allocations.coordinator = String(coordinatorSessionId)
      await context?.setCheckpoint('coordinator', { coordinator: String(coordinatorSessionId) })
    }

    const seats = await this.listSeats(team.id)
    const coordinatorSeat = seats.find(seat => seat.role === 'coordinator')
    if (coordinatorSeat) {
      await this.bindSeatSession(coordinatorSeat.id, coordinatorSessionId)
    }

    // 2. Teammate seats: reuse recorded allocations, then an existing roster member, then a fresh spawn.
    const leadAgent = this.agents?.get(coordinatorSessionId)
    const teammateSeats = seats.filter(
      seat => seat.role === 'teammate' && seat.retiredAt === undefined && teammateNames.includes(seat.name),
    )

    for (const seat of teammateSeats) {
      const allocationKey = `${SEAT_ALLOCATION_PREFIX}${seat.name}`
      const recorded = allocations[allocationKey]
      if (recorded !== undefined) {
        await this.bindSeatSession(seat.id, SessionId(recorded))
        continue
      }

      if (this.agentTeams && leadAgent) {
        const memberList = this.agentTeams.listMembers(leadAgent)
        const existingMember = memberList.find((member: { name: string; id: SessionId }) => member.name === seat.name)
        let memberSessionId: SessionId
        if (existingMember) {
          memberSessionId = existingMember.id
        } else {
          const profile = this.getProfileSync(seat.profileId)
          const route = seat.modelOverride ?? profile?.defaultModel
          const agentOptions = route ? { model: route.model, provider: route.provider } : undefined
          const spawnRes = await this.agentTeams.spawnTeammate(leadAgent, {
            name: seat.name,
            description: `${seat.title ?? seat.name}：${seat.duty}`,
            prompt: [{ type: 'text', text: `你是【${team.name}】团队中的【${seat.title ?? seat.name}】。职责：${seat.duty}` }],
            context: 'fresh',
            provider: 'spawn',
            ...(agentOptions ? { agentOptions } : {}),
            signal: options?.signal ?? new AbortController().signal,
          })
          memberSessionId = spawnRes.member.id
        }
        await this.bindSeatSession(seat.id, memberSessionId)
        allocations[allocationKey] = String(memberSessionId)
        await context?.setCheckpoint(`seat:${seat.name}`, { [allocationKey]: String(memberSessionId) })
      }
    }

    return allocations
  }

  /**
   * Dispatch a user prompt to a team's coordinator following coordinator-first dispatch.
   * @param teamId - team definition identifier.
   * @param request - prompt request.
   * @param signal - optional cancellation signal.
   * @returns prompt execution result.
   */
  async dispatchCoordinator(teamId: TeamDefinitionId, request: SessionPromptRequest, signal?: AbortSignal): Promise<SessionPromptValue> {
    await this.ensureCatalogReady()
    const team = await this.getTeam(teamId)
    if (!team) {
      throw new Error(`Team definition '${teamId}' not found`)
    }
    if (team.archivedAt !== undefined) {
      throw new Error(`Cannot submit prompt to archived team '${teamId}'`)
    }

    let coordinatorSessionId = team.leadSessionId
    if (!coordinatorSessionId) {
      const provisioned = await this.provisionTeam(teamId, signal !== undefined ? { signal } : undefined)
      coordinatorSessionId = provisioned.coordinatorSessionId
    }

    // Operational use enforces the current adoption binding: a repaired-needed or diverged record blocks dispatch.
    const adoption =
      (team.templateOrigin !== undefined ? this.getAdoptionSync(team.templateOrigin) : undefined) ??
      this.getAdoptionByLeadSessionSync(coordinatorSessionId)
    if (adoption !== undefined) {
      if (adoption.status !== 'active') {
        throw new Error(`Cannot dispatch to team '${teamId}': adoption for squad '${adoption.squadId}' requires repair`)
      }
      if (String(adoption.leadSessionId) !== String(coordinatorSessionId)) {
        throw new Error(
          `Cannot dispatch to team '${teamId}': adoption lead '${adoption.leadSessionId}' does not match the team lead '${coordinatorSessionId}'`,
        )
      }
    }

    const activeToken = this.ownership.getOwnership(coordinatorSessionId)
    if (activeToken !== undefined) {
      throw new OwnershipConflictError({
        sessionId: coordinatorSessionId,
        conflictType: 'foreign_ownership_detected',
        activeToken,
        attemptedBy: `dispatchCoordinator:${teamId}`,
        details: `Coordinator session '${coordinatorSessionId}' is currently owned by round '${activeToken.roundId}' slot '${activeToken.slotId}'`,
        detectedAt: Date.now(),
      })
    }

    const leadPromptRequest: SessionPromptRequest = {
      ...request,
      sessionId: coordinatorSessionId,
    }

    return await this.submitPrompt(leadPromptRequest, signal)
  }

  /**
   * List all non-archived assistant profiles through the generated Remote API.
   * @param includeArchived - whether to include archived profiles.
   * @returns list of assistant profiles.
   */
  @Remote('listProfiles')
  async remoteListProfiles(includeArchived?: boolean): Promise<readonly AssistantProfile[]> {
    return await this.listProfiles(includeArchived ?? false)
  }

  /**
   * Retrieve an assistant profile by identifier through the generated Remote API.
   * @param id - profile identifier.
   * @returns assistant profile if found.
   */
  @Remote('getProfile')
  async remoteGetProfile(id: AssistantProfileId): Promise<AssistantProfile | undefined> {
    return await this.getProfile(id)
  }

  /**
   * Create a new persistent assistant profile through the generated Remote API.
   * @param options - profile creation options.
   * @returns created assistant profile.
   */
  @Remote('createProfile')
  async remoteCreateProfile(options: CreateAssistantProfileOptions): Promise<AssistantProfile> {
    return await this.createProfile(options)
  }

  /**
   * Update an existing assistant profile through the generated Remote API.
   * @param id - profile identifier.
   * @param options - updated fields.
   * @param expectedRevision - optional expected revision for concurrency control.
   * @returns updated assistant profile.
   */
  @Remote('updateProfile')
  async remoteUpdateProfile(
    id: AssistantProfileId,
    options: UpdateAssistantProfileOptions,
    expectedRevision?: number,
  ): Promise<AssistantProfile> {
    return await this.updateProfile(id, options, expectedRevision)
  }

  /**
   * Update one team seat's duty or model override through the generated Remote API.
   * @param id - team seat identifier.
   * @param options - seat fields to update; `modelOverride: null` clears the override to inherit.
   * @returns updated team seat.
   */
  @Remote('updateSeat')
  async remoteUpdateSeat(
    id: TeamSeatId,
    options: { readonly duty?: string | undefined; readonly modelOverride?: AssistantModelSelection | null | undefined },
  ): Promise<TeamSeat> {
    return await this.updateSeat(id, {
      ...(options.duty !== undefined ? { duty: options.duty } : {}),
      ...(options.modelOverride !== undefined ? { modelOverride: options.modelOverride ?? undefined } : {}),
    })
  }

  /**
   * Soft-archive an assistant profile through the generated Remote API.
   * @param id - profile identifier.
   */
  @Remote('archiveProfile')
  async remoteArchiveProfile(id: AssistantProfileId): Promise<void> {
    await this.archiveProfile(id)
  }

  /**
   * Unarchive an assistant profile through the generated Remote API.
   * @param id - profile identifier.
   */
  @Remote('unarchiveProfile')
  async remoteUnarchiveProfile(id: AssistantProfileId): Promise<void> {
    await this.unarchiveProfile(id)
  }

  /**
   * List conversations associated with an assistant profile through the generated Remote API.
   * @param profileId - optional profile identifier filter.
   * @param includeArchived - whether to include archived conversations.
   * @returns list of matching conversation bindings.
   */
  @Remote('listConversations')
  async remoteListConversations(profileId?: AssistantProfileId, includeArchived?: boolean): Promise<readonly AssistantConversation[]> {
    return await this.listConversations(profileId, includeArchived ?? false)
  }

  /**
   * Retrieve an assistant conversation binding by identifier through the generated Remote API.
   * @param id - conversation binding identifier.
   * @returns conversation binding if found.
   */
  @Remote('getConversation')
  async remoteGetConversation(id: AssistantConversationId): Promise<AssistantConversation | undefined> {
    return await this.getConversation(id)
  }

  /**
   * Retrieve an assistant conversation binding by its root session identifier through the generated Remote API.
   * @param sessionId - root session identifier.
   * @returns conversation binding if found.
   */
  @Remote('getConversationBySession')
  async remoteGetConversationBySession(sessionId: SessionId): Promise<AssistantConversation | undefined> {
    return await this.getConversationBySession(sessionId)
  }

  /**
   * Create an assistant conversation binding through the generated Remote API.
   * @param profileId - assistant profile identifier.
   * @param options - creation options.
   * @returns created conversation binding.
   */
  @Remote('createConversation')
  async remoteCreateConversation(
    profileId: AssistantProfileId,
    options?: CreateAssistantConversationOptions,
  ): Promise<AssistantConversation> {
    return await this.createConversation(profileId, options)
  }

  /**
   * Start a new topic for an assistant profile through the generated Remote API.
   * @param profileId - assistant profile identifier.
   * @param options - optional creation options.
   * @returns newly created conversation binding.
   */
  @Remote('startNewTopic')
  async remoteStartNewTopic(profileId: AssistantProfileId, options?: CreateAssistantConversationOptions): Promise<AssistantConversation> {
    return await this.startNewTopic(profileId, options)
  }

  /**
   * Set or update explicit conversation-scoped model override through the generated Remote API.
   * @param id - conversation identifier.
   * @param model - model selection override.
   * @returns updated conversation binding.
   */
  @Remote('setConversationModelOverride')
  async remoteSetConversationModelOverride(id: AssistantConversationId, model?: AssistantModelSelection): Promise<AssistantConversation> {
    return await this.setConversationModelOverride(id, model)
  }

  /**
   * Clear explicit conversation-scoped model override through the generated Remote API.
   * @param id - conversation identifier.
   * @returns updated conversation binding.
   */
  @Remote('clearConversationModelOverride')
  async remoteClearConversationModelOverride(id: AssistantConversationId): Promise<AssistantConversation> {
    return await this.clearConversationModelOverride(id)
  }

  /**
   * List all team definitions through the generated Remote API.
   * @param includeArchived - whether to include archived teams.
   * @returns list of team definitions.
   */
  @Remote('listTeams')
  async remoteListTeams(includeArchived?: boolean): Promise<readonly TeamDefinition[]> {
    return await this.listTeams(includeArchived ?? false)
  }

  /**
   * Resolve the saved team owning a live or historical runtime Session.
   * @param sessionId - composer Session identifier.
   * @returns its owning saved team, if bound.
   */
  @Remote('getTeamBySession')
  async getTeamBySession(sessionId: SessionId): Promise<TeamDefinition | undefined> {
    await this.ensureCatalogReady()
    const id = this.getTeamIdBySessionSync(sessionId)
    return id ? this.getTeamSync(id) : undefined
  }

  /**
   * Retrieve a team definition by identifier through the generated Remote API.
   * @param id - team definition identifier.
   * @returns team definition if found.
   */
  @Remote('getTeam')
  async remoteGetTeam(id: TeamDefinitionId): Promise<TeamDefinition | undefined> {
    return await this.getTeam(id)
  }

  /**
   * Create a new team definition through the generated Remote API.
   * @param options - creation options.
   * @returns created team definition.
   */
  @Remote('createTeam')
  async remoteCreateTeam(options: CreateTeamDefinitionOptions): Promise<TeamDefinition> {
    return await this.createTeam(options)
  }

  /**
   * Update an existing team definition through the generated Remote API.
   * @param id - team definition identifier.
   * @param expectedRevision - expected revision for CAS update.
   * @param options - updated fields.
   * @returns updated team definition.
   */
  @Remote('updateTeam')
  async remoteUpdateTeam(id: TeamDefinitionId, expectedRevision: number, options: UpdateTeamDefinitionOptions): Promise<TeamDefinition> {
    return await this.updateTeam(id, expectedRevision, options)
  }

  /**
   * Soft-archive a team definition through the generated Remote API.
   * @param id - team definition identifier.
   * @returns archived team definition.
   */
  @Remote('archiveTeam')
  async remoteArchiveTeam(id: TeamDefinitionId): Promise<TeamDefinition> {
    return await this.archiveTeam(id)
  }

  /**
   * List all seats belonging to a team through the generated Remote API.
   * @param teamId - team definition identifier.
   * @returns list of team seats.
   */
  @Remote('listSeats')
  async remoteListSeats(teamId: TeamDefinitionId): Promise<readonly TeamSeat[]> {
    return await this.listSeats(teamId)
  }

  /**
   * Retrieve a team seat by identifier through the generated Remote API.
   * @param id - team seat identifier.
   * @returns team seat if found.
   */
  @Remote('getSeat')
  async remoteGetSeat(id: TeamSeatId): Promise<TeamSeat | undefined> {
    return await this.getSeat(id)
  }

  /**
   * Create a team definition and seats from a template through the generated Remote API.
   * @param templateId - template identifier.
   * @param options - template instantiation options.
   * @returns created team definition and seats.
   */
  @Remote('createTeamFromTemplate')
  async remoteCreateTeamFromTemplate(
    templateId: TeamTemplateOrigin,
    options: {
      coordinatorProfileId: AssistantProfileId
      name?: string
      avatar?: string
      description?: string
      sharedWorkspaceId?: string
    },
  ): Promise<{ team: TeamDefinition; seats: readonly TeamSeat[] }> {
    return await this.createTeamFromTemplate(templateId, options)
  }

  /**
   * Synchronously look up an adoption record by squad identifier.
   * @param squadId - squad identifier.
   * @returns adoption record if present.
   */
  getAdoptionSync(squadId: string): InstitutionAdoptionRecord | undefined {
    if (this.catalog) {
      return this.catalog.getAdoption(squadId)
    }
    return this.adoptions.get(squadId)
  }

  /**
   * Synchronously look up an adoption record by lead session identifier.
   * @param leadSessionId - lead session identifier.
   * @returns adoption record if present.
   */
  getAdoptionByLeadSessionSync(leadSessionId: SessionId): InstitutionAdoptionRecord | undefined {
    if (this.catalog) {
      return this.catalog.getAdoptionByLeadSession(leadSessionId)
    }
    for (const a of this.adoptions.values()) {
      if (a.leadSessionId === leadSessionId) return a
    }
    return undefined
  }

  /**
   * Synchronously list all institution adoption records.
   * @returns list of adoption records.
   */
  listAdoptionsSync(): readonly InstitutionAdoptionRecord[] {
    if (this.catalog) {
      return this.catalog.listAdoptions()
    }
    return [...this.adoptions.values()]
  }

  /**
   * Look up an institution squad adoption record by squad identifier.
   * @param squadId - squad identifier ('document' | 'case' | 'comms').
   * @returns adoption record if found.
   */
  @Remote('institution_adoption_get')
  getAdoption(squadId: 'document' | 'case' | 'comms'): Promise<InstitutionAdoptionRecord | undefined> {
    return Promise.resolve(this.getAdoptionSync(squadId))
  }

  /**
   * List all committed institution squad adoption records.
   * @returns list of adoption records.
   */
  @Remote('institution_adoption_list')
  listAdoptions(): Promise<readonly InstitutionAdoptionRecord[]> {
    return Promise.resolve(this.listAdoptionsSync())
  }

  /**
   * Adopt an existing institution squad into a managed team definition.
   * Runs within the legacy catalog's serialized write chain to coordinate with legacy writers.
   * Validates lead existence, child parent pointers, and continuable descriptors.
   * Requires repair if bindings diverge or a child is unreadable.
   * @param options - adoption parameters.
   * @returns committed adoption record and created team definition.
   */
  @Remote('institution_adoption_adopt')
  async adoptInstitutionSquad(
    options: AdoptInstitutionSquadOptions,
  ): Promise<{ adoption: InstitutionAdoptionRecord; team: TeamDefinition }> {
    await this.ensureCatalogReady()
    const agentTeams = this.agentTeams
    if (!agentTeams) {
      throw new Error('agentTeams service is required for institution adoption')
    }
    const squadDef = requireInstitutionSquad(options.squadId)

    // Check if squad is already actively adopted
    const existing = this.getAdoptionSync(options.squadId)
    if (existing && existing.status === 'active') {
      throw new Error(`Institution squad '${options.squadId}' is already adopted`)
    }

    return await agentTeams.transactInstitutionCatalog(async (legacyFile) => {
      const legacyLeadId = legacyFile.leads[options.squadId]
      if (!legacyLeadId) {
        throw new Error(`Squad '${options.squadId}' has no provisioned lead in institution catalog`)
      }
      const leadSessionId = SessionId(legacyLeadId)

      // Check if lead session is already adopted by another team
      const existingByLead = this.getAdoptionByLeadSessionSync(leadSessionId)
      if (existingByLead && existingByLead.status === 'active') {
        throw new Error(`Lead session '${legacyLeadId}' is already adopted by squad '${existingByLead.squadId}'`)
      }

      // Validate lead session and every child's parent/continuation descriptor
      const seatMappings = await this.validateInstitutionChildren(leadSessionId, options.squadId)

      // Re-verify that legacy binding didn't change during validation
      if (legacyFile.leads[options.squadId] !== legacyLeadId) {
        throw new Error(`Legacy catalog lead binding changed during adoption of squad '${options.squadId}'`)
      }

      // Create coordinator profile if needed
      let coordinatorProfileId = options.coordinatorProfileId
      if (!coordinatorProfileId) {
        const profile = await this.createProfile({
          name: `${squadDef.displayName}协调员`,
          responsibility: `协调${squadDef.displayName}各项事务`,
        })
        coordinatorProfileId = profile.id
      }

      // Create managed TeamDefinition
      const team = await this.createTeam({
        name: options.teamName ?? squadDef.displayName,
        coordinatorProfileId,
        leadSessionId,
        templateOrigin: options.squadId,
      })

      // Create and bind seats for each teammate
      for (const seatDef of squadDef.seats) {
        const memberId = seatMappings[seatDef.name]
        if (memberId === undefined) {
          throw new Error(`Seat mapping for '${seatDef.name}' was not committed`)
        }
        const seatProfile = await this.createProfile({
          name: seatDef.title,
          responsibility: seatDef.duty,
        })
        const seat = await this.createSeat({
          teamId: team.id,
          profileId: seatProfile.id,
          role: 'teammate',
          name: seatDef.name,
          duty: seatDef.duty,
          title: seatDef.title,
        })
        await this.bindSeatSession(seat.id, memberId)
      }

      const now = Date.now()
      const adoption: InstitutionAdoptionRecord = {
        id: options.squadId,
        squadId: options.squadId,
        teamId: team.id,
        leadSessionId,
        seatMappings,
        status: 'active',
        revision: existing ? existing.revision + 1 : 1,
        adoptedAt: existing ? existing.adoptedAt : now,
        updatedAt: now,
      }

      if (this.catalog) {
        if (existing) {
          await this.catalog.updateAdoption(options.squadId, existing.revision, adoption)
        } else {
          await this.catalog.commitAdoption(adoption)
        }
      }
      this.adoptions.set(options.squadId, adoption)

      return {
        result: { adoption, team },
      }
    })
  }

  /**
   * Validate an institution lead and every child's live member, parent pointer, and continuation descriptor.
   * @param leadSessionId - lead session hosting the squad members.
   * @param squadId - squad identifier selecting the required seat set.
   * @returns seat name to child session mapping.
   */
  private async validateInstitutionChildren(
    leadSessionId: SessionId,
    squadId: 'document' | 'case' | 'comms',
  ): Promise<Record<string, SessionId>> {
    const agentTeams = this.agentTeams
    if (!agentTeams) {
      throw new Error('agentTeams service is required for institution adoption validation')
    }
    const leadAgent = this.agents?.get(leadSessionId)
    if (!leadAgent) {
      throw new Error(`Lead session '${leadSessionId}' is not active or loaded`)
    }
    const persistence = this.sessionPersistence
    if (!persistence) {
      throw new Error('sessionPersistence service is required for institution adoption validation')
    }
    const squadDef = requireInstitutionSquad(squadId)
    const members = agentTeams.listMembers(leadAgent)
    const seatMappings: Record<string, SessionId> = {}

    for (const seatDef of squadDef.seats) {
      const member = members.find(m => m.name === seatDef.name && m.role === 'teammate')
      if (!member) {
        throw new Error(`Child member '${seatDef.name}' not found on squad lead '${leadSessionId}'`)
      }
      let loaded: PersistedSessionView
      try {
        loaded = await readPersistedSession(persistence, member.id, new AbortController().signal)
      } catch (err: unknown) {
        throw new Error(
          `Child session '${member.id}' for seat '${seatDef.name}' is unreadable: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
      if (loaded.header.parentSession !== leadSessionId) {
        throw new Error(
          `Child session '${member.id}' parent descriptor mismatch: expected '${leadSessionId}', got '${loaded.header.parentSession}'`,
        )
      }
      const suffix = loaded.events.slice(loaded.inheritedEventCount)
      const descriptor = foldSubagentDescriptor(suffix)
      if (descriptor?.mode !== 'continuable') {
        throw new Error(`Child session '${member.id}' continuation descriptor mismatch: mode is not continuable`)
      }
      seatMappings[seatDef.name] = member.id
    }
    return seatMappings
  }

  /**
   * Validate an existing adoption record against the current legacy institution catalog.
   * If the legacy writer changed the lead binding, transitions adoption status to 'repair_needed'.
   * @param squadId - squad identifier.
   * @returns updated adoption record.
   */
  @Remote('institution_adoption_validate')
  async validateAdoptionState(squadId: 'document' | 'case' | 'comms'): Promise<InstitutionAdoptionRecord> {
    await this.ensureCatalogReady()
    const adoption = this.getAdoptionSync(squadId)
    if (!adoption) {
      throw new Error(`Adoption record for squad '${squadId}' not found`)
    }
    if (!this.agentTeams) return adoption

    const currentLegacy = await this.agentTeams.readInstitutionCatalog()
    const legacyLeadId = currentLegacy.leads[squadId]

    if (legacyLeadId !== adoption.leadSessionId) {
      let updated: InstitutionAdoptionRecord = {
        ...adoption,
        status: 'repair_needed',
        error: `Legacy catalog lead binding changed from '${adoption.leadSessionId}' to '${legacyLeadId ?? 'none'}'`,
        updatedAt: Date.now(),
      }
      if (this.catalog) {
        updated = await this.catalog.updateAdoption(squadId, adoption.revision, updated)
      } else {
        updated = {
          ...updated,
          revision: adoption.revision + 1,
        }
      }
      this.adoptions.set(squadId, updated)
      return updated
    }

    return adoption
  }

  /**
   * Repair an adopted institution squad whose binding or child sessions diverged.
   * Runs inside the legacy catalog's serialized write chain, re-validates the repaired lead and every
   * child descriptor, and re-reads the legacy binding after its write: a concurrent legacy writer that
   * moves the lead again leaves the record in 'repair_needed' instead of silently diverging.
   * @param options - repair options.
   * @returns repaired adoption record.
   */
  @Remote('institution_adoption_repair')
  async repairInstitutionAdoption(options: RepairInstitutionAdoptionOptions): Promise<InstitutionAdoptionRecord> {
    await this.ensureCatalogReady()
    const adoption = this.getAdoptionSync(options.squadId)
    if (!adoption) {
      throw new Error(`Adoption record for squad '${options.squadId}' not found`)
    }
    if (adoption.status !== 'repair_needed' && !options.force) {
      return adoption
    }
    const agentTeams = this.agentTeams
    if (!agentTeams) {
      throw new Error('agentTeams service is required to repair institution adoption')
    }

    return await agentTeams.transactInstitutionCatalog(async (legacyFile) => {
      const legacyLeadId = legacyFile.leads[options.squadId]
      const effectiveLeadId = options.newLeadSessionId ?? (legacyLeadId !== undefined ? SessionId(legacyLeadId) : undefined)
      if (!effectiveLeadId) {
        throw new Error(`Cannot repair squad '${options.squadId}': no valid lead session found in legacy catalog`)
      }

      // Re-validate the repaired lead and every child descriptor before committing the mapping once.
      const seatMappings = await this.validateInstitutionChildren(effectiveLeadId, options.squadId)

      const team = this.getTeamSync(adoption.teamId)
      if (team) {
        await this.updateTeam(team.id, team.revision, { leadSessionId: effectiveLeadId })
        const seats = this.listSeatsSync(team.id)
        for (const s of seats) {
          const newInstanceId = seatMappings[s.name]
          if (newInstanceId && s.activeInstanceId !== newInstanceId) {
            await this.bindSeatSession(s.id, newInstanceId)
          }
        }
      }

      const repaired: InstitutionAdoptionRecord = {
        ...adoption,
        leadSessionId: effectiveLeadId,
        seatMappings,
        status: 'active',
        error: undefined,
        updatedAt: Date.now(),
      }

      let committed: InstitutionAdoptionRecord
      if (this.catalog) {
        committed = await this.catalog.updateAdoption(options.squadId, adoption.revision, repaired)
      } else {
        committed = { ...repaired, revision: adoption.revision + 1 }
      }
      this.adoptions.set(options.squadId, committed)

      // A legacy writer that moves the lead after this write must not stay invisible.
      const after = await agentTeams.readInstitutionCatalog()
      const afterLeadId = after.leads[options.squadId]
      if (afterLeadId !== String(committed.leadSessionId)) {
        const diverged: InstitutionAdoptionRecord = {
          ...committed,
          status: 'repair_needed',
          error: `Legacy catalog lead binding changed from '${committed.leadSessionId}' to '${afterLeadId ?? 'none'}' after repair`,
          updatedAt: Date.now(),
        }
        const persisted = this.catalog
          ? await this.catalog.updateAdoption(options.squadId, committed.revision, diverged)
          : { ...diverged, revision: committed.revision + 1 }
        this.adoptions.set(options.squadId, persisted)
        return { result: persisted }
      }

      return { result: committed }
    })
  }

  /**
   * Provision a team into runtime sessions through the generated Remote API.
   * @param teamId - team definition identifier.
   * @returns provisioned team and seat instance sessions.
   */
  @Remote('provisionTeam')
  async remoteProvisionTeam(
    teamId: TeamDefinitionId,
  ): Promise<{ team: TeamDefinition; coordinatorSessionId: SessionId; seatInstances: Record<string, SessionId> }> {
    return await this.provisionTeam(teamId)
  }

  /**
   * Dispatch a user prompt to a team's coordinator through the generated Remote API.
   * @param teamId - team definition identifier.
   * @param request - session prompt request.
   * @returns prompt execution result.
   */
  @Remote('dispatchCoordinator')
  async remoteDispatchCoordinator(teamId: TeamDefinitionId, request: SessionPromptRequest): Promise<SessionPromptValue> {
    return await this.dispatchCoordinator(teamId, request)
  }

  // --- Scoped Memory API ---

  /**
   * Save a persistent memory entry for a profile or team scope.
   * @param scope - memory scope.
   * @param text - memory content text.
   * @param options - optional source session and author options.
   * @returns saved memory entry.
   */
  @Remote('saveMemory')
  async saveMemory(scope: MemoryScope, text: string, options?: SaveMemoryOptions): Promise<MemoryEntry> {
    await this.ensureCatalogReady()
    if (scope.kind === 'profile' ? this.lifecycleChanges.has(scope.profileId) ||
      this.getProfileSync(scope.profileId)?.deletedAt !== undefined
      : this.lifecycleChanges.has(scope.teamId) ||
        this.getTeamSync(scope.teamId)?.deletedAt !== undefined) throw new Error('Memory owner was deleted')
    const trimmed = text.trim()
    if (!trimmed) {
      throw new Error('Memory text cannot be empty')
    }
    if (trimmed.length > MEMORY_TEXT_MAX_LENGTH) {
      throw new Error(`Memory text exceeds maximum length of ${MEMORY_TEXT_MAX_LENGTH} characters`)
    }
    const effectiveOptions = options ?? {}
    let entry: MemoryEntry
    if (this.catalog) {
      entry = await this.catalog.saveMemory(scope, trimmed, effectiveOptions)
    } else {
      const id = MemoryEntryId(randomUUID())
      const now = Date.now()
      entry = {
        id,
        scope,
        text: trimmed,
        ...(effectiveOptions.sourceSessionId !== undefined ? { sourceSessionId: effectiveOptions.sourceSessionId } : {}),
        ...(effectiveOptions.sourceEventSeq !== undefined ? { sourceEventSeq: effectiveOptions.sourceEventSeq } : {}),
        ...(effectiveOptions.author !== undefined ? { author: effectiveOptions.author } : {}),
        ...(effectiveOptions.grants !== undefined ? { grants: effectiveOptions.grants } : {}),
        createdAt: now,
        updatedAt: now,
        revision: 1,
      }
    }
    this.memories.set(entry.id, entry)
    return entry
  }

  /**
   * Update an existing memory entry with CAS revision check.
   * @param id - memory entry identifier.
   * @param expectedRevision - expected revision for CAS.
   * @param text - updated memory text.
   * @returns updated memory entry.
   */
  @Remote('updateMemory')
  async updateMemory(id: MemoryEntryId, expectedRevision: number, text: string): Promise<MemoryEntry> {
    await this.ensureCatalogReady()
    const trimmed = text.trim()
    if (!trimmed) {
      throw new Error('Memory text cannot be empty')
    }
    if (trimmed.length > MEMORY_TEXT_MAX_LENGTH) {
      throw new Error(`Memory text exceeds maximum length of ${MEMORY_TEXT_MAX_LENGTH} characters`)
    }
    let updated: MemoryEntry
    if (this.catalog) {
      updated = await this.catalog.updateMemory(id, expectedRevision, trimmed)
    } else {
      const existing = this.memories.get(id)
      if (!existing) {
        throw new Error(`Memory entry '${id}' not found`)
      }
      if (existing.revision !== expectedRevision) {
        throw new RevisionConflictError('memory', id, expectedRevision, existing.revision)
      }
      updated = {
        ...existing,
        text: trimmed,
        revision: existing.revision + 1,
        updatedAt: Date.now(),
      }
    }
    this.memories.set(id, updated)
    return updated
  }

  /**
   * Mark a memory entry as removed (tombstone) with optional CAS revision check.
   * @param id - memory entry identifier.
   * @param expectedRevision - optional expected revision.
   * @returns removed memory entry.
   */
  @Remote('removeMemory')
  async removeMemory(id: MemoryEntryId, expectedRevision?: number): Promise<MemoryEntry> {
    await this.ensureCatalogReady()
    let removed: MemoryEntry
    if (this.catalog) {
      removed = await this.catalog.removeMemory(id, expectedRevision)
    } else {
      const existing = this.memories.get(id)
      if (!existing) {
        throw new Error(`Memory entry '${id}' not found`)
      }
      if (expectedRevision !== undefined && existing.revision !== expectedRevision) {
        throw new RevisionConflictError('memory', id, expectedRevision, existing.revision)
      }
      if (existing.removedAt !== undefined) {
        return existing
      }
      removed = {
        ...existing,
        removedAt: Date.now(),
        revision: existing.revision + 1,
        updatedAt: Date.now(),
      }
    }
    this.memories.set(id, removed)
    return removed
  }

  /**
   * Archive a memory entry with optional CAS revision check.
   * @param id - memory entry identifier.
   * @param expectedRevision - optional expected revision.
   * @returns archived memory entry.
   */
  @Remote('archiveMemory')
  async archiveMemory(id: MemoryEntryId, expectedRevision?: number): Promise<MemoryEntry> {
    await this.ensureCatalogReady()
    let archived: MemoryEntry
    if (this.catalog) {
      archived = await this.catalog.archiveMemory(id, expectedRevision)
    } else {
      const existing = this.memories.get(id)
      if (!existing) {
        throw new Error(`Memory entry '${id}' not found`)
      }
      if (expectedRevision !== undefined && existing.revision !== expectedRevision) {
        throw new RevisionConflictError('memory', id, expectedRevision, existing.revision)
      }
      if (existing.archivedAt !== undefined) {
        return existing
      }
      archived = {
        ...existing,
        archivedAt: Date.now(),
        revision: existing.revision + 1,
        updatedAt: Date.now(),
      }
    }
    this.memories.set(id, archived)
    return archived
  }

  /**
   * Unarchive a memory entry with optional CAS revision check.
   * @param id - memory entry identifier.
   * @param expectedRevision - optional expected revision.
   * @returns unarchived memory entry.
   */
  @Remote('unarchiveMemory')
  async unarchiveMemory(id: MemoryEntryId, expectedRevision?: number): Promise<MemoryEntry> {
    await this.ensureCatalogReady()
    let unarchived: MemoryEntry
    if (this.catalog) {
      unarchived = await this.catalog.unarchiveMemory(id, expectedRevision)
    } else {
      const existing = this.memories.get(id)
      if (!existing) {
        throw new Error(`Memory entry '${id}' not found`)
      }
      if (expectedRevision !== undefined && existing.revision !== expectedRevision) {
        throw new RevisionConflictError('memory', id, expectedRevision, existing.revision)
      }
      if (existing.archivedAt === undefined) {
        return existing
      }
      const { archivedAt: _archivedAt, ...rest } = existing
      unarchived = {
        ...rest,
        revision: existing.revision + 1,
        updatedAt: Date.now(),
      }
    }
    this.memories.set(id, unarchived)
    return unarchived
  }

  /**
   * Grant access to a profile-scoped memory entry to a specific team.
   * @param id - memory entry identifier.
   * @param teamId - recipient team identifier.
   * @param expectedRevision - optional expected revision.
   * @returns updated memory entry.
   */
  @Remote('grantMemory')
  async grantMemory(id: MemoryEntryId, teamId: TeamDefinitionId, expectedRevision?: number): Promise<MemoryEntry> {
    await this.ensureCatalogReady()
    let updated: MemoryEntry
    if (this.catalog) {
      updated = await this.catalog.grantMemory(id, teamId, expectedRevision)
    } else {
      const existing = this.memories.get(id)
      if (!existing) {
        throw new Error(`Memory entry '${id}' not found`)
      }
      if (existing.scope.kind !== 'profile') {
        throw new Error(`Only profile memories can be granted to teams; entry '${id}' is a team memory`)
      }
      if (expectedRevision !== undefined && existing.revision !== expectedRevision) {
        throw new RevisionConflictError('memory', id, expectedRevision, existing.revision)
      }
      const currentGrants = existing.grants ?? []
      if (currentGrants.includes(teamId)) {
        return existing
      }
      updated = {
        ...existing,
        grants: [...currentGrants, teamId],
        revision: existing.revision + 1,
        updatedAt: Date.now(),
      }
    }
    this.memories.set(id, updated)
    return updated
  }

  /**
   * Revoke a team grant from a profile-scoped memory entry.
   * @param id - memory entry identifier.
   * @param teamId - team identifier to revoke.
   * @param expectedRevision - optional expected revision.
   * @returns updated memory entry.
   */
  @Remote('revokeMemoryGrant')
  async revokeMemoryGrant(id: MemoryEntryId, teamId: TeamDefinitionId, expectedRevision?: number): Promise<MemoryEntry> {
    await this.ensureCatalogReady()
    let updated: MemoryEntry
    if (this.catalog) {
      updated = await this.catalog.revokeMemoryGrant(id, teamId, expectedRevision)
    } else {
      const existing = this.memories.get(id)
      if (!existing) {
        throw new Error(`Memory entry '${id}' not found`)
      }
      if (expectedRevision !== undefined && existing.revision !== expectedRevision) {
        throw new RevisionConflictError('memory', id, expectedRevision, existing.revision)
      }
      const currentGrants = existing.grants ?? []
      if (!currentGrants.includes(teamId)) {
        return existing
      }
      const updatedGrants = currentGrants.filter(t => t !== teamId)
      updated = {
        ...existing,
        ...(updatedGrants.length > 0 ? { grants: updatedGrants } : { grants: undefined }),
        revision: existing.revision + 1,
        updatedAt: Date.now(),
      }
    }
    this.memories.set(id, updated)
    return updated
  }

  /**
   * Get a memory entry by identifier.
   * @param id - memory entry identifier.
   * @returns memory entry or undefined.
   */
  @Remote('getMemory')
  async getMemory(id: MemoryEntryId): Promise<MemoryEntry | undefined> {
    await this.ensureCatalogReady()
    return this.getMemorySync(id)
  }

  /**
   * Synchronous memory lookup.
   * @param id - memory entry identifier.
   * @returns memory entry or undefined.
   */
  getMemorySync(id: MemoryEntryId): MemoryEntry | undefined {
    return this.memories.get(id)
  }

  /**
   * List memory entries matching a scope.
   * @param scope - memory scope.
   * @param options - filter options.
   * @returns readonly array of memory entries.
   */
  @Remote('listMemory')
  async listMemory(scope: MemoryScope, options?: ListMemoryOptions): Promise<readonly MemoryEntry[]> {
    await this.ensureCatalogReady()
    return this.listMemorySync(scope, options)
  }

  /**
   * Synchronous memory list for prompt injection and local lookups.
   * @param scope - memory scope.
   * @param options - filter options.
   * @returns readonly array of memory entries.
   */
  listMemorySync(scope: MemoryScope, options: ListMemoryOptions = {}): readonly MemoryEntry[] {
    if (scope.kind === 'profile' ? this.getProfileSync(scope.profileId)?.deletedAt !== undefined
      : this.getTeamSync(scope.teamId)?.deletedAt !== undefined) return []
    const all = [...this.memories.values()].filter((e) => {
      if (scope.kind === 'profile') {
        if (e.scope.kind !== 'profile' || e.scope.profileId !== scope.profileId) return false
      } else {
        if (e.scope.kind !== 'team' || e.scope.teamId !== scope.teamId) return false
      }
      if (!options.includeRemoved && e.removedAt !== undefined) {
        return false
      }
      if (!options.includeArchived && e.archivedAt !== undefined) {
        return false
      }
      return true
    })
    all.sort((a, b) => a.createdAt - b.createdAt)
    if (options.limit !== undefined && options.limit > 0) {
      return all.slice(0, options.limit)
    }
    return all
  }

  /**
   * List profile memories granted to a specific team synchronously.
   * @param teamId - recipient team identifier.
   * @param profileId - optional profile filter.
   * @returns readonly array of granted profile memories.
   */
  listGrantedProfileMemoriesSync(teamId: TeamDefinitionId, profileId?: AssistantProfileId): readonly MemoryEntry[] {
    if (this.catalog) {
      return this.catalog.listGrantedProfileMemories(teamId, profileId)
    }
    return [...this.memories.values()].filter((e) => {
      if (e.scope.kind !== 'profile') return false
      if (profileId !== undefined && e.scope.profileId !== profileId) return false
      if (e.removedAt !== undefined || e.archivedAt !== undefined) return false
      return e.grants !== undefined && e.grants.includes(teamId)
    })
  }

  /**
   * Recall active memory entries matching a query.
   * @param scope - memory scope.
   * @param query - optional search string.
   * @returns matching active memory entries.
   */
  @Remote('recallMemory')
  async recallMemory(scope: MemoryScope, query?: string): Promise<readonly MemoryEntry[]> {
    await this.ensureCatalogReady()
    return this.recallMemorySync(scope, query)
  }

  /**
   * Synchronous recall for prompt injection and local search.
   * @param scope - memory scope.
   * @param query - optional search string.
   * @returns matching active memory entries.
   */
  recallMemorySync(scope: MemoryScope, query?: string): readonly MemoryEntry[] {
    const active = this.listMemorySync(scope, { includeRemoved: false })
    if (!query || query.trim().length === 0) {
      return active
    }
    const q = query.trim().toLowerCase()
    return active.filter(e => e.text.toLowerCase().includes(q))
  }

  /**
   * Promote a team-scoped memory entry into an assistant's private profile memory.
   * Requires explicit owner authorization; team members cannot promote unilaterally.
   * @param teamMemoryId - id of the team memory entry.
   * @param targetProfileId - profile receiving the promoted memory.
   * @param authorized - whether this promotion is authorized by the owner.
   * @returns newly created profile memory entry.
   */
  @Remote('promoteTeamMemoryToProfile')
  async promoteTeamMemoryToProfile(
    teamMemoryId: MemoryEntryId,
    targetProfileId: AssistantProfileId,
    authorized: boolean,
  ): Promise<MemoryEntry> {
    await this.ensureCatalogReady()
    if (!authorized) {
      throw new Error('Owner authorization required to promote team memory into private profile memory')
    }
    const teamMem = this.memories.get(teamMemoryId)
    if (!teamMem || teamMem.scope.kind !== 'team') {
      throw new Error(`Team memory entry '${teamMemoryId}' not found`)
    }
    if (teamMem.removedAt !== undefined) {
      throw new Error(`Cannot promote removed memory entry '${teamMemoryId}'`)
    }
    const profile = this.profiles.get(targetProfileId)
    if (!profile) {
      throw new Error(`Target assistant profile '${targetProfileId}' not found`)
    }
    return await this.saveMemory({ kind: 'profile', profileId: targetProfileId }, teamMem.text, {
      ...(teamMem.sourceSessionId !== undefined ? { sourceSessionId: teamMem.sourceSessionId } : {}),
      ...(teamMem.sourceEventSeq !== undefined ? { sourceEventSeq: teamMem.sourceEventSeq } : {}),
      author: `promoted-from-team:${teamMem.scope.teamId}`,
    })
  }

  /**
   * Acquire exclusive execution ownership over a session for a slot.
   * @param params - round, slot, attempt, session, and owner details.
   * @returns established or existing re-entrant ownership token.
   */
  acquireExecutionOwnership(params: AcquireOwnershipParams): ExecutionOwnershipToken {
    return this.ownership.acquireOwnership(params)
  }

  /**
   * Release execution ownership for a session.
   * @param tokenOrSessionId - token or target session identifier.
   * @returns true if an active token was removed.
   */
  releaseExecutionOwnership(tokenOrSessionId: string | ExecutionOwnershipToken | SessionId): boolean {
    return this.ownership.releaseOwnership(tokenOrSessionId)
  }

  /**
   * Look up the currently active ownership token for a session.
   * @param sessionId - target session identity.
   * @returns active token or undefined.
   */
  getExecutionOwnership(sessionId: SessionId): ExecutionOwnershipToken | undefined {
    return this.ownership.getOwnership(sessionId)
  }

  /**
   * Retrieve all recorded conflicts for a session.
   * @param sessionId - target session identity.
   * @returns list of detected conflicts.
   */
  getOwnershipConflicts(sessionId: SessionId): readonly ForeignOwnershipConflict[] {
    return this.ownership.getConflicts(sessionId)
  }

  /**
   * Whether any conflicts have been recorded for a session.
   * @param sessionId - target session identity.
   * @returns true if conflicts exist.
   */
  hasOwnershipConflict(sessionId: SessionId): boolean {
    return this.ownership.hasConflict(sessionId)
  }

  /**
   * Clear all recorded conflicts for a session.
   * @param sessionId - target session identity.
   */
  clearOwnershipConflicts(sessionId: SessionId): void {
    this.ownership.clearConflicts(sessionId)
  }

  /**
   * Hold a slot input in the fork-owned queue before the slot starts.
   * @param params - round, slot, attempt, session, and payload.
   * @returns the created queued slot entry.
   */
  enqueueSlotInput<T>(params: EnqueueSlotInputParams<T>): QueuedSlotInput<T> {
    return this.ownership.enqueueSlotInput(params)
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
    return this.ownership.startSlot(roundId, slotId, options)
  }

  /**
   * Cancel a slot. If unstarted in queue, removes only that slot input.
   * If actively executing, interrupts only that slot's work and releases ownership.
   * @param roundId - group round identity.
   * @param slotId - slot identity.
   * @param reason - optional cancellation reason.
   * @returns result stating whether cancellation occurred and whether the slot was active.
   */
  cancelSlot(roundId: string, slotId: string, reason?: string): CancelSlotResult {
    return this.ownership.cancelSlot(roundId, slotId, reason)
  }

  /**
   * Mark a slot execution as completed or failed, releasing its ownership.
   * @param roundId - group round identity.
   * @param slotId - slot identity.
   * @param error - optional failure error string.
   */
  completeSlot(roundId: string, slotId: string, error?: string): void {
    this.ownership.completeSlot(roundId, slotId, error)
  }

  /**
   * List all queued slot inputs, optionally filtered by round.
   * @param roundId - optional round filter.
   * @returns list of queued slot inputs.
   */
  listQueuedSlotInputs(roundId?: string): readonly QueuedSlotInput[] {
    return this.ownership.listQueue(roundId)
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
    return this.ownership.validateSubmission(sessionId, callerInfo)
  }

  /**
   * Create a new group discussion room.
   * @param options - discussion creation options.
   * @returns newly created discussion.
   */
  @Remote('createDiscussion')
  async createDiscussion(options: CreateGroupDiscussionOptions): Promise<GroupDiscussion> {
    return this.roundScheduler.createDiscussion(options)
  }

  /**
   * Get an existing group discussion by id.
   * @param id - discussion identifier.
   * @returns discussion or undefined.
   */
  getDiscussion(id: GroupDiscussionId): GroupDiscussion | undefined {
    return this.roundScheduler.getDiscussion(id)
  }

  /**
   * List all discussions belonging to a team.
   * @param teamId - team definition identifier.
   * @returns array of discussions.
   */
  listDiscussions(teamId: TeamDefinitionId): readonly GroupDiscussion[] {
    return this.roundScheduler.listDiscussions(teamId)
  }

  /**
   * List all discussions belonging to a team via Typert Remote.
   * @param teamId - team definition identifier.
   * @returns array of discussions.
   */
  @Remote('listDiscussions')
  async remoteListDiscussions(teamId: TeamDefinitionId): Promise<readonly GroupDiscussion[]> {
    return this.roundScheduler.listDiscussions(teamId)
  }

  /**
   * Schedule a new group round according to coordinator-first and explicit-recipient rules.
   * @param options - round scheduling options.
   * @returns newly scheduled group round journal entry.
   */
  @Remote('scheduleRound')
  async scheduleRound(options: ScheduleRoundOptions): Promise<GroupRoundJournalEntry> {
    return this.roundScheduler.scheduleRound(options)
  }

  /**
   * Execute a scheduled group round with committed cursors and bounds.
   * @param roundId - identifier of round to execute.
   * @param options - execution options.
   * @returns completed or terminated round record.
   */
  async executeRound(roundId: GroupRoundId, options?: ExecuteRoundOptions): Promise<GroupRoundJournalEntry> {
    return this.roundScheduler.executeRound(roundId, options)
  }

  /**
   * Execute owned seat work using the production executor over RPC.
   * @param roundId - admitted round identity.
   * @param signal - caller cancellation for the owned execution.
   * @returns terminal or explicitly uncertain round record.
   */
  @Remote('executeRound')
  async remoteExecuteRound(roundId: GroupRoundId, signal?: AbortSignal): Promise<GroupRoundJournalEntry> {
    return this.executeRound(roundId, signal ? { signal } : {})
  }

  /**
   * Start owned execution without occupying a serialized desktop RPC channel.
   * Poll getRound for completion; cancelRound stops owned work. Execution errors
   * remain visible through getRound until an explicit start retries recovery.
   * @param roundId - durably admitted round identity.
   * @returns retained admission record; execution may still be pending or active.
   */
  @Remote('startRound')
  async startRound(roundId: GroupRoundId): Promise<GroupRoundJournalEntry> {
    if (this.disposed) throw new Error('Assistant service is disposed')
    const round = this.roundScheduler.journal.getRound(roundId)
    if (!round) throw new Error(`Group round '${roundId}' not found`)
    if (!this.backgroundRoundTasks.has(roundId)) {
      this.backgroundRoundErrors.delete(roundId)
      const task = this.executeRound(roundId).then(
        () => {},
        (error) => {
          const failure = error instanceof Error ? error : new Error(String(error))
          this.backgroundRoundErrors.set(roundId, failure)
          this.ctx.logger.warn('Background round execution failed', failure)
        },
      )
      this.backgroundRoundTasks.set(roundId, task)
      void task.then(() => {
        if (this.backgroundRoundTasks.get(roundId) === task) this.backgroundRoundTasks.delete(roundId)
      })
    }
    return this.roundScheduler.journal.getRound(roundId) ?? round
  }

  /**
   * Read an admitted round and its durable slot checkpoints.
   * @param roundId - admitted round identity.
   * @returns retained round record when present.
   */
  @Remote('getRound')
  async getRound(roundId: GroupRoundId): Promise<GroupRoundJournalEntry | undefined> {
    const error = this.backgroundRoundErrors.get(roundId)
    if (error) throw error
    return this.roundScheduler.journal.getRound(roundId)
  }

  /**
   * Query the public transcript with scope authorization, pagination, and source attribution.
   * @param options - query options.
   * @returns paginated transcript result.
   */
  @Remote('queryPublicTranscript')
  async queryPublicTranscript(options: QueryPublicTranscriptOptions): Promise<QueryPublicTranscriptResult> {
    return this.roundScheduler.queryPublicTranscript(options)
  }

  /**
   * Cancel an in-progress or pending group round.
   * @param roundId - round identifier.
   * @param reason - cancellation reason.
   * @returns updated round journal entry.
   */
  @Remote('cancelRound')
  async cancelRound(roundId: GroupRoundId, reason?: string): Promise<GroupRoundJournalEntry> {
    return this.roundScheduler.cancelRound(roundId, reason)
  }

  /**
   * Publish a committed but not-yet-posted reply during crash recovery.
   * @param roundId - round identifier.
   * @param slotId - slot identifier.
   * @returns committed public message.
   */
  async publishCommittedReply(roundId: GroupRoundId, slotId: RoundSlotId): Promise<GroupTranscriptMessage> {
    return this.roundScheduler.publishCommittedReply(roundId, slotId)
  }

  /**
   * Set durable read cursor for a logical conversation or discussion.
   * @param conversationId - conversation or discussion identifier.
   * @param lastReadSeq - highest event sequence number read.
   * @param windowId - optional window identifier.
   * @returns updated read cursor record.
   */
  @Remote('setReadCursor')
  async setReadCursor(conversationId: string, lastReadSeq: number, windowId?: string): Promise<ReadCursorRecord> {
    return this.readCursors.setReadCursor(conversationId, lastReadSeq, windowId)
  }

  /**
   * Get durable read cursor for a conversation or discussion.
   * @param conversationId - conversation or discussion identifier.
   * @returns read cursor record or undefined.
   */
  getReadCursor(conversationId: string): ReadCursorRecord | undefined {
    return this.readCursors.getReadCursor(conversationId)
  }

  /**
   * Get durable read cursor via Typert Remote.
   * @param conversationId - conversation or discussion identifier.
   * @returns read cursor record or undefined.
   */
  @Remote('getReadCursor')
  async remoteGetReadCursor(conversationId: string): Promise<ReadCursorRecord | undefined> {
    return this.readCursors.getReadCursor(conversationId)
  }

  /**
   * Calculate unread event count for a conversation.
   * @param conversationId - conversation identifier.
   * @param latestSeq - latest known event sequence number.
   * @returns unread count.
   */
  getUnreadCount(conversationId: string, latestSeq: number): number {
    return this.readCursors.getUnreadCount(conversationId, latestSeq)
  }

  /**
   * Search events across permitted sessions with stable author attribution.
   * @param request - query parameters.
   * @param auth - scope authorization parameters.
   * @returns matched event hits with stable attribution.
   */
  async searchEventsScoped(
    request: { query: string; limit?: number },
    auth: ScopedQueryAuthorization,
  ): Promise<readonly ScopedSessionEventHit[]> {
    return this.scopedQuery.searchEvents(request, auth)
  }

  /**
   * Observe a session within authorized scope boundaries.
   * @param sessionId - target session identifier.
   * @param auth - scope authorization parameters.
   * @returns session observation handle.
   */
  async observeSessionScoped(sessionId: SessionId, auth: ScopedQueryAuthorization): Promise<unknown> {
    return this.scopedQuery.observeSession(sessionId, auth)
  }

  /**
   * Record an auxiliary inference call (e.g. title, review, prediction).
   * @param record - auxiliary usage record.
   * @returns void promise.
   */
  @Remote('recordAuxiliaryUsage')
  async recordAuxiliaryUsage(record: AuxiliaryUsageRecord): Promise<void> {
    return this.usage.recordAuxiliaryUsage(record)
  }

  /**
   * Aggregate usage over sessions or bindings according to request criteria.
   * @param request - aggregation request.
   * @returns array of binding usage summaries.
   */
  @Remote('aggregateUsage')
  async aggregateUsage(request: AggregateUsageRequest): Promise<readonly BindingUsageSummary[]> {
    return this.usage.aggregateUsage(request)
  }

  /**
   * Perform bounded per-turn memory review.
   * Filters out secrets and system instructions, deduplicates against existing memories in scope,
   * adds accepted entries to the catalog, and accounts for auxiliary inference usage.
   * @param request - review turn request parameters.
   * @returns review result containing candidate, added, and rejected entries.
   */
  @Remote('reviewTurn')
  async reviewTurn(request: ReviewTurnRequest): Promise<ReviewTurnResult> {
    this.assertSessionUsable(request.sessionId)
    return this.reviewPredictions.reviewTurn(request)
  }

  /**
   * Return one bounded tool-free prediction for an eligible completed turn.
   * Reuse a matching suggestion started from the live reply when available.
   * Authoritatively checks session existence, usability, scope, idle state, and latest completed turn.
   * Disregards remote client-supplied context text; reconstructs context canonically on Host.
   * Single-flights equivalent requests across windows.
   * Bounded by maxPredictionTokens and predictionTimeoutMs. Accounts for auxiliary usage.
   * Records auxiliary evidence without adding a conversation turn or public reply.
   * Desktop consumers use streamComposerPrediction to keep the carrier available.
   * @param request - composer prediction request parameters.
   * @param signal - cancellation for the auxiliary model request.
   * @returns composer prediction result or null if disabled / ineligible / failed.
   */
  @Remote('predictComposer')
  async predictComposer(request: ComposerPredictionRequest, signal?: AbortSignal): Promise<ComposerPredictionResult | null> {
    if (!this.isComposerPredictionsEnabled()) return null
    if (signal?.aborted) return null
    if (request.draftText !== undefined && request.draftText.length > 0) return null

    // Ingress verification: session existence
    const liveSession = this.sessions?.get(request.sessionId)
    if (!liveSession) return null

    try {
      this.assertSessionUsable(request.sessionId)
    } catch {
      return null
    }

    // Ingress authorization: scope verification
    if (request.scope?.profileId) {
      const conv = this.getConversationBySessionSync(request.sessionId)
      const seat = this.getSeatBySessionSync(request.sessionId)
      const boundProfileId = conv?.profileId ?? seat?.profileId
      if (boundProfileId !== request.scope.profileId) return null
    }
    if (request.scope?.teamId) {
      const teamId = this.getTeamIdBySessionSync(request.sessionId)
      if (teamId !== request.scope.teamId) return null
    }

    // Retired seat check
    const seat = this.getSeatBySessionSync(request.sessionId)
    if (seat?.retiredAt !== undefined) return null

    // Agent running check
    const agent = this.agents?.get(request.sessionId)
    if (agent && agent.status === 'running') return null

    const binding = this.predictionBindingIdentity(request.sessionId)
    const early = this.earlyPredictions.get(request.sessionId)
    const currentRoute = this.resolveRouteForPrediction(request.sessionId)
    if (early?.session === liveSession && early.binding === binding && currentRoute &&
      early.route.provider === currentRoute.provider && early.route.model === currentRoute.model &&
      early.route.reasoningEffort === currentRoute.reasoningEffort &&
      this.isPredictionSessionEligible(request, liveSession, request.asOfSeq, binding)) {
      const result = await early.promise
      return result && !signal?.aborted &&
        this.isPredictionSessionEligible(request, liveSession, request.asOfSeq, binding)
        ? { ...result, asOfSeq: request.asOfSeq } : null
    }

    // Canonical context reconstruction on Host (disregards client-supplied recentTexts)
    const context = await this.readCompletedTurnContext(request.sessionId, request.asOfSeq)
    if (!context) return null

    const validate = () => this.isPredictionSessionEligible(request, liveSession, context.asOfSeq, binding)

    return this.reviewPredictions.predictComposer(
      {
        ...request,
        asOfSeq: context.asOfSeq,
        recentTexts: context.recentTexts,
      },
      signal,
      () => this.resolveRouteForPrediction(request.sessionId),
      validate,
    )
  }

  private cancelEarlyPrediction(sessionId: SessionId): void {
    this.predictionReplyPrefixes.delete(sessionId)
    const early = this.earlyPredictions.get(sessionId)
    this.earlyPredictions.delete(sessionId)
    early?.controller.abort()
  }

  private cancelEarlyPredictions(): void {
    for (const sessionId of this.earlyPredictions.keys()) this.cancelEarlyPrediction(sessionId)
    this.predictionReplyPrefixes.clear()
  }

  private startEarlyPrediction(agent: Agent, attemptId: string, turn: number, partialReply: string): void {
    const sessionId = agent.session.id
    const session = this.sessions?.get(sessionId)
    if (!session || this.earlyPredictions.has(sessionId) || agent.status !== 'running') return
    if ((session.header.delegationDepth ?? 0) > 0 || this.getSeatBySessionSync(sessionId)?.role === 'teammate') return
    const start = this.predictionTurnStarts.get(sessionId)
    if (!start || start.session !== session || start.turn !== turn) return
    try {
      this.assertSessionUsable(sessionId)
    } catch {
      return
    }
    if (this.getSeatBySessionSync(sessionId)?.retiredAt !== undefined) return
    const query = this.ctx.get('sessionQuery')
    if (!query) return
    const route = this.resolveRouteForPrediction(sessionId)
    if (!route) return
    const binding = this.predictionBindingIdentity(sessionId)
    const controller = new AbortController()
    const early: EarlyPrediction = {
      session, attemptId, binding, route, controller,
      promise: Promise.resolve(null),
    }
    const valid = (): boolean => {
      if (this.disposed || !this.isComposerPredictionsEnabled() || controller.signal.aborted) return false
      if (this.earlyPredictions.get(sessionId) !== early || this.sessions?.get(sessionId) !== session ||
        this.agents?.get(sessionId) !== agent || this.predictionTurnStarts.get(sessionId) !== start) return false
      if (this.predictionBindingIdentity(sessionId) !== binding ||
        this.getSeatBySessionSync(sessionId)?.retiredAt !== undefined) return false
      try {
        this.assertSessionUsable(sessionId)
      } catch {
        return false
      }
      return true
    }
    this.earlyPredictions.set(sessionId, early)
    early.promise = (async () => {
      const observation = await query.observeSession(sessionId, { signal: controller.signal })
      try {
        if (!valid()) return null
        const context = streamingPredictionContext(
          observation.events, start.seq, partialReply, this.config.predictionContextMaxBytes ?? 8192,
        )
        if (!context) {
          if (this.earlyPredictions.get(sessionId) === early) this.earlyPredictions.delete(sessionId)
          return null
        }
        return await this.reviewPredictions.predictComposer(
          { sessionId, asOfSeq: start.seq, draftText: '', recentTexts: context.recentTexts },
          controller.signal,
          () => this.resolveRouteForPrediction(sessionId),
          valid,
        )
      } finally {
        observation[Symbol.dispose]()
      }
    })().catch((error: unknown) => {
      if (!controller.signal.aborted) this.ctx.logger.warn('Early composer prediction failed: %s', error)
      return null
    })
  }

  /**
   * Prepare bounded completed-turn text for the active composer.
   * Supports ordinary chats, assistants, and team coordinators.
   * @param sessionId - active composer session.
   * @returns context for the latest successful completed turn, or null when ineligible.
   */
  @Remote('getComposerContext')
  async getComposerContext(sessionId: SessionId): Promise<ComposerPredictionContext | null> {
    if (!this.isComposerPredictionsEnabled()) return null
    try {
      this.assertSessionUsable(sessionId)
    } catch {
      return null
    }

    const seat = this.getSeatBySessionSync(sessionId)
    if (seat?.retiredAt !== undefined) return null

    const agent = this.agents?.get(sessionId)
    if (agent && agent.status === 'running') return null

    const liveSession = this.sessions?.get(sessionId)
    if (!liveSession) return null
    const binding = this.predictionBindingIdentity(sessionId)
    const context = await this.readCompletedTurnContext(sessionId)
    if (!context || !this.isPredictionSessionEligible(
      { sessionId, asOfSeq: context.asOfSeq }, liveSession, context.asOfSeq, binding,
    )) return null
    return context
  }

  /**
   * Deliver one prediction without holding the desktop unary request queue.
   * @param request - prediction identity and current draft.
   * @param signal - stream lifetime; closing the stream releases this subscriber.
   * @returns one completed prediction or null, then closes.
   */
  @Remote({ mode: 'stream' })
  async *streamComposerPrediction(request: ComposerPredictionRequest, signal: AbortSignal): AsyncIterable<ComposerPredictionResult | null> {
    yield await this.predictComposer(request, signal)
  }

  private predictionBindingIdentity(sessionId: SessionId): string {
    return JSON.stringify([
      this.getConversationBySessionSync(sessionId)?.id,
      this.getConversationBySessionSync(sessionId)?.profileId,
      this.getSeatBySessionSync(sessionId)?.id,
      this.getSeatBySessionSync(sessionId)?.profileId,
      this.getTeamIdBySessionSync(sessionId),
    ])
  }

  private isPredictionSessionEligible(
    request: ComposerPredictionRequest,
    session: Session,
    endSeq: number,
    binding: string,
  ): boolean {
    if (this.disposed || !this.isComposerPredictionsEnabled()) return false
    if (this.sessions?.get(request.sessionId) !== session) return false
    try {
      this.assertSessionUsable(request.sessionId)
    } catch {
      return false
    }
    if (this.predictionBindingIdentity(request.sessionId) !== binding) return false
    const seat = this.getSeatBySessionSync(request.sessionId)
    if (seat?.retiredAt !== undefined) return false
    if (request.scope?.profileId && request.scope.profileId !==
      (this.getConversationBySessionSync(request.sessionId)?.profileId ?? seat?.profileId)) return false
    if (request.scope?.teamId && request.scope.teamId !== this.getTeamIdBySessionSync(request.sessionId)) return false
    if (this.agents?.get(request.sessionId)?.status === 'running') return false
    const events = session.snapshotEvents()
    const lastEnd = events.findLast(event => event.type === 'turn/end')
    return lastEnd?.seq === endSeq && lastEnd.data.reason.kind === 'completed'
  }

  private resolveRouteForPrediction(sessionId: SessionId): { provider: string; model: string; reasoningEffort?: string } | undefined {
    const captured = this.resolveEffectiveRoute(sessionId)
    if (captured?.route.provider && captured?.route.model) {
      return {
        provider: captured.route.provider,
        model: captured.route.model,
        ...(captured.route.reasoningEffort ? { reasoningEffort: captured.route.reasoningEffort } : {}),
      }
    }

    const session = this.sessions?.get(sessionId)
    if (session) {
      const projections = this.ctx.get('sessionProjections') as {
        snapshot?: (s: unknown) => {
          values?: {
            modelSelection?: {
              next?: { provider: string; model: string; reasoningEffort?: string } | null
              lastUsed?: { provider: string; model: string; reasoningEffort?: string } | null
            }
          }
        }
      } | undefined
      if (projections?.snapshot) {
        try {
          const snapshot = projections.snapshot(session)
          const sel = snapshot.values?.modelSelection?.next ?? snapshot.values?.modelSelection?.lastUsed
          if (sel?.provider && sel?.model) {
            return {
              provider: sel.provider,
              model: sel.model,
              ...(sel.reasoningEffort ? { reasoningEffort: sel.reasoningEffort } : {}),
            }
          }
        } catch {
          // projection not available
        }
      }

      const header = session.requestHeader()
      if (header?.config.provider && header?.config.model) {
        return {
          provider: header.config.provider,
          model: header.config.model,
          ...(header.config.reasoningEffort ? { reasoningEffort: String(header.config.reasoningEffort) } : {}),
        }
      }
    }

    const defaultModel = this.ctx.get('agentDefaultModel') as { currentSelection: () => { provider: string; model: string } } | undefined
    if (defaultModel) {
      const sel = defaultModel.currentSelection()
      if (sel?.provider && sel?.model) {
        return { provider: sel.provider, model: sel.model }
      }
    }

    return undefined
  }

  private async readCompletedTurnContext(sessionId: SessionId, endSeq?: number,
    prediction = true): Promise<ComposerPredictionContext | null> {
    const query = this.ctx.get('sessionQuery') as import('@deepseek-ai/dsh-session-query').SessionQueryEngine | undefined
    if (!query) throw new Error('Assistant completed-turn context requires sessionQuery')
    let observation
    try {
      observation = await query.observeSession(sessionId)
    } catch {
      return null
    }
    try {
      const events = observation.events
      const lastEnd = events.findLast(e => e.type === 'turn/end')
      if (!lastEnd || lastEnd.data.reason.kind !== 'completed') return null
      if (endSeq !== undefined && lastEnd.seq !== endSeq) return null
      if (prediction) return completedPredictionContext(events, lastEnd.seq, this.config.predictionContextMaxBytes ?? 8192)
      const start = events.findLast(e => e.type === 'turn/start' && e.data.turn === lastEnd.data.turn && e.seq < lastEnd.seq)
      if (!start) return null

      // Retain event references only; large message bodies are sliced before text processing.
      const selected: typeof events[number][] = []
      let firstUser: typeof events[number] | undefined
      for (const event of events) {
        if (event.seq > lastEnd.seq) break
        if (event.type === 'user/message' && event.data.source.kind === 'user') { firstUser = event; break }
      }
      for (let index = events.length - 1; index >= 0 && selected.length < 20; index--) {
        const event = (events[index] as typeof events[number])
        if (event.seq <= lastEnd.seq && ((event.type === 'user/message' && event.data.source.kind === 'user') ||
          event.type === 'assistant/message')) {
          selected.unshift(event)
        }
      }
      if (firstUser && !selected.includes(firstUser)) selected.unshift(firstUser)
      const maxBytes = this.config.predictionContextMaxBytes ?? 2048
      const conversationMessages: string[] = []
      const envelopeBytes = Buffer.byteLength(JSON.stringify({ asOfSeq: lastEnd.seq, recentTexts: [] }), 'utf8')
      let remaining = Math.max(0, maxBytes - envelopeBytes)
      for (let index = 0; index < selected.length && remaining > 0; index++) {
        const event = (selected[index] as typeof selected[number])
        const content = event.type === 'user/message' ? event.data.content
          : event.type === 'assistant/message' ? event.data.message.content : []
        const prefix = event.type === 'user/message' ? 'User: ' : 'Assistant: '
        const entryAllowance = Math.floor(remaining / (selected.length - index))
        let text = ''
        for (const block of content) {
          if (block.type !== 'text') continue
          const allowance = entryAllowance - Buffer.byteLength(JSON.stringify(prefix + text), 'utf8') - 1
          if (allowance <= 0) break
          const bounded = truncateToUtf8Bytes(block.text, allowance).trim()
          if (bounded) text += (text ? '\n' : '') + bounded
        }
        if (!text) continue
        let entry = prefix + text
        while (Buffer.byteLength(JSON.stringify(entry), 'utf8') + 1 > entryAllowance && entry.length > prefix.length) {
          const overage = Buffer.byteLength(JSON.stringify(entry), 'utf8') + 1 - entryAllowance
          entry = truncateToUtf8Bytes(entry, Buffer.byteLength(entry, 'utf8') - overage)
        }
        if (entry.length <= prefix.length) continue
        conversationMessages.push(entry)
        remaining -= Buffer.byteLength(JSON.stringify(entry), 'utf8') + 1
      }

      if (conversationMessages.length === 0) return null
      return { asOfSeq: lastEnd.seq, recentTexts: conversationMessages }
    } finally {
      observation[Symbol.dispose]()
    }
  }

  /**
   * Flush in-memory cursors and round journal to disk and close catalog if held.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    const earlyTasks = [...this.earlyPredictions.values()].map(entry => entry.promise)
    this.cancelEarlyPredictions()
    this.predictionTurnStarts.clear()
    this.reviewPredictions.dispose()
    await Promise.allSettled(earlyTasks)
    await Promise.allSettled(
      [...this.backgroundRoundTasks.keys()].map(roundId => this.roundScheduler.cancelRound(roundId, 'Assistant service disposed')),
    )
    await Promise.allSettled(this.backgroundRoundTasks.values())
    await Promise.allSettled(this.completedReviewTasks.values())
    if (!this.roundScheduler.journal.corrupted) {
      await this.roundScheduler.journal.flush().catch(() => {})
    }
    await this.readCursors.flush().catch(() => {})
    await this.usage.flush().catch(() => {})
    if (this.catalog) {
      await this.catalog.close().catch(() => {})
    }
  }
}

export default AssistantService
