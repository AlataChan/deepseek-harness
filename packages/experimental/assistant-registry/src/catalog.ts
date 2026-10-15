/**
 * Persistent catalog and provisioning ledger for assistants, teams, and conversation bindings.
 * @module @deepseek-ai/dsh-experimental-assistant-registry/catalog
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import {
  AssistantProfileId,
  type AssistantProfile,
  type CreateAssistantProfileOptions,
  type UpdateAssistantProfileOptions,
  type AssistantConversation,
  type AssistantConversationId,
  type ProvisioningOperation,
  type ProvisioningOperationId,
  type ExecuteProvisioningOptions,
  type ProvisioningContext,
  type ProvisioningResult,
  TeamDefinitionId,
  TeamSeatId,
  type TeamDefinition,
  type TeamSeat,
  type CreateTeamDefinitionOptions,
  type UpdateTeamDefinitionOptions,
  type CreateTeamSeatOptions,
  type UpdateTeamSeatOptions,
  type TeamTemplateOrigin,
  type TeamCapacityAccounting,
  type InstitutionAdoptionRecord,
  MemoryEntryId,
  type MemoryEntry,
  type MemoryScope,
  type SaveMemoryOptions,
  type ListMemoryOptions,
  MEMORY_TEXT_MAX_LENGTH,
} from './types.ts'
import { assistantsDomainSpec } from './schema.ts'
import { CatalogWriteLease } from './lease.ts'
import { computeInputFingerprint } from './fingerprint.ts'
import { getTeamTemplate } from './templates.ts'
import {
  RevisionConflictError,
  ProvisioningConflictError,
  AmbiguousAllocationError,
} from './errors.ts'

/** Configuration options for opening the assistant catalog. */
export interface AssistantCatalogOptions {
  /** Optional custom lock file path. Defaults to ~/.dsh/storages/assistants.lock */
  readonly lockPath?: string | undefined
}

/**
 * Authoritative assistant catalog and provisioning ledger.
 * Backed by storage-domain with POSIX kernel-flock lease protection.
 */
export class AssistantCatalog {
  private readonly profilesTable: KvTable<AssistantProfileId, AssistantProfile>
  private readonly operationsTable: KvTable<ProvisioningOperationId, ProvisioningOperation>
  private readonly conversationsTable: KvTable<AssistantConversationId, AssistantConversation>
  private readonly teamsTable: KvTable<TeamDefinitionId, TeamDefinition>
  private readonly seatsTable: KvTable<TeamSeatId, TeamSeat>
  private readonly adoptionsTable: KvTable<string, InstitutionAdoptionRecord>
  private readonly memoryTable: KvTable<MemoryEntryId, MemoryEntry>

  private writeLock: Promise<void> = Promise.resolve()
  private readonly inflightOperations = new Map<
    string,
    { readonly fingerprint: string; readonly result: Promise<ProvisioningResult<never>> }
  >()

  private async serializeWrite<T>(op: () => Promise<T>): Promise<T> {
    const prev = this.writeLock
    let resolveNext!: () => void
    this.writeLock = new Promise<void>((resolve) => { resolveNext = resolve })
    await prev
    try {
      return await op()
    } finally {
      resolveNext()
    }
  }

  private constructor(
    private readonly lease: CatalogWriteLease,
    private readonly domain: Domain<typeof assistantsDomainSpec>,
    public readonly lockPath: string,
  ) {
    this.profilesTable = domain.table('profiles')
    this.operationsTable = domain.table('operations')
    this.conversationsTable = domain.table('conversations')
    this.teamsTable = domain.table('teams')
    this.seatsTable = domain.table('seats')
    this.adoptionsTable = domain.table('adoptions')
    this.memoryTable = domain.table('memory')
  }

  /**
   * Opens the assistant catalog, acquiring the exclusive kernel write lease and opening the domain.
   * @param ctx - Cordis context with mounted storageDomain.
   * @param options - optional catalog options.
   * @returns opened AssistantCatalog instance.
   */
  static async open(ctx: Context, options: AssistantCatalogOptions = {}): Promise<AssistantCatalog> {
    const lockPath = options.lockPath ?? dshHomePath('storages', 'assistants.lock')
    const lease = await CatalogWriteLease.acquire(lockPath)
    try {
      const domain = await ctx.storageDomain.open(assistantsDomainSpec)
      return new AssistantCatalog(lease, domain, lockPath)
    } catch (err) {
      await lease.release()
      throw err
    }
  }

  /**
   * Closes the catalog domain and releases the exclusive write lease.
   * @returns promise resolving when resources are closed.
   */
  async close(): Promise<void> {
    try {
      await this.domain.close()
    } finally {
      await this.lease.release()
    }
  }

  /**
   * Whether the exclusive write lease is actively held.
   * @returns true if the write lease is currently held.
   */
  get isHeld(): boolean {
    return this.lease.isHeld
  }

  // --- AssistantProfile CRUD ---

  /**
   * Synchronously look up an assistant profile by identifier.
   * @param id - profile identifier.
   * @returns assistant profile if present.
   */
  getProfile(id: AssistantProfileId): AssistantProfile | undefined {
    return this.profilesTable.get(id)
  }

  /**
   * Look up an assistant profile by identifier, throwing if not found.
   * @param id - profile identifier.
   * @returns assistant profile.
   * @throws {Error} if profile is not found.
   */
  requireProfile(id: AssistantProfileId): AssistantProfile {
    const profile = this.profilesTable.get(id)
    if (!profile) {
      throw new Error(`Assistant profile '${id}' not found`)
    }
    return profile
  }

  /**
   * List assistant profiles in the catalog.
   * @param includeArchived - whether to include archived profiles.
   * @returns list of profiles.
   */
  listProfiles(includeArchived: boolean = false): readonly AssistantProfile[] {
    const all = [...this.profilesTable.entries()].map(([, profile]) => profile)
    return includeArchived ? all : all.filter(p => p.archivedAt === undefined)
  }

  /**
   * Create a new assistant profile with revision 1.
   * @param options - creation options.
   * @returns newly created profile.
   */
  async createProfile(options: CreateAssistantProfileOptions): Promise<AssistantProfile> {
    const name = options.name.trim()
    const responsibility = options.responsibility.trim()
    if (!name) {
      throw new Error('Assistant profile name cannot be empty')
    }
    if (!responsibility) {
      throw new Error('Assistant profile responsibility cannot be empty')
    }

    const id = AssistantProfileId(options.id ?? `asst-${randomUUID()}`)
    if (this.profilesTable.get(id)) {
      throw new Error(`Assistant profile '${id}' already exists`)
    }

    const now = Date.now()
    const profile: AssistantProfile = {
      id,
      name,
      ...options.avatar !== undefined ? { avatar: options.avatar } : {},
      responsibility,
      ...options.instructions !== undefined ? { instructions: options.instructions } : {},
      ...options.capabilities !== undefined ? { capabilities: options.capabilities } : {},
      revision: 1,
      ...options.defaultModel !== undefined ? { defaultModel: options.defaultModel } : {},
      createdAt: now,
      updatedAt: now,
    }

    await this.profilesTable.put(id, profile)
    return profile
  }

  /**
   * Update an existing assistant profile, incrementing revision and verifying expected revision.
   * @param id - profile identifier.
   * @param options - update options.
   * @param expectedRevision - optional expected revision guard.
   * @returns updated profile.
   * @throws {RevisionConflictError} if expected revision does not match stored revision.
   */
  async updateProfile(
    id: AssistantProfileId,
    options: UpdateAssistantProfileOptions,
    expectedRevision?: number  ,
  ): Promise<AssistantProfile> {
    return this.serializeWrite(async () => {
      const existing = this.requireProfile(id)
      if (expectedRevision !== undefined && existing.revision !== expectedRevision) {
        throw new RevisionConflictError('profile', id, expectedRevision, existing.revision)
      }

      const now = Date.now()
      const updated: AssistantProfile = {
        ...existing,
        ...options.name !== undefined ? { name: options.name.trim() } : {},
        ...options.avatar !== undefined ? { avatar: options.avatar } : {},
        ...options.responsibility !== undefined ? { responsibility: options.responsibility.trim() } : {},
        ...options.instructions !== undefined ? { instructions: options.instructions } : {},
        ...options.capabilities !== undefined ? { capabilities: options.capabilities } : {},
        ...options.defaultModel !== undefined ? { defaultModel: options.defaultModel } : {},
        revision: existing.revision + 1,
        updatedAt: now,
      }

      await this.profilesTable.put(id, updated)
      return updated
    })
  }

  /**
   * Soft-archive an assistant profile with revision guard.
   * @param id - profile identifier.
   * @param expectedRevision - optional expected revision guard.
   * @returns archived profile.
   * @throws {RevisionConflictError} if expected revision does not match stored revision.
   */
  async archiveProfile(
    id: AssistantProfileId,
    expectedRevision?: number  ,
  ): Promise<AssistantProfile> {
    return this.serializeWrite(async () => {
      const existing = this.requireProfile(id)
      if (existing.archivedAt !== undefined) {
        return existing
      }
      if (expectedRevision !== undefined && existing.revision !== expectedRevision) {
        throw new RevisionConflictError('profile', id, expectedRevision, existing.revision)
      }

      const now = Date.now()
      const updated: AssistantProfile = {
        ...existing,
        archivedAt: now,
        revision: existing.revision + 1,
        updatedAt: now,
      }

      await this.profilesTable.put(id, updated)
      return updated
    })
  }

  /**
   * Unarchive an assistant profile with revision guard.
   * @param id - profile identifier.
   * @param expectedRevision - optional expected revision guard.
   * @returns unarchived profile.
   * @throws {RevisionConflictError} if expected revision does not match stored revision.
   */
  async unarchiveProfile(
    id: AssistantProfileId,
    expectedRevision?: number  ,
  ): Promise<AssistantProfile> {
    const existing = this.requireProfile(id)
    if (existing.archivedAt === undefined) {
      return existing
    }
    if (expectedRevision !== undefined && existing.revision !== expectedRevision) {
      throw new RevisionConflictError('profile', id, expectedRevision, existing.revision)
    }

    const now = Date.now()
    const { archivedAt: _archivedAt, ...rest } = existing
    const updated: AssistantProfile = {
      ...rest,
      revision: existing.revision + 1,
      updatedAt: now,
    }

    await this.profilesTable.put(id, updated)
    return updated
  }

  // --- Provisioning Ledger ---

  /**
   * Look up a provisioning operation by identifier.
   * @param id - provisioning operation identifier.
   * @returns operation record if found.
   */
  getOperation(id: ProvisioningOperationId): ProvisioningOperation | undefined {
    return this.operationsTable.get(id)
  }

  /**
   * List every recorded provisioning operation.
   * @returns list of provisioning operations.
   */
  listOperations(): readonly ProvisioningOperation[] {
    return [...this.operationsTable.entries()].map(([, operation]) => operation)
  }

  /**
   * List all operations currently halted in an ambiguous allocation state.
   * @returns list of ambiguous operations.
   */
  listAmbiguousOperations(): readonly ProvisioningOperation[] {
    return [...this.operationsTable.entries()]
      .map(([, op]) => op)
      .filter(op => op.status === 'ambiguous')
  }

  /**
   * Manually repair an ambiguous operation by retrying, aborting, or completing it.
   * @param id - operation identifier.
   * @param resolution - repair decision.
   * @param allocationsPatch - optional allocations to apply.
   * @returns updated operation.
   */
  async repairAmbiguousOperation(
    id: ProvisioningOperationId,
    resolution: 'retry' | 'abort' | 'completed',
    allocationsPatch?: Record<string, string>  ,
  ): Promise<ProvisioningOperation> {
    const existing = this.operationsTable.get(id)
    if (!existing) {
      throw new Error(`Provisioning operation '${id}' not found`)
    }

    const now = Date.now()
    let updated: ProvisioningOperation
    if (resolution === 'retry') {
      updated = {
        ...existing,
        status: 'checkpointed',
        allocations: { ...existing.allocations, ...(allocationsPatch ?? {}) },
        error: undefined,
        updatedAt: now,
      }
    } else if (resolution === 'abort') {
      updated = {
        ...existing,
        status: 'failed',
        error: 'Manually aborted during repair',
        updatedAt: now,
      }
    } else {
      updated = {
        ...existing,
        status: 'completed',
        allocations: { ...existing.allocations, ...(allocationsPatch ?? {}) },
        error: undefined,
        updatedAt: now,
      }
    }

    await this.operationsTable.put(id, updated)
    return updated
  }

  /**
   * Executes or resumes a provisioning operation with committed-before-allocation ordering.
   * @param options - provisioning execution options.
   * @returns completed provisioning result.
   */
  async executeProvisioning<P = unknown, R extends Record<string, string> = Record<string, string>>(
    options: ExecuteProvisioningOptions<P, R>,
  ): Promise<ProvisioningResult<R>> {
    const opKey = String(options.id)
    const attemptedFingerprint = computeInputFingerprint(options.payload)
    const inflight = this.inflightOperations.get(opKey)
    if (inflight) {
      // A concurrent request with the same id must carry the same payload; a divergent payload is a
      // conflict, never a silent coalesce onto the running allocation.
      if (inflight.fingerprint !== attemptedFingerprint) {
        throw new ProvisioningConflictError(options.id, inflight.fingerprint, attemptedFingerprint)
      }
      return (await inflight.result)
    }
    // Reject a divergent payload before any allocation starts.
    const existing = this.operationsTable.get(options.id)
    if (existing !== undefined && existing.fingerprint !== attemptedFingerprint) {
      throw new ProvisioningConflictError(options.id, existing.fingerprint, attemptedFingerprint)
    }
    const result = this.doExecuteProvisioning(options)
    this.inflightOperations.set(opKey, { fingerprint: attemptedFingerprint, result: result as Promise<ProvisioningResult<never>> })
    try {
      return await result
    } finally {
      this.inflightOperations.delete(opKey)
    }
  }

  private async doExecuteProvisioning<P = unknown, R extends Record<string, string> = Record<string, string>>(
    options: ExecuteProvisioningOptions<P, R>,
  ): Promise<ProvisioningResult<R>> {
    const attemptedFingerprint = computeInputFingerprint(options.payload)
    const existing = this.operationsTable.get(options.id)

    if (existing !== undefined) {
      if (existing.fingerprint !== attemptedFingerprint) {
        throw new ProvisioningConflictError(options.id, existing.fingerprint, attemptedFingerprint)
      }
      if (existing.status === 'completed') {
        return {
          status: 'completed',
          allocations: existing.allocations as R,
          resumed: true,
        }
      }
      if (existing.status === 'ambiguous') {
        throw new AmbiguousAllocationError(options.id, existing.checkpoint, existing.error)
      }
    }

    const resumed = existing !== undefined

    // Committed-before-allocation ordering: persist operation before executing steps
    if (existing === undefined) {
      await options.crashHook?.('before-initial-commit')
      const initialOp: ProvisioningOperation = {
        id: options.id,
        fingerprint: attemptedFingerprint,
        status: 'pending',
        checkpoint: 'committed',
        allocations: {},
        payload: options.payload,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      await this.operationsTable.put(options.id, initialOp)
      await options.crashHook?.('after-initial-commit')
    }

    let currentCheckpoint = existing ? existing.checkpoint : 'committed'
    const currentAllocations: Record<string, string> = { ...(existing?.allocations ?? {}) }

    const context: ProvisioningContext<R> = {
      operationId: options.id,
      checkpoint: currentCheckpoint,
      allocations: currentAllocations as Readonly<R>,
      resumed,
      setCheckpoint: async (name: string, patch?: Partial<R>  ): Promise<void> => {
        await options.crashHook?.(`before-checkpoint:${name}`)
        if (patch) {
          Object.assign(currentAllocations, patch)
        }
        currentCheckpoint = name
        const latestOp = this.operationsTable.get(options.id)
        const updatedOp: ProvisioningOperation = {
          ...latestOp ?? {
            id: options.id,
            fingerprint: attemptedFingerprint,
            payload: options.payload,
            createdAt: Date.now(),
          },
          checkpoint: name,
          allocations: { ...currentAllocations },
          status: 'checkpointed',
          updatedAt: Date.now(),
        }
        await this.operationsTable.put(options.id, updatedOp)
        await options.crashHook?.(`after-checkpoint:${name}`)
      },
      markAmbiguous: async (reason: string): Promise<void> => {
        await options.crashHook?.('before-ambiguous-commit')
        const latestOp = this.operationsTable.get(options.id)
        const ambiguousOp: ProvisioningOperation = {
          ...latestOp ?? {
            id: options.id,
            fingerprint: attemptedFingerprint,
            payload: options.payload,
            createdAt: Date.now(),
            allocations: currentAllocations,
          },
          checkpoint: currentCheckpoint,
          status: 'ambiguous',
          error: reason,
          updatedAt: Date.now(),
        }
        await this.operationsTable.put(options.id, ambiguousOp)
        await options.crashHook?.('after-ambiguous-commit')
        throw new AmbiguousAllocationError(options.id, currentCheckpoint, reason)
      },
    }

    const finalAllocations = await options.run(context)
    Object.assign(currentAllocations, finalAllocations)

    await options.crashHook?.('before-completion-commit')
    const latestOp = this.operationsTable.get(options.id)
    const completedOp: ProvisioningOperation = {
      ...latestOp ?? {
        id: options.id,
        fingerprint: attemptedFingerprint,
        payload: options.payload,
        createdAt: Date.now(),
      },
      status: 'completed',
      checkpoint: 'completed',
      allocations: { ...currentAllocations },
      error: undefined,
      updatedAt: Date.now(),
    }
    await this.operationsTable.put(options.id, completedOp)
    await options.crashHook?.('after-completion-commit')

    return {
      status: 'completed',
      allocations: currentAllocations as R,
      resumed,
    }
  }

  // --- AssistantConversation CRUD ---

  /**
   * Look up an assistant conversation binding by identifier.
   * @param id - conversation binding identifier.
   * @returns conversation binding if present.
   */
  getConversation(id: AssistantConversationId): AssistantConversation | undefined {
    return this.conversationsTable.get(id)
  }

  /**
   * List assistant conversation bindings.
   * @param profileId - optional profile filter.
   * @param includeArchived - whether to include archived conversations.
   * @returns list of matching conversation bindings.
   */
  listConversations(
    profileId?: AssistantProfileId  ,
    includeArchived: boolean = false,
  ): readonly AssistantConversation[] {
    let all = [...this.conversationsTable.entries()].map(([, conv]) => conv)
    if (profileId !== undefined) {
      all = all.filter(c => c.profileId === profileId)
    }
    return includeArchived ? all : all.filter(c => c.archivedAt === undefined)
  }

  /**
   * Create an assistant conversation binding record.
   * @param conversation - conversation binding to persist.
   * @returns persisted conversation binding.
   */
  async createConversation(conversation: AssistantConversation): Promise<AssistantConversation> {
    if (this.conversationsTable.get(conversation.id)) {
      throw new Error(`Assistant conversation '${conversation.id}' already exists`)
    }
    await this.conversationsTable.put(conversation.id, conversation)
    return conversation
  }

  /**
   * Update an existing assistant conversation binding record.
   * @param id - conversation identifier.
   * @param patch - partial fields to update.
   * @returns updated conversation binding.
   */
  async updateConversation(
    id: AssistantConversationId,
    patch: Partial<AssistantConversation>,
  ): Promise<AssistantConversation> {
    const existing = this.conversationsTable.get(id)
    if (!existing) {
      throw new Error(`Assistant conversation '${id}' not found`)
    }
    const updated: AssistantConversation = {
      ...existing,
      ...patch,
      updatedAt: Date.now(),
    }
    await this.conversationsTable.put(id, updated)
    return updated
  }

  /**
   * Soft-archive an assistant conversation binding record.
   * @param id - conversation identifier.
   * @returns archived conversation binding.
   */
  async archiveConversation(id: AssistantConversationId): Promise<AssistantConversation> {
    const existing = this.conversationsTable.get(id)
    if (!existing) {
      throw new Error(`Assistant conversation '${id}' not found`)
    }
    if (existing.archivedAt !== undefined) {
      return existing
    }
    const updated: AssistantConversation = {
      ...existing,
      archivedAt: Date.now(),
      updatedAt: Date.now(),
    }
    await this.conversationsTable.put(id, updated)
    return updated
  }

  // --- TeamDefinition CRUD ---

  /**
   * Look up a team definition by identifier.
   * @param id - team definition identifier.
   * @returns team definition if present.
   */
  getTeam(id: TeamDefinitionId): TeamDefinition | undefined {
    return this.teamsTable.get(id)
  }

  /**
   * List team definitions with optional archived filter.
   * @param filter - optional filter.
   * @returns list of team definitions.
   */
  listTeams(filter?: { includeArchived?: boolean }): readonly TeamDefinition[] {
    const all = [...this.teamsTable.entries()].map(([, team]) => team)
    if (filter?.includeArchived) return all
    return all.filter(t => t.archivedAt === undefined)
  }

  /**
   * Create a new team definition record.
   * @param options - creation parameters.
   * @returns created team definition.
   */
  async createTeam(options: CreateTeamDefinitionOptions): Promise<TeamDefinition> {
    return this.serializeWrite(async () => {
      const id = options.id !== undefined ? TeamDefinitionId(options.id) : TeamDefinitionId(randomUUID())
      if (this.teamsTable.get(id)) {
        throw new Error(`Team definition '${id}' already exists`)
      }
      const coordinator = this.profilesTable.get(options.coordinatorProfileId)
      if (!coordinator) {
        throw new Error(`Coordinator profile '${options.coordinatorProfileId}' not found`)
      }
      const now = Date.now()
      const team: TeamDefinition = {
        id,
        name: options.name,
        ...options.avatar !== undefined ? { avatar: options.avatar } : {},
        ...options.description !== undefined ? { description: options.description } : {},
        coordinatorProfileId: options.coordinatorProfileId,
        ...options.leadSessionId !== undefined ? { leadSessionId: options.leadSessionId } : {},
        ...options.sharedWorkspaceId !== undefined ? { sharedWorkspaceId: options.sharedWorkspaceId } : {},
        ...options.templateOrigin !== undefined ? { templateOrigin: options.templateOrigin } : {},
        seatIds: [],
        ...options.capabilities !== undefined ? { capabilities: options.capabilities } : {},
        revision: 1,
        createdAt: now,
        updatedAt: now,
      }
      await this.teamsTable.put(id, team)
      return team
    })
  }

  /**
   * Update an existing team definition record with CAS revision check.
   * @param id - team definition identifier.
   * @param expectedRevision - expected revision for CAS update.
   * @param options - fields to update.
   * @returns updated team definition.
   */
  async updateTeam(
    id: TeamDefinitionId,
    expectedRevision: number,
    options: UpdateTeamDefinitionOptions,
  ): Promise<TeamDefinition> {
    return this.serializeWrite(async () => {
      const existing = this.teamsTable.get(id)
      if (!existing) {
        throw new Error(`Team definition '${id}' not found`)
      }
      if (existing.archivedAt !== undefined) {
        throw new Error(`Cannot update archived team definition '${id}'`)
      }
      if (existing.revision !== expectedRevision) {
        throw new RevisionConflictError('team', id, expectedRevision, existing.revision)
      }
      if (options.coordinatorProfileId !== undefined && options.coordinatorProfileId !== existing.coordinatorProfileId
        && (existing.leadSessionId !== undefined || this.listSeats(id).some(seat => seat.role === 'coordinator'))) {
        throw new Error('Cannot change coordinator profile after the team roster is initialized')
      }
      if (options.coordinatorProfileId !== undefined) {
        const coordinator = this.profilesTable.get(options.coordinatorProfileId)
        if (!coordinator) {
          throw new Error(`Coordinator profile '${options.coordinatorProfileId}' not found`)
        }
      }
      const updated: TeamDefinition = {
        ...existing,
        ...options.name !== undefined ? { name: options.name } : {},
        ...options.avatar !== undefined ? { avatar: options.avatar } : {},
        ...options.description !== undefined ? { description: options.description } : {},
        ...options.coordinatorProfileId !== undefined ? { coordinatorProfileId: options.coordinatorProfileId } : {},
        ...options.leadSessionId !== undefined ? { leadSessionId: options.leadSessionId } : {},
        ...options.sharedWorkspaceId !== undefined ? { sharedWorkspaceId: options.sharedWorkspaceId } : {},
        ...options.capabilities !== undefined ? { capabilities: options.capabilities } : {},
        ...options.seatIds !== undefined ? { seatIds: options.seatIds } : {},
        revision: existing.revision + 1,
        updatedAt: Date.now(),
      }
      await this.teamsTable.put(id, updated)
      return updated
    })
  }

  /**
   * Soft-archive a team definition record.
   * @param id - team definition identifier.
   * @returns archived team definition.
   */
  async archiveTeam(id: TeamDefinitionId): Promise<TeamDefinition> {
    return this.serializeWrite(async () => {
      const existing = this.teamsTable.get(id)
      if (!existing) {
        throw new Error(`Team definition '${id}' not found`)
      }
      if (existing.archivedAt !== undefined) {
        return existing
      }
      const updated: TeamDefinition = {
        ...existing,
        archivedAt: Date.now(),
        updatedAt: Date.now(),
      }
      await this.teamsTable.put(id, updated)
      return updated
    })
  }

  // --- TeamSeat CRUD ---

  /**
   * Look up a team seat by identifier.
   * @param id - team seat identifier.
   * @returns team seat if present.
   */
  getSeat(id: TeamSeatId): TeamSeat | undefined {
    return this.seatsTable.get(id)
  }

  /**
   * List all team seats across all teams.
   * @returns list of all seats.
   */
  listAllSeats(): readonly TeamSeat[] {
    return [...this.seatsTable.entries()].map(([, s]) => s)
  }

  /**
   * List seats for a given team.
   * @param teamId - team definition identifier.
   * @returns list of seats.
   */
  listSeats(teamId: TeamDefinitionId): readonly TeamSeat[] {
    return [...this.seatsTable.entries()].map(([, s]) => s).filter(s => s.teamId === teamId)
  }

  /**
   * Create a new team seat record.
   * @param options - creation parameters.
   * @returns created team seat.
   */
  async createSeat(options: CreateTeamSeatOptions): Promise<TeamSeat> {
    return this.serializeWrite(async () => {
      const id = options.id !== undefined ? TeamSeatId(options.id) : TeamSeatId(randomUUID())
      if (this.seatsTable.get(id)) {
        throw new Error(`Team seat '${id}' already exists`)
      }
      const team = this.teamsTable.get(options.teamId)
      if (!team) {
        throw new Error(`Team definition '${options.teamId}' not found`)
      }
      const existingSeats = this.listSeats(options.teamId)
      const reservedNames = new Set<string>()
      for (const s of existingSeats) {
        reservedNames.add(s.name)
        for (const inst of s.runtimeInstances) {
          reservedNames.add(inst)
        }
        for (const runtimeName of s.runtimeNames ?? []) {
          reservedNames.add(runtimeName)
        }
      }
      if (reservedNames.has(options.name)) {
        throw new Error(`Teammate name '${options.name}' is permanently reserved in team '${options.teamId}'`)
      }
      const profile = this.profilesTable.get(options.profileId)
      if (!profile) {
        throw new Error(`Assistant profile '${options.profileId}' not found`)
      }
      const now = Date.now()
      const seat: TeamSeat = {
        id,
        teamId: options.teamId,
        profileId: options.profileId,
        role: options.role,
        name: options.name,
        duty: options.duty,
        ...options.title !== undefined ? { title: options.title } : {},
        ...options.modelOverride !== undefined ? { modelOverride: options.modelOverride } : {},
        ...options.capabilities !== undefined ? { capabilities: options.capabilities } : {},
        runtimeInstances: [],
        runtimeNames: [],
        createdAt: now,
        updatedAt: now,
      }
      await this.seatsTable.put(id, seat)

      // Add seat to team's seatIds if not already present
      if (!team.seatIds.includes(id)) {
        const updatedTeam: TeamDefinition = {
          ...team,
          seatIds: [...team.seatIds, id],
          revision: team.revision + 1,
          updatedAt: now,
        }
        await this.teamsTable.put(team.id, updatedTeam)
      }

      return seat
    })
  }

  /**
   * Update an existing team seat record.
   * @param id - team seat identifier.
   * @param options - fields to update.
   * @returns updated team seat.
   */
  async updateSeat(id: TeamSeatId, options: UpdateTeamSeatOptions): Promise<TeamSeat> {
    return this.serializeWrite(async () => {
      const existing = this.seatsTable.get(id)
      if (!existing) {
        throw new Error(`Team seat '${id}' not found`)
      }
      if (existing.retiredAt !== undefined) {
        throw new Error(`Cannot update retired team seat '${id}'`)
      }
      const instances = options.appendInstanceId !== undefined
        ? [...existing.runtimeInstances, options.appendInstanceId]
        : existing.runtimeInstances
      const runtimeNames = options.appendRuntimeName !== undefined
        ? [...existing.runtimeNames ?? [], options.appendRuntimeName]
        : existing.runtimeNames

      const updated: TeamSeat = {
        ...existing,
        ...options.name !== undefined ? { name: options.name } : {},
        ...options.duty !== undefined ? { duty: options.duty } : {},
        ...options.title !== undefined ? { title: options.title } : {},
        ...'modelOverride' in options ? { modelOverride: options.modelOverride } : {},
        ...options.capabilities !== undefined ? { capabilities: options.capabilities } : {},
        ...options.activeInstanceId !== undefined ? { activeInstanceId: options.activeInstanceId } : {},
        ...options.retiredAt !== undefined ? { retiredAt: options.retiredAt } : {},
        runtimeInstances: instances,
        ...runtimeNames !== undefined ? { runtimeNames } : {},
        updatedAt: Date.now(),
      }
      await this.seatsTable.put(id, updated)
      return updated
    })
  }

  /**
   * Retire a team seat. Retired seats reject subsequent routing and free capacity while preserving history.
   * @param id - team seat identifier.
   * @returns retired team seat.
   */
  async retireSeat(id: TeamSeatId): Promise<TeamSeat> {
    return this.serializeWrite(async () => {
      const existing = this.seatsTable.get(id)
      if (!existing) {
        throw new Error(`Team seat '${id}' not found`)
      }
      if (existing.retiredAt !== undefined) {
        return existing
      }
      const updated: TeamSeat = {
        ...existing,
        activeInstanceId: undefined,
        retiredAt: Date.now(),
        updatedAt: Date.now(),
      }
      await this.seatsTable.put(id, updated)
      return updated
    })
  }

  /**
   * Permanently reserve one runtime instance name on a seat before any spawn is attempted.
   * The reservation survives a failed spawn, so a failed instance name is never reused.
   * @param seatId - target seat identifier.
   * @param runtimeName - candidate runtime instance name.
   * @returns updated team seat carrying the reservation.
   */
  async reserveSeatRuntimeName(seatId: TeamSeatId, runtimeName: string): Promise<TeamSeat> {
    return this.serializeWrite(async () => {
      const existing = this.seatsTable.get(seatId)
      if (!existing) {
        throw new Error(`Team seat '${seatId}' not found`)
      }
      if (existing.retiredAt !== undefined) {
        throw new Error(`Cannot replace instance on retired team seat '${seatId}'`)
      }
      if (this.reservedNamesInTeam(existing.teamId).has(runtimeName)) {
        throw new Error(`Instance name '${runtimeName}' is permanently reserved in team '${existing.teamId}'`)
      }
      const updated: TeamSeat = {
        ...existing,
        runtimeNames: [...existing.runtimeNames ?? [], runtimeName],
        updatedAt: Date.now(),
      }
      await this.seatsTable.put(seatId, updated)
      return updated
    })
  }

  /**
   * Record a successfully allocated runtime instance on a seat, preserving earlier instances.
   * @param seatId - target seat identifier.
   * @param newInstanceId - runtime session admitted for the seat.
   * @returns updated team seat.
   */
  async replaceSeatInstance(seatId: TeamSeatId, newInstanceId: SessionId | string): Promise<TeamSeat> {
    return this.serializeWrite(async () => {
      const existing = this.seatsTable.get(seatId)
      if (!existing) {
        throw new Error(`Team seat '${seatId}' not found`)
      }
      if (existing.retiredAt !== undefined) {
        throw new Error(`Cannot replace instance on retired team seat '${seatId}'`)
      }
      const newSessionId = SessionId(String(newInstanceId))
      const updatedInstances: readonly SessionId[] = existing.runtimeInstances.includes(newSessionId)
        ? existing.runtimeInstances
        : [...existing.runtimeInstances, newSessionId]
      const updated: TeamSeat = {
        ...existing,
        activeInstanceId: newSessionId,
        runtimeInstances: updatedInstances,
        updatedAt: Date.now(),
      }
      await this.seatsTable.put(seatId, updated)
      return updated
    })
  }

  /**
   * Collect every permanently reserved name in one team: seat names, runtime instance names, and instance ids.
   * @param teamId - team definition identifier.
   * @returns reserved name set.
   */
  private reservedNamesInTeam(teamId: TeamDefinitionId): Set<string> {
    const reserved = new Set<string>()
    for (const seat of this.listSeats(teamId)) {
      reserved.add(seat.name)
      for (const instance of seat.runtimeInstances) reserved.add(String(instance))
      for (const runtimeName of seat.runtimeNames ?? []) reserved.add(runtimeName)
    }
    return reserved
  }

  /**
   * Retrieve capacity accounting for a team, separating live occupancy from history.
   * @param teamId - team definition identifier.
   * @param maxCapacity - optional team capacity ceiling (defaults to 10).
   * @returns capacity accounting metrics.
   */
  getCapacityAccounting(teamId: TeamDefinitionId, maxCapacity: number = 10): TeamCapacityAccounting {
    const team = this.teamsTable.get(teamId)
    if (!team) {
      throw new Error(`Team definition '${teamId}' not found`)
    }
    const seats = this.listSeats(teamId)
    // Capacity counts live instances: a seat occupies a slot while it holds an active instance or has
    // never been provisioned yet. Failed and retired instances are history.
    const liveSeats = seats.filter(s => s.retiredAt === undefined
      && (s.activeInstanceId !== undefined || s.runtimeInstances.length === 0))
    const retiredSeats = seats.filter(s => s.retiredAt !== undefined)
    return {
      teamId,
      maxCapacity,
      liveCount: liveSeats.length,
      retiredCount: retiredSeats.length,
      totalHistoricalSeats: seats.length,
      availableSlots: Math.max(0, maxCapacity - liveSeats.length),
    }
  }

  /**
   * Instantiate an editable team definition from a standing template.
   * @param templateId - template origin identifier.
   * @param options - coordinator profile and overrides.
   * @returns created team definition and its initialized seat records.
   */
  async createTeamFromTemplate(
    templateId: TeamTemplateOrigin,
    options: {
      readonly coordinatorProfileId: AssistantProfileId
      readonly name?: string | undefined
      readonly avatar?: string | undefined
      readonly description?: string | undefined
      readonly sharedWorkspaceId?: string | undefined
    },
  ): Promise<{ team: TeamDefinition; seats: readonly TeamSeat[] }> {
    const template = getTeamTemplate(templateId)
    if (!template) {
      throw new Error(`Unknown team template '${templateId}'`)
    }
    const coordinatorProfile = this.profilesTable.get(options.coordinatorProfileId)
    if (!coordinatorProfile) {
      throw new Error(`Coordinator profile '${options.coordinatorProfileId}' not found`)
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

    // 2. Create teammate seats from template
    for (const seatTpl of template.seats) {
      let profile = [...this.profilesTable.entries()].map(([, p]) => p).find(p => p.name === seatTpl.title && p.archivedAt === undefined)
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

    const reloadedTeam = this.getTeam(team.id)
    if (reloadedTeam === undefined) {
      throw new Error(`Team definition '${team.id}' disappeared while creating it from a template`)
    }
    return { team: reloadedTeam, seats: createdSeats }
  }

  // --- Institution Adoption CRUD ---

  /**
   * Look up an institution squad adoption record by squad identifier.
   * @param squadId - squad identifier ('document' | 'case' | 'comms').
   * @returns adoption record if present.
   */
  getAdoption(squadId: string): InstitutionAdoptionRecord | undefined {
    return this.adoptionsTable.get(squadId)
  }

  /**
   * Look up an institution squad adoption record by lead session identifier.
   * @param leadSessionId - lead session identifier.
   * @returns adoption record if present.
   */
  getAdoptionByLeadSession(leadSessionId: SessionId): InstitutionAdoptionRecord | undefined {
    return [...this.adoptionsTable.entries()]
      .map(([, a]) => a)
      .find(a => a.leadSessionId === leadSessionId)
  }

  /**
   * List all institution adoption records.
   * @returns list of adoption records.
   */
  listAdoptions(): readonly InstitutionAdoptionRecord[] {
    return [...this.adoptionsTable.entries()].map(([, a]) => a)
  }

  /**
   * Commit a new institution adoption record.
   * @param record - adoption record to commit.
   * @returns committed adoption record.
   */
  async commitAdoption(record: InstitutionAdoptionRecord): Promise<InstitutionAdoptionRecord> {
    return this.serializeWrite(async () => {
      const existing = this.adoptionsTable.get(record.squadId)
      if (existing && existing.status === 'active') {
        throw new Error(`Institution squad '${record.squadId}' is already adopted`)
      }
      await this.adoptionsTable.put(record.squadId, record)
      return record
    })
  }

  /**
   * Update an existing institution adoption record with CAS revision check.
   * @param squadId - squad identifier.
   * @param expectedRevision - expected revision for CAS update.
   * @param patch - fields to update.
   * @returns updated adoption record.
   */
  async updateAdoption(
    squadId: string,
    expectedRevision: number,
    patch: Partial<InstitutionAdoptionRecord>,
  ): Promise<InstitutionAdoptionRecord> {
    return this.serializeWrite(async () => {
      const existing = this.adoptionsTable.get(squadId)
      if (!existing) {
        throw new Error(`Institution adoption record '${squadId}' not found`)
      }
      if (existing.revision !== expectedRevision) {
        throw new RevisionConflictError('adoption', squadId, expectedRevision, existing.revision)
      }
      const updated: InstitutionAdoptionRecord = {
        ...existing,
        ...patch,
        revision: existing.revision + 1,
        updatedAt: Date.now(),
      }
      await this.adoptionsTable.put(squadId, updated)
      return updated
    })
  }

  // --- Scoped Memory CRUD ---

  /**
   * Save a new persistent memory entry for a given scope.
   * @param scope - profile or team scope.
   * @param text - memory content text.
   * @param options - optional source session and author options.
   * @returns durably stored memory entry.
   */
  async saveMemory(
    scope: MemoryScope,
    text: string,
    options: SaveMemoryOptions = {},
  ): Promise<MemoryEntry> {
    return this.serializeWrite(async () => {
      if (text.length > MEMORY_TEXT_MAX_LENGTH) {
        throw new Error(`Memory text exceeds maximum length of ${MEMORY_TEXT_MAX_LENGTH} characters`)
      }
      const id = MemoryEntryId(randomUUID())
      const now = Date.now()
      const entry: MemoryEntry = {
        id,
        scope,
        text: text.trim(),
        ...options.sourceSessionId !== undefined ? { sourceSessionId: options.sourceSessionId } : {},
        ...options.sourceEventSeq !== undefined ? { sourceEventSeq: options.sourceEventSeq } : {},
        ...options.author !== undefined ? { author: options.author } : {},
        ...options.grants !== undefined ? { grants: options.grants } : {},
        createdAt: now,
        updatedAt: now,
        revision: 1,
      }
      await this.memoryTable.put(id, entry)
      return entry
    })
  }

  /**
   * Update an existing memory entry's text with CAS revision check.
   * @param id - memory entry identifier.
   * @param expectedRevision - expected revision for CAS.
   * @param text - updated memory content text.
   * @returns updated memory entry.
   */
  async updateMemory(
    id: MemoryEntryId,
    expectedRevision: number,
    text: string,
  ): Promise<MemoryEntry> {
    return this.serializeWrite(async () => {
      if (text.length > MEMORY_TEXT_MAX_LENGTH) {
        throw new Error(`Memory text exceeds maximum length of ${MEMORY_TEXT_MAX_LENGTH} characters`)
      }
      const existing = this.memoryTable.get(id)
      if (!existing) {
        throw new Error(`Memory entry '${id}' not found`)
      }
      if (existing.revision !== expectedRevision) {
        throw new RevisionConflictError('memory', id, expectedRevision, existing.revision)
      }
      const updated: MemoryEntry = {
        ...existing,
        text: text.trim(),
        revision: existing.revision + 1,
        updatedAt: Date.now(),
      }
      await this.memoryTable.put(id, updated)
      return updated
    })
  }

  /**
   * Mark a memory entry as removed (tombstone) with optional CAS revision check.
   * @param id - memory entry identifier.
   * @param expectedRevision - optional expected revision.
   * @returns removed memory entry.
   */
  async removeMemory(
    id: MemoryEntryId,
    expectedRevision?: number,
  ): Promise<MemoryEntry> {
    return this.serializeWrite(async () => {
      const existing = this.memoryTable.get(id)
      if (!existing) {
        throw new Error(`Memory entry '${id}' not found`)
      }
      if (expectedRevision !== undefined && existing.revision !== expectedRevision) {
        throw new RevisionConflictError('memory', id, expectedRevision, existing.revision)
      }
      if (existing.removedAt !== undefined) {
        return existing
      }
      const updated: MemoryEntry = {
        ...existing,
        removedAt: Date.now(),
        revision: existing.revision + 1,
        updatedAt: Date.now(),
      }
      await this.memoryTable.put(id, updated)
      return updated
    })
  }

  /**
   * Archive a memory entry with optional CAS revision check.
   * @param id - memory entry identifier.
   * @param expectedRevision - optional expected revision.
   * @returns archived memory entry.
   */
  async archiveMemory(
    id: MemoryEntryId,
    expectedRevision?: number,
  ): Promise<MemoryEntry> {
    return this.serializeWrite(async () => {
      const existing = this.memoryTable.get(id)
      if (!existing) {
        throw new Error(`Memory entry '${id}' not found`)
      }
      if (expectedRevision !== undefined && existing.revision !== expectedRevision) {
        throw new RevisionConflictError('memory', id, expectedRevision, existing.revision)
      }
      if (existing.archivedAt !== undefined) {
        return existing
      }
      const updated: MemoryEntry = {
        ...existing,
        archivedAt: Date.now(),
        revision: existing.revision + 1,
        updatedAt: Date.now(),
      }
      await this.memoryTable.put(id, updated)
      return updated
    })
  }

  /**
   * Unarchive a memory entry with optional CAS revision check.
   * @param id - memory entry identifier.
   * @param expectedRevision - optional expected revision.
   * @returns unarchived memory entry.
   */
  async unarchiveMemory(
    id: MemoryEntryId,
    expectedRevision?: number,
  ): Promise<MemoryEntry> {
    return this.serializeWrite(async () => {
      const existing = this.memoryTable.get(id)
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
      const updated: MemoryEntry = {
        ...rest,
        revision: existing.revision + 1,
        updatedAt: Date.now(),
      }
      await this.memoryTable.put(id, updated)
      return updated
    })
  }

  /**
   * Grant access to a profile-scoped memory entry to a specific team.
   * @param id - memory entry identifier.
   * @param teamId - recipient team identifier.
   * @param expectedRevision - optional expected revision.
   * @returns updated memory entry.
   */
  async grantMemory(
    id: MemoryEntryId,
    teamId: TeamDefinitionId,
    expectedRevision?: number,
  ): Promise<MemoryEntry> {
    return this.serializeWrite(async () => {
      const existing = this.memoryTable.get(id)
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
      const updated: MemoryEntry = {
        ...existing,
        grants: [...currentGrants, teamId],
        revision: existing.revision + 1,
        updatedAt: Date.now(),
      }
      await this.memoryTable.put(id, updated)
      return updated
    })
  }

  /**
   * Revoke a team grant from a profile-scoped memory entry.
   * @param id - memory entry identifier.
   * @param teamId - team identifier to revoke.
   * @param expectedRevision - optional expected revision.
   * @returns updated memory entry.
   */
  async revokeMemoryGrant(
    id: MemoryEntryId,
    teamId: TeamDefinitionId,
    expectedRevision?: number,
  ): Promise<MemoryEntry> {
    return this.serializeWrite(async () => {
      const existing = this.memoryTable.get(id)
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
      const updated: MemoryEntry = {
        ...existing,
        ...updatedGrants.length > 0 ? { grants: updatedGrants } : { grants: undefined },
        revision: existing.revision + 1,
        updatedAt: Date.now(),
      }
      await this.memoryTable.put(id, updated)
      return updated
    })
  }

  /**
   * Get a memory entry by identifier.
   * @param id - memory entry identifier.
   * @returns memory entry or undefined if not found.
   */
  getMemory(id: MemoryEntryId): MemoryEntry | undefined {
    return this.memoryTable.get(id)
  }

  /**
   * List all memory entries in the catalog (including removed).
   * @returns readonly array of all memory entries.
   */
  listAllMemories(): readonly MemoryEntry[] {
    return [...this.memoryTable.entries()].map(([, e]) => e)
  }

  /**
   * List memory entries matching a target scope.
   * @param scope - profile or team scope.
   * @param options - filter options.
   * @returns filtered array of memory entries.
   */
  listMemory(
    scope: MemoryScope,
    options: ListMemoryOptions = {},
  ): readonly MemoryEntry[] {
    const all = [...this.memoryTable.entries()].map(([, e]) => e).filter((e) => {
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
   * List profile memories granted to a specific team.
   * @param teamId - target team definition.
   * @param profileId - optional profile identifier filter.
   * @returns readonly array of granted profile memories.
   */
  listGrantedProfileMemories(
    teamId: TeamDefinitionId,
    profileId?: AssistantProfileId,
  ): readonly MemoryEntry[] {
    return [...this.memoryTable.entries()].map(([, e]) => e).filter((e) => {
      if (e.scope.kind !== 'profile') return false
      if (profileId !== undefined && e.scope.profileId !== profileId) return false
      if (e.removedAt !== undefined || e.archivedAt !== undefined) return false
      return e.grants !== undefined && e.grants.includes(teamId)
    })
  }

  /**
   * Recall active memory entries matching a query.
   * @param scope - profile or team scope.
   * @param query - optional search string.
   * @returns matching active memory entries.
   */
  recallMemory(
    scope: MemoryScope,
    query?: string,
  ): readonly MemoryEntry[] {
    const active = this.listMemory(scope, { includeRemoved: false })
    if (!query || query.trim().length === 0) {
      return active
    }
    const q = query.trim().toLowerCase()
    return active.filter(e => e.text.toLowerCase().includes(q))
  }
}
