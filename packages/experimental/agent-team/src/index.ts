/** Agent Teams service façade over roster, mailbox, task, and runtime lifecycle owners. */

import { readFile } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve as resolvePath } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-fs'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { TeamActivity } from './activity.ts'
import { TeamAttribution } from './attribution.ts'
import { errorMessage, TeamError } from './error.ts'
import { TeamJournal } from './journal.ts'
import { TeamRuntimeLifecycle } from './lifecycle.ts'
import { TeamMailbox } from './mailbox.ts'
import { teamProjectionDefinition } from './projection.ts'
import { TeamRoster } from './roster.ts'
import type { TeamMembership } from './roster.ts'
import { TeamTaskBoard } from './task-board.ts'
import { teamInteractions } from './interactions.ts'
import { TeamId, TeamTaskId } from './types.ts'
import type {
  Config,
  CreateTeamTaskRequest,
  EnsureInstitutionSquadRequest,
  EnsureInstitutionSquadResult,
  InstitutionSquadView,
  ReadHtmlPreviewRequest,
  ReadHtmlPreviewResult,
  SendTeamMessageRequest,
  SendTeamMessageResult,
  SpawnTeammateRequest,
  SpawnTeammateResult,
  TeamMemberView,
  TeamTaskMutationResult,
  TeamTaskView,
  TeamView,
  TeamWaitResult,
  UpdateInstitutionSeatRequest,
  UpdateTeamTaskRequest,
} from './types.ts'
import {
  applySeatUpdate,
  InstitutionCatalog,
  INSTITUTION_SQUADS,
  projectInstitutionSquad,
  requireInstitutionSeat,
  requireInstitutionSquad,
  resolveInstitutionCatalogPath,
  standingSeatPrompt,
} from './institution.ts'

export type * from './types.ts'
export type { TeamMembership } from './roster.ts'
export { TeamId, TeamMessageId, TeamTaskId } from './types.ts'
export { TeamError } from './error.ts'
export {
  INSTITUTION_SQUAD_IDS, INSTITUTION_SQUADS, resolveInstitutionCatalogPath,
} from './institution.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentTeams: TeamService
  }
}

const DEFAULT_MAX_MEMBERS = 8
const DEFAULT_MAX_TASKS = 256
const DEFAULT_MAX_PENDING_MESSAGES = 64
const DEFAULT_MAX_MESSAGE_BYTES = 65_536
const DEFAULT_DISPOSAL_TIMEOUT_MS = 5_000
/** Upper bound for dock Archify HTML previews (2 MiB). */
const MAX_HTML_PREVIEW_BYTES = 2 * 1024 * 1024

/** Validate one positive safe-integer deployment limit. */
function positiveLimit(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TeamError(`${name} must be a positive safe integer`, 'TEAM_INVALID_CONFIG')
  }
  return value
}

/** Agent Teams service backed by the exact live Lead Session log. */
export class TeamService extends TypertRemoteService {
  static inject = ['agents', 'sessions', 'sessionPersistence', 'sessionProjections', 'subagents']

  static Config: z<Config> = z.object({
    maxMembers: z.number().step(1).min(1).default(DEFAULT_MAX_MEMBERS),
    maxTasks: z.number().step(1).min(1).default(DEFAULT_MAX_TASKS),
    maxPendingMessagesPerMember: z.number().step(1).min(1).default(DEFAULT_MAX_PENDING_MESSAGES),
    maxMessageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_MESSAGE_BYTES),
    disposalTimeoutMs: z.number().step(1).min(1).default(DEFAULT_DISPOSAL_TIMEOUT_MS),
    institutionCatalogPath: z.string().default(''),
    institutionFreshProvider: z.string().default('spawn'),
  })

  /** Validated deployment limits used by every Team operation. */
  private readonly config: Required<Config>
  private readonly institutionCatalog: InstitutionCatalog
  private readonly institutionFreshProvider: string

  private readonly activity: TeamActivity
  private readonly lifecycle: TeamRuntimeLifecycle
  private readonly attribution: TeamAttribution
  private readonly journal: TeamJournal
  private readonly roster: TeamRoster
  private readonly mailbox: TeamMailbox
  private readonly tasks: TeamTaskBoard

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'agentTeams')
    this.config = {
      maxMembers: positiveLimit('maxMembers', config.maxMembers ?? DEFAULT_MAX_MEMBERS),
      maxTasks: positiveLimit('maxTasks', config.maxTasks ?? DEFAULT_MAX_TASKS),
      maxPendingMessagesPerMember: positiveLimit(
        'maxPendingMessagesPerMember',
        config.maxPendingMessagesPerMember ?? DEFAULT_MAX_PENDING_MESSAGES,
      ),
      maxMessageBytes: positiveLimit('maxMessageBytes', config.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES),
      disposalTimeoutMs: positiveLimit(
        'disposalTimeoutMs',
        config.disposalTimeoutMs ?? DEFAULT_DISPOSAL_TIMEOUT_MS,
      ),
      institutionCatalogPath: config.institutionCatalogPath ?? '',
      institutionFreshProvider: config.institutionFreshProvider ?? 'spawn',
    }
    this.institutionFreshProvider = this.config.institutionFreshProvider
    this.institutionCatalog = new InstitutionCatalog(
      resolveInstitutionCatalogPath(this.config.institutionCatalogPath),
    )

    this.activity = new TeamActivity()
    this.lifecycle = new TeamRuntimeLifecycle(this.config.disposalTimeoutMs)
    this.journal = new TeamJournal(ctx, (root) => { this.activity.notify(TeamId(root.id)) })
    this.roster = new TeamRoster(ctx, this.journal, this.lifecycle, this.config.maxMembers)
    this.attribution = new TeamAttribution(this.roster)
    this.mailbox = new TeamMailbox(
      ctx,
      this.journal,
      this.roster,
      this.lifecycle,
      this.config.maxPendingMessagesPerMember,
      this.config.maxMessageBytes,
    )
    this.tasks = new TeamTaskBoard(this.journal, this.config.maxTasks)

    ctx.on('session/event', (session, event) => { this.mailbox.observeSessionEvent(session, event) })
    ctx.on('fs/observed', (target, observation, actor, operation) => { this.attribution.observe(target, observation, actor, operation) })
    ctx.on('fs/error-remedy', (request, next) => {
      const enriched = this.attribution.remedy(request)
      return Promise.resolve(enriched === undefined ? next() : enriched)
    })
    ctx.on('agent/session-start', ({ agent }) => { this.scheduleRecovery(agent) })
    ctx.on('agent/status', ({ agent }) => {
      const membership = this.roster.tryMembership(agent)
      if (membership !== undefined) this.activity.notify(membership.id)
    })
    ctx.effect(() => {
      const disposeProjection = ctx.root.sessionProjections.register(teamProjectionDefinition)
      return async () => {
        try {
          await this.disposeRuntime()
        } finally {
          disposeProjection()
        }
      }
    }, 'agentTeams.runtimeLifecycle()')
    for (const agent of ctx.agents.list()) this.scheduleRecovery(agent)
  }

  /**
   * Resolve one exact live Agent's Team role.
   * @param agent - exact live Agent used as the authority credential.
   * @returns its root, Team identity, role, and model-facing name.
   */
  membership(agent: Agent): TeamMembership {
    return this.roster.membership(agent)
  }

  /**
   * List the runtime-enriched roster visible to one Team member.
   * @param agent - exact live Team member.
   * @returns Lead and teammate rows in creation order.
   */
  listMembers(agent: Agent): TeamMemberView[] {
    return this.roster.list(this.roster.membership(agent))
  }

  /**
   * Create one named, continuable direct child of the Team Lead.
   * @param caller - exact live Lead Agent.
   * @param request - immutable name, description, prompt, context mode, provider, and cancellation.
   * @returns the active roster row.
   */
  async spawnTeammate(caller: Agent, request: SpawnTeammateRequest): Promise<SpawnTeammateResult> {
    return await this.roster.spawn(caller, request)
  }

  /**
   * Queue one durable peer message, then attempt immediate delivery.
   * @param caller - exact live sending Team member.
   * @param request - target name, content, and pre-queue cancellation.
   * @returns durable message identity and immediate-delivery observation.
   */
  async sendMessage(caller: Agent, request: SendTeamMessageRequest): Promise<SendTeamMessageResult> {
    return await this.mailbox.send(caller, request)
  }

  /**
   * Create one unowned pending task in the Team Lead log.
   * @param caller - exact live Team member creating the task.
   * @param request - task text, blockers, and advisory write scopes.
   * @returns the revision-one task view.
   */
  async createTask(caller: Agent, request: CreateTeamTaskRequest): Promise<TeamTaskView> {
    return await this.tasks.create(this.roster.membership(caller), request)
  }

  /**
   * Return one task, including a deleted tombstone.
   * @param caller - exact live Team member reading the task.
   * @param id - Team-local task identity.
   * @returns the latest task value and derived readiness diagnostics.
   */
  getTask(caller: Agent, id: TeamTaskId): TeamTaskView {
    return this.tasks.get(this.roster.membership(caller), id)
  }

  /**
   * List current non-deleted tasks in numeric creation order.
   * @param caller - exact live Team member reading the board.
   * @returns detached current task views.
   */
  listTasks(caller: Agent): TeamTaskView[] {
    return this.tasks.list(this.roster.membership(caller))
  }

  /**
   * Compare-and-set one authorized task transition.
   * @param caller - exact live Team member authorizing the mutation.
   * @param request - task identity, expected revision, action, and action fields.
   * @returns the committed next task revision.
   */
  async updateTask(caller: Agent, request: UpdateTeamTaskRequest): Promise<TeamTaskView> {
    return await this.tasks.update(caller, this.roster.membership(caller), request)
  }

  /**
   * Wait for the next Team-domain or member-status change.
   * @param caller - exact live Team member waiting for activity.
   * @param timeoutMs - bounded wait duration from ten seconds through one hour.
   * @param signal - caller cancellation for the wait only.
   * @returns one observed change or a timeout result.
   */
  async waitForChange(caller: Agent, timeoutMs: number, signal: AbortSignal): Promise<TeamWaitResult> {
    const membership = this.roster.membership(caller)
    return await this.activity.wait(membership.id, timeoutMs, signal)
  }

  /**
   * Interrupt one live teammate turn without clearing its pending inbox.
   * @param caller - exact live Lead Agent.
   * @param targetName - durable teammate name.
   * @returns the target status sampled before cancellation.
   */
  interrupt(caller: Agent, targetName: string): { previousStatus: 'running' | 'idle' | 'inactive' } {
    return this.roster.interrupt(caller, targetName)
  }

  /**
   * Resolve a caller without throwing, used by scoped-tool installation and observers.
   * @param agent - candidate exact live Agent.
   * @returns Team membership, or undefined for non-Team subagents and stale identities.
   */
  tryMembership(agent: Agent): TeamMembership | undefined {
    return this.roster.tryMembership(agent)
  }

  /**
   * Read the current roster and non-deleted task board through the generated Remote API.
   * @param agent - exact live Team member used as the authority credential.
   * @returns detached current roster and task views.
   */
  @Remote('view')
  remoteView(agent: Agent): TeamView {
    const members = this.listMembers(agent)
    const tasks = this.listTasks(agent)
    const root = this.roster.membership(agent).root
    const state = this.journal.state(root)
    return {
      members,
      tasks,
      interactions: teamInteractions(state, members, tasks),
    }
  }

  /**
   * Create one shared task through the generated Remote API.
   * @param agent - exact live Team member creating the task.
   * @param request - task text, blockers, and advisory write scopes.
   * @returns the revision-one task or a typed Team rejection.
   */
  @Remote('createTask')
  remoteCreateTask(agent: Agent, request: CreateTeamTaskRequest): Promise<TeamTaskMutationResult> {
    return this.taskMutationResult(this.createTask(agent, request))
  }

  /**
   * Apply one task mutation and preserve Team rejections as business results.
   * @param agent - exact live Team member authorizing the mutation.
   * @param request - task identity, expected revision, action, and action fields.
   * @returns the committed task or a typed Team rejection.
   */
  @Remote('updateTask')
  remoteUpdateTask(agent: Agent, request: UpdateTeamTaskRequest): Promise<TeamTaskMutationResult> {
    return this.taskMutationResult(this.updateTask(agent, request))
  }

  /**
   * List the three institution squads and their current Lead bindings.
   * Stale Lead Session ids are dropped from the catalog when persistence no longer has them.
   * @returns detached squad rows in product order.
   */
  @Remote('listInstitutionSquads')
  async remoteListInstitutionSquads(): Promise<InstitutionSquadView[]> {
    return await this.listInstitutionSquads()
  }

  /**
   * Persist one seat's provider/model in the institution catalog.
   * Already-spawned teammates keep the route recorded on their member snapshot.
   * @param request - squad, seat name, and optional route.
   * @returns the refreshed squad list.
   */
  @Remote('updateInstitutionSeat')
  async remoteUpdateInstitutionSeat(request: UpdateInstitutionSeatRequest): Promise<InstitutionSquadView[]> {
    requireInstitutionSeat(requireInstitutionSquad(request.squadId), request.name)
    await this.institutionCatalog.update(file => applySeatUpdate(file, request))
    return await this.listInstitutionSquads()
  }

  /**
   * Bind the caller's Lead Session as the squad Lead and spawn any missing seats.
   * A new topic is a later human prompt on this same Session, not another spawn.
   * @param agent - exact live Lead Agent whose Session becomes the standing Lead.
   * @param request - squad slug and optional seat-route overrides applied before spawn.
   * @returns the bound Session and the current roster.
   */
  @Remote('ensureInstitutionSquad')
  async remoteEnsureInstitutionSquad(
    agent: Agent,
    request: EnsureInstitutionSquadRequest,
  ): Promise<EnsureInstitutionSquadResult> {
    return await this.ensureInstitutionSquad(agent, request)
  }

  /**
   * Read one `.html` / `.htm` file for the Team dock sandboxed preview.
   * Paths resolve against the Lead session cwd when relative; absolute paths
   * must stay under that cwd when the Lead has one.
   * @param agent - exact live Team member used as the authority credential.
   * @param request - path to the HTML file.
   * @returns absolute path and UTF-8 HTML body.
   */
  @Remote('readHtmlPreview')
  async remoteReadHtmlPreview(
    agent: Agent,
    request: ReadHtmlPreviewRequest,
  ): Promise<ReadHtmlPreviewResult> {
    const membership = this.roster.membership(agent)
    const raw = request.path.trim()
    if (raw === '') {
      throw new TeamError('HTML preview path is required', 'TEAM_INVALID_TARGET')
    }
    const cwd = membership.root.session.header.cwd
    const absolute = isAbsolute(raw)
      ? resolvePath(raw)
      : cwd === undefined
        ? (() => {
          throw new TeamError(
            'relative HTML preview paths need a Lead session cwd',
            'TEAM_INVALID_TARGET',
          )
        })()
        : resolvePath(cwd, raw)
    const ext = extname(absolute).toLowerCase()
    if (ext !== '.html' && ext !== '.htm') {
      throw new TeamError('HTML preview path must end in .html or .htm', 'TEAM_INVALID_TARGET')
    }
    if (cwd !== undefined) {
      const rel = relative(cwd, absolute)
      if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
        throw new TeamError('HTML preview path must stay under the Lead session cwd', 'TEAM_INVALID_TARGET')
      }
    }
    let html: string
    try {
      html = await readFile(absolute, 'utf8')
    } catch (error: unknown) {
      throw new TeamError(
        `HTML preview could not be read: ${errorMessage(error)}`,
        'TEAM_INVALID_TARGET',
        { cause: error },
      )
    }
    if (Buffer.byteLength(html, 'utf8') > MAX_HTML_PREVIEW_BYTES) {
      throw new TeamError(
        `HTML preview exceeds ${MAX_HTML_PREVIEW_BYTES} bytes`,
        'TEAM_INVALID_TARGET',
      )
    }
    return { path: absolute, html }
  }

  /** Preserve Team task rejections while allowing unexpected failures to reject the Remote call. */
  private async taskMutationResult(operation: Promise<TeamTaskView>): Promise<TeamTaskMutationResult> {
    try {
      return { ok: true, value: await operation }
    } catch (error) {
      if (!(error instanceof TeamError)) throw error
      return {
        ok: false,
        error: {
          code: error.code === 'TEAM_TASK_STALE_REVISION' ? 'team-task-conflict' : 'team-rejected',
          message: error.message,
        },
      }
    }
  }

  /**
   * List institution squads after dropping Lead bindings whose Sessions are gone.
   * @returns detached squad rows in product order.
   */
  async listInstitutionSquads(): Promise<InstitutionSquadView[]> {
    const file = await this.dropMissingLeads()
    return INSTITUTION_SQUADS.map((squad) => {
      const leadId = file.leads[squad.id]
      const live = leadId === undefined ? undefined : this.ctx.agents.get(SessionId(leadId))
      const liveModels: Record<string, string | undefined> = {}
      if (live !== undefined) {
        for (const member of this.listMembers(live)) {
          if (member.role === 'teammate') liveModels[member.name] = member.model
        }
      }
      return projectInstitutionSquad(squad, file, liveModels)
    })
  }

  /**
   * Bind the caller as the standing Lead and spawn seats that are not yet on the roster.
   * @param caller - exact live Lead Agent.
   * @param request - squad slug and optional seat-route overrides.
   * @returns the bound Session and roster.
   */
  async ensureInstitutionSquad(
    caller: Agent,
    request: EnsureInstitutionSquadRequest,
  ): Promise<EnsureInstitutionSquadResult> {
    const squad = requireInstitutionSquad(request.squadId)
    const membership = this.membership(caller)
    if (membership.role !== 'lead') {
      throw new TeamError('only the Team Lead can provision institution seats', 'TEAM_LEAD_REQUIRED')
    }
    if (request.seats !== undefined) {
      for (const seat of request.seats) {
        requireInstitutionSeat(squad, seat.name)
        await this.institutionCatalog.update(file => applySeatUpdate(file, {
          squadId: squad.id,
          name: seat.name,
          ...seat.provider === undefined ? {} : { provider: seat.provider },
          ...seat.model === undefined ? {} : { model: seat.model },
        }))
      }
    }
    await this.institutionCatalog.update(file => ({
      version: 1,
      leads: { ...file.leads, [squad.id]: caller.session.id },
      seats: { ...file.seats },
    }))
    const catalog = await this.institutionCatalog.read()
    const bindings = catalog.seats[squad.id] ?? {}
    const existing = new Set(
      this.listMembers(caller).filter(member => member.role === 'teammate').map(member => member.name),
    )
    for (const seat of squad.seats) {
      if (existing.has(seat.name)) continue
      const binding = bindings[seat.name]
      const agentOptions = binding === undefined
        ? undefined
        : {
          ...binding.provider === undefined ? {} : { provider: binding.provider },
          ...binding.model === undefined ? {} : { model: binding.model },
        }
      const hasOptions = agentOptions !== undefined
        && (agentOptions.provider !== undefined || agentOptions.model !== undefined)
      await this.spawnTeammate(caller, {
        name: seat.name,
        description: `${seat.title}：${seat.duty}`,
        prompt: [{ type: 'text', text: standingSeatPrompt(squad, seat) }],
        context: 'fresh',
        provider: this.institutionFreshProvider,
        ...hasOptions ? { agentOptions } : {},
        signal: this.lifecycle.signal,
      })
    }
    return {
      sessionId: caller.session.id,
      squadId: squad.id,
      members: this.listMembers(caller),
    }
  }

  /** Drop catalog Lead ids whose persisted Session no longer exists. */
  private async dropMissingLeads(): Promise<Awaited<ReturnType<InstitutionCatalog['read']>>> {
    const file = await this.institutionCatalog.read()
    let nextLeads = { ...file.leads }
    let changed = false
    for (const id of INSTITUTION_SQUADS.map(squad => squad.id)) {
      const leadId = nextLeads[id]
      if (leadId === undefined) continue
      const snapshot = await this.ctx.sessionPersistence.stat(SessionId(leadId))
      if (snapshot === undefined) {
        nextLeads = Object.fromEntries(
          Object.entries(nextLeads).filter(([key]) => key !== id),
        )
        changed = true
      }
    }
    if (!changed) return file
    return await this.institutionCatalog.update(current => ({
      version: 1,
      leads: nextLeads,
      seats: { ...current.seats },
    }))
  }

  /** Queue one contained recovery pass after publication has unwound. */
  private scheduleRecovery(agent: Agent): void {
    queueMicrotask(() => {
      if (this.lifecycle.disposed) return
      void this.recoverFor(agent).catch((error: unknown) => {
        if (this.lifecycle.disposed) return
        this.ctx.logger.warn(`Agent Teams recovery for "${agent.id}" failed: ${errorMessage(error)}`)
      })
    })
  }

  /** Reconcile roster provisioning before retrying that member's pending mailbox. */
  private async recoverFor(agent: Agent): Promise<void> {
    await this.roster.recoverFor(agent, this.lifecycle.signal)
    await this.mailbox.recoverFor(agent, this.lifecycle.signal)
  }

  /** Stop Team-owned live branches and release every waiter before service disposal completes. */
  private async disposeRuntime(): Promise<void> {
    this.lifecycle.close()
    this.activity.close()
    this.attribution.clear()

    const failures: unknown[] = []
    await this.lifecycle.settle(this.roster.pendingCreations(), failures)
    await this.lifecycle.settle(this.mailbox.pendingDispatches(), failures)
    for (const [root, childIds] of this.roster.liveChildrenByRoot()) {
      try {
        await this.roster.stopTeammates(root, childIds)
      } catch (error: unknown) {
        failures.push(error)
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'Agent Teams runtime disposal failed')
  }
}

export default TeamService
