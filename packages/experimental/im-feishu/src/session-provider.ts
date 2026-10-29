/**
 * Tenant-owned agent session provider and durable conversation mapping.
 *
 * Enforces strict fail-closed constraints:
 * 1. Conversation-to-session maps are persisted durably BEFORE publishing an Agent.
 * 2. CWD is canonical, absolute, existing, and owner-private (0700/current UID).
 * 3. Operator identity is validated on every active and restored lookup.
 * 4. Mapping-before-create crashes recover transparently via sessionPersistence.stat.
 * 5. Session log reads check ownership, execute asynchronously, enforce bounded event ceilings,
 *    and ensure read handles are closed in finally.
 *
 * @module @deepseek-ai/dsh-experimental-im-feishu/session-provider
 */

import { randomUUID } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { DomainFacility, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { OperatorId } from './types.ts'
import type { AgentSessionProvider } from './runtime-service.ts'
import type { SessionLogSnapshot } from './storage.ts'

/** Schema version for tenant conversation persistence. */
export const TENANT_CONVERSATION_SCHEMA_VERSION = 1

/** Registered domain name for tenant conversation state. */
export const TENANT_CONVERSATION_DOMAIN_NAME = 'im_tenant_conversations'

/** Default maximum event ceiling for asynchronous reconciliation reads. */
export const DEFAULT_MAX_RECONCILIATION_EVENTS = 1000

/** Zod schema validating a durable conversation-to-session record. */
export const conversationRecordSchema = z.object({
  conversationKey: z.string().min(1),
  sessionId: z.string().min(1),
  operatorId: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict()

/** Durable record mapping one external conversation to an internal SessionId. */
export type ConversationRecord = z.infer<typeof conversationRecordSchema>

/** Domain declaration for tenant conversation mapping. */
export const tenantConversationDomainSpec = defineDomain({
  name: TENANT_CONVERSATION_DOMAIN_NAME,
  version: TENANT_CONVERSATION_SCHEMA_VERSION,
  tables: {
    conversations: domainTable<string, ConversationRecord>(conversationRecordSchema),
  },
})

/** Options for configuring the TenantAgentSessionProvider. */
export interface TenantAgentSessionProviderConfig {
  /** Fixed, canonical, owner-only working directory for agents. */
  readonly cwd: string
  /** Optional model provider configuration. */
  readonly modelSelection?: {
    readonly provider: string
    readonly model: string
  } | undefined
  /** Maximum allowed reconciliation event rows read from storage. */
  readonly maxReconciliationEvents: number
}

/**
 * Validate that cwd is canonical, absolute, existing, and owner-private (mode 0700, current process UID).
 *
 * @param cwd - Raw working directory path.
 * @returns Canonical resolved path.
 */
function validateCwd(cwd: string): string {
  if (!cwd || typeof cwd !== 'string' || cwd.trim() === '') {
    throw new TypeError('Working directory cwd must be a non-empty string')
  }
  if (!isAbsolute(cwd)) {
    throw new TypeError(`Working directory cwd must be absolute; received '${cwd}'`)
  }
  const resolved = resolve(cwd)
  let canonical: string
  try {
    canonical = realpathSync(resolved)
  } catch (err: unknown) {
    throw new Error(`Working directory cwd '${cwd}' does not exist or cannot be resolved: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (canonical !== resolved) {
    throw new Error(`Working directory cwd '${cwd}' must be canonical; resolved to '${canonical}'`)
  }
  const stat = lstatSync(canonical)
  if (!stat.isDirectory()) {
    throw new Error(`Working directory cwd '${canonical}' must be a directory`)
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined
  if (uid !== undefined && stat.uid !== uid) {
    throw new Error(
      `Working directory cwd '${canonical}' owner UID ${stat.uid} does not match current process UID ${uid}`,
    )
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new Error(
      `Working directory cwd '${canonical}' has insecure permissions ${(stat.mode & 0o777).toString(8)}; must be private to owner (0700)`,
    )
  }
  return canonical
}

/**
 * Tenant-owned conversation map and agent lifecycle manager.
 */
export class TenantAgentSessionProvider implements AgentSessionProvider {
  private readonly handles = new Map<string, AgentHandle>()
  private readonly ownedSessions = new Set<string>()
  private readonly cwd: string
  private readonly maxReconciliationEvents: number
  private readonly sessions: Context['sessions']
  private readonly agents: Context['agents']
  private readonly persistence: Context['sessionPersistence']

  /**
   * @param ctx - Cordis context providing `agents`, `sessions`, and `sessionPersistence` services.
   * @param conversationsTable - Durable KV table storing conversation mappings.
   * @param config - Validated working directory, model selection, and reconciliation limits.
   */
  constructor(
    ctx: Context,
    private readonly conversationsTable: KvTable<string, ConversationRecord>,
    private readonly config: TenantAgentSessionProviderConfig,
  ) {
    if (
      !Number.isSafeInteger(config.maxReconciliationEvents) ||
      config.maxReconciliationEvents <= 0
    ) {
      throw new TypeError(
        `maxReconciliationEvents must be a positive integer, received: ${config.maxReconciliationEvents}`,
      )
    }
    this.maxReconciliationEvents = config.maxReconciliationEvents
    this.sessions = ctx.sessions
    this.agents = ctx.agents
    this.persistence = ctx.sessionPersistence
    this.cwd = validateCwd(config.cwd)
  }

  /**
   * Open or resume an Agent for a specific conversation.
   * Durably writes the conversation-to-session mapping BEFORE publishing the Agent.
   * Recovers from crashes between mapping persistence and agent creation using sessionPersistence.stat.
   *
   * @param conversationKey - Canonical conversation identity tuple.
   * @param operatorId - Authorized operator identifier.
   * @param signal - Lifetime signal; aborts before publication if triggered.
   * @returns Owned Agent instance.
   */
  async getOrCreateAgent(
    conversationKey: string,
    operatorId: OperatorId,
    signal: AbortSignal,
  ): Promise<Agent> {
    signal.throwIfAborted()

    const active = this.handles.get(conversationKey)
    if (active) {
      const activeRecord = this.conversationsTable.get(conversationKey)
      if (!activeRecord) {
        throw new Error(`Active conversation '${conversationKey}' has missing durable mapping`)
      }
      if (activeRecord.sessionId !== active.agent.session.id) {
        throw new Error(
          `Active conversation '${conversationKey}' session mismatch: active '${active.agent.session.id}', durable '${activeRecord.sessionId}'`,
        )
      }
      if (activeRecord.operatorId !== operatorId) {
        throw new Error(
          `Conversation operator mismatch: mapped to '${activeRecord.operatorId}', requested by '${operatorId}'`,
        )
      }
      return active.agent
    }

    const record = this.conversationsTable.get(conversationKey)
    if (record && record.operatorId !== operatorId) {
      throw new Error(
        `Conversation operator mismatch: mapped to '${record.operatorId}', requested by '${operatorId}'`,
      )
    }

    let sessionId: SessionId
    if (record) {
      sessionId = SessionId(record.sessionId)
    } else {
      // Fresh conversation: mint SessionId and write to durable storage BEFORE publishing Agent
      sessionId = SessionId(randomUUID())
      const now = new Date().toISOString()
      const newRecord: ConversationRecord = {
        conversationKey,
        sessionId,
        operatorId,
        createdAt: now,
        updatedAt: now,
      }
      await this.conversationsTable.put(conversationKey, newRecord)
    }

    signal.throwIfAborted()

    // Mark as owned by this runtime
    this.ownedSessions.add(sessionId)

    const agentOptions = this.config.modelSelection
      ? {
        provider: this.config.modelSelection.provider,
        model: this.config.modelSelection.model,
      }
      : undefined

    // Check persistence stat to choose resume vs create. Mapping-before-create crashes recover transparently.
    const stat = await this.persistence.stat(sessionId)
    let handle: AgentHandle
    if (stat !== undefined) {
      handle = await this.agents.resume({
        resumeSessionId: sessionId,
        ...(agentOptions ? { agentOptions } : {}),
        signal,
      })
    } else {
      handle = await this.agents.create({
        sessionId,
        meta: { cwd: this.cwd },
        ...(agentOptions ? { agentOptions } : {}),
        signal,
      })
    }

    this.handles.set(conversationKey, handle)
    return handle.agent
  }

  /**
   * Asynchronously read the durable session log snapshot for receipt reconciliation.
   * Requires strict ownership against durable mappings, checks persistence stat,
   * reads up to maxReconciliationEvents + 1, and always closes the handle in finally.
   *
   * @param sessionId - Session identifier.
   * @returns Bounded SessionLogSnapshot, or undefined if not owned or absent in storage.
   */
  async readSessionLog(sessionId: SessionId): Promise<SessionLogSnapshot | undefined> {
    // 1. Ownership check against durable conversation mapping
    let isOwned = this.ownedSessions.has(sessionId)
    if (!isOwned) {
      for (const [, rec] of this.conversationsTable.entries()) {
        if (rec.sessionId === sessionId) {
          isOwned = true
          this.ownedSessions.add(sessionId)
          break
        }
      }
    }
    if (!isOwned) {
      return undefined
    }

    // 2. Missing stat returns undefined
    const stat = await this.persistence.stat(sessionId)
    if (!stat) {
      return undefined
    }

    // 3. Open session log for read
    const handle = await this.persistence.open(sessionId, 'read')
    try {
      const readResult = await handle.read(0, this.maxReconciliationEvents + 1)
      if (readResult.events.length > this.maxReconciliationEvents) {
        throw new Error(
          `Session '${sessionId}' log exceeds maximum reconciliation events limit of ${this.maxReconciliationEvents}`,
        )
      }
      return {
        id: sessionId,
        events: readResult.events,
      }
    } finally {
      await handle.close()
    }
  }

  /**
   * Flush all active sessions to persistent storage.
   * Confirms durability by checking sessions.flush return value.
   */
  async flushSessions(): Promise<void> {
    for (const handle of this.handles.values()) {
      const flushed = await this.sessions.flush(handle.agent.session)
      if (!flushed) {
        throw new Error(`Failed to flush session '${handle.agent.session.id}' to persistent storage`)
      }
    }
  }

  /**
   * Cancel and dispose all active agent handles.
   * Cancels all handles first before awaiting all owned disposals to prevent early false quiescence.
   */
  async dispose(): Promise<void> {
    for (const handle of this.handles.values()) {
      handle.agent.cancel({ kind: 'user' })
    }
    const handles = Array.from(this.handles.values())
    this.handles.clear()
    const settled = await Promise.allSettled(handles.map(h => h.dispose()))
    const failures: unknown[] = []
    for (const result of settled) if (result.status === 'rejected') failures.push(result.reason)
    if (failures.length === 1) {
      throw failures[0]
    }
    if (failures.length > 1) {
      throw new AggregateError(failures, 'Agent handle disposals failed')
    }
  }
}

/**
 * Factory creating a TenantAgentSessionProvider from a DomainFacility and Context.
 *
 * @param ctx - Cordis Context.
 * @param facility - DomainFacility for opening the tenant conversation domain.
 * @param config - Working directory, model selection, and reconciliation configuration.
 * @returns Initialized TenantAgentSessionProvider.
 */
export async function createTenantAgentSessionProvider(
  ctx: Context,
  facility: DomainFacility,
  config: TenantAgentSessionProviderConfig,
): Promise<TenantAgentSessionProvider> {
  const domain = await facility.open(tenantConversationDomainSpec)
  return new TenantAgentSessionProvider(ctx, domain.table('conversations'), config)
}
