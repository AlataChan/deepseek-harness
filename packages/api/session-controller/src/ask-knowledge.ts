/**
 * Session remotes for the ask-knowledge seam. Consumer of `ctx.askKnowledge` only.
 * @module @deepseek-ai/dsh-api-session-controller/ask-knowledge
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import { AskKnowledgeError } from '@deepseek-ai/dsh-host-ask-knowledge'
import type { AskKnowledge, AskKnowledgeLibraryId } from '@deepseek-ai/dsh-host-ask-knowledge'
import { AskKnowledgeIngestHandle } from '@deepseek-ai/dsh-host-ask-knowledge'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import type { ApiSessionAgentController } from './agent.ts'
import { SessionCallGate } from './session-gate.ts'
import {
  ASK_KNOWLEDGE_MAX_CHUNK_BYTES,
  type SessionAppendAskKnowledgeIngestChunkRequest,
  type SessionAskKnowledgeBinding,
  type SessionAskKnowledgeBundle,
  type SessionAskKnowledgeExtractResult,
  type SessionAskKnowledgeIngestResult,
  type SessionAskKnowledgeLibrary,
  type SessionAskKnowledgeLookup,
  type SessionAttachAskKnowledgeRequest,
  type SessionAttachAskKnowledgeValue,
  type SessionAppendAskKnowledgeExtractChunkRequest,
  type SessionBeginAskKnowledgeExtractRequest,
  type SessionBeginAskKnowledgeIngestRequest,
  type SessionCreateAskKnowledgeLibraryRequest,
  type SessionDetachAskKnowledgeRequest,
  type SessionFinishAskKnowledgeExtractRequest,
  type SessionFinishAskKnowledgeIngestRequest,
  type SessionAskKnowledgeLookupRequest,
  type SessionAskKnowledgeRetrieveRequest,
  type SessionRemoveAskKnowledgeLibraryRequest,
  type SessionRenameAskKnowledgeLibraryRequest,
} from './types.ts'

/** Overlay session lock used so remove waits for an in-flight prompt. */
interface AskKnowledgeSessionLock {
  withSessionLock<T>(sessionId: SessionId, fn: () => Promise<T>): Promise<T>
}

/**
 * Ask-knowledge Remote helpers owned by Session Controller.
 */
export class SessionAskKnowledgeController {
  /**
   * @param ctx - Host context.
   * @param agents - Session agent activation.
   * @param gate - shared per-session Remote gate (the ask-data gate).
   * @param defaultCwd - cwd used when attach creates a Session without a workspace.
   */
  constructor(
    private readonly ctx: Context,
    private readonly agents: ApiSessionAgentController,
    private readonly gate: SessionCallGate,
    private readonly defaultCwd: string,
  ) {}

  /**
   * Require `ctx.askKnowledge` or fail `session/ask-knowledge-unavailable`.
   * @returns the seam.
   */
  requireAskKnowledge(): AskKnowledge {
    const capability = this.ctx.get('askKnowledge')
    if (capability === undefined) {
      throw new RemoteError(
        'session/ask-knowledge-unavailable',
        'session ask-knowledge remotes need the ask-knowledge capability',
        {},
      )
    }
    return capability
  }

  /**
   * List catalog rows.
   * @param signal - caller lifetime.
   * @returns listed libraries.
   */
  async listLibraries(signal: AbortSignal): Promise<readonly SessionAskKnowledgeLibrary[]> {
    signal.throwIfAborted()
    try {
      return await this.requireAskKnowledge().listLibraries(signal)
    } catch (error: unknown) {
      throw mapAskKnowledgeError(error, signal)
    }
  }

  /**
   * Create an empty library.
   * @param request - display name and optional workspace shortcut.
   * @param signal - caller lifetime.
   * @returns the new row.
   */
  async createLibrary(
    request: SessionCreateAskKnowledgeLibraryRequest,
    signal: AbortSignal,
  ): Promise<SessionAskKnowledgeLibrary> {
    signal.throwIfAborted()
    try {
      return await this.requireAskKnowledge().createLibrary(request, signal)
    } catch (error: unknown) {
      throw mapAskKnowledgeError(error, signal)
    }
  }

  /**
   * Rename a catalog row.
   * @param request - library id and new name.
   * @param signal - caller lifetime.
   * @returns the updated row.
   */
  async renameLibrary(
    request: SessionRenameAskKnowledgeLibraryRequest,
    signal: AbortSignal,
  ): Promise<SessionAskKnowledgeLibrary> {
    signal.throwIfAborted()
    try {
      return await this.requireAskKnowledge().renameLibrary({
        libraryId: brandString<AskKnowledgeLibraryId>(request.libraryId),
        displayName: request.displayName,
      }, signal)
    } catch (error: unknown) {
      throw mapAskKnowledgeError(error, signal)
    }
  }

  /**
   * Remove a library. Overlay holds catalog → session mutexes → library.
   * @param request - library id.
   * @param signal - caller lifetime.
   */
  async removeLibrary(
    request: SessionRemoveAskKnowledgeLibraryRequest,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted()
    try {
      await this.requireAskKnowledge().removeLibrary({
        libraryId: brandString<AskKnowledgeLibraryId>(request.libraryId),
      }, signal)
    } catch (error: unknown) {
      throw mapAskKnowledgeError(error, signal)
    }
  }

  /**
   * Bind a library to a Session, creating a standard Session when omitted.
   * A named data-agent Session that already has an ask-data bind gets a new
   * standard Session in the same workspace; data-agent denies retrieve tools.
   * @param request - library and optional session / workspace.
   * @param signal - caller lifetime.
   * @returns the Session that now carries the bind.
   */
  attach(
    request: SessionAttachAskKnowledgeRequest,
    signal: AbortSignal,
  ): Promise<SessionAttachAskKnowledgeValue> {
    signal.throwIfAborted()
    const capability = this.requireAskKnowledge()
    const sessionId = request.sessionId
    if (sessionId !== undefined) {
      return this.gate.run(sessionId, 'wait', () =>
        this.attachExisting(capability, request.libraryId, sessionId, signal))
    }
    return this.attachCreate(capability, request.libraryId, request.workspaceId, signal)
  }

  /**
   * Clear the bind on a live Session.
   * @param request - session identity.
   * @param signal - caller lifetime.
   */
  detach(request: SessionDetachAskKnowledgeRequest, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    return this.gate.run(request.sessionId, 'wait', async () => {
      try {
        await this.requireAskKnowledge().detach({ sessionId: request.sessionId }, signal)
      } catch (error: unknown) {
        throw mapAskKnowledgeError(error, signal)
      }
    })
  }

  /**
   * Open an ingest upload.
   * @param request - library and filename.
   * @param signal - caller lifetime.
   * @returns the ingest handle.
   */
  async beginIngest(
    request: SessionBeginAskKnowledgeIngestRequest,
    signal: AbortSignal,
  ): Promise<string> {
    signal.throwIfAborted()
    try {
      return await this.requireAskKnowledge().beginIngest({
        libraryId: brandString<AskKnowledgeLibraryId>(request.libraryId),
        filename: request.filename,
      }, signal)
    } catch (error: unknown) {
      throw mapAskKnowledgeError(error, signal)
    }
  }

  /**
   * Append one base64 chunk. Decoded size must be ≤ 160KiB.
   * @param request - handle and bytes.
   * @param signal - caller lifetime.
   */
  async appendIngestChunk(
    request: SessionAppendAskKnowledgeIngestChunkRequest,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted()
    decodeAskKnowledgeChunk(request.bytes)
    try {
      await this.requireAskKnowledge().appendIngestChunk({
        handle: AskKnowledgeIngestHandle(request.handle),
        bytes: request.bytes,
      }, signal)
    } catch (error: unknown) {
      throw mapAskKnowledgeError(error, signal)
    }
  }

  /**
   * Finish one ingest upload.
   * @param request - handle and optional raw reuse.
   * @param signal - caller lifetime.
   * @returns ingest status.
   */
  async finishIngest(
    request: SessionFinishAskKnowledgeIngestRequest,
    signal: AbortSignal,
  ): Promise<SessionAskKnowledgeIngestResult> {
    signal.throwIfAborted()
    try {
      return await this.requireAskKnowledge().finishIngest({
        handle: AskKnowledgeIngestHandle(request.handle),
        ...request.reuseRawPath === undefined ? {} : { reuseRawPath: request.reuseRawPath },
      }, signal)
    } catch (error: unknown) {
      throw mapAskKnowledgeError(error, signal)
    }
  }

  /**
   * Open a session-only extract upload.
   * @param request - original filename.
   * @param signal - caller lifetime.
   * @returns the extract handle.
   */
  async beginExtract(
    request: SessionBeginAskKnowledgeExtractRequest,
    signal: AbortSignal,
  ): Promise<string> {
    signal.throwIfAborted()
    try {
      return await this.requireAskKnowledge().beginExtract({ filename: request.filename }, signal)
    } catch (error: unknown) {
      throw mapAskKnowledgeError(error, signal)
    }
  }

  /**
   * Append one base64 chunk to a session-only extract upload.
   * @param request - handle and bytes.
   * @param signal - caller lifetime.
   */
  async appendExtractChunk(
    request: SessionAppendAskKnowledgeExtractChunkRequest,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted()
    decodeAskKnowledgeChunk(request.bytes)
    try {
      await this.requireAskKnowledge().appendExtractChunk({
        handle: AskKnowledgeIngestHandle(request.handle),
        bytes: request.bytes,
      }, signal)
    } catch (error: unknown) {
      throw mapAskKnowledgeError(error, signal)
    }
  }

  /**
   * Finish one session-only extract upload.
   * @param request - handle.
   * @param signal - caller lifetime.
   * @returns extracted text.
   */
  async finishExtract(
    request: SessionFinishAskKnowledgeExtractRequest,
    signal: AbortSignal,
  ): Promise<SessionAskKnowledgeExtractResult> {
    signal.throwIfAborted()
    try {
      return await this.requireAskKnowledge().finishExtract({
        handle: AskKnowledgeIngestHandle(request.handle),
      }, signal)
    } catch (error: unknown) {
      throw mapAskKnowledgeError(error, signal)
    }
  }

  /**
   * Retrieve on the Session's hung library.
   * @param request - session and terms.
   * @param signal - caller lifetime.
   * @returns a bounded bundle.
   */
  retrieve(
    request: SessionAskKnowledgeRetrieveRequest,
    signal: AbortSignal,
  ): Promise<SessionAskKnowledgeBundle> {
    signal.throwIfAborted()
    return this.gate.run(request.sessionId, 'wait', () =>
      this.withOverlaySession(request.sessionId, async () => {
        const found = await this.agents.resolveAgent(request.sessionId)
        if ('error' in found) throw found.error
        const binding = this.ctx.sessionProjections.stateOf(found.agent.session, 'askKnowledgeBinding')
        if (binding == null) {
          throw new RemoteError(
            'session/ask-knowledge-unbound',
            `session "${request.sessionId}" has no hung knowledge library`,
            { sessionId: request.sessionId },
          )
        }
        try {
          return await this.requireAskKnowledge().retrieveBundle({
            libraryId: brandString<AskKnowledgeLibraryId>(binding.libraryId),
            terms: request.terms,
          }, signal)
        } catch (error: unknown) {
          throw mapAskKnowledgeError(error, signal)
        }
      }))
  }

  /**
   * Look up one term on the Session's hung library.
   * @param request - session and term.
   * @param signal - caller lifetime.
   * @returns lookup fields.
   */
  lookup(
    request: SessionAskKnowledgeLookupRequest,
    signal: AbortSignal,
  ): Promise<SessionAskKnowledgeLookup> {
    signal.throwIfAborted()
    return this.gate.run(request.sessionId, 'wait', () =>
      this.withOverlaySession(request.sessionId, async () => {
        const found = await this.agents.resolveAgent(request.sessionId)
        if ('error' in found) throw found.error
        const binding = this.ctx.sessionProjections.stateOf(found.agent.session, 'askKnowledgeBinding')
        if (binding == null) {
          throw new RemoteError(
            'session/ask-knowledge-unbound',
            `session "${request.sessionId}" has no hung knowledge library`,
            { sessionId: request.sessionId },
          )
        }
        try {
          return await this.requireAskKnowledge().lookup({
            libraryId: brandString<AskKnowledgeLibraryId>(binding.libraryId),
            term: request.term,
          }, signal)
        } catch (error: unknown) {
          throw mapAskKnowledgeError(error, signal)
        }
      }))
  }

  /**
   * Current bind projection of one live Session.
   * @param sessionId - Session identity.
   * @returns the bind, or null before one.
   */
  askKnowledgeBinding(sessionId: SessionId): SessionAskKnowledgeBinding | null {
    const session = this.ctx.sessions.get(sessionId)
    if (session === undefined) {
      throw new RemoteError('session/not-found', `session "${sessionId}" not found`, { sessionId })
    }
    return this.ctx.sessionProjections.stateOf(session, 'askKnowledgeBinding') ?? null
  }

  /**
   * Run work under the overlay session lock when the Provider exposes it.
   * @param sessionId - Session identity.
   * @param fn - exclusive work.
   * @returns the work result.
   */
  withOverlaySession<T>(sessionId: SessionId, fn: () => Promise<T>): Promise<T> {
    const capability = this.ctx.get('askKnowledge') as AskKnowledgeSessionLock | undefined
    if (capability !== undefined && typeof capability.withSessionLock === 'function') {
      return capability.withSessionLock(sessionId, fn)
    }
    return fn()
  }

  private async attachExisting(
    capability: AskKnowledge,
    libraryId: string,
    sessionId: SessionId,
    signal: AbortSignal,
  ): Promise<SessionAttachAskKnowledgeValue> {
    const found = await this.agents.resolveAgent(sessionId)
    if ('error' in found) throw found.error
    if (this.hasAskDataBind(found.agent.session)) {
      return this.attachCreate(
        capability,
        libraryId,
        this.workspaceIdOf(sessionId),
        signal,
        found.agent.session.header.cwd,
      )
    }
    await this.ensureStandardPreset(found.agent)
    try {
      await capability.attach({
        libraryId: brandString<AskKnowledgeLibraryId>(libraryId),
        sessionId,
      }, signal)
      return { sessionId }
    } catch (error: unknown) {
      throw mapAskKnowledgeError(error, signal)
    }
  }

  /**
   * Whether this Session already has an ask-data bind and must stay data-agent.
   * @param session - live Session.
   * @returns true when `askDataBinding` is a bound row.
   */
  private hasAskDataBind(session: Session): boolean {
    return this.ctx.sessionProjections.stateOf(session, 'askDataBinding') != null
  }

  /**
   * Switch an unbound data-agent Session back to standard before hanging.
   * @param agent - live agent of the named Session.
   */
  private async ensureStandardPreset(agent: Agent): Promise<void> {
    if (this.agents.presetForSession(agent.session) !== 'data-agent') return
    await this.ctx.get('agentPresets')?.select(agent, 'standard')
  }

  /**
   * Workspace that already lists this Session, if the registry is loaded.
   * @param sessionId - Session identity.
   * @returns the workspace id, or undefined when none lists it.
   */
  private workspaceIdOf(sessionId: SessionId): WorkspaceId | undefined {
    const listed = this.ctx.get('workspaceRegistry')?.list?.()
    if (!Array.isArray(listed)) return undefined
    return listed.find(workspace => workspace.sessionIds.includes(sessionId))?.id
  }

  /**
   * Create a standard Session, optionally in a workspace, then hang the library.
   * @param capability - ask-knowledge seam.
   * @param libraryId - catalog id.
   * @param workspaceId - workspace that should list the new Session.
   * @param signal - caller lifetime.
   * @param cwdOverride - cwd copied from the data-agent Session when no workspace path exists.
   * @returns the new Session identity.
   */
  private async attachCreate(
    capability: AskKnowledge,
    libraryId: string,
    workspaceId: SessionAttachAskKnowledgeRequest['workspaceId'],
    signal: AbortSignal,
    cwdOverride?: string,
  ): Promise<SessionAttachAskKnowledgeValue> {
    let workspace: Workspace | undefined
    if (workspaceId !== undefined) {
      workspace = this.ctx.workspaceRegistry.get(workspaceId)
      if (workspace === undefined) {
        throw new RemoteError('workspace/not-found', `workspace "${workspaceId}" not found`, {
          workspaceId,
        })
      }
    }
    const cwd = workspace?.path ?? cwdOverride ?? this.defaultCwd
    const sessionId = brandString<SessionId>(`session-${randomUUID()}`)
    const created = await this.agents.createOwnedSession(sessionId, cwd, 'standard')
    let attached = false
    return this.gate.run(sessionId, 'reject', async () => {
      try {
        if (workspace !== undefined) {
          await workspace.attachSession(sessionId)
          attached = true
        }
        await capability.attach({
          libraryId: brandString<AskKnowledgeLibraryId>(libraryId),
          sessionId,
        }, signal)
        return { sessionId }
      } catch (error: unknown) {
        await compensateAttach({
          handle: created.handle,
          workspace: attached ? workspace : undefined,
          sessionId,
        })
        throw mapAskKnowledgeError(error, signal)
      }
    })
  }
}

async function compensateAttach(input: {
  handle: AgentHandle
  workspace: { detachSession(sessionId: SessionId): Promise<void> } | undefined
  sessionId: SessionId
}): Promise<void> {
  if (input.workspace !== undefined) {
    try {
      await input.workspace.detachSession(input.sessionId)
    } catch {
      // keep the original business error
    }
  }
  try {
    await input.handle.dispose()
  } catch {
    // keep the original business error; handle.dispose is best-effort
  }
}

/**
 * Decode one ingest chunk and enforce the 160KiB decoded cap.
 * @param bytes - wire field.
 */
export function decodeAskKnowledgeChunk(bytes: unknown): void {
  if (typeof bytes !== 'string') {
    throw new RemoteError('gateway/bad-request', 'bytes must be a canonical base64 string', {})
  }
  if (bytes.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(bytes)) {
    throw new RemoteError('gateway/bad-request', 'bytes must be canonical base64', {})
  }
  const buf = Buffer.from(bytes, 'base64')
  if (buf.toString('base64') !== bytes) {
    throw new RemoteError('gateway/bad-request', 'bytes must be canonical base64', {})
  }
  if (buf.byteLength > ASK_KNOWLEDGE_MAX_CHUNK_BYTES) {
    throw new RemoteError(
      'session/ask-knowledge-failed',
      `chunk exceeds ${ASK_KNOWLEDGE_MAX_CHUNK_BYTES} bytes`,
      { code: 'chunk-too-large', limit: ASK_KNOWLEDGE_MAX_CHUNK_BYTES },
    )
  }
}

/**
 * Map an ask-knowledge failure onto a RemoteError.
 * @param error - thrown value.
 * @param signal - caller lifetime.
 * @returns never; always throws.
 */
export function mapAskKnowledgeError(error: unknown, signal: AbortSignal): never {
  if (signal.aborted) throw new RemoteError('gateway/cancelled', 'ask-knowledge request was aborted', {})
  if (error instanceof RemoteError) throw error
  if (error instanceof AskKnowledgeError) {
    if (error.code === 'ask-knowledge-unavailable') {
      throw new RemoteError('session/ask-knowledge-unavailable', error.message, {})
    }
    throw new RemoteError('session/ask-knowledge-failed', error.message, {
      code: error.code,
      ...error.details.ruleId === undefined ? {} : { ruleId: error.details.ruleId },
      ...error.details.limit === undefined ? {} : { limit: error.details.limit },
    })
  }
  throw new RemoteError(
    'gateway/internal',
    error instanceof Error ? error.message : String(error),
    {},
  )
}
