# Agent Teams

[English](agent-team.md) | 中文

实验性隐式 Root Team 领域、模型工具与宿主适配器共享的类型。[Agent Teams Agent Note](../../.agents/notes/implemented/feature/2026-08-05-agent-teams.zh.md)负责身份、mailbox、task 与共享 checkout 决策；本页记录 [`packages/experimental/agent-team/src/types.ts`](../../packages/experimental/agent-team/src/types.ts) 中的字面持久形式。

## 身份与 roster

`TeamId` 是具有独立[品牌](core.zh.md#branded-ids)的 Root `SessionId`。`TeamTaskId` 在 Team 内按 `task-<n>` 单调分配；`TeamMessageId` 是全局随机值。teammate 的 Session id 始终是持久身份，而 `name` 是不可变的模型／UI 标签。

```ts type-equiv
/** Whole durable value written on every teammate lifecycle change. */
interface TeamMemberSnapshot {
  readonly id: SessionId
  readonly name: string
  readonly description: string
  readonly provider: string
  readonly context: 'fresh' | 'fork'
  readonly phase: TeamMemberPhase
  /** Child LLM model id when known; retained so inactive roster rows do not invent the Lead route. */
  readonly model?: string
  readonly error?: string
}
```

每个 member 都从 `provisioning` 开始，并且只到达一个终态 roster phase：`active` 或 `failed`。运行时 `running`／`idle`／`inactive` 状态单独派生，绝不会重写该记录。

三个机构小队是 Host 名册行，不是 Team 事件。`InstitutionSquadView` 是列表行；`leadSessionId` 是常驻 Lead。新话题是该 Session 上的 prompt。

```ts type-equiv
/** One institution squad on the Host catalog. */
interface InstitutionSquadView {
  readonly id: InstitutionSquadId
  /** Chinese display name used as the default Session title. */
  readonly displayName: string
  /** English display name. */
  readonly displayNameEn: string
  /** Standing Lead Session when the squad has been provisioned and the log still exists. */
  readonly leadSessionId?: SessionId
  /** True when {@link leadSessionId} is set and the Session is still persisted. */
  readonly established: boolean
  readonly seats: readonly InstitutionSeatView[]
}
```

## 持久 mailbox

Lead Session 首先存储完整 queued message。只有 target 的 pending inbox 条目或已记录用户消息完成持久化，才会写入独立 acknowledgement event，queued-minus-delivered 因而构成恢复 mailbox。

```ts type-equiv
/** One peer message retained until its target Session records it. */
interface TeamMessageSnapshot {
  readonly id: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
  readonly targetId: SessionId
  readonly content: ContentBlock[]
  readonly roundId?: string | undefined
  readonly slotId?: string | undefined
  readonly attemptId?: string | undefined
}
```

每条消息都会尝试 Steer 投递。running target 在最近的步骤边界收到消息，idle target 启动一个轮次，inactive teammate 则冷恢复。调用方不能选择其他模式，因此持久记录不存储调度方式。

target Session 会在 pending inbox 条目和最终用户消息上保留消息身份与发送者归因。跨 inbox 与历史折叠该 source 构成 target 侧去重键；模型可见的 framing 会重复 id 和发送者。

```ts type-equiv
/** Source retained by the target Session for durable mailbox de-duplication. */
interface TeamMessageSource {
  readonly kind: 'team-message'
  readonly teamId: TeamId
  readonly messageId: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
  readonly roundId?: string | undefined
  readonly slotId?: string | undefined
  readonly attemptId?: string | undefined
}
```

## 共享任务 DAG

每条 task event 都存储完整快照。`revision` 是 compare-and-set 值，每次变更递增 1。`blockedBy` edge 必须指向未删除任务，并维持无环图。`writeScopes` 是规范化的提示性路径前缀，不是锁。

```ts type-equiv
/** Whole durable task snapshot; every mutation increments {@link revision}. */
interface TeamTaskSnapshot {
  readonly id: TeamTaskId
  readonly revision: number
  readonly subject: string
  readonly description: string
  readonly status: TeamTaskStatus
  readonly ownerId?: SessionId
  readonly blockedBy: TeamTaskId[]
  readonly writeScopes: string[]
}
```

`pending` 表示尚未开始或已经释放，`in_progress` 携带 owner，`completed` 满足 blocker，`deleted` 是保留的 tombstone。view 会添加 owner name、readiness 和 write-scope 重叠警告，但不会改变持久快照。

## 回放

`foldTeam()` 把一个 Root Session 回放成每个 Team 操作所读取的 roster、任务板与 queued-minus-delivered mailbox。它按 `TeamId` 选取记录，因此普通 fork 继承的 event 保留 ancestor id，绝不会进入新 Root 的状态。Session event 的 `seq` 与 `time` 继续负责顺序和时间记录，Team snapshot 不再重复保存它们。roster 与 task 读取以 view 形式到达调用方，而 pending 邮件仅供投递与恢复内部使用。包 [README](../../packages/experimental/agent-team/README.zh.md)负责 operation、authorization、recovery 和限制行为。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxagentteams--teamservice"></a>

### `ctx.agentTeams` — `TeamService`

Agent Teams service backed by the exact live Lead Session log.

```ts cordis-catalog
/**
 * Return the baked-in squad when this Agent is that squad's standing Lead.
 * @param agent - exact live Agent.
 * @returns the squad, or `undefined` when this Session is not a standing Lead.
 */
standingSquadFor(agent: Agent): InstitutionSquadDefinition | undefined

/**
 * Resolve one exact live Agent's Team role.
 * @param agent - exact live Agent used as the authority credential.
 * @returns its root, Team identity, role, and model-facing name.
 */
membership(agent: Agent): TeamMembership

/**
 * List the runtime-enriched roster visible to one Team member.
 * @param agent - exact live Team member.
 * @returns Lead and teammate rows in creation order.
 */
listMembers(agent: Agent): TeamMemberView[]

/**
 * Create one named, continuable direct child of the Team Lead.
 * @param caller - exact live Lead Agent.
 * @param request - immutable name, description, prompt, context mode, provider, and cancellation.
 * @returns the active roster row.
 */
async spawnTeammate(caller: Agent, request: SpawnTeammateRequest): Promise<SpawnTeammateResult>

/**
 * Queue one durable peer message, then attempt immediate delivery.
 * @param caller - exact live sending Team member.
 * @param request - target name, content, and pre-queue cancellation.
 * @returns durable message identity and immediate-delivery observation.
 */
async sendMessage(caller: Agent, request: SendTeamMessageRequest): Promise<SendTeamMessageResult>

/**
 * Cancel an unstarted queued message for one slot from this Lead's mailbox.
 * @param caller - exact live Team member.
 * @param roundId - group round identity.
 * @param slotId - slot identity.
 * @returns true if an unstarted queued message was cancelled.
 */
async cancelQueuedSlot(caller: Agent, roundId: string, slotId: string): Promise<boolean>

/**
 * Create one unowned pending task in the Team Lead log.
 * @param caller - exact live Team member creating the task.
 * @param request - task text, blockers, and advisory write scopes.
 * @returns the revision-one task view.
 */
async createTask(caller: Agent, request: CreateTeamTaskRequest): Promise<TeamTaskView>

/**
 * Return one task, including a deleted tombstone.
 * @param caller - exact live Team member reading the task.
 * @param id - Team-local task identity.
 * @returns the latest task value and derived readiness diagnostics.
 */
getTask(caller: Agent, id: TeamTaskId): TeamTaskView

/**
 * List current non-deleted tasks in numeric creation order.
 * @param caller - exact live Team member reading the board.
 * @returns detached current task views.
 */
listTasks(caller: Agent): TeamTaskView[]

/**
 * Compare-and-set one authorized task transition.
 * @param caller - exact live Team member authorizing the mutation.
 * @param request - task identity, expected revision, action, and action fields.
 * @returns the committed next task revision.
 */
async updateTask(caller: Agent, request: UpdateTeamTaskRequest): Promise<TeamTaskView>

/**
 * Wait for the next Team-domain or member-status change.
 * @param caller - exact live Team member waiting for activity.
 * @param timeoutMs - bounded wait duration from ten seconds through one hour.
 * @param signal - caller cancellation for the wait only.
 * @returns one observed change or a timeout result.
 */
async waitForChange(caller: Agent, timeoutMs: number, signal: AbortSignal): Promise<TeamWaitResult>

/**
 * Interrupt one live teammate turn without clearing its pending inbox.
 * @param caller - exact live Lead Agent.
 * @param targetName - durable teammate name.
 * @returns the target status sampled before cancellation.
 */
interrupt(caller: Agent, targetName: string): { previousStatus: 'running' | 'idle' | 'inactive' }

/**
 * Resolve a caller without throwing, used by scoped-tool installation and observers.
 * @param agent - candidate exact live Agent.
 * @returns Team membership, or undefined for non-Team subagents and stale identities.
 */
tryMembership(agent: Agent): TeamMembership | undefined

/**
 * Read the current roster and non-deleted task board through the generated Remote API.
 * @param agent - exact live Team member used as the authority credential.
 * @returns detached current roster and task views.
 */
@Remote('view') remoteView(agent: Agent): TeamView

/**
 * Create one shared task through the generated Remote API.
 * @param agent - exact live Team member creating the task.
 * @param request - task text, blockers, and advisory write scopes.
 * @returns the revision-one task or a typed Team rejection.
 */
@Remote('createTask') remoteCreateTask(agent: Agent, request: CreateTeamTaskRequest): Promise<TeamTaskMutationResult>

/**
 * Apply one task mutation and preserve Team rejections as business results.
 * @param agent - exact live Team member authorizing the mutation.
 * @param request - task identity, expected revision, action, and action fields.
 * @returns the committed task or a typed Team rejection.
 */
@Remote('updateTask') remoteUpdateTask(agent: Agent, request: UpdateTeamTaskRequest): Promise<TeamTaskMutationResult>

/**
 * List the three institution squads and their current Lead bindings.
 * Stale Lead Session ids are dropped from the catalog when persistence no longer has them.
 * @returns detached squad rows in product order.
 */
@Remote('listInstitutionSquads') async remoteListInstitutionSquads(): Promise<InstitutionSquadView[]>

/**
 * Persist one seat's provider/model in the institution catalog.
 * Already-spawned teammates keep the route recorded on their member snapshot.
 * @param request - squad, seat name, and optional route.
 * @returns the refreshed squad list.
 */
@Remote('updateInstitutionSeat') async remoteUpdateInstitutionSeat(request: UpdateInstitutionSeatRequest): Promise<InstitutionSquadView[]>

/**
 * Bind the caller's Lead Session as the squad Lead and spawn any missing seats.
 * A new topic is a later human prompt on this same Session, not another spawn.
 * @param agent - exact live Lead Agent whose Session becomes the standing Lead.
 * @param request - squad slug and optional seat-route overrides applied before spawn.
 * @returns the bound Session and the current roster.
 */
@Remote('ensureInstitutionSquad') async remoteEnsureInstitutionSquad( agent: Agent, request: EnsureInstitutionSquadRequest, ): Promise<EnsureInstitutionSquadResult>

/**
 * Read one `.html` / `.htm` file for the Team dock sandboxed preview.
 * Paths resolve against the Lead session cwd when relative; absolute paths
 * must stay under that cwd when the Lead has one.
 * @param agent - exact live Team member used as the authority credential.
 * @param request - path to the HTML file.
 * @returns absolute path and UTF-8 HTML body.
 */
@Remote('readHtmlPreview') async remoteReadHtmlPreview( agent: Agent, request: ReadHtmlPreviewRequest, ): Promise<ReadHtmlPreviewResult>

/**
 * List institution squads after dropping Lead bindings whose Sessions are gone.
 * @returns detached squad rows in product order.
 */
async listInstitutionSquads(): Promise<InstitutionSquadView[]>

/**
 * Execute an operation inside the serialized institution catalog write chain.
 * @param action - async callback receiving the current catalog file inside the write lock.
 * @returns result of the callback.
 */
async transactInstitutionCatalog<T>( action: (current: InstitutionCatalogFile) => Promise<{ next?: InstitutionCatalogFile; result: T }> | { next?: InstitutionCatalogFile; result: T }, ): Promise<T>

/**
 * Read the current institution catalog file directly.
 * @returns current catalog content.
 */
async readInstitutionCatalog(): Promise<InstitutionCatalogFile>

/**
 * Bind the caller as the standing Lead and spawn seats that are not yet on the roster.
 * @param caller - exact live Lead Agent.
 * @param request - squad slug and optional seat-route overrides.
 * @returns the bound Session and roster.
 */
async ensureInstitutionSquad( caller: Agent, request: EnsureInstitutionSquadRequest, ): Promise<EnsureInstitutionSquadResult>
```

Types: [Agent](core.zh.md)

Source: [`packages/experimental/agent-team/src/index.ts`](../../packages/experimental/agent-team/src/index.ts)

<a id="ctxassistants--assistantservice"></a>

### `ctx.assistants` — `AssistantService`

Service managing persistent assistant profiles, conversation bindings, scoped model routing, and lifecycle states.

```ts cordis-catalog
/**
 * Initializes and opens the persistent catalog if available in the current context.
 * @param options - optional catalog open options.
 * @returns opened catalog or undefined if storageDomain is absent.
 */
async initCatalog(options: AssistantCatalogOptions = {}): Promise<AssistantCatalog | undefined>

/**
 * Attaches an authoritative persistent catalog to the service.
 * @param catalog - persistent catalog instance.
 */
attachCatalog(catalog: AssistantCatalog): void

/**
 * Initializes in-memory state from the attached persistent catalog.
 */
loadFromCatalog(): void

/**
 * Validate a proposed model selection against the served LLM catalog.
 * Rejects immediately if the provider or model is unavailable or incompatible.
 * @param model - model selection to validate.
 * @param signal - optional cancellation signal.
 * @returns resolved call config if valid.
 */
async validateRoute(model: AssistantModelSelection | ModelSelection, signal?: AbortSignal): Promise<LlmCallConfig>

/**
 * Whether the given session is bound to an assistant profile or team seat.
 * @param sessionId - target session identifier.
 * @returns true if the session is bound to an assistant profile or team seat.
 */
isAssistantBound(sessionId: SessionId | string): boolean

/**
 * Whether the given session belongs to a retired team seat.
 * @param sessionId - target session identifier.
 * @returns true if session is bound to a retired seat.
 */
isSessionRetired(sessionId: SessionId | string): boolean

/**
 * Synchronously retrieve an assistant conversation binding by its root session identifier.
 * @param sessionId - root session identifier.
 * @returns conversation binding if found.
 */
getConversationBySessionSync(sessionId: SessionId | string): AssistantConversation | undefined

/**
 * Synchronously look up a seat by session ID across live mappings and catalog history.
 * @param sessionId - session identifier.
 * @returns team seat if found.
 */
getSeatBySessionSync(sessionId: SessionId | string): TeamSeat | undefined

/**
 * Synchronously resolve the team ID associated with a session, if any.
 * @param sessionId - session identifier.
 * @returns team definition ID or undefined.
 */
getTeamIdBySessionSync(sessionId: SessionId | string): TeamDefinitionId | undefined

/**
 * Resolves the effective route for a session according to the frozen precedence:
 * explicit conversation override -> seat override -> profile default.
 * @param sessionId - session identifier.
 * @returns resolved route snapshot with source revisions, or undefined.
 */
resolveEffectiveRoute(sessionId: SessionId | string): CapturedRoute | undefined

/**
 * Stores the captured route snapshot for an in-flight request.
 * @param sessionId - target session identifier.
 * @param captured - immutable captured route snapshot.
 */
captureRouteForRequest(sessionId: SessionId | string, captured: CapturedRoute): void

/**
 * Retrieves the captured route snapshot for an in-flight request.
 * @param sessionId - target session identifier.
 * @returns captured route snapshot if present.
 */
getCapturedRoute(sessionId: SessionId | string): CapturedRoute | undefined

/**
 * Clears the captured route snapshot for a session.
 * @param sessionId - target session identifier.
 */
clearCapturedRoute(sessionId: SessionId | string): void

/**
 * Records user messages entering the step for capability inspection.
 * @param sessionId - target session identifier.
 * @param messages - step user messages to record.
 */
recordStepMessages(sessionId: SessionId | string, messages: readonly UserMessage[]): void

/**
 * Checks whether the current step or session history carries images.
 * @param sessionId - session identifier.
 * @param session - live Session instance.
 * @returns true if any message carries image content.
 */
requestCarriesImages(sessionId: SessionId | string, session: Session): boolean

/**
 * Synchronously retrieve a team definition by identifier.
 * @param id - team definition identifier.
 * @returns team definition if found.
 */
getTeamSync(id: TeamDefinitionId): TeamDefinition | undefined

/**
 * Synchronously retrieve a team seat by identifier.
 * @param id - team seat identifier.
 * @returns team seat if found.
 */
getSeatSync(id: TeamSeatId): TeamSeat | undefined

/**
 * Compute effective capabilities for a session via strict intersection of deployment, conversation,
 * profile, team, and seat policies. Role or duty text can never widen permissions.
 * @param sessionId - target session identifier.
 * @returns effective capabilities policy.
 */
getEffectiveCapabilities(sessionId: SessionId | string): EffectiveCapabilities

/**
 * List the sessions one binding may read: a private conversation reads only itself; a team member
 * reads its team's lead and seat instances.
 * @param sessionId - caller session identifier.
 * @returns permitted sessions, or undefined when the caller has no assistant binding.
 */
allowedSessionsFor(sessionId: SessionId | string): readonly SessionId[] | undefined

/**
 * Authorize one session-history target for a calling session.
 * Providers and tool guards consult this authority; a provider that cannot enforce the restriction
 * must mark the capability unavailable instead of claiming isolation.
 * @param callerSessionId - caller session identifier.
 * @param targetSessionId - referenced session identifier.
 * @returns true when permitted, false when denied, undefined when the caller has no session scope.
 */
authorizeSessionSource(callerSessionId: SessionId | string, targetSessionId: SessionId | string): boolean | undefined

/**
 * Bind a runtime session identifier to a team seat.
 * @param seatId - target seat identifier.
 * @param sessionId - runtime session identifier.
 */
async bindSeatSession(seatId: TeamSeatId, sessionId: SessionId): Promise<void>

/**
 * Set or clear a team seat's model override.
 * @param seatId - team seat identifier.
 * @param model - model selection override.
 * @param revision - optional checkpoint revision.
 * @returns updated team seat if found.
 */
async setSeatModelOverride( seatId: TeamSeatId, model?: AssistantModelSelection | ModelSelection , revision?: number, ): Promise<TeamSeat | undefined>

/**
 * Bind a session to a team seat for seat-level routing.
 * @param sessionId - session identifier.
 * @param seatId - team seat identifier.
 */
bindSessionToSeat(sessionId: SessionId | string, seatId: TeamSeatId): void

/**
 * List all non-archived assistant profiles, or all profiles including archived ones.
 * @param includeArchived - whether to include archived profiles.
 * @returns list of matching assistant profiles.
 */
async listProfiles(includeArchived: boolean = false): Promise<readonly AssistantProfile[]>

/**
 * Retrieve an assistant profile by identifier.
 * @param id - profile identifier.
 * @returns profile if found, otherwise undefined.
 */
async getProfile(id: AssistantProfileId): Promise<AssistantProfile | undefined>

/**
 * Synchronously retrieve an assistant profile by identifier.
 * @param id - profile identifier.
 * @returns profile if found, otherwise undefined.
 */
getProfileSync(id: AssistantProfileId): AssistantProfile | undefined

/**
 * Resolve the profile behind one session's binding: its private conversation first, then its team seat.
 * @param sessionId - session identifier.
 * @returns bound profile if the session belongs to an assistant conversation or a team seat.
 */
getBoundProfileSync(sessionId: SessionId | string): AssistantProfile | undefined

/**
 * Create a new persistent assistant profile.
 * @param options - creation options.
 * @returns the created assistant profile.
 */
async createProfile(options: CreateAssistantProfileOptions): Promise<AssistantProfile>

/**
 * Update an existing assistant profile.
 * @param id - profile identifier.
 * @param options - updated fields.
 * @param expectedRevision - optional expected revision guard.
 * @returns updated assistant profile.
 */
async updateProfile( id: AssistantProfileId, options: UpdateAssistantProfileOptions, expectedRevision?: number, ): Promise<AssistantProfile>

/**
 * Soft-archive an assistant profile.
 * @param id - profile identifier.
 */
async archiveProfile(id: AssistantProfileId): Promise<void>

/**
 * Unarchive an assistant profile.
 * @param id - profile identifier.
 */
async unarchiveProfile(id: AssistantProfileId): Promise<void>

/**
 * List conversations associated with an assistant profile, or all conversations.
 * @param profileId - optional profile identifier filter.
 * @param includeArchived - whether to include archived conversations (defaults to false).
 * @returns list of matching conversation bindings.
 */
async listConversations( profileId?: AssistantProfileId, includeArchived: boolean = false, ): Promise<readonly AssistantConversation[]>

/**
 * Retrieve an assistant conversation binding by its identifier.
 * @param id - conversation binding identifier.
 * @returns conversation binding if found.
 */
async getConversation(id: AssistantConversationId): Promise<AssistantConversation | undefined>

/**
 * Retrieve an assistant conversation binding by its root session identifier.
 * @param sessionId - root session identifier.
 * @returns conversation binding if found.
 */
async getConversationBySession(sessionId: SessionId): Promise<AssistantConversation | undefined>

/**
 * Create an assistant conversation binding for a root session, or allocate a fresh session.
 * If rootSessionId is omitted, allocates a fresh session through the official SessionController.
 * @param profileId - assistant profile identifier.
 * @param rootSessionIdOrOptions - session identifier or creation options.
 * @param options - optional binding parameters if rootSessionId was passed as second argument.
 * @returns created conversation binding.
 */
async createConversation( profileId: AssistantProfileId, rootSessionIdOrOptions?: SessionId | CreateAssistantConversationOptions, options?: CreateAssistantConversationOptions, ): Promise<AssistantConversation>

/**
 * Start a new topic (allocating a fresh root session) for an assistant profile.
 * @param profileId - assistant profile identifier.
 * @param options - optional creation options.
 * @returns newly created assistant conversation binding.
 */
async startNewTopic( profileId: AssistantProfileId, options: CreateAssistantConversationOptions = {}, ): Promise<AssistantConversation>

/**
 * Set or update explicit conversation-scoped model override.
 * @param id - conversation identifier.
 * @param model - model selection override.
 * @param checkpoint - optional replay sequence checkpoint.
 * @returns updated conversation binding.
 */
async setConversationModelOverride( id: AssistantConversationId, model?: AssistantModelSelection , checkpoint?: number , ): Promise<AssistantConversation>

/**
 * Atomically clear conversation-scoped model override and advance replay checkpoint.
 * @param id - conversation identifier.
 * @param checkpoint - optional explicit sequence checkpoint.
 * @returns updated conversation binding inheriting from profile/seat.
 */
async clearConversationModelOverride( id: AssistantConversationId, checkpoint?: number , ): Promise<AssistantConversation>

/**
 * Soft-archive an assistant conversation binding record.
 * @param id - conversation identifier.
 * @returns archived conversation binding.
 */
async archiveConversation(id: AssistantConversationId): Promise<AssistantConversation>

/**
 * Seed conversation model override from durable model/selection events on the session.
 * Respects replay checkpoint: only events strictly newer than modelCheckpoint are eligible.
 * @param id - conversation identifier.
 * @param persistence - optional session persistence instance (defaults to ctx.sessionPersistence).
 * @param signal - optional cancellation signal.
 * @returns conversation binding with updated override if eligible events were found.
 */
async seedConversationFromPersistence( id: AssistantConversationId, persistence?: SessionPersistence, signal?: AbortSignal, ): Promise<AssistantConversation>

/**
 * List all permitted session identifiers for active conversations of a profile, or all profiles.
 * Excludes archived conversations and conversations whose profile is archived.
 * @param profileId - optional profile identifier filter.
 * @param includeArchived - whether to include archived conversations and profiles.
 * @returns array of permitted SessionId instances.
 */
async listPermittedSessions( profileId?: AssistantProfileId, includeArchived: boolean = false, ): Promise<readonly SessionId[]>

/**
 * Synchronizes the effective route to SessionController's in-memory selection reference
 * if SessionController is available and the session is active.
 * @param sessionId - target session identifier.
 */
syncAgentSelection(sessionId: SessionId | string): void

/**
 * Clears assembled selection on the agent's installed selection reference
 * to prevent duplicate or false switch notices from the official listener.
 * @param sessionId - target session identifier.
 */
clearAssembledSelection(sessionId: SessionId | string): void

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
async submitPrompt( request: SessionPromptRequest, signal?: AbortSignal, ): Promise<SessionPromptValue>

/**
 * List team definitions with optional archived filter.
 * @param includeArchived - whether to include archived teams (defaults to false).
 * @returns list of team definitions.
 */
async listTeams(includeArchived: boolean = false): Promise<readonly TeamDefinition[]>

/**
 * Retrieve a team definition by identifier.
 * @param id - team definition identifier.
 * @returns team definition if found.
 */
async getTeam(id: TeamDefinitionId): Promise<TeamDefinition | undefined>

/**
 * Read the current live team activity without restoring dormant sessions.
 * @param teamId - saved team identifier.
 * @returns current roster, tasks, and interactions, or undefined when dormant.
 */
@Remote('getTeamActivity') async getTeamActivity(teamId: TeamDefinitionId): Promise<AgentTeamView | undefined>

/**
 * Create a new team definition record.
 * @param options - creation options.
 * @returns created team definition.
 */
async createTeam(options: CreateTeamDefinitionOptions): Promise<TeamDefinition>

/**
 * Update an existing team definition record with CAS revision check.
 * @param id - team definition identifier.
 * @param expectedRevision - expected revision for CAS update.
 * @param options - update options.
 * @returns updated team definition.
 */
async updateTeam( id: TeamDefinitionId, expectedRevision: number, options: UpdateTeamDefinitionOptions, ): Promise<TeamDefinition>

/**
 * Soft-archive a team definition record.
 * @param id - team definition identifier.
 * @returns archived team definition.
 */
async archiveTeam(id: TeamDefinitionId): Promise<TeamDefinition>

/**
 * Create a new team seat record.
 * @param options - creation options.
 * @returns created team seat.
 */
async createSeat(options: CreateTeamSeatOptions): Promise<TeamSeat>

/**
 * Retrieve a team seat by identifier.
 * @param id - team seat identifier.
 * @returns team seat if found.
 */
async getSeat(id: TeamSeatId): Promise<TeamSeat | undefined>

/**
 * Synchronously list all seats belonging to a team.
 * @param teamId - team definition identifier.
 * @returns list of team seats.
 */
listSeatsSync(teamId: TeamDefinitionId): readonly TeamSeat[]

/**
 * List all seats belonging to a team.
 * @param teamId - team definition identifier.
 * @returns list of team seats.
 */
async listSeats(teamId: TeamDefinitionId): Promise<readonly TeamSeat[]>

/**
 * Update an existing team seat.
 * @param id - team seat identifier.
 * @param options - update options.
 * @returns updated team seat.
 */
async updateSeat(id: TeamSeatId, options: UpdateTeamSeatOptions): Promise<TeamSeat>

/**
 * Retire a team seat.
 * Prevents future routing to this seat while preserving history.
 * @param id - team seat identifier.
 * @param options - optional retirement options (e.g. force).
 * @returns retired team seat.
 */
@Remote('seat_retire') async retireSeat(id: TeamSeatId, options?: RetireSeatOptions): Promise<TeamSeat>

/**
 * Replace a failed runtime instance on a seat with a fresh instance name.
 * Reserves the new name permanently before any spawn, requires a real runtime spawn through the team's
 * live lead, applies the seat's effective route at spawn, and preserves the failed instance's history.
 * A denied or failed spawn propagates; it is never replaced by an unrelated root session.
 * @param seatId - target seat identifier.
 * @param newInstanceName - fresh instance name.
 * @returns updated team seat.
 */
@Remote('seat_replace_instance') async replaceSeatInstance(seatId: TeamSeatId, newInstanceName: SessionId | string): Promise<TeamSeat>

/**
 * Retrieve capacity accounting for a team, separating live occupancy from history.
 * @param teamId - team definition identifier.
 * @param maxCapacity - optional team capacity ceiling (defaults to 10).
 * @returns capacity accounting metrics.
 */
@Remote('team_capacity') async getCapacityAccounting(teamId: TeamDefinitionId, maxCapacity?: number): Promise<TeamCapacityAccounting>

/**
 * Create an editable independent team definition and seats copied from a template.
 * @param templateId - template identifier ('blank', 'document', 'case', 'comms').
 * @param options - creation options.
 * @returns created team and seats.
 */
async createTeamFromTemplate( templateId: TeamTemplateOrigin, options: { coordinatorProfileId: AssistantProfileId name?: string avatar?: string description?: string sharedWorkspaceId?: string }, ): Promise<{ team: TeamDefinition; seats: readonly TeamSeat[] }>

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
async provisionTeam( teamId: TeamDefinitionId, options?: { signal?: AbortSignal }, ): Promise<{ team: TeamDefinition coordinatorSessionId: SessionId seatInstances: Record<string, SessionId> }>

/**
 * Dispatch a user prompt to a team's coordinator following coordinator-first dispatch.
 * @param teamId - team definition identifier.
 * @param request - prompt request.
 * @param signal - optional cancellation signal.
 * @returns prompt execution result.
 */
async dispatchCoordinator( teamId: TeamDefinitionId, request: SessionPromptRequest, signal?: AbortSignal, ): Promise<SessionPromptValue>

/**
 * List all non-archived assistant profiles through the generated Remote API.
 * @param includeArchived - whether to include archived profiles.
 * @returns list of assistant profiles.
 */
@Remote('listProfiles') async remoteListProfiles(includeArchived?: boolean): Promise<readonly AssistantProfile[]>

/**
 * Retrieve an assistant profile by identifier through the generated Remote API.
 * @param id - profile identifier.
 * @returns assistant profile if found.
 */
@Remote('getProfile') async remoteGetProfile(id: AssistantProfileId): Promise<AssistantProfile | undefined>

/**
 * Create a new persistent assistant profile through the generated Remote API.
 * @param options - profile creation options.
 * @returns created assistant profile.
 */
@Remote('createProfile') async remoteCreateProfile(options: CreateAssistantProfileOptions): Promise<AssistantProfile>

/**
 * Update an existing assistant profile through the generated Remote API.
 * @param id - profile identifier.
 * @param options - updated fields.
 * @param expectedRevision - optional expected revision for concurrency control.
 * @returns updated assistant profile.
 */
@Remote('updateProfile') async remoteUpdateProfile( id: AssistantProfileId, options: UpdateAssistantProfileOptions, expectedRevision?: number, ): Promise<AssistantProfile>

/**
 * Update one team seat's duty or model override through the generated Remote API.
 * @param id - team seat identifier.
 * @param options - seat fields to update; `modelOverride: null` clears the override to inherit.
 * @returns updated team seat.
 */
@Remote('updateSeat') async remoteUpdateSeat( id: TeamSeatId, options: { readonly duty?: string | undefined; readonly modelOverride?: AssistantModelSelection | null | undefined }, ): Promise<TeamSeat>

/**
 * Soft-archive an assistant profile through the generated Remote API.
 * @param id - profile identifier.
 */
@Remote('archiveProfile') async remoteArchiveProfile(id: AssistantProfileId): Promise<void>

/**
 * Unarchive an assistant profile through the generated Remote API.
 * @param id - profile identifier.
 */
@Remote('unarchiveProfile') async remoteUnarchiveProfile(id: AssistantProfileId): Promise<void>

/**
 * List conversations associated with an assistant profile through the generated Remote API.
 * @param profileId - optional profile identifier filter.
 * @param includeArchived - whether to include archived conversations.
 * @returns list of matching conversation bindings.
 */
@Remote('listConversations') async remoteListConversations( profileId?: AssistantProfileId, includeArchived?: boolean, ): Promise<readonly AssistantConversation[]>

/**
 * Retrieve an assistant conversation binding by identifier through the generated Remote API.
 * @param id - conversation binding identifier.
 * @returns conversation binding if found.
 */
@Remote('getConversation') async remoteGetConversation(id: AssistantConversationId): Promise<AssistantConversation | undefined>

/**
 * Retrieve an assistant conversation binding by its root session identifier through the generated Remote API.
 * @param sessionId - root session identifier.
 * @returns conversation binding if found.
 */
@Remote('getConversationBySession') async remoteGetConversationBySession(sessionId: SessionId): Promise<AssistantConversation | undefined>

/**
 * Create an assistant conversation binding through the generated Remote API.
 * @param profileId - assistant profile identifier.
 * @param options - creation options.
 * @returns created conversation binding.
 */
@Remote('createConversation') async remoteCreateConversation( profileId: AssistantProfileId, options?: CreateAssistantConversationOptions, ): Promise<AssistantConversation>

/**
 * Start a new topic for an assistant profile through the generated Remote API.
 * @param profileId - assistant profile identifier.
 * @param options - optional creation options.
 * @returns newly created conversation binding.
 */
@Remote('startNewTopic') async remoteStartNewTopic( profileId: AssistantProfileId, options?: CreateAssistantConversationOptions, ): Promise<AssistantConversation>

/**
 * Set or update explicit conversation-scoped model override through the generated Remote API.
 * @param id - conversation identifier.
 * @param model - model selection override.
 * @returns updated conversation binding.
 */
@Remote('setConversationModelOverride') async remoteSetConversationModelOverride( id: AssistantConversationId, model?: AssistantModelSelection, ): Promise<AssistantConversation>

/**
 * Clear explicit conversation-scoped model override through the generated Remote API.
 * @param id - conversation identifier.
 * @returns updated conversation binding.
 */
@Remote('clearConversationModelOverride') async remoteClearConversationModelOverride(id: AssistantConversationId): Promise<AssistantConversation>

/**
 * List all team definitions through the generated Remote API.
 * @param includeArchived - whether to include archived teams.
 * @returns list of team definitions.
 */
@Remote('listTeams') async remoteListTeams(includeArchived?: boolean): Promise<readonly TeamDefinition[]>

/**
 * Retrieve a team definition by identifier through the generated Remote API.
 * @param id - team definition identifier.
 * @returns team definition if found.
 */
@Remote('getTeam') async remoteGetTeam(id: TeamDefinitionId): Promise<TeamDefinition | undefined>

/**
 * Create a new team definition through the generated Remote API.
 * @param options - creation options.
 * @returns created team definition.
 */
@Remote('createTeam') async remoteCreateTeam(options: CreateTeamDefinitionOptions): Promise<TeamDefinition>

/**
 * Update an existing team definition through the generated Remote API.
 * @param id - team definition identifier.
 * @param expectedRevision - expected revision for CAS update.
 * @param options - updated fields.
 * @returns updated team definition.
 */
@Remote('updateTeam') async remoteUpdateTeam( id: TeamDefinitionId, expectedRevision: number, options: UpdateTeamDefinitionOptions, ): Promise<TeamDefinition>

/**
 * Soft-archive a team definition through the generated Remote API.
 * @param id - team definition identifier.
 * @returns archived team definition.
 */
@Remote('archiveTeam') async remoteArchiveTeam(id: TeamDefinitionId): Promise<TeamDefinition>

/**
 * List all seats belonging to a team through the generated Remote API.
 * @param teamId - team definition identifier.
 * @returns list of team seats.
 */
@Remote('listSeats') async remoteListSeats(teamId: TeamDefinitionId): Promise<readonly TeamSeat[]>

/**
 * Retrieve a team seat by identifier through the generated Remote API.
 * @param id - team seat identifier.
 * @returns team seat if found.
 */
@Remote('getSeat') async remoteGetSeat(id: TeamSeatId): Promise<TeamSeat | undefined>

/**
 * Create a team definition and seats from a template through the generated Remote API.
 * @param templateId - template identifier.
 * @param options - template instantiation options.
 * @returns created team definition and seats.
 */
@Remote('createTeamFromTemplate') async remoteCreateTeamFromTemplate( templateId: TeamTemplateOrigin, options: { coordinatorProfileId: AssistantProfileId name?: string avatar?: string description?: string sharedWorkspaceId?: string }, ): Promise<{ team: TeamDefinition; seats: readonly TeamSeat[] }>

/**
 * Synchronously look up an adoption record by squad identifier.
 * @param squadId - squad identifier.
 * @returns adoption record if present.
 */
getAdoptionSync(squadId: string): InstitutionAdoptionRecord | undefined

/**
 * Synchronously look up an adoption record by lead session identifier.
 * @param leadSessionId - lead session identifier.
 * @returns adoption record if present.
 */
getAdoptionByLeadSessionSync(leadSessionId: SessionId): InstitutionAdoptionRecord | undefined

/**
 * Synchronously list all institution adoption records.
 * @returns list of adoption records.
 */
listAdoptionsSync(): readonly InstitutionAdoptionRecord[]

/**
 * Look up an institution squad adoption record by squad identifier.
 * @param squadId - squad identifier ('document' | 'case' | 'comms').
 * @returns adoption record if found.
 */
@Remote('institution_adoption_get') getAdoption(squadId: 'document' | 'case' | 'comms'): Promise<InstitutionAdoptionRecord | undefined>

/**
 * List all committed institution squad adoption records.
 * @returns list of adoption records.
 */
@Remote('institution_adoption_list') listAdoptions(): Promise<readonly InstitutionAdoptionRecord[]>

/**
 * Adopt an existing institution squad into a managed team definition.
 * Runs within the legacy catalog's serialized write chain to coordinate with legacy writers.
 * Validates lead existence, child parent pointers, and continuable descriptors.
 * Requires repair if bindings diverge or a child is unreadable.
 * @param options - adoption parameters.
 * @returns committed adoption record and created team definition.
 */
@Remote('institution_adoption_adopt') async adoptInstitutionSquad( options: AdoptInstitutionSquadOptions, ): Promise<{ adoption: InstitutionAdoptionRecord; team: TeamDefinition }>

/**
 * Validate an existing adoption record against the current legacy institution catalog.
 * If the legacy writer changed the lead binding, transitions adoption status to 'repair_needed'.
 * @param squadId - squad identifier.
 * @returns updated adoption record.
 */
@Remote('institution_adoption_validate') async validateAdoptionState(squadId: 'document' | 'case' | 'comms'): Promise<InstitutionAdoptionRecord>

/**
 * Repair an adopted institution squad whose binding or child sessions diverged.
 * Runs inside the legacy catalog's serialized write chain, re-validates the repaired lead and every
 * child descriptor, and re-reads the legacy binding after its write: a concurrent legacy writer that
 * moves the lead again leaves the record in 'repair_needed' instead of silently diverging.
 * @param options - repair options.
 * @returns repaired adoption record.
 */
@Remote('institution_adoption_repair') async repairInstitutionAdoption( options: RepairInstitutionAdoptionOptions, ): Promise<InstitutionAdoptionRecord>

/**
 * Provision a team into runtime sessions through the generated Remote API.
 * @param teamId - team definition identifier.
 * @returns provisioned team and seat instance sessions.
 */
@Remote('provisionTeam') async remoteProvisionTeam( teamId: TeamDefinitionId, ): Promise<{ team: TeamDefinition; coordinatorSessionId: SessionId; seatInstances: Record<string, SessionId> }>

/**
 * Dispatch a user prompt to a team's coordinator through the generated Remote API.
 * @param teamId - team definition identifier.
 * @param request - session prompt request.
 * @returns prompt execution result.
 */
@Remote('dispatchCoordinator') async remoteDispatchCoordinator( teamId: TeamDefinitionId, request: SessionPromptRequest, ): Promise<SessionPromptValue>

/**
 * Save a persistent memory entry for a profile or team scope.
 * @param scope - memory scope.
 * @param text - memory content text.
 * @param options - optional source session and author options.
 * @returns saved memory entry.
 */
@Remote('saveMemory') async saveMemory( scope: MemoryScope, text: string, options?: SaveMemoryOptions, ): Promise<MemoryEntry>

/**
 * Update an existing memory entry with CAS revision check.
 * @param id - memory entry identifier.
 * @param expectedRevision - expected revision for CAS.
 * @param text - updated memory text.
 * @returns updated memory entry.
 */
@Remote('updateMemory') async updateMemory( id: MemoryEntryId, expectedRevision: number, text: string, ): Promise<MemoryEntry>

/**
 * Mark a memory entry as removed (tombstone) with optional CAS revision check.
 * @param id - memory entry identifier.
 * @param expectedRevision - optional expected revision.
 * @returns removed memory entry.
 */
@Remote('removeMemory') async removeMemory( id: MemoryEntryId, expectedRevision?: number, ): Promise<MemoryEntry>

/**
 * Archive a memory entry with optional CAS revision check.
 * @param id - memory entry identifier.
 * @param expectedRevision - optional expected revision.
 * @returns archived memory entry.
 */
@Remote('archiveMemory') async archiveMemory( id: MemoryEntryId, expectedRevision?: number, ): Promise<MemoryEntry>

/**
 * Unarchive a memory entry with optional CAS revision check.
 * @param id - memory entry identifier.
 * @param expectedRevision - optional expected revision.
 * @returns unarchived memory entry.
 */
@Remote('unarchiveMemory') async unarchiveMemory( id: MemoryEntryId, expectedRevision?: number, ): Promise<MemoryEntry>

/**
 * Grant access to a profile-scoped memory entry to a specific team.
 * @param id - memory entry identifier.
 * @param teamId - recipient team identifier.
 * @param expectedRevision - optional expected revision.
 * @returns updated memory entry.
 */
@Remote('grantMemory') async grantMemory( id: MemoryEntryId, teamId: TeamDefinitionId, expectedRevision?: number, ): Promise<MemoryEntry>

/**
 * Revoke a team grant from a profile-scoped memory entry.
 * @param id - memory entry identifier.
 * @param teamId - team identifier to revoke.
 * @param expectedRevision - optional expected revision.
 * @returns updated memory entry.
 */
@Remote('revokeMemoryGrant') async revokeMemoryGrant( id: MemoryEntryId, teamId: TeamDefinitionId, expectedRevision?: number, ): Promise<MemoryEntry>

/**
 * Get a memory entry by identifier.
 * @param id - memory entry identifier.
 * @returns memory entry or undefined.
 */
@Remote('getMemory') async getMemory(id: MemoryEntryId): Promise<MemoryEntry | undefined>

/**
 * Synchronous memory lookup.
 * @param id - memory entry identifier.
 * @returns memory entry or undefined.
 */
getMemorySync(id: MemoryEntryId): MemoryEntry | undefined

/**
 * List memory entries matching a scope.
 * @param scope - memory scope.
 * @param options - filter options.
 * @returns readonly array of memory entries.
 */
@Remote('listMemory') async listMemory( scope: MemoryScope, options?: ListMemoryOptions, ): Promise<readonly MemoryEntry[]>

/**
 * Synchronous memory list for prompt injection and local lookups.
 * @param scope - memory scope.
 * @param options - filter options.
 * @returns readonly array of memory entries.
 */
listMemorySync( scope: MemoryScope, options: ListMemoryOptions = {}, ): readonly MemoryEntry[]

/**
 * List profile memories granted to a specific team synchronously.
 * @param teamId - recipient team identifier.
 * @param profileId - optional profile filter.
 * @returns readonly array of granted profile memories.
 */
listGrantedProfileMemoriesSync( teamId: TeamDefinitionId, profileId?: AssistantProfileId, ): readonly MemoryEntry[]

/**
 * Recall active memory entries matching a query.
 * @param scope - memory scope.
 * @param query - optional search string.
 * @returns matching active memory entries.
 */
@Remote('recallMemory') async recallMemory( scope: MemoryScope, query?: string, ): Promise<readonly MemoryEntry[]>

/**
 * Synchronous recall for prompt injection and local search.
 * @param scope - memory scope.
 * @param query - optional search string.
 * @returns matching active memory entries.
 */
recallMemorySync( scope: MemoryScope, query?: string, ): readonly MemoryEntry[]

/**
 * Promote a team-scoped memory entry into an assistant's private profile memory.
 * Requires explicit owner authorization; team members cannot promote unilaterally.
 * @param teamMemoryId - id of the team memory entry.
 * @param targetProfileId - profile receiving the promoted memory.
 * @param authorized - whether this promotion is authorized by the owner.
 * @returns newly created profile memory entry.
 */
@Remote('promoteTeamMemoryToProfile') async promoteTeamMemoryToProfile( teamMemoryId: MemoryEntryId, targetProfileId: AssistantProfileId, authorized: boolean, ): Promise<MemoryEntry>

/**
 * Acquire exclusive execution ownership over a session for a slot.
 * @param params - round, slot, attempt, session, and owner details.
 * @returns established or existing re-entrant ownership token.
 */
acquireExecutionOwnership(params: AcquireOwnershipParams): ExecutionOwnershipToken

/**
 * Release execution ownership for a session.
 * @param tokenOrSessionId - token or target session identifier.
 * @returns true if an active token was removed.
 */
releaseExecutionOwnership(tokenOrSessionId: string | ExecutionOwnershipToken | SessionId): boolean

/**
 * Look up the currently active ownership token for a session.
 * @param sessionId - target session identity.
 * @returns active token or undefined.
 */
getExecutionOwnership(sessionId: SessionId): ExecutionOwnershipToken | undefined

/**
 * Retrieve all recorded conflicts for a session.
 * @param sessionId - target session identity.
 * @returns list of detected conflicts.
 */
getOwnershipConflicts(sessionId: SessionId): readonly ForeignOwnershipConflict[]

/**
 * Whether any conflicts have been recorded for a session.
 * @param sessionId - target session identity.
 * @returns true if conflicts exist.
 */
hasOwnershipConflict(sessionId: SessionId): boolean

/**
 * Clear all recorded conflicts for a session.
 * @param sessionId - target session identity.
 */
clearOwnershipConflicts(sessionId: SessionId): void

/**
 * Hold a slot input in the fork-owned queue before the slot starts.
 * @param params - round, slot, attempt, session, and payload.
 * @returns the created queued slot entry.
 */
enqueueSlotInput<T>(params: EnqueueSlotInputParams<T>): QueuedSlotInput<T>

/**
 * Start execution for a queued slot, acquiring ownership and transitioning to active.
 * @param roundId - group round identity.
 * @param slotId - slot identity.
 * @param options - optional owner and delegation details.
 * @returns the activated input and newly established ownership token.
 */
startSlot( roundId: string, slotId: string, options?: { ownerId?: string; delegationChain?: readonly string[] }, ): { input: QueuedSlotInput; token: ExecutionOwnershipToken }

/**
 * Cancel a slot. If unstarted in queue, removes only that slot input.
 * If actively executing, interrupts only that slot's work and releases ownership.
 * @param roundId - group round identity.
 * @param slotId - slot identity.
 * @param reason - optional cancellation reason.
 * @returns result stating whether cancellation occurred and whether the slot was active.
 */
cancelSlot(roundId: string, slotId: string, reason?: string): CancelSlotResult

/**
 * Mark a slot execution as completed or failed, releasing its ownership.
 * @param roundId - group round identity.
 * @param slotId - slot identity.
 * @param error - optional failure error string.
 */
completeSlot(roundId: string, slotId: string, error?: string): void

/**
 * List all queued slot inputs, optionally filtered by round.
 * @param roundId - optional round filter.
 * @returns list of queued slot inputs.
 */
listQueuedSlotInputs(roundId?: string): readonly QueuedSlotInput[]

/**
 * Validate submission to a session, detecting foreign ownership and recording conflict if violated.
 * @param sessionId - target session identity.
 * @param callerInfo - candidate caller identity and token.
 * @returns validation result with error details if forbidden.
 */
validateSubmission( sessionId: SessionId, callerInfo?: { token?: string | undefined; callerId?: string | undefined; path?: string | undefined }, ): { allowed: boolean; conflict?: ForeignOwnershipConflict }

/**
 * Create a new group discussion room.
 * @param options - discussion creation options.
 * @returns newly created discussion.
 */
@Remote('createDiscussion') async createDiscussion(options: CreateGroupDiscussionOptions): Promise<GroupDiscussion>

/**
 * Get an existing group discussion by id.
 * @param id - discussion identifier.
 * @returns discussion or undefined.
 */
getDiscussion(id: GroupDiscussionId): GroupDiscussion | undefined

/**
 * List all discussions belonging to a team.
 * @param teamId - team definition identifier.
 * @returns array of discussions.
 */
listDiscussions(teamId: TeamDefinitionId): readonly GroupDiscussion[]

/**
 * List all discussions belonging to a team via Typert Remote.
 * @param teamId - team definition identifier.
 * @returns array of discussions.
 */
@Remote('listDiscussions') async remoteListDiscussions(teamId: TeamDefinitionId): Promise<readonly GroupDiscussion[]>

/**
 * Schedule a new group round according to coordinator-first and explicit-recipient rules.
 * @param options - round scheduling options.
 * @returns newly scheduled group round journal entry.
 */
@Remote('scheduleRound') async scheduleRound(options: ScheduleRoundOptions): Promise<GroupRoundJournalEntry>

/**
 * Execute a scheduled group round with committed cursors and bounds.
 * @param roundId - identifier of round to execute.
 * @param options - execution options.
 * @returns completed or terminated round record.
 */
async executeRound(roundId: GroupRoundId, options?: ExecuteRoundOptions): Promise<GroupRoundJournalEntry>

/**
 * Execute owned seat work using the production executor over RPC.
 * @param roundId - admitted round identity.
 * @param signal - caller cancellation for the owned execution.
 * @returns terminal or explicitly uncertain round record.
 */
@Remote('executeRound') async remoteExecuteRound(roundId: GroupRoundId, signal?: AbortSignal): Promise<GroupRoundJournalEntry>

/**
 * Start owned execution without occupying a serialized desktop RPC channel.
 * Poll getRound for completion; cancelRound stops owned work. Execution errors
 * remain visible through getRound until an explicit start retries recovery.
 * @param roundId - durably admitted round identity.
 * @returns retained admission record; execution may still be pending or active.
 */
@Remote('startRound') async startRound(roundId: GroupRoundId): Promise<GroupRoundJournalEntry>

/**
 * Read an admitted round and its durable slot checkpoints.
 * @param roundId - admitted round identity.
 * @returns retained round record when present.
 */
@Remote('getRound') async getRound(roundId: GroupRoundId): Promise<GroupRoundJournalEntry | undefined>

/**
 * Query the public transcript with scope authorization, pagination, and source attribution.
 * @param options - query options.
 * @returns paginated transcript result.
 */
@Remote('queryPublicTranscript') async queryPublicTranscript(options: QueryPublicTranscriptOptions): Promise<QueryPublicTranscriptResult>

/**
 * Cancel an in-progress or pending group round.
 * @param roundId - round identifier.
 * @param reason - cancellation reason.
 * @returns updated round journal entry.
 */
@Remote('cancelRound') async cancelRound(roundId: GroupRoundId, reason?: string): Promise<GroupRoundJournalEntry>

/**
 * Publish a committed but not-yet-posted reply during crash recovery.
 * @param roundId - round identifier.
 * @param slotId - slot identifier.
 * @returns committed public message.
 */
async publishCommittedReply(roundId: GroupRoundId, slotId: RoundSlotId): Promise<GroupTranscriptMessage>

/**
 * Set durable read cursor for a logical conversation or discussion.
 * @param conversationId - conversation or discussion identifier.
 * @param lastReadSeq - highest event sequence number read.
 * @param windowId - optional window identifier.
 * @returns updated read cursor record.
 */
@Remote('setReadCursor') async setReadCursor( conversationId: string, lastReadSeq: number, windowId?: string, ): Promise<ReadCursorRecord>

/**
 * Get durable read cursor for a conversation or discussion.
 * @param conversationId - conversation or discussion identifier.
 * @returns read cursor record or undefined.
 */
getReadCursor(conversationId: string): ReadCursorRecord | undefined

/**
 * Get durable read cursor via Typert Remote.
 * @param conversationId - conversation or discussion identifier.
 * @returns read cursor record or undefined.
 */
@Remote('getReadCursor') async remoteGetReadCursor(conversationId: string): Promise<ReadCursorRecord | undefined>

/**
 * Calculate unread event count for a conversation.
 * @param conversationId - conversation identifier.
 * @param latestSeq - latest known event sequence number.
 * @returns unread count.
 */
getUnreadCount(conversationId: string, latestSeq: number): number

/**
 * Search events across permitted sessions with stable author attribution.
 * @param request - query parameters.
 * @param auth - scope authorization parameters.
 * @returns matched event hits with stable attribution.
 */
async searchEventsScoped( request: { query: string; limit?: number }, auth: ScopedQueryAuthorization, ): Promise<readonly ScopedSessionEventHit[]>

/**
 * Observe a session within authorized scope boundaries.
 * @param sessionId - target session identifier.
 * @param auth - scope authorization parameters.
 * @returns session observation handle.
 */
async observeSessionScoped(sessionId: SessionId, auth: ScopedQueryAuthorization): Promise<unknown>

/**
 * Record an auxiliary inference call (e.g. title, review, prediction).
 * @param record - auxiliary usage record.
 * @returns void promise.
 */
@Remote('recordAuxiliaryUsage') async recordAuxiliaryUsage(record: AuxiliaryUsageRecord): Promise<void>

/**
 * Aggregate usage over sessions or bindings according to request criteria.
 * @param request - aggregation request.
 * @returns array of binding usage summaries.
 */
@Remote('aggregateUsage') async aggregateUsage(request: AggregateUsageRequest): Promise<readonly BindingUsageSummary[]>

/**
 * Perform bounded per-turn memory review.
 * Filters out secrets and system instructions, deduplicates against existing memories in scope,
 * adds accepted entries to the catalog, and accounts for auxiliary inference usage.
 * @param request - review turn request parameters.
 * @returns review result containing candidate, added, and rejected entries.
 */
@Remote('reviewTurn') async reviewTurn(request: ReviewTurnRequest): Promise<ReviewTurnResult>

/**
 * Generate one bounded tool-free prediction for an eligible completed turn.
 * Bounded by maxPredictionTokens and predictionTimeoutMs. Accounts for auxiliary usage.
 * Records auxiliary evidence without adding a conversation turn or public reply.
 * @param request - composer prediction request parameters.
 * @param signal - cancellation for the auxiliary model request.
 * @returns composer prediction result or null if disabled / failed.
 */
@Remote('predictComposer') async predictComposer(request: ComposerPredictionRequest, signal?: AbortSignal): Promise<ComposerPredictionResult | null>

/**
 * Prepare bounded completed-turn text for the current persistent-assistant composer.
 * @param sessionId - active composer session.
 * @returns context for the latest successful completed turn, or null when ineligible.
 */
@Remote('getComposerContext') async getComposerContext(sessionId: SessionId): Promise<ComposerPredictionContext | null>

/**
 * Flush in-memory cursors and round journal to disk and close catalog if held.
 */
async dispose(): Promise<void>
```

Types: [LlmCallConfig](llm-streaming.zh.md) · [ModelSelection](core.zh.md) · [Session](session.zh.md) · [SessionId](core.zh.md) · [SessionPersistence](persistence.zh.md) · [SessionPromptRequest](session.zh.md) · [SessionPromptValue](session.zh.md) · [UserMessage](session.zh.md)

Source: [`packages/experimental/assistant-registry/src/index.ts`](../../packages/experimental/assistant-registry/src/index.ts)
<!-- END GENERATED cordis-surface -->

`ComposerPredictionContext` 包含成功完成轮次的事件序号（`asOfSeq`）与最多十段用户或助手文本（`recentTexts`），每段限制为 500 字符。Host 为符合条件的常驻智能体输入栏准备该值；Client 不从草稿修订号推导轮次身份。辅助请求与结果事件保留实际模型输入及去重计费，但不创建会话轮次。
