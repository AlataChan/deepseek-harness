/**
 * Session remotes for the ask-data seam. Consumer of `ctx.askData` only.
 * @module @deepseek-ai/dsh-api-session-controller/ask-data
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import { AskDataError } from '@deepseek-ai/dsh-host-ask-data'
import type { AskData, AskDataBindLease, AskDataSourceId } from '@deepseek-ai/dsh-host-ask-data'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { ApiSessionAgentController } from './agent.ts'
import { CommitFifo, SessionCallGate } from './session-gate.ts'
import { compensateSessionCommit, isBlankSession, resolveCommitTarget } from './session-commit.ts'
import { decodeBase64Payload } from './wire-bytes.ts'
import { mapSeamFailure, type SeamFailureCodes } from './seam-error.ts'
import {
  ASK_DATA_MAX_DECODED_BYTES,
  type SessionAskDataBinding,
  type SessionAskDataImportPreview,
  type SessionAskDataSource,
  type SessionCommitAskDataRequest,
  type SessionCommitAskDataValue,
  type SessionImportAskDataSpreadsheetRequest,
} from './types.ts'

/**
 * Ask-data Remote helpers owned by Session Controller.
 */
export class SessionAskDataController {
  readonly gate = new SessionCallGate()
  private readonly fifo = new CommitFifo()

  /**
   * @param ctx - Host context.
   * @param agents - Session agent activation.
   * @param defaultCwd - cwd used when commit creates a Session without a workspace.
   */
  constructor(
    private readonly ctx: Context,
    private readonly agents: ApiSessionAgentController,
    private readonly defaultCwd: string,
  ) {}

  /**
   * Require `ctx.askData` or fail `session/ask-data-unavailable`.
   * @returns the seam.
   */
  requireAskData(): AskData {
    const capability = this.ctx.get('askData')
    if (capability === undefined) {
      throw new RemoteError(
        'session/ask-data-unavailable',
        'session ask-data remotes need the ask-data capability',
        {},
      )
    }
    return capability
  }

  /**
   * List overlay and unmatched saved sources.
   * @param signal - caller lifetime.
   * @returns listed rows.
   */
  async listSources(signal: AbortSignal): Promise<readonly SessionAskDataSource[]> {
    signal.throwIfAborted()
    try {
      return await this.requireAskData().listSources(signal)
    } catch (error: unknown) {
      throw mapAskDataError(error, signal)
    }
  }

  /**
   * Import one spreadsheet. `bytes` is canonical base64.
   * @param request - filename and encoded bytes.
   * @param signal - caller lifetime.
   * @returns preview from the written sqlite.
   */
  async importSpreadsheet(
    request: SessionImportAskDataSpreadsheetRequest,
    signal: AbortSignal,
  ): Promise<SessionAskDataImportPreview> {
    signal.throwIfAborted()
    const bytes = decodeCanonicalBase64(request.bytes)
    try {
      return await this.requireAskData().importSpreadsheet({
        filename: request.filename,
        bytes,
        ...request.replaceSourceId === undefined
          ? {}
          : { replaceSourceId: brandString<AskDataSourceId>(request.replaceSourceId) },
      }, signal)
    } catch (error: unknown) {
      throw mapAskDataError(error, signal)
    }
  }

  /**
   * Copy the packaged sample. Does not need host sqlite3.
   * @param signal - caller lifetime.
   * @returns preview from the copied sqlite.
   */
  async importSample(signal: AbortSignal): Promise<SessionAskDataImportPreview> {
    signal.throwIfAborted()
    try {
      return await this.requireAskData().importSample(signal)
    } catch (error: unknown) {
      throw mapAskDataError(error, signal)
    }
  }

  /**
   * Current bind projection of one live Session.
   * @param sessionId - Session identity.
   * @returns the bind, or null before one.
   */
  askDataBinding(sessionId: SessionId): SessionAskDataBinding | null {
    const session = this.ctx.sessions.get(sessionId)
    if (session === undefined) {
      throw new RemoteError('session/not-found', `session "${sessionId}" not found`, { sessionId })
    }
    return this.ctx.sessionProjections.stateOf(session, 'askDataBinding') ?? null
  }

  /**
   * Refuse prompt on an unbound data-agent Session.
   * @param sessionId - Session identity.
   * @param agent - live agent.
   */
  assertPromptAllowed(sessionId: SessionId, agent: Agent): void {
    const preset = this.agents.presetForSession(agent.session)
    const binding = this.ctx.sessionProjections.stateOf(agent.session, 'askDataBinding')
    if (preset === 'data-agent' && (binding === undefined || binding === null)) {
      throw new RemoteError(
        'session/ask-data-unbound',
        `session "${sessionId}" is data-agent without an ask-data bind`,
        { sessionId },
      )
    }
  }

  /**
   * Refuse leaving data-agent after a bind, and reject external select while busy.
   * @param agent - live agent.
   * @param nextPreset - requested preset.
   */
  assertSelectAllowed(agent: Agent, nextPreset: string): void {
    const sessionId = agent.id
    if (this.gate.isExternallyHeld(sessionId)) {
      throw new RemoteError('session/busy', `session "${sessionId}" is busy`, { sessionId })
    }
    const binding = this.ctx.sessionProjections.stateOf(agent.session, 'askDataBinding')
    if (binding != null && nextPreset !== 'data-agent') {
      throw new RemoteError(
        'session/ask-data-bound',
        `session "${sessionId}" is bound to a data source and must stay data-agent`,
        { sessionId },
      )
    }
  }

  /**
   * Bind a source to a Session, creating one when `sessionId` is omitted.
   * @param request - source and optional session / workspace.
   * @param signal - caller lifetime.
   * @returns the Session that now carries the bind.
   */
  commit(
    request: SessionCommitAskDataRequest,
    signal: AbortSignal,
  ): Promise<SessionCommitAskDataValue> {
    signal.throwIfAborted()
    const askData = this.requireAskData()
    return this.fifo.enqueue(async () => {
      const sessionId = request.sessionId
      if (sessionId !== undefined) {
        return this.gate.run(sessionId, 'reject', () =>
          this.commitExisting(askData, request.sourceId, sessionId, signal))
      }
      return this.commitCreate(askData, request.sourceId, request.workspaceId, signal)
    })
  }

  private async commitExisting(
    askData: AskData,
    sourceId: string,
    sessionId: SessionId,
    signal: AbortSignal,
  ): Promise<SessionCommitAskDataValue> {
    const found = await this.agents.resolveAgent(sessionId)
    if ('error' in found) throw found.error
    const agent = found.agent
    const existing = this.ctx.sessionProjections.stateOf(agent.session, 'askDataBinding')
    if (existing != null && existing.sourceId !== sourceId) {
      throw new RemoteError(
        'gateway/bad-request',
        `session "${sessionId}" is already bound to a different source`,
        {},
      )
    }
    if (existing == null && !isBlankSession(this.ctx, agent)) {
      throw new RemoteError(
        'gateway/bad-request',
        `session "${sessionId}" is not blank and is not bound to this source`,
        {},
      )
    }
    const previousPreset = this.agents.presetForSession(agent.session) ?? 'standard'
    let changedPreset = false
    let lease: AskDataBindLease | undefined
    try {
      if (previousPreset !== 'data-agent') {
        const presets = this.ctx.get('agentPresets')
        if (presets === undefined) {
          throw new RemoteError('gateway/internal', 'agent-presets is required to commit ask-data', {})
        }
        await presets.select(agent, 'data-agent')
        changedPreset = true
      }
      lease = await askData.bind({
        sourceId: brandString<AskDataSourceId>(sourceId),
        sessionId,
      }, signal)
      agent.session.append('ask-data/bound', lease.binding)
      return { sessionId }
    } catch (error: unknown) {
      const acquired = lease
      await compensateSessionCommit({
        ...acquired === undefined ? {} : { rollback: () => acquired.rollback() },
        changedPreset,
        previousPreset,
        agent,
        handle: undefined,
        workspace: undefined,
        sessionId,
        created: false,
        stillBlank: () => isBlankSession(this.ctx, agent),
        ctx: this.ctx,
      })
      throw mapAskDataError(error, signal)
    }
  }

  private async commitCreate(
    askData: AskData,
    sourceId: string,
    workspaceId: SessionCommitAskDataRequest['workspaceId'],
    signal: AbortSignal,
  ): Promise<SessionCommitAskDataValue> {
    const { workspace, cwd, sessionId } = resolveCommitTarget(this.ctx, workspaceId, this.defaultCwd)
    const created = await this.agents.createOwnedSession(sessionId, cwd, 'data-agent')
    let attached = false
    let lease: AskDataBindLease | undefined
    return this.gate.run(sessionId, 'reject', async () => {
      try {
        if (workspace !== undefined) {
          await workspace.attachSession(sessionId)
          attached = true
        }
        lease = await askData.bind({
          sourceId: brandString<AskDataSourceId>(sourceId),
          sessionId,
        }, signal)
        created.agent.session.append('ask-data/bound', lease.binding)
        return { sessionId }
      } catch (error: unknown) {
        const acquired = lease
        await compensateSessionCommit({
          ...acquired === undefined ? {} : { rollback: () => acquired.rollback() },
          changedPreset: false,
          previousPreset: 'standard',
          agent: created.agent,
          handle: created.handle,
          workspace: attached ? workspace : undefined,
          sessionId,
          created: true,
          ctx: this.ctx,
        })
        throw mapAskDataError(error, signal)
      }
    })
  }

}

/**
 * Decode a canonical base64 payload and enforce the decoded-byte cap.
 * @param bytes - wire field.
 * @returns decoded bytes.
 */
export function decodeCanonicalBase64(bytes: unknown): Uint8Array {
  return decodeBase64Payload(bytes, {
    limit: ASK_DATA_MAX_DECODED_BYTES,
    code: 'session/ask-data-failed',
    ruleId: 'file-size',
  })
}

/** How ask-data failures map onto Remote failure codes. */
const ASK_DATA_SEAM: SeamFailureCodes = {
  aborted: 'ask-data request was aborted',
  unavailable: 'session/ask-data-unavailable',
  unavailableSeamCode: 'ask-data-unavailable',
  failed: 'session/ask-data-failed',
  failureOf: error => error instanceof AskDataError
    ? {
      code: error.code,
      message: error.message,
      ruleId: error.details.ruleId,
      limit: error.details.limit,
    }
    : undefined,
}

/**
 * Map an ask-data failure onto a RemoteError.
 * @param error - thrown value.
 * @param signal - caller lifetime.
 * @returns never; always throws.
 */
export function mapAskDataError(error: unknown, signal: AbortSignal): never {
  mapSeamFailure(error, signal, ASK_DATA_SEAM)
}
