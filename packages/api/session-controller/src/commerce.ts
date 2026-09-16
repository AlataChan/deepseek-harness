/**
 * Session remotes for the commerce seam. Consumer of `ctx.commerce` only.
 * @module @deepseek-ai/dsh-api-session-controller/commerce
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import { CommerceError } from '@deepseek-ai/dsh-host-commerce'
import type { Commerce, CommerceImportPreview, CommerceSourceId } from '@deepseek-ai/dsh-host-commerce'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { ApiSessionAgentController } from './agent.ts'
import { mapSeamFailure, type SeamFailureCodes } from './seam-error.ts'
import { CommitFifo, type SessionCallGate } from './session-gate.ts'
import { compensateSessionCommit, isBlankSession, resolveCommitTarget } from './session-commit.ts'
import { decodeBase64Payload } from './wire-bytes.ts'
import {
  COMMERCE_MAX_DECODED_BYTES,
  type SessionCommerceImportPreview,
  type SessionCommerceSource,
  type SessionCommitCommerceRequest,
  type SessionCommitCommerceValue,
  type SessionImportCommerceSpreadsheetRequest,
} from './types.ts'

/** Agent preset a commerce-bound Session runs on. */
const COMMERCE_PRESET = 'commerce'

/** How commerce failures map onto Remote failure codes. */
const COMMERCE_SEAM: SeamFailureCodes = {
  aborted: 'commerce request was aborted',
  unavailable: 'session/commerce-unavailable',
  unavailableSeamCode: 'commerce-unavailable',
  failed: 'session/commerce-failed',
  failureOf: error => error instanceof CommerceError
    ? {
      code: error.code,
      message: error.message,
      ruleId: error.details.ruleId,
      limit: error.details.limit,
    }
    : undefined,
}

/**
 * Commerce Remote helpers owned by Session Controller.
 */
export class SessionCommerceController {
  private readonly fifo = new CommitFifo()

  /**
   * @param ctx - Host context.
   * @param agents - Session agent activation.
   * @param gate - per-Session gate shared with the other binding Remotes.
   * @param defaultCwd - cwd used when commit creates a Session without a workspace.
   */
  constructor(
    private readonly ctx: Context,
    private readonly agents: ApiSessionAgentController,
    private readonly gate: SessionCallGate,
    private readonly defaultCwd: string,
  ) {}

  /**
   * Require `ctx.commerce` or fail `session/commerce-unavailable`.
   * @returns the seam.
   */
  requireCommerce(): Commerce {
    const capability = this.ctx.get('commerce')
    if (capability === undefined) {
      throw new RemoteError(
        'session/commerce-unavailable',
        'session commerce remotes need the commerce capability',
        {},
      )
    }
    return capability
  }

  /**
   * List the provider's stored commerce sources.
   * @param signal - caller lifetime.
   * @returns listed rows.
   */
  async listSources(signal: AbortSignal): Promise<readonly SessionCommerceSource[]> {
    signal.throwIfAborted()
    try {
      const sources = await this.requireCommerce().listSources(signal)
      return sources.map(source => ({
        id: source.id,
        displayName: source.displayName,
        kinds: source.kinds,
      }))
    } catch (error: unknown) {
      mapSeamFailure(error, signal, COMMERCE_SEAM)
    }
  }

  /**
   * Platform mapping ids this deployment configured.
   * @returns the configured platform ids.
   */
  platforms(): readonly string[] {
    return this.requireCommerce().platforms()
  }

  /**
   * Import or replace one commerce table. `bytes` is canonical base64.
   * @param request - table family, platform mapping, filename, and encoded bytes.
   * @param signal - caller lifetime.
   * @returns preview of the imported source.
   */
  async importSpreadsheet(
    request: SessionImportCommerceSpreadsheetRequest,
    signal: AbortSignal,
  ): Promise<SessionCommerceImportPreview> {
    signal.throwIfAborted()
    const bytes = decodeBase64Payload(request.bytes, {
      limit: COMMERCE_MAX_DECODED_BYTES,
      code: 'session/commerce-failed',
      ruleId: 'file-size',
    })
    try {
      return toSessionPreview(await this.requireCommerce().importSpreadsheet({
        ...request.sourceId === undefined
          ? {}
          : { sourceId: brandString<CommerceSourceId>(request.sourceId) },
        kind: request.kind,
        platform: request.platform,
        filename: request.filename,
        bytes,
      }, signal))
    } catch (error: unknown) {
      mapSeamFailure(error, signal, COMMERCE_SEAM)
    }
  }

  /**
   * Import the packaged fictional sample as one source.
   * @param signal - caller lifetime.
   * @returns preview of the imported sample.
   */
  async importSample(signal: AbortSignal): Promise<SessionCommerceImportPreview> {
    signal.throwIfAborted()
    try {
      return toSessionPreview(await this.requireCommerce().importSample(signal))
    } catch (error: unknown) {
      mapSeamFailure(error, signal, COMMERCE_SEAM)
    }
  }

  /**
   * Bind a source to a Session, creating one when `sessionId` is omitted.
   * @param request - source and optional Session / workspace.
   * @param signal - caller lifetime.
   * @returns the Session that now carries the bind.
   */
  commit(
    request: SessionCommitCommerceRequest,
    signal: AbortSignal,
  ): Promise<SessionCommitCommerceValue> {
    signal.throwIfAborted()
    const commerce = this.requireCommerce()
    return this.fifo.enqueue(async () => {
      const sessionId = request.sessionId
      if (sessionId !== undefined) {
        return this.gate.run(sessionId, 'reject', () =>
          this.commitExisting(commerce, request.sourceId, sessionId, signal))
      }
      return this.commitCreate(commerce, request.sourceId, request.workspaceId, signal)
    })
  }

  private async commitExisting(
    commerce: Commerce,
    sourceId: string,
    sessionId: SessionId,
    signal: AbortSignal,
  ): Promise<SessionCommitCommerceValue> {
    const found = await this.agents.resolveAgent(sessionId)
    if ('error' in found) throw found.error
    const agent = found.agent
    const existing = this.ctx.sessionProjections.stateOf(agent.session, 'commerceBinding') ?? null
    if (existing !== null) {
      if (existing.sourceId !== sourceId) {
        throw new RemoteError(
          'gateway/bad-request',
          `session "${sessionId}" is already bound to a different commerce source`,
          {},
        )
      }
      // The seam appends one binding event per Session, so re-binding the same
      // source is the identity this Remote reports instead of a second append.
      return { sessionId }
    }
    if (!isBlankSession(this.ctx, agent)) {
      throw new RemoteError(
        'gateway/bad-request',
        `session "${sessionId}" is not blank and is not bound to this source`,
        {},
      )
    }
    const previousPreset = this.agents.presetForSession(agent.session) ?? 'standard'
    let changedPreset = false
    try {
      if (previousPreset !== COMMERCE_PRESET) {
        await this.selectCommercePreset(agent)
        changedPreset = true
      }
      await commerce.bind(agent, brandString<CommerceSourceId>(sourceId), signal)
      return { sessionId }
    } catch (error: unknown) {
      await compensateSessionCommit({
        changedPreset,
        previousPreset,
        agent,
        sessionId,
        created: false,
        stillBlank: () => isBlankSession(this.ctx, agent),
        ctx: this.ctx,
      })
      mapSeamFailure(error, signal, COMMERCE_SEAM)
    }
  }

  private async commitCreate(
    commerce: Commerce,
    sourceId: string,
    workspaceId: SessionCommitCommerceRequest['workspaceId'],
    signal: AbortSignal,
  ): Promise<SessionCommitCommerceValue> {
    // A created Session composes the commerce preset, so a rosterless Host
    // cannot carry this bind at all.
    if (this.ctx.get('agentPresets') === undefined) throw commercePresetUnavailable()
    const { workspace, cwd, sessionId } = resolveCommitTarget(this.ctx, workspaceId, this.defaultCwd)
    const session = await this.createCommerceSession(sessionId, cwd)
    let attached = false
    return this.gate.run(sessionId, 'reject', async () => {
      try {
        if (workspace !== undefined) {
          await workspace.attachSession(sessionId)
          attached = true
        }
        await commerce.bind(session.agent, brandString<CommerceSourceId>(sourceId), signal)
        return { sessionId }
      } catch (error: unknown) {
        await compensateSessionCommit({
          changedPreset: false,
          previousPreset: 'standard',
          agent: session.agent,
          handle: session.handle,
          workspace: attached ? workspace : undefined,
          sessionId,
          created: true,
          ctx: this.ctx,
        })
        mapSeamFailure(error, signal, COMMERCE_SEAM)
      }
    })
  }

  private async createCommerceSession(
    sessionId: SessionId,
    cwd: string,
  ): ReturnType<ApiSessionAgentController['createOwnedSession']> {
    try {
      return await this.agents.createOwnedSession(sessionId, cwd, COMMERCE_PRESET)
    } catch (error: unknown) {
      throw presetMissing(error) ? commercePresetUnavailable() : error
    }
  }

  private async selectCommercePreset(agent: Agent): Promise<void> {
    const presets = this.ctx.get('agentPresets')
    if (presets === undefined) throw commercePresetUnavailable()
    try {
      await presets.select(agent, COMMERCE_PRESET)
    } catch (error: unknown) {
      throw presetMissing(error) ? commercePresetUnavailable() : error
    }
  }
}

function toSessionPreview(preview: CommerceImportPreview): SessionCommerceImportPreview {
  return {
    source: {
      id: preview.source.id,
      displayName: preview.source.displayName,
      kinds: preview.source.kinds,
    },
    tables: preview.tables.map(table => ({
      kind: table.kind,
      rowCount: table.rowCount,
      columns: table.columns,
    })),
    warnings: preview.warnings,
  }
}

function presetMissing(error: unknown): boolean {
  return error instanceof RemoteError && error.code === 'agent-preset/not-found'
}

function commercePresetUnavailable(): RemoteError<'session/commerce-preset-unavailable'> {
  return new RemoteError(
    'session/commerce-preset-unavailable',
    `agent preset "${COMMERCE_PRESET}" is not installed`,
    { preset: COMMERCE_PRESET },
  )
}
