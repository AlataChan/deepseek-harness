/**
 * Domain types and branded identifiers for persistent assistants and teams.
 * @module @deepseek-ai/dsh-experimental-assistant-registry/types
 */

import { type Branded, brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Model selection specification for an assistant profile or conversation. */
export interface AssistantModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** Unique identifier for an assistant profile. */
export type AssistantProfileId = Branded<'AssistantProfileId'>
/**
 * Create a branded AssistantProfileId.
 * @param value - raw string identifier.
 * @returns branded AssistantProfileId.
 */
export function AssistantProfileId(value: string): AssistantProfileId {
  return brandString<AssistantProfileId>(value)
}

/** Unique identifier for an assistant conversation binding. */
export type AssistantConversationId = Branded<'AssistantConversationId'>
/**
 * Create a branded AssistantConversationId.
 * @param value - raw string identifier.
 * @returns branded AssistantConversationId.
 */
export function AssistantConversationId(value: string): AssistantConversationId {
  return brandString<AssistantConversationId>(value)
}

/** Unique identifier for a team definition. */
export type TeamDefinitionId = Branded<'TeamDefinitionId'>
/**
 * Create a branded TeamDefinitionId.
 * @param value - raw string identifier.
 * @returns branded TeamDefinitionId.
 */
export function TeamDefinitionId(value: string): TeamDefinitionId {
  return brandString<TeamDefinitionId>(value)
}

/** Unique identifier for a team seat. */
export type TeamSeatId = Branded<'TeamSeatId'>
/**
 * Create a branded TeamSeatId.
 * @param value - raw string identifier.
 * @returns branded TeamSeatId.
 */
export function TeamSeatId(value: string): TeamSeatId {
  return brandString<TeamSeatId>(value)
}

/** Unique identifier for a memory entry. */
export type MemoryEntryId = Branded<'MemoryEntryId'>
/**
 * Create a branded MemoryEntryId.
 * @param value - raw string identifier.
 * @returns branded MemoryEntryId.
 */
export function MemoryEntryId(value: string): MemoryEntryId {
  return brandString<MemoryEntryId>(value)
}

/** Unique identifier for a provisioning operation. */
export type ProvisioningOperationId = Branded<'ProvisioningOperationId'>
/**
 * Create a branded ProvisioningOperationId.
 * @param value - raw string identifier.
 * @returns branded ProvisioningOperationId.
 */
export function ProvisioningOperationId(value: string): ProvisioningOperationId {
  return brandString<ProvisioningOperationId>(value)
}

/** Unique identifier for a group discussion round. */
export type GroupRoundId = Branded<'GroupRoundId'>
/**
 * Create a branded GroupRoundId.
 * @param value - raw string identifier.
 * @returns branded GroupRoundId.
 */
export function GroupRoundId(value: string): GroupRoundId {
  return brandString<GroupRoundId>(value)
}

/** Unique identifier for a group discussion. */
export type GroupDiscussionId = Branded<'GroupDiscussionId'>
/**
 * Create a branded GroupDiscussionId.
 * @param value - raw string identifier.
 * @returns branded GroupDiscussionId.
 */
export function GroupDiscussionId(value: string): GroupDiscussionId {
  return brandString<GroupDiscussionId>(value)
}

/** Unique identifier for a group message. */
export type GroupMessageId = Branded<'GroupMessageId'>
/**
 * Create a branded GroupMessageId.
 * @param value - raw string identifier.
 * @returns branded GroupMessageId.
 */
export function GroupMessageId(value: string): GroupMessageId {
  return brandString<GroupMessageId>(value)
}

/** Unique identifier for a slot within a group round. */
export type RoundSlotId = Branded<'RoundSlotId'>
/**
 * Create a branded RoundSlotId.
 * @param value - raw string identifier.
 * @returns branded RoundSlotId.
 */
export function RoundSlotId(value: string): RoundSlotId {
  return brandString<RoundSlotId>(value)
}

/** Capability and permission policy constraining an assistant, seat, or conversation. */
export interface CapabilityPolicy {
  readonly allowedTools?: readonly string[] | undefined
  readonly disallowedTools?: readonly string[] | undefined
  readonly allowedPaths?: readonly string[] | undefined
  readonly allowTerminal?: boolean | undefined
  readonly allowSubagents?: boolean | undefined
}

/** Persistent assistant profile specification. */
export interface AssistantProfile {
  readonly id: AssistantProfileId
  readonly name: string
  readonly avatar?: string | undefined
  readonly responsibility: string
  readonly instructions?: string | undefined
  readonly capabilities?: CapabilityPolicy | undefined
  readonly revision: number
  readonly defaultModel?: AssistantModelSelection | undefined
  readonly archivedAt?: number | undefined
  readonly createdAt: number
  readonly updatedAt: number
}

/** Creation parameters for an assistant profile. */
export interface CreateAssistantProfileOptions {
  readonly id?: string | undefined
  readonly name: string
  readonly avatar?: string | undefined
  readonly responsibility: string
  readonly instructions?: string | undefined
  readonly capabilities?: CapabilityPolicy | undefined
  readonly defaultModel?: AssistantModelSelection | undefined
}

/** Update parameters for an assistant profile. */
export interface UpdateAssistantProfileOptions {
  readonly name?: string | undefined
  readonly avatar?: string | undefined
  readonly responsibility?: string | undefined
  readonly instructions?: string | undefined
  readonly capabilities?: CapabilityPolicy | undefined
  readonly defaultModel?: AssistantModelSelection | undefined
}

/** Persistent assistant conversation binding. */
export interface AssistantConversation {
  readonly id: AssistantConversationId
  readonly profileId: AssistantProfileId
  readonly rootSessionId: SessionId
  readonly title?: string | undefined
  readonly modelOverride?: AssistantModelSelection | undefined
  readonly modelCheckpoint?: number | undefined
  /** Conversation-scoped capability grant, intersected with profile, team, and seat policies. */
  readonly capabilities?: CapabilityPolicy | undefined
  readonly archivedAt?: number | undefined
  readonly createdAt: number
  readonly updatedAt: number
}

/** Creation options for an assistant conversation binding. */
export interface CreateAssistantConversationOptions {
  readonly id?: string | undefined
  readonly rootSessionId?: SessionId | undefined
  readonly title?: string | undefined
  readonly modelOverride?: AssistantModelSelection | undefined
  readonly capabilities?: CapabilityPolicy | undefined
  readonly cwd?: string | undefined
}


/** Source tier of a resolved model route according to precedence. */
export type RoutePrecedenceSource = 'conversation' | 'seat' | 'profile' | 'default'

/** Captured immutable route snapshot with source revisions for a single request. */
export interface CapturedRoute {
  readonly route: AssistantModelSelection
  readonly source: RoutePrecedenceSource
  readonly conversationRevision?: number | undefined
  readonly profileRevision?: number | undefined
  readonly seatRevision?: number | undefined
}

/** Lifecycle status of a provisioning operation in the ledger. */
export type ProvisioningStatus = 'pending' | 'checkpointed' | 'completed' | 'failed' | 'ambiguous'

/** Ledger entry tracking an asynchronous multi-step provisioning operation. */
export interface ProvisioningOperation<P = unknown, R extends Record<string, string> = Record<string, string>> {
  readonly id: ProvisioningOperationId
  readonly fingerprint: string
  readonly status: ProvisioningStatus
  readonly checkpoint: string
  readonly allocations: R
  readonly payload: P
  readonly error?: string | undefined
  readonly createdAt: number
  readonly updatedAt: number
}

/** Execution context passed to provisioning step runners. */
export interface ProvisioningContext<R extends Record<string, string> = Record<string, string>> {
  readonly operationId: ProvisioningOperationId
  readonly checkpoint: string
  readonly allocations: Readonly<R>
  readonly resumed: boolean
  setCheckpoint(name: string, allocationsPatch?: Partial<R>): Promise<void>
  markAmbiguous(reason: string): Promise<void>
}

/** Execution options for running or resuming a provisioning operation. */
export interface ExecuteProvisioningOptions<P = unknown, R extends Record<string, string> = Record<string, string>> {
  readonly id: ProvisioningOperationId
  readonly payload: P
  readonly run: (context: ProvisioningContext<R>) => Promise<R>
  readonly crashHook?: (stage: string) => Promise<void> | void
}

/** Result of a completed provisioning execution. */
export interface ProvisioningResult<R extends Record<string, string> = Record<string, string>> {
  readonly status: 'completed'
  readonly allocations: R
  readonly resumed: boolean
}

/** Role of a seat within a saved team. */
export type TeamSeatRole = 'coordinator' | 'teammate'

/** One assistant profile's participation in a saved team. */
export interface TeamSeat {
  readonly id: TeamSeatId
  readonly teamId: TeamDefinitionId
  readonly profileId: AssistantProfileId
  readonly role: TeamSeatRole
  readonly name: string
  readonly duty: string
  readonly title?: string | undefined
  readonly modelOverride?: AssistantModelSelection | undefined
  readonly capabilities?: CapabilityPolicy | undefined
  readonly runtimeInstances: readonly SessionId[]
  /** Runtime instance names used by this seat, including failed attempts; reserved permanently within the team. */
  readonly runtimeNames?: readonly string[] | undefined
  readonly activeInstanceId?: SessionId | undefined
  readonly retiredAt?: number | undefined
  readonly createdAt: number
  readonly updatedAt: number
}

/** Creation parameters for a team seat. */
export interface CreateTeamSeatOptions {
  readonly id?: string | undefined
  readonly teamId: TeamDefinitionId
  readonly profileId: AssistantProfileId
  readonly role: TeamSeatRole
  readonly name: string
  readonly duty: string
  readonly title?: string | undefined
  readonly modelOverride?: AssistantModelSelection | undefined
  readonly capabilities?: CapabilityPolicy | undefined
}

/** Update parameters for a team seat. */
export interface UpdateTeamSeatOptions {
  readonly name?: string | undefined
  readonly duty?: string | undefined
  readonly title?: string | undefined
  readonly modelOverride?: AssistantModelSelection | undefined
  readonly capabilities?: CapabilityPolicy | undefined
  readonly activeInstanceId?: SessionId | undefined
  readonly appendInstanceId?: SessionId | undefined
  /** Append one permanently reserved runtime instance name. */
  readonly appendRuntimeName?: string | undefined
  readonly retiredAt?: number | undefined
}

/** Template origin of a saved team definition. */
export type TeamTemplateOrigin = 'blank' | 'document' | 'case' | 'comms'

/** Saved team definition with coordinator, seat definitions, and shared workspace. */
export interface TeamDefinition {
  readonly id: TeamDefinitionId
  readonly name: string
  /** Display initials or an icon:preset identifier; empty selects automatic initials. */
  readonly avatar?: string | undefined
  readonly description?: string | undefined
  readonly coordinatorProfileId: AssistantProfileId
  readonly leadSessionId?: SessionId | undefined
  readonly sharedWorkspaceId?: string | undefined
  readonly templateOrigin?: TeamTemplateOrigin | undefined
  readonly seatIds: readonly TeamSeatId[]
  readonly capabilities?: CapabilityPolicy | undefined
  readonly revision: number
  readonly archivedAt?: number | undefined
  readonly createdAt: number
  readonly updatedAt: number
}

/** Creation parameters for a team definition. */
export interface CreateTeamDefinitionOptions {
  readonly id?: string | undefined
  readonly name: string
  /** Display initials or an icon:preset identifier; empty selects automatic initials. */
  readonly avatar?: string | undefined
  readonly description?: string | undefined
  readonly coordinatorProfileId: AssistantProfileId
  readonly leadSessionId?: SessionId | undefined
  readonly sharedWorkspaceId?: string | undefined
  readonly templateOrigin?: TeamTemplateOrigin | undefined
  readonly capabilities?: CapabilityPolicy | undefined
}

/** Update parameters for a team definition. */
export interface UpdateTeamDefinitionOptions {
  readonly name?: string | undefined
  /** Display initials or an icon:preset identifier; empty selects automatic initials. */
  readonly avatar?: string | undefined
  readonly description?: string | undefined
  readonly coordinatorProfileId?: AssistantProfileId | undefined
  readonly leadSessionId?: SessionId | undefined
  readonly sharedWorkspaceId?: string | undefined
  readonly capabilities?: CapabilityPolicy | undefined
  readonly seatIds?: readonly TeamSeatId[] | undefined
}

/** Specification of one seat within a team template. */
export interface TeamTemplateSeat {
  readonly name: string
  readonly title: string
  readonly titleEn: string
  readonly duty: string
  readonly defaultCapabilities?: CapabilityPolicy | undefined
}

/** Specification of a standing team template. */
export interface TeamTemplateDefinition {
  readonly id: TeamTemplateOrigin
  readonly name: string
  readonly nameEn: string
  readonly description: string
  readonly seats: readonly TeamTemplateSeat[]
}

/** Options for retiring a team seat. */
export interface RetireSeatOptions {
  /** If true, bypasses pending/in-progress task checks. */
  readonly force?: boolean | undefined
}

/** Capacity metrics for a team separating live occupancy from history. */
export interface TeamCapacityAccounting {
  readonly teamId: TeamDefinitionId
  readonly maxCapacity: number
  readonly liveCount: number
  readonly retiredCount: number
  readonly totalHistoricalSeats: number
  readonly availableSlots: number
}

/** Status of an adopted institution squad. */
export type InstitutionAdoptionStatus = 'active' | 'repair_needed' | 'superseded'

/** Durable adoption record linking an institution squad to a team definition. */
export interface InstitutionAdoptionRecord {
  readonly id: string
  readonly squadId: 'document' | 'case' | 'comms'
  readonly teamId: TeamDefinitionId
  readonly leadSessionId: SessionId
  readonly seatMappings: Readonly<Record<string, SessionId>>
  readonly status: InstitutionAdoptionStatus
  readonly revision: number
  readonly adoptedAt: number
  readonly updatedAt: number
  readonly error?: string | undefined
}

/** Options for adopting an institution squad into a managed team definition. */
export interface AdoptInstitutionSquadOptions {
  readonly squadId: 'document' | 'case' | 'comms'
  readonly teamName?: string | undefined
  readonly coordinatorProfileId?: AssistantProfileId | undefined
}

/** Options for repairing an adopted institution squad whose binding or child changed. */
export interface RepairInstitutionAdoptionOptions {
  readonly squadId: 'document' | 'case' | 'comms'
  readonly force?: boolean | undefined
  readonly newLeadSessionId?: SessionId | undefined
}

/** Maximum allowed length for memory entry text. */
export const MEMORY_TEXT_MAX_LENGTH = 4000

/** Maximum number of memory entries injected into prompt snapshot. */
export const MEMORY_SNAPSHOT_MAX_ENTRIES = 50

/** Maximum byte length of formatted memory prompt snapshot. */
export const MEMORY_SNAPSHOT_MAX_BYTES = 16384

/** Target scope for a persistent memory entry. */
export type MemoryScope =
  | { readonly kind: 'profile'; readonly profileId: AssistantProfileId }
  | { readonly kind: 'team'; readonly teamId: TeamDefinitionId }

/** Scoped persistent memory entry record. */
export interface MemoryEntry {
  readonly id: MemoryEntryId
  readonly scope: MemoryScope
  readonly text: string
  readonly sourceSessionId?: SessionId | undefined
  readonly sourceEventSeq?: number | undefined
  readonly author?: string | undefined
  readonly createdAt: number
  readonly updatedAt: number
  readonly revision: number
  readonly removedAt?: number | undefined
  readonly archivedAt?: number | undefined
  readonly grants?: readonly TeamDefinitionId[] | undefined
}

/** Options for saving a persistent memory entry. */
export interface SaveMemoryOptions {
  readonly sourceSessionId?: SessionId | undefined
  readonly sourceEventSeq?: number | undefined
  readonly author?: string | undefined
  readonly grants?: readonly TeamDefinitionId[] | undefined
}

/** Options for listing memory entries in a scope. */
export interface ListMemoryOptions {
  readonly includeRemoved?: boolean | undefined
  readonly includeArchived?: boolean | undefined
  readonly limit?: number | undefined
}

/** Terminal state of an executed or attempted round slot. */
export type SlotTerminalState =
  | 'completed'
  | 'cancelled'
  | 'timed_out'
  | 'failed'
  | 'uncertain'
  | 'silent'

/** Lifecycle status of a group discussion round. */
export type GroupRoundStatus =
  | 'pending'
  | 'active'
  | 'completed'
  | 'cancelled'
  | 'failed'

/** Configuration bounds constraining a group round execution. */
export interface RoundBoundsConfig {
  /** Maximum number of seats allowed in a round (default: 5). */
  readonly maxSeatsPerRound?: number | undefined
  /** Maximum number of handoffs between speakers in a round (default: 3). */
  readonly maxHandoffsPerRound?: number | undefined
  /** Maximum cumulative tokens allowed in a round (default: 16384). */
  readonly maxTokensPerRound?: number | undefined
  /** Timeout per slot in milliseconds (default: 30000). */
  readonly slotTimeoutMs?: number | undefined
}

/** Resolved and validated bounds constraining a group round execution. */
export interface ResolvedRoundBounds {
  readonly maxSeatsPerRound: number
  readonly maxHandoffsPerRound: number
  readonly maxTokensPerRound: number
  readonly slotTimeoutMs: number
}

/** Record of a slot within a group round. */
export interface RoundSlotJournalEntry {
  readonly slotId: RoundSlotId
  readonly roundId: GroupRoundId
  readonly slotIndex: number
  readonly seatId: TeamSeatId
  readonly seatName: string
  readonly seatRole: TeamSeatRole
  readonly sessionId: SessionId
  readonly attemptId: string
  readonly status: 'pending' | 'active' | SlotTerminalState
  /** Committed transcript cursor (message count / seq) observed by this slot at execution time. */
  readonly committedCursor: number
  readonly startedAt?: number | undefined
  readonly completedAt?: number | undefined
  readonly tokensUsed: number
  readonly committedReply?: {
    readonly text: string
    readonly sourceSessionId: SessionId
    readonly sourceEventSeq: number
  } | undefined
  readonly resultMessageId?: GroupMessageId | undefined
  readonly error?: string | undefined
  /** If side-effect status is uncertain (e.g. timeout / network break / unconfirmed tool call). */
  readonly executionUncertain?: boolean | undefined
  /** User-facing explanation of the uncertain status, e.g. 「执行结果待确认」. */
  readonly uncertainExplanation?: string | undefined
}

/** Durable record of a group round. */
export interface GroupRoundJournalEntry {
  readonly id: GroupRoundId
  readonly discussionId: GroupDiscussionId
  readonly teamId: TeamDefinitionId
  readonly status: GroupRoundStatus
  readonly prompt: string
  readonly recipients?: readonly TeamSeatId[] | undefined
  readonly slots: readonly RoundSlotJournalEntry[]
  readonly activeSlotIndex: number
  readonly totalTokensUsed: number
  readonly handoffCount: number
  readonly bounds: ResolvedRoundBounds
  readonly createdAt: number
  readonly startedAt?: number | undefined
  readonly completedAt?: number | undefined
  readonly error?: string | undefined
}

/** A group discussion room entity within a team. */
export interface GroupDiscussion {
  readonly id: GroupDiscussionId
  readonly teamId: TeamDefinitionId
  readonly rootSessionId?: SessionId | undefined
  readonly title?: string | undefined
  readonly activeRoundId?: GroupRoundId | undefined
  readonly createdAt: number
  readonly updatedAt: number
}

/** Options for creating a group discussion. */
export interface CreateGroupDiscussionOptions {
  readonly id?: string | undefined
  readonly teamId: TeamDefinitionId
  readonly rootSessionId?: SessionId | undefined
  readonly title?: string | undefined
}

/** A public group message recorded in the discussion transcript. */
export interface GroupTranscriptMessage {
  readonly id: GroupMessageId
  readonly discussionId: GroupDiscussionId
  readonly roundId: GroupRoundId
  readonly slotId: RoundSlotId
  readonly authorSeatId: TeamSeatId
  readonly authorName: string
  readonly authorRole?: string | undefined
  readonly text: string
  readonly sourceSessionId: SessionId
  readonly sourceEventSeq: number
  readonly createdAt: number
  readonly executionUncertain?: boolean | undefined
}

/** Query options for paginated public transcript projection. */
export interface QueryPublicTranscriptOptions {
  readonly discussionId: GroupDiscussionId
  readonly callerSeatId?: TeamSeatId | undefined
  readonly teamId?: TeamDefinitionId | undefined
  readonly limit?: number | undefined
  readonly cursor?: string | undefined
}

/** Paginated public transcript result. */
export interface QueryPublicTranscriptResult {
  readonly items: readonly GroupTranscriptMessage[]
  readonly nextCursor?: string | undefined
  readonly hasMore: boolean
}

/** Options for scheduling a group round. */
export interface ScheduleRoundOptions {
  readonly id?: GroupRoundId | undefined
  readonly discussionId: GroupDiscussionId
  readonly teamId: TeamDefinitionId
  readonly prompt: string
  readonly recipients?: readonly TeamSeatId[] | undefined
  readonly bounds?: RoundBoundsConfig | undefined
}

/** Result of executing a round slot. */
export interface SlotExecutionResult {
  readonly status: SlotTerminalState
  readonly text?: string | undefined
  readonly tokensUsed?: number | undefined
  readonly sourceSessionId?: SessionId | undefined
  readonly sourceEventSeq?: number | undefined
  readonly handoffTo?: TeamSeatId | undefined
  readonly error?: string | undefined
  readonly executionUncertain?: boolean | undefined
  readonly uncertainExplanation?: string | undefined
}

/** Record of a persisted read cursor for a logical conversation or discussion. */
export interface ReadCursorRecord {
  readonly conversationId: string
  readonly lastReadSeq: number
  readonly readAt: number
  readonly windowId?: string | undefined
}

/** Token usage breakdown metrics. */
export interface TokenUsageMetrics {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
}

/** Record detailing an auxiliary inference call (e.g. title, memory review, prediction). */
export interface AuxiliaryUsageRecord {
  readonly id: string
  readonly sessionId: SessionId
  readonly seq: number
  readonly provider: string
  readonly model: string
  readonly usage: TokenUsageMetrics
  readonly purpose: 'title' | 'memory_review' | 'prediction' | 'summary' | 'auxiliary'
  readonly timestamp: number
}

/** Model-visible auxiliary request or observed outcome retained in its owning session. */
export type AssistantAuxiliaryEvent = {
  readonly id: string
  readonly purpose: 'memory_review' | 'prediction'
  readonly asOfSeq: number
  readonly provider: string
  readonly model: string
} & (
  | { readonly phase: 'request'; readonly messages: readonly import('@deepseek-ai/dsh-llm').RequestMessage[]; readonly maxTokens: number }
  | { readonly phase: 'result'; readonly text: string; readonly finish: string; readonly usage?: TokenUsageMetrics }
)

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Auxiliary inference evidence; excluded from ordinary conversation surface and primary billing. */
    'assistant/auxiliary': AssistantAuxiliaryEvent
  }
}

/** Completed-turn context prepared by the Host for an eligible composer prediction. */
export interface ComposerPredictionContext {
  readonly asOfSeq: number
  readonly recentTexts: readonly string[]
}

/** Attributed usage summary for a conversation binding or seat session. */
export interface BindingUsageSummary {
  readonly bindingId: string
  readonly sessionId: SessionId
  readonly startBoundarySeq: number
  readonly assistantTokens: TokenUsageMetrics
  readonly auxiliaryTokens: TokenUsageMetrics
  readonly totalTokens: TokenUsageMetrics
  readonly assistantCallCount: number
  readonly auxiliaryCallCount: number
  readonly modelBreakdown: Record<string, TokenUsageMetrics>
}

/** Request options for aggregating usage over sessions or bindings. */
export interface AggregateUsageRequest {
  readonly profileId?: AssistantProfileId | undefined
  readonly teamId?: TeamDefinitionId | undefined
  readonly conversationId?: AssistantConversationId | undefined
  readonly sessionBindings?: readonly {
    readonly sessionId: SessionId
    readonly bindingId: string
    readonly startBoundarySeq: number
    readonly profileId?: AssistantProfileId | undefined
    readonly teamId?: TeamDefinitionId | undefined
    readonly seatId?: TeamSeatId | undefined
  }[] | undefined
  readonly fromTimestamp?: number | undefined
  readonly toTimestamp?: number | undefined
}

/** Stable attribution metadata for scoped search results. */
export interface ScopedSearchResultAttribution {
  readonly conversationId?: AssistantConversationId | undefined
  readonly profileId?: AssistantProfileId | undefined
  readonly teamId?: TeamDefinitionId | undefined
  readonly seatId?: TeamSeatId | undefined
  readonly authorName: string
  readonly authorRole?: string | undefined
  readonly sessionId: SessionId
  readonly eventSeq: number
}

/** Event search result hit enriched with stable scope attribution. */
export interface ScopedSessionEventHit {
  readonly sessionId: SessionId
  readonly eventSeq: number
  readonly type: string
  readonly text?: string | undefined
  readonly attribution: ScopedSearchResultAttribution
}

/** Parameters for reviewing completed turn events for salient memory extraction. */
export interface ReviewTurnRequest {
  readonly sessionId: SessionId
  readonly scope: {
    readonly profileId?: AssistantProfileId | undefined
    readonly teamId?: TeamDefinitionId | undefined
  }
  readonly turnSeq: number
  readonly turnTexts?: readonly string[] | undefined
  readonly candidateMemories?: readonly string[] | undefined
  readonly trigger?: 'manual' | 'turn_completed' | undefined
  readonly author?: string | undefined
}

/** Result of bounded per-turn memory review. */
export interface ReviewTurnResult {
  readonly candidateMemories: readonly string[]
  readonly addedMemories: readonly MemoryEntry[]
  readonly rejectedReasons: readonly {
    readonly text: string
    readonly reason: 'duplicate' | 'secret' | 'instruction' | 'empty'
  }[]
  readonly usage?: AuxiliaryUsageRecord | undefined
}

/** Parameters for generating a contextual composer prediction. */
export interface ComposerPredictionRequest {
  readonly sessionId: SessionId
  readonly conversationId?: AssistantConversationId | undefined
  readonly asOfSeq: number
  readonly scope?: {
    readonly profileId?: AssistantProfileId | undefined
    readonly teamId?: TeamDefinitionId | undefined
  } | undefined
  readonly draftText?: string | undefined
  readonly recentTexts?: readonly string[] | undefined
}

/** Result of contextual composer prediction. */
export interface ComposerPredictionResult {
  readonly predictionId: string
  readonly sessionId: SessionId
  readonly asOfSeq: number
  readonly text: string
  readonly usage?: AuxiliaryUsageRecord | undefined
}
